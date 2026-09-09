# 111. The position-overlap pass is removed

**Status:** Accepted, implemented · **Date:** 2026-09-10 · **Issues:** #389

No reference document owns this. What the live duplicate check does is in
[../receipt-import.md](../receipt-import.md); nothing described here ever ran.

Applies [0048](0048-a-dead-capability-is-removed-not-guarded.md) to the last
untouched half of `DuplicateDetectionService`, and takes up the record 0106
deferred: "that dead helper is left for a record of its own".

## Context

`DuplicateDetectionService` carried two duplicate passes. One is live —
`checkDuplicates` against stored history, `findWithinBatchDuplicates` across
the batch, `markDuplicates` applying the verdicts — and is what the review
step's flags, 0101's re-check and 0106's twin exemption are all built on.

The other was `applyMultiImageDeduplication`, and it had no production caller
at all. It read `imageMetadata.positionInImage` — a `'top'`/`'bottom'` mark
the receipt prompt asks the model for — and treated an item at the bottom of
image N and one at the top of image N+1 as candidates for the same purchase,
confirming it with `descriptionsSimilar` and a 1% amount tolerance. It then
dropped the lower-confidence row and rewrote the survivor's
`imageMetadata.wasMerged` and `mergedFromImages`. Four members in all —
`checkMultiImageDuplicates`, the private `isInOverlapZone` and
`isSameAmountWithTolerance`, and `applyMultiImageDeduplication` — plus the
exported `MultiImageDuplicateCheck` interface and its `reason:
'position_overlap' | 'exact_match' | 'amount_match'` union, of which only the
first was ever produced.

Its only callers were its own spec's. That is 0048's shape exactly: a path
that is neither wired nor deleted reads like a working feature to anyone who
greps for it, and 0106's own issue arrived believing this pass was the live
cross-photo merge.

The two fields it rewrote have real producers, and neither is this.
`consolidateReceiptItems` sets `wasMerged: true` when it folds items sharing a
`receiptId`, which is the live cross-photo merge; `mergeImportRows` sets it on
a survivor and unions `mergedFromImages` (0106); and the model's own
`wasMerged` claim rides through `cloud-llm-provider.base.ts` into the
row's `imageMetadata` untouched. A pass that also wrote them would have been
a fourth writer with no reader waiting for it.

## Decision

**The four methods and the interface are deleted.**

`descriptionsSimilar` stays — it is `findWithinBatchDuplicates`' and
`checkDuplicates`' own similarity ladder, with two live callers — and so do
`isSameRow`, `markDuplicates` and `checkDuplicates` with their specs.
`ImagePositionMetadata` stays in the models and drops out of this service's
import line: `imageSources` takes it by name, and the attachment planner and
both review helpers read the block it types.

Deleting the spec's two describes first, then the service code, is what makes
the compiler the red step: the spec named every removed member, so the
deletion cannot half-land.

### The alternatives that were rejected

- **Wiring it under `importFromMultipleImages`**, which is the multi-photo
  door it was plainly written for. Consolidation by `receiptId` already
  answers the question it was asking, and it answers it with the *model's* own
  grouping of the items rather than with a geometric guess about where on a
  photo a line was printed. A second pass behind the first would either agree
  with it — and cost a scan for nothing — or disagree, and there is no rule
  for which one wins. If cross-photo duplicates ever need a second opinion,
  that is a decision with a live consumer, and this is not it.
- **Keeping it behind a flag**, or a comment saying it is unused. 0048 and
  0097 both settled this: half-present is the bug, and the fact that it once
  existed is what this record is for.
- **Keeping `MultiImageDuplicateCheck` for its `exact_match` and
  `amount_match` members.** Nothing has ever produced either; a union with one
  reachable arm is not a contract.

## Consequences

- **`descriptionsSimilar` keeps its two callers**, at the within-batch pass
  and at the stored-history comparison. It was never this pass's helper; it
  was borrowed by it.
- **One insertion against 275 deletions.** The insertion is the import line
  without `ImagePositionMetadata`.
- **A grep over `src/` for the five removed names and `position_overlap` comes
  back empty.** No static gate covers a removal like this — `i18n:check` and
  the lint guards see none of it — so the grep is what proves it landed whole,
  the way 0105's `totalCache` removal was checked.
- **Nothing branches on `positionInImage` any more.** Every producer still
  writes it — the prompt asks for it, both cloud adapters default it to
  `'middle'`, consolidation stamps `'middle'` on a folded row — and no reader
  makes a decision from it. `isInOverlapZone` was the only one there had ever
  been.

## Things that only became apparent while building

- **The dead pass was cited as evidence the capability existed.** #389 and
  0106's own issue both read it as the live cross-photo merge. A dead path
  does not just fail to work — it misinforms the next decision made near it,
  which is why the removal is a record rather than a chore.
- **`checkDuplicates` leaves `LOG:` lines in every Karma run.** Two
  `console.log` calls, unrelated to this pass and untouched by it, brush the
  pristine-output rule. Noted rather than fixed here.
- **The within-batch spec helper builds ids with `Math.random()`.** Also
  pre-existing, also untouched; it makes a failure's ids meaningless in the
  output.

## Known gaps

- **The model's own `wasMerged` claim is untouched.** `cloud-llm-provider.base`
  copies whatever the reader said into the row's `imageMetadata`, and the
  wizard's *Items merged* count reads that field alongside consolidation's
  and the merge's own writes — three producers for one number, which is
  #392's subject and not this record's.
- **Nothing checks cross-photo duplicates beyond consolidation.** Two photos
  of the same receipt that the reader does not group under one `receiptId`
  produce two rows, and only the within-batch pass — same type, amount, day
  and a similar description — has anything to say about them.
- **`positionInImage` is a required field nothing decides anything from.** It
  is not optional on `ImagePositionMetadata`, so dropping it touches every
  producer and the receipt prompts; whether to stop asking the model for it is
  a prompt decision, made against the prompt registry's own gate, and it is
  not made here.
