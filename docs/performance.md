# Performance

What the browser downloads and parses before the first screen appears, and
what keeps it from growing back
(see [ADR 0023](ADR/0023-the-initial-bundle-carries-only-the-entry-route.md)).

## What ships eagerly

`index.html` loads `polyfills` and `main`. `main` carries the Angular
runtime, Firebase, Material, the app shell (`MainLayoutComponent`, header,
sidebar), the login page, the guards, and everything rooted services reach
at module scope.

Every page under the shell — dashboard, transactions, budgets, reports,
settings, about — is a `loadComponent` entry in `app.routes.ts`, so opening
one downloads that page and not the other five. `login` and the layout
itself stay eager: the layout renders the outlet the others load into, and
login is where an unauthenticated visitor lands.

No service worker caches or prefetches the app. The only service worker,
`public/share-target-sw.js`, answers the share-target POST and raises
reminders' notifications, and every other request goes to the network
([share-import.md](share-import.md)). The Angular service worker the
production build used to emit was never registered, so its prefetch of every
lazy chunk, which this page once counted as a cost, never ran, and it is gone
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).
A returning visitor's lazy chunks come from the network or from the HTTP
cache under Hosting's default headers.

## The heavy dependencies, and where each one loads

| Dependency | Size | Loaded by |
|---|---|---|
| `jspdf` + `jspdf-autotable` | ~388 kB | `ExportService.exportToPDF` |
| `pdfjs-dist` | ~434 kB | `pdf-raster.utils.ts` |
| `html2canvas` | ~203 kB | jspdf, on its own |
| `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` | — | the provider services' `loadSdk` |

The rule is the same in every case: a dependency that serves one screen or
one button is imported inside the function that needs it, never at module
scope. `ExportService` is the cautionary example — it is
`providedIn: 'root'` and is injected from three places, so a module-scope
`import 'jspdf'` reached the initial bundle no matter which route was open.

## Chart.js pieces

`CHART_REGISTERABLES` in `core/config/chart.config.ts` lists exactly the
controllers, elements, scales and plugins the app draws. The default
registry also carries polar area, radar, bubble and scatter, which this app
has never rendered.

A chart type added later must add its pieces to that list. Most omissions
fail loudly — an unregistered controller or scale throws on render — but
`Filler` does not: the shaded areas under the spending-analysis lines just
stop being drawn. `chart.config.spec.ts` names it for that reason, and
`spending-analysis.component.spec.ts` renders a real chart and checks the
filler attached.

Specs and smoke tests provide `provideAppCharts()` rather than their own
registry. A spec that registered the full set would pass against pieces
production does not ship.

## What a component declares

A Material module in a component's `imports: [...]` that its template never
uses is dead weight nothing could see. It puts that module's directives into
the component's template scope and its providers into the component's
injector, and it makes a claim about the template — *this one renders
chips* — that the next edit can falsify silently. Twenty such entries stood
across eighteen components before anything looked.

Nothing already in the repo could look. ESLint counts the symbol as used the
moment it appears inside the array; Angular's own `unusedStandaloneImports`
diagnostic is blind to NgModules by construction — it raises `NG8113` only
for a standalone directive, component or pipe, so no `Mat*Module` ever
reaches it.

Two gates cover the two halves.

**`npm run material:check`** (`scripts/check-material-imports.mjs`, a CI step
after *Check direction*) parses each `@Component`'s `imports:` array and the
template it declares, and fails when a listed Material module contributes no
selector that template uses. What it proves is bounded on purpose:

- A table maps **29 Material modules** to their full transitively-exported
  selector sets, spelled as the installed `@angular/material` spells them.
  `--self-test` (43 cases) asserts every string in it against the selectors
  the installed package actually declares, plus the three re-export edges it
  leans on (List → Divider, Input → FormField, Select → Option). A
  Material upgrade that renames a selector fails the self-test, where the
  fix is the table — not the app, where the fix would look like deleting a
  live import.
- Matching is lenient in every direction but one: an attribute selector
  matches on its attribute alone, bare and bound spellings both count, and
  commented-out markup counts as a use. Every leniency can only miss a dead
  entry, never invent one, so a clean run is a floor rather than a proof.
- What it skips is **counted and named in the output**: provider-only
  modules (`MatNativeDateModule` exports no selector, so a template says
  nothing about whether the component needs it) and any module not in the
  table. A live run prints `Checked 293 Mat*Module entries across 89
  components`, the skips, `No unparsed files.` and the findings. A file whose
  `@Component(` count exceeds the decorators the parser could read is listed
  as unparsed and fails the run: a component the gate cannot see is reported,
  never silently skipped.

