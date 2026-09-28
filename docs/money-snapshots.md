# Stored money: what is a snapshot, and when it is re-taken

Several figures in the app are **money already converted and written down**,
not money converted at the moment you look at it. Each was stored deliberately
— a total that re-converts at read time changes when the market moves, and two
screens that convert at slightly different moments disagree — but a stored
figure has two obligations a live one does not:

1. It is expressed in **some unit**, and something has to stop that unit
   moving underneath it.
2. It goes stale, so something has to decide **when it is re-taken** — and
   re-taking it too eagerly is its own bug, because a conversion at today's
   rates moves a total the user never touched.

This page is the answer to both questions for every stored-money figure in the
app. The rule that ties them together is
[ADR 0033](ADR/0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md):
**a figure is re-taken only when the thing it was computed from actually
moved, and that is decided by comparing against what is stored — never by
asking which fields a caller happened to send.** The only transaction editor
in the app sends every field on every edit, so a guard that tests for the
presence of a key is a guard that is always open.

## The base-currency snapshot on a transaction

`exchangeRate`, `amountInBaseCurrency` and `baseCurrency`, written by
`TransactionService` (`addTransaction`, `updateTransaction`).

**Unit:** the account's base currency at the moment of writing, recorded in
`baseCurrency` so a later reader can tell whether the stamp still applies.

**Re-taken when** the row's `amount` or `currency` actually changes —
compared against the stored row, not against the keys the DTO carries. A
description, category, tag, note, date or receipt edit leaves all three alone.

**Read through** `CurrencyService.amountInBase`, which prefers the stored
figure but falls back to a live conversion in the three cases where it cannot
be trusted: no snapshot at all (rows written before it existed), a
`baseCurrency` stamp that does not match the current preference, and a corrupt
cross-currency snapshot — a 1:1 rate between two different currencies, which
can only come from unloaded rates at write time.

**Read by** the figures over transactions already written: the dashboard's
totals, the transaction list, the reports page's tabs and cards, both PDF
exports and the category summary file, budgets' `spent`, the period total the
AI summary card hands its advice request, and the totals the spending-summary
prompt quotes — the income, expenses, category breakdown and largest expenses
`CloudLLMProviderBase.generateSpendingSummary` builds for every provider. The
report PDF, the category, country and recurring breakdowns and both halves of
the AI summary moved over in
[ADR 0148](ADR/0148-every-figure-names-its-rate.md) — each had converted every
row at today's rate, so the two PDFs of one period could print different
totals, and the summary could quote totals the dashboard around it did not
show. The same prompt's budget limits and goal amounts still convert at
today's rate: they are a budget's and a goal's own figures, not written rows,
and carry no snapshot to read.

**Three figures over scheduled money cannot read it, and say so.** A
scheduled occurrence is not a written row, so a figure over money that has
not moved yet has no snapshot to prefer: the Upcoming card's *Scheduled net*,
the weekly recap's bills due and the forecast's projected net. They convert
at today's rate through `CurrencyService.convert`, and each carries **At
today's rate** (`common.atTodaysRate`) beside the figure — the forecast's
actuals, which are written rows, still read their snapshots.

