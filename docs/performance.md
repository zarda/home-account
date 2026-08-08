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
`build:ios` uses the second one and they would otherwise drift.

| | Warning | Error |
|---|---|---|
| Initial bundle | 2.45 MB | 2.7 MB |

Against an achieved 2.31 MB. To re-measure after a change that could move
it:

```bash
rm -rf dist && npm run build:prod
```

Read the `Initial total` row. A budget set from an incremental build is
worse than no budget, hence the `rm -rf`. If a deliberate change moves the
number, move the budget in the same commit and say what bought the space —
a budget quietly raised to fit the app stops being a gate, which is the
state this one was in before it was lowered.

## Known gaps

- `ngsw-config.json` prefetches `/*.js` in its `app` asset group, so the
  service worker still downloads every lazy chunk at install time. Lazy
  routes cut what the browser parses and executes on first paint, and they
  restore the budget as a working signal; they do not cut the bytes a
  returning installed PWA has already fetched in the background.
- Nothing measures the initial bundle in CI beyond the budget. The budget
  catches growth past a threshold, not a steady creep beneath it.
- There is no bundle-analysis script. Attributing a regression means
  reading the chunk table from `build:prod` and grepping `dist/` for the
  symbol, as the `jsPDF` check in ADR 0023 did.
