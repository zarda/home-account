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

## A spec that expects nothing fails

`src/test-main.ts` calls
`jasmine.getEnv().configure({ failSpecWithNoExpectations: true })`, and
`angular.json` names it as the test target's `main`. The builder loads a
test main as its `test_main` entry, after jasmine-core and before any spec
file, and karma-jasmine's start
merges its own configuration over it without naming the flag, so the flag
holds for every Karma run: `test:ci`, `test:dates`, the smoke runs and a run
narrowed with `--include`. A case that waits for something and expects
nothing fails with *Spec has no expectations*: a wait proves only that
something happened, not that it was the right thing, so a smoke case that
waits for an error expects its `code`, and one that waits for a navigation
expects where it went
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

**The test main is a copy of the builder's test-bed init.** A named `main`
replaces the `angular:test-bed-init` module the builder otherwise generates,
in `node_modules/@angular/build/src/builders/karma/application_builder.js`,
and the file's first line names that file. So `test-main.ts` provides
`provideZoneChangeDetection()` through a `TestModule`, the arm the builder
takes while `zone.js` is in the test polyfills, and calls
`getTestBed().initTestEnvironment([BrowserTestingModule, TestModule],
platformBrowserTesting(), …)` with `errorOnUnknownElements` and
`errorOnUnknownProperties` as `true` and no `teardown`. The builder's
`import '@angular/localize/init'` is left out, since the test polyfills load
it. `src/app/core/services/testing/harness.spec.ts` pins what the copy
passes: the flag reads back as `true`, a template that uses an element
nothing imports throws as the component is created, a binding to a property
its element does not have throws at the first change detection, and change
detection runs in a real `NgZone`.

**Re-read the copy on every Angular CLI upgrade.** Nothing compares it with
the builder's own init, so an upgrade that adds an option or a provider
there leaves the copy without it, and no spec turns red. Open
`application_builder.js` beside `test-main.ts` and carry over whatever the
generated init gained. `tsconfig.app.json` excludes the file, which uses
jasmine's global, and the test options' `codeCoverageExclude` leaves it out
of coverage, so the report keeps its root and its denominator (*Coverage,
and the one named exemption*).

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

## The receipt parser is measured as well as pinned

`receipt-text-parser.spec.ts` pins the readings someone wrote down, and
`receipt-text-parser.battery.spec.ts` records every reading of the receipt
battery and the lists of rows read silently. Neither says what a change does
to a receipt nobody wrote down. `scripts/measure-receipt-parser.mjs` does
([ADR 0188](ADR/0188-a-total-is-read-by-where-its-figures-are-printed-under-a-discount-past-round-cash-and-beside-an-unmarked-change-and-the-parser-is-measured-by-a-harness-that-is-kept.md)):
it generates seeded receipts, fifteen classes built for the rules that have
gone wrong before and six mixed sets of 40,000, and reads each on two
versions of the parser, joined and split.

```bash
node scripts/measure-receipt-parser.mjs --base origin/main
node scripts/measure-receipt-parser.mjs --base origin/main --day-first
TZ=Asia/Tokyo node scripts/measure-receipt-parser.mjs --base origin/main
```

`--base` is the version to compare against, `HEAD` by default; the other side
is the working tree. It prints, per class and layout, the receipts read
silently before and after, those newly silent, the right readings newly
flagged, right readings gone wrong and wrong ones gone right, and the model
lane's wrong answers kept and right answers flagged. It exits 1 where any
receipt newly reads silently: a wrong amount at or over the review bar, a
refund read as a purchase graded 0, or a purchase read as a credit graded
0.5 or more. The other columns are costs for the record that changes the
parser to state.

It is run by hand, in both zones and both day orders, before a parser change
is recorded. CI runs only `--self-test`, in a step of its own: the job's
checkout is one commit deep and holds no version to compare against. The
self-test proves the generator repeats itself, the loader reads the parser at
`HEAD` and in the tree, and a planted regression is counted. The parser is
loaded from source text with its one import replaced, so a second import
added to `receipt-text-parser.ts` fails the loader, and the self-test, until
the script follows it. The script mirrors the two grade functions of
`native-receipt.service.ts` by hand; a change there is followed here by hand
too.

