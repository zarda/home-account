# The home-screen widget

An iOS home-screen widget showing the month the dashboard last painted: this
month's spend, this month's net, the budget nearest its limit, the next
scheduled bill. It has no data source of its own — the app writes a file, the
widget only ever reads it.

Why the widget composes nothing, why the timeline carries two entries rather
than one, and what the simulator did and did not prove is in
[ADR 0133](ADR/0133-the-home-screen-widget-shows-the-dashboards-last-this-month-paint-and-nothing-a-lock-hides.md).
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
| `writtenAt` | number (epoch ms) | Not compared for the dedupe below |
| `monthKey` | string, `YYYY-MM` | Always Gregorian and zero-padded — the web composes it from a JS `Date`; a non-zero-padded or non-Gregorian key fails decode |
| `labels` | object, 11 string fields | `title`, `spent`, `net`, `topBudget`, `nextScheduled`, `noBudgets`, `nothingScheduled`, `locked`, `signedOut`, `stale`, `updated` — present in every state, so the locked and signed-out faces can word their own sentence |
| `figures` | object, present only when `state` is `'figures'` | `spent`, `net` (formatted strings), `topBudget` (`{ name, percent: Int, detail }` or `null`), `nextScheduled` (`{ name, date, amount }` or `null`) |

Every string in it is already formatted — currency symbols, decimal places,
translated words, localized dates — by the same `TranslationService`,
`CurrencyService` and `LocaleFormatService` the dashboard itself paints with.
The widget extension formats nothing: doing that natively would need a
second copy of the app's translation catalogs and currency rules, which
would drift from the first the moment either changed.

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
figures being ready.

