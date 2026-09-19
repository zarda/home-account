import { CategorizedImportTransaction } from '../../models';
import { MAX_RECEIPTS_PER_TRANSACTION } from '../services/storage.service';
import { imageSources } from './import-review.utils';

/**
 * Decide which source photos each confirmed row keeps.
 *
 * Returns one index list per row, in row order, indexing the image files the
 * extraction actually ran over. The mapping lives in the rows' own
 * `imageMetadata`: `mergedFromImages` when consolidation merged a receipt
 * (it hardcodes `imageIndex` to 0 on merged rows, so that field is only
 * honest on unmerged ones), else `imageIndex`.
 *
 * Rows sharing a receipt — same `receiptId`, or the same source images when
 * the model left them ungrouped — would each upload the same picture, so
 * only the first row of a group attaches. Two different receipts printed on
 * one photo are not that case: the photo shows both, both keep it.
 *
 * A row the reviewer split off (`splitFrom` set, `splitImportRow`) is a
 * third case rather than a member of its original's group: it is a
 * transaction of its own now, whose evidence happens to be the same photo,
 * so it uploads its own copy — the one shape 0060's "attach once per
 * receipt" rule above does not cover (0106). Keyed on the row's own id
 * instead of the shared `splitFrom` value, or a receipt split into three
 * parts would attach only the first of them.
 *
 * A reviewer merge across two receipts (`mergeImportRows`) is a fourth case:
 * the merged row keeps the target's `receiptId`, so the source receipt's id
 * does not survive the spread, and anything left over from the source (a
 * sibling row that stayed unmerged) would read as an unrelated receipt and
 * upload a photo the merged row already claims. The merge is the only thing
 * that knows it folded a different receipt in, so it records the ids it
 * absorbed (`mergedReceiptIds`) and those groups count as attached before
 * any row is walked here — whatever order the rows arrive in. Metadata on
 * its own cannot tell that merge from the model's own consolidation of one
 * long receipt spanning two photos (`consolidateReceiptItems`): both end as
 * one row stamping `wasMerged` and the union of the photos, and a second
 * receipt printed on one of a long receipt's photos must still attach it
 * (the case above this one). The one edge this accepts: two receipts
 * printed on the same photo, merged together, attach that photo once — on
 * the merged row.
 *
 * Indices outside the file list attach nothing rather than someone else's
 * photo, and a long receipt is cut at the per-transaction cap the upload
 * would otherwise refuse outright.
 */
export function planReceiptAttachments(
  rows: Pick<CategorizedImportTransaction, 'id' | 'splitFrom' | 'imageMetadata'>[],
  fileCount: number
): number[][] {
  const attachedGroups = new Set<string>();
  for (const row of rows) {
    for (const id of row.imageMetadata?.mergedReceiptIds ?? []) attachedGroups.add(`receipt:${id}`);
  }

  return rows.map(row => {
    const meta = row.imageMetadata;
    if (!meta) return [];

    const indices = [...new Set(imageSources(meta))]
      .filter(i => i >= 0 && i < fileCount)
      .sort((a, b) => a - b)
      .slice(0, MAX_RECEIPTS_PER_TRANSACTION);

    if (indices.length === 0) return [];

    const groupKey = row.splitFrom !== undefined
      ? `split:${row.id}`
      : meta.receiptId !== undefined
        ? `receipt:${meta.receiptId}`
        : `images:${indices.join(',')}`;
    if (attachedGroups.has(groupKey)) return [];
    attachedGroups.add(groupKey);

    return indices;
  });
}
