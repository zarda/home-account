# 23. The initial bundle carries only the entry route

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #197, #198, #199

Reference documentation lives in [../performance.md](../performance.md).

## Context

`npm run build:prod` had been printing a budget warning on every run: 3.52 MB
initial against a 3.25 MB threshold. The one signal that would catch a size
regression was already red, so it caught nothing — and the threshold itself
had been raised to fit the app rather than to bound it, which is how it got
there.

Three separate causes, none of them subtle once the chunk table is read.
Five of the six pages under the layout were eager `component:` entries, so
the first paint of any route downloaded all of them. `ExportService` is
rooted and imported `jspdf` at module scope to serve one button. And
`provideCharts(withDefaultRegisterables())` pulled the whole Chart.js
registry — polar area, radar, bubble, scatter and their scales — into an app
that draws doughnut, line and bar.

## Decision

**Every page below the shell loads on demand.** The `ai`, import and
`search-history` routes already did; the remaining six now match them. The
auth guard sits on the parent route, so laziness changed no access control,
and nothing outside `app.routes.ts` referenced the six components. Rejected:
a router preloading strategy to warm the chunks after boot — it hands back
most of the parse cost on the slow devices the change is for, and the
service worker already prefetches (see Known gaps).

**A dependency that serves one button is imported inside the function that
needs it.** `jspdf` and `jspdf-autotable` now load in `exportToPDF`, the way
`pdf-raster.utils.ts` already loads `pdfjs-dist` and the provider services
load their SDKs. That method had no test at all, so a spec that renders a
real PDF landed with it — otherwise the load quietly failing to happen would
have looked exactly like success. Rejected: making `ExportService` non-root
and providing it per-route — it would scatter the same dependency across
three lazy chunks instead of one and leaves the module-scope import intact.

**The chart pieces are listed by hand, and the specs share the list.** The
seven spec and smoke files that configured charts each built their own
registry from the defaults, so none of them could have caught a wrong list;
they all provide `provideAppCharts()` now. This matters most for `Filler`,
which is the one piece whose absence throws nothing — the areas under the
spending-analysis lines simply stop being shaded. That component's suites
all replace its template, so its chart had never been drawn by a test;
one of them now draws it and checks the filler attached to the dataset meta.
Rejected: keeping the default registerables and accepting the weight, which
is roughly what the raised budget had been doing.

**The budget is set below the achieved size.** 2.31 MB achieved, 2.45 MB
warning, in both the `production` and `production-local` configurations.
A threshold above the current size is documentation, not a gate.

## Consequences

Initial total went from 3.52 MB to 2.31 MB, and the transfer estimate from
740 kB to 510 kB. Six new route chunks appear in the build output, the
largest being reports at 146 kB.

Analytics `screen_class` reads the activated route snapshot's component,
which the router fills in from the loaded component only after a lazy route
resolves. It still reports each page's own selector, but that was worth
proving rather than assuming: the route smoke now asserts it on a real
navigation.

## Known gaps

- `ngsw-config.json` prefetches `/*.js`, so an installed PWA still fetches
  every chunk at service-worker install. What this decision buys is the
  first-paint parse and execute cost, and a budget that works again — not
  fewer bytes over the wire for a returning installed user. Narrowing the
  prefetch is a separate decision with its own offline trade-off.
- The budget is the only automated size signal. It catches a jump past the
  threshold, not a slow creep beneath it.
