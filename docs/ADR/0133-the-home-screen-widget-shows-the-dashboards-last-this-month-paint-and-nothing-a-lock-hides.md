# 133. The home-screen widget shows the dashboard's last this-month paint, and nothing a lock hides

**Status:** Accepted, implemented · **Date:** 2026-09-16 · **Issues:** #85

Reference documentation lives in [../widget.md](../widget.md).

## Context

Everything the dashboard already knows — this month's spend, this month's
net, the budget nearest its limit, the next scheduled bill — sits behind an
open app and a signed-in session. #85 asked for a glance at it from the home
screen, on a platform (WidgetKit) that runs the reader in a **separate
process**, on its own schedule, with no route into the rest of the app and no
access to Firestore, the account's session, or the app's own translation
catalogs.

Two things this app already has make that harder than "read the same data
twice":

**The app lock exists to keep exactly these figures off a screen someone
else can see.** A widget on the home screen is more exposed than the app
behind a PIN — it is visible without unlocking anything — so whatever writes
its file has to know the lock's state as surely as the lock screen does.

**Every figure on the dashboard is already formatted once**, in the
account's language, with its own currency rules and date styles. A widget
extension has none of that: no `TranslationService`, no `CurrencyService`, no
account document. Building a second, native copy of currency and locale
formatting for one small screen is the kind of duplication that drifts the
first time either implementation changes.

## Decision

**The web layer composes every string once, in the account's language, and
writes it into an App Group file the widget only ever reads. The widget has
no data source of its own.**

### No data source of its own, and why the paint counter drives it

`WidgetSnapshotService.publish()` is called from exactly one place: a
`DashboardComponent` constructor effect, with exactly the figures that
effect already has on hand — `totalExpenses()`, `balance()`,
`activeBudgets()`, `upcomingOccurrences()`. The widget never queries
anything; it is handed whatever the dashboard already painted.

The effect is keyed on a **paint counter**
(`thisMonthPaints`), not on the shared `transactions` signal those totals are
folded from. The signal is written by other code on the page for reasons
that have nothing to do with a new month closing — a period toggle,
`publishedPeriodOption` — and gating on it directly would republish the
widget on every incidental read. The counter increments exactly once per
successful `getByDateRange` load whose selected period is `'thisMonth'`, so
switching to last month, or any other page activity, publishes nothing.

### Startup arming, so a cold start that never paints still tells the truth

`WidgetSnapshotService` is constructed from a `provideAppInitializer`, before
the first guarded navigation — the same startup slot `AppLockService` and
`AnalyticsService` occupy. Two effects run from its constructor and need no
dashboard paint at all: one writes the `locked` state whenever
`AppLockService.canEngage()` is true, the other writes `signedOut` whenever
auth has finished loading with no user. Both matter for the same reason: a
cold start that lands on `/lock` never renders `DashboardComponent`, so
without this, a home screen showing last session's real figures would stand
next to a PIN prompt on the very screen those figures are supposed to be
behind.

`isLoading()` guards the sign-out effect specifically: at boot, before the
session is restored, `currentUser()` is briefly `null` the same way it is
after a real sign-out, and writing `signedOut` in that window would blank an
account that is, in fact, still signed in.

### `canEngage()`, not `isLocked()` — set up, never the same as locked right now

Both the constructor's locked effect and `publish()`'s own branch read
`AppLockService.canEngage()` (`isEnabled() && method() !== 'none'`), not
`isLocked()`. That is deliberate, and it is worth being exact about: a widget
process cannot observe the in-memory `unlockedAt()` timestamp `isLocked()`
depends on — that state lives only inside the running app, and the widget
reads a file. `canEngage()` answers a question the file *can* answer: does
this device have a lock configured at all. The consequence is that **while
the app lock is turned on, the widget never shows figures again — unlocking
the app does not bring them back, only turning the lock off does.** The
dashboard's own next paint after an unlock still calls `publish()`, and
`publish()` still asks `canEngage()`, which is still true, so it still writes
`locked`. This is not a bug in the publish path; it is the only question the
file format has room to ask.

### Every string, on the web, in the account's language

