# Analytics (GA4)

The app reports anonymous usage statistics to a Google Analytics 4 property so
there is some evidence behind decisions about what to build next: which screens
people actually open, which of the three ways to add a transaction they use,
whether the reports get looked at, and whether the AI features are worth their
maintenance and token cost.

It is not used for per-user reporting, advertising, remarketing or audience
building, and there is no way to identify an individual account from what is
sent.

The reasoning behind how this is built — and what was rejected — is in
[ADR/0003](ADR/0003-analytics-consent-and-taxonomy.md).

## Consent

Usage statistics are **part of the free plan and always on there**. Turning them
off is a premium entitlement.

| Tier | Collection | The setting |
|---|---|---|
| Free (no subscription record) | Always on | Shown on, disabled, with the reason |
| Premium | The stored preference, absent meaning off | Interactive |
| Signed out | Never | Not reachable |

`enableUsageAnalytics` on the Firestore user document holds the premium choice.
On the free tier it is **not read at all**, so a `false` left behind by a lapsed
premium account does not disable collection. Signed out is off regardless: no
account means nothing to attribute to a tier, which is what keeps the app silent
between start-up and the user document arriving.

Changing tier or preference takes effect immediately; there is no reload. The
setting and `AnalyticsService` read the same signal, so the control cannot
disagree with what is actually happening.

**Regional caveat, unresolved.** Analytics storage needs freely-given consent
under GDPR and ePrivacy. Collection that is a condition of the free plan is the
"consent or pay" model, which the EDPB accepts only where the paid alternative
genuinely exists and is reasonably priced. Premium is not implemented yet, so
today there is no alternative to point an EU or UK user at. Making the free tier
opt-in for those regions — or shipping premium — is what closes this, and until
one of them happens the exposure is real. See
[ADR/0004](ADR/0004-tier-gated-analytics.md).

## Privacy: what leaves the device

Nothing is sent while collection is off — a signed-out session, or a premium
account that has not opted in. In that state the SDK is never initialised: no
gtag script, no cookie, no request to `google-analytics.com`. Not a suppressed
request — no request. That is why the SDK is created lazily rather than created
and then disabled; disabling afterwards would already have loaded the tag and
sent a page view.

On the free tier collection begins as soon as the user document resolves.

What is sent: the event name, the parameter names in the registry below, and
for each of those parameters one value from the fixed list declared beside it
in [`analytics-events.json`](../src/app/core/config/analytics-events.json).
`AnalyticsService` drops any event carrying a parameter it does not recognise
or a value outside the list, rather than trimming and sending the rest, so a
call site cannot widen the payload by accident. Screen views additionally carry
the route path (`transactions`, `import/file`) and a constant page title.

**Never sent**: amounts, currencies, merchant or payee names, category names,
budget names, descriptions, notes, tag names, place names, coordinates, dates,
transaction or budget ids,
filenames, receipt images, search text, AI prompts or AI output, email
addresses, display names, or the Firebase user id. There is no `setUserId`
call and no `UserTrackingService`. Google signals and ads personalisation are
off on the property and denied again in the tag's consent defaults.

`page_location` is overwritten with the origin and path only. gtag attaches the
full URL to every hit on its own, and that is a channel no parameter allowlist
covers — so the matching invariant is: **no route or query parameter may ever
carry user-entered text**.

Counts are the point; contents are not. `transaction_add` says an expense was
added by receipt scan. It cannot say what was bought, for how much, or where.

## Event registry

Every place the app reports an event. `Since` is the release the row shipped
in. `scripts/check-analytics-registry.mjs` fails the build when this table and
the code disagree. `Since` covers the event, not its parameters —
`transaction_add`'s `has_tags`, `has_location` and `receipt_image_count`
arrived in 1.18.95.

