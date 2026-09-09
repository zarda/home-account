# 109. A hand-typed amount is whole in its currency

**Status:** Accepted, implemented · **Date:** 2026-09-10 · **Issues:** #394

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0099](0099-the-review-step-edits-what-it-shows.md): the amount editor
it built settles the figure, and this is what "settled" means when the row's
currency has no cents.

## Context

`roundMoney` rounds to two decimals whatever currency the figure is in. It is
the right rule for what it was written for — a base-currency aggregate, where
everything has already been converted — and the wrong one for a row.

The review card had no other rounding at all. `parseAmountInput` reads
whatever decimals are typed, and the amount editor wrote them straight onto
the row. So `179.33` typed on a JPY row stored `179.33`, and
`formatCurrency(179.33, 'JPY')` rendered `¥179` — a figure on the card, a
different figure in the document, and no way for the reviewer to see the
difference. Every sum built on those rows drifted by the hidden thirds of a
yen: the confirm step's own income and expense figures, the period totals
afterwards, and the reconciliation against the paper receipt the reviewer was
holding.

The split inherited it exactly. `splitImportRow` computed its remainder with
`roundMoney`, so a JPY row split by `179.33` left a remainder rounded to the
cent, and both halves carried decimals a yen cannot hold. 0106 recorded this
as a known gap — "a decimal typed into a zero-decimal currency is stored with
it" — and pointed at the amount editor as its origin.

The app already knew each currency's precision: `currencyDecimalPlaces(code)`
resolves it out of Intl's own data, with an override table for the handful
Intl gets wrong, and the display side has used it for as long as amounts have
been formatted. Nothing on the write side asked.

## Decision

**`roundToMinorUnit(value, code)` in the currency model, applied at every
chokepoint where a figure becomes a row's amount on the card — the amount
editor and the split, where the reviewer typed it, and the merge, where two
row amounts are netted — always in the row's own currency; and a figure that
rounds to nothing is refused rather than written.**

### One helper, in the currency model

```ts
export function roundToMinorUnit(value: number, code: string): number {
  const factor = 10 ** currencyDecimalPlaces(code);
  return Math.round(value * factor) / factor || 0;
}
```

It sits beside `currencyDecimalPlaces` because that is the fact it is about,
and its doc comment names the two functions it is *not*: `roundMoney`
(transaction aggregation) rounds a base-currency aggregate to the cent
regardless of any row's currency and goes on doing so, and `snapDisplayZero`
(money display) is its display-side twin — the same factor off the same
`currencyDecimalPlaces`, agreeing exactly on which values are zero, but only
ever touching what is shown.

The `|| 0` is load-bearing twice. `Math.round(-0.4)` is `-0`, which fails an
`Object.is` comparison against `0` and would render with a leading minus; and
a non-finite input produces `NaN`, which the fold turns into a plain `0` —
the property `splitImportRow`'s guard now leans on so its `remainder` can
never be `NaN`.

### The three chokepoints

| Where | What it rounds |
|---|---|
| `commitAmount` | the parsed figure, before it is compared with `row.amount` or written |
| `splitImportRow` | the figure taken, once, up front — and `row.amount − taken` the same way |
| `mergeImportRows` | the signed net of the two amounts |

`commitAmount` rounds **before** the `amount === row.amount` short-circuit, so
`179.33` typed on a JPY row already showing `179` compares equal and closes
having changed nothing — which is the truth — while a row at `179` typed
`179.33` emits nothing for the same reason. Rounding after the comparison
would have written a value the comparison had already decided was different.

`splitImportRow` rounds the figure and the remainder each once and judges the
**rounded remainder**, not a separately-rounded `row.amount`: the two roundings
can disagree by a minor unit, and a guard built on the latter passes splits
that then produce a kept row at zero — the failure 0106 recorded twice.

### A figure that rounds to nothing is refused, on every row

`commitAmount` sends a rounded `0` down the same path an unreadable figure
takes: the row joins `amountRejected`, the editor is held open and marked
`aria-invalid`, and the `role="alert"` line under it says why. `0.4` on a JPY
row is refused, not written as zero.

`import.amountNotANumber` is reworded for both refusals it now covers —
**"Enter an amount — at least {{minimum}}"** — with the floor bound through
`minimumAmountText(row)`, which formats `10 ** -currencyDecimalPlaces` in the
row's own currency the same way `formatAmount` does: ¥1, $0.01, KWD 0.001. A
reviewer comparing the two figures on screen never sees them spelled
differently.

The split's refusal names the same floor: **"Enter an amount smaller than the
row's — at least {{minimum}}"**, one message for both of `splitImportRow`'s
refusals, since a figure that would leave nothing behind and one that rounds
to nothing are the same mistake from the reviewer's side.

### `canSplit` hides a trigger every figure would refuse

A split has to leave two positive figures at least a minor unit apart, so a
row worth less than twice that unit has no valid split at all. `canSplit(row)`
is `row.amount >= 2 * 10 ** -currencyDecimalPlaces(row.currency)`, and the
trigger renders only under it. Without that, a ¥1 row would offer a control
whose only possible refusal reads "at least ¥1, smaller than ¥1".

