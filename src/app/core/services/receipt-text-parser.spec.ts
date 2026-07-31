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

    it('should keep a merchant name in its own script', () => {
      const result = parseReceiptOcrText('스타벅스 강남점\n합계 ₩12,500');
      expect(result.merchant).toBe('스타벅스 강남점');
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

    it('should read an amount written with a comma decimal separator', () => {
      const result = parseReceiptOcrText('Bäckerei\nSumme 1.234,56 EUR');
      expect(result.amount).toBe(1234.56);
    });

    it('should prefer the largest figure the receipt marks as money', () => {
      const result = parseReceiptOcrText('Cafe\nLatte $4.50\nMuffin $3.00\nTotal $7.50');
      expect(result.amount).toBe(7.5);
    });

    it('should read an amount in a script with no keyword the parser knows', () => {
      const result = parseReceiptOcrText('스타벅스 강남점\n합계 ₩12,500\n카드결제 ₩12,500');
      expect(result.amount).toBe(12500);
    });

    it('should ignore phone and receipt numbers when picking the amount', () => {
      const result = parseReceiptOcrText('Shop\nTEL 0312345678\nRECEIPT 000123456\n480');
      expect(result.amount).toBe(480);
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

    it('should detect EUR from the euro symbol', () => {
      expect(parseReceiptOcrText('Shop\n€10.00').currency).toBe('EUR');
    });

    it('should detect GBP from the pound symbol', () => {
      expect(parseReceiptOcrText('Shop\n£8.20').currency).toBe('GBP');
    });

    it('should detect USD from the dollar sign', () => {
      expect(parseReceiptOcrText('Shop\nTotal: $9.99').currency).toBe('USD');
    });

    it('should detect THB from a printed ISO code', () => {
      expect(parseReceiptOcrText('Shop\n120 THB').currency).toBe('THB');
    });

    it('should detect a currency that was never in the old lexicon', () => {
      expect(parseReceiptOcrText('스타벅스\n합계 ₩12,500').currency).toBe('KRW');
      expect(parseReceiptOcrText('ร้านกาแฟ\n฿250.00').currency).toBe('THB');
      expect(parseReceiptOcrText('Кофейня\nИТОГО 450,00 RUB').currency).toBe('RUB');
    });

    it('should not read a three-letter word as a currency code', () => {
      expect(parseReceiptOcrText('Cafe\n2 CUP COFFEE 4.00\nTOTAL 8.00').currency).toBe('');
    });

    it('should report no currency rather than inventing one', () => {
      // 円 is a word, not a currency sign, and the parser no longer carries a
      // word list for any language — an unreadable currency has to say so.
      const result = parseReceiptOcrText('Shop\n500 円');
      expect(result.currency).toBe('');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('date extraction', () => {
    it('should extract MM/DD/YYYY dates', () => {
      const result = parseReceiptOcrText('Shop\n01/15/2026\nTotal: $5');
      expect(result.date.getFullYear()).toBe(2026);
      expect(result.date.getMonth()).toBe(0);
      expect(result.date.getDate()).toBe(15);
    });

    it('should extract ISO-8601 dates', () => {
      const result = parseReceiptOcrText('Shop\n2026-01-15\nTotal: $5');
      expect(result.date.getFullYear()).toBe(2026);
      expect(result.date.getMonth()).toBe(0);
      expect(result.date.getDate()).toBe(15);
    });

    it('should extract dates written with CJK and Hangul markers', () => {
      const japanese = parseReceiptOcrText('セブンイレブン\n2026年1月15日\n合計 1,280円');
      expect(japanese.date.getMonth()).toBe(0);
      expect(japanese.date.getDate()).toBe(15);

      const korean = parseReceiptOcrText('스타벅스\n2026년 1월 15일\n합계 ₩12,500');
      expect(korean.date.getMonth()).toBe(0);
      expect(korean.date.getDate()).toBe(15);
    });

    it('should read the day first when the first number cannot be a month', () => {
      const result = parseReceiptOcrText('Shop\n25/12/2025\nTotal: $5');
      expect(result.date.getFullYear()).toBe(2025);
      expect(result.date.getMonth()).toBe(11);
      expect(result.date.getDate()).toBe(25);
    });

    it('should ignore a date in the future', () => {
      // Nothing has been bought tomorrow yet, so a number that only looks like
      // a date must not become one.
      const result = parseReceiptOcrText('Shop\n2099-01-01\nTotal: $5');
      expect(result.date.getFullYear()).toBe(new Date().getFullYear());
    });

    it('should default to today when no date is present', () => {
      const before = new Date();
      const result = parseReceiptOcrText('Shop\nTotal: $5');
      const after = new Date();
      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('should default to today for a date written out in words', () => {
      // Month names were the parser's last language table; the model reads
      // those now, and the parser says it did not.
      const result = parseReceiptOcrText('Shop\nJanuary 15, 2026\nTotal: $5');
      expect(result.date.getFullYear()).toBe(new Date().getFullYear());
      expect(result.confidence).toBeLessThan(0.7);
    });
  });

  describe('confidence', () => {
    it('should report zero when nothing was recognized', () => {
      expect(parseReceiptOcrText('Shop\nThanks for visiting').confidence).toBe(0);
    });

    it('should score a receipt it fully read above one it only guessed at', () => {
      const read = parseReceiptOcrText('Shop\n2026-01-15\nTotal ¥1,200');
      const guessed = parseReceiptOcrText('Shop\n1200');

      expect(read.confidence).toBeGreaterThan(0.7);
      expect(guessed.confidence).toBeLessThan(read.confidence);
    });

    it('should score an amount the receipt marked as money above a bare number', () => {
      const marked = parseReceiptOcrText('Shop\n$1,200');
      const bare = parseReceiptOcrText('Shop\n1200');

      expect(marked.confidence).toBeGreaterThan(bare.confidence);
    });
  });
});