<!-- analytics-registry:start -->
| Event | Trigger | Params | Source | Since |
|---|---|---|---|---|
| `transaction_add` | The add-transaction form saved a new transaction. Not restore or offline replay. | `method`, `type`, `has_tags`, `has_location`, `receipt_image_count` | `src/app/features/transactions/transaction-form/transaction-form.component.ts` | 1.16.91 |
| `transaction_search` | A search was committed on the transaction list and recorded as new. | `has_filters` | `src/app/features/transactions/transaction-filters/transaction-filters.component.ts` | 1.16.91 |
| `receipt_import` | A receipt import reached a terminal outcome. Images only. | `outcome` | `src/app/features/transactions/camera-capture/camera-capture.component.ts`, `src/app/features/ai/import/import-wizard/import-wizard.component.ts` | 1.16.91 |
| `budget_create` | A budget was created from the budgets page. | — | `src/app/features/budgets/budget-form/budget-form.component.ts` | 1.16.91 |
| `budget_exceeded_viewed` | The dashboard budget-alert banner became visible, once per appearance. | `severity` | `src/app/features/dashboard/budget-alert-banner/budget-alert-banner.component.ts` | 1.16.91 |
| `report_view` | A report tab was shown, including the one the page opens on. | `report_type` | `src/app/features/reports/reports.component.ts` | 1.16.91 |
| `ai_assist_used` | An AI feature issued a real provider request (cache hits and local fallbacks excluded). | `feature` | `src/app/core/services/ai-import.service.ts`, `src/app/core/services/nl-search.service.ts`, `src/app/features/transactions/transaction-form/transaction-form.component.ts`, `src/app/features/dashboard/ai-summary/ai-summary.component.ts`, `src/app/features/reports/insights/insight-narrative/insight-narrative.component.ts` | 1.16.91 |
| `settings_change` | A tracked preference was saved from profile settings. | `setting` | `src/app/features/settings/profile-settings/profile-settings.component.ts` | 1.16.91 |
<!-- analytics-registry:end -->

### Parameter values

| Parameter | Values |
|---|---|
| `method` | `manual`, `receipt_scan`, `ai_import` |
| `type` | `income`, `expense`, `mixed` |
| `has_tags` | `true`, `false` — whether any tag was attached; the tag names themselves are never sent |
| `has_location` | `true`, `false` — whether a location was attached; the place name and coordinates are never sent |
| `receipt_image_count` | `0`–`5` — images attached at creation; later appends and removals are not re-reported |
| `has_filters` | `true`, `false` — any of type, category, currency, amount range, or a date range other than the default month |
| `outcome` | `ok`, `failed`, `queued_offline` |
| `severity` | `warning`, `critical`, `exceeded` |
| `report_type` | `spending_analysis`, `category_breakdown`, `monthly_comparison`, `insights`, `forecast` |
| `feature` | `receipt_scan`, `categorization`, `pdf_import`, `search`, `summary`, `narrative` |
| `setting` | `theme`, `language`, `currency` |

### What is deliberately not tagged

- **Backup restore and offline replay.** Both create transactions through the
  same service the form uses. Tagging there would emit one event per row of a
  restored file and re-count queued rows that were already counted when they
  were queued.
- **The deferred outcome of a queued import.** `queued_offline` is terminal for
  the attempt. Reporting again when the queue processor eventually succeeds or
  fails would put two events on one import and corrupt the denominator of the
  reliability figure.
- **CSV, PDF and JSON imports**, as `receipt_import`. They go through the same
  wizard method, but a bank statement is not a receipt.
- **Date format, display name, and the AI settings page.** The taxonomy
  enumerates the settings worth steering by; widening it to every control is
  how a taxonomy stops meaning anything.
- **The consent toggle itself.**

## Automatic screen views

`screen_view` is reported from the router on every navigation, on both
platforms, using the same derivation so the two data streams describe a visit
the same way. `screen_name` is the route path chain — paths rather than
component names, because paths survive minification and are a closed set this
table can enumerate.

<!-- analytics-screens:start -->
| Route | `screen_name` | Reached by |
|---|---|---|
| `login` | `login` | signed out |
| `lock` | `lock` | app lock |
| `dashboard` | `dashboard` | default landing |
| `transactions` | `transactions` | nav |
| `budgets` | `budgets` | nav |
| `reports` | `reports` | nav |
| `settings` | `settings` | nav |
| `ai` | `ai` | settings |
| `about` | `about` | sidebar |
| `search-history` | `search-history` | smart-search dialog |
| `import/file` | `import/file` | import wizard |
| `import/history` | `import/history` | import history |
<!-- analytics-screens:end -->

Notes:

- **Redirects never report.** The four `redirectTo` routes and the wildcard
  never activate; their destination reports instead. The layout route's empty
  path drops out of the name.
