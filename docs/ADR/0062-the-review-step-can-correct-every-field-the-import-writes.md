# 62. The review step can correct every field the import writes

**Status:** Accepted, implemented; amended by
[0099](0099-the-review-step-edits-what-it-shows.md) · **Date:** 2026-08-22 ·
**Issues:** #316

Builds on the row shapes and the single mapper of
[0059](0059-one-mapper-builds-every-imported-transaction.md). Reference
documentation lives in [../import-fields.md](../import-fields.md).

**Amended by [0099](0099-the-review-step-edits-what-it-shows.md).** This
record's title was ahead of its code: what shipped here was the currency —
the chip menu, the fallback marker, the offer and its remove control — while
the date, the amount and the description stayed read-only spans, which is to
say that none of the three graded fields could be corrected. 0099 makes them
editable on the card, on this record's own terms: the chip-not-dialog width
argument stands, every edit still goes through `replaceRow` and lands before
0059's mapper, and an edit now clears the `fieldConfidence` entry that
`replaceRow`'s comment here already described as "state an edit is supposed to
clear".

## Context

The review card standing between an extraction and the write let a reviewer
change four things about a row: whether it was selected, its type, its category
and its notes. The currency was not one of them. A receipt whose currency the
model misread, or could not read at all, had to be imported wrong and then
corrected one transaction at a time in the form — after the amounts had already
been converted and stored against a rate for the wrong pair.

The card could not even say which rows were at risk. `currencyFellBack` — the
flag that distinguishes a code somebody read from the account's base currency
standing in for one nobody did — existed on `ProcessedTransaction` and was
computed by the strategy lane, but it reached only the in-form scan, which uses
it to offer the currency of wherever the phone is standing. Every other route
lost it:

- **The wizard's own doors never computed it.** The photo, statement, PDF, CSV
  and JSON paths each wrote the source's code or the base currency in one `||`,
  and the difference between "USD" and "we had to pick something" was gone on
  that line.
- **The strategy hop dropped the one that was computed.**
  `convertStrategyResultToCategories` copied `tx.currency || baseCurrency` into
  the review shape, which had no slot for the flag, so the camera path arrived
  at the card knowing nothing either.

Underneath that, the card's amount was rendered through
`currency:row.currency:'symbol':'1.2-2'` — two decimals for every currency, so
a JPY or TWD row showed sub-units the currency does not have, on the one screen
whose job is to let someone check the figure.

And the row shapes had carried `tags` and `location` since 0059 with nothing
rendering them. A field a source could answer travelled to Firestore without
ever being shown to the person confirming the write.

## Decision

**Currency is edited on the card, per row and in bulk.** The date line carries
a chip that reads as data and opens as a menu: the picker's curated nineteen,
plus the row's own code when the curated list does not carry it, so a code the
extraction read is always reachable again. The header carries one bulk action
over the current selection, because a batch of photos from one trip is nearly
always one currency. The per-row menu goes through the card's existing
`replaceRow` seam and the bulk action rewrites the selected rows in one pass;
both clear `currencyFellBack`, because the user has now answered the question
the source could not.

**One helper decides the fallback, and every door calls it.**
`resolveImportCurrency(read, baseCurrency)` in `import-dto.utils.ts` returns
either the code the source reported, or the base currency together with
`currencyFellBack: true`. The helper never writes `false`; only a correction on
the card does, so on a row nobody has touched the flag is present exactly when
nobody read a currency. It is now the only expression of that fallback on the
four conversion sites the wizard's doors funnel through (strategy results,
multi-image consolidation, the JSON backup rows, and the shared
`categorizeTransactions`).

**A fallen-back currency is marked the way a low-confidence amount is.** The
same warning-coloured `error_outline` glyph and the same tooltip idiom, on the
chip rather than beside the figure. The reviewer already knows what that mark
means; a second visual vocabulary for "look at this" would have to be learned.

**Amounts are formatted by `CurrencyService`, not by the currency pipe.**
Decimals come from `currencyDecimalPlaces`, so ¥1,200 renders as ¥1,200 and
NT$120 as NT$120, and a currency correction is visible in the figure the moment
it is made.

**What a source suggested renders in its own area, and each item is
removable.** The block appears only when the row carries a location, a tag or
an offered rule, so an ordinary CSV row looks exactly as it did. Removing an
item is not a "rejected" state anywhere: the mapper spreads `location` only
when truthy and `tags` only when non-empty, so an emptied slot is already
precisely "not written".

