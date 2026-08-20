import { CategorizedImportTransaction, ImagePositionMetadata } from '../../models';
import { planReceiptAttachments } from './receipt-attachment.utils';

describe('planReceiptAttachments', () => {
  let counter = 0;

  function row(meta?: Partial<ImagePositionMetadata>): CategorizedImportTransaction {
    return {
      id: `row-${counter++}`,
      description: 'Coffee',
      amount: 5,
      currency: 'USD',
      date: new Date(2026, 5, 1),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...(meta
        ? {
            imageMetadata: {
              imageIndex: 0,
              imageId: 'image_0',
              positionInImage: 'middle',
              confidenceScore: 0.9,
              ...meta
            }
          }
        : {})
    };
  }

  it('attaches nothing to a row without image metadata', () => {
    expect(planReceiptAttachments([row()], 3)).toEqual([[]]);
  });

  it('attaches a single row its own photo', () => {
    expect(planReceiptAttachments([row({ imageIndex: 2 })], 3)).toEqual([[2]]);
  });

  it('prefers mergedFromImages over imageIndex, sorted into photo order', () => {
    // Consolidation hardcodes imageIndex 0 on merged rows; mergedFromImages
    // is the only honest source list for them.
    const merged = row({ imageIndex: 0, mergedFromImages: [2, 0, 1] });

    expect(planReceiptAttachments([merged], 3)).toEqual([[0, 1, 2]]);
  });

  it('attaches a receipt group photos on its first row only', () => {
    const first = row({ imageIndex: 1, receiptId: 7 });
    const second = row({ imageIndex: 1, receiptId: 7 });

    expect(planReceiptAttachments([first, second], 3)).toEqual([[1], []]);
  });

  it('gives two receipts their own photos, never the other one\'s', () => {
    const receiptA = row({ imageIndex: 0, receiptId: 1 });
    const receiptB = row({ imageIndex: 1, receiptId: 2 });

    expect(planReceiptAttachments([receiptA, receiptB], 2)).toEqual([[0], [1]]);
  });

  it('lets two receipts printed on one photo share it', () => {
    // The photo genuinely shows both receipts, so both transactions keep it.
    const receiptA = row({ imageIndex: 0, receiptId: 1 });
    const receiptB = row({ imageIndex: 0, receiptId: 2 });

    expect(planReceiptAttachments([receiptA, receiptB], 1)).toEqual([[0], [0]]);
  });

  it('groups ungrouped rows by their index signature', () => {
    // Rows with no receiptId but identical source images are one receipt as
    // far as photos are concerned: attach once, not per row.
    const first = row({ imageIndex: 2 });
    const second = row({ imageIndex: 2 });
    const other = row({ imageIndex: 0 });

    expect(planReceiptAttachments([first, second, other], 3)).toEqual([[2], [], [0]]);
  });

  it('caps a long receipt at the per-transaction maximum', () => {
    const merged = row({ imageIndex: 0, mergedFromImages: [0, 1, 2, 3, 4, 5] });

    expect(planReceiptAttachments([merged], 6)).toEqual([[0, 1, 2, 3, 4]]);
  });

  it('drops indices outside the file list instead of attaching the wrong photo', () => {
    const stale = row({ imageIndex: 7 });

    expect(planReceiptAttachments([stale], 2)).toEqual([[]]);
  });

  it('dedupes repeated indices in a merged list', () => {
    const merged = row({ imageIndex: 0, mergedFromImages: [1, 1, 0] });

    expect(planReceiptAttachments([merged], 2)).toEqual([[0, 1]]);
  });
});
