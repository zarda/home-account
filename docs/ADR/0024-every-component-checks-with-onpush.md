# 24. Every component checks with OnPush

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #196

Reference documentation lives in [../performance.md](../performance.md).

## Context

`OnPush` was set on 2 of 76 components. The other 74 ran default change
detection, which re-checks every binding in the tree on every event, timer
and network response — while 57 of them were already signal-driven and
OnPush-safe by construction.

## Decision

**Every component under `features/` and `shared/` declares `OnPush`, and a
lint rule keeps it that way.** `@angular-eslint/prefer-on-push-component-change-detection`
is an error. The rule is the point: a component left on default is not a bug
anyone would notice — it produces no wrong output, only work the browser
repeats — so it needs a gate rather than a convention. Rejected: adopting it
only on the heavy screens, which is where the measurable win would be if
there were one, but leaves the invariant unstatable and unenforceable.

**View state written after an `await` becomes a signal; everything else stays
as it is.** Four components wrote plain fields from async callbacks and read
them in their templates — the AI settings page (stored keys and the three
provider test results), the export dialog's spinner, the profile name
rollback on a failed update, and the app lock clearing a wrong pin. Under
OnPush none of those repaint. Fields written only from event handlers or
`ngOnChanges` were left alone: both already mark the view dirty, and
converting them would have been churn with no behavioural difference.
Rejected: converting every `@Input()`/`@Output()` decorator to the signal
equivalents at the same time. OnPush does not require it — an input binding
marks the child dirty either way — and it would have rewritten roughly 250
assertions in specs that currently pass untouched.

## Departures from the issue

Issue #196 asked for a profile showing fewer change-detection cycles after
the migration. **There is no such reduction to report.** Measuring one
dashboard period toggle with `ng.ɵsetProfiler` on the dev server, before and
after:

| Interaction | Default CD | OnPush |
|---|---|---|
| Period toggle (template updates) | 117 | 122 |
| Click on inert page area | 40 | 40 |
| 6 seconds idle | 0 | 0 |

The differences are noise. The app is signal-driven end to end with zero
`async` pipes, and `provideZoneChangeDetection({ eventCoalescing: true })` is
already in place, so Angular's signal-based view marking was doing most of
this work before the strategy changed: idle costs nothing under either, and
the refreshes that do happen are driven by events dispatched inside the very
views that then repaint — which marks them dirty either way.

So what this bought is not speed today. It is an invariant that holds as the
app grows: default change detection degrades with tree size and with any
state that is not a signal, and the four components fixed above are proof
that such state does appear. The lint rule is what makes it a property of
the codebase rather than a snapshot.

Recording the null result rather than a favourable-looking number is
deliberate — the next person to profile this will get the same figures.

## Consequences

The unit suite passes unchanged: 3566 specs, no assertions rewritten.
`fixture.detectChanges()` checks a view whether or not anything marked it
dirty, so field-mutation specs keep working under OnPush — which is also why
they prove nothing about it. The route smoke gained the coverage instead: it
drives the period toggle on real routed UI and waits for the totals to
change and come back.

## Known gaps

- `header.component.ts` keeps plain fields for its scroll bookkeeping. They
  run inside `runOutsideAngular` and are never template-bound; the visibility
  they feed is already a signal.
- `transaction-filters` and `transaction-form` still hold a
  `ChangeDetectorRef`. Both call `markForCheck()` against Material's
  datepicker, which caches `dateClass` results outside anything Angular
  tracks. That is the one sanctioned reason to keep one.
- `llmProviderPreferences` on the AI settings page stays a plain object: its
  two-way bindings write into its properties, and it is assigned
  synchronously in `ngOnInit` before the first check.
