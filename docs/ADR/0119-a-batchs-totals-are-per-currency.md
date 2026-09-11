# 119. A batch's totals are per currency

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #414

Reference documentation lives in [../receipt-import.md](../receipt-import.md)
and [../import-fields.md](../import-fields.md).

Extends [0117](0117-every-doors-figure-is-whole-in-its-currency.md), which
made every row's figure whole in the currency of the row, and
[0059](0059-one-mapper-builds-every-imported-transaction.md), whose rule —
one place builds what the import writes — is what makes a single fold
possible here.

## Context

An import batch is not in one currency. The review card has carried a
per-row currency since 0062, the doors fall a missing one back to the
account's base and mark it, the currency chip re-denominates a row, and the
bulk action re-denominates several. Two surfaces then added those rows up.

The confirm step's summary:

```html
<span class="card-value">+{{ selectedIncome() | currency }}</span>
<span class="card-value">-{{ selectedExpenses() | currency }}</span>
```

`selectedIncome` and `selectedExpenses` reduced the selected rows' raw
amounts to one number each, and Angular's `currency` pipe with no code
prints dollars. A JPY 179 row and a USD 4.13 row selected on a TWD account
read *+$0.00 Income* and *-$183.13 Expense* — a figure of no currency at
all, wearing a symbol the account has never used.

The Import History list had the same habit on a stored record —
`+{{ item.totalIncome | currency }}` — and the record is the deeper half of
the problem: `ImportHistory` carries `totalIncome` and `totalExpenses` and
**no currency**. The write summed the saved rows the same way, so the number
on the card and the number in the record were the same sum of nothing, and
the list had no way to render it correctly even in principle.

## Decision

**One fold, per currency, used where the figure is shown and where it is
stored; and the record learns to carry a currency.**

```ts
export function sumByCurrency(
  rows: readonly { amount: number; currency?: string; type: 'income' | 'expense' }[],
  baseCurrency: string
): ImportCurrencyTotals[]
```

It lives in `import-review.utils.ts` beside the other folds the review step
runs over its rows, keys on `row.currency || baseCurrency`, accumulates into
a `Map` so the order out is first-seen order, and rounds each total on the
way out with 0117's own `roundToMinorUnit` — a sum of whole figures in one
currency is already whole, and the round is there for the one that was not.
Its parameter is structural, so the confirm step's review rows and the
write's saved rows both satisfy it with no cast.

### The confirm step renders one line per currency

`selectedIncome`/`selectedExpenses` are gone. `selectedTotals` is the fold
over the selected rows, and `incomeLines`/`expenseLines` are one formatted
string per currency with a figure above zero on that side, through
`CurrencyService.formatCurrency` — the app's own formatter, which takes the
code — rather than a pipe that assumes one. A side with nothing on it still
gets a line, a zero in the account's base currency, because the summary is a
fixed three cards across and an empty one reads as a rendering fault.

### The record carries `totalsByCurrency`

```ts
totalsByCurrency?: ImportCurrencyTotals[];   // { currency, income, expenses }
```

`confirmImport` collects the rows it actually saved — pushed beside the
`transactionIds.push(savedId)` that was already there, inside the per-row
`try` and past the write — and folds those. So a refused row is in the ids,
in the counts and in the totals in exactly the same way: not at all.

Import History reads the field when a record has it, one line per currency
with a figure, and falls back to the scalar pair rendered in the account's
base currency when it does not. `baseCurrencyOf` answers `USD` for a null
user, so a list rendered before the profile lands has a code rather than a
crash.

`firestore.rules` gains one optional validator in `importOptionalsValid` —
`(!('totalsByCurrency' in d) || d.totalsByCurrency is list)` — which is the
file's idiom for an optional field and is read by both the create and the
update validator.

### Converting to the base currency was rejected, and this is the reason

The dashboard converts; it can. Its figures come off stored transactions,
each carrying the rate snapshot taken when it was written. A review row has
no snapshot — it has not been written yet — so a conversion here would have
to ask the live rate table, and that table is
`new Map([['USD', 1]])` until the first fetch lands. A confirm step rendered
before rates arrive would have summed every currency 1:1 and printed a
confident total in the base currency's symbol: exactly the defect in the
issue, with better manners. There is no moment at which summing per currency
needs a rate, so there is no moment at which it can be wrong about one.

