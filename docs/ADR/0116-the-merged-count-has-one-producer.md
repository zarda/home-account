# 116. The merged count has one producer

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #392

No reference document owns the figure. The card mechanics that write the flag
it counts are in [../receipt-import.md](../receipt-import.md), under
*Splitting, merging and removing on the card*.

Applies [0048](0048-a-dead-capability-is-removed-not-guarded.md). It closes
the known gap [0111](0111-the-position-overlap-pass-is-removed.md) named —
"three producers for one number, which is #392's subject and not this
record's" — and the one
[0106](0106-the-review-step-splits-a-row-and-merges-two.md) left beside it:
"the survivor says *1 item merged* where the extraction result's `itemsMerged`
says 0".

## Context

Two numbers claimed to count merged items and they were never the same number.

`multiImageMetadata.itemsMerged` was computed in
`buildMultiImageImportResult` as `extractedTransactions.filter(t =>
t.wasMerged).length` — over the **raw** rows, exactly as the reader returned
them and before `consolidateReceiptItems` had grouped anything. On that side
of consolidation the flag is only ever the model's own claim: the cloud base
copies `t.wasMerged || false` off the answer, and Gemini's single-image
itemization path writes `false` outright. The receipt prompt does ask for the
field, so a `true` was not impossible — but 0106 recorded the figure as 0 in
practice, and either way it was rendered nowhere and never persisted:
`MultiImageMetadata` rides `ImportResult` only, so nothing reached Firestore.

The number a user actually sees is the wizard's `mergedItemsCount`, over the
**consolidated** rows' `imageMetadata.wasMerged`: the processing step's banner
and the confirm step's *Items merged* card. 0106 documented what feeds it —
consolidation stamps `true` when it folds a group, the card's merge stamps
`true` on the survivor, and the split copies the block onto the part — and
0111 documented that the provider's own claim is copied into the same field.
Three writers, one field, one displayed figure, plus a fourth figure over
different rows that nobody could see.

## Decision

**The extraction result's count goes; `mergedItemsCount` over the rows'
`imageMetadata.wasMerged` is the one merged count.**

`itemsMerged` comes off `MultiImageMetadata`; the `mergedCount` line comes out
of `buildMultiImageImportResult`; and the builder's **fourth parameter** —
`extractedTransactions: MultiImageExtractedTransaction[]`, the raw
pre-consolidation rows, whose only use was that count — comes off the
signature and off the one call site. The builder now takes `(files,
transactions, duplicates, answerIncomplete)`.

This is 0048's shape rather than a bug fix. A figure displayed by nothing and
stored nowhere is not repaired by recomputing it correctly: there is no reader
to be right for. `mergedItemsCount`
already answers the question a screen asks, and it answers it about the rows
the reviewer is looking at.

### The alternative that was rejected

- **Recounting `itemsMerged` over the consolidated rows.** It would produce a
  correct number, in a field on a result object, alongside the identical
  number the wizard already computes from the rows themselves. Two producers
  for one figure is exactly the state #392 is about; making the second one
  correct is not the same as removing it.

## Consequences

- **`tsc --noEmit` on the spec project named every reader.** There were two: a
  service-spec assertion, repointed at the flag on the row it is actually
  about, and a key in a smoke fixture, dropped.
- **The processing banner and the confirm card are unchanged**, because
  neither ever read the removed field.
- **The two i18n keys stay.** `import.itemsMerged` and
  `import.itemsMergedLabel` are the wizard's, and the wizard's count is what
  they render.
- **Nothing deploys.** The field never reached a document, so no record
  carries it and no rule mentions it.

## Things that only became apparent while building

- **The removal repointed one live case rather than deleting it.**
  Consolidation's single-item branch spreads the item through — `{ ...base,
  ...deriveAmount(…) }` — and `deriveAmount` does not touch the flag, so a
  provider that ever *did* claim `wasMerged: true` on a lone item would have
  that claim copied into `imageMetadata` by `categorizeMultiImageTransactions`
  and counted by `mergedItemsCount`. The claim is not filtered here; it is
  recorded, because filtering it is a decision about what a reader is allowed
  to assert and no issue asks for one.
- **The parameter was the larger half of the removal.** The count was three
  lines; the argument it was computed from was a whole extra list threaded
  from the call site into a builder that otherwise works on the rows it is
  handed.

## Known gaps

- **A lone item the provider flagged still counts as merged.** See above: the
  path exists, no prompt exercises it, and the flag is copied rather than
  filtered.
- **`deduplicationMethod` and `imageIds` are in the same condition the removed
  field was.** `deduplicationMethod` is written as the literal `'ai'`
  whatever ran, `imageIds` as `image_0…image_n` off the file index, and
  nothing this record could find reads either outside a spec assertion and a
  smoke fixture. They are left standing: #392 is about the merged count, and a
  second removal belongs in its own record.
- **The split still double-counts.** 0106's consequence, untouched: a part
  split off a consolidated row copies `wasMerged`, so a merged-then-split row
  counts twice on the confirm card.