`compose()` builds the label set through `TranslationService.t()` and
`LocaleFormatService.formatDate()` — the same catalogs and formatters the
dashboard paints with — and `figures()` runs every amount through
`CurrencyService.formatCurrency()`. `WidgetSnapshot.swift`'s own header
comment states the alternative and why it was rejected: formatting on the
Swift side would need a second copy of the translations and the currency
rules, and would drift from the app the first time either changed. The one
thing decided on the native side is whether the figures can still be vouched
for at all — see below.

### The stale month, decided where the clock actually is

`monthKey` travels as the web's local `YYYY-MM`. `WidgetSnapshot.display(now:
calendar:)` compares it against **a Gregorian calendar built inside the
method itself**, in the caller's time zone but never the caller's calendar
system — a device set to the Republic of China or Buddhist calendar must
still compare a Gregorian key against a Gregorian year and month, or every
such device reads every month as either always-stale or never-stale. When
the widget's own clock has moved into a month after `monthKey`, the figures
give way to the `stale` sentence rather than silently showing last month's
numbers under "This Month."

**The timeline carries two entries, not one — a departure from the original
plan, made mid-build.** The plan's own text said one entry, reasoning that
the app's own `write()` call reloads the widget's timelines on every publish
and the month only turns over once. Review found the gap the plan missed:
WidgetKit's *own* scheduled reload (`policy: .after(reloadAt)`) is a request,
not a promise, and iOS is free to run it late under system budget pressure —
which means a single entry dated "now" would keep evaluating `display(now:
calendar:)` against last month's `monthKey` for however long the system
delays that reload, showing stale figures as fresh ones on the one day this
matters most. The user chose a second entry, dated exactly at the month
boundary (`WidgetSnapshot.timelineDates`), over the plan's one: the boundary
entry's own `display` call turns itself stale the instant the calendar
reaches it, independent of whether the system's reload runs on time or not.
`reloadAt` is still the same boundary, so the app's own reload and the
timeline's self-correcting entry aim at the same moment for two different
reasons — one is a request, the other cannot be late.

### The locked and signed-out writes race nothing, because `canEngage()` gates both

`AppLockService.canEngage()` is false whenever the user is `null`, so the
locked-write effect and the signed-out-write effect can never both decide to
write for the same boot: signing out always wins the branch, and being
signed in is a precondition for the lock even being checkable. Neither
effect's write competes with `publish()`'s own — all three funnel through
the same `writeIfChanged()`.

### The per-day dedupe

`writeIfChanged()` compares the new payload against `lastWritten`, both with
`writtenAt` stripped, and skips the plugin call — and the `WidgetKit`
timeline reload it would trigger — when nothing else differs. That would
make an identical repeat of the same figures permanently silent, except that
`updated` is `widget.updated` formatted with **today's date**: a payload that
is otherwise identical to yesterday's still differs by that one field, so a
new day always writes at least once, and an account that opens the dashboard
five times in one afternoon writes once.

### The token is the platform gate, and the two rejection codes name different failures

`WIDGET_SNAPSHOT_PLUGIN` is `null` on the web — `Capacitor.isNativePlatform()`
decides at injection, once — so every write in this service composes and
calls nothing on a browser, and a spec provides a fake without touching
`Capacitor` at all. On a device the factory hands out a **plain two-method
adapter**, never the `registerPlugin` proxy: Angular's injector probes every
provided value for `typeof value.ngOnDestroy === 'function'` at teardown, and
the proxy answers every name with a callable plugin-method wrapper — the
exact hazard `BIOMETRIC_AUTH_PLUGIN` (ADR 0130) already exists to avoid.

The plugin's own `write()` rejects with one of two codes, and they are not
interchangeable: **`'invalid'`** is a payload `WidgetSnapshot.decode()`
refused before anything touched disk — a bug in the web writer.
**`'unavailable'`** is everything after that: no App Group container, or the
atomic file write itself failing (a full disk). A validated payload that
fails to write is not the web layer's bug, and the underlying `Error` rides
along on that rejection rather than being dropped, so a bad payload and a
bad device are never read as the same thing on either side of the bridge.
`writeIfChanged()` treats both alike — swallowed, no retry, no console line —
because the widget already keeps the last file it could read either way.

### The target anatomy, reused rather than invented

`HomeAccountWidget` — the WidgetKit extension target — was built to the same
settings the Share Extension target already used: the same signing and
Info.plist shape, differing only in entitlements, Info.plist contents and
bundle id, the same pbxproj hand-edit method
([ADR 0019](0019-share-intake-lands-through-a-stash.md)) established for a
Share Extension nobody had generated with Xcode's own target wizard either.

`WidgetSnapshot.swift` itself compiles into three places — the app, the
widget extension, and the `AppTests` logic bundle — the same reason
`BiometricOutcome.swift` does (ADR 0130, following ADR 0040): pure
Foundation/Codable, no
Capacitor import, so nothing stops a plain `XCTest` target from linking it
and pinning the decode, the write, and the month rule directly, without a
bridge or a running extension in the loop.

### Which simulator build worked, and what it did and did not prove

An **unsigned** `CODE_SIGNING_ALLOWED=NO` build — otherwise the default for
a fast simulator iteration — embeds **no entitlements at all**,
App Group included, so `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`
returns `nil` on that build and the plugin rejects every write
`'unavailable'`. A **locally signed** build ("Sign to Run Locally," no
`CODE_SIGNING_ALLOWED` override) does carry the entitlement, but
`codesign -d --entitlements -` **still prints nothing for either build** —
recent Xcode embeds a simulator's entitlements in a Mach-O `__entitlements`
section that tool does not read for a simulator target at all. The decisive
check is `otool -l` (or reading the generated `*-Simulated.xcent` file)
against the running binary, not `codesign`, and the App Group container's
actual presence on the device (`xcrun simctl get_app_container <udid>
com.homeaccount.app groups`) settles it either way.

On the locally signed build: the container appeared, `widget-snapshot.json`
was written on the dashboard's first paint, and every field in it —
`figures.spent`, `figures.net`, `topBudget.name`/`.percent`/`.detail`,
`nextScheduled` — matched the running app's own screens, cross-checked
against the Budgets tab for the tie-break rule (a 0%-utilised budget still
ranks first when nothing else has spent anything). The lock cycle was driven
end to end: setting a PIN and turning the lock on rewrote the file to
`locked` with no figures immediately, without a relaunch; a cold start to
`/lock` still read `locked`; unlocking repainted the dashboard but the file
stayed `locked` until *Remove PIN* turned the account preference back off,
at which point the next paint restored the figures. What it does not prove
is anything about a real device, a real Secure Enclave, or the operating
system's own reload budget under real memory pressure — see Known gaps.

## What was rejected

- **Reading `transactions()` directly to trigger a publish.** Other code on
  the page can write that signal for reasons unrelated to a new month's
  figures being ready; gating on it would publish on every such write.
- **Formatting currency, dates or labels natively.** Rejected for the reason
  `WidgetSnapshot.swift`'s own header gives: a second copy of the app's
  translation and currency logic would drift from the first the moment
  either changed, and the widget would need to know the account's language
  to boot.
- **Providing the raw `registerPlugin` proxy behind the token.** The same
  `ngOnDestroy` hazard ADR 0130 already found and fixed for
  `BIOMETRIC_AUTH_PLUGIN`.
- **One timeline entry, as originally planned.** Correct only if WidgetKit's
  own scheduled reload always runs exactly on time, which it is not
  contracted to do.
- **Treating every `write()` rejection alike.** A bad payload and an
  unwritable device are different problems on two different sides of the
  bridge; collapsing them would have hidden which one to fix.

## Consequences

- **`widget-snapshot.service.spec.ts` is new, 19 cases** — the compose and
  publish logic, the per-day dedupe, the locked/signed-out effects. Nine new
  keys joined the `widget.*` namespace across all three catalogs (`spent`,
  `topBudget`, `nextScheduled`, `noBudgets`, `locked`, `signedOut`, `stale`,
  `updated`, `budgetDetail`) — `title`, `net` and `nothingScheduled` reuse
  `dashboard.thisMonth`, `common.netBalance` and `dashboard.noUpcomingBills`,
  already in every catalog — and the catalog's own `translation-keys.spec.ts`
  (11 cases, untouched by this branch) stayed green against them, as did
  `app.config.spec.ts` (10 cases, unrelated Firestore-cache factory
  coverage, also untouched) once `app.config.ts` itself gained the new
  initializer.
- **`dashboard.component.spec.ts` gained 7 cases** for the publish effect —
  the paint-counter gate, the period guard, the literal published figures —
  on top of 0132's 13 in the same file (72 total).
- **`widget-snapshot.smoke.spec.ts` is new, 3 cases alone** (5 combined with
  `dashboard-layout.smoke.spec.ts`), proving the figures, the lock and the
  sign-out writes against real rows under the deployed rules.
- **`AppTests` grew from 32 to 43** — 11 new cases on `WidgetSnapshot.swift`
  covering the decoder's rejections, the month rule under a non-Gregorian
  device calendar, and the two-entry timeline's boundary arithmetic across a
  December and a Taipei UTC+8 boundary.
- **No `firestore.rules`, `storage.rules` or backup-format change.** The
  whole feature is a device-local file the app writes and a widget extension
  reads; nothing here is a stored record.
- **`MainViewController` now registers five plugins**, one more than ADR
  0130 counted.

## Departures from the issues

- **The timeline's second entry**, recorded above as a decision rather than
  a gap: #85 did not ask for it, and the plan's own text said one entry was
  enough. It was not.

## Things that only became apparent while building

- **A codesign reading of "no entitlements" is not proof.** The first signed
  build looked identical to the unsigned one under `codesign
  -d --entitlements -`, and only checking the actual container on the
  device (rather than trusting that command) told the two apart. Anyone
  repeating this on a later Xcode should check the binary or the device, not
  the tool that used to be reliable for it.
- **Testing this feature on the simulator, at an unrelated accessibility
  setting, turned up a pre-existing UI defect fixed in the same branch**:
  `9933bfd fix(ui): the theme toggle keeps every label whole at a large font
  scale`, found on Settings → Preferences at the account's Extra Large font
  scale while working through the lock cycle above. It touches
  `features/settings/profile-settings/`, not this feature's own surfaces,
  and is recorded here only because a UI defect met while testing is fixed
  in the same branch rather than filed. Its fix is a container
  query, which needs iOS 16 (Safari 16); this app's deployment target is
  15.6, so on iOS 15 those labels still clip — the same trade the house
  already made for the category suggestion chip.
- **A bare "Error" snackbar appeared once on a cold start to `/lock`,
  unrelated to this feature.** Investigated and ruled out as this branch's
  own doing — `WidgetSnapshotService.writeIfChanged()` is
  `.catch()`-guarded end to end, and the token never hands out the raw
  proxy that could throw past a catch. The top candidate is a pre-existing,
  unguarded `addListener` call in `share-intake.service.ts`, unchanged since
  before this branch; adding a sixth boot-time native call (this feature's
  own `write()`) may simply have shifted the native bridge's message
  interleaving enough to make an existing race visible for the first time.
  Recorded as issue draft D3, not fixed here: confirming it needs a Safari
  Web Inspector attached by hand, which is not something this record can do
  blind.

## Known gaps

- **No Lock Screen family.** `.supportedFamilies([.systemSmall,
  .systemMedium])` only; nothing here is an `.accessoryRectangular` or
  `.accessoryCircular` widget.
- **Figures are only as fresh as the last this-month paint.** With no data
  source of its own, an account that never opens the dashboard this month
  sees last month's figures — or, once the month turns, the stale sentence
  — until it does.
- **No deep link.** Tapping the widget opens the app at whatever route it
  would otherwise land on; nothing sets `.widgetURL` to send the tap
  straight to the dashboard.
- **The gallery name is English.** `.configurationDisplayName("Home
  Account")` is a literal, not a catalog key — the widget gallery's own
  name for this widget does not follow the account's language, unlike
  everything the widget itself displays.
- **No real-device run is recorded here.** Everything above was proved on an
  iPhone 17 simulator; nothing here exercises a real Secure Enclave, a real
  App Group on a physical device, or WidgetKit's actual reload budget under
  real system memory pressure.
