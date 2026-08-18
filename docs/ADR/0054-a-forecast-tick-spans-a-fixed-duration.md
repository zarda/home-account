# 54. A forecast tick spans a fixed duration

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #268

Bounds the chart described in
[0022](0022-the-forecast-baselines-at-zero-today.md), whose today seam this
preserves, and keeps the horizon seam that
[0026](0026-every-period-window-comes-from-one-helper.md) makes the occurrence
query close on. Reference documentation lives in
[../forecast.md](../forecast.md).

## Context

`buildForecastSeries` clamped the start forward to today when the period began
in the future, and put no floor under it when the period began in the past. The
period's end was never consulted at all: the walk always terminated at today
plus the horizon.

So the series length was governed by how far back the period started. Picking
2015 from the period selector's custom year picker — which has no `min` or
`max`, so any year is selectable — with a 90-day horizon drew roughly 4,300
daily points. The projection, the only thing the tab exists to show, was the
last ninety of them, about two percent of the width. Everything before that was
the selected year's actuals accumulating, followed by an eleven-year horizontal
run carrying no information at all, because there are no transactions between
the period's end and today.

Nothing crashed and nothing stalled. The loop always terminated, points were
drawn with `pointRadius: 0`, and the category scale thinned its own ticks. The
costs were that the tab was unreadable for any period that had already closed,
and that every label was formatted individually — a few thousand
`Intl.DateTimeFormat` calls per recompute. "This Year" viewed in December is
the mild everyday version of the same shape.

## Decision

**The series is walked one whole day at a time and then folded into buckets of
a fixed number of days, chosen so the whole span fits under a ceiling of 200
points.** Every tick spans the same duration, on both sides of today.

The ladder is 1, 7, 30 and 365 days, narrowest first. The fold is pure index
selection over the finished daily arrays — each plotted value is the running
cumulative on its bucket's **last day**, never a recomputation and never an
average.

Three properties are preserved by construction rather than by care:

- **The walk is untouched**, so it stays whole-day and DST-safe. Bucketing
  selects from what it produced; it cannot reintroduce millisecond arithmetic.
- **Boundaries are walked outward from today**, so one lands exactly on it and
  0022's "the two lines meet at today's tick" still holds.
- **Index 0 and the last index are always emitted**, so the chart still opens
  on the period start and still closes on today plus the horizon — the seam
  the occurrence query agrees with under
  [0026](0026-every-period-window-comes-from-one-helper.md).

At rung 1 the fold selects every index, so a period inside the ceiling plots
exactly as it did before this existed.

### Why fixed day counts and not calendar months

A calendar month runs 28 to 31 days. Month buckets would make one tick span
more time than the next, which is precisely what this ladder exists to prevent,
and they would drag in the Jan 31 → Feb 28 clamping problem. Fixed counts step
with `addDays`, already the DST-safe primitive in this file.

### The alternatives that were rejected

**Flooring the start at today minus the horizon.** The smallest possible
change, and it makes the chart symmetric around today. But it silently drops
the front of the period the user selected: the actual line would no longer
start where the period starts, and the cumulative shown would be a
window-local total rather than the period's. Preserving the full span was the
requirement.

**An empty state for a closed period.** Honest about what the tab knows — the
projection is always from today, so a closed period's actuals are stale
context. Rejected because it makes the tab blank rather than useful, and it
does nothing for "This Year" in December, which has not closed and shows the
same shape.

**Bucketing the history and leaving the projection daily.** This is the option
that would actually make the projection readable: on a category scale, 90 daily
points beside 140 history buckets give the projection roughly 39% of the width
instead of 2%. Rejected because it makes the x axis non-linear in time — one
step left of today would be a month while one step right is a day — and a
chart that compresses time without saying so is the same class of invention
that 0022 refused when it declined to draw a balance line.

**Bucketing only the empty gap between the period end and today.** The most
faithful of the alternatives, and the gap genuinely carries no information. It
needs the period end threaded into the builder, adds a third region to reason
about, and does nothing for "This Year" in December, which has no gap yet.

## Consequences

- The chart costs at most 200 points and at most 200 `Intl.DateTimeFormat`
  calls, whatever period is selected.
- Every tick means the same number of days, so the horizontal distance between
  two points is comparable anywhere on the chart.
- **The projection's share of the width is unchanged.** Under one granularity
  for both sides it is `horizon / span` whichever rung is picked, so a period
  that closed years ago still spends most of its width on history. This is the
  accepted cost of the decision, not an oversight: the readable number for
  that case is the projected-net figure beside the chart, which states what the
  schedule adds up to over the horizon regardless of how thin the line is.
- Labels carry the year only when the span crosses more than one, so an
  ordinary period is not cluttered with it.
- `ForecastSeries.days` is now `bucketEnds`, and the interface carries
  `bucketDays`. The array stopped being one entry per day, and a name saying
  otherwise would have outlived the change.
- When a point spans more than a day the chart says so beneath it, so a reader
  is never left to infer the width from the tick spacing.

## Things that only became apparent while building

- The fold needs no special case for rung 1. Walking outward from today in
  steps of one selects every index, so "unbucketed" is not a branch — it is
  the ladder's first rung. The DST case, which asserts its full day list,
  passing unaltered is what demonstrates it.
- Bucketing a *cumulative* series is easier than bucketing a rate: there is
  nothing to sum or average, because the running total on the bucket's last day
  already is the bucket's value. The temptation to average only exists if you
  forget the series is cumulative, and averaging would produce a number in no
  day's ledger.
- The rung the 2015 case lands on is 30 days, not 365. An earlier estimate
  reached for the top of the ladder; 365 only engages for a period opening more
  than about fifteen years back.

## Known gaps

- The year picker still has no `min` or `max`, so a period centuries wide is
  still selectable. The ladder bounds the chart for anything under about two
  hundred years, and beyond that the top rung stops holding the ceiling. Fixing
  the picker is the narrower change and is not made here.
- A closed period's actuals are still stale context for a projection that
  starts today. Bounding the chart makes that legible rather than resolving it;
  what the tab should show for a period that has ended is a separate question.