### Departure: a figure that rounds to nothing is refused, not written

The plan for this record said a figure rounding to nothing "leaves the row
unfilled" — written as `0`, caught afterwards by the unfilled gate that holds
Continue. #394's own text said *refuse*. The plan's premise was that the gate
already refuses it, and reading it against the code found that premise silent
on the case that matters: on a row **already at amount 0** — a blank
hand-added row, an empty CSV cell — the write is a no-op behind
`amount === row.amount`, so the editor closed having shown nothing at all for
a figure the reviewer had just typed. The reviewer's own hand was the only
evidence anything had happened.

So the rule is refusal on every row, filled or blank (the user's call,
2026-09-09). It costs the reviewer an explicit Escape to keep the old figure,
which is the one way the old figure is now kept deliberately, and it makes the
three ways an amount can fail — unreadable, rounds to nothing, would leave the
row's remainder at nothing — behave identically: editor open, marked invalid,
message under it.

The split departs from #394 the other way and by the same reasoning: a
non-whole split figure is **rounded** at the chokepoint rather than refused
(the user's call, 2026-09-09), because `179.4` on a JPY row is an
unambiguous ¥179 and refusing it would be refusing arithmetic the app can do.
Only a figure that rounds to something the row cannot spare is refused, and
that refusal names the minimum.

### The alternatives that were rejected

- **A currency parameter on `parseAmountInput`.** It reads a string into a
  number and has callers with no row in hand; rounding is a fact about the
  destination, not about the parse.
- **Refusing fractions outright** — telling a reviewer who typed `179.4` on a
  JPY row that it is not a valid amount. It is a valid amount; the currency
  simply cannot hold the fraction, and rounding is what every other part of
  the app already does with it on screen.
- **A new rejection reason** for "rounds to nothing", beside the unreadable
  one. Two messages for one shape — an editor held open on a figure that
  cannot become this row's amount — and the reviewer's next action is the same
  either way.
- **Rounding at the mapper instead.** It would leave the card showing a figure
  the write disagrees with, which is the defect, moved.

## Consequences

- **The card and the document agree for a typed figure.** What
  `formatCurrency` renders is what `toCreateTransactionDTO` writes, for the
  amount editor, the split and the merge alike.
- **`-0` cannot reach a row.** The fold makes it an unsigned zero, which is
  then refused by the rule above rather than written.
- **A `NaN` row amount can no longer produce a `NaN` remainder.** The split's
  guard reads `!(remainder > 0)`, and the helper's fold is what keeps
  `remainder` a number at all.
- **The split trigger is absent on the smallest rows**, ¥1 and $0.01 alike, in
  a strip whose other triggers are also conditional.
- **Three catalogs carry a `{{minimum}}` placeholder** on two keys, and both
  are bound through `minimumAmountText(row)` — a per-row value, so the message
  is right on a batch that mixes currencies.

## Things that only became apparent while building

- **The "the gate already refuses it" premise was silent on a row at zero.**
  This is the whole of the departure above, and it was invisible from the
  plan's own worked example, which used a filled row throughout.
- **The split guard's comment described an impossible `NaN`.** It explained
  what would happen if `remainder` came out `NaN`, which the helper's `|| 0`
  makes unreachable; the fold is now documented on the helper, beside the `-0`
  case it was written for, and the guard's comment says what it actually
  guards.
- **A ¥1 row would have been offered an incoherent refusal**, which is what
  `canSplit` exists for. The wording of the refusal is what exposed it: the
  message only reads sensibly when a valid figure exists.
- **The obvious spec case was vacuous.** "JPY 179.33 typed as 179" passes with
  or without the rounding, because the parse alone already gives 179. Its
  inverse is the real case: a row **at** 179, typed `179.33`, must emit
  nothing — and only the rounded comparison makes that true.
- **`snapDisplayZero` is the display-side twin, not an unrelated helper.** The
  first comment on `roundToMinorUnit` called it unrelated; it uses the same
  factor off the same `currencyDecimalPlaces` and agrees exactly on which
  values are zero. Saying so is what keeps a future change to one of them from
  silently disagreeing with the other.

## Known gaps

- **`updateCurrency` does not re-round.** Changing a row from USD to JPY
  leaves an amount of `179.33` on it, stored as it was and rendered `¥179` —
  the same disagreement this record closes for typed figures, reopened by a
  currency edit. Filed as a follow-up.
- **The doors still write unrounded figures.** The scan and CSV paths write
  `Math.abs(t.amount)` with no currency rounding (`ai-import.service.ts`), so
  a scanned JPY `179.33` arrives on the card stored at `179.33` and shown
  `¥179`. Everything this record fixes is about figures the *reviewer* typed;
  a figure that was *read* stays as it arrived until it is edited. Filed as a
  follow-up.
- **`roundMoney` still governs base-currency aggregates**, and should: those
  figures are in the account's base currency by construction, and rounding
  them to a row's currency would be wrong.
- **A row whose currency has more than two decimals is proven at the unit
  level only.** KWD's three places are exercised by the helper's own spec, by
  the split and merge cases and by `minimumAmountText`; no fixture carries a
  KWD row through a real import.
