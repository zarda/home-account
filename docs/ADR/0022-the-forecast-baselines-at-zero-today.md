# 22. The forecast baselines at zero today

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #60

Reference documentation lives in [../forecast.md](../forecast.md).

## Context

Reports were entirely backward-looking, while the recurring rules make the
near future projectable — `getNextOccurrences` existed with no caller
outside its own spec (a gap ADR 0014 called out by name). The blocker
issue #60 flagged was the baseline: the app has no global account-balance
source. Periods have income and expense; nothing anywhere carries an
opening balance to project from.

## Decision

**The projection starts at zero on today's tick and shows cumulative net
change.** Rejected: anchoring the line at the selected period's
income-minus-expense so far — continuous with the period view, but the
starting number reads as an account balance it is not, and every
downstream value inherits the lie. A change-from-today line is the thing
the schedule honestly knows, and the chart note says exactly that.

**The seam belongs to the catch-up engine.** Occurrences on or before
today are excluded from the projection: the engine posts those as real
transactions, and a forecast that counted them too would double every
rule at the boundary. The period's actuals draw solid up to today; the
projection draws dashed from today; the dataset split is the today
marker. Rejected: the Chart.js annotation plugin for a today line — a new
dependency against a bundle already over its budget (#197) for a marker
the split provides.

**The tab is lazy and the listener is swapped, never stacked.** The tab
body sits behind `matTabContent` like Insights, because
`getNextOccurrences` opens a live listener and republishes the shared
recurring signal; a horizon toggle closes the old subscription before
opening the new window. Rejected: persisting forecasts as snapshots —
the insights snapshots exist because detector output over closed months
is history worth freezing; a projection is disposable by nature.

## Known gaps

- Variable-amount rules project at their configured amount.
- Detected-but-unconverted subscriptions are invisible to the forecast;
  the conversion path (ADR 0020) is the remedy, and the two features
  reference each other in their docs.
