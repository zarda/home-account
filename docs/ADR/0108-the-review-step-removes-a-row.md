# 108. The review step removes a row

**Status:** Accepted, implemented; amended for #400 (2026-09-11) · **Date:** 2026-09-10 · **Issues:** #391

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends
[0103](0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md),
whose **Add a row** could put a row on the card and never take one off, and
[0106](0106-the-review-step-splits-a-row-and-merges-two.md), which built every
mechanic this needs and said so. It closes the known gap each of them left —
0103's "a row added by hand cannot be removed again" and 0106's "no plain
Remove".

## Context

Until this, the only way a row left the review card was **Merge into…**, and a
merge is not a removal: it needs a target in the same currency, it refuses a
blank row and a flagged one on either side, and what it does with the row is
fold its amount into another one rather than drop it.

So a row the reviewer did not want had exactly two answers, both wrong for
some of the cases:

- **Deselect it.** It keeps the row off the import and off both gates, and it
  is reversible — which is genuinely the right answer for a row the reviewer
  is unsure about. It is not an answer for a row that is *noise*: a receipt's
  subtotal line the reader took for a purchase stays on the card for the rest
  of the review, in the list, in the count, and in the duplicate pass.
- **Nothing.** A blank row added by mistake — one tap on **Add a row** — could
  only be deselected, and 0103 recorded that: deselecting keeps it off the
  gate, "which is the whole of the answer". A card that can create a row and
  cannot destroy one is the asymmetry #391 is about.

0106 had already built every piece. `forgetRow` prunes the card's per-id
containers; the wizard's `onTransactionsUpdated` drops `overruled` and
`recheckStamp` for a gone id and filters `duplicateChecks` to the ids still
present; and the focus rule for a control that takes itself off the card was
stated and used twice. What was missing was the control.

## Decision

**Remove stands on every row, unconditionally; it asks nothing; and focus
lands on the next row's Remove, the previous row's when this was the last, and
the list's own Add a row when the list is empty.**

### On every row, blank and flagged alike

`.remove-trigger` is the one control in the extras strip that stands outside
every conditional branch. Split renders only on a filled row worth at least
two minor units, Merge into… only once another row shares its currency and
both sides are mergeable, Add location only where nothing was suggested, and
Add tag — unconditional in 0102's sense — still lives in the `@else` of its
own editor. Remove has none of that,
because the two rows most in need of it are exactly the ones the other
triggers refuse: a blank hand-added row has no other way off the card at all,
and a flagged row is one of the shapes a reviewer most wants gone.

The trigger sits after Split and Merge into… and ahead of the location and tag
controls, so the three controls that change *how many rows there are* stand
together.

`removeLabel(row)` names the row it removes, falling back to the button's own
visible text on a blank one — `splitLabel`'s rule, for `splitLabel`'s reason:
`import.removeRowLabel` interpolates a description, and a control offered
before anything has been typed has none to name.

### It asks nothing, and the trade-off is stated rather than mitigated

No confirmation dialog, on a filled row or a flagged one. **Deselect is the
reversible answer** — it is on every row, it is one tap, and it already does
what a confirmation would be protecting. A dialog on top of that would put a
modal in front of a one-tap control to guard against a mistake whose cheap
remedy is one control over.

The cost is real and is the whole of what was traded: a removal cannot be
undone. On a scanned row that means a re-scan, which is a quota slot and a
model call — see *Known gaps*.

### The landing, in order

```
next row's .remove-trigger → previous row's → .add-row
```

`removeRow` reads the neighbour *before* the filter — `transactions[index + 1]
?? transactions[index - 1]` — so the row after this one is preferred and the
row before it stands in when this was the last. `.remove-trigger` is
unconditional, so unlike every other `.extra-add` the neighbour is guaranteed
to carry one and that landing can never resolve to nothing. When there is no
neighbour at all the list's own **Add a row** is what is left on the card, and
it is outside the rows' scroller, so it is there whatever the list did.

### What the wizard already prunes, and what it did not

The card's side is `forgetRow(row.id)` — four containers — followed by the
`this.transactions = …` + `emitChanges()` pair every length-changing edit uses.
The wizard's side is 0106's pruning half, unchanged: `overruled`,
`recheckStamp` and the `duplicateChecks` entries all keyed to the gone id.

One thing that half did not cover, and it took the removal to expose it. A
`within_batch` verdict is about a **pair**: it flags the later twin and names
the earlier row as `existingTransactionId`. `onTransactionsUpdated` builds its
`changed` set by comparing each surviving row against its own prior self, so a
row whose *partner* merely vanished never differs from itself and was never
re-checked. Remove row A and its twin B went on reading "Repeated in this
import", deselected, with nothing left in the batch to repeat it. #391's
criterion — nothing keyed on the row's id survives it — is exactly what a
standing verdict naming the gone row violates.

The fix folds the orphaned survivors' ids into the **same** `changed` set the
comparison loop builds, guarded by `present.has(check.transactionId)`, so one
`recheckDuplicates` call answers both questions. `storedOnly` already drops
every `within_batch` entry before re-deriving, so the stale flag clears itself
once the survivor is re-checked against a batch the departed twin has left.

### The alternatives that were rejected

