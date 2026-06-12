import { parseReceiptOcrText } from './receipt-text-parser';

describe('parseReceiptOcrText', () => {
  describe('merchant extraction', () => {
    it('should use the first non-empty line as merchant', () => {
      const result = parseReceiptOcrText('Starbucks Coffee\n123 Main St\nTotal: $5.50');
      expect(result.merchant).toBe('Starbucks Coffee');
    });

    it('should fall back to Unknown Merchant for empty text', () => {
      const result = parseReceiptOcrText('');
      expect(result.merchant).toBe('Unknown Merchant');
    });
  });

  describe('amount extraction', () => {
    it('should extract amount after a total keyword', () => {
      const result = parseReceiptOcrText('Shop\nTotal: $12.34');
      expect(result.amount).toBe(12.34);
    });

    it('should extract amount with thousand separators', () => {
      const result = parseReceiptOcrText('Shop\nTOTAL ¥1,200');
      expect(result.amount).toBe(1200);
    });

    it('should extract amount from a currency symbol pattern', () => {
      const result = parseReceiptOcrText('Shop\n€44.90');
      expect(result.amount).toBe(44.9);
    });

    it('should extract amount with a currency suffix', () => {
      const result = parseReceiptOcrText('Shop\n800 円');
      expect(result.amount).toBe(800);
    });

    it('should return 0 when no amount is present', () => {
      const result = parseReceiptOcrText('Shop\nThanks for visiting');
      expect(result.amount).toBe(0);
    });
  });

  describe('currency detection', () => {
    it('should detect JPY from the yen symbol', () => {
      expect(parseReceiptOcrText('Shop\n¥500').currency).toBe('JPY');
    });

    it('should detect JPY from the 円 character', () => {
      expect(parseReceiptOcrText('Shop\n500 円').currency).toBe('JPY');
    });

    it('should detect EUR from the euro symbol', () => {
      expect(parseReceiptOcrText('Shop\n€10.00').currency).toBe('EUR');
    });

    it('should detect GBP from the pound symbol', () => {
      expect(parseReceiptOcrText('Shop\n£8.20').currency).toBe('GBP');
    });

    it('should detect THB from baht markers', () => {
      expect(parseReceiptOcrText('Shop\n120 THB').currency).toBe('THB');
    });

    it('should default to USD', () => {
      expect(parseReceiptOcrText('Shop\nTotal: $9.99').currency).toBe('USD');
    });
  });

  describe('date extraction', () => {
    it('should extract MM/DD/YYYY dates', () => {
      const result = parseReceiptOcrText('Shop\n01/15/2026\nTotal: $5');
      expect(result.date.getFullYear()).toBe(2026);
      expect(result.date.getMonth()).toBe(0);
      expect(result.date.getDate()).toBe(15);
    });

    it('should extract Month DD, YYYY dates', () => {
      const result = parseReceiptOcrText('Shop\nJanuary 15, 2026\nTotal: $5');
      expect(result.date.getFullYear()).toBe(2026);
      expect(result.date.getMonth()).toBe(0);
      expect(result.date.getDate()).toBe(15);
    });

    it('should default to today when no date is present', () => {
      const before = new Date();
      const result = parseReceiptOcrText('Shop\nTotal: $5');
      const after = new Date();
      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });
  });
});