A reading the harness cannot generate is still pinned by a spec: its classes
never print a count that is twice a repeated price, and a pin was what caught
a rule flagging `Item 12 $6.00` over `Total $6.00`.

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
  `undefined`. The stub hands the pipe real signals. Its `t` is
  `echoTranslation`: it echoes the key, and the params beside it as
  `key:JSON(params)` when there are any, so an assertion can name the whole
  rendered label. `echoKey` gives the key alone. Both answer
  `common.sentenceSeparator` with en.json's own `". "`: a separator is
  punctuation, not words, and echoed it would glue two joined sentences into
  one token ([i18n.md](i18n.md#two-sentences-joined)). `echoTranslation`
  answers `common.quotedName` with en.json's own too when it is handed a
  name, so the name reads bare: echoed, it would bury the name inside a key
  of its own. Handed no name, and through `echoKey`, the key echoes
  ([i18n.md](i18n.md#a-transaction-with-no-description)). A new spec whose
  stand-in echoes keys calls one of these rather than writing its own; older
  specs that still write their own echo fold onto them spec by spec.
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
not as a method returning a fixed value — see *Angular 22: an undeclared
change-detection strategy is OnPush* below.

### One helper per job

Each job below had a copy in some spec, and each has one helper now
([ADR 0171](ADR/0171-second-copies-fold-into-one-copy-of-each-helper.md),
[ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).
The first nine rows reach a spec through the barrel's `index.ts`;
`silenceFirebaseWarnings` is imported from its own file, `withEveryCardShown`
lives beside the card it serves, and the last two are app code. A new case
uses them; a local copy is a second copy.

| Helper | File | What it is for |
|---|---|---|
| `catalogTranslator(locale, { strict })`, `catalogTranslationStub(locale)`, `CATALOGS` | `catalog-translator.ts` | The words a reader sees. `CATALOGS` holds en, ja and tc, imported, since Karma serves no `/assets/i18n`. The translator reads a catalog through the app's own `translateFrom`, plurals and params included, and gives a missing key back as the key, or throws with `strict: true`. The stub is the translation stub with those words and `currentLocale` set to match, for a spec that reads or measures text. A spec that checks a key's raw leaf still reads the JSON, since the translator picks one plural member and gives an empty leaf back as `''`. |
| `accessibleName(el)`, `accessibleDescription(el)` | `axe.ts` | A control's name and description as axe computes them for its own rules: a `display:none` label gives none, a clipped one keeps its words, `aria-labelledby` and `aria-label` win over the content, and a description is the text of the nodes `aria-describedby` names, in order, hidden or not. Each read builds axe's tree for itself, and refuses while a pass is still running. A spec that checks a name reads it this way, never off `textContent`. |
| `standOnThePage(host)`, `expectEachContrastScored(parts)`, `expectContrastScored(el, label)`, `contrastUnscored(parts)` | `axe.ts` | Contrast that was really scored (*Karma's frame is 413 px tall*, below). |
| `tokenValue`, `paintedVerdict`, `expectPainted`, `PALETTES`, `inPalette` | `painted-contrast.ts` | A node held to a token as painted, in each palette (*Colour, as painted*, below). |
| `rulesUnder(media, selector)`, `expectOneRule`, `withInlineStyle`, `underRule` | `style-rules.ts` | A phone rule Karma's 756px window never applies. `rulesUnder` finds the rules under a media query whose selector matches, by a pattern or a test of the caller's own; `expectOneRule` fails unless there is one, however many copies the CSSOM holds; `withInlineStyle` lays a style on nodes while a callback runs and puts each node's own back after, passed, failed or thrown; `underRule` lays a found rule through it, and fails the case when the rule or its nodes are missing. |
| `placeholderWidthPx(input)`, `contentWidthPx(input, clip?)` | `placeholder-width.ts` | A placeholder's width, and the room it is drawn in. It sits on its input's one line and the input's `scrollWidth` does not count it, so `placeholderWidthPx` lays it out in a hidden probe beside the input, in the input's font. `contentWidthPx` is the input's content box, inside its borders and padding, ending at `clip`'s right edge where that comes sooner: a chip list's input runs past its field's infix, and the infix is what cuts the hint. The review card's split hint, the Tags hint in the filter panel and in the transaction form, and the budget dialog's start date hint read both. |
| `afterTwoFrames()` | `frames.ts` | A wait for work that lands in a frame's rendering steps, after that frame's animation callbacks have run: a `ResizeObserver`'s report, and a render hook's focus fix-up. One `requestAnimationFrame` callback runs ahead of both and finds neither; the second frame's runs after the first frame has finished. The tab strip's spec, `budgets.overflow.spec.ts`, and the household plans section's spec and its budget dialog's read it. |
| `pressKey(target, key, { repeat })` | `key-press.ts` | A key as the browser delivers it to a focused control: a keydown that bubbles and can be cancelled, then the button's own click for the press its keypress or keyup makes, unless the keydown was cancelled, since a synthetic keydown presses nothing. `repeat` is a held key's auto-repeat: a repeated Enter presses as the first one did, and a repeated Space presses nothing by itself, but arms the button it reaches for the keyup that ends the hold. It stops at the keydown, so it presses nothing for a repeated Space; a case that lets the key go sends its own keyup. The upload area's, the filter panel's and the review card's specs read it. |
| `pressMenuEntry(fixture, trigger, entry)`, `closeEveryDialog()` | `menu-dialog.ts` | A dialog opened from a menu's entry, as a press opens it, given back once the menu has left the page, and every dialog closed after a case. A synthetic click moves no focus, so the trigger and the entry are focused before each is clicked, as a press focuses them, and the entry is what the dialog records as where focus goes back. What keeps a case about that return honest is the `TestBed.tick()` after the entry's click, which runs the dialog's focus trap (zone-mode `detectChanges` runs no render hook), and the check that focus is then inside the dialog: without them, focus stays on the trigger the menu's close focused, the dialog skips its restore, and the case passes whatever the app does. `dialog.config.spec.ts` and `transaction-list.component.spec.ts` read them. |
| `silenceFirebaseWarnings()` | `silence-firebase-warnings.ts` | AngularFire's injection-context lines, called at module scope by each file that prints them (*The noise floor*, below). |
| `withEveryCardShown(root, pass)` | `features/ai/import/transaction-preview-table/transaction-preview-table.testing.ts`, beside the review card | A pass over the whole review list. The list clips at its `70dvh` cap, about two cards in Karma's frame, and axe takes a clipped card as off screen; this lets the list out to its full height for the pass, checks that every card then sits inside the container, and puts the cap back. It throws when there is no review list under `root`. |
| `focusWhenRendered(context, ...selectors)` | `features/ai/import/import-focus.ts`, app code | Focus on the first selector found under the host once the next render has settled, wherever focus is by then: the review card's calls, the upload area's photo move and file remove, and the filter panel's Clear all, keyboard-applied suggestion and save-search box share it. It drops the repeats of Enter and Space held down across the hand-off until a keyup or a fresh keydown of either, so a held Enter presses once. Its guard listens on the window in the capture phase: zone.js runs every capture listener of one event on one target from a single native listener, registered with the first one's options, and the CDK's `InputModalityDetector` registers the document's keydown as passive before any control renders, so a `preventDefault` in a capture listener on the document does nothing. `household-focus.ts` keeps its own, which moves focus only once it has dropped (`focusDropped`) or was left on the control the swap was chosen in, and passes a held key's repeats on. |
| `focusDropped()` | `core/utils/focus.utils.ts`, app code | Whether focus has fallen to the page: `document.activeElement` is `null` or `<body>`, as it is once the element holding it is removed. The dialogs' return to a menu's button, `household-focus.ts`, the household page, the transactions page and the transaction list read it; the receipt viewer and the note translation lens ask a wider question inline, focus dropped or still inside their own host. |

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
`BreakpointObserver`, not by resizing. A phone rule is read from the
stylesheet and laid on the nodes it styles instead, through `rulesUnder` and
`underRule` (*One helper per job*). A layout that reads its own room needs
neither: the budget dialog's period row wraps on its own width, not the
window's, so its spec sizes the host as the dialog is sized, sets the
account's text size on the root, and reads the live layout
([ui-overflow.md](ui-overflow.md)).

## Karma's frame is 413 px tall

An axe pass reads clean wherever it does not look, and a short frame hides
two places it does not:

- **Body's box.** `styles.scss` holds html and body at the frame's height,
  so a long fixture runs on below body's box. Text down there with no fill
  of its own gets none: axe finds body's fill behind it, sees that the fill
  does not reach that far, and leaves its contrast `incomplete`
  (`elmPartiallyObscured`), neither passed nor failed. `standOnThePage(host)`
  paints the fixture's host in `--surface-background`, as body is painted,
  and a sweep of a fixture taller than the frame calls it first. The upload
  step's sweep with photos picked found the refusal banner's glyph at 3.04:1
  only once it stood on the fill.
- **The fold.** Under the shell's fixed scroller axe skips whatever starts
  below the viewport's bottom; `auditInView` scrolls a node into the band
  first ([emulator-blind-spots.md](emulator-blind-spots.md)).

A pass over a whole step also proves little about one part of it:
`axeOptions()` keeps one pass node per rule, so over the upload step the
hidden file input's pass holds `color-contrast` whether the words were
measured or not. `expectEachContrastScored(parts)` runs `color-contrast`
once over every part, an element and a label, and expects a node of the
rule's passes inside each part's element, naming why axe left it
`incomplete` there when it did; `expectContrastScored(el, label)` is the
one-part case. Point each part at what holds the words, apart from any
glyph beside them: with no icon font a ligature is text, and a glyph's pass
holds the part by itself. It runs the one rule, with the shared pass's other
options and its rules map, once per sweep: every wcag2a and wcag2aa rule
run per part outlasted Jasmine's five seconds on a loaded full run, and so
did the one rule run per part over a sweep of twenty under coverage.
`axe.spec.ts` pins the cut, the one run, a part read back to its own nodes,
and the fill on words placed below body's box
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

## Karma serves no fonts

Karma's test target publishes `public/` and the app's icons,
`src/assets/icons` at `/assets/icons`, so a rendered launcher icon decodes
(the About page's *shows the real launcher icon in the app info card*
expects it to have a width). It does not publish `src/assets/fonts`, where
the app's faces live (`src/theme/_fonts.scss`), and that is a decision:
serving them would change what every width spec and every axe glyph score
measures, so they stay unserved until one change serves them and
re-measures those specs together
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).
So no spec renders PT Sans or the icon fonts, and a run logs a 404 for each
font file it asks for (*The noise floor*). Each machine measures in its own
fallback: the Mac's system face, and DejaVu Sans on the Linux runner, which
is wider. The translation stub renders every string as its raw key, one long
unbroken word, so a spec that compares widths can pass on the Mac and fail in
CI by a few pixels. With no icon font, axe reads a `mat-icon`'s ligature as
16 to 18px text and holds it to text's 4.5:1
([accessibility.md](accessibility.md#colours-come-from-tokens)).

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

A dialog's title takes its face from `--mat-sys-headline-small-font`, so
`dialog-header.component.spec.ts` pins the runner's face there as well, for
its two row pins. They hold the shared header's row in a real dialog under
the app's options: *sets a short title midway between its start and the
close button, on a 40px line*, which turns red when the row's 40px
`::before` strut is deleted, and *wraps a title too long for one line and
keeps the close button in the row*, which turns red when the title's
`flex-shrink: 1` is deleted. The title's `min-width: 0`, kept for parity
with the row the title used to be, is held by neither: no case turns red
without it.

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

### A node held to its token

A case that says a line rests in a token asks two things: is it painted in
that token, and does it read on what is painted behind it.

- `tokenValue(token, property = 'color')` is what `property: var(token)`
  computes to under the palette on `<html>`, read once motion has settled.
- `paintedVerdict(node, token)` reads both without asserting: whether the
  node is painted in the token, and its ratio on its painted background.
- `expectPainted(node, token, label, floor = 4.5)` asserts on that verdict,
  naming the node by `label`. The verdict's own case checks it both ways: a
  node in its token on white reads as painted in it at 4.5:1 or better, a
  node in another token as not painted in it, and a pair on gray-800 as
  below 4.5:1. `expectPainted` itself runs in its spec on a passing node
  only, so nothing holds its own assertions to a node that should fail.
- `PALETTES` lists the four rendered modes, each theme with and without
  high contrast, and `inPalette(classes, fn)` runs `fn` under one of them
  and puts the three palette classes back as they were. It is async-safe:
  when `fn` returns a promise, the classes go back once it settles, through
  the restore `withTheme` uses, so a read after an `await` still sees the
  palette it asked for.

The muted lines on the goal card, the forecast and the Goals tab are held
this way, over `PALETTES`, with a computed opacity of `'1'` beside the token
and the ratio
([accessibility.md](accessibility.md#resting-text-is-a-token-and-a-resting-fade-fails)).
Sixteen specs still define their own `expectPainted`, and 23 their own
`tokenValue`; they fold onto these spec by spec, and a new case uses the
shared ones.

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

| | Base (`7b693953`) | `26.10.175` | `26.10.177` | `26.10.178` | `26.10.179` | `26.10.180` | `26.11.181` | `26.11.182` |
|---|---|---|---|---|---|---|---|---|
| ERROR | 40 | 53 | 53 | 44 | 44 | 44 | 44 | 43 |
| WARN | 38 | 60 | 60 | 60 | 60 | 62 | 63 | 63 |
| LOG | 26 | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| 404 | — | — | — | — | — | — | 26 | 7 |

**Counting it.** Karma's progress reporter prints each console line twice, once
behind an ANSI rewrite and once plain, so `grep -c 'ERROR: '` reports exactly
double. **Halve the raw count**, or strip ANSI and dedupe. Any comparison must
use the same method or it reads as a doubling that did not happen.

**The 404s are counted apart, and by their text.** Karma's own web server
prints a `WARN [web-server]: 404: <path>` line, once, for each file a spec
asks for that the test target does not serve. `WARN: ` does not match it, so
the WARN row does not count it, and nothing halves it. `26.11.181` printed 26:
nineteen for `/assets/icons/icon-128x128.png`, which the About page's icon
case asked for before the test target served the icons, and seven for the
fonts, which it serves by decision not at all (*Karma serves no fonts*).
`26.11.182` printed those seven and no other. They are the floor's 404s, in
any order:

```
WARN [web-server]: 404: /assets/fonts/material-icons.woff2            ×2
WARN [web-server]: 404: /assets/fonts/pt-sans-latin-400-normal.woff2  ×2
WARN [web-server]: 404: /assets/fonts/pt-sans-latin-700-normal.woff2  ×2
WARN [web-server]: 404: /assets/fonts/pt-sans-latin-400-italic.woff2  ×1
```

Any other 404 is a finding. A broken image source added to a rendered
template, tried once and removed, printed a 404 the floor does not list on a
run that stayed green: the floor, not a spec, is what catches a missing
asset
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

**AngularFire's advisory is silenced where it is caused.** AngularFire
prints a one-time advisory, *Calling Firebase APIs outside of an Injection
context may destabilize…*, the first time a zone-wrapped call runs outside
any injector. Each file that reaches such a call calls
`silenceFirebaseWarnings()` at module scope for itself, as
[ADR 0088](ADR/0088-the-smoke-harness-owns-the-noise-it-makes.md) has every
smoke file do, so a file run alone is as quiet as the suite. The unit
callers are ten: `firestore.service.spec.ts`; the eight that reach
`deleteField()`, in the spec, the service under test or both
(`auth.service.spec.ts`, `goal.service.spec.ts`,
`household.service.spec.ts`, `household-plans.service.spec.ts`,
`provider-key.service.spec.ts`, `recurring.service.spec.ts`,
`search-answer-history.service.spec.ts` and `transaction.service.spec.ts`);
and `data-management.component.spec.ts`, whose component calls
`terminate()`. A new spec that prints the advisory alone joins the list, and
the helper's header with it. Module scope runs when the bundle loads, so
under `test:ci` the whole suite runs silenced through any one of them, and
the floor above does not move; `test:dates` runs two of them without
`firestore.service.spec.ts`. A lone `test:dates` run is still not silent:
it prints 25 WARN lines and one ERROR line in each zone, among them the
household services' own `[HouseholdLedger]` and `[HouseholdPlans]`
warnings, which break
[ADR 0123](ADR/0123-the-unit-sweep-is-silent-on-a-normal-path.md)'s silence
on a run of those specs alone.

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
`26.11.181` added none either: its 63 is the three *already deleted* lines on
top of 60, on both of its runs; it adds and removes no `console` call under
`src/`; and every line printed by the fourteen unit spec files it edits comes
from a case that predates it. The one that recorded `26.11.182` added none
and took one away: the budget form's failed save, *[BudgetForm] Save
failed:*, is spied on and expected in the case that causes it, and every
other line, deduplicated, matches `26.11.181`'s base; its 63 is the three
*already deleted* lines on top of 60. **Rendering
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
beside it, older and still readable. The test main is left out of the report
(`"codeCoverageExclude": ["src/test-main.ts"]` in the test options): under
`--code-coverage` the builder instruments a test main as it does any source
file, and this one, the first instrumented file directly under `src/`, moved
the report's root to `coverage/home-account/src/app/…` and added four
statements to the denominator.

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
