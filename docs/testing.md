# Testing: what each tier proves, and what a stubbed template does not

The suite has three tiers, and each one exists because the tier below it cannot
see something. This document is the part you need when adding a spec — mostly
when you are about to reach for `.overrideComponent`.

The rule this document was written for is recorded in
[ADR 0144](ADR/0144-a-blanked-template-is-paired-with-a-describe-that-renders-it.md).
Until that record, the stub-template convention existed only as three in-file comments,
which is why twenty-four components had been compiled with their template
replaced by a placeholder and rendered by nothing else.

## The three tiers

| Tier | Command | What it proves | What it cannot see |
|---|---|---|---|
| Unit | `npm run test:ci` | Class behaviour, signals, computeds, guards | Anything a template decides, and anything Firestore rules decide |
| Smoke | `npm run smoke` | The same services against the real emulators, including rules | Anything CI measures — `test:ci` **excludes** `*.smoke.spec.ts`, so smoke coverage never counts |
| Driven browser | `docs/e2e.md` | The app as shipped, signed in, at a real viewport — against production, or against the emulators where a journey needs several accounts | Nothing automatic; it is a written protocol, not a suite |

A file is in exactly one tier. A `*.smoke.spec.ts` needs the emulators and is
excluded from `test:ci`, so **a line covered only by a smoke spec reads as
uncovered in the coverage report**. That is a reporting fact, not a gap — but
it means a coverage target can never be met by writing smoke specs.

## More than one account at once

Anything shared between accounts — the household is the first — needs two or
three signed in at the same time, and each tier has its own shape for that.

- **Rules: three named apps.** A rules smoke case that needs an owner, a
  member and an outsider signs each into its own `initializeApp(…, name)`
  against the Auth emulator, the shape `feedback.service.smoke.spec.ts` uses.
  The single app the older rules cases share signs its anonymous stranger out,
  and an anonymous user cannot sign back in, so it cannot hold three at once.
  The three clients in `firestore-rules.smoke.spec.ts`'s household matrix use
  **Firestore Lite** (`@angular/fire/firestore/lite`): a full client keeps a
  listen and a write stream open, Chrome allows six connections per host, and
  three full clients leave the admin REST calls waiting tens of seconds for a
  free one. The rules judge a Lite request exactly as they judge a full
  client's. Every case starts from fresh household ids, because specs run in
  random order, so nothing an earlier case left, index entries included, is
  in the way.
- **Services: two full stacks.** A service smoke spec builds the second
  account's services in a child `EnvironmentInjector`, as
  `transaction-receipts.smoke.spec.ts` does. Two full clients is the most one
  file holds, for the same connection reason. The household plans and ledger
  smokes (`household-plans.service.smoke.spec.ts`,
  `household-ledger.service.smoke.spec.ts`) run two stacks, one member
  viewing in dollars and the other in euros, and each shares rows through
  `TransactionService`'s own write path before reading the household's
  figures; both run in the zoned `smoke:dates` pass too.
  `ledger-share.smoke.spec.ts` needs a third client, a stale second device
  of the owner's, so it keeps one full client (the owner's real service) and
  makes the peer and that device Lite clients.
