import {
  consolidateReceiptItems,
  formatReceiptItemLines,
  REVIEW_AMOUNT_CONFIDENCE,
} from './receipt-consolidation';
import { MultiImageExtractedTransaction } from '../services/gemini.service';

describe('formatReceiptItemLines', () => {
  it('formats items one per line with two decimals', () => {
    const lines = formatReceiptItemLines(
      [{ name: 'Latte', amount: 5 }, { name: 'Bagel', amount: 7.5 }],
      'USD'
    );
    expect(lines).toBe('Latte — USD 5.00\nBagel — USD 7.50');
  });

  it('formats JPY amounts without decimals', () => {
    const lines = formatReceiptItemLines([{ name: 'おにぎり', amount: 1151 }], 'JPY');
    expect(lines).toBe('おにぎり — JPY 1,151');
  });

  it('keeps the name only for items without a numeric amount and drops nameless items', () => {
    const lines = formatReceiptItemLines(
      [{ name: 'Latte', amount: 5 }, { name: 'Point discount' }, { amount: 3 }],
      'USD'
    );
    expect(lines).toBe('Latte — USD 5.00\nPoint discount');
  });

  it('renders a bare amount when no currency is known, without a stray space', () => {
    const lines = formatReceiptItemLines([{ name: 'Latte', amount: 5 }], '');
    expect(lines).toBe('Latte — 5.00');
  });
});

