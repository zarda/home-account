import { CategorizedImportTransaction } from '../../models';
import { MAX_RECEIPTS_PER_TRANSACTION } from '../services/storage.service';

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

    const sources = meta.mergedFromImages?.length ? meta.mergedFromImages : [meta.imageIndex];
    const indices = [...new Set(sources)]
      .filter(i => i >= 0 && i < fileCount)
      .sort((a, b) => a - b)
      .slice(0, MAX_RECEIPTS_PER_TRANSACTION);

    if (indices.length === 0) return [];

    const groupKey = meta.receiptId !== undefined
      ? `receipt:${meta.receiptId}`
      : `images:${indices.join(',')}`;
    if (attachedGroups.has(groupKey)) return [];
    attachedGroups.add(groupKey);

    return indices;
  });
}
