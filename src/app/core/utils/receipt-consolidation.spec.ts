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
});