- **No household smoke case goes offline with a write queued.** A full client
  that disables its network with a write queued stalls every other client's
  emulator traffic for tens of seconds, and the whole run with it. One case
  goes offline with nothing queued:
  `household-plans.service.smoke.spec.ts`'s cached-household case takes both
  clients offline while the pages open, and writes only once they are back.
  It needs offline because only then can a page answer from nothing but its
  cache (below). That a copy's commit is
  issued behind its row's is pinned from the mock's call-order log in
  `ledger-share.service.spec.ts` and `transaction.service.spec.ts` ('issue,
  then follow, then await'); that the commits then land in that order after
  an offline stretch rests on the SDK's persistent mutation queue, which no
  suite or journey proves. The driven journey 71 checks only which path the
  app takes offline and what it says: the pane cannot take Firestore itself
  offline, so nothing queues there.
- **The browser: the emulator serve.** `npm run start:emulators` serves the
  app's committed `emulators` configuration on port 4300 against the local
  emulators, and `node docs/ui-audit/tools/seed-household.mjs <file outside the
  repo>` seeds three accounts in two households and writes their three
  session records. The driven journeys that need them are [e2e.md](e2e.md)'s
  68 to 77, 79 and 80; 58 to 66 drove the design of ADRs 0152 to 0156 (PRs
  #462 and #463) and are superseded
  ([ADR 0155](ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md)).

Two household proofs sit outside all three tiers. **The functions**: `npm run
smoke` starts only the auth, storage and firestore emulators, so the invite
callable and the two cleanup triggers, `onHouseholdMemberDeleted` and
`onHouseholdDissolved`, never run in it. Their pure planners, their handlers,
their Admin SDK dependencies and the mapping from a delete event to the
cleanup's input are pinned over fakes by `npm --prefix functions test`
(`tsc`, then `node --test` over `functions/lib/*.test.js`), the first step
in CI. `index-wiring.test.ts` there loads `index.ts` itself, which reaches
no network at load, and reads each trigger's endpoint as the Firebase CLI
deploys it: the delete event type, the exact document path and
`retry: true`, on which the handler's "rethrown, so delivered again"
depends. Its type assertions make `tsc` refuse either trigger handing its
event to the other's mapper. `household-client-mirrors.test.ts` reads the
app's source and fails when a constant or query shape the two sides share
drifts. The real functions run only in the driven journeys: 74 to 76 on the
emulators, and 78 on production after the merge. **The ledger contract**:
the facts the copy and the household's plans state twice — their fields in
the models and in the rules, each household query shape and its composite,
the files that write transactions, the share-key cap, the snapshot's and
the plans' bounds, the plans' currency pattern against the one the app
tests with, and the copy fields `copyFaithful` holds equal to the row's —
are compared by `npm run ledger:check`, a script with a `--self-test`
rather than a spec, because the emulator enforces no composite and nothing
at run time compares the pairs
([emulator-blind-spots.md](emulator-blind-spots.md)).

## The emulator's lock wait, and the ticker

The Firestore emulator closes a commit its rules refuse without waking the
commits queued on that commit's locks. They wait for the next lock request
from anyone, or for the emulator's 2 s lock wait to run out, after which a
rules lookup fails and the commit is refused. Chrome makes such refused
commits by itself, re-sending a commit whose connection closed while the
emulator still runs the first copy, so a smoke case could fail on a commit
the rules admit ([emulator-blind-spots.md](emulator-blind-spots.md#a-commit-refused-after-the-emulators-2-s-lock-wait-492), #492).

- **What the ticker does.** `npm run smoke` and `npm run smoke:dates` run their
  tests through `scripts/emulator-ticker.mjs`. While the tests run, it writes
  `_emulatorTicker/tick` as the emulator's owner every `EMULATOR_TICK_MS`
  (200 by default). That is the other lock request, so a stranded commit
  waits one interval at most.
- **Turning it off.** `EMULATOR_TICK_MS=0` runs the tests without the ticker.
  `household-plans.service.smoke.spec.ts`'s refused-commit case then fails
  every time, which is how the ticker is known to work.
- **The self-test.** Both scripts run `node scripts/emulator-ticker.mjs
  --self-test` first.
- **What a case may rely on.** Only the waking. The ticker's document is the
  only one in its collection and nothing reads it, so a case must not list
  root collections or count every document in the project.
- **Making commits overlap on purpose.** A case that wants two commits on the
  emulator at once must send them from two clients. One client's SDK sends
  its transactions' commits one after another (they share its async queue),
  so two `commitOnline` calls from one stack never meet on the server.

## Six connections to the emulator

Chrome pools at most six HTTP/1.1 connections per origin (host and port).
An online Firestore client in the Karma page holds a hanging request to
`127.0.0.1:8080` for each open stream: a listen stream while it has
listeners, and a write stream after a write, which the SDK closes after 60 s
idle. Clients a spec file keeps online add up, and a write from another
client then waits for a connection to free. A probe measured one client's
profile write against N other online clients, each with one listener and
one completed write: 180, 23 and 26 ms for N = 0, 1 and 2, and still pending
after 8 s for N = 3. Auth (9099), storage (9199) and Karma (9876) are other
origins, with pools of their own.

- **What it looks like.** No failure line. Karma reports
  *Disconnected, because no message in 30000 ms*, because the case that waits
  says nothing for 30 s. The three runs seen stopping this way all stopped
  at the same case, and two of six full runs before the fix did.
- **Finding the case.** A reporter added for one run (`jasmine.getEnv()
  .addReporter` with `specStarted`) logs each case as it starts; the last one
  logged before the disconnect is the case that waited.
- **What was measured, and what was not.** In
  `degraded-profile-lock.smoke.spec.ts` the stall came in the full run only,
  never with the file alone, with two recovered dashboard sessions and the
  seeder online: fewer clients than stalled the probe, but busier ones, and
  whatever else the full run held open was not measured. Deleting each
  case's client as the case ends stopped it: three full runs since, all
  green.
- **The rule.** A case that brings its own client online deletes it in
  `afterEach`. Deleting every app in `afterAll` keeps each case's client
  online through every later case
  ([ADR 0184](ADR/0184-the-lock-fails-closed-while-the-profile-is-unknown.md)).

## A page opens first on the household its cache remembers

Each account's client is made once per spec file, so its cache outlives a
case. `forgetMemberships` deletes the previous case's index entries on the
server, over REST and behind the client, and leaves those memberships live.
- **What a connecting page sees first.** When a page connects in the next
  case, `HouseholdService`'s index listener first answers from that cache. It
  lists only the earlier household, and the service falls back to it
  (`selectedHouseholdId`, earliest joined live) with that household's cached
  members and plans, until the server lists the new one.
- **Why a wait must name the household.** A wait on status, members and
  `plans.loading()` alone passes inside that window. A case that then writes
  through the plans writes into the earlier household: one soak round wrote
  a goal and thirteen contributions there, and the case's REST read of the
  household it formed found none (#492).
- **The fix.** The household specs' `openOn` waits for
  `household()?.id === householdId` on both stacks.
- **Its pin.** A case holds the window open offline and checks where the next
  goal lands.
- **Not in production.** There an index entry is deleted only once its
  membership has ended, so the rules refuse a stale household's writes.

## The stub-template rule

A spec may replace a component's template:

```ts
.overrideComponent(FooComponent, { set: { template: '<div></div>' } })
```

and that is legitimate **only while something else renders that template**.
Blanking isolates the class from its children, which is what makes a shell with
seven feature children testable at all. What it costs is everything the
template decides: a mistyped `(click)`, a broken `@if` gate, a control that
lost its label, a child that stopped being passed an input. None of those fail
a spec that never rendered the markup.

So the rule is: **every component whose every TestBed blanks its template gets
one more `describe` that renders it.**

### How to tell whether a component is covered

Not by grepping for the placeholder. **Blanking uses two literals, not one** —
`template: '<div></div>'` and `template: ''` — and at the time ADR 0144 was
written the repo had 37 of the first and 21 of the second. A check that sees
only the first is wrong about a third of the population, which is exactly how
`TransactionFormComponent`, the app's central form, went 1879 spec lines
without a single DOM assertion.

The test is:

```
blanking overrides >= TestBeds  &&  DOM references <= 2
```

counting `template: '<div></div>'` and `template: ''` as blanking, and
`nativeElement` / `querySelector` / `By.css` / `By.directive` as DOM
references. Two qualifiers, or the count comes out wrong:

1. **The blanked symbol must be an app component.** A spec that declares its
   own inline `@Component({ template: '' })` stub is blanking nothing real.
2. **The unit is the component, not the file.** A component whose unit spec
   renders is covered even if its `*.smoke.spec.ts` or `*.overflow.spec.ts`
   sibling blanks.

This is **not** a check script, deliberately. It is a rule with two judgement
calls in it, and a script that got either wrong would be worse than the grep it
replaced.

## The two house shapes

There are two, and a task picks by **what it is proving**. Writing "drop
`NO_ERRORS_SCHEMA`" as a blanket rule is wrong; it is right for a fully
rendered component and wrong for a partial one.

### Full render

Reference: `transaction-preview-table.component.spec.ts:1011-1072`.

A **top-level sibling `describe`** — no `resetTestingModule()`, Jasmine's
per-spec teardown handles it. No `.overrideComponent` at all. **`NO_ERRORS_SCHEMA`
dropped**: with it, a mistyped child selector is swallowed, which is exactly
the bug the describe exists to catch. `imports: [Component]` and
`providers: [provideNoMotion(), …]`, with `provideNoMotion` taken from the
`core/services/testing` barrel, and every service the *template* reaches stubbed.

Use it when the component's children are cheap — Material, directives, small
shared components.

### Partial render

Reference: `settings.component.spec.ts:145-178`.

Keep the real template, narrow the component's **own** `imports`, and **keep**
`NO_ERRORS_SCHEMA`:

```ts
.overrideComponent(ReportsComponent, {
  set: {
    imports: [CommonModule, MatTabsModule, /* … */],
    // A standalone component's template is governed by its own schemas,
    // not the TestBed's, so the child feature elements need excusing here.
    schemas: [NO_ERRORS_SCHEMA],
  },
})
```

This is what makes a shell with seven feature children tractable. It is honest
proof **when the assertions are about this component's own template and the
excused children are irrelevant to them**. It only "moves the stub" if a child
is excused and then asserted about — asserting a child element is *present* or
*absent* is fine, because an unresolved custom element answers that exactly as
a real one would.

**Every partial describe carries a comment naming what it deliberately does not
render.**

### In both shapes

- `detectChanges()` inside each `it`, not in `beforeEach` — the arrangement
  usually differs per case.
- Assert what a user reaches: a control clicked, a label read, an `@if` gate
  proven. Never a method call the stub describe already covers.
- Anything rendering into the CDK overlay — `MatMenu`, `MatSelect`,
  `MatDatepicker`, a dialog — carries a cleanup `afterEach`, or the next case
  finds a stray panel in the document:

  ```ts
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(n => n.remove());
  });
  ```

## Shared stubs

`src/app/core/services/testing/` is the barrel. Two helpers exist because every
rendered template needs them, and a third because every date picker does:

- **`createTranslationStub(overrides?)`** — `TranslatePipe` is imported by
  every component template in the app, and it injects `TranslationService`,
  which injects `HttpClient`. A describe that renders a real template and
  provides neither throws `NullInjectorError` before the first binding
  resolves. A `jasmine.createSpyObj('TranslationService', ['t'])` is **not**
  enough: `translate.pipe.ts:38-44` folds `currentLocale` and
  `translationsVersion` into its memo key, and a spy object memoizes both as
  `undefined`. The stub hands the pipe real signals. `t` echoes the key, and
  echoes the params beside it when there are any, so an assertion can name the
  whole rendered label.
- **`createLocaleFormatStub(overrides?)`** — for templates carrying
  `localeDate` or `localeNumber`, and for components that call `formatTime`
  (it renders the UTC `HH:mm`). Deliberately not `Intl`: the output is stable
  text a spec can assert whole, and it does not move when a Node or ICU upgrade
  changes a separator.

- **`provideAppDatepickerForTests({ dateFormat, locale, t })`** — the app's
  date adapter, its formats and the calendar's labels, over signals the spec
  owns and writes. It hands `AuthService` a stub whose user is a premium
  account, so a real `AnalyticsService` that a rendered component brings in
  stays quiet, and `TranslationService` a stub whose `getIntlLocale` is the
  real method run against the spec's `locale`. A spec never writes that
  wiring by hand
  ([ADR 0171](ADR/0171-second-copies-fold-into-one-copy-of-each-helper.md)).

No component provides a date adapter
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)), so
every spec that renders a picker provides one, and which one depends on what
it asserts:

| The spec | Provides |
|---|---|
| renders a picker and asserts no date text | `provideNativeDateAdapter()` |
| asserts date text, or that a picker follows the reader | `provideAppDatepickerForTests(...)` |
| asserts real catalog words through the adapter or the labels | the production `provideAppDatepicker()`, an `AuthService` stub, and the real `TranslationService` over `provideHttpClient()` and `provideHttpClientTesting()` |

What a missing piece looks like, since none of it names the cause:

- *MatDatepicker: No provider found for DateAdapter* — no adapter at all.
- `NG0201` *No provider found for `Auth`*, through `DateFormatService` and
  `AuthService` — the app's adapter without the helper's `AuthService` stub.
  The picker's own optional `inject(DateAdapter)` is a directive inject, and
  Angular rethrows a nested not-found from there.
- `NG0200`, a circular dependency on `AuthService` — the same, when something
  with an optional `inject(AuthService)` was built first: `AnalyticsService`,
  which the transaction form, the filters and the budget form bring in.

A spec that writes `locale` or `dateFormat` **after** a picker rendered
flushes with `fixture.detectChanges()`. The picker built the adapter inside
the Angular zone, so its effect is flushed there; `TestBed.tick()` from the
spec body enters the zone mid-tick and reports `NG0101`. `TestBed.tick()` is
right for an adapter the spec injected itself.

A service whose template reads it as a **signal** must be stubbed as a signal,
not as a method returning a fixed value — see the next section.

## Five traps that cost a day each

### Angular 22: an undeclared change-detection strategy is OnPush

A spec that flips a plain spy's return value and calls `detectChanges()` will
not see the change: the view has no signal dependency to mark it dirty.
`markForCheck()` does not reliably help either. Drive the binding through a
`signal()` the template actually reads — either the component's own signal, or
a signal-shaped stub property:

```ts
const atLimit = signal(false);
quota = jasmine.createSpyObj('ReceiptQuotaService', ['refreshCount'], {
  isAtLimit: atLimit,   // the real service exposes a signal; the stub must too
});
// …
atLimit.set(true);
fixture.detectChanges();   // now it re-renders
```

Use `TestBed.tick()`, never `flushEffects()`.

### A `computed()` over plain service methods memoizes forever

`computed(() => this.service.someMethod())` has an **empty** dependency set. It
evaluates once and never again, so changing the spy afterwards can never reach
it. If the suite's `beforeEach` already rendered the component, the value is
already frozen. Create a fresh component after arranging the spies:

```ts
function statusWith(): string {
  return TestBed.createComponent(AiSettingsPageComponent).componentInstance.aiStatusText();
}
```

### Templates are type-checked only by `ng build`

`ng test` is JIT. A template reading a private member passes every spec and
breaks `ng serve` with TS2341. **Run `npm run build` after any change that
un-blanks a template or adds a binding.**

Un-blanking also has a second gate: dropping `NO_ERRORS_SCHEMA` can surface a
`Mat*Module` in an `imports:` array whose selector the template never uses,
which `npm run material:check` fails (ADR 0128). Run it too. The same script
holds a second rule (ADR 0178, widened by ADR 0180): a `<mat-select>` whose
body offers an option bound `[value]="null"` or `[value]="undefined"` must
carry `canSelectNullableOptions`, or Material reads that option as a reset and
the field shows empty, its label unfloated, while the model holds `null` or
`undefined`. A spec that renders such a field reads the trigger's text
(`.mat-mdc-select-value`) and whether the label floats, since a model
assertion passes either way. The script's `--self-test` runs 64 cases across
both rules.

### A real reload aborts the whole run

Karma ends the run the moment a spec reloads the page — "Some of your tests
did a full page reload!" — and every result after it is lost. The app reloads
on an account change it did not start ([auth.md](auth.md#an-account-change-this-page-did-not-start),
ADR 0163), from inside the auth-state listener, which fires whenever the SDK
calls back, not when a spec chooses. So the reload sits behind a root token,
`PAGE_RELOAD` (`core/services/page-reload.ts`), and **every TestBed that
builds the real `AuthService` provides a double for it**. Five suites do
today:

- `auth.service.spec.ts`: a `reload` spy in the outer providers, and `null`
  in the one child injector that stands for a device;
- `auth.service.smoke.spec.ts`: a spy in `stubProviders()`, which every block
  spreads. A block that lists its providers inline falls back to the real
  factory, and its first account change reloads the run away;
- `analytics.service.smoke.spec.ts`: an inert function, since it signs in
  once and never switches;
- `degraded-profile-lock.smoke.spec.ts`: a spy in `configure()`. Each case
  signs its own client in before the TestBed builds anything, so the
  listener's first delivery is never an account change;
- `dashboard-layout.service.spec.ts`: a spy in its *over the real
  AuthService* block.

Every other suite provides an `AuthService` double and never builds the
listener. A sixth that builds the real one must provide the token too.
`page-reload.spec.ts` hands the factory a fake location, and never calls the
function the root injector resolves.

### Under zone.js, `window` never hears a ZoneAwarePromise rejection

Karma runs in **zone mode** here: `@angular/build`'s karma builder adds
`provideZoneChangeDetection()`, so Angular-compiled code runs on zone.js's
`ZoneAwarePromise`. A rejection nobody catches is reported by zone.js, not by
the browser. zone.js does re-dispatch it to `window`, as a
`PromiseRejectionEvent` built without its `promise`; the constructor throws,
and an empty `catch` swallows the throw. So a spec listening for
`unhandledrejection` on `window` hears nothing, and passes whether the code
caught the rejection or not.

The rejection goes one of two ways, by the zone the rejecting code ran in:

- **Inside the Angular zone**, to `NgZone.onError`. TestBed's error handler
  rethrows it as a global error when nothing awaits `whenStable`, so it lands
  on whichever spec is running, or as Karma's *An error was thrown in
  afterAll*, and it can end the run on a disconnect. No spec fails where the
  defect is.
- **Outside it**, in the zone a spec body runs in, to `console.error`, as the
  bare value with no prefix.

An effect runs in the zone that was current when `effect()` was called,
whichever flush runs it: Angular stores `Zone.current` on the effect node and
flushes it under `zone.run`. So:

| Code | Reports on |
|---|---|
| a component's effect, created by `TestBed.createComponent` inside NgZone | `NgZone.onError`, even when `TestBed.tick()` flushes it |
| a root service's effect, created by `TestBed.inject` in the spec body | `console.error`, even under `fixture.detectChanges()` |
| a template binding or a lifecycle hook | the flush's zone: `fixture.detectChanges()` and the scheduler's tick run inside NgZone, `TestBed.tick()` in its caller's |
| a template event | the zone its listener was registered in |
| the spec body and its awaited continuations | `console.error` |

A case that proves nothing went unhandled listens where its code reports: a
console spy, or a subscription to `TestBed.inject(NgZone).onError`. An
`onError` detector records `NgZone.isInAngularZone()` at the call as its
positive control, since a call that ran anywhere else would pass on an
`onError` that had no chance to fire, and a case that cannot say which zone
its code ran in subscribes both. `household.component.spec.ts`'s *lets a
failed tidy pass without a word* is the model:

```ts
const zoneErrors: unknown[] = [];
const subscription = TestBed.inject(NgZone).onError.subscribe(error => zoneErrors.push(error));
const consoleError = spyOn(console, 'error');
const inAngularZone: boolean[] = [];
service.tidyEndedMemberships.and.callFake(() => {
  inAngularZone.push(NgZone.isInAngularZone());
  return Promise.reject(new Error('permission-denied'));
});
// render, let the task run, unsubscribe in finally
expect(inAngularZone).withContext('the tidy ran in the zone onError reports for').toEqual([true]);
expect(zoneErrors).toEqual([]);
expect(consoleError).not.toHaveBeenCalled();
```

**A native promise is the exception.** `share-target-sw.spec.ts` evaluates
the service worker's source natively, outside anything zone.js patched, and
there `window` does hear a rejection. It listens for none today; a spec of
that shape that must would take a scoped exemption, not a looser rule.

A spec-only `no-restricted-syntax` block in `eslint.config.js` bans the
listener: the event names as a string literal (`'unhandledrejection'`,
`'rejectionhandled'`, in `addEventListener`, `fromEvent` or a constant) and
as an `on…` handler property. `lint-guards:check` holds it for the specs
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md),
after [ADR 0138](ADR/0138-a-plugin-call-nothing-implements-is-the-developers-failure-not-the-users.md),
which met the same silence at boot).

## Karma's window is 756 px

`docs/ui-overflow.md:471`. A real-template describe **cannot** prove a rule
that starts at 768 px or above — a desktop-only layout assertion will either
fail or pass vacuously. Breakpoint behaviour is driven by stubbing
`BreakpointObserver`, not by resizing.

## Karma serves no fonts

Karma's test target publishes only `public/`, and the app's faces live in
`src/assets/fonts` (`src/theme/_fonts.scss`), so no spec renders PT Sans or
the icon fonts. Each machine measures in its own fallback: the Mac's system
face, and DejaVu Sans on the Linux runner, which is wider. The translation
stub renders every string as its raw key, one long unbroken word, so a spec
that compares widths can pass on the Mac and fail in CI by a few pixels.

A width spec pins a face with the runner's metrics instead:
`Verdana, 'DejaVu Sans', sans-serif` on the host (Verdana measures within a
few pixels of DejaVu Sans), and the same value on `--mat-sys-body-large-font`,
`--mat-sys-body-small-font` and `--mat-sys-label-large-font`, because
Material's fields and buttons take their face from those tokens and never
inherit the host's. A floated outline label is laid out at up to 133% of its
field and drawn at 75%, so a long label makes the field's `scrollWidth`
exceed its `clientWidth` while nothing visible overflows; measure the label's
drawn box instead. The phone-width describe in
`household-members.component.spec.ts` does all three (#71).

## Colour, as painted

A spec that holds a colour pair to WCAG renders the real template and
measures what Chrome paints, through `core/services/testing/painted-contrast.ts`,
never a computed value read off one element
([ADR 0164](ADR/0164-colours-come-from-theme-tokens-and-a-gate-keeps-them-there.md),
[ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md)).
Each helper there answers a way the computed value lies:

- **A computed colour is not always `rgb()`.** Chrome keeps a `color-mix()`
  in its own space: `color-mix(in srgb, #3f51b5 6%, transparent)` computes
  to `color(srgb 0.247059 0.317647 0.709804 / 0.06)`, which a `[\d.]+`
  scrape reads as three channels near zero and an alpha it then drops.
  `channels()` reads `rgb()`, `rgba()` and `color(srgb … / a)`, the three
  shapes Chrome computes an sRGB colour to, scales the last to 0–255, and
  throws on anything else (a keyword, hex, `none`, a wide-gamut space)
  rather than guess.
- **A translucent fill takes on what is under it, and an ancestor's
  `opacity` fades everything inside it.** `paintedBackground(el)` composites
  the element's background over every ancestor's, with each `opacity`
  applied to its whole group, and rounds to whole channels at the end, as
  the page is painted. `paintedColor(el)` composites the text colour over
  the same chain. Both finish running transitions first, so they read the
  colour the page rests on, and both throw when nothing under the element
  is opaque or the element is not in the document. `ratio(a, b)` scores the
  pair. It is written out in the helper rather than imported, so a spec of
  `color-contrast.utils.ts` is not measured by the code it tests.
- **The walk follows the DOM parent chain.** That is the painting order for
  in-flow content and for an overlay pane under `.cdk-overlay-container`,
  but not for a pseudo-element, a sibling, or an element positioned over an
  unrelated one. A stroked button's hover and focus layers are its
  `::before`, so the review card's spec measures the card's fills, and the
  glyph pipe's spec renders the button and composites its layers itself.
- **Read the element that is painted.** A colour set on a host and read
  back from the host proves nothing. Material paints a chip's label on
  `.mdc-evolution-chip__text-label`, from `--mat-chip-label-text-color`; a
  menu item's icon from `--mat-menu-item-icon-color`; and a progress bar's
  indicator as the top border of `.mdc-linear-progress__bar-inner`, read as
  `borderTopColor`. A `mat-dialog-title` is coloured by Material whatever
  class its host carries.

### The theme

- `withTheme('light' | 'dark', fn)` stamps exactly one of `.light-theme` and
  `.dark-theme` on `<html>` and restores both afterwards, once the promise
  settles when `fn` is async. It is for probing tokens and stylesheet rules.
  It stamps exactly one because Material's `--mat-sys-*` are `light-dark()`
  pairs that follow `color-scheme`: a probe with neither class reads the
  host's OS scheme.
- Anything that reads `ThemeService.effectiveTheme()` (the category chip,
  the `categoryGlyph` pipe, the chart palette) ignores the classes. Drive it
  through the service: `withScheme(themeService, scheme, fn)` from `axe.ts`,
  looped over `AUDIT_SCHEMES`, or `setTheme(...)` and `TestBed.tick()`.
  `withScheme` ticks inside the Angular zone, because a tick from outside
  it makes the service's effect start a second tick, which Angular refuses
  as NG0101 and only logs. It throws when the class it asked for is not
  alone on `<html>`, so a stubbed service cannot pass the host's scheme off
  as the forced one, and it restores the preference, flushes it, and only
  then the classes.
- Restore both classes in a `finally`. A leaked `dark-theme` reads every
  later spec in the wrong scheme (ADR 0151).

### A `:hover` colour, from the CSSOM

Karma cannot put the pointer over an element.
`hoverValue(el, selectorPart, prop, pseudoElement?)` finds the `:hover`
rule that styles `el` and returns the value as declared, `var(--token)`
included:

- `selectorPart` is matched with `includes`, because emulated encapsulation
  rewrites `.chip:hover` to `.chip[_ngcontent-…]:hover`;
- a selector counts only if `el` matches it with each `:hover` taken to
  hold, so a rule for another element, or for the other theme's html class,
  is not returned;
- a rule that ends in a pseudo-element is read only when `pseudoElement`
  names it, as `'::before'`: Material paints a button's hover layer as
  `.mat-mdc-outlined-button:hover > .mat-mdc-button-persistent-ripple::before`;
- it throws when no rule declares the property for that target, naming any
  rule that declares it for another part of `el`, and when several rules
  disagree, since it does not compute the cascade between them. Enclosing
  `@media` and `@supports` conditions are not evaluated, and a shorthand
  declared with `var()` has no longhand to read, so ask for the shorthand.

Assert that the rule exists, then set its value on the element inline and
measure the result with `paintedBackground` or `paintedColor`.

### An option or a menu item in a state

A select's options and a menu's items are painted differently at rest,
active and selected, so one glyph sits on several tones.
`core/services/testing/option-states.ts` puts a select's options through
them:

- `chooseOption(select, value, flush)` opens the panel and clicks the
  option, so whatever the host binds (a form control, `ngModel`, a selection
  handler) takes the value as it would from a pointer.
- `eachOptionState(select, flush, check)` opens the panel and calls `check`
  once per option per state. **Selected** is each chosen option with the
  active mark taken off it: the panel opens with the chosen option active,
  and Material paints the active layer in place of the selected fill.
  **At rest** is every other option. **Active** is each option not chosen,
  made active in turn, as the arrow keys make it. A multiple select paints
  no selected fill, so there a chosen option, still passed as `'selected'`,
  is painted as one at rest. Hover is left out: Karma cannot hover, and
  Material's hover layer (0.08) is fainter than its active one (0.12), so
  what reads on the active layer reads on the hovered one.
- `GLYPH_PROBE_COLOURS` names the two colours to choose: the lightest seeded
  category colour, which a light surface reads worst, and the darkest a
  category can take, which a dark surface reads worst.

A menu has no helper. Open it through its `MatMenuTrigger`, give each
`MatMenuItem` `focus('keyboard')` in turn, and assert `cdk-keyboard-focused`
on its host before measuring, since the keyboard's focus layer is a state a
pointer-free spec cannot otherwise reach. The menu focuses its first item
as it opens, and that layer covers the item's own fill, so a case that
measures a marked item's fill, such as the current category, makes a later
item the marked one (`category-suggestion.component.spec.ts`).

Both render in the CDK overlay, so the describe removes
`.cdk-overlay-container` after each case (see *In both shapes*).

## The noise floor

`test:ci` prints console output from paths that deliberately report a failure.
The floor is a recorded number, not a gate: it exists so a new line is noticed.

| | Base (`7b693953`) | `26.10.175` | `26.10.177` | `26.10.178` | `26.10.179` | `26.10.180` | `26.10.181` |
|---|---|---|---|---|---|---|---|
| ERROR | 40 | 53 | 53 | 44 | 44 | 44 | 44 |
| WARN | 38 | 60 | 60 | 60 | 60 | 62 | 63 |
| LOG | 26 | **0** | **0** | **0** | **0** | **0** | **0** |

**Counting it.** Karma's progress reporter prints each console line twice, once
behind an ANSI rewrite and once plain, so `grep -c 'ERROR: '` reports exactly
double. **Halve the raw count**, or strip ANSI and dedupe. Any comparison must
use the same method or it reads as a doubling that did not happen.

**Three WARN lines come and go.** On some runs `firestore.service.spec.ts`'s
`afterAll` deletes its app while the SDK still has work queued on it, and the
SDK then warns three times that *Firebase App named 'firestore-unit-…' already
deleted*. WARN reads 63 on those runs and 60 on the rest: the base of the
`26.10.178` wave read 63, and that wave's measures read 60 and 63. Judge a new
line by its text, not by that difference of three. One more comes and goes:
`offline-queue`'s *Reclaimed 1 item(s) interrupted mid-sync* printed one time
fewer on one `26.10.179` run, which read 59 against two that read 60.

LOG fell to zero because `no-console` now bans `console.log` outright; the five
lines over the base when it was first recorded (43 ERROR and 40 WARN) are
expected-failure paths in new specs, and so are the ten ERROR and twenty WARN
lines above that earlier figure, which came from specs added since; the wave
that recorded `26.10.173` added none, and neither did the ones that
recorded `26.10.175` and `26.10.177` (the latter's lines, deduplicated, match
`26.10.176`'s one for one). The wave that recorded `26.10.178` added none
and took nine away. They were not expected failures: the dashboard spec's
three failed-save cases flushed with `TestBed.tick()` from the spec body,
which entered the zone mid-tick and reported `NG0101`, nine ERROR lines
before that wave and twelve once the widget's publishing effect tracked more
reads. Those cases flush with `fixture.detectChanges()` now, and the spec
prints none. The wave that recorded `26.10.179` added none either, and neither
did the one that recorded `26.10.180`: its 62 is the three *already deleted*
lines on top of a run whose *Reclaimed 1 item(s)* line printed once fewer, and
every line, deduplicated, matches `26.10.179`'s base. The one that recorded
`26.10.181` added none either: its 63 is the three *already deleted* lines on
top of 60, on both of its runs; it adds and removes no `console` call under
`src/`; and every line printed by the fourteen unit spec files it edits comes
from a case that predates it. **Rendering
twenty-four real templates added none of them** — a template that renders
quietly is the normal case, and a new line here means a real code path started
reporting something.

## Coverage, and the one named exemption

There are **no coverage thresholds configured anywhere** — not in
`angular.json`, not in `package.json`, not in `ci.yml`, and there is no
`karma.conf.js`. CI uploads `coverage/` as an artifact and nothing reads it. A
target is therefore a number someone committed to in a record, not a gate.

The fresh report is written under `coverage/home-account/**app**/…`. A stale
pre-`app/` tree may still be sitting beside it from an older run; reading that
one gives figures like 1.33 % for a file the suite covers well. **Check the
path.** A run narrowed with `--include` roots its report at the files it
loaded instead — `coverage/home-account/core/services/…` for
`auth.service.spec.ts` alone — and leaves the last full run's `app/` tree
beside it, older and still readable.

### `auth.service.ts` — exempt, at 81.30 % statements

`FirebaseAuthentication` is a `registerPlugin` **Proxy over an empty target**
(`@capacitor/core` `dist/index.cjs.js:161`). `spyOn` reads an `undefined`
property descriptor and throws, so three call sites are **unreachable in
Karma**: `signInWithGoogleNative` (`:502`), the native `reauthenticate` arm
(`:615`), and `deleteFirebaseUser`'s plugin sign-out (`:642`) — about 20
statements. The `signInWithPopup` / `reauthenticateWithPopup` ESM call sites
(`:493`, `:627`) are unspyable for the same reason.

What covers them instead is `auth.service.smoke.spec.ts`, 809 lines against the
real emulator — and `test:ci` excludes smoke, so none of it counts toward the
figure. This is the same situation the suite already excuses for
`firestore.service.ts`.

Retrofitting an injectable seam onto the sign-in path — the cure
`NativeAnalyticsTransport` already uses for its dynamic import — is production
surgery, and was deliberately not done for a coverage number.

The reachable half **is** covered, by one tier or the other. Karma runs the
auth-state listener's branches with ADR 0052's guards, the reload on an
account change the page did not start and its own-change marker (ADR 0163),
`signOut` with its catch, and account deletion's web arm. It also runs the
five profile writers past their guards: `updateUserPreferences`,
`clearUserPreferences`, `updatePreferenceFields`,
`clearStoredProviderApiKeys` and `updateUserProfile`. Each sends its write
through the private `writeUserFields` seam, which the unit spec holds open,
so the field maps they build (the `deleteField()` sentinels included), the
re-read of the signal once the write lands and the merge into it all run
under Karma ("a write that lands after the signal moved", ADR 0166). What
no Karma spec executes in them is the seam's own body, the real
`updateDoc`, and `updateUserPreferences`' return on an empty map. The
emulator suite runs `getOrCreateUser` on both arms including its
`stillSignedInAs` guard, and each writer's real round trip: the dotted
paths, the `deleteField()` deletes, the parent map the SDK creates for a
nested path, and a nested write over a stored value that is not a map.

### The other four

| File | Statements |
|---|---|
| `core/services/analytics-transport.ts` | 85.29 % |
| `features/settings/ai-settings-page/…component.ts` | 96.73 % |
| `features/ai/import/file-dropzone/…component.ts` | 85.60 % |
| `core/services/category.service.ts` | 97.01 % |

`file-dropzone.component.ts` reached its figure from 65.64 % **purely by being
rendered** — its uncovered block was the drop handler, the remove button and
the preview tile, all of which only exist in the template. That is the whole
argument for this rule in one file.

## Charts

`provideAppCharts()` from `src/app/core/config/chart.config.ts` is **mandatory**
for any describe rendering a component with a `baseChart` canvas
(`docs/performance.md:49-50`) — the registry is hand-listed so unused Chart.js
pieces tree-shake, and a missing controller throws. Chart.js does draw a real
`<canvas>` headless, so a chart component renders in full; it needs no partial
template.
