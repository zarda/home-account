# 51. An uncategorized row is graded where it is coerced

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #307

See [0045](0045-a-confidence-grade-names-its-source.md) for the grading
contract this extends and [0046](0046-an-unrecognized-category-name-is-not-a-category.md)
for the unset id it is keyed on. Reference documentation lives in
[../receipt-import.md](../receipt-import.md).

## Context

Two import seams — `AIImportService.convertStrategyResultToCategories` and
`CameraCaptureComponent.convertStrategyResult`, near-duplicates of each other
— decided a review row's category and its grade on adjacent lines, from
different inputs:

```ts
suggestedCategoryId: tx.suggestedCategoryId || 'other_expense',
categoryConfidence: tx.confidence,
```

The id fell back to the catch-all when nothing resolved it. The grade did not
fall back at all: it was copied from the row's extraction confidence, which
answers a different question. On the on-device path that number is
`ocrResult.confidence` — how clearly Vision read the *characters*, typically
around 0.9 — so a category answer nobody understood rendered as a green,
high-confidence "Other" and stayed out of the needs-review warning, which
counts rows under 0.5. The same miss through a cloud extraction path earned
0.3 and was flagged.

[0046](0046-an-unrecognized-category-name-is-not-a-category.md) built the
signal this needed: `matchCategoryName` reports `matched`, so an answer the
catalog could not place leaves `suggestedCategoryId` unset and stays
distinguishable from a deliberate "Other". [0049](0049-the-model-never-sees-an-i18n-key.md)
put the native path on that matcher and recorded the grading half as a known
gap rather than fixing it, because the obvious fix is barred: `isUsableResult`
keys native→cloud fallback routing on the same `confidence`, by way of the
envelope `ProcessingResult.confidence` that `NativeReceiptService` copies
from the row (single image) or averages across rows (several).

What the issue did not anticipate is who else arrives at those seams with no
category. `parseWithRegex` never sets one at all — it reads figures and
evidence tiers and never looks at what was bought — and it is not a corner
case: `useNativeOCR` is true on any non-Mac iOS device regardless of Apple
Intelligence, so on an iPhone or iPad without it, the regex reader handles
*every* scan. A fix keyed purely on the id being unset would regrade all of
them.

## Decision

**The row says whether anything tried, and the seam grades three cases
apart.** `ProcessedTransaction` gains `categoryAttempted?: boolean`, following
the `currencyFellBack` precedent: absent means a categorizer ran — whether it
named a category, named one the catalog could not place, or returned nothing
— and only the reader that does no categorization work of its own sets it
`false`. One helper, `gradeCategorySuggestion`, owns both halves of the
decision that used to be made on two lines:

| The row | Filed under | Graded |
|---|---|---|
| a category that resolved | that id | the extraction's own confidence |
| an answer that resolved to nothing | the catch-all | `UNRESOLVED_CATEGORY_CONFIDENCE`, 0.3 |
| nothing attempted to categorize it | the catch-all | `UNCATEGORIZED_CATEGORY_CONFIDENCE`, 0.1 |

Both values already existed as bare literals — 0.3 as the `applyCategorizations`
contract's "nothing usable answered", 0.1 as the categorization ladder's floor
for rows nobody could answer. Naming them is what lets the seams state the
same rule in the same word, and every site that carried the literal now
carries the name.

**The helper is deliberately total.** Both call sites sit inside a `try` whose
`catch` falls back to a *fresh cloud extraction*, so a throw at the seam would
silently cost a second billable request. It therefore takes no catalog and
performs no lookup — resolution already happened upstream.

**No line touching the row's `confidence` changes.** That is what keeps the
routing decision provably unmoved, and `ai-strategy.service.spec.ts` stays
green unedited as the proof. It is also read for a second question the issue
did not mention: `camera-capture.component.ts` copies it into
`imageMetadata.confidenceScore`, which the duplicate detector compares to
decide which of two overlapping rows survives.

### The alternatives that were rejected

**Lowering the row's confidence at the native source.** The natural reading of
the bug, and wrong twice over. `NativeReceiptService` feeds that number
straight into the envelope `isUsableResult` compares against 0.4, so a
perfectly-read receipt whose category merely went unrecognized would start
paying for a cloud call; and it would move the duplicate-survivor comparison
too. [0013](0013-the-printed-total-is-the-amount-not-the-item-sum.md) rejected
the same shape for the same reason when the doubt was about the amount.

**One rule keyed on the id being unset.** Simpler, and it reads as the honest
version — nothing categorized those rows, so flag them all. But it would put a
review chip on every scan taken on an iOS device without Apple Intelligence,
and the app already argues against exactly that: the note above
`needsVerification` in the review table says an unreported confidence is not a
low one, and that flagging every row of a source that has no model to ask
would train the user to ignore the marker. Grading "nobody looked" below "the
answer meant nothing" keeps both claims honest without collapsing them.

**Grading inside `matchCategoryName`.** The matcher answers what resolved, not
what the answer is worth to a review screen, and it is called from paths that
have no review screen at all.

**A `categoryConfidence` field on `ProcessedTransaction`.** Would let the
native service state the grade directly, but every consumer would still need
the fallback for producers that do not set it, so the seam keeps the rule
anyway — and a second confidence field one line from the first is the
confusion this ADR exists to remove.

## Consequences

- A native scan whose category answer resolved is graded exactly as before.
- An answer the catalog could not place is flagged for review on every path
  that reaches the review table, and counts toward the `low_confidence`
  warning.
- **Scans on an iOS device without Apple Intelligence now show a review chip
  on the category.** Every one of them, because nothing on that path
  categorizes. That is the fix observable rather than a regression, in the
  same register as [0045](0045-a-confidence-grade-names-its-source.md)'s
  "rows without an extraction category drop from 0.8 to 0.3 and now show the
  review flag" — but it is a visible change to a whole class of devices, and
  it was taken knowingly against the marker-fatigue argument above.
- The cloud multi-image arm is closed too. `consolidateReceiptItems` can leave
  a group's category unset when no line item resolved, and those rows reached
  the same seam wearing the same borrowed number.
- `ImportResult.confidence` averages `categoryConfidence`, so its value moves
  on these paths. Nothing reads it; no spec pins it.

## Things that only became apparent while building

- The two seams are near-duplicates but not identical — `AIImportService`
  applies a base-currency fallback the component does not — so the shared
  helper covers the category pair only, not the whole row mapping.
- The regex path's reach was the finding that changed the design. It was
  filed as a native-model bug; the arm that produces uncategorized rows on
  every scan is the one with no model in it.

## Known gaps

- `ImportResult.warnings` still has no UI consumer
  ([0045](0045-a-confidence-grade-names-its-source.md) records this), so the
  chip's colour remains the visible effect of the grade rather than the
  warning it also feeds.
- `matchCategoryName` filters on activity in its id pass but not in its
  display-name or keyword passes, so a model answering the *name* of a
  category the user deleted still resolves to it — at full extraction
  confidence, since the id is set. Found while writing the smoke spec for
  this change and filed separately; the prompt catalog never offers the
  deleted entry, so it takes an answer from the model's own knowledge to
  reach.
- The keyword map returns hardcoded ids that need not exist in the live
  catalog, so a "resolved" row can still render as Unknown in the chip.
