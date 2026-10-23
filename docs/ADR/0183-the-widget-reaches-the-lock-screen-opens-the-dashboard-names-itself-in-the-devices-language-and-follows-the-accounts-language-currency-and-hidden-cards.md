# 183. The widget reaches the Lock Screen, opens the dashboard, names itself in the device's language, and follows the account's language, currency and hidden cards

**Status:** Accepted, implemented · **Date:** 2026-10-22 · **Issues:** #441

Reference documentation lives in [../widget.md](../widget.md),
[../i18n.md](../i18n.md), [../app-lock.md](../app-lock.md),
[../reminders.md](../reminders.md) and [../dashboard.md](../dashboard.md).

This record takes the five parts of #441, the gaps the widget of
[0133](0133-the-home-screen-widget-shows-the-dashboards-last-this-month-paint-and-nothing-a-lock-hides.md)
left: no Lock Screen family, a tap that led nowhere in particular, an
English name in the widget gallery, figures and words that missed a new
base currency or language until the next paint, and a widget that showed
what the account had hidden on the dashboard. Reading them found two older
defects on the same paths, and they are fixed here too: a session that
ended under the open dashboard had its signed-out sentence covered by the
next paint's figures, and a tap that arrived as the app relocked was lost
behind the lock screen.

Amends
[0133](0133-the-home-screen-widget-shows-the-dashboards-last-this-month-paint-and-nothing-a-lock-hides.md).
Its design stands: the web composes every string, the widget reads one file
and formats nothing, and `canEngage()` decides the locked state. What
changes is what the widget draws and when the file is written. It gains the
two Lock Screen families and a tap, and names itself from string tables of
its own. The dashboard's publishing effect is keyed on the base currency,
the catalog and the hidden cards as well as the paint counter, and the
locked and signed-out effects follow a catalog that arrives after them. The
snapshot's figures list the cards the account hid, and the plugin's adapter
carries `addListener` beside `write`. 0133 held that the locked and
signed-out writes race nothing. One did: `publish()` wrote figures again
over the signed-out sentence when a session ended under the open
dashboard. It now writes nothing with nobody signed in.

Amends
[0132](0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md),
as
[0166](0166-a-hidden-card-closes-what-nothing-else-reads-the-layout-stores-only-what-changed-and-each-card-has-a-menu.md)
left it. A hidden Upcoming Bills card closed its listener unless the weekly
recap read the window or the build carried the widget plugin. The plugin's
clause goes, and a hidden card now composes nothing in the widget either.

Amends
[0166](0166-a-hidden-card-closes-what-nothing-else-reads-the-layout-stores-only-what-changed-and-each-card-has-a-menu.md).
`WidgetSnapshotService.available`, the flag its listener rule read, is
removed with the rule
([0048](0048-a-dead-capability-is-removed-not-guarded.md)).

Amends
[0167](0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md).
`NotificationTapService` opens the widget's tap as well as a reminder's,
armed beside the reminders' listener in the iOS app. And a tap of either
kind that arrives as the app relocks now lands where it was going, not on
the page it left.

It closes three gaps of 0133 and one gap of 0166.

- **0133's *No Lock Screen family*.** The widget offers
  `.accessoryRectangular` and `.accessoryCircular` from iOS 16, each
  showing the month's net balance.
- **0133's *No deep link*.** A tap on any size, in any state, opens the
  dashboard, through the app lock when it is on.
- **0133's *The gallery name is English*.** The gallery names the widget
  *Home Account*, *家計簿* or *家庭記帳* by the device's language, from
  tables `i18n:check` holds equal to the catalogs.
- **0166's *On a build with the widget plugin, a hidden Upcoming Bills card
  keeps its listener with no widget placed*.** The widget no longer reads a
  hidden card, so nothing keeps that listener open for it.

0133's *Figures are only as fresh as the last this-month paint* and *No
real-device run is recorded here* stand: the widget still has no data
source of its own, and the session recorded below ran on a simulator.

## Context

#85's title promised a Lock Screen widget, and 0133 shipped a Home Screen
one and wrote down what it left. #441 collected five gaps from that record
and from `docs/widget.md`:

