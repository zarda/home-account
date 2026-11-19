# 195. A gate holds the test main to the builder's init, specs stay out of the stylesheet, a lone date run is silent, and the opacity gate reads a url in a comment as a comment

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #545

Reference documentation lives in [../testing.md](../testing.md),
[../performance.md](../performance.md),
[../accessibility.md](../accessibility.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../dates.md](../dates.md), [../e2e.md](../e2e.md) and the root
[../../README.md](../../README.md).

Four leftovers of the test harness, each a place where a check said less
than it seemed to.
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
recorded them under its Known gaps and #545 took them up: a copy of the
Karma builder's test-bed init that nothing compared with the original, a
stylesheet that shipped utilities only specs named, a run of the date specs
that printed twenty-six lines on a normal path, and an opacity gate that
read one comment shape wrongly.

Closes four gaps of [0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md):
the copied test init held by its settings and not by the builder's, the
lone `test:dates` run that is not silent, Tailwind reading the specs, and
`opacity:check`'s `url()` mask that misreads a narrow comment shape.

Amends 0187's account of how `opacity:check` reads a stylesheet: an
unquoted `url(…)` is no longer blanked before the comments are.

Applies [0145](0145-a-class-found-by-reading-becomes-a-gate.md) (a class
found by reading becomes a gate) and
[0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md) (the unit sweep
is silent on a normal path). Keeps the role aliases of
[0164](0164-colours-come-from-theme-tokens-and-a-gate-keeps-them-there.md)
shipping.

## Context

**The test main.** `angular.json` names `src/test-main.ts` as the test
target's `main`, and a named main replaces the module the Karma builder
otherwise generates, `angular:test-bed-init`, in
`node_modules/@angular/build/src/builders/karma/application_builder.js`. The
copy exists for one statement of its own, jasmine's
`failSpecWithNoExpectations` (0187), and is otherwise meant to say what the
builder's init says. The builder writes that init as an array of source
lines, some of them chosen by two arms it works out for the project:
`usesZoneJS`, whether the test polyfills, less `zone.js/testing`, hold
`zone.js`, and `hasLocalize`, whether `@angular/localize` resolves from the
source root. `harness.spec.ts` pinned what the copy passes, and the copy's
header asked for a re-read on every upgrade. Nothing compared the two, so an
upgrade that added an option or a provider on the builder's side would have
left the copy without it, and no spec would have turned red.

**The stylesheet.** Tailwind's `content` was `./src/**/*.{html,ts}`, specs
included, and Tailwind takes the words of comments and strings as candidate
classes. A word standing alone in a spec therefore shipped the utility it
names. *ring*, in comments of three specs, put Tailwind's bare `.ring` rule
into the initial stylesheet, and #545 put the utilities specs brought in at
about 1.8 kB, some of them on purpose: `theme-aliases.spec.ts` reads each of
0164's role aliases off the page in every palette, and nineteen of them no
template names.

**The date run.** `npm run test:dates` runs the zone-sensitive specs, and CI
runs it twice, under `TZ=America/New_York` and `TZ=Asia/Tokyo`. Measured at
the base of this branch, a lone run printed 25 `WARN: ` lines and one
`ERROR: ` line in each zone, each from a case that makes the code under test
warn on purpose:

| Spec | Lines | What prints |
|---|---|---|
| `household-ledger.service.spec.ts` | 10 WARN | `[HouseholdLedger] …`: listeners that stopped, a removed member's copies not purged or not judged |
| `household-plans.service.spec.ts` | 5 WARN | four `[HouseholdPlans] …`, and the ledger's `[HouseholdLedger] The budgets' ledger listener stopped:` |
| `export.service.spec.ts` | 6 WARN | `Error loading font from https://fonts.gstatic.com/…`, a PDF case's font fetch, which the spec rejects |
| `native-receipt.service.spec.ts` | 1 WARN | `[NativeReceipt]`'s fall-back to the basic parser |
| `cloud-llm-provider.base.spec.ts` | 3 WARN, 1 ERROR | `[Stub] answer was cut short; kept 1 complete row(s)` twice and `kept 2` once; `[Stub] multi-image extraction failed:` with `AI_ANSWER_INCOMPLETE` |

