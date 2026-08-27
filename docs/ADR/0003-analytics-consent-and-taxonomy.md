# 3. Opt-in analytics: consent gate and event taxonomy

**Status:** Accepted, implemented · **Date:** 2026-07-27 · **Issues:** #110, #111, #112, #113, #114

> The consent model below — opt-in for everyone, defaulting to off — was
> superseded the same day by [0004](0004-tier-gated-analytics.md), which makes
> collection part of the free tier. Everything else here still holds: the lazy
> initialisation, the enumerated taxonomy, the tagging placement and the CI
> check are unchanged.

Reference documentation lives in [../analytics.md](../analytics.md). This record
keeps the decisions and the reasoning, including two places where the
implementation could not do what the issues asked.

## Context

The app had no usage data at all, so every roadmap argument was a guess about
which features people use. GA4 through Firebase is the obvious answer — the
project is already on Firebase and the measurement id was already in the
environment config.

The complication is what the app is. It is a personal-finance app whose entire
value proposition is that the numbers in it are yours. Analytics in that
setting is not a neutral addition: it is the thing most likely to make someone
stop trusting the app, and one leaked merchant name would be worse than never
having had the data. So the interesting question was never "how do we send
events" but "how do we make it structurally impossible to send the wrong ones".

## Decision

### Consent is the absence of initialisation, not a filter

Collection is off until the account turns it on, and "off" means the SDK was
never created: no gtag script, no cookie, no request.

The obvious alternative — initialise at boot and call
`setAnalyticsCollectionEnabled(false)` — does not actually work. Creating the
instance injects the tag, issues the gtag `config` command, opens a
dynamic-config request and writes an installation id, and
`setAnalyticsCollectionEnabled` only sets `window['ga-disable-…']` afterwards.
By then the first hit has gone. The acceptance criterion in #113 is "no
analytics network traffic", not "suppressed traffic", and only lazy creation
satisfies it.

`provideAnalytics` runs its factory on first injection of the `Analytics`
token, and the only thing that injects it is the transport, which waits for the
stored preference. So the gate is a property of the wiring rather than a check
someone has to remember to write.

### Consent lives on the user document, not the device

*(Superseded in part by [0004](0004-tier-gated-analytics.md): the storage
location and absent-means-off still hold, but the preference is now read only
for premium accounts.)*

It is `enableUsageAnalytics` in the Firestore preferences map, absent by
default, read through an accessor that treats absent as off — the same shape as
the app-lock preference.

Device-local storage was the alternative, and it has one real advantage: it is
readable before auth resolves, so the login screen could report. That is not
worth much, and account-wide consent means answering the question once rather
than once per device. Absent-means-off makes the pre-auth window silent by
construction rather than by timing, so the thing device-local storage would
have bought is not needed.

### Every parameter value is enumerated

The taxonomy is JSON. Each event declares its parameters, and each parameter
declares the complete list of values it may take. `AnalyticsService` drops any
event carrying an unknown parameter or an unlisted value.

This is the privacy boundary. Types vanish at runtime and call sites build
payloads from signals and conditionals, so the compiler is not the guarantee —
the runtime allowlist is. A parameter whose values cannot be listed in advance
is exactly how free text escapes, so the rule is that such a parameter does not
belong in analytics at all.

Events are dropped whole rather than trimmed. A value nobody enumerated
suggests the call site is passing something derived from user data, and sending
the event without the offending parameter would hide that. The warning that
records the drop deliberately does not include the value, for the same reason
the value is not sent.

### One JSON file feeds three consumers

The taxonomy is JSON rather than TypeScript so the compiler, the runtime
validator and the CI registry check can all read the same source. A `.ts`
source would have forced the Node script to regex-parse TypeScript, which
breaks on a formatting change; JSON.parse does not.

### Tag intent, not chokepoints

Every transaction write passes through `TransactionService.addTransaction`,
which makes it the obvious tagging point and the wrong one. Backup restore
loops it over every row of a file, and the offline queue replays rows already
counted when they were queued — so the single chokepoint would report thousands
of events for one user action and none of them for an entry decision.

The same reasoning kept `ai_assist_used` out of `AIStrategyService`, which
several paths converge on but which the offline processor also drives, and
which the import wizard bypasses entirely.

Each event is therefore placed past whatever guard could have avoided the work:
after the availability check in smart search, past the caches in the summary
and narrative. The events measure what happened, not what was attempted.

### A CI check rather than a convention

`docs/analytics.md` carries a row per tagging point, and
`scripts/check-analytics-registry.mjs` fails the build when the table, the
taxonomy and the call sites disagree — in both directions, so a deleted call
site fails as loudly as an undocumented one.