**Adding a module to the table** is what you do the first time the app uses
a Material module it has not used before: add its name with the selector set
the package exports for it, and run `npm run material:check` — the self-test
fails on a misspelling immediately. Until it is in the table, its entries are
skipped and counted rather than checked, and the run says so by name.

**`unusedStandaloneImports: "error"`** in `tsconfig.json`'s
`angularCompilerOptions` covers the half Angular can see. It was measured at
zero before being raised — and probed, since a silent zero is not evidence a
check ran: a deliberately unused `RouterLink` raised `NG8113`, and the build
was clean again once it was removed. `"error"` rather than the default
warning breaks the **dev** build as well as CI, by design; a warning in an
`ng serve` scrollback is exactly the state the NgModule half had been in all
along. `tsconfig.spec.json` extends the root config, so spec test hosts are
held to it too.

The reasoning, and what each gate deliberately cannot see, is in
[ADR 0128](ADR/0128-a-material-module-a-template-never-uses-fails-the-build.md).

## Change detection

Every component declares `ChangeDetectionStrategy.OnPush`, enforced by
`@angular-eslint/prefer-on-push-component-change-detection`
(see [ADR 0024](ADR/0024-every-component-checks-with-onpush.md)).

Two rules follow from it:

- **View state written after an `await` must be a signal.** A plain field
  assigned in a promise callback will not repaint the view. Fields written
  only from event handlers or `ngOnChanges` are fine — both already mark the
  view dirty.
- **`markForCheck()` is for third-party imperative APIs only**, and gets a
  comment naming the API. The two current uses are Material's datepicker,
  which caches `dateClass` results outside anything Angular tracks.

Note what this did *not* buy. Profiling one dashboard period toggle before
and after showed 117 versus 122 template updates — noise. The app was
already signal-driven with no `async` pipes and event coalescing on, so
Angular's signal-based view marking was doing the work already. OnPush is
here as an invariant that survives growth and non-signal state, not as a
measured speedup. ADR 0024 has the full table.

Unit specs cannot see a stale view: `fixture.detectChanges()` checks a view
whether or not anything marked it dirty. The route smoke drives the period
toggle on real routed UI instead.

## The budget

`angular.json` carries an `initial` budget in both the `production` and
`production-local` configurations — the same numbers in both, because
`build:ios` uses the second one and they would otherwise drift;
`build-configurations.spec.ts` pins that they are equal.

| | Warning | Error |
|---|---|---|
| Initial bundle | 2.407 MB | 2.7 MB |

Against 2,406,611 bytes (JavaScript 2,375,720, stylesheet 30,891, in 58
initial files), measured by `npm run build:analyze` from a clean production
build on 2026-10-10. The warning came down from 2.472 MB to 2.408 MB when the
deprecated animations runtime went out: `provideAnimations()`, the
`@angular/platform-browser/animations` wrapper it pulled in and the
`@angular/animations` package behind it were 64,539 bytes of the initial
JavaScript, from 2,471,499 bytes before. The budget gave back 64 kB of that,
rounded down to the whole kilobyte, so the rest is headroom. Material and the
CDK animate with CSS and need none of it, and the specs turn motion off with
`provideNoMotion()` instead.

It came down once more, to 2.407 MB, when the removals of #437 took 1,075
bytes net off the 2,406,960 bytes the animations runtime's removal had left
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).
The removals were larger than that and some of what came in beside them is
eager: out went the background-sync seam nothing answers (in `PwaService` and
the offline queue), the monthly totals and the category getter of
`TransactionService` that nothing called, and the position, row-number and
free-text fields the import carried and nothing read. In came the shared
category fold, which `cloud-llm-provider.base` now imports from
`transaction-aggregation.utils` (a 2,593-byte initial chunk of its own), and
the opaque row-id helper that `recurring.service` and the offline queue reach
at startup (331 bytes).

