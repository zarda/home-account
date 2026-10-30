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

    describe('beside a price', () => {
      // A whole number printed bare beside a figure printed as money is a
      // count, a size or a code, not the line's money (ADR 0186). Where one
      // is larger than the figure read, it might have been the total, so the
      // reading lands under the bar.
      const read = (amount: number, amountConfidence: number) =>
        jasmine.objectContaining({ amount, amountConfidence });

      it('reads a count, a size or a code beside a price as no part of the money', () => {
        const cases: [text: string, amount: number][] = [
          ['Shop\nSKU 1234 $1.45\nTotal $1.45', 1.45],
          ['Shop\nPack of 24 $5\nTotal $5', 5],
          ['店\n緑茶 500ml ¥151\n合計 ¥151', 151],
          ['Shop\nTotal $25.00\nVISA 1234 $25.00', 25],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.8));
        }
      });

      it('reads a whole number as money where a sign touches it, where nothing else on its line is money, or where it repeats that money', () => {
        // A pin. A sign spaced alike from two bare figures touches both
        // (Summe 12 € 3 Artikel, Total 2 $ 8), and an aside prices nothing.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTotal ¥1,280', 1280],
          ['가게\n합계 ₩5,900', 5900],
          ['Shop\nTotal ¥  480', 480],
          ['店\n¥ 合計 480', 480],
          ['Shop\nTotal 15 USD', 15],
          ['Shop\nTOTAL 100 CASH $100.00', 100],
          ['店\n合計 980 (内税 ¥72)', 980],
          ['Laden\nSumme 12 € 3 Artikel', 12],
          ['Shop\nCoffee $ 4\nMuffin $ 4\nTotal 2 $ 8', 8],
          ['店\nおにぎり ¥ 150\nお茶 ¥ 150\n合計 2 ¥ 300', 300],
          ['Shop\nTOTAL 2 $ 15', 15],
          ['Shop\nCoffee 2 $ 5', 5],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.8));
        }
      });

      it("reads the figure a sign or the receipt's code touches as the money, and the bare one beside it as a count", () => {
        // A pin. A sign spaced alike from two figures touches the one written
        // like money (2,10 € 3), and the receipt's code touches the figure it
        // is printed against, after it or before it.
        const cases: [text: string, amount: number][] = [
          ['Laden\nBrot 2,10 € 3', 2.1],
          ['Shop\nPack 24 15 USD', 15],
          ['Shop\nUSD 15 Pack 24', 15],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.6, amountDemotion: 'count' }));
        }
      });

      it('grades a figure read under a larger count where nothing else in its tier prints it', () => {
        const cases: [text: string, amount: number][] = [
          ['Shop\nRoom 412 $89.00', 89],
          ['Shop\nRoom 412 $89.00\nTax $8.90\nTotal $97.90', 97.9],
          ['Shop\nEggs 12 $4.99\nMilk 1 $3.49\nTotal $8.48', 8.48],
          ['Shop\nWater 500ml $288\nTea $100\nTotal 388 Card $388', 388],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.6, amountDemotion: 'count' }));
        }
      });

      it('keeps a price printed again in its tier at the tier grade when its count stands right before it', () => {
        // A pin: grading every pick a count outranks would flag this one.
        expect(parseReceiptOcrText('Shop\nPack of 24 $5.00\nTotal $5.00')).toEqual(read(5, 0.8));
      });

      it('reads a total printed bare beside a smaller figure as that figure, graded under the bar, the known gap', () => {
        // The larger figure stands where a total does: a word of its own
        // follows it, past a space, a run of marks, a percent figure or the
        // letters of its currency, or it is printed after the line's money. So
        // it might be the total even where the smaller is printed again.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTotal 1280 Tax ¥116', 116],
          ['Shop\nTotal 12 Tax $0.96', 0.96],
          ['Shop\nBurger $8.00\nFries $3.04\nTotal 12 Tax $0.96', 8],
          ['店\n合計 1280 内税 ¥116\n内消費税等 ¥116', 116],
          ['Shop\nItem $8.00\nSubtotal $8.00\nTotal 9 Tax $1.00', 8],
          ['Shop\nItem $8.00\nSubtotal $8.00\nTotal 9, Tax $1.00', 8],
          ['Shop\nTotal 12 / Tax $0.96\nTax $0.96', 0.96],
          ['店\n合計 980円 内税 ¥72\n内消費税等 ¥72', 72],
          ['가게\n합계 900원 부가세 ₩82\n부가세 ₩82', 82],
          ['Shop\nTotal 12 ... Tax $0.96\nTax $0.96', 0.96],
          ['Shop\nTotal 120 8% Tax $9.60\nTax $9.60', 9.6],
          ['Shop\nTotal 120 8％ Tax $9.60\nTax $9.60', 9.6],
          ['店\n合計 1280 10％ 内税 ¥116\n内消費税等 ¥116', 116],
          ['Shop\nItem $8.00\nSubtotal $8.00\nTax $1.00 Total 9', 8],
          ['店\n内税 ¥72 合計 980\n内消費税等 ¥72', 72],
          ['가게\n부가세 ₩82 합계 900\n부가세 ₩82', 82],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.6));
        }
      });

      it('reads a total printed bare beside a smaller figure with no word between them as that figure or the cash, unflagged where the smaller or the read one is printed again or the cash and change follow, the known gap', () => {
        // Typography cannot tell Total 12 $0.96 from Pack 12 $0.96, and only
        // marks or a percent figure between the figures count as nothing
        // (Total 12 = $0.96). Where the smaller figure, or the
        // one read, is printed again, the count rule stands down, as it must
        // for Pack of 24 $5.00 over Total $5.00.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTotal 12 $0.96\nTax $0.96', 0.96],
          ['Shop\nTotal 12 = $0.96\nTax $0.96', 0.96],
          ['Shop\nItem $11.04\nSubtotal $11.04\nTotal 12 $0.96', 11.04],
          ['Shop\nTotal 12 $0.96\nCash $20.00\nChange $8.00', 20],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.8));
        }
      });

      it('pairs a total or a change printed bare with the cash it was change for', () => {
        // A pin: a count on the pick's own line, or one standing where a total
        // does (a word of its own after it, or the line's money before it),
        // stands in the tendered pair as either figure. A count of what a
        // price buys, on another line, never does.
        const cases: [text: string, amount: number, amountConfidence: number][] = [
          ['店\n合計 538 お預り ¥1,000 お釣り ¥462', 538, 0.6],
          // On the pick's own line with no word after it.
          ['店\n合計 538 ¥1,000 ¥462', 538, 0.6],
          ['Shop\nTotal 12 Tax $0.96\nCash $20.00\nChange $8.00', 12, 0.6],
          ['Shop\nTax $0.96 Total 12\nCash $20.00\nChange $8.00', 12, 0.6],
          ['店\n合計 538 内税 ¥39\nお預り ¥1,000\nお釣り ¥462', 538, 0.6],
          ['Shop\nTotal $12.00\nCash $20.00 Change 8', 12, 0.6],
          ['Shop\nItem 2 $3.00\nTotal $5.00', 5, 0.8],
          ['Shop\nItem 3 $2.00\nTotal $5.00', 5, 0.8],
        ];
        for (const [text, amount, amountConfidence] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, amountConfidence));
        }
      });

      it('reads the cash where no pair of figures beside a currency mark adds up to it, the known gap', () => {
        // The total or the change prints no currency mark, so no pair beside a
        // sign adds up to the cash. Before ADR 0186 a count, half of a time or
        // part of a date could complete such a pair by chance (8 + 2 over
        // $10), and the reading was flagged.
        const cases: [text: string, amount: number][] = [
          ['Shop\nLatte 2 $8\nTotal 9\nTax $1\nCash $10\nChange $1', 10],
          ['店\n21/07 24\n라떼 (12) ₩60\n케이크 Qty 4 ₩20\n케이크 ₩8\n소계 ₩88\n결제금액 ₩88\n받은돈 ₩100\n거스름돈 12', 100],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.8));
        }
      });

      it('grades the total under a later count where its sign stands apart and the date printed after it on its line is lost, the known gap', () => {
        // With a space or a code between the sign and the total, the total's
        // own figure starts a run that cannot be a date (12.50 01), which takes
        // the date's first number with it, so the rest of the date stands bare
        // beside the money as counts, one larger than the total.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTOTAL $ 12.50 01/15/2026', 12.5],
          ['Shop\nTOTAL USD 12.50 01/15/2026', 12.5],
          ['Shop\n$ 15.00 01/15/26', 15],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(
              jasmine.objectContaining({
                amount,
                amountConfidence: 0.6,
                amountDemotion: 'count',
                dateConfidence: 0,
              }),
            );
        }
      });

      it('reads the figures of a time as neither money nor a count', () => {
        expect(parseReceiptOcrText('Shop\n14:32 Total $10.00')).toEqual(read(10, 0.8));
        expect(parseReceiptOcrText('REFUND\n14:32 TOTAL -$10.00')).toEqual(
          jasmine.objectContaining({
            amount: 10,
            amountConfidence: 0.8,
            direction: 'credit',
            directionConfidence: 0.5,
          }),
        );
        // A time's figure of the total's value is still a copy of it, unmarked.
        expect(parseReceiptOcrText('REFUND\n2026-09-28 14:32 TOTAL -$14.00')).toEqual(
          jasmine.objectContaining({
            amount: 14,
            amountConfidence: 0.8,
            direction: 'debit',
            directionConfidence: 0.3,
          }),
        );
      });
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

    it('should report the amount tier as amountConfidence', () => {
      expect(parseReceiptOcrText('Shop\n$1,200').amountConfidence).toBe(0.8);
    });

    it('exports the date confidence the reader computed', () => {
      expect(parseReceiptOcrText('Shop\n2026-01-15\nTotal: $5').dateConfidence).toBe(0.9);

      // 03/04/2026: both parts are <= 12, so the day/month order is
      // ambiguous and the reading is scaled down for it (0.9 tier × 0.6).
      expect(parseReceiptOcrText('Shop\n03/04/2026\nTotal: $5').dateConfidence).toBe(0.54);

      // Nothing has been bought tomorrow yet, so a future date is rejected
      // the same as no date at all.
      expect(parseReceiptOcrText('Shop\n2099-01-01\nTotal: $5').dateConfidence).toBe(0);
    });
  });

  describe('cash-tendered demotion', () => {
    it('should answer the printed total when the largest figure is the cash tendered', () => {
      const r = parseReceiptOcrText('Shop\nTotal $481\nCash $500\nChange $19');
      expect(r.amount).toBe(481);
    });

    it('should reduce confidence when it demotes, so the review flag fires', () => {
      const r = parseReceiptOcrText('Shop\nTotal $481\nCash $500\nChange $19');
      expect(r.amountConfidence).toBe(0.6); // 0.8 tier × 0.75
    });

    it('should keep the largest figure when it is not round like tendered cash', () => {
      const r = parseReceiptOcrText('Shop\n$100\n$8\n$108');
      expect(r.amount).toBe(108);
      expect(r.amountConfidence).toBe(0.8);
    });

    it('should keep a round total when the smaller candidate pair member is round too', () => {
      // 100 + 5 = 105 could be subtotal+tax→total; x=100 is itself tender-shaped, so stand down
      const r = parseReceiptOcrText('Shop\n$100\n$5\n$105');
      expect(r.amount).toBe(105);
    });

    it('should demote a decimal pair that sums to a round note', () => {
      const r = parseReceiptOcrText('Shop\n$43.10\n$6.90\n$50.00');
      expect(r.amount).toBe(43.1);
      expect(r.amountConfidence).toBe(0.6);
    });

    it('should keep largest-wins when no pair explains the largest figure', () => {
      const r = parseReceiptOcrText('Shop\n$12.00\n$30.00\n$50.00');
      expect(r.amount).toBe(50);
    });

    it('should keep the documented ambiguous case largest-wins', () => {
      // {450, 50, 500}: a taxed total is indistinguishable from a tendered note
      const r = parseReceiptOcrText('Shop\n$450\n$50\n$500');
      expect(r.amount).toBe(500);
    });

    it('should keep a duplicated printed figure as a pair candidate', () => {
      // The identity filter removes only one instance of the largest figure,
      // so the duplicated 481s survive as pair candidates and the printed
      // total still wins over the tendered cash.
      const r = parseReceiptOcrText('Shop\nSubtotal $481\nTotal $481\nCash $500\nChange $19');
      expect(r.amount).toBe(481);
      expect(r.amountConfidence).toBe(0.6);
    });

    it('says it demoted the reading as cash tendered, and nothing where nothing demoted it', () => {
      expect(parseReceiptOcrText('Shop\nTotal $481\nCash $500\nChange $19')).toEqual(
        jasmine.objectContaining({ amountConfidence: 0.6, amountDemotion: 'tender' }),
      );
      expect('amountDemotion' in parseReceiptOcrText('Shop\n$100\n$8\n$108')).toBeFalse();
    });
  });

  describe('which way the money moved', () => {
    // A refund slip prints its total as a negative, and only the typography
    // says so: a minus, an accounting triangle or accounting parentheses on the
    // winning figure itself. No word is read, in any language (ADR 0008), and
    // the amount stays a positive magnitude whichever way the money moved.
    const reading = (amount: number, direction: 'credit' | 'debit', directionConfidence: number) =>
      jasmine.objectContaining({ amount, direction, directionConfidence });

    it('reads a negative mark on the total as a credit and keeps the amount positive', () => {
      // A minus counts after the line start, a space, a colon, an equals sign,
      // a Han or Hangul label or an opening parenthesis, or right after the
      // currency sign, and OCR hands a printed minus back as any of five
      // dashes. A minus glued to a reference (SKU-1234, 03-3461-8901) or to
      // kana still does not count. The first row's tier proves the figure was
      // read as money rather than dropped as a negative number.
      expect(parseReceiptOcrText('Shop\nTotal -$12.50')).toEqual(
        jasmine.objectContaining({
          amount: 12.5,
          amountConfidence: 0.8,
          direction: 'credit',
          directionConfidence: 0.5,
        }),
      );
      for (const line of [
        '-$12.50',
        'Total:-$12.50',
        'Total: -$12.50',
        'Total -12.50 USD',
        'Total $-12.50',
        'Total −$12.50',
        'Total –$12.50',
        'Total ﹣$12.50',
        'Total －$12.50',
        'Total △$12.50',
        'Total ▲$12.50',
        'Total ($12.50)',
        'Total （$12.50）',
        // Pins for what a sign may carry before it: the capitals of HK$ and
        // US$, both before a minus and inside parentheses.
        'Total -HK$12.50',
        'Total (US$12.50)',
      ]) {
        expect(parseReceiptOcrText(`Shop\n${line}`))
          .withContext(line)
          .toEqual(reading(12.5, 'credit', 0.5));
      }
    });

    it('reads a whole number printed negative beside money as the total, never a count', () => {
      // A pin: a marked figure is no count of what a price buys.
      expect(parseReceiptOcrText('Shop\nTotal -20 Tax $1.00')).toEqual(
        jasmine.objectContaining({
          amount: 20,
          amountConfidence: 0.8,
          direction: 'credit',
          directionConfidence: 0.5,
        }),
      );
    });

    it('reads an East Asian accounting triangle as a credit, glued or spaced', () => {
      expect(parseReceiptOcrText('店舗\n合計▲1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('店舗\n合計 ▲¥1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('店舗\n合計 ▲ 1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('店舗\n合計 ▲ ¥1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('店舗\n合計\u3000▲\u30001,280')).toEqual(
        reading(1280, 'credit', 0.5),
      );
    });

    it('reads a minus after the fullwidth colon a CJK receipt prints as a credit', () => {
      // A pin: the colon was read from the start, and this keeps it read.
      expect(parseReceiptOcrText('店舗\n合計：-¥1,280')).toEqual(reading(1280, 'credit', 0.5));
    });

    it('reads a minus glued to a Han or Hangul label as a credit', () => {
      // The label and the figure print as one run, so there is no space or
      // colon for the minus to follow. Two scripts are named: typography, not
      // a word table (ADR 0008).
      expect(parseReceiptOcrText('Shop\n合計-1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('Shop\n合計-¥1,280')).toEqual(reading(1280, 'credit', 0.5));
      expect(parseReceiptOcrText('Shop\n합계-5,900')).toEqual(reading(5900, 'credit', 0.5));
    });

    it('reads a minus inside an opening parenthesis as a credit', () => {
      expect(parseReceiptOcrText('Shop\n(-12.50)')).toEqual(reading(12.5, 'credit', 0.5));
      expect(parseReceiptOcrText('Shop\n(-$12.50)')).toEqual(reading(12.5, 'credit', 0.5));
      expect(parseReceiptOcrText('店\n（-¥1,280）')).toEqual(reading(1280, 'credit', 0.5));
    });

    it('reads a minus after an equals sign as a credit', () => {
      expect(parseReceiptOcrText('Shop\n=-12.50')).toEqual(reading(12.5, 'credit', 0.5));
      expect(parseReceiptOcrText('店\n＝-1,280')).toEqual(reading(1280, 'credit', 0.5));
    });

    it('reads parentheses as a credit only around a figure written like money', () => {
      expect(parseReceiptOcrText('Shop\nTotal (12.50)')).toEqual(reading(12.5, 'credit', 0.5));
      expect(parseReceiptOcrText('店\n（¥1,280）')).toEqual(reading(1280, 'credit', 0.5));
    });

    it('reads no credit from a mark that does not negate the winning figure', () => {
      const cases: [text: string, amount: number][] = [
        // The closing dash a Japanese receipt prints against alteration.
        ['領収書\n金額 ¥10,000-', 10000],
        // The gap between a description and its price.
        ['Cafe\nLatte - $4.50', 4.5],
        // A minus glued to a reference, a phone number or a row of dashes.
        ['Shop\nSKU-1234', 1234],
        ['Shop\nTEL 03-3461-8901', 8901],
        // Pin: a closing parenthesis does not open the gate the way an opening
        // one does, so an area code's minus is not a credit.
        ['Shop\nTEL (03)-3461', 3461],
        ['Shop\nNo.-123', 123],
        // Pin: OCR hands the katakana long-vowel mark back as a hyphen, so kana
        // does not open the gate; the first 480 is no credit, and the total
        // beside it has no twin.
        ['Shop\nアイスコーヒ-480\n合計 480', 480],
        ['Shop\n----$12.50', 12.5],
        // Pins: a triangle between two runs of digits joins them, as a dash
        // does.
        ['Shop\nRef 12▲1,280', 1280],
        ['Shop\nTEL 03▲3461▲8901', 8901],
        // Parentheses around words or a count.
        ['店\n(税込¥1,280)', 1280],
        ['Shop\nPoints (100)', 100],
      ];
      for (const [text, amount] of cases) {
        expect(parseReceiptOcrText(text))
          .withContext(text)
          .toEqual(reading(amount, 'debit', 0));
      }
    });

    it('reads the mark on the winning figure, not anywhere on its line', () => {
      expect(parseReceiptOcrText('Shop\nItem-7 Total $12.50')).toEqual(reading(12.5, 'debit', 0));
      expect(parseReceiptOcrText('Shop\nTotal $12.50 (-$1.00 saved)')).toEqual(
        reading(12.5, 'debit', 0),
      );
    });

    it('reads no credit from a marked coupon on a purchase', () => {
      expect(
        parseReceiptOcrText('Shop\nCoffee $3.20\nCake $2.30\nCoupon -$1.00\nTotal $4.50'),
      ).toEqual(reading(4.5, 'debit', 0));
    });

    it('calls a total printed both marked and unmarked ambiguous, and never a credit', () => {
      // The same figure twice — a card line repeating the total, a refund
      // quoting the sale it reverses — is read whichever order it prints in.
      expect(parseReceiptOcrText('Shop\nTotal $14.03\nVISA -$14.03')).toEqual(
        reading(14.03, 'debit', 0.3),
      );
      expect(parseReceiptOcrText('Shop\nRefund -$14.03\nOriginal sale $14.03')).toEqual(
        reading(14.03, 'debit', 0.3),
      );
      expect(parseReceiptOcrText('Shop\nRope -$14.03\nTotal -$14.03')).toEqual(
        reading(14.03, 'credit', 0.5),
      );
    });

    it('counts only the copies printed as money, so a time of the same value is no twin', () => {
      // The slip's 14:32 holds a plain 14, the same value as its whole-dollar
      // total, and is no copy of it.
      expect(
        parseReceiptOcrText(
          'HARBOUR SUPPLIES\n2026-09-28 14:32\nREFUND\nItem -$14.00\nTOTAL -$14.00',
        ),
      ).toEqual(reading(14, 'credit', 0.5));
      // A pin: a total read from the plain numbers has no money to compare
      // with, so every figure of its value is a copy.
      expect(parseReceiptOcrText('Shop\n-480\n480')).toEqual(reading(480, 'debit', 0.3));
    });

    it('reads the direction from the total that survives the cash-tendered demotion', () => {
      // The largest figure, the 50 handed over, is unmarked; the total it was
      // change for is the one that carries the minus.
      expect(parseReceiptOcrText('Shop\nTotal -$43.10\nCash $50.00\nChange $6.90')).toEqual(
        jasmine.objectContaining({
          amount: 43.1,
          amountConfidence: 0.6,
          direction: 'credit',
          directionConfidence: 0.5,
        }),
      );
    });

    it('reads the refund slip as the device returns it, and its tender line as a twin', () => {
      const slip =
        'HARBOUR SUPPLIES\n2026-09-28 14:32\nREFUND\nMooring rope 10m -$12.99\nSubtotal -$12.99\n' +
        'Tax 8% -$1.04\nTOTAL -$14.03\nReturned to card ending 4242';
      expect(parseReceiptOcrText(slip)).toEqual(
        jasmine.objectContaining({
          amount: 14.03,
          currency: 'USD',
          direction: 'credit',
          directionConfidence: 0.5,
        }),
      );
      expect(parseReceiptOcrText(`${slip}\nVISA $14.03`)).toEqual(reading(14.03, 'debit', 0.3));
    });

    it('reads no credit when no amount was found', () => {
      expect(parseReceiptOcrText('Shop\nThanks for visiting')).toEqual(reading(0, 'debit', 0));
    });

    describe('what it leaves alone', () => {
      // Documentation of where the reading stops. Most of these hold however
      // the marks are read. The pins: the lone zero holds the zero skip in
      // place, and the cases after the Japanese and Korean receipts hold
      // today's readings against three rules that were weighed and turned
      // down (ADR 0185, What was rejected). Each is a net gain in corrections
      // on the battery; each was turned down for where its errors land.
      // Counting only the copies that carry their own sign or are written
      // like money flips the size on a priced line and the tender-line twins,
      // and files purchases as refunds. Reading a figure marked by
      // parentheses alone, beside an unmarked one at least half its size, as
      // a restatement flips the lone parenthesised figures and leaves refund
      // slips doubted. Asking unsigned parentheses for a decimal fraction
      // flips the points line, and loses the sign-less credits with it.

      it('never reads a credit from a zero, so a "-0.00" change line stays a purchase', () => {
        expect(parseReceiptOcrText('Shop\nTotal $12.50\nChange -$0.00')).toEqual(
          reading(12.5, 'debit', 0),
        );
        // The pin: with nothing else to win, a zero that were a candidate
        // would win, and its minus would read as a credit.
        expect(parseReceiptOcrText('Shop\nTotal -$0.00')).toEqual(reading(0, 'debit', 0));
      });

      it('reads no credit from a marked change line beside the cash tendered', () => {
        expect(parseReceiptOcrText('Shop\nTotal $481\nCash $500\nChange -$19')).toEqual(
          jasmine.objectContaining({
            amount: 481,
            amountConfidence: 0.6,
            direction: 'debit',
            directionConfidence: 0,
          }),
        );
      });

      it('folds nothing about the direction into the combined confidence', () => {
        const marked = parseReceiptOcrText('Shop\n2026-01-15\nTotal -¥1,200');
        const unmarked = parseReceiptOcrText('Shop\n2026-01-15\nTotal ¥1,200');
        expect(marked.confidence).toBe(unmarked.confidence);
        expect(marked.amountConfidence).toBe(unmarked.amountConfidence);
      });

      it('reads the Japanese and Korean receipts as the purchases they are', () => {
        // The probe's セブン-イレブン and 스타벅스 receipts, line by line, with their
        // hyphenated phone, address and registration numbers, plus the short
        // receipts the cases above already read.
        const japanese = [
          'セブン-イレブン',
          '渋谷道玄坂二丁目店',
          '東京都渋谷区道玄坂2-10-12',
          'TEL 03-3461-8901',
          '2026年8月14日(金) 19:42',
          'おにぎり 鮭 ¥168',
          '緑茶 500ml ¥151',
          '肉まん ¥180',
          '小計 ¥499',
          '消費税(8%) ¥39',
          '合計 ¥538',
          '現金 ¥1,000',
          'お釣り ¥462',
          '登録番号 T7011001049267',
        ].join('\n');
        const korean = [
          '스타벅스커피 코리아',
          '강남대로점',
          '서울특별시 강남구 강남대로 390',
          'TEL 02-538-4100',
          '사업자번호 201-81-21515',
          '2026-08-11 08:23',
          '아메리카노 (T) 4,500',
          '카페라떼 (G) 5,900',
          '공급가액 9,455',
          '부가세 945',
          '합계 10,400',
          '신용카드 승인 10,400',
        ].join('\n');

        expect(parseReceiptOcrText(japanese)).toEqual(reading(538, 'debit', 0));
        expect(parseReceiptOcrText(korean)).toEqual(reading(10400, 'debit', 0));
        expect(parseReceiptOcrText('セブンイレブン\n2026年1月15日\n合計 1,280円')).toEqual(
          reading(1280, 'debit', 0),
        );
        expect(parseReceiptOcrText('스타벅스 강남점\n합계 ₩12,500\n카드결제 ₩12,500')).toEqual(
          reading(12500, 'debit', 0),
        );
      });

      it("reads a size on a priced line as a copy of a refund's total, the known gap", () => {
        // The bare 10 of 10m is a count beside the price on its line (ADR
        // 0186), and a figure on a line that prints money is a copy of a total
        // of its value, so it twins the total unmarked. A pin: counting only
        // the copies that carry their own sign or are written like money reads
        // this refund as a credit, and costs the purchases of the next case
        // their twin.
        expect(parseReceiptOcrText('Shop\nMooring rope 10m -$10.00\nTOTAL -$10.00')).toEqual(
          reading(10, 'debit', 0.3),
        );
      });

      it('keeps a purchase twinned when its tender line prints the total negative', () => {
        // A pin: neither bare total carries a sign of its own (two spaces from
        // the yen, or none in its run), so that copy rule would keep only the
        // negative tender line and file the sale as a refund. The second is one
        // line, as Vision joins it; split as TOTAL 14 and Card -$14, the bare
        // 14 is not printed as money, and the receipt reads 14 credit 0.5.
        expect(parseReceiptOcrText('Shop\nTotal ¥  480\nVISA -¥480')).toEqual(
          reading(480, 'debit', 0.3),
        );
        expect(parseReceiptOcrText('Shop\nTOTAL 14 Card -$14')).toEqual(reading(14, 'debit', 0.3));
      });

      it("keeps a purchase twinned when a count of its total's value shares a line with money", () => {
        // A pin: the bare 14 is a count on its line, but a copy is read off the
        // line, not the tier. Reading the copies off the tier files this sale
        // as a refund.
        expect(parseReceiptOcrText('Shop\nCard -$14\nTOTAL 14 Tax $1.04')).toEqual(
          reading(14, 'debit', 0.3),
        );
      });

      it('reads no credit off a figure a larger count might have been the total in place of, the known gap', () => {
        // The larger bare figure might be the total, and it carries no mark,
        // whether it shares the marked figure's line or stands where a total
        // does on another. The amount read is a smaller figure, graded under
        // the bar, the known gap.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTotal 12 Tax -$0.96', 0.96],
          ['店\n合計 1280 内税 ▲¥116\n内消費税等 ▲¥116', 116],
          ['Shop\nTotal 12, Coupon -$3.00\nYou saved -$3.00', 3],
          ['店\n合計 980円 値引 ▲¥100\n値引合計 ▲¥100', 100],
          ['店\n値引 ▲¥100 合計 980\n値引合計 ▲¥100', 100],
          ['Shop\nCoupon -$3.00\nTotal 12 Tax $0.96', 3],
          ['Shop\nTax $0.96 Total 12\nYou saved -$3.00', 3],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(
              jasmine.objectContaining({
                amount,
                amountConfidence: 0.6,
                direction: 'debit',
                directionConfidence: 0.3,
              }),
            );
        }
      });

      it("reads a refund's credit off its total where the larger count stands before a price on another line", () => {
        // A pin: a count of what a price buys argues with the item, not the
        // total, and a count before a price printed again argues with neither.
        expect(parseReceiptOcrText('REFUND\nItem 12 -$5.00\nTax -$0.40\nTotal -$5.40')).toEqual(
          reading(5.4, 'credit', 0.5),
        );
        expect(parseReceiptOcrText('REFUND\nPack of 12 -$10.00\nTotal -$10.00')).toEqual(
          reading(10, 'credit', 0.5),
        );
      });

      it("reads half of a time of the total's value as an unmarked copy of it", () => {
        // A pin: a time is never the total, but where it repeats the total's
        // value it twins the mark, so a sale whose bare total line prints no
        // currency mark is not filed as a refund off its card line alone.
        expect(parseReceiptOcrText('Shop\nTotal 32\n14:32 Card -$32.00')).toEqual(
          reading(32, 'debit', 0.3),
        );
        expect(parseReceiptOcrText('REFUND\n2026-09-28 14:14 TOTAL -$14.00')).toEqual(
          reading(14, 'debit', 0.3),
        );
      });

      it('reads a lone parenthesised figure as a credit, the known gap', () => {
        // The price with tax, printed in parentheses under the total, outranks
        // it, and parentheses around money are a credit mark. A pin: reading a
        // figure marked by parentheses alone, beside an unmarked one at least
        // half its size, as a restatement turns it into a purchase graded 0.3,
        // and loses the refund slips of the next case.
        expect(parseReceiptOcrText('店\n合計 ¥1,180\n(¥1,280)')).toEqual(
          reading(1280, 'credit', 0.5),
        );
      });

      it("reads a refund slip's lone parenthesised total as a credit", () => {
        // A pin, and the refunds that restatement rule would lose: the slips
        // print their total exactly as the case above prints its restatement.
        expect(parseReceiptOcrText('REFUND\nJacket $59.99\nTax $4.80\n($64.79)')).toEqual(
          reading(64.79, 'credit', 0.5),
        );
        expect(parseReceiptOcrText('返品\nジャケット ¥5,980\n消費税 ¥598\n(¥6,578)')).toEqual(
          reading(6578, 'credit', 0.5),
        );
      });

      it('reads a labelled figure in parentheses that outranks the total as a credit, the known gap', () => {
        // A pin: the same restatement rule reads it as a purchase graded 0.3.
        // The amount is wrong either way.
        expect(parseReceiptOcrText('Shop\nTotal $59.99\nWas ($79.99)')).toEqual(
          reading(79.99, 'credit', 0.5),
        );
      });

      it('reads a points line in parentheses as a credit on a receipt that prints no currency sign, the known gap', () => {
        // With no sign, the grouped 1,250 is the only figure written like
        // money, so it outranks the plain total, and parentheses around money
        // are a credit mark. A pin: asking unsigned parentheses for a decimal
        // fraction reads it as a plain purchase, and the sign-less refund
        // slips (合計 (1,280)) as purchases with it. Where the total carries
        // a sign, the points line loses to it.
        expect(parseReceiptOcrText('Shop\nTotal 980\nPoints (1,250)')).toEqual(
          reading(1250, 'credit', 0.5),
        );
        expect(parseReceiptOcrText('Shop\nTotal $12.50\nPoints (1,250)')).toEqual(
          reading(12.5, 'debit', 0),
        );
        expect(parseReceiptOcrText('Shop\nTotal ¥980\nPoints (1,250)')).toEqual(
          reading(980, 'debit', 0),
        );
      });
    });
  });
});