### The other alternatives

- **Rendering the scalar pair with the batch's dominant currency.** It is
  one line and one symbol, which is what the layout wants, and it is a lie
  in a different font: the sum is still across currencies.
- **Storing a base-currency total beside the per-currency list.** It needs
  the rate at write time, which the write could take — and then the record
  would carry a figure that is right on the day and drifts afterwards, with
  nothing on screen saying which day it was right on.

## Consequences

- **The merge deploys rules.** One optional line in `importOptionalsValid`
  is still a rules change, and rules ship with the merge that changed them
  ([0077](0077-merges-deploy-what-they-changed.md)). The field is optional in
  both validators, so nothing that was accepted before is refused now.
- **The scalar pair is still written, unchanged.** A one-currency import
  reads it correctly, it is what every record written before this change
  has, and removing it would have made every one of those records
  unreadable. It is a fallback for the list, not a figure anything computes
  from.
- **No `| currency` remains in the import feature.** Both bare pipes are
  gone; every figure on these two surfaces goes through `formatCurrency`,
  which is the rule 0117 already applied to the card.
- **Both templates track by `$index`.** A formatted money string is its own
  identity, so `track line` re-creates the whole list on every selection
  tick — measured at ~24 `NG0956` warnings in one smoke run against 0 with
  `$index`, the same 23 cases passing either way. `$index` is already the
  history template's idiom.

## Things that only became apparent while building

- **The first-seen-order case could not fail.** Its fixture was a JPY row
  then a USD row, and `'JPY' < 'USD'`, so an alphabetical sort produced the
  identical expectation while the case's own comment claimed the order was
  not alphabetical. Reworked so the currency that sorts *last* is seen
  *first*, and proved by injecting a `.sort()` into the fold: exactly the
  one case went red in each of the two files that assert order, and both
  came back green when it came out.
- **Rules cannot say anything about a list's elements.** `is list` is the
  whole of what the rule can assert; there is no way to require that each
  entry has a `currency`, an `income` and an `expenses`. The accept/reject
  pair mirrors `transactionIds` — a well-formed list allowed, a bare string
  denied — and the shape of an element is the client's contract alone.
- **The read-back is what proves the deployed rules, not the client.** The
  smoke case reads the completed record back and finds
  `[{ currency: 'USD', income: 0, expenses: 1114 }]` from two saved rows
  (556 and 558), with the deselected row and the refused one in neither
  figure. Had the rules refused the field, the write would have been denied
  and the record left pending.

## Known gaps

- **A legacy mixed-currency record is still a sum of nothing.** It now wears
  the account's base-currency symbol instead of a dollar sign, which is less
  wrong rather than right: the figure was computed across currencies and no
  rendering can repair it. Only a record written before this change is
  affected, and nothing backfills.
- **No base-currency figure for an import exists anywhere.** Not on the
  confirm step, not on the record, not in the list. A reviewer importing in
  three currencies gets three lines and no single number, which is honest
  and is not what a "total" usually means.
- **`totalsByCurrency` is written unconditionally**, so a batch that saved
  nothing stores `[]` where every neighbouring optional (`transactionIds`,
  `receiptsSkipped`) is written only when non-empty. `[]` is a `list`, the
  rules take it, and the list reads an empty-but-present field as a zero in
  the base currency — correct for a record that landed nothing, and a small
  asymmetry if the record shape is ever tightened to "absent means nothing".
- **`totalLines` is a template method that builds its formatter every
  call** — up to four hundred `Intl.NumberFormat` constructions per change
  detection cycle at the list's 200-record limit, where the pipe it replaced
  was pure and memoised. Not measured against a real list; recorded because
  the next person to profile that page should know where to look first.
- **`sumByCurrency` does not take an absolute value** where `importAmount`
  does, so a negative row amount would sum negative here and positive in the
  write. Pre-existing in the scalar pair and unchanged by this record; no
  door produces one today, because 0117 rounds every row through
  `importAmount` before it reaches the card.
- **Nothing asserts that two currency lines stack on screen.** The wizard's
  unit template is a stub, and the smoke addition reads the stored record
  rather than the card. `.card-content` is a column flex, so they should;
  that is a reading of the stylesheet, not a measurement.