- **P1.** `.supportedFamilies([.systemSmall, .systemMedium])` only.
- **P2.** No `widgetURL`, so a tap opened the app wherever it would have
  landed anyway.
- **P3.** `.configurationDisplayName("Home Account")`, a literal. The
  gallery shows that name before the app has ever run, so it cannot come
  from the account; it can only follow the device.
- **P4.** The dashboard's publishing effect read the totals, the base
  currency and the catalog untracked, so a new base currency or a switched
  language reached the widget only with the next this-month paint. The
  locked and signed-out sentences were composed the same way: a locked cold
  start writes its sentence before the account's catalog arrives, in the
  language the web view starts in, and nothing wrote it again.
- **P5.** The page published the top budget and the next bill whatever the
  account hid. Whether that was a feature or a gap was the decision #441
  asked for.

Reading the paths found two more. `publish()` asked only whether the lock
could engage, so a session the device ended while the dashboard stayed open
was followed by a paint that wrote the figures back over the signed-out
sentence. And `AppLockService`'s relock effect remembered `router.url` as
the page to return to. A tap that arrived as the app came back from the
background had started a navigation that had not committed yet, so
`router.url` still named the page it was leaving, the lock screen cancelled
the tap's navigation, and the unlock went back to where the tap began.

## Decision

### One decision picks what every size shows

`WidgetSnapshot.swift`, pure Foundation and compiled into `AppTests`
([0040](0040-the-native-seams-answer-to-xctest.md)), answers what a widget
draws: `face(of:isPlaceholder:now:calendar:)` returns `.name`,
`.figures(labels, figures, redacted:)` or `.sentence(sentence, title:,
text:)`, where a sentence is `.locked`, `.signedOut` or `.stale`. No
snapshot is the app's name, placeholder or not. A placeholder that carries
figures is decided before the clock is read: the gallery's sample is dated
2000-01 and must still draw as the redacted sample, not as a stale month.
Anything else is a placed widget and follows `display(now:calendar:)` as
before. `MonthEntryView` only lays the answer out, so no size can read the
snapshot differently from another; the switch each view held before is
gone.

### The Lock Screen shows the month's net balance, and every figure is private

The families are a static array: `.systemSmall` and `.systemMedium`, and
from iOS 16, behind `#available(iOSApplicationExtension 16.0, *)`,
`.accessoryRectangular` and `.accessoryCircular`. The extension still
deploys to 15.6.

- **The rectangle** draws the title (`widgetAccentable`), the net balance's
  label and its figure, or the title and the sentence on up to three
  lines, scaled down to 0.8 rather than cut.
- **The circle** draws `AccessoryWidgetBackground` with the net label over
  the figure, which scales down to 0.3 rather than being cut. A sentence
  has no room there, so the circle draws a glyph for it (`lock.fill`,
  `person.crop.circle.badge.xmark`, `arrow.clockwise`) and keeps the
  sentence as the glyph's accessibility label.
- **Neither uses the Home Screen tile.** `accessoryBackground()` declares
  a clear container background on iOS 17, which wants one, and nothing on
  16; the circle's backdrop is the system's `AccessoryWidgetBackground`,
  and `widgetBackground()` is never used there.

`.privacySensitive()` marks every figure in every family: the month's spent
and net on the small and medium sizes, the medium size's budget detail and
its progress bar, the next bill's amount, and the net balance on both Lock
Screen faces. A device that hides private content while locked draws them
as placeholders. Names and labels are not marked: a budget's or a bill's
name stays readable. The app lock's rule is unchanged: while it can engage,
every size shows the locked sentence, the circle its lock glyph.

### A tap opens the dashboard

`WidgetSnapshot.tapURL` is `com.homeaccount.app://widget`, set once with
`.widgetURL` around the entry view, so every family and every face carries
it, the locked and signed-out ones included. It names no route. Any app may
open a URL in the app's scheme, and this one can only bring up the
dashboard, which the app picks (`widgetRoute()`), behind the same guards as
any navigation. `isTap(_:)` reads the scheme and the host only, without
case, as a URL's are; Google sign-in's redirect, another host under the
scheme, and `https://widget` are not taps.