describe('consolidateReceiptItems', () => {
  function item(overrides: Partial<MultiImageExtractedTransaction>): MultiImageExtractedTransaction {
    return {
      date: '2026-01-15', description: 'Item', amount: 1, type: 'expense', currency: 'USD',
      imageIndex: 0, positionInImage: 'middle', confidence: 0.8,
      ...overrides,
    };
  }

  it('returns an empty array for no items', () => {
    expect(consolidateReceiptItems([])).toEqual([]);
  });

  it('keeps items from different receipts as standalone transactions', () => {
    const result = consolidateReceiptItems([
      item({ description: 'A', receiptId: 1 }),
      item({ description: 'B', receiptId: 2 }),
    ]);
    expect(result.length).toBe(2);
    expect(result.map(t => t.description)).toEqual(['A', 'B']);
  });

  it('surfaces receiptDetails as details for a standalone transaction', () => {
    const result = consolidateReceiptItems([
      item({ description: 'A', receiptId: 1, receiptDetails: 'A ×1 — 1.00\nTotal 1.00' }),
    ]);
    expect(result[0].details).toBe('A ×1 — 1.00\nTotal 1.00');
  });

  it('merges items sharing a receiptId into one transaction with itemized details', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Lunch', amount: 10, merchant: 'Diner', confidence: 0.9, receiptId: 1 }),
      item({ description: 'Snack', amount: 5, confidence: 0.7, receiptId: 1, imageIndex: 1 }),
    ]);

    expect(result.length).toBe(1);
    const merged = result[0];
    expect(merged.description).toBe('Diner');
    expect(merged.amount).toBe(15);
    expect(merged.details).toBe('Lunch — USD 10.00\nSnack — USD 5.00');
    expect(merged.confidence).toBeCloseTo(0.8);
    expect(merged.wasMerged).toBeTrue();
    expect(merged.mergedFromImages).toEqual([0, 1]);
    expect(merged.amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
  });

  it('subtracts refund/credit lines from the merged total', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Purchase', amount: 10, type: 'expense', receiptId: 1 }),
      item({ description: 'Refund', amount: 5, type: 'income', receiptId: 1 }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(5);
    expect(result[0].type).toBe('expense');
    expect(result[0].amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
  });

  it('marks a merged group as income when credits outweigh purchases', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Refund A', amount: 20, type: 'income', receiptId: 1 }),
      item({ description: 'Refund B', amount: 5, type: 'income', receiptId: 1 }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(25);
    expect(result[0].type).toBe('income');
    expect(result[0].amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
  });

  it('prefers the full AI receiptDetails over the generated item list', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Lunch', amount: 10, receiptId: 1 }),
      item({ description: 'Snack', amount: 5, receiptId: 1, receiptDetails: 'Full body' }),
    ]);
    expect(result[0].details).toBe('Full body');
  });

  it('groups items without a receiptId into one receipt', () => {
    const result = consolidateReceiptItems([
      item({ description: 'A', amount: 1 }),
      item({ description: 'B', amount: 2 }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(3);
    expect(result[0].amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
  });

  describe('currency', () => {
    // The regression. A hardcoded default here made `currency` truthy, which
    // switched off the caller's base-currency fallback AND its
    // currencyFellBack flag — so a US receipt printing only "$" was committed
    // silently as JPY, and a $42.50 dinner became ¥42.50.
    it('leaves the merged currency empty when no item carried one', () => {
      const result = consolidateReceiptItems([
        item({ description: 'Lunch', amount: 10, receiptId: 1, currency: '' }),
        item({ description: 'Snack', amount: 5, receiptId: 1, currency: '' }),
      ]);

      expect(result[0].currency).toBe('');
    });

    it('takes the first currency any item in the group carried', () => {
      const result = consolidateReceiptItems([
        item({ description: 'Lunch', amount: 10, receiptId: 1, currency: '' }),
        item({ description: 'Snack', amount: 5, receiptId: 1, currency: 'THB' }),
      ]);

      expect(result[0].currency).toBe('THB');
    });

    // The same receipt used to import as USD with one line and JPY with six.
    it('resolves the same currency whether the receipt had one line or six', () => {
      const single = consolidateReceiptItems([
        item({ description: 'Lunch', amount: 10, receiptId: 1, currency: '' }),
      ]);
      const many = consolidateReceiptItems([
        item({ description: 'A', amount: 1, receiptId: 1, currency: '' }),
        item({ description: 'B', amount: 2, receiptId: 1, currency: '' }),
        item({ description: 'C', amount: 3, receiptId: 1, currency: '' }),
        item({ description: 'D', amount: 4, receiptId: 1, currency: '' }),
        item({ description: 'E', amount: 5, receiptId: 1, currency: '' }),
        item({ description: 'F', amount: 6, receiptId: 1, currency: '' }),
      ]);

      expect(many[0].currency).toBe(single[0].currency);
    });

    // The note is the one place a fallback belongs: it is prose, not a value
    // anything converts against.
    it('labels the itemized note with the caller currency without adopting it', () => {
      const result = consolidateReceiptItems([
        item({ description: 'Lunch', amount: 10, receiptId: 1, currency: '' }),
        item({ description: 'Snack', amount: 5, receiptId: 1, currency: '' }),
      ], 'THB');

      expect(result[0].details).toBe('Lunch — THB 10.00\nSnack — THB 5.00');
      expect(result[0].currency).toBe('');
    });

    it('prefers the receipt currency over the caller fallback in the note', () => {
      const result = consolidateReceiptItems([
        item({ description: 'Lunch', amount: 10, receiptId: 1, currency: 'JPY' }),
        item({ description: 'Snack', amount: 5, receiptId: 1, currency: 'JPY' }),
      ], 'THB');

      expect(result[0].details).toBe('Lunch — JPY 10\nSnack — JPY 5');
      expect(result[0].currency).toBe('JPY');
    });
  });

  describe('amount derivation', () => {
    it('uses the reported receipt total over the item sum', () => {
      const merged = consolidateReceiptItems([
        item({ amount: 10 }),
        item({ amount: 5, receiptTotal: 16.2 }),
      ])[0];
      expect(merged.amount).toBe(16.2);
      expect(merged.amountConfidence).toBeUndefined();
      expect(merged.receiptTotal).toBe(16.2);
    });

    it('applies a reported total to a refund group without disturbing its sign', () => {
      const merged = consolidateReceiptItems([
        item({ amount: 20, type: 'income' }),
        item({ amount: 5, type: 'income', receiptTotal: 26 }),
      ])[0];
      expect(merged.amount).toBe(26);
      expect(merged.type).toBe('income');
      expect(merged.amountConfidence).toBeUndefined();
    });

    it('falls back to the item sum and flags the row when no total was reported', () => {
      const merged = consolidateReceiptItems([item({ amount: 10 }), item({ amount: 5 })])[0];
      expect(merged.amount).toBe(15);
      expect(merged.amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
    });

    it('applies the reported total to a single-item receipt', () => {
      const only = consolidateReceiptItems([item({ amount: 481, receiptTotal: 517 })])[0];
      expect(only.amount).toBe(517);
      expect(only.amountConfidence).toBeUndefined();
    });

    it('flags a single item whose receipt reported no total', () => {
      const only = consolidateReceiptItems([item({ amount: 481 })])[0];
      expect(only.amount).toBe(481);
      expect(only.amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
    });

    it('keeps a wildly deviant total but flags it', () => {
      const merged = consolidateReceiptItems([
        item({ amount: 10 }),
        item({ amount: 5, receiptTotal: 100 }),
      ])[0];
      expect(merged.amount).toBe(100);          // |100 − 15| = 85 > 50
      expect(merged.amountConfidence).toBe(REVIEW_AMOUNT_CONFIDENCE);
    });

    it('does not flag a total within the deviation guard', () => {
      const merged = consolidateReceiptItems([
        item({ amount: 30 }),
        item({ amount: 30, receiptTotal: 100 }),
      ])[0];
      expect(merged.amount).toBe(100);          // |100 − 60| = 40 ≤ 50
      expect(merged.amountConfidence).toBeUndefined();
    });

    it('reads the total from whichever item carries it', () => {
      const merged = consolidateReceiptItems([
        item({ amount: 10, receiptTotal: 16.2 }),
        item({ amount: 5 }),
      ])[0];
      expect(merged.amount).toBe(16.2);
    });
  });

  describe('printed location', () => {
    it('takes the location from whichever item in the group carried it', () => {
      // Reported once per receipt, on whichever line the model chose — the
      // same convention receiptDetails and receiptTotal already use. Reading
      // only the first item would drop it on every receipt but the shortest.
      const merged = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1 }),
        item({ description: 'Snack', receiptId: 1, location: { name: 'Shibuya 1-2-3' } }),
      ])[0];

      expect(merged.location).toEqual({ name: 'Shibuya 1-2-3' });
    });

    it('leaves the merged row without a location when no item carried one', () => {
      const merged = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1 }),
        item({ description: 'Snack', receiptId: 1 }),
      ])[0];

      expect('location' in merged).toBeFalse();
    });

    it('takes the country once per group, from whichever item carried it', () => {
      const merged = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1 }),
        item({ description: 'Snack', receiptId: 1, receiptCountry: 'KR' }),
      ])[0];
      expect(merged.receiptCountry).toBe('KR');

      const none = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1 }),
        item({ description: 'Snack', receiptId: 1 }),
      ])[0];
      expect('receiptCountry' in none).toBeFalse();
    });
  });

  describe('date confidence', () => {
    // The merged row's `date` always comes from `first` (below); a claim
    // about that date — including an honest 0 for a fabricated one — has to
    // come from the same item, not from a scan across the group the way
    // location and receiptCountry search.
    it("carries the first item's date confidence onto a merged row", () => {
      const merged = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1, dateConfidence: 0 }),
        item({ description: 'Snack', receiptId: 1, dateConfidence: 0.9 }),
      ])[0];

      expect(merged.dateConfidence).toBe(0);
    });

    it('leaves the merged row without a date confidence when nothing was reported', () => {
      const merged = consolidateReceiptItems([
        item({ description: 'Lunch', receiptId: 1 }),
        item({ description: 'Snack', receiptId: 1 }),
      ])[0];

      expect(merged.dateConfidence).toBeUndefined();
    });
  });
});
