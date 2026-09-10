# 117. Every door's figure is whole in its currency

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #401, #399

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0109](0109-a-hand-typed-amount-is-whole-in-its-currency.md) and
closes the two gaps it filed as follow-ups — "`updateCurrency` does not
re-round" and "the doors still write unrounded figures". The other two 0109
listed stand, and are restated below.

## Context

0109 made a **typed** figure whole in the currency of the row it is typed on:
`179.33` on a JPY row commits as 179, and a figure that rounds to nothing is
refused into an editor that stays open and says the minimum. It said plainly
what it had not done: "Everything this record fixes is about figures the
*reviewer* typed; a figure that was *read* stays as it arrived until it is
edited."

So rounding lived on the review side only, and two ways round it were left.

**The doors.** Three of the four builders wrote `Math.abs(t.amount)` and
nothing else; the strategy converter wrote the reading's signed amount
verbatim and let the write take the sign off. A
receipt read as ¥179.33, a consolidated group summing to ¥300.8, a CSV cell
holding `179.33`, a backup row carrying a legacy fraction — each landed on the
card stored fractional and rendered `¥179`. The card's own duplicate check
compares amounts, the split trigger's floor is measured in minor units, the
confirm step's totals add them up, and the write stores whatever it was
handed. Only a reviewer who happened to retype the figure ever made it agree
with the screen.

**A currency change.** `updateCurrency` and `applyCurrencyToSelected` wrote a
new code onto the row and left the amount alone, so a `179.33` row switched
from USD to JPY kept its fraction under a currency with no place for one — the
same disagreement 0109 closes for a typed figure, reopened by a menu.

And there is a door with no builder in front of it at all: the offline queue
drain writes rows that never saw a review step.

## Decision

**One helper, called where a figure is born and again where it is written, and
a currency change re-rounds.**

```ts
export function importAmount(raw: number, code: string): number {
  return roundToMinorUnit(Math.abs(raw), code);
}
```

It wraps 0109's own `roundToMinorUnit`, which takes the currency's decimal
places off the same table `currencyDecimalPlaces` serves the editor from, and
it folds in the absolute value most of the doors were already taking. It lives
in `import-dto.utils.ts`, beside the resolvers the same builders call.

### Where a figure is born

The four builders call it: the strategy converter, the multi-image
consolidation's row build, the JSON backup door, and the shared
`categorizeTransactions`. So the row that reaches the card carries the figure
that will be stored, and the card, the duplicate check, the split floor and
the confirm totals are all reading the same number the ledger will hold.

The strategy converter now takes an **absolute** value it never took — it used
to pass the reading's sign through and let the write flip it. The row's `type`
is the reading's own, so a negative reading keeps being an expense (or an
income) on the strength of what it said, not of its sign.

The CSV door's intermediate mapping is deliberately untouched: it builds
`ExtractedTransaction`s that go straight into `categorizeTransactions`, which
is one of the four, so rounding there as well would be the same call twice
with nothing between them.

### And again where it is written

`toCreateTransactionDTO` calls it too. Rounding an already-rounded figure
returns it, so the second call costs nothing on the three doors that have a
builder; it is there for the fourth, the offline queue drain, which writes
without a review step and had no builder to round at. The DTO's `type` is
derived *before* the absolute value is taken, so a signed raw amount can still
decide a type where nothing else did.

### A currency change re-rounds

`updateCurrency` and `applyCurrencyToSelected` write `roundToMinorUnit(amount,
code)` beside the new code — the amount on the card is already absolute, so
the helper 0109 uses is the whole of it. `acceptCurrencySuggestion` delegates
to `updateCurrency`, so accepting an offer is the same path.

A figure that rounds to nothing on a switch **leaves the row unfilled**. That
is deliberately not the typed figure's answer: the editor 0109 holds open and
marks invalid does not exist here, because the currency chip is a menu and
there is nothing to refuse into. An unfilled amount is a state the card and
the gate already describe — the muted placeholder, the Continue hint, the
count on the confirm summary.

### The alternatives that were rejected