That lowering ran ahead of the final figure. It was set when the drop was
1,075 bytes, and the branch's later code took some of it back: the net saving
since the animations runtime's removal is 349 bytes (2,406,960 less
2,406,611), less than the kilobyte the warning was lowered by. Two of the
later additions are pure split points of modules the initial graph already
held. The import history, a lazy chunk, came to import `importFailureKey` from
`import-review.utils.ts` for its error lines, and `parseAIError` with its
codes from `ai-error.utils.ts` to read the classifier's own sentences. A
module with a second, lazy importer is cut out of the chunk that held it into
one of its own, and the cut costs the export and import lines around it.
`import-review.utils.ts` is now a shared initial chunk of 4,445 bytes (+347)
and `ai-error.utils.ts` one of 3,078 bytes (+189). The last addition is not a
split. The offline queue card's count is taken again whenever the signed-in
account changes, so `OfflineQueueService`, an initial service, gained an
effect on the account, a `catch` for the recount's read and the release of
its handle on destroy: +192 bytes (2,406,419 to 2,406,611), 100 of them the
effect and 92 the `catch` and the release.

The warning stays at 2.407 MB. The final build leaves 389 bytes of headroom
under it, which is now less than the 501 bytes the main branch had under the
2.472 MB warning at `8a6e2c9a` (2,471,499 bytes). `about.component.ts` and
`feedback.service.ts` import `package.json` whole, but a version string of the
same length adds nothing of its own. The bump from 26.10.171 to 26.10.172 moved
the total from 2,406,421 to 2,406,419 bytes all the same, and all of it in the
entry chunk: the new content hashes left two fewer of the chunk file names it
imports with a ninth character. So a bump can still move the figure by a byte
or two.

The warning had stood at 2.45 MB until household sharing (#465) put the
initial bundle 12.85 kB over it, and moved by that much and no more. It then
moved, from 2.47 MB to 2.472 MB, when the theme, dashboard and
notification work of #436, #440, #442, #446 and #461 put it 1,499 bytes
over. That work grew the initial JavaScript by 5.9 kB and shrank the
stylesheet by 0.9 kB: the theme aliases came in and the palette ramp and
every palette utility went out. The JavaScript is what the first screen now
reaches without a route change: the `categoryGlyph` pipe the eagerly loaded
transaction form uses, `AuthService`'s field-level preference writes and
the re-read every writer merges through, the routes reminders carry and
the arming of the tap service (from an idle task on the web, at once in
the iOS app; the service itself is a dynamic import), the weekly recap's fold that the reminder sweep's nudge gate runs
(`ReminderService` is built at startup), the `?` shortcut and the palette's
inline Shortcuts section, the header's palette button and its one-time
hint, and the install prompt `PwaService` now holds.

The earlier move's space is code the first screen reaches without a route
change:
`FirestoreService`'s batch commit and server aggregate, the Firestore SDK's
`arrayUnion`/`arrayRemove` in the shared chunk, the transaction service's
follow-up that carries a shared row's edit to its copies, and the
transaction form's *Shared with* chips, which QuickAdd loads eagerly. The
service that shares and sweeps is reached by dynamic import, and the ones that
fold household figures load with the household page's own route, so neither
is in it. To re-measure after a change that could move it:

```bash
rm -rf dist && npm run build:analyze
```

Read the `Initial total` line it prints last: the exact bytes, and the
JavaScript and the stylesheet apart. The build's own chunk table rounds each
file to 0.01 kB and the total to 0.01 MB, which is too coarse when the
headroom is under a kilobyte. A budget set from an incremental build is worse
than no budget, hence the `rm -rf`. If a deliberate change moves the number,
move the budget in the same commit and say what bought the space — a budget
quietly raised to fit the app stops being a gate, which is the state this one
was in before it was lowered.

## What fills the initial bundle

`npm run build:analyze` (`scripts/analyze-bundle.mjs`) runs the production
build with `--stats-json`, which makes the builder write
`dist/home-account/stats.json`, and then reads that file. For every initial
output, largest first, it prints the ten inputs that put the most bytes into
it, and then the initial total. So when the figure moves, the line that
moved names the module, where before it meant reading the chunk table and
grepping `dist/` for a symbol, as the `jsPDF` check in ADR 0023 did.

"Initial" is the builder's own rule, mirrored from `@angular/build`: an
output that carries an entry point and is named `main`, `polyfills` or
`styles`, plus everything those reach through static imports, transitively.
A dynamic import is lazy however large its target, and a lazy chunk carries
an entry point too, so the entry point alone decides nothing. The total sums
every initial output's bytes, the stylesheet included, which is the sum the
initial budget is measured against. A metafile the script no longer
understands fails the run rather than printing a total over the wrong files.

Its `--self-test` checks that rule against an inline metafile and runs in
CI. The real run needs a production build, so it is local only
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).

## Known gaps

- Nothing measures the initial bundle in CI beyond the budget. The budget
  catches growth past a threshold, not a steady creep beneath it, and
  `build:analyze` runs only when someone runs it.