A PR-checklist item was the alternative. In a single-maintainer repo a
checklist is a note to oneself; the check is followed because it is mechanical.
It was verified against all five failure modes rather than only its happy path.

An ESLint rule bans the analytics SDKs outside the service. It closes the one
hole neither the compiler nor the grep can see: a direct `logEvent()` in a
component would bypass the consent gate, the no-op paths and the allowlist at
once, and nothing else would notice.

## Departures from the issues

### `ScreenTrackingService` could not be used (#111 names it)

`@angular/fire@20` declares `ComponentFactoryResolver` as a non-optional
dependency of that service, and Angular 22 removed the symbol — injecting it
throws. `@angular/fire` 21 exists only as a release candidate.

Screen views therefore come from a router subscription in `AnalyticsService`
that reproduces the library's `screen_name` derivation from route paths. Paths
rather than component names is not merely a workaround: they survive
minification and form a closed set the registry can enumerate and verify
against `app.routes.ts`.

It differs deliberately on `screen_class`. The library reads the *top-level*
activated route, which in this app is always `MainLayoutComponent`, so it would
report `app-main-layout` for eight distinct pages. Reading the deepest route
makes the field carry something.

### The deferred outcome of a queued import is not reported

An import queued while offline reports `queued_offline`, and nothing more. When
the queue processor eventually succeeds or fails, firing again would put two
events on one import and corrupt the denominator of the reliability figure the
event exists to produce.

The alternative was a distinct pair of deferred outcome values, which would
have been better data at the cost of a taxonomy wider than the issue described.
The gap is documented instead.

## Things that only became apparent while building

**iOS collects before consent can be read.** The authentication plugin calls
`FirebaseApp.configure()` at launch, so once an analytics-enabled plist is
installed the measurement SDK emits `first_open` and `session_start` before
Angular boots — long before the Firestore preference is readable. The opt-in
would have been decorative on a fresh install. `Info.plist` now ships
`FIREBASE_ANALYTICS_COLLECTION_ENABLED = NO`, with the runtime enabling
collection only after consent resolves. Use `_ENABLED` and never
`_DEACTIVATED`: deactivation is permanent for the install and cannot be undone
by the API.

**gtag attaches the full URL to every hit by itself**, query string included —
a channel no parameter allowlist covers. `page_location` is overwritten with
origin and path. The matching invariant, which no code can enforce, is that no
route or query parameter may ever carry user-entered text.

**A withdrawal issued while an enable was in flight could lose the race.** The
enable suspends on real work, and the disable would complete first and then be
overwritten, leaving collection running against a preference that said
otherwise. Consent operations are now serialised, with a generation counter so
a superseded enable does not start screen tracking on its way past. The spec
that found this drives the fake transport into the suspended state deliberately.

**A hard `AuthService` dependency turns unrelated specs red.** Any component
that tags something constructs `AnalyticsService`, and component specs across
the app stub `AuthService` with only the members they themselves need. Both
consent signals are read through optional calls; an absent signal reads as
signed out, which is off.

**Automatic iOS screen reporting would fight the router.** A Capacitor app is
one view controller, so it would emit a single screen for the whole app and
split the Screens report. `FirebaseAutomaticScreenReportingEnabled` is `NO`.

## Known gaps

- **The initial bundle is over its warning budget**, and this work made it
  worse: the baseline was already ~35 kB past the 3.25 MB warning and analytics
  adds ~23 kB. Builds still succeed — the error threshold is 4 MB. Moving
  `@angular/fire/analytics` to a dynamic import inside the transport would
  recover it, at the cost of the app-shell provider seam #111 asked for. The
  overage predates this work and deserves its own issue.
- **Web drops events fired while offline** — gtag has no queue — while the iOS
  SDK persists and uploads them later. Offline sessions are undercounted on web
  and the two streams are not directly comparable for that.
- **Turning consent off mid-session stops further hits, but the loaded tag and
  the `_ga` cookie remain** until the page is reloaded.
- **Two accounts on one device share an app-instance id** (and a `_ga` cookie
  on web), and the native enabled flag persists in `NSUserDefaults` across
  accounts. This is one more reason `setUserId` stays off.
- **No first-run consent prompt.** #113 asked for one, to be carried by the
  onboarding flow in #83. #83 has since shipped, deliberately without a consent
  step: ADR 0004 made collection follow the tier — always on for free accounts,
  opt-out for premium — so a first-run ask would misrepresent a choice the free
  tier does not have. ADR 0072 records that decision. The setting stays
  discoverable in Settings, which costs opt-in rate but no privacy.
- **CI has no iOS job**, so every native change here is verified only by a
  local `npm run build:ios` and an Xcode run.
- **App Store privacy labels are outstanding** — tracked in #127.