- **Query parameters do not make a distinct screen.** `/transactions?showAll=`,
  `?date=` and `?action=add` all report `transactions`, and the query string is
  stripped from `page_location`.
- **`screen_class`** is the deepest activated component's element selector.
  Note this differs from what `@angular/fire`'s own `ScreenTrackingService`
  would produce: it reads the *top-level* activated route, which in this app is
  always `MainLayoutComponent`, so it would report `app-main-layout` for eight
  different pages.
- **`page_title`** is the constant `HomeAccount`. There is no `TitleStrategy`.
- Parity between the web and iOS derivations is not guaranteed by the compiler
  — both call `currentScreenView()`, and `app.smoke.spec.ts` asserts the name
  for every routed page against a real activated router state.

## How it works

- `AnalyticsService` (`src/app/core/services/analytics.service.ts`) is the only
  place events are sent from. Feature code never touches the SDK; an ESLint
  rule enforces that.
- The SDK is created on first use, and first use only happens after consent —
  see the privacy section above.
- Web uses `@angular/fire/analytics`. Capacitor uses
  `@capacitor-firebase/analytics`, loaded by dynamic import so it never enters
  the web bundle. `provideAppAnalytics()` withholds the `Analytics` token
  entirely on native, because a gtag hit from inside the WKWebView would be
  attributed to the *web* data stream rather than the iOS one.
- Analytics is skipped unless `environment.firebase.measurementId` looks like a
  real id (`G-` followed by the property code). The committed templates ship
  `YOUR_MEASUREMENT_ID` and CI writes `ci-stub`; both are non-empty, so the
  check is on shape, not presence. This also makes the unit suite structurally
  incapable of reaching Google.
- `ScreenTrackingService` from `@angular/fire` is **not** used: it injects
  `ComponentFactoryResolver`, removed in Angular 22, so resolving it throws.
  `@angular/fire` 20 is the newest release and still declares it.
- Nothing in analytics ever throws. Usage statistics are never a precondition
  for anything the user asked for.

### iOS specifics

`FIREBASE_ANALYTICS_COLLECTION_ENABLED` is `NO` in `Info.plist`. The
authentication plugin calls `FirebaseApp.configure()` at launch, so without
that key the measurement SDK would start collecting — `first_open`,
`session_start` — before Angular boots and before the stored preference can be
read. The runtime turns collection on only after consent resolves. Use
`_ENABLED` and never `_DEACTIVATED`: deactivation is permanent for the install
and cannot be undone by the API.

`FirebaseAutomaticScreenReportingEnabled` is `NO`, because a Capacitor app is
one view controller and automatic reporting would emit a single screen for the
whole app.

The native enabled flag persists in `NSUserDefaults` across launches and across
accounts on the same device, which is why the resolved preference is pushed
once after the auth state settles rather than speculatively at boot. Two
accounts on one device also share a GA4 app-instance id; the same is true of
the `_ga` cookie on web. That is one more reason `setUserId` stays off.

CI has no iOS job. Every native change here is verified only by a local
`npm run build:ios` and an Xcode run.

### Known gaps

- Web events fired while offline are dropped — gtag has no queue — while the
  iOS SDK persists and uploads them later. Offline sessions are therefore
  undercounted on web, and the two streams are not directly comparable for
  that.
- Turning consent off mid-session stops further hits, but the already-loaded
  gtag script and the `_ga` cookie remain until the page is reloaded.

## Adding a new event

1. Add it to
   [`analytics-events.json`](../src/app/core/config/analytics-events.json) with
   every parameter and the complete list of values each may take. If a value
   cannot be enumerated in advance, it does not belong in analytics.
2. Add a typed `track…()` wrapper to `AnalyticsService`.
3. Call it from the feature code, past whatever guard could have avoided the
   underlying work, so the event counts what happened rather than what was
   intended.
4. Add a row to the registry table above, and its values to the parameter
   table.
5. Run `npm run analytics:check`.
6. Register the new parameters as event-scoped custom dimensions in the GA4
   console, or they will not appear in any report.

## The consistency check

