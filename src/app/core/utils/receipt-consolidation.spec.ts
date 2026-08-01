import { consolidateReceiptItems, formatReceiptItemLines } from './receipt-consolidation';
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
  });

  it('subtracts refund/credit lines from the merged total', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Purchase', amount: 10, type: 'expense', receiptId: 1 }),
      item({ description: 'Refund', amount: 5, type: 'income', receiptId: 1 }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(5);
    expect(result[0].type).toBe('expense');
  });

  it('marks a merged group as income when credits outweigh purchases', () => {
    const result = consolidateReceiptItems([
      item({ description: 'Refund A', amount: 20, type: 'income', receiptId: 1 }),
      item({ description: 'Refund B', amount: 5, type: 'income', receiptId: 1 }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(25);
    expect(result[0].type).toBe('income');
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
});
