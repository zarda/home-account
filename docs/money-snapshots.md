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

## Summary

| Figure | Denominated in | Re-taken when | Repaired by |
|---|---|---|---|
| `exchangeRate`, `amountInBaseCurrency`, `baseCurrency` | account base currency, stamped on the row | the row's amount or currency actually changed | `resnapshotBaseCurrency`; `amountInBase` falls back live at read time |
| `goalAmount` on a linked row | the goal's currency | the row's amount or currency actually changed | `recomputeLinkedAmount` (restore only) |
| `linkedAmount` | the goal's currency — **frozen once non-zero** | in the same transaction as any linked row write | `recomputeLinkedAmount` (restore only) |
| `contributedAmount` | the goal's currency — **frozen once non-zero** | only by the contribute dialog | nothing; no per-row provenance |
| `spent` on a budget | the budget's currency | category, period, dates or currency changed, or a counted row moved | `recalculateBudgetSpent`, any time |

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