Six of the ledger spec's ten lines and four of the plans spec's five were
already expected by their cases and printed all the same: both specs spied
on `console.warn` with `callThrough`, and their own filters, `ledgerLogs`
and `planLogs`, read the lines the console had already printed.
Karma's own web server printed three `WARN [web-server]: 404` lines besides,
one for each font file the specs ask for, which the test target does not
serve by 0187's decision.

**The opacity gate.** `opacity:check` blanked every unquoted `url(…)` over
the raw stylesheet, so that its `//` could not open a comment, and only then
blanked the comments. In a comment holding a `url(` whose `)` lay past the
comment's `*/` on the same line, the url mask took the `*/` with it, and a
fade between the two was read as comment:
`/* url(x */ .a { opacity: .5; } /* ) */` passed. The tree held no such line.

## Decision

### A gate holds the test main to the builder's init

`npm run test-main:check` runs `scripts/check-test-main.mjs`, its
`--self-test` first, and CI runs it right after the firebase-tools check.

- **It reads the builder's init where the builder writes it.** For each
  project whose test target uses `@angular/build:karma`, it parses the
  builder's source with TypeScript's parser, finds the object literal whose
  `namespace` is `angular:test-bed-init`, and takes the `contents` array its
  `loadContent` joins. A small evaluator of its own reads the array for this
  project's arms: strings, templates, array literals and their spreads,
  conditionals, `!`, parentheses and the two arm names, and nothing else.
  `usesZoneJS` is worked out
  as the builder works it out, from `angular.json`'s test polyfills less
  `zone.js/testing`, which must hold exactly `zone.js`; `hasLocalize` from
  whether `@angular/localize` resolves from the project's source root.
- **It compares every top-level statement, in order.** Both sources are
  parsed; each statement is printed by TypeScript's printer with its
  comments removed, its trailing commas dropped and an import's named
  imports sorted, then reduced to tokens, string literals by their value.
  Layout, quote style and the order of named imports do not count; anything
  else does. The builder's own module is written
  `@NgModule({ providers: [provideZoneChangeDetection(), ], })`, so a
  trailing comma could not be allowed to count.
- **Two differences are allowed, each for its reason.** One
  `jasmine.getEnv().configure(...)` statement, the copy's reason to exist; a
  second is a difference like any other. And the builder's
  `import '@angular/localize/init'`, which the copy leaves to the test
  polyfills, only while `angular.json`'s test polyfills hold
  `@angular/localize/init`; the day they do not, the missing import fails
  with kind `localize`.
- **A builder it can no longer read is a shape failure, not a pass.** The
  namespace gone, no `loadContent`, an init joined by anything but
  `contents.join('\n')` or added to after the join, a `contents` added to
  after the literal, a line it cannot evaluate, or an arm worked out another
  way than `buildOptions.polyfills?.includes('zone.js')` and a
  `hasLocalize = true` placed after `projectResolve('@angular/localize')` in
  the same `try`: each fails as `shape`, and the message says to fix the
  extraction before trusting the check.
- **A drift failure lists both sides** in order, `-` for a statement only in
  the builder's init and `+` for one only in the copy, then the allowances.

Where 0145's gates walk their sources by hand, this one reads with the
TypeScript compiler the project already installs, as
`scripts/measure-receipt-parser.mjs` does. Otherwise it has 0145's shape, a
header that states the defect and what the gate allows, and a self-test. Its
28 cases accept the tree as it stands and copies that differ only in
comments, trailing commas, layout or quote style; fail on a builder's init
that gains a teardown option, a provider or a statement, and on a copy that
drops an option, adds a statement or a second jasmine configuration, stands
in another order, or leaves the localize import out once the polyfills no
longer load it; and flag ten builders it cannot read as shape failures. The
first sixteen were written before the gate, against an evaluator that always
answered *match*, and twelve of them failed: `12 self-test failure(s)`.

On today's tree it reads `@angular/build 22.1.6` and
`5 top-level statements`, with `zone.js` in the test polyfills and
`@angular/localize` installed, both allowances in use. Taking
`errorOnUnknownProperties` out of the copy made it list the option; taking
`@angular/localize/init` out of the test polyfills made it fail with kind
`localize`.

### Specs stay out of the stylesheet, and the role aliases no template names are safelisted

