# 60. A confirmed import keeps its photos and names its source

**Status:** Accepted, implemented · **Date:** 2026-08-20 · **Issues:** #317, #318

Builds on the row shapes widened in
[0059](0059-one-mapper-builds-every-imported-transaction.md). Reference
documentation lives in [../import-fields.md](../import-fields.md).

## Context

Photograph a receipt through the camera flow, confirm the rows, and the
transactions were saved without the photo — while the same photo taken through
"Scan Receipt" inside the transaction dialog was attached. The wizard still
held the files at confirm time and passed only their name and size, hardcoding
the record's kind while it was at it:

```ts
const result = await this.importService.confirmImport(
  this.extractedTransactions(),
  file?.name || 'import',
  file?.size || 0,
  'csv',
  'generic_csv'
);
```

So every wizard import — receipt photos, statement screenshots, bank PDFs,
JSON backups — was recorded in Import History as a generic CSV named after the
first file, sized by the first file. The history page could not have rendered
the truth anyway: it showed only `source`, and the statement path built its
results as `receipt_image`, so the two kinds of photo were indistinguishable
end to end.

The camera's default path had a deeper seam. The strategy hop dropped the real
image indices when converting to `ProcessedTransaction`, and the capture
component then invented provenance for every row:

```ts
imageMetadata: tx.receiptId != null ? {
  imageIndex: 0,
  imageId: 'image_0',
  ...
```

— nor did its result carry `sourceFiles` at all, so even a confirm step that
wanted to attach photos would have found none on the most-used path.

The component spec asserted only `confirmImport` *was called* — no arguments —
and its shared fixture was csv-shaped for every path, `importFromMultipleImages`
included, which is how five hardcoded constants stayed green.

## Decision

**The confirm step attaches each row's own photos, resolved from the row's
image metadata.** `planReceiptAttachments` in `receipt-attachment.utils.ts` is
a pure function over the selected rows: `mergedFromImages` where consolidation
merged a receipt (it hardcodes `imageIndex` 0 there), the `imageIndex`
otherwise; indices deduped, sorted into photo order, bounded to the batch, and
cut at `MAX_RECEIPTS_PER_TRANSACTION`. Rows sharing a receipt — by `receiptId`,
or by identical source images when ungrouped — attach on the first selected
row only. Two receipts printed on one photo both keep it: the photo shows both.

**The strategy seam carries the truth instead of inventing it.**
`ProcessedTransaction` gains optional `imageIndex` and `mergedFromImages`;
the cloud conversion keeps them, native OCR stamps its loop index (one receipt
per photo), and the capture component builds metadata from the real values and
ships `sourceFiles` like the fallback path always did.

**A quota refusal saves the row without its photo and is reported as its own
figure.** `addTransaction` throws `RECEIPT_IMAGE_LIMIT_ERROR` before any id,
upload or write exists, so the retry without `receiptFiles` is clean. The skip
lands in `receiptsSkipped` on the history record — never in `errors` or
`errorCount`, because the wizard's partial branch re-offers rows from the
error list and would double-import a row that is already saved. The wizard
tells the user distinctly. `RECEIPT_ATTACH_FAILED` — a failed upload — still
fails the row: retrying photo-less there would silently drop photos on a
flaky network.

**The record derives from what was processed, dominant kind by row count.**
The wizard tracks each processed result's `source`/`fileType`/row count and
the record takes the kind with the most rows, ties keeping the first
processed. The record's own numbers are row-denominated, so the label follows
the same measure; a first-file rule would let one stray photo relabel a
200-row CSV. The size sums every file in the batch; the camera flow reports
what the capture handed over. Statement photos build as
`'image'`/`'screenshot'`, and Import History renders `fileType` at last — a
kind chip with an icon, labelled through the catalog.

### The alternatives that were rejected

- **Attaching the group's photos to every row of the group.** A five-row
  statement screenshot would upload the same image five times and count five
  against the quota for one picture.
- **Labelling a mixed batch by its first file.** Order of selection is not
  evidence of what the batch was.
- **New `ImportSource` enum values per kind.** `fileType` already enumerates
  the kinds and the Firestore rules already accept them; a second axis would
  need a rules deploy for no new information.
- **Failing the row on a quota refusal.** The user photographed a real
  expense; losing the transaction because its picture did not fit is the
  wrong trade, and the refusal fires before any partial state exists.
- **Stamping metadata on statement rows so screenshots attach too.** Their
  rows carry no per-row mapping, `confidenceScore` would have to be invented,
  and pinning a whole statement screenshot to its arbitrary first row is a
  product call — left out, below.

## Consequences

- A receipt imported through camera capture lands with its photo on the
  transaction detail sheet; a long receipt photographed across several images
  keeps them all, in photo order, on one transaction; two receipts in one
  batch each keep their own.
- CSV, PDF and JSON rows attach nothing by construction — no metadata, no
  plan — pinned by a spec that rides files alongside metadata-less rows.
- `ImportHistory` gains optional `receiptsSkipped`; the `imports` rules use an
  open key set (`importOptionalsValid` has no `hasOnly`), so no rules change
  and no deploy.
- The emulator smoke case proves the storage upload runs and the rules accept
  the widened write: `receiptUrl`, `receiptUrls`, `receiptCount`, tags,
  location and period on one landed document.
- The wizard spec now pins the arguments per path — receipts, statements,
  PDFs, the mixed-batch rule with summed size, and a camera handoff — and
  `importFromStatementImages` is finally in the spy list; it was never mocked,
  so a statement-path test would have died on `undefined` before this.

## Things that only became apparent while building

- `imageIndex` indexes the image subset the extraction ran over, not
  `selectedFiles` — the wizard must pass
  `selectedFiles().filter(looksLikeImageFile)` or a mixed batch attaches the
  wrong file. The camera flow holds no selected files at all; its photos ride
  the handed-over result through `history.state`, which structured-clones
  `File` objects.
- The attachment plan must run over the *selected* rows at confirm time, not
  the extraction output: duplicate detection rewrites `mergedFromImages`, and
  a deselected first row should hand its group's photos to the first selected
  one.
- `addTransaction` refuses a caller-chosen id combined with `receiptFiles`
  (the receipts branch pre-generates its own id to key the storage slots), so
  the confirm step must never adopt an idempotency id while attaching photos.
- `ReceiptQuotaService.canAddImages` fails open on a load error — a quota
  outage admits images rather than blocking imports.

## Known gaps

- **Statement screenshots are not attached.** Their rows carry no image
  metadata, and which row of a many-row page deserves the page's screenshot is
  a product decision, not a seam fix. The pipeline now carries everything a
  future decision needs.
- **The offline capture queue is a separate door.** Photos queued offline are
  processed by the queue processor, not the wizard's confirm step; whether
  those keep their images is its own question.
- **`receiptsSkipped` is a count, not a list.** The user learns how many
  photos were skipped, not which rows; naming the rows would need the error
  surface this deliberately avoids.