- **Native.** `WidgetSnapshotPlugin.load()` observes Capacitor's
  `.capacitorOpenURL` notification and also reads
  `ApplicationDelegateProxy.shared.lastURL`, because a tap that started the
  app can arrive before the bridge loads the plugin. It sends `tapped` with
  `retainUntilConsumed`, so a cold start's tap waits for the web layer's
  listener. The event carries `{ source: 'widget' }`, which no listener
  reads: Capacitor's console line for an event prints only the payload, and
  `{}` is what every resolved `write` prints too.
- **Web.** The plugin interface gains `addListener('tapped', …)`, and the
  token's adapter has two methods, still never the proxy
  ([0130](0130-biometry-unlocks-the-app-and-the-pin-is-still-the-credential.md)'s
  hazard). `NotificationTapService.arm()` in the iOS app arms the
  reminders' listener and the widget's side by side. A refused widget
  listener is warned about once and leaves the reminders armed. The
  listener's handle is awaited, never the plugin
  ([0138](0138-a-plugin-call-nothing-implements-is-the-developers-failure-not-the-users.md)).
- **Opening.** The tap takes a reminder's path: `safeAppRoute`, then
  `navigateByUrl` at once when the router has navigated, or after the first
  navigation settles on a cold start. On a locked app `authGuard` sends it
  to `/lock` and remembers `/dashboard`, and the unlock lands there.

### iOS delivers the scheme without registering it

The committed `Info.plist` declares no URL type. A build phase writes
Google sign-in's reversed client id into it at build time, deleting the
whole `CFBundleURLTypes` key first, so a URL type authored beside it would
not survive a build. Registering the widget's scheme would have meant
rewriting that phase, which the only sign-in path depends on, to own a
named entry, and a gate to keep both in place. So a probe came first, on 2026-10-21: a signed
build of this branch on an iPhone 17 simulator with iOS 26.2, with no
`Info.plist` change.

- **Warm**, with the app backgrounded on `/transactions`: the console
  logged `⚡️  TO JS {"source":"widget"}` after the tap, and the page went
  to the dashboard.
- **Cold**, after terminating the app: a cold start lands on the dashboard
  whatever happens, so where it landed proved nothing. A temporary log line
  in the plugin, read through `log stream`, showed the launch URL
  forwarded on the start the tap caused. The line was never committed.

iOS 26.2 delivers the unregistered scheme to the app warm and cold. Nothing
is registered: no URL type, no change to the build phase, no gate. Older
releases are not proved; only the 26.2 runtime was there.

### A tap that races the relock lands where it was going

The relock effect covers the return after the timeout, when nothing is
navigating for `authGuard` to catch: when `isLocked()` turns true, it sends
the app to `/lock` with the page to come back to. That page is now
`relockTarget()`: the
in-flight navigation's target, `router.currentNavigation()?.extractedUrl`
read untracked, serialized with `router.serializeUrl` and passed through
`safeAppRoute`, and `router.url` when nothing is in flight or `safeAppRoute`
refuses the target. The early return for `/lock` and `/login` applies to
the chosen URL. Read untracked, so only a lock transition runs the effect,
never a navigation starting or ending. A widget tap and a reminder tap are
both navigations, so both now come back to their own route after the
unlock.

### The gallery names the app in the device's language

The widget extension carries `en.lproj`, `ja.lproj` and `zh-Hant.lproj`
`Localizable.strings`, each with one entry, `app.title`, whose value is the
catalog's own. `HomeAccountMonthWidget.appName` is that key as a
`LocalizedStringKey`, read by `.configurationDisplayName` and by the face a
placed widget draws before any snapshot exists, which drew the literal
before. iOS picks the table by the device's language. The gallery shows no
description line, so the name is the only word the tables hold. The project
file was edited by hand in
[0019](0019-share-intake-lands-through-a-stash.md)'s way: a
`Localizable.strings` variant group in the widget target's own Resources
phase, a file per language, and `ja` and `zh-Hant` in `knownRegions`.

