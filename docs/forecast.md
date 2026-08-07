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
  zone-shifted `test:dates` runs.

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
