# 33. A stored figure is re-taken only when its input moved, and its unit never moves under it

**Status:** Accepted, implemented · **Date:** 2026-08-11 · **Issues:** #246, #252, #256

Reference documentation lives in [../money-snapshots.md](../money-snapshots.md).

## Context

ADR 0027 gave a linked transaction a converted figure of its own and wrote the
rule that keeps it honest: "an edit that touches amount or currency
re-snapshots, and one that does not leaves the figure alone — a conversion at
today's rates must not move a counter the user never touched." The rule was
right. It was implemented as a test of **which keys the caller supplied**:

```ts
if (data.amount !== undefined || data.currency !== undefined) { … }
const linkInvolved = 'goalId' in data || !!currentTransaction?.goalId;
```

`TransactionForm` is the app's only transaction editor, and it builds its DTO
unconditionally — amount, currency, period, goalId and tags all travel on every
edit, because an omitted key would leave a cleared select at its old value.
Every one of those guards was therefore true on every edit, and none of them
has ever fired in the shipped app. Three defects follow, and they only look
unrelated:

- Fixing a typo in a foreign-currency row re-snapshotted its exchange rate at
  today's rate. A €100 dinner recorded in March at 1.08 became worth $116
  instead of $108 after an August description edit, and March's reported spend
  rose with it — in the dashboard, the reports, and every month-over-month
  comparison (#246).
- The same edit moved a linked goal's counter, because `stageGoalTransition`
  re-derived "did the money change?" from the fields that block had just
  written (#246).
- The `goalId` gate sent every edit, linked or not, through `runTransaction`,
  which requires the network. Editing a description offline failed and queued
  nothing, for every row in the ledger (#256).

The suite could not see any of it. Every spec drove a narrow object —
`updateTransaction('txn-1', { note: 'monthly top-up' })` — and against that
shape all three guards hold. The specs asserted the correct behaviour against
a DTO the app never produces.

Underneath sits a second question ADR 0027 never asked. It treats a goal's
currency as a stable conversion target, but nothing made it stable: the goal
form let it be changed at any time, including after money was against the goal.
Switching it relabelled `contributedAmount`, `linkedAmount` and every linked
row's stored `goalAmount` without converting them — 300,000 yen of progress
rendering as $300,000, a barely-started goal reading as complete. The next
write to any linked row then subtracted a figure snapshotted in the old
currency from a counter now read in the new one; the counter floors at zero, so
it did not throw, it just collapsed (#252).

## Decision

**A guard on "did this change?" compares values against what is stored.** Key
presence answers "did the caller mention it", which is a different question,
and a form-built DTO mentions everything. `updateTransaction` already reads the
row before the guard, so the comparison is free. The one comparison it makes is
then *passed into* `stageGoalTransition` rather than re-derived there: deriving
it a second time from the update payload happens to work now only because the
new gate makes that payload truthful, and the next writer to set
`updateData.amount` for any other reason would break it silently.

Rejected: making the form diff its own form value. It leaves every other caller
unguarded, and it moves an invariant out of the service that owns it.

**A derived counter recomputes; a counter without provenance freezes its
unit.** Budget `spent` is fully derived — `recalculateBudgetSpent` rebuilds it
from the ledger and converts into the budget's currency — so a currency change
simply re-derives it, and `currency` joins the fields that trigger that. A
goal's counters cannot be rebuilt: `linkedAmount` is a sum of figures already
converted and stored on the rows, and `contributedAmount` has no per-row
provenance at all (ADR 0021's standing gap). So the goal's currency is fixed
once either counter is non-zero — the form disables the control and says why,
and `GoalService.updateGoal` drops a change rather than rejecting the save, so
the name and target edited alongside it still land. The gate is on the counters
and not on edit mode, so a goal created with the wrong currency can still be
corrected while it is empty.

Rejected: re-converting every linked row and both counters at today's rates.
ADR 0027 already rejected the underlying move, and no conversion can
reconstruct manual contributions, which have no provenance to convert. If
changing a funded goal's currency is genuinely wanted later, the honest shape
is a new goal, not a mutation of this one.

**Two presence tests that look identical answer different questions.** The gate
in `updateTransaction` must test the value. The `'goalId' in data` test inside
`stageGoalTransition` must stay a presence test: it separates "clear the link"
(key present, value undefined) from "the caller did not mention it" (key
absent), and truthiness collapses those into an unlink. They read a few hundred
lines apart and look like the same line, so each now carries a comment naming
the other.

## Consequences

- A row whose base-currency snapshot is missing, or stamped against a base
  currency the user has since changed, now keeps that stale snapshot through an
  unrelated edit. This is the intended division of labour, not a new gap:
  `CurrencyService.amountInBase` already falls back to a live conversion for
  all three untrustworthy cases at read time, and `resnapshotBaseCurrency` owns
  the wholesale rewrite when the base currency preference changes.
- Unlinked edits are offline-capable again, and cost one document read instead
  of two. Linked edits still commit through `runTransaction`, as ADR 0027
  requires.
- A goal's currency is now effectively write-once in practice, since most goals
  acquire money early. The contribute dialog remains the only way to move
  `contributedAmount`, so there is still no path back from a wrong currency
  other than a new goal.

## Things that only became apparent while building

- The budget half of #252 was already harmless, for a reason nobody chose:
  `updateBudget` recalculates when `categoryId` is present, and the budget form
  always sends it. The bug was real in the service's contract and invisible
  through the only caller. Adding `currency` to the trigger list makes the list
  honest rather than fixing a live symptom.
- Specs that seed exchange rates identical to the compiled-in fallback table
  cannot tell a figure that held still from one recomputed to the same number.
  The rates seeded in `beforeEach` were also being overwritten by the
  constructor's failed refresh landing a microtask later, and neither was
  visible because both produced 0.92.
- The counter's floor at zero is what makes the mixed-unit subtraction survive
  as data loss instead of an error. Any test of it has to assert the value; one
  that only asserts the write succeeded passes against the broken code.

## Known gaps

- `recomputeLinkedAmount` still sums the per-row snapshots, so it repairs a
  drifted counter but cannot repair a goal whose currency was changed before
  this ADR. Any account already in that state needs manual arithmetic through
  the contribute dialog.
- Nothing prevents a currency change on a goal whose counters are both zero but
  which has linked rows summing to zero. There is no such shape today.
- The transaction form still builds its DTO unconditionally. That is deliberate
  — the presence contract is what makes clearing a select work — but it means
  any future guard added in this service must compare values, and only a
  comment says so.