`tailwind.config.js`'s `content` keeps `./src/**/*.{html,ts}` and leaves out
`!./src/**/*.spec.ts`, `!./src/**/*.testing.ts`,
`!./src/app/core/services/testing/**` and `!./src/test-main.ts`; Tailwind
3.4.19 reads a negated glob. Its `safelist` holds the nineteen of 0164's
role aliases that no file it still reads names: `text-fg-disabled`,
`text-fg-inverse`, the nine `bg-surface-background`, `-card`, `-elevated`,
`-hover`, `-hover-active`, `-active`, `-subtle`, `-strong` and `-sunken`,
`border-line`, `border-line-subtle`, `border-line-strong`, `text-brand`,
`bg-brand-soft`, `text-accent`, `border-accent-light` and `text-ai`. The
other eight aliases (`text-fg`, `text-fg-secondary`, `text-fg-muted`,
`bg-surface-muted`, `text-brand-text`, `text-error-text`,
`text-warning-text`, `text-success-text`) ship because templates name them.
The safelist's comment says what it is: the theme's colour API, documented
and read off the page in every palette.

`theme-aliases.spec.ts`'s case *ships no rule for a utility that only a spec
names* reads the page's stylesheet, first finds `.text-fg-disabled`, which
only the safelist ships, so that an absence is read from a sheet that was
read, and then expects no selector that is `.ring` standing alone. Under the
old config it failed: `Unexpected $[0] = '.ring' in array.` The comment over
the spec's alias rows says why each utility ships: a template names it or the
safelist holds it.

The proof is the production build's stylesheet, before and after, both from
`npm run build:analyze`:

| | Before | After |
|---|---|---|
| `styles-*.css` | 32,655 bytes | 31,811 bytes |
| Initial bundle | 2,428,963 bytes | 2,428,119 bytes |
| Class selectors | 173 | 166 |

Seven class selectors left and none came. A rule-by-rule diff of the two
sheets shows those seven rules gone and nothing else changed:

| Rule | Bytes | Where the word stood |
|---|---|---|
| `.ring` | 310 | comments in the transaction filters' spec, the dropzone's spec and the preview table's overflow spec |
| `.invert` | 211 | a comment in the monthly comparison's spec, and the stat card spec's `invert` signal |
| `.ordinal` | 171 | a comment in `translation-keys.spec.ts` |
| `.line-through` | 48 | the goal card's spec, as an expected computed value |
| `.underline` | 42 | the preview table's, the budgets' and the reports' overflow specs and the tab strip's spec |
| `.uppercase` | 36 | case names in the file utilities' and the dropzone's specs |
| `.flex-wrap` | 26 | an inline style in `focus-indicator.spec.ts` |

The seven come to 844 bytes. No non-spec `.html` or `.ts` holds any of the
seven words standing alone, and a looser search finds only identifiers such
as `toUpperCase` and `invertDelta`, no class put together at run time. No
word that only a file under `core/services/testing/` holds was among them.

Against the base of the branch, 160 class selectors, six of the seven were
already there; `.flex-wrap` came in during the branch (*Things that only
became apparent while building*). By the time of the change twelve
selectors had been added on purpose by two other commits: ten by *fix: a
keyboard-focused button shows an indicator inside it, in its own text
colour* (`.mat-focus-indicator`, `.mat-mdc-button-base`, the button kinds
and their disabled states) and two by *feat: a deleted transaction can be
brought back for ten seconds* (`.bottom-nav-container`,
`.mat-mdc-snack-bar-container`).

### A lone date run is silent

Each of the twenty-six lines is spied **and expected** in the case that
causes it.

`src/app/core/services/testing/console-quiet.ts`, exported from the testing
barrel, gives the specs one shape for it. `quietConsole(method, prefixes)`
spies on `console.warn` or `console.error`, holds back every line whose first
argument starts with a named prefix, expected or not, and hands any other line
to the method the console had before the spy, read before `spyOn` replaces
it. `consoleLines(spy, prefix)` returns the held lines with a prefix and
marks them read. `unreadLines(spy)` lists the held lines no read returned,
and `expectEveryHeldLineRead(spy)`, called in an `afterEach`, fails the case
that caused one, with the context
`a line held back that the case never read with consoleLines`.