`npm run analytics:check` (`scripts/check-analytics-registry.mjs`, in CI after
the translation check) verifies that the taxonomy, the call sites and the table
above all agree — in both directions, so a deleted call site fails as loudly as
an undocumented one. It also re-derives the screen table from `app.routes.ts`.

It deliberately does **not** verify which parameters a call site passes. The
payload is an object literal spanning lines with values computed from signals;
a regex over it would produce false failures more often than true ones. The
compiler covers that (the parameter types are derived from the taxonomy), and
`AnalyticsService` drops anything outside the allowlist at runtime.

## Console setup (one-time, by hand)

None of this can be done from the repository, and the app works without it —
it simply reports nothing.

1. **Enable the integration.** Firebase console → Project settings →
   Integrations → Google Analytics. This is what makes `measurementId` appear
   in the web SDK config.
2. **Extend data retention.** GA4 admin → Data settings → Data retention →
   change event data retention from the 2-month default to **14 months**. Not
   retroactive, so do it before shipping.
3. **Turn advertising off.** GA4 admin → Data settings → Data collection →
   Google signals **off**, ads personalisation off.
4. **Register custom dimensions.** GA4 admin → Data display → Custom
   definitions → one event-scoped dimension per parameter: `method`, `type`,
   `has_tags`, `has_location`, `receipt_image_count`, `has_filters`, `outcome`,
   `severity`, `report_type`, `feature`, `setting`.
   Unregistered parameters are still collected but appear in no report, and GA4
   does not backfill.
5. **Add an internal traffic filter** for developer IPs. `ng serve` uses the
   real measurement id.
6. **Link the iOS app to a data stream** in Firebase console → Project settings
   → General → the iOS app, then download `GoogleService-Info.plist` again into
   `ios/App/App/` (gitignored). A plist generated before the app is linked has
   `IS_ANALYTICS_ENABLED = false` and no `MEASUREMENT_ID`; that flag is a tell
   that the download happened after linking, not the switch that gates
   collection.
7. **App Store privacy labels** — tracked in #127, drafted below.

## App Store privacy declarations (planned)

Not filed. There is no Apple developer account yet, so nothing here can be
entered; it becomes a release blocker the first time the iOS build is
submitted. What follows is the answer set worked out from the current GA4
configuration — Google signals and ads personalisation off, no `setUserId`
call, no advertising features — so that submission day is transcription
rather than research. Re-derive it if any of those three change.

| App Privacy category | What it covers | Linked to the user | Used for tracking |
|---|---|---|---|
| Usage Data → Product Interaction | Screen views and the feature events in the registry above | No | No |
| Identifiers → Device ID | The Firebase app-instance id and the IDFV, which the measurement SDK collects whatever our event taxonomy says | No | No |
| Location → Coarse Location | Google derives approximate geography from the request IP | No | No |

Collection is opt-in and off by default (Settings → Preferences → Share
anonymous usage statistics). Worth stating in the submission, but it does not
remove the declaration: the question is what the app collects when the user
says yes.

Check Google's current Firebase privacy-label guidance at submission time
rather than treating this table as settled. The coarse-location row is the one
that moves, and it depends on the signals-off configuration.

**Privacy manifest.** `GoogleAppMeasurement` ships its own
`PrivacyInfo.xcprivacy`, so the app target needs one only for its own
required-reason API use. Run Product → Archive → Generate Privacy Report in
Xcode and add a manifest to cover what the aggregated report is missing —
not before, since guessing at required-reason codes is how a submission gets
rejected for declaring an API it does not call.

**App Tracking Transparency.** No `NSUserTrackingUsageDescription` and no ATT
prompt: the IDFA is never read. Re-evaluate only if the
`AnalyticsWithoutAdIdSupport` SwiftPM trait is adopted (see the note above) or
if advertising features are ever added.

### Verifying

Web: turn the toggle on, then watch DebugView. Non-production builds set
`debug_mode`, so no browser extension is needed. With the toggle off, the
network panel filtered on `google-analytics|googletagmanager` must show
**nothing** on a cold load.

iOS simulator: add `-FIRDebugEnabled` to the run scheme's launch arguments;
`-FIRAnalyticsVerboseLoggingEnabled` prints each event in the Xcode console.
Run `git restore ios/App/App/Info.plist` after any Xcode build — the build
phase that injects the reversed client id rewrites the whole file.