Two more writes happen with no dashboard paint at all, from effects armed at
service construction (see [Startup arming](#the-four-states-and-startup-arming)):
a `locked` write whenever the app lock can engage, and a `signedOut` write
whenever auth has finished loading with no user.

**Deduplication.** `writeIfChanged()` compares the new payload against the
last one accepted, both with `writtenAt` stripped, and skips the plugin call
— and the `WidgetKit` timeline reload that call triggers — when nothing else
differs. That would make an identical repeat permanently silent, except that
`labels.updated` (`widget.updated`) is formatted with **today's date**: an
otherwise-identical payload still differs from yesterday's by that one field,
so a new day always writes at least once, and reopening the dashboard five
times in one afternoon writes once.

A rejected write (see [The plugin](#the-plugin-the-target-and-the-container-file))
is swallowed with no retry and no console line: the widget keeps whatever it
last wrote successfully, and the next publish tries again.

## The four states, and startup arming

Three states travel in the JSON (`WidgetSnapshotState`); the widget derives a
fourth purely from its own clock:

| State | Set by | What the widget shows |
|---|---|---|
| `figures` | `publish()`, when the lock cannot engage | The figures, unless the device's month has moved past `monthKey` |
| `locked` | The constructor's lock effect, or `publish()` when the lock can engage | `labels.locked` |
| `signedOut` | The constructor's sign-out effect | `labels.signedOut` |
| *(derived)* `stale` | `WidgetSnapshot.display(now:calendar:)`, never written to disk | `labels.stale`, once the calendar has moved into a month after `monthKey` |

**`AppLockService.canEngage()` decides `locked`, never `isLocked()` — and the
difference is the whole point.** `canEngage()` (`app-lock.service.ts:78`)
means the account has a lock *configured on this device* — enabled, with a
credential to satisfy it. `isLocked()` (`:79`) means the app is *locked right
now*, tracked by an in-memory timestamp the widget process cannot see at
all: it lives inside the running app, and the widget only ever reads a file.
So **while the app lock is turned on, the widget never shows figures again —
unlocking the app does not bring them back.** The dashboard's next paint
after an unlock still calls `publish()`, `publish()` still asks
`canEngage()`, and `canEngage()` is still true, so it still writes `locked`.
Figures return only once the lock is turned off entirely (verified on the
simulator: see below).

**Startup arming.** `WidgetSnapshotService` is constructed from a
`provideAppInitializer`, before the first guarded navigation — the same slot
`AppLockService` occupies. Its two effects need no dashboard paint: a cold
start that lands straight on `/lock` never renders `DashboardComponent`, so
without them a home screen would show last session's real figures next to a
PIN prompt on the very screen those figures are supposed to be behind.
`isLoading()` guards the sign-out effect so the brief window while a session
is still being restored is never read as a real sign-out.

**Inert on web.** `WIDGET_SNAPSHOT_PLUGIN` is `null` when
`Capacitor.isNativePlatform()` is false, decided once at injection. Every
write in the service composes its strings and calls nothing on a browser.

## The plugin, the target and the container file

**`widget-snapshot.plugin.ts`** — the TypeScript interface, the
`registerPlugin` call, and `WIDGET_SNAPSHOT_PLUGIN`, an `InjectionToken`
everything else injects instead of the proxy. The factory hands out a
**plain one-method adapter**, never the proxy: Angular's injector probes
every provided value for `typeof value.ngOnDestroy === 'function'` at
teardown, and the proxy answers every name with a callable plugin-method
wrapper — the same hazard `BIOMETRIC_AUTH_PLUGIN` exists to avoid
([app-lock.md](app-lock.md)).

**`WidgetSnapshotPlugin.swift`** — one method, `write`, registered from
`MainViewController.capacitorDidLoad` alongside the app's other four
app-target plugins. It decodes and validates the string before writing
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
`display(now:calendar:)` state machine above, and `timelineDates(now:
timeZone:)`, which returns **two** entries — now, and the exact month
boundary — because WidgetKit's own scheduled reload is a request the system
can run late, and a single "now" entry would keep evaluating last month's
`monthKey` as fresh for however long that reload is delayed. The boundary
entry's own evaluation turns itself stale the instant the calendar reaches
it, independent of whether the system's reload runs on time.

**`HomeAccountWidget.swift`** — the WidgetKit extension itself: a
`StaticConfiguration`, `.systemSmall` and `.systemMedium` only, reading the
container through `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`
on every timeline request. Built to the same target settings the Share
Extension already used (signing, Info.plist shape), differing only in
entitlements, Info.plist contents and bundle id
([ADR 0019](ADR/0019-share-intake-lands-through-a-stash.md)'s pbxproj
hand-edit method). `getSnapshot(in:completion:)` returns a redacted sample
when the gallery preview runs before the app has ever written a file
(`context.isPreview`); a *placed* widget with no file falls all the way
through to the literal text "Home Account" — not a catalog key, see Known
gaps.

## Verifying on the simulator

`AppTests` (43 cases, 11 of them on `WidgetSnapshot.swift`) pins the decoder,
the month rule under a non-Gregorian device calendar and the two-entry
timeline's boundary arithmetic; the plugin shell, the bridge and the widget
extension's own rendering are only exercised by hand. The sequence below was
run once end to end on an iPhone 17 simulator:

1. **Build App Group aware.** `npm run build:ios` + a plain `xcodebuild` for
   the simulator, **without** `CODE_SIGNING_ALLOWED=NO`. That flag is the
   usual fast-iteration default, and it is wrong here: an unsigned
   build embeds **no entitlements at all**, so
   `containerURL(forSecurityApplicationGroupIdentifier:)` returns `nil` on
   it and every write rejects `'unavailable'`. A locally signed build ("Sign
   to Run Locally," no override) carries the entitlement.
2. **Don't trust `codesign` on a simulator binary.** `codesign
   -d --entitlements -` prints **nothing for either build** — signed or not
   — because recent Xcode embeds a simulator target's entitlements in a
   Mach-O `__entitlements` section that command does not read. Check
   `otool -l` against the built binary, or read the generated
   `*-Simulated.xcent` file, and confirm on the device itself:
   `xcrun simctl get_app_container <udid> com.homeaccount.app groups`.
3. **Launch and paint.** With the App Group container present, opening the
   dashboard writes `widget-snapshot.json`; add both widget sizes from the
   home screen's Edit → **Add Widget** (tap **Add Widget** immediately after
   the menu opens — no screenshot in between, or the menu closes and the tap
   falls through to whatever app is behind it). Cross-check every field
   against the app's own screens: `figures.spent`/`.net` against the
   financial summary, `topBudget` against the Budgets tab (a 0%-utilised
   budget still ranks first on a tie), `nextScheduled` against Upcoming
   Bills.
4. **The lock cycle, without a relaunch.** Set a PIN and turn the app lock
   on: both widgets rewrite to the locked sentence immediately, no figures.
   Force-quit and relaunch to `/lock`: still locked, same sentence — a cold
   start proves the startup-arming effects above, not only the dashboard
   path. Unlock to the dashboard: the widgets **do not** get their figures
   back — this is `canEngage()` working as described above, not a bug.
   Turn the lock off entirely (*Remove PIN*) and repaint the dashboard: the
   figures return.

What this proves: the field mapping, the lock behavior exactly as designed,
and the signing pitfall above. What it does not prove is anything about a
real device, a real Secure Enclave, or WidgetKit's actual reload budget
under real system memory pressure — see Known gaps.

## Known gaps

- **No Lock Screen family.** Only `.systemSmall` and `.systemMedium`; no
  `.accessoryRectangular` or `.accessoryCircular`.
- **Figures are only as fresh as the last this-month paint.** With no data
  source of its own, an account that never opens the dashboard this month
  keeps seeing last month's figures, or the stale sentence once the month
  turns.
- **The widget ignores the dashboard's arrangement.** The page publishes its
  budgets and occurrences whatever the account arranged, so hiding Budget
  Progress or Upcoming Bills on the dashboard does not take *Top budget* or
  *Next scheduled* off the home screen. The widget is its own surface with
  fixed content; the two features simply do not talk to each other.
- **A currency or language change alone does not refresh it.** The publishing
  effect reads the totals, the base currency and the catalog untracked, so a
  new base currency or a switched app language reaches the widget only on the
  next this-month paint — until then the home screen keeps the previous
  language's labels and the previous currency's figures.
- **No deep link.** Tapping the widget opens the app wherever it would
  otherwise land; nothing sets a `widgetURL` to the dashboard specifically.
- **The gallery name is English.** `.configurationDisplayName("Home
  Account")` is a literal string, not a catalog key.
- **No real-device run is recorded here.** Everything above was proved on a
  simulator; nothing here exercises a real Secure Enclave, a real App Group
  on physical hardware, or the operating system's actual reload budget.