- **The ledger spec** spies with `quietConsole('warn', [LEDGER_PREFIX])`,
  `LEDGER_PREFIX` being `'[HouseholdLedger]'`, in place of `ledgerLogs`;
  three cases gain their expectation, and its `afterEach` checks every held
  line after the injector's teardown.
- **The plans spec** holds both prefixes, `[HouseholdPlans]` and
  `[HouseholdLedger]`, in place of `planLogs`; the case whose budgets are
  incomplete expects the ledger's line and no line of its own.
- **The export spec** has one spy, in its top-level `beforeEach`, holding
  only `Error loading font from `, so a CSV or JSON case still prints
  anything nobody expects. Each PDF case expects its font line with the
  fetch's rejection. The two cases that spied for themselves now share the
  one spy, so jasmine never refuses a second, and expect their font line
  too: eight font expectations in all, for six printed lines.
- **The native receipt and cloud provider specs** spy in the case, strictly:
  `toHaveBeenCalledOnceWith` fails any other call. The cloud provider's error
  case expects `[Stub] multi-image extraction failed:` with an error whose
  message is `AI_ANSWER_INCOMPLETE`.

`console-quiet.spec.ts` runs for both methods: a held line is read and not
passed on, any other line is passed on whole, a read marks only the calls it
returned, and `unreadLines` refuses a spy `quietConsole` did not make. It
prints nothing. A drop of the pass-through failed it with
`Expected $.length = 0 to equal 2`, and the original method read after
`spyOn` overflowed the call stack with a `RangeError`.

Karma's three font 404 lines are left as they are, by 0187's decision.

### The opacity gate masks an unquoted url in code only

One lexer decides both. `maskComments` in `scripts/check-opacity.mjs`, in
code state and only there, tries the sticky
`UNQUOTED_URL = /\burl\([^)'"\n]*\)/iy` where a `u` or `U` starts; on a match
it blanks the address between `url(` and its `)`, offsets kept, and steps
past the `)`. Stepping past keeps the address's `//` from opening a comment,
and blanking it keeps an escaped paren, `url(a\(b.png)`, from leaving the
statement cutter waiting on a paren. Inside a comment or a string the rule
does nothing, so a comment ends where it closes and a `)` past that end is
never reached for. `scanStylesheet` calls `maskComments` directly; the
pre-pass is gone. The rule is this copy's alone: the nine other copies of
`maskComments` in `scripts/` have none, and are left as they are.

Three self-test cases were added beside the three url cases already there:

