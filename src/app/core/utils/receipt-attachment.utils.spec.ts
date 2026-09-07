import { CategorizedImportTransaction, ImagePositionMetadata } from '../../models';
import { planReceiptAttachments } from './receipt-attachment.utils';

describe('planReceiptAttachments', () => {
  let counter = 0;

  function row(meta?: Partial<ImagePositionMetadata>, splitFrom?: string): CategorizedImportTransaction {
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
        : {}),
      ...(splitFrom !== undefined ? { splitFrom } : {})
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

  it('lets a split part attach its own copy of the receipt it was taken off of', () => {
    // The one case the "attach once per receipt" rule above does not cover
    // (ADR 0106): a row the reviewer split off is a transaction of its own,
    // whose evidence happens to be the same photo.
    const original = row({ imageIndex: 0, receiptId: 1 });
    const part = row({ imageIndex: 0, receiptId: 1 }, original.id);

    expect(planReceiptAttachments([original, part], 1)).toEqual([[0], [0]]);
  });

  it('keeps the standing once-per-receipt rule for a second row with no split mark', () => {
    // Pinned beside the case above so the two read as a pair: same receipt,
    // same image, and the only difference is the mark.
    const first = row({ imageIndex: 0, receiptId: 1 });
    const second = row({ imageIndex: 0, receiptId: 1 });

    expect(planReceiptAttachments([first, second], 1)).toEqual([[0], []]);
  });

  it('still attaches a part\'s own photo when its original was deselected', () => {
    const original = row({ imageIndex: 0, receiptId: 1 });
    original.selected = false;
    const part = row({ imageIndex: 0, receiptId: 1 }, original.id);

    expect(planReceiptAttachments([original, part], 1)).toEqual([[0], [0]]);
  });

  it('gives two parts of one original their own photo each', () => {
    // Keyed on each part's own id, not on the shared splitFrom value — or
    // the second part would read as the first's repeat and attach nothing.
    const partA = row({ imageIndex: 0, receiptId: 1 }, 'orig');
    const partB = row({ imageIndex: 0, receiptId: 1 }, 'orig');

    expect(planReceiptAttachments([partA, partB], 1)).toEqual([[0], [0]]);
  });

  it('attaches nothing for a split row whose index is out of range', () => {
    // The empty-indices guard runs before the split grouping does, the same
    // order the plain out-of-range case above exercises.
    const stale = row({ imageIndex: 7 }, 'orig');

    expect(planReceiptAttachments([stale], 2)).toEqual([[]]);
  });
});
