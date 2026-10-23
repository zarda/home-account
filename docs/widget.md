# The widget

An iOS widget for the Home Screen and the Lock Screen, showing the month the
dashboard last painted: this month's spend, this month's net, the budget
nearest its limit, the next scheduled bill. The Lock Screen shows the net
balance alone. A tap opens the dashboard. It has no data source of its own —
the app writes a file, the widget only ever reads it.

Why the widget composes nothing, why the timeline carries two entries rather
than one, and what the first simulator run did and did not prove is in
[ADR 0133](ADR/0133-the-home-screen-widget-shows-the-dashboards-last-this-month-paint-and-nothing-a-lock-hides.md).
The Lock Screen sizes, the tap, the name in the device's language, what
reaches the widget without another paint and what it leaves out are in
[ADR 0183](ADR/0183-the-widget-reaches-the-lock-screen-opens-the-dashboard-names-itself-in-the-devices-language-and-follows-the-accounts-language-currency-and-hidden-cards.md).
This document is the part you need when reading the snapshot's shape, working
out why the widget shows what it shows, or verifying it on the simulator.

## The snapshot contract

One JSON file, `widget-snapshot.json`, in the App Group container
(`group.com.homeaccount.app`). `WidgetSnapshotService` (web) writes it;
`WidgetSnapshot.swift` (Foundation only, compiled into the app, the widget
extension and `AppTests`) decodes and validates it before anything is
written to disk, and the widget extension reads it back.

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | The only supported value; anything else fails decode |
| `state` | `'figures' \| 'locked' \| 'signedOut'` | What the web layer chose to write |
| `writtenAt` | number (epoch ms) | The clock at the write. Not compared for the dedupe below |
| `monthKey` | string, `YYYY-MM` | For `figures`, the month of the window the figures were summed over (the dashboard's painted period), not the clock at publish; a sentence has no window and takes the clock's month. `writtenAt` and `labels.updated` stay on the clock. Always Gregorian and zero-padded — the web composes it from a JS `Date`; a non-zero-padded or non-Gregorian key fails decode |
| `labels` | object, 11 string fields | `title`, `spent`, `net`, `topBudget`, `nextScheduled`, `noBudgets`, `nothingScheduled`, `locked`, `signedOut`, `stale`, `updated` — present in every state, so the locked and signed-out faces can word their own sentence |
| `figures` | object, present only when `state` is `'figures'` | `spent`, `net` (formatted strings), `topBudget` (`{ name, percent: Int, detail }` or `null`), `nextScheduled` (`{ name, date, amount }` or `null`), `hidden` |
| `figures.hidden` | array of `'budgets' \| 'upcoming'` | The widget's cards the account hid on the dashboard, in that order (`WIDGET_CARDS`); always written, empty when none is. Any other id fails decode. A file an older build wrote has none, and hides nothing |

`topBudget` is `null` when the account has no budget to rank, and when it
hid Budget Progress; `nextScheduled` is `null` when nothing is scheduled,
and when it hid Upcoming Bills. `hidden` tells the two apart: the medium
size says *No active budgets* for an empty card and draws no section at all
for a hidden one.

Every string in it is already formatted — currency symbols, decimal places,
translated words, localized dates — by the same `TranslationService`,
`CurrencyService` and `LocaleFormatService` the dashboard itself paints with.
The widget extension formats nothing: doing that natively would need a
second copy of the app's translation catalogs and currency rules, which
would drift from the first the moment either changed. The one word it holds
itself is its own name ([below](#the-widgets-name)).

The payload crosses the Capacitor bridge as **one JSON string**, not an
object — an object would cross through `JSObject`, which retypes numbers on
the way, so the file on disk would no longer be the exact bytes the web
wrote.

## When it is written, and deduplicated

`WidgetSnapshotService.publish(input)` is called from exactly one place: a
`DashboardComponent` constructor effect, with the figures that effect
already has on hand. The effect is keyed on a **paint counter**
(`thisMonthPaints`) that increments once per successful load whose selected
period is `'thisMonth'` — not on the shared `transactions` signal, which
other code can write for reasons that have nothing to do with a new month's
figures being ready. It is also keyed on what changes the payload without
moving a paint:

- **the base currency** (`baseCurrency()`), so a new one rewrites the
  figures at once;
- **the catalog** (`translationsVersion()`), so a switched language
  rewrites the labels;
- **the hidden cards** (`layout().hidden`, below);
- and, as before, the budgets stream and the upcoming window.

Each is read before the effect's guard, so a change runs the effect again
whatever the guard last decided; the guard still publishes nothing before
the first this-month paint, or while the page shows another period. The
totals stay untracked, and a change that moves none of the keys — a new
display name, say — publishes nothing.

**The month is the window's, not the clock's.** The effect hands
`publish()` the start of the window its last this-month paint summed
(`month`), and `monthKey` is that month; `writtenAt` and `labels.updated`
stay on the clock. A dashboard left open past the month's end still holds
last month's rows, and a change to any key above republishes them under
last month's `monthKey`: a stale file, which the widget shows as the stale
sentence, never last month's figures as this month's.

**With nobody signed in, `publish()` writes nothing.** The device can end a
session while the dashboard stays open, and the page's next paint would
otherwise write figures that belong to nobody over the signed-out sentence;
a cold start that has not restored its session yet writes no figures
either.

**What it leaves out.** *Top budget* and *Next scheduled* come from the
dashboard's budgets stream and its upcoming window, and follow the
account's hidden set (`layout().hidden`, held while a change saves): a card
hidden on the dashboard is left out of the widget too. Its field is `null`,
its id is listed in `figures.hidden`, and nothing it would show is composed.
The widget holds no listener open: a hidden Upcoming Bills card closes its
listener unless the weekly recap reads the window
([dashboard.md](dashboard.md#what-a-hidden-card-skips)), and the budgets
stream is never gated on its card. It follows which cards are hidden, not
their order: a reorder republishes an equal payload, which the dedupe
below skips, and the medium size keeps its own order.

Two more writes happen with no dashboard paint at all, from effects armed at
service construction (see [Startup arming](#the-four-states-and-startup-arming)):
a `locked` write whenever the app lock can engage, and a `signedOut` write
whenever auth has finished loading with no user. Both follow the catalog
too: a locked cold start composes its sentence before the account's catalog
arrives, in the language the web view starts in (the device's), and the
catalog's arrival writes it again in the account's.

**Deduplication.** `writeIfChanged()` compares the new payload against the
last one accepted, both with `writtenAt` stripped, and skips the plugin call
— and the `WidgetKit` timeline reload that call triggers — when nothing else
differs. That would make an identical repeat permanently silent, except that
`labels.updated` (`widget.updated`) is formatted with **today's date**: an
otherwise-identical payload still differs from yesterday's by that one field,
so a new day always writes at least once, and reopening the dashboard five
times in one afternoon writes once. A catalog reload that brings no new word
composes an equal payload and writes nothing.

A rejected write (see [The plugin](#the-plugin-the-target-and-the-container-file))
is swallowed with no retry and no console line: the widget keeps whatever it
last wrote successfully, and the next publish tries again.

## The four states, and startup arming

Three states travel in the JSON (`WidgetSnapshotState`); the widget derives a
fourth purely from its own clock:

| State | Set by | What the widget shows |
|---|---|---|
| `figures` | `publish()`, when someone is signed in and the lock cannot engage | The figures, unless the device's month has moved past `monthKey` |
| `locked` | The constructor's lock effect, or `publish()` when the lock can engage | `labels.locked` |
| `signedOut` | The constructor's sign-out effect | `labels.signedOut` |
| *(derived)* `stale` | `WidgetSnapshot.display(now:calendar:)`, never written to disk | `labels.stale`, once the calendar has moved into a month after `monthKey` |

**`AppLockService.canEngage()` decides `locked`, never `isLocked()` — and the
difference is the whole point.** `canEngage()` means the account has a lock
*configured on this device* — enabled, with a credential to satisfy it.
`isLocked()` means the app is *locked right now*, tracked by an in-memory
timestamp the widget process cannot see at all: it lives inside the running
app, and the widget only ever reads a file. So **while the app lock is
turned on, the widget never shows figures again — unlocking the app does
not bring them back.** The dashboard's next paint after an unlock still
calls `publish()`, `publish()` still asks `canEngage()`, and `canEngage()`
is still true, so it still writes `locked`. Figures return only once the
lock is turned off entirely (verified on the simulator: see below). The one
exception is a profile read that fails: the fallback profile has no lock, so
`publish()` writes figures until the real profile arrives (see
[Known gaps](#known-gaps)).

**Startup arming.** `WidgetSnapshotService` is constructed from a
`provideAppInitializer`, before the first guarded navigation — the same slot
`AppLockService` occupies. Its two effects need no dashboard paint: a cold
start that lands straight on `/lock` never renders `DashboardComponent`, so
without them a home screen would show last session's real figures next to a
PIN prompt on the very screen those figures are supposed to be behind.
`isLoading()` guards the sign-out effect so the brief window while a session
is still being restored is never read as a real sign-out. The two effects
cannot both decide to write for one boot: `canEngage()` is false with
nobody signed in. `publish()` is the third writer, and its own guard keeps
it off the signed-out sentence.

**Inert on web.** `WIDGET_SNAPSHOT_PLUGIN` is `null` when
`Capacitor.isNativePlatform()` is false, decided once at injection. On a
browser the service composes nothing and calls nothing: `publish()` and
both effects return before composing, so `TranslationService`,
`LocaleFormatService` and `CurrencyService` are never resolved there.

## What each size shows

`WidgetSnapshot.face(of:isPlaceholder:now:calendar:)` makes one decision,
and every size lays out its answer, so no size can read the snapshot
differently from another:

| Face | When |
|---|---|
| `.name` | A placed widget with no snapshot file (the gallery shows the redacted sample instead) |
| `.figures(…, redacted: true)` | The gallery's sample, decided before the clock is read (it is dated 2000-01 and must not read as a stale month) |
| `.figures(…, redacted: false)` | A placed widget whose `display(now:calendar:)` is figures |
| `.sentence(…)` | A placed widget that is locked, signed out or stale, with that sentence from `labels` |

| Size | Figures | Sentence | Name |
|---|---|---|---|
| Small (Home Screen) | Title, spent, net, *Updated …* | Title and the sentence | The app's name |
| Medium (Home Screen) | The small size's month, beside *Top budget* and *Next scheduled* for each card the account shows; the month alone when both are hidden | Title and the sentence | The app's name |
| Rectangular (Lock Screen, iOS 16+) | Title, the net label, the net figure | Title and the sentence, on up to three lines, scaled down to 0.8 rather than cut | The app's name |
| Circular (Lock Screen, iOS 16+) | The net label over the net figure, scaled down rather than cut | A glyph — `lock.fill`, `person.crop.circle.badge.xmark` or `arrow.clockwise` — with the sentence as its accessibility label | The app's name, on up to two lines |

**Every figure is `.privacySensitive()`**, in every size: the month's spent
and net, the medium size's budget detail and its progress bar, the next
bill's amount, and the net balance on both Lock Screen faces. A device that
hides private content while locked draws them as placeholders. Names and
labels are not marked.

The Lock Screen faces do not use the Home Screen tile:
`accessoryBackground()` declares a clear container background on iOS 17,
which wants one, and nothing on 16; the circle's backdrop is the system's
`AccessoryWidgetBackground`, and `widgetBackground()` is never used there.
The Home Screen sizes keep the system background (`widgetBackground()`).

## A tap opens the dashboard

Every size, in every state, opens the app with
`com.homeaccount.app://widget` (`WidgetSnapshot.tapURL`, set once with
`.widgetURL` around the entry view). The URL names no route: any app may
open a URL in the app's scheme, and all this one can do is bring the
dashboard up. The app picks the route, `widgetRoute()` in
`notification-route.utils.ts`.

1. **The plugin hears it.** `WidgetSnapshotPlugin.load()` observes
   Capacitor's `.capacitorOpenURL` notification, and reads
   `ApplicationDelegateProxy.shared.lastURL` once, for a tap that started
   the app before the bridge loaded the plugin. `WidgetSnapshot.isTap(_:)`
   compares the scheme and the host without case, so Google sign-in's
   redirect, another host or `https://widget` passes by. A tap sends
   `tapped`, held until a listener attaches. Its payload,
   `{ source: 'widget' }`, is read by nobody; it is there so the console
   names the event: `⚡️  TO JS {"source":"widget"}`.
2. **The page opens it.** `NotificationTapService`
   ([reminders.md](reminders.md#where-a-tap-lands)) listens for `tapped`
   beside the reminders' listener, armed at once in the iOS app by
   `armNotificationTaps`. A refused listener logs *Widget taps were not
   armed* once, and the reminders still arm. It navigates to `/dashboard`
   straight away once the router has navigated, or after the first
   navigation settles on a cold start.
3. **The lock stands in front.** On a locked app `authGuard` sends the tap
   to `/lock` and remembers `/dashboard`, and the unlock lands there. A tap
   that arrives as the app relocks lands there too: the relock remembers the
   navigation in flight, not the page it left
   ([app-lock.md](app-lock.md#relocking-and-a-tap-that-races-it)).

**Nothing is registered for the scheme.** The committed `Info.plist`
declares no URL type, and the build phase that writes Google sign-in's in
deletes the whole `CFBundleURLTypes` key first. A probe on the iOS 26.2
simulator showed the unregistered scheme delivered to the app warm and
cold ([The run on record](#the-run-on-record)), so the phase was left
alone. Older iOS releases are not proved.

## The widget's name

The gallery lists the widget under the app's name in the device's language,
and a placed widget with no file to read draws the same name. Both read
`HomeAccountMonthWidget.appName`, the key `app.title` as a
`LocalizedStringKey`, from the widget extension's own tables:

| Table | Mirrors | Name |
|---|---|---|
| `en.lproj/Localizable.strings` | `src/assets/i18n/en.json` | Home Account |
| `ja.lproj/Localizable.strings` | `src/assets/i18n/ja.json` | 家計簿 |
| `zh-Hant.lproj/Localizable.strings` | `src/assets/i18n/tc.json` | 家庭記帳 |

The gallery shows its name before the app has ever run, so the name follows
the device, not the account: a Japanese account on an English phone reads
*Home Account* in the gallery and Japanese everywhere the snapshot speaks. A
device in Simplified Chinese has no table and reads English. The gallery
shows no description line. The app's own name in the gallery's list, and
under its icon, is `Info.plist`'s *HomeAccount*, English on every device.

`npm run i18n:check`'s sixth scan holds each table equal to the catalog it
mirrors, the tables wired into the widget target, and the widget's Swift
free of display literals of its own — see
[i18n.md](i18n.md#the-widgets-own-strings). A word the widget draws itself
goes into all three tables under its catalog key, in the commit that adds
the catalog entries; anything the snapshot carries stays in the catalogs
alone.

## The plugin, the target and the container file

**`widget-snapshot.plugin.ts`** — the TypeScript interface (`write` and
`addListener('tapped', …)`), the `registerPlugin` call, and
`WIDGET_SNAPSHOT_PLUGIN`, an `InjectionToken` everything else injects
instead of the proxy. The factory hands out a **plain two-method adapter**,
never the proxy: Angular's injector probes every provided value for
`typeof value.ngOnDestroy === 'function'` at teardown, and the proxy answers
every name with a callable plugin-method wrapper — the same hazard
`BIOMETRIC_AUTH_PLUGIN` exists to avoid ([app-lock.md](app-lock.md)).

**`WidgetSnapshotPlugin.swift`** — one method, `write`, and the `tapped`
event ([above](#a-tap-opens-the-dashboard)), registered from
`MainViewController.capacitorDidLoad` alongside the app's other four
app-target plugins. `write` decodes and validates the string before writing
anything (`WidgetSnapshot.write`), then calls
`WidgetCenter.shared.reloadAllTimelines()`. Two rejection codes, not
interchangeable:

- **`'invalid'`** — the payload never decoded; a bug in the web writer.
- **`'unavailable'`** — a validated payload that could not be written: no
  App Group container, or the atomic file write itself failing. The
  underlying `Error` rides along on this rejection rather than being
  dropped, so a bad device is never read as the web layer's own bug.

**`WidgetSnapshot.swift`** — pure Foundation and Codable, compiled into the
app, the widget extension and `AppTests` (the pattern ADR 0040 established
for `BiometricOutcome.swift`): the decode/validate/write logic, the
`display(now:calendar:)` state machine above, the face every size draws, the
tap URL, and `timelineDates(now:timeZone:)`, which returns **two** entries —
now, and the exact month boundary — because WidgetKit's own scheduled reload
is a request the system can run late, and a single "now" entry would keep
evaluating last month's `monthKey` as fresh for however long that reload is
delayed. The boundary entry's own evaluation turns itself stale the instant
the calendar reaches it, independent of whether the system's reload runs on
time.

**`HomeAccountWidget.swift`** — the WidgetKit extension itself: a
`StaticConfiguration` with `.systemSmall` and `.systemMedium`, and from iOS
16 `.accessoryRectangular` and `.accessoryCircular` (the extension deploys
to 15.6), reading the container through
`FileManager.containerURL(forSecurityApplicationGroupIdentifier:)` on every
timeline request. Built to the same target settings the Share Extension
already used (signing, Info.plist shape), differing only in entitlements,
Info.plist contents and bundle id
([ADR 0019](ADR/0019-share-intake-lands-through-a-stash.md)'s pbxproj
hand-edit method, which also wired the three string tables).
`getSnapshot(in:completion:)` returns a redacted sample when the gallery
preview runs before the app has ever written a file (`context.isPreview`);
a *placed* widget with no file draws the app's name.

## Verifying on the simulator

`npm run test:ios` runs `AppTests` (59 cases, 27 of them on
`WidgetSnapshot.swift`): the decoder, the hidden cards, the month rule under
a non-Gregorian device calendar, the face every size draws, the tap URL, and
the two-entry timeline's boundary arithmetic. The plugin shell, the bridge
and the widget extension's own rendering are only exercised by hand.

The Lock Screen families are iOS 16 API and the extension deploys to 15.6,
so a guard that slips shows only at the floor, and only the iOS 26.2
runtime is installed to run anything on. Type-check the widget's two files
at each floor instead. `-application-extension` is needed: without it the
compiler does not count an `#available(iOSApplicationExtension …)` guard,
and reports the guarded iOS 17 background as unavailable.

```
xcrun --sdk iphonesimulator swiftc -typecheck -application-extension \
  -target arm64-apple-ios15.6-simulator -module-name HomeAccountWidget \
  ios/App/HomeAccountWidget/HomeAccountWidget.swift \
  ios/App/HomeAccountWidget/WidgetSnapshot.swift
```

Then the same with `arm64-apple-ios16.0-simulator` and
`arm64-apple-ios17.0-simulator`. By hand, on an iPhone 17 simulator:

1. **Build App Group aware.** `npm run build:ios` + a plain `xcodebuild` for
   the simulator, **without** `CODE_SIGNING_ALLOWED=NO`. That flag is the
   usual fast-iteration default, and it is wrong here: an unsigned
   build embeds **no entitlements at all**, so
   `containerURL(forSecurityApplicationGroupIdentifier:)` returns `nil` on
   it and every write rejects `'unavailable'`. A locally signed build ("Sign
   to Run Locally," no override) carries the entitlement. Revert what the
   build writes into `ios/App/App/Info.plist` and `Package.resolved`
   afterwards.
2. **Don't trust `codesign` on a simulator binary.** `codesign
   -d --entitlements -` prints **nothing for either build** — signed or not
   — because recent Xcode embeds a simulator target's entitlements in a
   Mach-O `__entitlements` section that command does not read. Check
   `otool -l` against the built binary, or read the generated
   `*-Simulated.xcent` file, and confirm on the device itself:
   `xcrun simctl get_app_container <udid> com.homeaccount.app groups`.
3. **Launch and paint.** With the App Group container present, opening the
   dashboard writes `widget-snapshot.json`; add both Home Screen sizes from
   the home screen's Edit → **Add Widget** (tap **Add Widget** immediately
   after the menu opens — no screenshot in between, or the menu closes and
   the tap falls through to whatever app is behind it). Cross-check every
   field against the app's own screens: `figures.spent`/`.net` against the
   financial summary, `topBudget` against the Budgets tab (a 0%-utilised
   budget still ranks first on a tie), `nextScheduled` against Upcoming
   Bills.
4. **The Lock Screen.** On iOS 26: long-press the Lock Screen, then
   **Customize**, **Lock Screen**, and the widget row under the clock; the
   app's entry offers both accessory sizes. Each shows the net balance,
   `figures.net`, whole.
5. **The lock cycle, without a relaunch.** Set a PIN and turn the app lock
   on: every widget rewrites to the locked sentence immediately, no
   figures. Force-quit and relaunch to `/lock`: still locked, same sentence
   — a cold start proves the startup-arming effects above, not only the
   dashboard path. Unlock to the dashboard: the widgets **do not** get their
   figures back — this is `canEngage()` working as described above, not a
   bug. Turn the lock off entirely (*Remove PIN*) and repaint the dashboard:
   the figures return.
6. **A tap.** Launch with `xcrun simctl launch --console-pty <udid>
   com.homeaccount.app`, go to another page, press Home and tap a widget:
   the console logs `⚡️  TO JS {"source":"widget"}` and the page goes to the
   dashboard. A cold start lands on the dashboard whatever happens, so on a
   cold tap the console line is the evidence, not the page. With the lock on
   and the app in the background past its timeout, the tap goes through
   `/lock` and the PIN to the dashboard.
7. **The name.** Write the simulator's global `AppleLanguages` and
   `AppleLocale` (`xcrun simctl spawn <udid> defaults write -g …`), reboot
   it, and search the widget gallery: *家計簿* for Japanese, *家庭記帳* for
   Traditional Chinese, *Home Account* for English. Put both back
   afterwards.
8. **The hidden cards.** Hide Budget Progress from its card menu: the file
   lists `"hidden": ["budgets"]`, names no budget, and the medium size
   drops the section. Hide Upcoming Bills from the editor in Settings: the
   file changes only once the dashboard paints (see Known gaps), and the
   medium size shows the month alone. Show both again from the editor —
   *Reset* would also bring back any other card the account hides.
9. **A late catalog.** With the device in one language, the account in
   another and the lock on, cold-start the app while a short loop copies
   every new version of the file: two writes, the locked sentence in the
   device's language and then in the account's.

Scroll the dashboard editor from the right edge, clear of the drag handles:
a swipe that starts on a handle moves the card. Restore afterwards: *Remove
PIN* turns the lock off, the editor puts the cards back, and the widgets
are removed from both screens.

### The run on record

**2026-10-21, the tap probe.** iPhone 17 simulator, iOS 26.2, a signed
Debug build of the branch, no `Info.plist` change. Warm, with the app
backgrounded on `/transactions`: the console logged
`⚡️  TO JS {"source":"widget"}` after the tap and the page went to the
dashboard. Cold, after `simctl terminate`: a temporary log line in the
plugin, read through `log stream` because Capacitor's own log goes to
standard output and a launch from SpringBoard discards it, showed the
launch URL forwarded. The line was not committed. Delivered both ways, so
nothing is registered.

**2026-10-22, the session.** The same simulator and runtime, a signed Debug
build with the production web bundle, signed in to the owner's own account,
whose base currency was never touched.

| Part | What was done | Result |
|---|---|---|
| Sizes | Small and medium on the Home Screen; rectangular and circular on the Lock Screen | Pass. Net NT$24,450 = `figures.net` on all four; the rectangle read *This Month / Net Balance / NT$24,450*, the circle *Net Balance / NT$24,450*, whole; no *adopt containerBackground* placeholder on the Home Screen sizes |
| Tap, warm | Small from `/settings`, medium from `/transactions`, rectangle from `/budgets` | Pass. Each logged the `tapped` event and landed on `/dashboard` |
| Tap, locked | PIN set, lock on, app in the background for 5 min 30 s, then a tap; three times | Pass. `/lock`, the PIN, `/dashboard`, with the tap arriving as the app relocked |
| Tap, locked and cold | Terminated, then a tap | Pass. `/lock`, the PIN, `/dashboard` (one first tap only started the process; the second opened it) |
| Name | Device in English, then Japanese, then Traditional Chinese, each after a reboot | Pass. *Home Account*, *家計簿*, *家庭記帳*; the app's entry stays *HomeAccount* |
| Late catalog | Device Japanese, account English, lock on, cold start, every version of the file copied | Pass. Two writes: *今月の数字を見るにはアプリのロックを解除してください*, then *Unlock the app to see this month* |
| Hidden cards | Budget Progress hidden from its menu; then Upcoming Bills from the editor | Pass. `hidden ["budgets"]`, no budget name in the file, the medium size without *Top budget*; then `hidden ["budgets","upcoming"]` once the dashboard painted, the month alone |

Restored and read back: the PIN removed and the lock off, the hidden cards
as they were, the device's languages, and every widget removed. One card
order moved by accident (a scroll that began on a drag handle) and was moved
back at once. Not driven: redaction under a passcode; the iOS 16 and 17
paths; a new base currency, which the simulator app would write to the real
account and could not put back (the specs and an emulator smoke prove it);
the Lock Screen's sentences in Japanese or Chinese.

**2026-10-22, the re-check on the finished branch.** The same simulator, a
signed Debug build of the final tree. A tap on the small size, with the app
in the background on `/transactions`, logged the `tapped` event and opened
the dashboard. The Lock Screen's locked sentence was read from a locked
snapshot written into the container file by hand in each language, the device-only
state the app replaces on its next open; WidgetKit read the file again
after the same build was installed over itself, and not from the gallery,
whose previews it keeps. The Japanese locked sentence, the longest, was cut
after two lines, *今月の数字を見るにはアプリのロックを解除して…*. The rectangle
now gives a sentence three lines and lets it scale down to 0.8, and the
sentence reads whole on the Lock Screen; the English and Traditional
Chinese ones read whole on two lines, and the small size on the Home Screen
showed the Japanese one whole on four. The signed-out and stale sentences,
no longer than the locked one in any of the three languages, were not
placed. The real file came back when the app was next opened, and the
widgets were removed.

## Known gaps

- **Figures are only as fresh as the last this-month paint.** With no data
  source of its own, an account that never opens the dashboard this month
  keeps seeing last month's figures, or the stale sentence once the month
  turns.
- **A change made away from the dashboard waits for its next paint.** With
  the lock off, a base currency, a language or a hidden card changed in
  Settings reaches the widget only when the dashboard next paints this
  month. With the lock on, the locked sentence follows a new language at
  once.
- **A rate refresh alone does not republish.** A row whose stored
  conversion cannot answer for the base currency is converted at the
  current rate, and the totals are read untracked, so new rates reach the
  widget with the next paint.
- **Simplified Chinese reads English.** A `zh-Hans` device has no table and
  gets *Home Account*, where the web shows it Traditional Chinese.
- **No `.accessoryInline`.** The one-line slot above the clock is not
  offered.
- **A pending share can take over a tap.** When the app opens with a shared
  file waiting, the share intake's navigation to the import wizard and the
  tap's to the dashboard race, and the later one supersedes the other. Not
  driven.
- **A Lock Screen tap can open an app that should have relocked.** A screen
  lock with the app in front fires no `visibilitychange`, so the relock
  clock never counts it ([app-lock.md](app-lock.md#known-gaps)).
- **A degraded profile writes figures under a lock.** When the profile read
  fails, the in-memory fallback profile has no `enableAppLock`, so
  `canEngage()` is false and `publish()` writes figures until the profile
  retry swaps the real profile in ([app-lock.md](app-lock.md#known-gaps)).
- **Redaction is not proved.** The `.privacySensitive()` figures are
  redacted on a locked device with a passcode, and the simulator has none,
  so the redaction was never seen.
- **The iOS 16 and 17 paths are compiled, not run**, at 15.6, 16.0 and
  17.0; only the 26.2 runtime ran the widget.
- **Older iOS may not deliver the tap.** The unregistered scheme is proved
  on 26.2 only.
- **The rectangle's room was read on one phone, at the default text size.**
  On the iPhone 17 the Japanese locked sentence fits two lines only by
  scaling down, so a narrower phone or a larger text size may still cut it;
  neither was read. The signed-out and stale sentences were not placed, only
  measured against the locked one.
- **No real-device run is recorded here.** Everything above was proved on a
  simulator; nothing here exercises a real Secure Enclave, a real App Group
  on physical hardware, or the operating system's actual reload budget.