A sixth `i18n:check` scan holds them
([../i18n.md](../i18n.md#the-widgets-own-strings)). `NATIVE_TABLES` maps
each table to the catalog it mirrors (`en` to en, `ja` to ja, `zh-Hant` to
tc), a strict parser reads each table, and every key must be a catalog
string with the catalog's value. The project file must wire every table.
And the widget's Swift must not show a literal of its own after `Text(`,
`Label(` and the other display heads, with an identifier boundary so
`UILabel(` is not a head. Its self-test grew from 106 cases to 153. A
device in Simplified Chinese has no table and reads the English one, where
the web shows it Traditional Chinese.

### A new currency or language reaches the widget without another paint

The dashboard's effect reads `baseCurrency()` and `translationsVersion()`
tracked, before its guard, so a change of either republishes once the page
has painted this month. The totals stay untracked, so a write to the shared
transactions signal still cannot pass for a paint, and a change to the
account that moves neither keeps quiet: `baseCurrency` is a computed value,
equal across a display-name change. Before the first paint it publishes
nothing.

A republish with no paint keeps the month the figures were summed over.
`monthKey` is the month of that window, the dashboard's painted period,
which the page hands `publish()` as the start of its last this-month paint,
and not the clock at publish; `writtenAt` and the *Updated* label stay on
the clock. A page left open past the month's end still holds last month's
rows, so a new currency, language, budget or hidden card there republishes
them under last month's `monthKey`: a stale file, which the widget shows as
the stale sentence, never last month's figures as this month's. The locked
and signed-out sentences have no window and take the clock's month.

`WidgetSnapshotService`'s locked and signed-out effects call a private
`trackCatalog()` after their guards, never before the plugin check: on the
web the service must not resolve `TranslationService`, and a signed-in,
unlocked session has no sentence to rewrite. A locked cold start composes
its sentence before the account's catalog arrives, and the catalog's
arrival now writes it again. A reload that brings no new word composes an
equal payload, which the per-day dedupe skips.

### A sign-out leaves the widget signed out

`publish()`'s untracked block begins with `if (this.auth.currentUser() ===
null) return;`. The device can end a session while the dashboard stays
open, and the page's next paint then published figures that belonged to
nobody, over the sentence the sign-out effect had written. A cold start
that has not restored its session writes no figures either. The two
startup effects still cannot both decide to write for one boot, which is
what 0133 showed; `publish()` was the writer it had not counted.

### The widget leaves out a card the account hid

The widget follows the account's hidden set, `layout().hidden`, and not
`arrangedCards()`, which also drops Budget Progress for an account with no
active budget and would leave the widget's *No active budgets* unreachable.
`WIDGET_CARDS` (`budgets`, `upcoming`) names the cards the widget draws a
section for.

- **The web.** A hidden card's field is `null` and nothing it would show is
  composed, so no name or amount of it is formatted or written. Its id is
  listed in `figures.hidden`, always written, in `WIDGET_CARDS` order,
  which is what tells a hidden card from one with nothing to show.
- **The dashboard.** The effect reads `layout().hidden` tracked. The layout
  is held while a change saves, so a hide republishes before the write
  lands. A reorder republishes an equal payload, which the dedupe skips: the
  widget keeps its own section order. Upcoming Bills' listener stays open
  only for the card or the weekly recap. With the card hidden and the recap
  on, the listener stays and the service drops the next bill.
- **The widget.** `Card` decodes `budgets` and `upcoming` only, and any
  other id fails the whole decode: the web and the widget ship in one app.
  A file without `hidden`, which builds before this one wrote, hides
  nothing. The medium size draws a section only for a shown card, and the
  month alone when both are hidden. The small size and the Lock Screen
  faces show the month only, so the set changes nothing there.

The snapshot stays at version 1.

## What was rejected

- **Registering the scheme first.** It needed the sign-in build phase
  rewritten and a gate, and the probe showed iOS 26.2 delivers the tap
  without it.
- **A route in the URL.** #441 proposed `widgetURL` to `/dashboard`. A URL
  any app can open should not choose the page; the widget's URL names
  nothing, and the app decides.
- **Following `arrangedCards()`.** It would hide the budget section for an
  account with no budget, so the widget could never say so, and it would
  make the widget follow the order as well.
- **Tracking the totals.** Another write to the shared transactions signal
  would then pass for a paint, which 0133 rejected for the same reason.
- **Changing the base currency on the device.** The simulator app runs on
  the owner's own account. A new base currency re-snapshots every row at
  that day's rates and cannot be put back.
- **Formatting anything natively for the Lock Screen.** The accessory faces
  read the snapshot's strings like the Home Screen sizes; the tables hold
  only the name the gallery needs before a snapshot exists.

## Consequences

- **The specs.** `WidgetSnapshotTests.swift` grew from 11 cases to 27
  (the face, the hidden cards, the tap URL), and `AppTests` from 43 to 59.
  `widget-snapshot.smoke.spec.ts` grew from 3 cases to 7: the sign-out
  under the open dashboard, the new base currency, the new language and the
  hidden cards, each against real rows on the emulator.
  `app-lock.smoke.spec.ts` gained two: a widget tap on the lock screen, and
  a navigation the relock caught in flight.
  `widget-snapshot.service.spec.ts` grew from 21 cases to 33,
  `notification-tap.service.spec.ts` from 14 to 20 and
  `app-lock.service.spec.ts` from 36 to 41, and the publishing describe of
  `dashboard.component.spec.ts` from 8 to 16.
- **A hidden Upcoming Bills card closes its listener in the iOS app too**,
  unless the weekly recap is on.
- **A tap reaches the app the way Google sign-in's redirect does**, through
  Capacitor's open-URL path; `isTap` tells them apart.
- **No rules, storage or backup change.** The snapshot is a device-local
  file, and `figures.hidden` is optional on the native side.
- **The tap's code stays out of the initial bundle**, in
  `NotificationTapService`'s lazy chunk. The relock's `safeAppRoute` import
  is in the eager `AppLockService`.
- **The dashboard spec prints no `NG0101` line.** Its three failed-save
  cases flushed with `TestBed.tick()` from the spec body, which entered the
  zone mid-tick and reported `NG0101`: 36 raw log lines before this work and
  48 once the publishing effect tracked more reads (nine and twelve ERROR
  entries, as [testing.md](../testing.md#the-noise-floor) counts them).
  The cases flush with `fixture.detectChanges()` now, and none of the 48 is
  left ([0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md) noise).

## The device session

On 2026-10-22 an iPhone 17 simulator with iOS 26.2 ran a signed Debug build
of this branch with the production web bundle, signed in to the owner's own
account. Its writes to that account were the app lock, turned on with a
PIN made up for the session and removed after, and the hidden cards, put
back through the editor; each was read back. One more was an accident: a
scroll that began on a drag handle in the dashboard editor moved a card,
and the opposite move undid it at once. The base currency and the relock
timeout were never touched. The record of each step is in
[../widget.md](../widget.md#the-run-on-record).

- **P1.** The small and medium sizes showed the month, net NT$24,450, the
  file's `figures.net`. The Lock Screen offered both accessory sizes: the
  rectangle read *This Month / Net Balance / NT$24,450*, and the circle
  *Net Balance / NT$24,450*, whole.
- **P2.** Taps on the small size from `/settings`, the medium from
  `/transactions` and the rectangle from `/budgets` each logged the `tapped`
  event and landed on `/dashboard`. With the lock on and the app in the
  background past its five minutes, a tap went through `/lock` and the PIN
  to `/dashboard`, three times, with the tap arriving as the app relocked.
  A tap on the terminated app did the same.
- **P3.** The gallery read *Home Account* with the device in English,
  *家計簿* in Japanese and *家庭記帳* in Traditional Chinese.
- **P4.** With the device in Japanese, the account in English and the lock
  on, a cold start wrote the locked sentence twice: first in Japanese, the
  web view's starting language, then in English once the account's catalog
  arrived.
- **P5.** Hiding Budget Progress from its card menu wrote `hidden
  ["budgets"]` with no budget name anywhere in the file, and the medium size
  dropped the section. Hiding Upcoming Bills in the editor changed the file
  only once the dashboard painted, and the medium size showed the month
  alone.

Not driven: redaction under a passcode, which a simulator does not have;
the iOS 16 and 17 paths, compiled only; the currency half of P4; the Lock
Screen's sentences in Japanese or Chinese.

A re-check on the finished branch tapped the small size from
`/transactions` to the dashboard again, and read the Lock Screen's locked
sentence from a locked snapshot written into the container file by hand in
each language. The Japanese one, the longest, was cut after two lines. The
rectangle now gives a sentence three lines and lets it scale down to 0.8,
and it reads whole; the English and Traditional Chinese ones read whole on
two lines. The signed-out and stale sentences, no longer than the locked
one in any of the three languages, were not placed.

## Departures from the issue

- **P2's URL names no route** (see *What was rejected*). The tap still
  lands on `/dashboard`.
- **P4's currency half is proved by specs, not on the simulator.** Unit
  cases and an emulator smoke assert the write; the device proved the
  language half, on a locked cold start.
- **P4 reaches further.** The issue asked for the dashboard's effect; the
  locked and signed-out sentences now follow a late catalog too, and
  `publish()` writes nothing with nobody signed in.
- **P5 follows the hidden set, not `arrangedCards()`.** `docs/widget.md`
  states it: the widget leaves out a card the account hid, and keeps its own
  section order.

## Departures from the plan

- **The registration branch was not taken**, since the probe showed
  delivery.
- **The cold half of the probe read a native log line**, not Capacitor's
  `⚡️  TO JS` line: Capacitor logs to standard output, which a launch from
  SpringBoard discards.
- **The typecheck of the 15.6 floor needs `-application-extension`.**
  Without it, `swiftc -typecheck` does not count an
  `#available(iOSApplicationExtension …)` guard, and reports the iOS 17
  container background as unavailable in code that is guarded.
- **The fallback for P4's language was not needed.** The account's language
  would have been changed if the web view had ignored the device's; it did
  not.

## Things that only became apparent while building

- **WKWebView's `navigator.language` follows the device's language**, so a
  locked cold start's first sentence is in the device's language until the
  account's catalog arrives.
- **A screen lock fires no `visibilitychange`.** With the app in front,
  locking the device logs `isSuspendedUnderLock` in WebKit and fires
  nothing, and neither does the return from the Lock Screen. The relock
  clock therefore never counts the time a phone spends locked, and the app
  can come back unlocked after a long screen lock. It is older than this
  record and is not fixed here
  ([../app-lock.md](../app-lock.md#known-gaps)).
- **The gallery lists the app as *HomeAccount*.** The app row is the app's
  own display name in `Info.plist`, English on every device; the widget's
  name under it is the table's.
- **On iOS 26 a Lock Screen widget is added from the Lock Screen's own
  editor**: long-press, *Customize*, *Lock Screen*, then the widget row
  under the clock.
- **A first tap on a terminated app sometimes only started the process** on
  the simulator, without bringing the app forward; a second tap opened it.

## Known gaps

- **Simplified Chinese reads English.** A `zh-Hans` device has no table
  and gets *Home Account*, where the web shows it Traditional Chinese.
- **No `.accessoryInline`.** The one-line slot above the clock is not
  offered.
- **A change made away from the dashboard waits for its next paint.** With
  the lock off, a base currency, a language or a hidden card changed in
  Settings reaches the widget only when the dashboard next paints this
  month. With the lock on, the locked sentence follows a new language at
  once.
- **A rate refresh alone does not republish.** A row whose stored
  conversion cannot answer for the base currency is converted at the
  current rate, and the totals are read untracked, so new rates reach the
  widget with the next paint.
- **A pending share can take over a tap.** When the app opens with a shared
  file waiting, the share intake's navigation to the import wizard and the
  tap's to the dashboard race, and the later one supersedes the other. Not
  driven.
- **Redaction is not proved.** The `.privacySensitive()` figures are
  redacted on a locked device with a passcode, and the simulator has none,
  so the redaction was never seen.
- **The iOS 16 and 17 paths are compiled, not run.** The Lock Screen
  families on 16 and the accessory background on 17 were type-checked at
  15.6, 16.0 and 17.0; the only runtime the widget ran on was 26.2.
- **Older iOS may not deliver the tap.** Delivery of the unregistered
  scheme is proved on 26.2 only.
- **The rectangle's room was read on one phone, at the default text
  size.** On the iPhone 17 the Japanese locked sentence fits two lines
  only by scaling down, so a narrower phone or a larger text size may still
  cut it; neither was read.

The Simplified Chinese table, with the app's own English name and
permission prompts, is a follow-up for the owner, #504, and the screen lock
that the relock clock never counts is another, #503.