- **A confirmation dialog.** See above: Deselect is the reversible answer, and
  a modal in front of a one-tap edit is a worse trade than an undoable one.
- **An undo.** It would need the row, its index, its editing state and its
  wizard-side verdict held somewhere with a lifetime — and a second way for a
  row to reappear in the batch, which the duplicate pass and the attachment
  planner would both have to learn about. Deselect covers the case an undo
  would.
- **Remove only on hand-added rows.** It closes 0103's gap and not 0106's, and
  it makes the strip's contents depend on a row's provenance, which nothing
  else on the card does. The rows most worth removing come from a reader.
- **A second `changed`-set pass, or a second `recheckDuplicates` call, for the
  orphaned twins.** One call against a batch the twin has already left
  re-derives the same answer; two would just cost a second Firestore read.

## Consequences

- **An emptied batch renders the empty state and holds Continue.** Removing
  the last row leaves `transactions.length === 0`, so the card shows *No
  transactions to import*, and Continue and Import are disabled on
  `selectedCount() === 0` exactly as they are for a batch nobody selected. The
  wizard's own "the reader found nothing" card is a different surface —
  `processingFinishedEmpty` renders on the *processing* step, not this one —
  so an emptied review reads as an empty list with **Add a row** under it,
  which is the state a reviewer can actually act on.
- **`receiptRowIds` keeps a stale id, and it is inert.** The set is stamped
  once at extraction and nothing prunes it. Both its readers — the wizard's
  `unansweredDates` and the card's `attention(row)`, which the wizard fills
  the set through as `dateAttentionIds` — fold over the rows that are
  *present* and ask the set about each, so an id with no row is asked about by
  nobody; and `nextImportRowId` is a monotonic counter, so a later row cannot
  take the departed id and inherit its stamp. See *Amended for #400* below.
- **The count in the header and both gates follow immediately**, because they
  are computed over `extractedTransactions()` and the card emits the new list
  before anything reads it.
- **A row removed mid-recheck is answered for by the mechanism already
  there.** Its `recheckStamp` is pruned, `standing()` is false for it, and a
  reply that lands afterwards is dropped — 0106's rule, unchanged.

## Things that only became apparent while building

- **The within-batch orphan was invisible from the card's side.** Everything
  #391 asks about is keyed on the removed row's id, and the stale verdict is
  keyed on the *survivor's* — it only names the gone row in a field. The
  wizard's own diff had no reason to look at it, and the fix belongs there
  rather than in `removeRow`.
- **A focus assertion passed without any focus call.** The obvious spec for
  the landing put focus on the neighbour's trigger in the previous step and
  `track row.id` preserved the view, so the assertion was true before
  `removeRow` ran. A `blur()` before the click is what makes it a real
  assertion — a reminder that a "focus is where we wanted" check proves
  nothing unless focus is known to have been elsewhere.
- **The trigger's first comment gave a reason true of one row only.** "Nothing
  is written yet" explains the blank hand-added row and not the flagged
  scanned row the control is equally for; the comment now says the rule
  (unconditional, blank and flagged alike) and why nothing is asked
  (Deselect).
- **`mergeCensus` invalidates itself for free.** It is keyed on the
  `transactions` array's identity, and the filtered reassignment is a new
  array, so the merge triggers re-derive against the shorter list with nothing
  added here.

## Known gaps

- **A removed scanned row costs a re-scan.** There is no undo and no
  restore-from-history; putting the row back means running the photo through
  the reader again, which is a quota slot and a model call. The reviewer is
  told nothing about that before pressing Remove.
- **The stale `receiptRowIds` entry is left in place.** Inert today for the
  two reasons above, but it is a set that no longer describes the batch, and
  the next reader of it would have to know that. Filed as a follow-up rather
  than fixed here. Closed by the amendment below, #400.
- **Nothing announces the removal.** The row leaves and focus moves; no live
  region says a row went. 0107's gap, in the place where the change to the
  list is largest.
- **Remove is not on the confirm step.** The rows are settled at Continue;
  a reviewer who spots the wrong row on the confirmation card has to go back.

## Amended for #400 (2026-09-11)

**`receiptRowIds` is pruned wherever a row leaves.** The consequence above —
"`receiptRowIds` keeps a stale id, and it is inert" — and the known gap that
followed it are both answered by one private update on the wizard,
`keepReceiptRows(present)`, called from `onTransactionsUpdated` alongside the
pruning of `overruled`, `recheckStamp` and `duplicateChecks`, and again in the
partial-import branch, which narrows the batch to the refused rows without
going through that handler.

The reasoning that made the stale entry harmless still holds and is why this
is an amendment rather than a fix for a defect: both readers fold over the
rows that are *present* and ask the set about each, so an id with no row was
asked about by nobody, and `nextImportRowId` is monotonic, so no later row
could inherit the stamp. What changes is that the set now describes the batch
it names, which is what the next reader of it will assume.

The update returns the **same** `Set` when nothing left, because
`unansweredDates` is a computed keyed on the signal and a new set on every
emission would recompute it for every edit that changes no membership.

One asymmetry is left standing: `onFilesSelected` resets
`extractedTransactions` to `[]` without resetting the id set, where
`processFiles` resets both. It is inert — the review step is unreachable until
`processFiles` has run and reset both — and it is not part of this amendment.
