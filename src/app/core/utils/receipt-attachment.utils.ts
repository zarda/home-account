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
 * Indices outside the file list attach nothing rather than someone else's
 * photo, and a long receipt is cut at the per-transaction cap the upload
 * would otherwise refuse outright.
 */
export function planReceiptAttachments(
  rows: CategorizedImportTransaction[],
  fileCount: number
): number[][] {
  const attachedGroups = new Set<string>();

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
