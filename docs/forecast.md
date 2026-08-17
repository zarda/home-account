# Cash-flow forecast

The Forecast tab on Reports projects the recurring rules forward: scheduled
occurrences over the next 30, 60, or 90 days, blended with the selected
period's actuals, as one running-net line chart. It is a *live projection
from declared rules* — unlike the Insights tab, which runs detectors over
history and persists snapshots, the forecast stores nothing and recomputes
on every look
(see [ADR 0022](ADR/0022-the-forecast-baselines-at-zero-today.md)).

## What is plotted

- **Actuals to date** (solid): the selected period's transactions as a
  cumulative net, from the period start up to today.
- **Projected change** (dashed): the cumulative net of scheduled
  occurrences, **starting at zero on today's tick**. The dataset split at
  today is deliberate — the solid line ending where the dashed one begins
  is the today marker.

Each plotted point is the running total on the **last day it stands for**.
That is one day per point for an ordinary period; see
[Granularity](#granularity) for the wider ones.

**Why zero at today:** the app has no account-balance concept — periods
have income and expense, nothing global carries an opening balance. A line
that pretended to be a balance would be an invented number. What the
schedule honestly knows is the *direction and size of upcoming change*, so
that is what the chart shows, and the on-page note says so.

## The seam rules

- Occurrences **on or before today are dropped** from the projection. The
  catch-up engine posts those as real transactions
  (see [recurring.md](recurring.md)); counting them in the projection as
  well would double them at the seam.
- Occurrences past the horizon are dropped; the horizon toggle (30/60/90
  days) swaps the underlying listener rather than stacking subscriptions.
- Days are walked as local calendar days, never raw millisecond
  arithmetic, so DST transitions neither skip nor duplicate a tick. The
  series builder (`forecast-series.utils.ts`) is covered in both
  zone-shifted `test:dates` runs. Bucketing happens *after* the walk and
  only selects from it, so it cannot reintroduce millisecond drift —
  which is why the bucket rungs are counted in whole days rather than
  calendar months.
- The occurrence query closes on the **last millisecond of the final day
  the chart draws** — `endOfDay(addDays(startOfDay(now), horizonDays))`,
  the ADR 0026 rule — so the supplier and the builder agree on where the
  horizon ends. While the query closed `N × 24h` from the current instant
  instead, the two disagreed from the current time of day to the end of
  that final day: an occurrence stamped later in the day than "now" was
  absent, the final tick rendered flat, and `projectedNet` was short by
  that rule's amount until the page was reloaded later in the day. Across
  a DST fall-back the whole final day dropped (#267).

## Granularity

The chart draws **at most 200 points**, whatever period is selected
(see [ADR 0054](ADR/0054-a-forecast-tick-spans-a-fixed-duration.md)). The
builder walks whole days as it always has, then folds the finished arrays
into buckets of a fixed width, picking the first rung of **1, 7, 30, 365
days** that fits under the ceiling.

| Period (90-day horizon) | Rung |
|---|---|
| This Month | 1 day |
| This Year, seen early in the year | 1 day |
| This Year, seen in December | 7 days |
| A past year, e.g. 2015 | 30 days |
| A period opening more than ~15 years back | 365 days |

Three things the fold does not disturb, by construction:

- **It selects, never recomputes.** A bucket's value is the running
  cumulative on its last day — a figure the daily walk actually reached.
  Averaging a cumulative series would produce a number in no day's ledger.
- **Boundaries are walked outward from today**, so one lands exactly on it
  and the two datasets still meet there (ADR 0022).
- **The first and last points are always emitted**, so the chart still
  opens on the period start and still closes on today plus the horizon.

At rung 1 the fold selects every index, so a period inside the ceiling
plots exactly as it did before bucketing existed — this is not a special
case in the code, just the ladder's first rung.

When a point spans more than a day the chart says so beneath it.

**What this does not fix.** One granularity is used on both sides of
today, so the projection's share of the width is `horizon / span`
whichever rung is picked — a period that closed years ago still spends
most of its width on history. That is the accepted cost of every tick
meaning the same duration; the readable number for that case is the
projected-net line beneath the chart. ADR 0054 records the alternatives.

## Multi-currency

Occurrence amounts convert to the display currency at current rates;
actuals use their write-time base-currency snapshot (`amountInBase`), the
same split the rest of the app uses.

## Lifecycle

The tab body sits behind `matTabContent`, like Insights and for the same
reason: `getNextOccurrences` opens a live Firestore listener (and
republishes the shared recurring signal), so it must only exist while the
tab does. The subscription closes on horizon change and on destroy.

## Known gaps

- Amounts are taken as scheduled; variable-amount rules (a fluctuating
  utility bill) project at their configured amount.
- Only *declared* rules project. A detected-but-unconverted subscription
  is invisible here — converting it from the Patterns tab
  (see [recurring.md](recurring.md), "From detection to a rule") brings it
  into the forecast.
- No persistence: there is no history of what past forecasts predicted.
- The period selector's year picker has no `min` or `max`, so any year is
  selectable. The rungs bound the chart for anything under roughly two
  centuries; past that the top rung stops holding the ceiling.
- A period that has already closed still pairs stale actuals with a
  projection that starts today. Bucketing makes that readable rather than
  resolving it.