**None of the marks reach the mapper.** `currencyFellBack`, `suggestedTags` and
`recurringMatch` are review-step state on `CategorizedImportTransaction`;
`toCreateTransactionDTO` names its fields, so there is no path by which one of
them rides into a transaction document.

### The alternatives that were rejected

- **Leaving currency to be fixed after the import.** The review step is the
  last cheap moment: after it, the figure has been converted at the wrong
  pair's rate and stored with a snapshot, and every correction is one dialog
  per row.
- **Applying a currency derived from the device's position.** The in-form scan
  offers one and never applies it, for the reason that reads the same here: the
  coordinate is evidence about the phone, not about the paper. A bulk
  auto-correction over twenty rows would be that guess, twenty times, unasked.
- **A `mat-select` per row.** It reserves its own width inside a dialog that is
  288px wide at its narrowest, on a row whose amount already has to be scaled
  by `appFitText` to sit beside the chip there; a chip that opens a menu costs
  the chip's width and nothing else.
- **A currency column, or a wider card.** 288px is the dialog width on a 320px
  screen ([../ui-overflow.md](../ui-overflow.md)), and every field added
  side-by-side is paid for there.
- **A confidence object for currency, beside `fieldConfidence`.** A currency is
  read or it is not — there is no partially legible code worth a number — and
  the boolean was already the whole truth. Nobody had ever read it, which is a
  reason to route it, not to enrich it.

## Consequences

- Every wizard door now marks its own unreadable currencies, including the JSON
  backup door, whose rows come from a file this app wrote but which a hand-edit
  or a truncation can still leave without a currency.
- **An edit to a code the rates table does not carry converts as though its
  rate were 1.** `getExchangeRate` substitutes 1 for either side of the pair it
  cannot find, so such a code is treated as the rates endpoint's own base. This
  is unchanged behaviour — a row extracted under that code always converted
  this way — but it is now reachable from a menu, which is worth knowing before
  the picker's list is widened.
- The wizard spec asserts `confirmImport`'s first argument for the first time.
  It had only ever checked the later ones, so the rows the user corrected could
  have been replaced by the original extraction with nothing failing.
- A dedicated 288px probe spec renders the card with everything a receipt can
  put on it — fallen-back marker, currency menu, location chip, tag chips,
  remove buttons, rule checkbox and the bulk button — and asserts containment,
  reachable hit boxes and a header that wraps instead of shoving the count
  badge off the edge. It is registered in `docs/ui-overflow.md` beside the
  other containment proofs.

## Things that only became apparent while building

- **The two-decimal pipe would have made the fix look broken.** Correcting a
  row to JPY and watching it render as ¥1,200.00 reads as the edit not having
  taken. The formatting had to move in the same change as the menu.
- **The flag was believed to be import-wide and was not.** It is declared on a
  row shape most of the wizard's doors never produce, and the one door that did
  produce it handed its rows on to a shape with nowhere to keep it. Nothing
  failed, because the only consumer was on the other path entirely.
- **Material weights the label span itself.** `MatMenuItem` projects the label
  into `.mat-mdc-menu-item-text`, which declares its own `font-weight`, so
  marking the row's current code by weighting the button does nothing. The
  marker is a `.option-label` span the component owns.
- **The two tap-target remedies had to be different shapes.** `.type-toggle`
  had already been raised from 26px to the 40px minimum by growing the control,
  and the currency chip and bulk button could follow it. The remove button
  could not: the chip has to stay chip-sized, so its 20px glyph grows a hit box
  outside its own box instead — 32px across, 40px down — and `.card-extras`
  uses a 14px row gap so a tap aimed at one wrapped row cannot land in the one
  below it.

## Known gaps

- **The menu cannot reach a third currency.** It offers the curated nineteen
  plus the row's own code. A receipt in a currency outside the picker that the
  model misread as a different real code cannot be corrected on the card at
  all — the true code is neither curated nor the row's.
- **There is no per-row preview of the converted amount.** What the row will be
  worth in the base currency after a currency correction is visible only once
  the transaction exists.
- **Bulk apply is scoped to the selection, and that is the only scope.** A
  twenty-row batch with two foreign rows takes a bulk pass plus two per-row
  edits, or a deselect-apply-reselect dance. The bulk menu also lists the
  curated codes only — it has no single row whose own code it could add — so
  a batch already on an uncurated code such as MXN can be bulk-set away from
  it and not back to it, and the way back is one per-row menu each.
- **A removal is only a removal.** Taking a location off a row says nothing to
  the next import of the same merchant; only tags carry a memory of what was
  refused ([0063](0063-an-import-suggests-only-what-the-account-already-knows.md)).
