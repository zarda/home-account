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
- **No household smoke case goes offline.** A full client that disables its
  network with a write queued stalls every other client's emulator traffic
  for tens of seconds, and the whole run with it. That a copy's commit is
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
rendered template needs them:

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

A service whose template reads it as a **signal** must be stubbed as a signal,
not as a method returning a fixed value — see the next section.

## Four traps that cost a day each

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
which `npm run material:check` fails (ADR 0128). Run it too.

### A real reload aborts the whole run

Karma ends the run the moment a spec reloads the page — "Some of your tests
did a full page reload!" — and every result after it is lost. The app reloads
on an account change it did not start ([auth.md](auth.md#an-account-change-this-page-did-not-start),
ADR 0163), from inside the auth-state listener, which fires whenever the SDK
calls back, not when a spec chooses. So the reload sits behind a root token,
`PAGE_RELOAD` (`core/services/page-reload.ts`), and **every TestBed that
builds the real `AuthService` provides a double for it**. Three suites do
today:

- `auth.service.spec.ts`: a `reload` spy in the outer providers, and `null`
  in the one child injector that stands for a device;
- `auth.service.smoke.spec.ts`: a spy in `stubProviders()`, which every block
  spreads. A block that lists its providers inline falls back to the real
  factory, and its first account change reloads the run away;
- `analytics.service.smoke.spec.ts`: an inert function, since it signs in
  once and never switches.

Every other suite provides an `AuthService` double and never builds the
listener. A fourth that builds the real one must provide the token too.
`page-reload.spec.ts` hands the factory a fake location, and never calls the
function the root injector resolves.

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

| | Base (`7b693953`) | After this wave |
|---|---|---|
| ERROR | 40 | 43 |
| WARN | 38 | 40 |
| LOG | 26 | **0** |

**Counting it.** Karma's progress reporter prints each console line twice, once
behind an ANSI rewrite and once plain, so `grep -c 'ERROR: '` reports exactly
double. **Halve the raw count**, or strip ANSI and dedupe. Any comparison must
use the same method or it reads as a doubling that did not happen.

LOG fell to zero because `no-console` now bans `console.log` outright; the five
new ERROR/WARN lines are expected-failure paths in new specs. **Rendering
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
