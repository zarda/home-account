# 26. Every period window comes from one helper

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #201

Reference documentation lives in [../dates.md](../dates.md).

## Context

`transaction-date.utils.ts` shipped eighteen tested date helpers, and the rest
of the app computed its period boundaries by hand anyway. Four confirmed bugs
were each a defect in one of those private copies, and in each case the correct
implementation already existed in the utils module, unused: #167 was a month
overflow that `addMonths` clamps, #171 a clamp applied inconsistently within a
single function, #173 a missing `clampToEndOfToday` that the reports tab
already applied, #174 a `dayKey` written as `toISOString().split('T')[0]`.

The reason the copies existed is worth stating plainly, because it is the thing
that has to change: the module offered *scalars* — a start of month, an end of
month — while what callers actually needed were *windows*, and a start and an
end that are derived independently can disagree. The period selector alone had
twelve hand-written boundary expressions producing five windows, and it is the
origin of every period in the app; the issue counted four files and undercounted
by five.

Two of those copies had also drifted. The selector and the dashboard closed
their windows at `23:59:59` flat, while everything reached through the utils
closed at `23:59:59.999`, so the same named period had two different ends
depending on which code path asked.

## Decision

**Windows are the unit, and there is exactly one implementation of each.**
`monthWindow`, `yearWindow`, `weekWindow`, `periodWindow`, `clampWindowToNow`,
`previousPeriodWindow` and `budgetPeriodWindow` all return a `DateWindow` whose
start and end are computed together. A caller can no longer hold a start from
one rule and an end from another, which is the shape all four bugs took.
Rejected: per-caller wrapper helpers that each compose the primitives locally —
that is precisely the arrangement that produced four divergent copies, and it
fails in the same way the fifth time.

**No date library.** The primitives here are dependency-free, already tested,
and already run under two shifted zones in CI; the bugs were never in the
arithmetic that a library would have replaced, they were in *which* arithmetic
each caller reached for. Rejected: adopting date-fns or Luxon — it would add
weight to a bundle already against its budget (ADR 0023) for a problem it does
not solve, and would leave the app with two idioms during the migration.

**Every window closes on the last millisecond of its final day.** The two
`23:59:59` sites are widened rather than the `.999` ones narrowed. This is a
deliberate behaviour change in a refactor and it is the only one: it widens the
upper bound by 999 ms, which is strictly more inclusive, and it fixes a real if
narrow defect — a transaction posted in the final second of a month was outside
the month it belonged to. Rejected: keeping both and documenting the
difference — the point of the exercise is that consumers of the same named
period agree, and a documented disagreement is still a disagreement.

**The period vocabulary moves to the models barrel.** `PeriodOption`,
`CustomPeriod` and `PeriodSelection` live in `models/period.model.ts`, so the
utils can resolve a window without importing a component; the selector
re-exports them so its consumers are unchanged. Rejected: leaving the types on
the component and duplicating a structural equivalent in the utils — two
declarations of the same contract is the defect this record is about, in a
different medium.

**The Firestore emulator is where the bounds are proved.** A unit spec compares
a Date to a Date, which is the comparison that cannot fail. What decides
whether a row is inside its period is Firestore comparing a stored `Timestamp`
against the bound the client sent. `period-window.smoke.spec.ts` seeds a row on
the first millisecond of a month, one on `23:59:59.999`, and one a single
millisecond later, and asserts every query path returns the first two and never
the third.

## Departures from the issue

The issue's acceptance criterion — "no date-boundary arithmetic outside
`transaction-date.utils.ts`" — is met for the two audit greps, but the sweep
reached nine files rather than the four named: the quick filters, the insight
chips, the natural-language search scope, the Firestore range queries, the
forecast day cursor and the relative-date formatter all had their own
boundaries too.

## Known gaps

- Weekly budgets window on the anchor's weekday but label with an ISO week
  number, which always starts on a Monday. The mismatch is preserved and
  documented rather than corrected: the label is display-only, and moving a
  rendered value under cover of a refactor is worse than the inconsistency.
- A yearly budget anchored on 29 February still moves to 1 March in a common
  year. The monthly arm clamps; the yearly one never did, and this was not the
  change to start.