- *a url( in a comment does not reach past the comment's end*:
  `/* url(x */ .a { opacity: .5; } /* ) */` reads `['1 opacity: .5']`. Before
  the change it was the only failure, `1 self-test failure(s)`, with
  `[]`.
- *one closed inside its comment is blanked with the comment, which still
  ends at its \*/*: `/* url(x)*/ .a { opacity: .5; }` reads
  `['1 .a opacity: .5']`, the selector included.
- *nor does an escaped paren in its address*:
  `.a { background: url(a\(b.png); }` with `.b { opacity: 0.5; }` on the
  next line reads `['2 opacity: 0.5']`.

## What was rejected

- **Keeping the header's request to re-read the copy on every upgrade.**
  Nothing compared the copy with the builder's init, so a re-read that was
  missed turned nothing red.
- **Comparing the printed statements as text.** TypeScript's printer keeps
  the source's line breaks in array and object literals and the source's
  quote style, so a copy wrapped differently or quoted with double quotes
  would have differed from the builder's one-line strings. The tokens of the
  printed statement are compared instead.
- **Allowing any jasmine configuration.** The allowance is the copy's one
  reason to exist, and it is keyed on one statement.
- **Dropping the nineteen aliases,** as the criterion's wording would. They
  are 0164's colour API, documented, and `theme-aliases.spec.ts` holds each
  to its token in every palette; a spec that reads them off the page needs
  them shipped.
- **Proving the change by the absence of `.ring` alone.** The proof is the
  diff of the built sheet's class selectors, each removed one a word that
  only excluded files hold.
- **Spying on the household lines alone,** as #545 proposed. The eleven lines
  of the three other specs would still have printed.
- **A bare spy, or one that calls through.** A bare spy hides any other line
  along with the expected one; `callThrough` prints the expected lines into
  the run, where a run of the spec alone reads as noise.
- **Serving Karma the fonts** to silence its three 404s. They stay unserved by
  0187's decision: serving them would change what every width spec and every
  axe glyph score measures.
- **Blanking comments first and the url after.** The url's `//` would by then
  have opened a line comment that took its `)` and everything after it on the
  line. One pass decides both, so neither can blank the other's end.
- **Giving all ten copies of `maskComments` the url rule.** Only this copy
  had a url rule, which is where the misreading lay; the others' url case is
  theoretical today, and each gate keeps its own copy so that it runs on its
  own.

## Consequences

- **An upgrade that changes the builder's init fails CI** at
  `test-main:check`, with both sides listed; the copy is carried over by
  hand. An upgrade that changes how the builder works out its arms, or where
  it keeps its init, fails as a shape failure. Neither needs a Karma run to
  show.
- **The gate costs** `scripts/check-test-main.mjs`, 886 lines with its 28
  cases, a package script, a CI step, a row in the root README's scripts
  table and a place in its CI-order paragraph, and the paragraph of
  `docs/testing.md` that asked for a re-read, which now describes the gate.
  The header of `src/test-main.ts` says the same. No byte of the app changes.
- **A word in a spec, a testing helper or the test main no longer ships a
  utility.** A word in a non-spec `.html` or `.ts` still does, comments
  included.
- **The stylesheet lost 844 bytes**, 32,655 to 31,811, and the initial bundle
  the same, 2,428,963 to 2,428,119 bytes. That leaves the bundle 3,119 bytes
  over its 2,425,000-byte warning; the warning is not moved here.
- **The nineteen safelisted aliases keep 1,015 bytes of rules** that no
  template uses yet. A template that starts naming one makes its entry
  redundant, not wrong.
- **A full unit run with the change** showed no spec leaning on a removed
  utility. Its one failure, an order-dependent dialog audit, is
  [0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)'s.
- **A lone date run prints no console line.** Both zones ran 1472 of 1472
  with no `WARN: ` or `ERROR: ` line; only Karma's three font 404s printed.
  A full unit run
  made with the change printed 35 WARN and 42 ERROR lines, halved, where the
  base printed 60 and 43: the twenty-five and the one.
- **A held line must be read.** A case that stops expecting the line it
  causes fails, and a warning nobody expects, under any other prefix, still
  prints. The console work costs eight files, 243 lines in and 32 out, the
  helper's 73 lines and its spec's 77 among them.
- **The opacity gate reads the comment shape as code** and every real source
  as before. Its self-test has 153 cases, three more, and the real run reads
  as it did: `Checked 105 stylesheets and 104 templates, inline ones
  included, for resting fades (1 recorded).` It costs 44 lines in and 14 out
  of `scripts/check-opacity.mjs`.
- **No emulator surface.** The gate and the opacity lexer run in node, and
  the console work in Karma's date specs; the emulator smoke has nothing of
  theirs to read, and none of the three has a smoke case. The stylesheet
  change is read by the walkthrough's redirect case, *redirects
  unauthenticated visitors to the login page*, on `/login`, a path that
  calls no Firestore API: the lead line's colour against `--text-secondary`
  in both schemes, `.text-fg-secondary` among the sheet's selectors, and no
  `.ring` (*test: emulator proof for the goal card's actions, the login
  page's stylesheet, and undo and focus after a delete*).

## What the browser runs found

### Run 1, on 19 November 2026

Emulators only, Auth, Firestore and Storage, served by `ng serve` from this
branch's checkout with the bundle naming `demo-home-account` alone, as Alex,
signed in by a session record written into the page. The desktop pane, at
1024px, painted about four frames a second, as a background page does, so
every read followed a flush and finished animations. Journey 124's
stylesheet step is this record's. The audit of the touched screens, walked
on 18 November before any code, had no finding in this record's scope.

- Signed in, in light: none of the page's 792 style rules was `.ring`, and
  `.text-fg-secondary` painted `rgb(55,65,81)`, the value of
  `--text-secondary`.
- After the header's Sign Out, on `/login`: the lead line painted
  `--text-secondary` in the four palettes, plain, high contrast, dark and
  dark high contrast, and none of the page's 493 rules was `.ring`.
- The re-check after the fixes for the run's defects, at 1024px in dark,
  read `/login` signed out again: no `.ring` rule and no sideways scroll.

**Found:** nothing in this record's scope. Of the five defects the run met,
the sign-in page's missing heading, on the same page as this step, is
[0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)'s,
and the four controls named alike or not at all are
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)'s.

**Most of this record has no browser surface.** The gate reads
`node_modules` and `src/test-main.ts` in node, the date run's console is
Karma's, and the opacity lexer reads stylesheets in node; no run can show
any of them. Of the stylesheet change the run read `.ring` and one alias a
template names. The other six rules' absence was read once, in the
production build's selector lists, and the nineteen safelisted aliases are
held by `theme-aliases.spec.ts` in Karma, from the same Tailwind config the
development server used.

## Departures from the issues

- **"No WARN or ERROR line" is read as the browser's console lines.** The
  criterion asks that a Tokyo `test:dates` run print no WARN or ERROR line. A
  lone run in either zone prints no `WARN: ` or `ERROR: ` line, the noise
  floor's own counting. Karma's web server still prints three
  `WARN [web-server]: 404` lines, for `material-icons.woff2`,
  `pt-sans-latin-400-normal.woff2` and `pt-sans-latin-700-normal.woff2`,
  which the test target does not serve by 0187's decision.
- **Nineteen aliases that only a spec names still ship.** The criterion asks
  for an initial stylesheet with no utility that only a spec names. The
  nineteen role aliases that only `theme-aliases.spec.ts` spells are
  safelisted and ship, 1,015 bytes of rules, as the theme's documented colour
  API.
- **Every line is expected, not only the household's.** #545 proposes spying
  on the household warnings. The eleven other lines came from the export, the
  native receipt and the cloud provider specs, and each is expected where it
  is caused too.

## Things that only became apparent while building

- ***ring* stood in three specs, not in the dropzone's alone**: comments in
  the transaction filters' spec and the preview table's overflow spec
  carried it as well.
- **The class showed itself while it was being closed.** `.flex-wrap` was not
  in the base's sheet. An inline style in `focus-indicator.spec.ts`, from
  *test: the focus indicator of every button kind scores 3:1 on its surface,
  in four palettes*, put it there on this branch, and the change took it out
  again.
- **`.ring` is the largest of the seven rules,** 310 bytes in the sheet built
  just before the change; #545 gave 171.
- **The safelist is the list a run gave.** With the exclusions and no
  safelist, `theme-aliases.spec.ts` read `TOTAL: 19 FAILED, 19 SUCCESS`, and
  the nineteen were the alias rows, nothing else.
- **An alias with no rule does not always fall to the sentinel.** A text row
  inherits the spec's sentinel colour and a background row stays
  transparent, but a border row keeps preflight's gray, `#e5e7eb`, which is
  `--border-primary`'s light value. It still fails, since none of the border
  tokens holds that gray in all four palettes.
- **An absence proves nothing about a sheet that was never read.**
  `styleRules` skips a sheet whose rules it cannot read, so the `.ring` case
  first finds a safelisted alias. Dropped from the safelist, that control
  failed beside its alias row.
- **The builder's arms can change as easily as its lines.** A gate that
  worked out `usesZoneJS` and `hasLocalize` its own way would, after such an
  upgrade, compare the arm it chose with one the builder no longer takes, and
  nothing would show it. So the gate holds how the builder works them out
  too. Three builders that the gate first matched are now shape cases: one
  that sets `hasLocalize` before it resolves `@angular/localize`, one that
  pushes to `contents` after the literal, and one whose init is wrapped round
  the join. A copy with a second jasmine configuration also matched at first
  and now drifts.
- **Two kinds of font line, unrelated.** The export spec's six are the PDF's
  font fetch from `fonts.gstatic.com`, refused by the spec; Karma's three are
  its web server's 404s for the fonts the test target does not serve.
- **The date list holds none of this branch's other warnings.** Re-measured
  just before the change, each zone printed exactly the base's twenty-six
  lines: `[Dashboard]` and `[PendingDelete] Delete failed:`, which other
  commits of the branch added, come from specs that are not on the list.
- **The helper's own spec needed a console that is no spy.** A
  `jasmine.createSpy` standing in for the console would make
  `quietConsole`'s `spyOn` refuse a method already spied upon, so a plain
  recorder takes the lines passed on. The describe puts Karma's own method
  back in `afterAll`, since jasmine restores a spied method only after the
  `afterEach` hooks.
- **Each half of the url rule needed a case that can fail.** The guard as
  first written, `/* url(x) */ .a { opacity: .5; }`, passed under every
  mutation tried. With no space before the `*/` and the selector read too,
  it fails a url rule run in every lexer state
  (`["1 url( ) .a opacity: .5"]`), one that returns to code after the url
  (`["1 url( )*/ .a opacity: .5"]`) and one that steps a character too far
  (`[]`), and the reader before the change still passes it. Nothing read the
  blanking of the address until the escaped paren's case: with the blanking
  loop removed, it fails with `[]`.
- **The old and the new reader agree on every real source.** Both were run
  over the 129 in the tree, 99 tracked stylesheets and 30 inline component
  styles, with no difference; only the comment shape reads otherwise.

## Known gaps

### The test main and its gate

- **No global guard catches a spec that leaves DOM or scroll behind** for
  the specs after it. The one file loaded before every spec is the test
  main, and this gate holds it to the builder's init with room for the
  jasmine configuration alone, so a guard there would fail as drift. A guard
  with a reasoned allowance of its own in the gate, or a home outside the
  test main, would close it.
- **The jasmine configuration's place is not pinned.** Only the first
  `jasmine.getEnv().configure(...)` is allowed, wherever it stands in the
  copy. A case that holds it before the init would pin it.
- **One shape guard has no case.** A builder whose `contents` is no longer an
  array literal fails as `shape`, but no self-test case reads that guard, so
  a change that broke it would pass the self-test. A case beside the other
  ten shape cases would close it.

### The stylesheet

- **Three of the four exclusions remove nothing today, and no test pins
  them.** `*.testing.ts`, `core/services/testing/**` and `test-main.ts` held
  no word that shipped a rule, so only the `*.spec.ts` exclusion is
  exercised, by `.ring`. A case per pattern, a word only a file of that kind
  holds read back absent from the sheet, would pin each.
- **Only `.ring` is read.** The unit case and the smoke look for `.ring`
  alone. A comment in a non-spec file that names any other utility ships it,
  and nothing fails; that no non-spec file names *sr-only*, comments
  included, is still kept by hand. The selector diff that proves this change
  was taken once; a step that compared the built sheet's class selectors with
  a recorded list would hold every utility.

### The date run's console

- **Karma's three font 404 lines stay.** 0187's *The fonts stay unserved*
  stands: serving the fonts would change what every width spec and every axe
  glyph score measures. Serving them and re-measuring those specs in one
  change would close it.
- **Nothing fails a printed line.** CI runs both zones and passes whatever
  they print, so a new warning in a spec on the date list makes the run noisy
  again and turns nothing red; the silence is read by counting the output,
  as the noise floor is. A step that failed on a `WARN: ` or `ERROR: ` line in
  the date run would hold it.
- **The silence is the date list's.** A full unit run made with the change
  still printed 35 WARN and 42 ERROR lines, halved, from specs off the list,
  which this work did not take up. The same expectation, case by case in
  each of those specs, would silence them.

### The opacity gate

- **The nine other copies of `maskComments` have no url rule**, in
  `check-colors.mjs`, `check-dates.mjs`, `check-direction.mjs`,
  `check-grid-tracks.mjs`, `check-icon-labels.mjs`,
  `check-ledger-contract.mjs`, `check-material-imports.mjs`,
  `check-motion.mjs` and `check-truncation.mjs`. An unquoted `url(` holding
  `//` in a stylesheet one of them reads would open a line comment there.
  Nothing under `src/` holds a `url(` with `//` in it, quoted or not. Each
  copy would take the rule itself, since each gate runs on its own.

### Where none of it is seen

- **`/login` is read for one colour and one absence.** The walkthrough's
  redirect case compares the lead line's colour with its token in both
  schemes and finds no `.ring` rule; it runs no axe pass there and takes no
  contrast ratio, since the page stands on the product's gradient backdrop.
  An audit of `/login` in the walkthrough would close it.
