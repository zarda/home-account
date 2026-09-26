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
| Driven browser | `docs/e2e.md` | The app as shipped, signed in, at a real viewport — against production, or against the emulators where a journey needs two accounts | Nothing automatic; it is a written protocol, not a suite |

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
  client's. Every case starts from pointer-free profiles and fresh household
  ids, because specs run in random order.
- **Services: two full stacks.** A service smoke spec builds the second
  account's services in a child `EnvironmentInjector`, as
  `transaction-receipts.smoke.spec.ts` does. Two full clients is the most one
  file holds, for the same connection reason.
- **The browser: the emulator serve.** `npm run start:emulators` serves the
  app's committed `emulators` configuration on port 4300 against the local
  emulators, and `node docs/ui-audit/tools/seed-household.mjs <file outside the
  repo>` seeds two accounts and writes their session records. The driven
  journeys that need both are [e2e.md](e2e.md)'s 58 to 66
  ([ADR 0155](ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md)).

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
the bug the describe exists to catch. `imports: [Component, NoopAnimationsModule]`,
and every service the *template* reaches stubbed.

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
  `localeDate` or `localeNumber`. Deliberately not `Intl`: the output is stable
  text a spec can assert whole, and it does not move when a Node or ICU upgrade
  changes a separator.

A service whose template reads it as a **signal** must be stubbed as a signal,
not as a method returning a fixed value — see the next section.

## Three traps that cost a day each

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
path.**

### `auth.service.ts` — exempt, at 54.04 % statements

`FirebaseAuthentication` is a `registerPlugin` **Proxy over an empty target**
(`@capacitor/core` `dist/index.cjs.js:161`). `spyOn` reads an `undefined`
property descriptor and throws, so three call sites are **unreachable in
Karma**: `signInWithGoogleNative` (`:361`), the native `reauthenticate` arm
(`:468`), and `deleteFirebaseUser`'s plugin sign-out (`:495`) — about 21
statements. The `signInWithPopup` / `reauthenticateWithPopup` ESM call sites
(`:347`, `:481`) are unspyable for the same reason.

What covers them instead is `auth.service.smoke.spec.ts`, 622 lines against the
real emulator — and `test:ci` excludes smoke, so none of it counts toward the
figure. This is the same situation the suite already excuses for
`firestore.service.ts`.

Retrofitting an injectable seam onto the sign-in path — the cure
`NativeAnalyticsTransport` already uses for its dynamic import — is production
surgery, and was deliberately not done for a coverage number.

The reachable half **is** covered: `getOrCreateUser` on both arms including ADR
0052's `stillSignedInAs` guard, `updateUserPreferences`' dotted-path loop,
`clearUserPreferences`' `deleteField()` loop, `clearStoredProviderApiKeys`,
`updateUserProfile`, and `signOut`'s catch.

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