**The household page cannot read it either, by decision.** A row shared into
a household reaches the other members as a copy that carries its amount and
currency as entered and never the snapshot: the snapshot is in its author's
base currency, which says nothing to a member with another base and would
tell every member what the author's is, and leaving it out means a
base-currency change never has to touch a copy
([ADR 0157](ADR/0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)).
So each viewer sees every shared row, each member's totals and the combined
totals in their own base, converted from the copy's own amount at today's
rate — exactly when the copy is already in that base — and every figure that
converted something carries **At today's rate**. None of it is stored: the
page folds the figures from the copies as it reads them, and a change of
rates refolds them. Until the rate table has settled on a source it
converts every currency 1:1, so the page holds a copy in another currency
out of every figure and waits rather than count it at that placeholder
([household.md](household.md#figures-on-the-page)). A household's own
budgets and goals are converted the same way, into the plan's currency
rather than the viewer's (see
[below](#a-households-figures-are-folded-at-read)).

**Repaired by** `TransactionService.resnapshotBaseCurrency`, which rewrites
every row when the base-currency preference changes. That is why the guard
above can leave a stale-stamped row alone: the read path already handles it,
and the wholesale rewrite has an owner.

Rates are never snapshotted against the unloaded fallback table — every write
path awaits `ensureRatesLoaded()` first, or it would stamp a real cross-rate
as 1:1 and poison the corruption check above. Which table those writes
convert through — the live fetch, the device cache, or the compiled-in
constants — is the initialization ladder in
[exchange-rates.md](exchange-rates.md).

## The converted figure on a linked transaction, and the goal's counters

`goalAmount` on the transaction; `linkedAmount` and `contributedAmount` on the
goal. See [goals.md](goals.md) and
[ADR 0027](ADR/0027-a-linked-transaction-carries-its-converted-amount.md).

**Unit:** the **goal's** currency — for all three figures. This is the unit
that cannot be allowed to move, and the reason is that neither counter can be
rebuilt from anything:

- `linkedAmount` is a sum of figures already converted and stored on the rows,
  so re-deriving it in a new currency would need every row re-converted at
  today's rates — the exact move ADR 0027 rejected.
- `contributedAmount` has **no per-row provenance at all**. It is one number
  moved by the contribute dialog. There is nothing to convert.

So a goal's currency is fixed once either counter is non-zero: the goal form
disables the control and says why, and `GoalService.updateGoal` drops a
currency change rather than rejecting the whole save. A goal with no money
against it can still be corrected. Changing it on a funded goal used to
relabel rather than convert — 300,000 yen reading as $300,000 — and the next
linked write then mixed the units and floored the counter at zero.

**Re-taken when** the linked row's amount or currency actually changes, by the
same comparison as the base-currency snapshot. Every counter change commits in
the same `runTransaction` as the row write, so the link and the counter cannot
disagree.

**Repaired by** `GoalService.recomputeLinkedAmount`, which rewrites
`linkedAmount` as the sum the ledger actually carries. Its only production
caller is the backup restore pass, which is what makes restoring twice, or
over a live account, impossible to double-count. It repairs a drifted counter;
it cannot repair a wrong unit, because it sums the same stored figures.

## The spent counter on a budget

`spent` on the budget document, written by
`BudgetService.recalculateBudgetSpent`.

**Unit:** the budget's currency.

This one is the exception that explains the rule: `spent` is **fully derived**.
The recompute reads the expense rows in the budget's period, takes each row's
base-currency figure through `amountInBase`, and converts once into the
budget's currency. Nothing about it is unrecoverable, so its currency does not
need freezing — a currency change simply re-derives it, which is why
`currency` sits alongside `categoryId`, `period`, `startDate` and `endDate` in
the list of fields that trigger a recalculation on `updateBudget`.

**Re-taken when** anything it is derived from changes: which rows it counts
(category, period, dates), the currency it is expressed in, or the rows
themselves — posting, editing or deleting an expense schedules a recompute for
the affected budgets.

Note it sums the rows' **stored** snapshots rather than re-converting each row
live. Budgets have to agree with the dashboard and the reports, and `spent`
must not drift when rates move without any transaction changing.

## A household's figures are folded at read

A household's own budgets and goals (`households/{hid}/budgets` and
`/goals`) each carry a `currency`, picked when the plan is made (the maker's
base unless they choose another) and never changed afterwards: a budget's
limit and every contribution to a goal are entered in it, so a change would
relabel them rather than convert them. The rules hold it to three capital
letters when the plan is made and refuse an update that touches it, and
the edit dialog shows the control disabled. Every figure on
the plans is folded when the page reads the shared copies, and none is
written down
([ADR 0160](ADR/0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md)).

- **A household budget's spent** is the expense copies dated in its current
  window whose bucket, or the bucket's group, is one of its categories, each
  in the budget's currency: exactly when the copy is already in it, at
  today's rate otherwise. There is no stored `spent`. A stored one would be
  written by whichever member's client wrote last, while two members write
  at once and each reads the period in their own time zone
  ([ADR 0154](ADR/0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md));
  folded at read, it needs no writer, and each viewer's window is their own.
- **A household goal's progress** is the copies linked to it, converted into
  the goal's currency the same way, plus the contributions members recorded
  on it. A contribution is the one stored amount here: one document per
  contribution, entered in the goal's currency and written once, never
  converted. Its unit cannot move, as a personal goal's counters' cannot
  once non-zero, and the household goal's currency is fixed from its
  creation, before any contribution can exist.

Both carry **At today's rate** when any amount they include was converted,
and one that converts reads *Counting…* until the rate table has settled on
a source.
The trade is the one this page's rule warns about, taken knowingly: a
converted figure moves when rates move with no transaction changing, and the
caption says so, because a copy holds no snapshot to prefer.

## Summary

| Figure | Denominated in | Re-taken when | Repaired by |
|---|---|---|---|
| `exchangeRate`, `amountInBaseCurrency`, `baseCurrency` | account base currency, stamped on the row | the row's amount or currency actually changed | `resnapshotBaseCurrency`; `amountInBase` falls back live at read time |
| `goalAmount` on a linked row | the goal's currency | the row's amount or currency actually changed | `recomputeLinkedAmount` (restore only) |
| `linkedAmount` | the goal's currency — **frozen once non-zero** | in the same transaction as any linked row write | `recomputeLinkedAmount` (restore only) |
| `contributedAmount` | the goal's currency — **frozen once non-zero** | only by the contribute dialog | nothing; no per-row provenance |
| `spent` on a budget | the budget's currency | category, period, dates or currency changed, or a counted row moved | `recalculateBudgetSpent`, any time |
| `amount` on a household goal's contribution | the goal's currency — **fixed from the goal's creation** | never: written once, and the rules refuse an update | nothing; a wrong one is deleted and recorded again |

## When you add another one

Two questions, in this order.

**Can it be rebuilt from the ledger?** If yes, give it a recompute and let its
unit change freely. If no, freeze the unit at the point money first lands on
it, and say so in the UI — a control the user can move that silently corrupts
a total is worse than a disabled one.

**What decides that its input moved?** Compare against what is stored. Do not
test which keys the caller sent, and do not re-derive the answer a second time
further down the call path — pass the one comparison along. Both mistakes are
invisible in a spec that drives a narrow object, and both are live the moment
a form sends a complete one.