- **The DTO alone.** One call site, and everything before the write keeps a
  figure the screen contradicts: the duplicate check compares the fraction,
  the split floor measures it, and the confirm totals add it. The card is
  where the reviewer decides, so the card must hold the real figure.
- **A helper per door.** Four copies of `Math.round(x * 10 ** places)`, and
  0109's `roundToMinorUnit` already existed one import away. The reason 0109
  gives for one helper — that `snapDisplayZero` must agree with it about which
  values are zero — applies to a fifth copy as much as to a second.
- **Refusing a currency change that would lose the figure.** It puts a modal
  or a disabled menu item in front of a menu, to protect a number the reviewer
  is in the middle of restating; the unfilled row says the same thing and can
  be typed into.

## Consequences

- **The data hub's CSV re-import rounds too**, because it writes through the
  same mapper: `ExportService.parseImportedData` maps every row through
  `toCreateTransactionDTO`, so a legacy fractional yen row is written whole on
  re-import. Pinned in `export.service.spec.ts` — 12.5 JPY against a USD base
  imports as 13, on the row's own currency rather than the account's.
- **The `/data` JSON restore does not.** `BackupRestoreService` builds its DTO
  by hand: it works from a stored `Transaction` rather than an import row,
  deliberately drops the receipt fields, and pairs the write with options the
  import mapper knows nothing about — the document's own id, `merge`, a
  preserved `createdAt` and the stored rate snapshot. It therefore
  writes `transaction.amount` as the file holds it. A backup taken before this
  change restores its fractions unchanged, which is the restore's contract:
  the file is a copy, and a restore puts the copy back. The wizard's picker is
  the door that rounds.
- **A currency switch that moves the amount fires the duplicate re-check.**
  `onTransactionsUpdated` flags a row changed on `prev.amount !== row.amount`,
  which is the rule every amount edit already follows; a switch between whole
  figures changes nothing and fires nothing.
- **The `330.9` fixture reads 331.** Consolidation prefers a printed receipt
  total and rounds nothing itself; the builder is what makes the figure whole,
  and the case says so.
- **`toCreateTransactionDTO` folds a NaN amount to 0** where it used to write
  NaN, because `roundToMinorUnit` ends in `|| 0`. Strictly better — the rules
  refuse both — and the Continue gate already counts a non-positive amount as
  unfilled.

## Things that only became apparent while building

- **The mapper is a wider chokepoint than the wizard.** Its callers are the
  wizard's confirm, the offline drain *and* the data hub's CSV import; adding
  the round at the write therefore changed a door that was not in either
  issue. That is the right outcome and it needed a case of its own to be a
  documented one rather than a side effect.
- **The obvious negative-strategy case did not discriminate.** A negative
  reading typed `type: 'expense'` passes whether the type came from the
  reading or from the sign. The case carries `type: 'income'` on a negative
  amount instead, so only a kept type makes it pass.
- **`importAmount(0.4, 'JPY')` is `+0`, not `-0`.** `roundToMinorUnit`'s
  trailing `|| 0` is what normalises it, which matters because the unfilled
  test and the display-zero helper both compare against zero.
- **The currency had to be hoisted out of the spread at all four builders.**
  Each of them wrote `...resolveImportCurrency(…)` inline, so the code the
  amount must be rounded to did not exist until after the amount was written.
  The resolution is now a local the amount line reads and the spread still
  carries — a mechanical change that touched every builder and is invisible in
  the result.

## Known gaps

- **A currency whose minor unit is thousandths is proven at the unit level
  only.** 0109's gap, unchanged in kind: KWD's three places are exercised by
  `importAmount`'s own spec and by the card's currency-switch cases, and no
  fixture carries a KWD row through a real import.
- **A backup restored through `/data` keeps its fractions.** By design, as
  above — but it means two doors in the same app disagree about the same file,
  and the disagreement is only discoverable from this record and
  [../backup-restore.md](../backup-restore.md).
- **`roundMoney` still governs base-currency aggregates**, and should: those
  figures are in the account's base currency by construction.
