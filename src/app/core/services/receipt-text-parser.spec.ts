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

      it('grades a total under a tax or tip rate printed as a percent, the rate a count that might have been the total, the known gap', () => {
        // A pin, and a flagged cost. The rate's figure is a bare whole number
        // beside money, larger than the total and on another line, so the total
        // read right is flagged; excusing a rate from might-be-total would lift
        // these to 0.8, and the next case's wrong readings with them.
        const cases: [text: string, amount: number][] = [
          ['Diner\nFood $12.00\nTip 18% $2.16\nTotal $14.16', 14.16],
          ['Tesco\nMilk £1.20\nBread £1.10\nVAT 20% £0.38\nTotal £2.30', 2.3],
          ['Shop\nTax 8% $0.40\nTotal $5.40', 5.4],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.6, amountDemotion: 'count' }));
        }
      });

      it('reads a total printed bare under a tax or tip rate as another figure, flagged only by the rate, the known gap', () => {
        // A pin: the rate is the only rival such a reading has, so a rule that
        // excused a rate from might-be-total would read these at 0.8.
        const cases: [text: string, amount: number][] = [
          ['Shop\nTax 8% $0.96\nTotal 12', 0.96],
          ['Shop\nTax 8% $0.40\nTotal 5.40', 0.4],
          ['Diner\nFood $12.00\nTip 18% $2.16\nTotal 14.16', 12],
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

      it('reads the total its sign is glued to, and the date printed after it on its line', () => {
        // A date never starts at a figure its sign is glued to, so the total's
        // own figure starts no run and the date after it is read whole.
        const cases: [text: string, amount: number, dated: number[], dateConfidence: number][] = [
          ['Shop\nTOTAL $12.50 01/15/2026', 12.5, [2026, 1, 15], 0.9],
          ['Shop\n$15.00 01/15/26', 15, [2026, 1, 15], 0.5],
        ];
        for (const [text, amount, dated, dateConfidence] of cases) {
          const result = parseReceiptOcrText(text);
          expect(result)
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, dateConfidence }));
          expect([result.date.getFullYear(), result.date.getMonth() + 1, result.date.getDate()])
            .withContext(text)
            .toEqual(dated);
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

      it('reads the item any figure printed negative (a discount, coupon, gift card, deposit or points) takes the total under, the known gap', () => {
        // Largest-wins (ADR 0013) reads the item, as 26.10.180 does wherever
        // the item's line prints no count, and a saving printed unmarked reads
        // the same. Where the line prints a count, 26.10.180 read the count and
        // the price as a date and the total was what was left.
        const cases: [text: string, amount: number][] = [
          ['Shop\nItem 1 $3.00\nCoupon -$1.00\nTotal $2.00', 3],
          ['Shop\nItem 1 $3.00\nYou saved $1.00\nTotal $2.00', 3],
          ['Shop\nItem 1 $3.00\nDiscount ($1.00)\nTotal $2.00', 3],
          ['Shop\nItem 1 $25.00\nGift card -$10.00\nTotal $15.00', 25],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text)).withContext(text).toEqual(read(amount, 0.8));
        }
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

    describe('beside a price', () => {
      // A date is read from figures printed together on one line, and never
      // through a currency sign (ADR 0186).
      const dated = (text: string) => {
        const { date } = parseReceiptOcrText(text);
        return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
      };

      it('reads a priced line with its sign before the price as money, never as a date', () => {
        const cases: [text: string, amount: number][] = [
          ['Shop\nItem 1 $10.00', 10],
          ['Shop\nItem 1 $10.00\nItem 2 $5.00\nTotal $15.00', 15],
          ['Shop\nTickets 2 $5 $10', 10],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, dateConfidence: 0 }));
        }
      });

      it('reads a date from its own line, never through the price above it', () => {
        const cases: [text: string, amount: number][] = [
          ['Shop\nTotal $5.15\n01/15/2026', 5.15],
          ['Shop\nTotal $5.00\n01/15/2026', 5],
          ['Shop\nItem 1 $10.00\nTotal $10.00\n01/15/2026', 10],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, dateConfidence: 0.9 }));
          expect(dated(text)).withContext(text).toEqual([2026, 1, 15]);
        }
        // The issue's third reading, a pin: a printed date is read first.
        expect(parseReceiptOcrText('Shop\n2026-10-20\nItem 1 $10.00')).toEqual(
          jasmine.objectContaining({ amount: 10, amountConfidence: 0.8, dateConfidence: 0.9 }),
        );
        expect(dated('Shop\n2026-10-20\nItem 1 $10.00')).toEqual([2026, 10, 20]);
        expect(parseReceiptOcrText('Shop\nRef 2025\n3.10\nTotal 3.10').dateConfidence).toBe(0);
        expect(parseReceiptOcrText('Shop\nTotal $5.15\n12:30')).toEqual(
          jasmine.objectContaining({ amount: 5.15, amountConfidence: 0.8, dateConfidence: 0 }),
        );
      });

      it('reads no date from a code beside a price, nor the code as the amount', () => {
        expect(parseReceiptOcrText('Shop\nSKU 2025 $1.10\nTotal $1.10')).toEqual(
          jasmine.objectContaining({ amount: 1.1, amountConfidence: 0.8, dateConfidence: 0 }),
        );
        // Alone, the code is a count larger than the price, so the price is
        // read under the bar.
        expect(parseReceiptOcrText('Shop\nSKU 2025 $1.10')).toEqual(
          jasmine.objectContaining({
            amount: 1.1,
            amountConfidence: 0.6,
            amountDemotion: 'count',
            dateConfidence: 0,
          }),
        );
      });

      it('reads every count, code and price of a priced line as the money it is, and none of it as a date, where a sign leads the price or a line break parts them', () => {
        // The gate (ADR 0145): 72 prices, each under six counts in three
        // layouts, three codes in two, and a dated total: 1,800 readings.
        const wrong: string[] = [];
        const expectReading = (text: string, expected: Record<string, number | string>) => {
          const result = parseReceiptOcrText(text);
          const actual: Record<string, unknown> = { ...result, day: result.date.getDate() };
          const off = Object.keys(expected).filter(key => actual[key] !== expected[key]);
          if (off.length > 0) {
            wrong.push(`${JSON.stringify(text)} read ${off.map(key => `${key} ${actual[key]}`).join(', ')}`);
          }
        };
        for (let units = 1; units <= 12; units++) {
          for (const cents of ['00', '10', '12', '13', '26', '31']) {
            const price = `${units}.${cents}`;
            const amount = Number(price);
            const money = { amount, amountConfidence: 0.8, dateConfidence: 0 };
            for (const count of [1, 9, 12, 13, 24, 31]) {
              expectReading(`Shop\nItem ${count} $${price}\nTotal $${price}`, money);
              expectReading(`Shop\nItem ${count}\n$${price}\nTotal\n$${price}`, money);
              // A count of the refund's own value copies its total: the
              // known gap below.
              expectReading(
                `Shop\nItem ${count} -$${price}\nTotal -$${price}`,
                count === amount
                  ? { ...money, direction: 'debit', directionConfidence: 0.3 }
                  : { ...money, direction: 'credit', directionConfidence: 0.5 },
              );
            }
            for (const code of [1234, 2016, 2025]) {
              expectReading(`Shop\nSKU ${code} $${price}\nTotal $${price}`, money);
              expectReading(`Shop\nSKU ${code}\n${price}`, { ...money, amountConfidence: 0.5 });
            }
            expectReading(`Shop\nTotal $${price}\n01/15/2026`, {
              amount,
              amountConfidence: 0.8,
              dateConfidence: 0.9,
              day: 15,
            });
          }
        }
        expect(wrong).toEqual([]);
      });

      it('reads a priced line printed with no sign, or with its sign after the figure, as a date, flagged, the known gap', () => {
        // A currency sign parts two figures only where it stands between them.
        // With no sign, or one after the price, the count and the price read as
        // a date in the year of the price's cents, graded under the bar, and
        // drop out of the amount hunt, as on 26.10.180.
        const cases: [text: string, amount: number, amountConfidence: number, year: number][] = [
          ['Shop\nMilk 1 3.25', 0, 0, 2025],
          ['Bäckerei\nBrot 1 2,10 €', 0, 0, 2010],
          ['Shop\nMilk 1 3.25\nTotal 3.25', 3.25, 0.5, 2025],
          ['Laden\nBrot 1 2,10 €\nSumme 2,10 €', 2.1, 0.8, 2010],
        ];
        for (const [text, amount, amountConfidence, year] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence, dateConfidence: 0.3 }));
          expect(dated(text)[0]).withContext(text).toBe(year);
        }
      });

      it('reads a two-digit year after one to three marks or spaces, as 26.10.180 does', () => {
        // A pin, OCR's spacing included: a space either side of a mark, a mark
        // other than the one between the day and the month, and an apostrophe
        // before the year.
        for (const text of [
          'Shop\n15.01.26',
          'Shop\n1/15/26',
          'Shop\n15-01-26',
          'Shop\n15.01. 26\nTotal 5.00',
          "Shop\n15/01/'26\nTotal $12.50",
          'Shop\n15.01 .26\nTotal $12.50',
          'Shop\n15 /01/26\nTotal $12.50',
          'Shop\n15/ 01/26\nTotal $12.50',
          'Shop\n15/01 /26\nTotal $12.50',
          'Shop\n15/01-26\nTotal $12.50',
          'Shop\n15.01/26\nTotal $12.50',
          'Shop\n15/01 26\nTotal $12.50',
        ]) {
          expect(parseReceiptOcrText(text).dateConfidence).withContext(text).toBe(0.5);
          expect(dated(text)).withContext(text).toEqual([2026, 1, 15]);
        }
        expect(parseReceiptOcrText('Shop\n15.01. 26\nTotal 5.00').amount).toBe(5);
        expect(parseReceiptOcrText('Shop\nDate: 15.01 .26 Total: $12.50')).toEqual(
          jasmine.objectContaining({ amount: 12.5, amountConfidence: 0.8 }),
        );
      });

      it('reads a date after a mark that joins no figure', () => {
        // A pin: a date may follow such a mark where no digit stands before it.
        const text = 'Shop\nNo.15/01/26\nTotal $3.00';
        expect(parseReceiptOcrText(text)).toEqual(
          jasmine.objectContaining({ amount: 3, amountConfidence: 0.8, dateConfidence: 0.5 }),
        );
        expect(dated(text)).toEqual([2026, 1, 15]);
      });

      it('reads a four-digit year after whatever mark leads to it', () => {
        for (const text of ['Shop\n15/ 01/2026', 'Shop\n01/15.2026', 'Shop\n15/01/ 2026']) {
          expect(parseReceiptOcrText(text).dateConfidence).withContext(text).toBe(0.9);
          expect(dated(text)).withContext(text).toEqual([2026, 1, 15]);
        }
      });

      it('reads a four-digit code before a price with no sign as a date, the known gap', () => {
        const result = parseReceiptOcrText('Shop\nRef 2025 1.10\nTotal 1.10');
        expect(result.dateConfidence).toBe(0.9);
        expect(result.date.getFullYear()).toBe(2025);
      });

      it('reads no date OCR wrapped across two lines, and reads a part it leaves as money, the known gap', () => {
        expect(parseReceiptOcrText('Shop\n15/01/\n2026').dateConfidence).toBe(0);
        // The day and month, written like money, outrank the total: on a slip
        // that prints no currency mark the refund reads as a purchase. A year
        // left on a line with a currency code outranks the total too.
        const cases: [text: string, amount: number, amountConfidence: number][] = [
          ['REFUND\n13.01.\n24\nItem -4.50\nTotal -4.50', 13.01, 0.5],
          ['Shop\nItem 4.50\nTotal 4.50 EUR 13.01.\n24', 13.01, 0.8],
          ['Shop\n13.01.\n2024 14:32 EUR\nItem $45.00\nTotal $45.00', 2024, 0.8],
        ];
        for (const [text, amount, amountConfidence] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(
              jasmine.objectContaining({
                amount,
                amountConfidence,
                direction: 'debit',
                directionConfidence: 0,
                dateConfidence: 0,
              }),
            );
        }
      });

      it('reads a date wherever one to three marks or spaces part three short numbers, the known gap', () => {
        expect(parseReceiptOcrText('Shop\nItem 2 5 10\nTotal 10').dateConfidence).toBe(0.3);
        const time = parseReceiptOcrText('Shop\n10:15:26 01/15/2026\nTotal $5');
        expect(time.dateConfidence).toBe(0.5);
        expect([time.date.getFullYear(), time.date.getMonth() + 1, time.date.getDate()]).toEqual([
          2026, 10, 15,
        ]);
      });

      it("starts no date inside a price's cents, nor at a price its sign is glued to", () => {
        // The 01 that ends $145.01 is cents, not a day: the date is 01 01 24.
        const text = 'Shop\nTotal $145.01 01 01 24';
        expect(parseReceiptOcrText(text)).toEqual(
          jasmine.objectContaining({ amount: 145.01, amountConfidence: 0.8, dateConfidence: 0.3 }),
        );
        expect(dated(text)).toEqual([2024, 1, 1]);
        // Nor at a figure its sign is glued to: 38.01 01 is no run.
        const glued = 'Shop\nTotal $38.01 01 01 24';
        expect(parseReceiptOcrText(glued)).toEqual(
          jasmine.objectContaining({ amount: 38.01, amountConfidence: 0.8, dateConfidence: 0.3 }),
        );
        expect(dated(glued)).toEqual([2024, 1, 1]);
        // Where the sign stands apart, the price's own figure starts a run
        // that cannot be a date, the date printed after it is lost, and the
        // price still reads whole.
        expect(parseReceiptOcrText('Shop\nTotal $ 38.01 01 01 24')).toEqual(
          jasmine.objectContaining({ amount: 38.01, amountConfidence: 0.8, dateConfidence: 0 }),
        );
      });

      it('reads a price its sign is glued to as money, and the date printed after it as that date', () => {
        const cases: [text: string, amount: number, dated: number[]][] = [
          ['Shop\nItem 1 $10.00\nTotal $27.01 12/5/24', 27.01, [2024, 12, 5]],
          ['Shop\nItem $3\nTotal $3\nCard ****1234 $3 1/13/24', 3, [2024, 1, 13]],
        ];
        for (const [text, amount, date] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8 }));
          expect(dated(text)).withContext(text).toEqual(date);
        }
      });

      it('reads the date printed after a price whose sign follows it, on its line or the next', () => {
        // A pin: only a sign glued to the figure after it bars a date from
        // starting there. One printed after the price, with a space or a line
        // break before the date, does not, and barring a sign a space follows
        // as well would lose these dates.
        const cases: [text: string, amount: number, date: number[], dateConfidence: number][] = [
          ['Shop\nTotal 5,00 € 15.01.26', 5, [2026, 1, 15], 0.5],
          ['Shop\nSumme 12,50 €\n15.01.2026', 12.5, [2026, 1, 15], 0.9],
          ['Shop\nTotal 5.00$ 01/15/2026', 5, [2026, 1, 15], 0.9],
        ];
        for (const [text, amount, date, dateConfidence] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, dateConfidence }));
          expect(dated(text)).withContext(text).toEqual(date);
        }
      });

      it("reads a run that only looks like a date where a price's own figure starts it, and loses that price, the known gap", () => {
        // 26.10.180 read a date through a currency sign above these lines (the
        // 1 $10.00 of Item 1 $10.00) and stopped there. With the sign parting
        // the figures, the reader goes on, and a run that starts at a price's
        // figure takes the price, or its cents, into the date. A sign glued to
        // the price stops the run from starting there; a sign spaced from it,
        // a code before it, or no sign at all does not.
        const cases: [text: string, amount: number][] = [
          // The total's whole part, its cents and the date's first number.
          ['Shop\nItem 1 $10.00\nTotal $ 27.01 12/5/24', 24],
          ['Shop\nItem 1 $10.00\nTotal USD 27.01 12/5/24', 24],
          ['Shop\nTotal $ 5.15 01/15/26', 26],
          // A card line's whole-number amount and the date after it.
          ['Shop\nItem $3\nTotal $3\nCard ****1234 $ 3 1/13/24', 1234],
          // A unit price's cents and the line total's whole part.
          ['Laden\nBrot 1 €2,10\nKaffee 2 x 5,10 10,20 €\nSumme 10,20 €', 20],
          // A count printed before the total, and the total.
          ['Shop\nItem 1 $10.00\nKaffee €2,10\nSumme (2) 12,10 €', 10],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8 }));
        }
      });

      it("twins the direction off a payment line where the total's sign is glued to it, as 26.10.180 does", () => {
        // No run starts at the total's own figure, so the total and the
        // payment line's copy of it disagree, and both are twinned at 0.3.
        const cases: string[] = [
          'REFUND\nItem 1 -$10.00\nTotal -$27.01 01/13/25\nVISA $27.01',
          'Shop\nItem 1 $10.00\nTotal $27.01 01/13/25\nCard -27.01 USD',
        ];
        for (const text of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(
              jasmine.objectContaining({
                amount: 27.01,
                amountConfidence: 0.8,
                direction: 'debit',
                directionConfidence: 0.3,
                dateConfidence: 0.5,
              }),
            );
          expect(dated(text)).withContext(text).toEqual([2025, 1, 13]);
        }
      });

      it("reads the direction off a payment line where a run that only looks like a date took the total's own figure, the known gap", () => {
        // With the sign spaced from the total, the run 27.01 01 takes the
        // total's own figure into a date, graded under the bar, and the amount
        // still reads right, off the payment line that repeats it. But that
        // copy then decides the direction alone: a refund whose card line
        // prints the total unmarked is filed as a purchase graded 0, and a
        // sale whose card line prints it negative as a refund. 26.10.180
        // twinned both at 0.3.
        const cases: [text: string, direction: 'credit' | 'debit', directionConfidence: number][] = [
          ['REFUND\nItem 1 -$10.00\nTotal -$ 27.01 01/13/25\nVISA $27.01', 'debit', 0],
          ['Shop\nItem 1 $10.00\nTotal $ 27.01 01/13/25\nCard -27.01 USD', 'credit', 0.5],
        ];
        for (const [text, direction, directionConfidence] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(
              jasmine.objectContaining({
                amount: 27.01,
                amountConfidence: 0.8,
                direction,
                directionConfidence,
                dateConfidence: 0.5,
              }),
            );
        }
      });

      it('reads a day-first date printed right after a whole-number price its sign is glued to', () => {
        const cases: [text: string, amount: number, extra: Record<string, unknown>, date: number[]][] = [
          ['Laden\nMilch 2 €13 24.07.24\nSumme €26,00', 26, { dateConfidence: 0.5 }, [2024, 7, 24]],
          [
            'REFUND\nItem 2 -$15 24.07.23\nTotal -$30',
            30,
            { direction: 'credit', directionConfidence: 0.5, dateConfidence: 0.5 },
            [2023, 7, 24],
          ],
        ];
        for (const [text, amount, extra, date] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, ...extra }));
          expect(dated(text)).withContext(text).toEqual(date);
        }
      });

      it('reads a day-first date printed right after a whole-number price as one figure of money, the known gap', () => {
        // With the sign spaced from the price, the run 13 24.07 is rejected
        // as a date and consumed: the reader goes on from where the run ends,
        // so 24.07.24, which starts inside it, is never tried, and it stands
        // as one figure written like money, larger than the total. 26.10.180
        // read the first one's date through the sign (2 € 13 24), which split
        // it.
        const cases: [text: string, amount: number, extra: Record<string, unknown>][] = [
          ['Laden\nMilch 2 € 13 24.07.24\nSumme €26,00', 2407.24, { dateConfidence: 0 }],
          [
            'REFUND\nItem 2 -$ 15 24.07.23\nTotal -$30',
            2407.23,
            { direction: 'debit', directionConfidence: 0, dateConfidence: 0 },
          ],
        ];
        for (const [text, amount, extra] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8, ...extra }));
        }
      });

      it('reads no date glued to a figure by a mark, the known gap', () => {
        // A date never starts inside a figure, so one glued to a code by a mark
        // that joins digits (4711.13/01/25) is not read, and the code with the
        // day for its cents outranks the total. On a slip that prints no
        // currency mark the refund then reads as a purchase. 26.10.180 read
        // the date, and the refund's total.
        expect(parseReceiptOcrText('Storno\nBon 4711.13/01/25\nBrot -2,50\nSumme -12,50')).toEqual(
          jasmine.objectContaining({
            amount: 4711.13,
            amountConfidence: 0.5,
            direction: 'debit',
            directionConfidence: 0,
            dateConfidence: 0,
          }),
        );
      });

      it('reads no date glued after a currency sign, and reads a day-first one as one figure of money, the known gap', () => {
        // A date never starts at a figure its sign is glued to, so a date
        // printed glued after a sign is not read. Day first with dots, its
        // groups read as one figure written like money, at 0.8; with slashes,
        // as counts beside the money, under the bar. 26.10.180 read both
        // dates, and the total.
        expect(parseReceiptOcrText('Shop\n€15.01.26\nSumme €5,00')).toEqual(
          jasmine.objectContaining({ amount: 1501.26, amountConfidence: 0.8, dateConfidence: 0 }),
        );
        expect(parseReceiptOcrText('Shop\nDate:$01/15/2026 Total $5.00')).toEqual(
          jasmine.objectContaining({
            amount: 5,
            amountConfidence: 0.6,
            amountDemotion: 'count',
            dateConfidence: 0,
          }),
        );
      });

      describe('on 30 October 2026', () => {
        // The future-date guard decides this reading, so the clock is held on
        // the day it was taken: from 22 January 2027, 23.01.27 read day first
        // is no longer a date to turn down.
        beforeEach(() => {
          jasmine.clock().install();
          jasmine.clock().mockDate(new Date(2026, 9, 30));
        });

        afterEach(() => {
          jasmine.clock().uninstall();
        });

        it('reads a two-digit-year date printed year first as one figure of money, the known gap', () => {
          // Read day first, 23.01.27 is a date in 2027, so the reader turns it
          // down and the three groups are left as one figure written like money.
          // 26.10.180 read a date across the line break above it (7 / 23.01).
          expect(parseReceiptOcrText('Market 7\n23.01.27 JPY\nお茶 ¥150\n弁当 ¥480\n合計 ¥630')).toEqual(
            jasmine.objectContaining({ amount: 2301.27, amountConfidence: 0.8, dateConfidence: 0 }),
          );
          expect(parseReceiptOcrText('Market 7\n23.01.27\nREFUND\nItem -12.50\nTotal -12.50')).toEqual(
            jasmine.objectContaining({
              amount: 2301.27,
              amountConfidence: 0.5,
              direction: 'debit',
              directionConfidence: 0,
            }),
          );
        });
      });

      it('reads a signed figure over a total line led by its date that prints no currency mark, the known gap', () => {
        // 26.10.180 read a date across the line break (the 2 of x2 and the
        // 1/13 below it), which joined the total to the signed line above.
        // Read on its own line, the date leaves the total bare, in a weaker
        // tier than the signed item.
        expect(parseReceiptOcrText('Shop\nTea $2.00\nBagel $4.50 x2\n1/13/24 Total 45.00')).toEqual(
          jasmine.objectContaining({ amount: 4.5, amountConfidence: 0.8, direction: 'debit' }),
        );
        expect(
          parseReceiptOcrText('REFUND\nTea -$2.00\nBagel -$4.50 x2\n1/13/24 Total -45.00'),
        ).toEqual(jasmine.objectContaining({ amount: 4.5, amountConfidence: 0.8, direction: 'credit' }));
      });

      it('reads a signed figure over a total that prints no currency mark, the known gap', () => {
        // 26.10.180 read the signed figure's count and price as a date, which
        // left the bare total the largest figure written like money.
        const cases: [text: string, amount: number][] = [
          ['Laden\nBrot 1 €2,10\nKaffee 2 x 5,10 10,20\nSumme 10,20', 2.1],
          ['Market 7\nCrisps 87.78 6\nScone Qty 3 £13.20\nTotal 100.98', 13.2],
        ];
        for (const [text, amount] of cases) {
          expect(parseReceiptOcrText(text))
            .withContext(text)
            .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.8 }));
        }
      });

      it('reads a bare figure on a line whose only money is a labelled aside as money, the known gap', () => {
        // An aside prices nothing, so a whole number beside it is the line's
        // money (ADR 0186): here a points balance. 26.10.180 read the tax rate
        // and the aside's figure as a date through the euro sign.
        expect(parseReceiptOcrText('Shop\nSumme 184,73 EUR\n(IVA 5% €9,24) Points 1847')).toEqual(
          jasmine.objectContaining({ amount: 1847, amountConfidence: 0.8 }),
        );
      });
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

    it('names the first rule that moved the reading: an aside, then a count, then the cash tendered', () => {
      // A pin: passing an aside outranks a count that might have been the
      // total, and both outrank the cash-tendered sum, so a model that agrees
      // with such a reading keeps the parser's grade on the device lane. Naming
      // the cash tendered first, or the count before the aside, relabels these.
      const cases: [text: string, amount: number, amountDemotion: string][] = [
        ['Shop\nCash $50.00\n(Total $43.10)\nChange $6.90\nStore 72', 43.1, 'aside'],
        ['Shop\nItem 72 $43.10\nCash $50.00\nChange $6.90', 43.1, 'count'],
        ['Shop\nRoom 412 $89.00\n(Reg $99.00)', 89, 'aside'],
      ];
      for (const [text, amount, amountDemotion] of cases) {
        expect(parseReceiptOcrText(text))
          .withContext(text)
          .toEqual(jasmine.objectContaining({ amount, amountConfidence: 0.6, amountDemotion }));
      }
    });
  });

  describe('a labelled aside in parentheses', () => {
    // A figure inside parentheses that hold a word as well, (Reg $15.00), is
    // a regular price, a balance or a saving printed beside the total, never
    // the total while its tier holds a figure printed on its own (ADR 0186).
    // Passing it, or keeping it for want of anything else while a weaker tier
    // holds a figure printed on its own, lands under the bar.
    const graded = (
      amount: number,
      amountConfidence: number,
      direction: 'credit' | 'debit',
      directionConfidence: number,
    ) => jasmine.objectContaining({ amount, amountConfidence, direction, directionConfidence });

    it('reads the total beside a regular price in parentheses, flagged', () => {
      for (const text of ['Shop\nTotal $12.50\n(Reg $15.00)', 'Shop\nTotal $12.50\n($15.00 reg)']) {
        expect(parseReceiptOcrText(text))
          .withContext(text)
          .toEqual(
            jasmine.objectContaining({
              amount: 12.5,
              amountConfidence: 0.6,
              amountDemotion: 'aside',
              direction: 'debit',
              directionConfidence: 0,
            }),
          );
      }
    });

    it('reads an aside in fullwidth parentheses, in any script', () => {
      expect(parseReceiptOcrText('店\n合計 ¥1,280\n（定価 ¥1,580）')).toEqual(
        graded(1280, 0.6, 'debit', 0),
      );
    });

    it("reads a refund's mark off the total the aside outranked", () => {
      expect(parseReceiptOcrText('REFUND\nTotal -$12.50\n(Reg $15.00)')).toEqual(
        graded(12.5, 0.6, 'credit', 0.5),
      );
    });

    it('reads an aside Vision handed back across two lines', () => {
      expect(parseReceiptOcrText('Shop\nTotal\n$12.50\n(Reg\n$15.00)')).toEqual(
        graded(12.5, 0.6, 'debit', 0),
      );
    });

    it('grades an aside it reads for want of anything else in its tier, flagged', () => {
      expect(parseReceiptOcrText('Shop\nTotal 12.50\n(Reg $15.00)')).toEqual(
        graded(15, 0.6, 'debit', 0),
      );
      expect(parseReceiptOcrText('店\n合計 980\n(内税 ¥72)')).toEqual(graded(72, 0.6, 'debit', 0));
    });

    it('reads past a price with tax, or a total, printed as an aside: flagged on a purchase, and on a refund slip read as a purchase, the known gap', () => {
      expect(parseReceiptOcrText('店\n合計 ¥1,180\n(税込¥1,298)')).toEqual(
        graded(1180, 0.6, 'debit', 0),
      );
      expect(parseReceiptOcrText('店\n合計 ¥1,000\n（税込 ¥1,100）')).toEqual(
        graded(1000, 0.6, 'debit', 0),
      );
      // The refund slip's credit is printed on no figure read, so it is filed
      // as a purchase with no flag on its type.
      expect(parseReceiptOcrText('REFUND\nJacket $59.99\nTax $4.80\n(Total $64.79)')).toEqual(
        graded(59.99, 0.6, 'debit', 0),
      );
    });

    describe('what it leaves alone', () => {
      it('keeps an aside that is the only figure on the receipt', () => {
        expect(parseReceiptOcrText('Shop\n(Reg $15.00)')).toEqual(graded(15, 0.8, 'debit', 0));
      });

      it("reads a sign's capitals and the receipt's currency code as money, not a word", () => {
        expect(parseReceiptOcrText('Shop\nJacket $5.00\nTotal (US$ 12.50)')).toEqual(
          graded(12.5, 0.8, 'debit', 0),
        );
        expect(parseReceiptOcrText('Shop\nJacket $5.00\nTotal (US$12.50)')).toEqual(
          graded(12.5, 0.8, 'credit', 0.5),
        );
        expect(
          parseReceiptOcrText('Shop\nJacket 59.99 USD\nTax 4.80 USD\nTotal (USD 64.79)'),
        ).toEqual(graded(64.79, 0.8, 'debit', 0));
      });

      it('reads a figure printed negative inside labelled parentheses as the total, never an aside', () => {
        expect(parseReceiptOcrText('REFUND\nJacket $59.99\nTax $4.80\n(Refund -$64.79)')).toEqual(
          graded(64.79, 0.8, 'credit', 0.5),
        );
        expect(parseReceiptOcrText('返品\nジャケット ¥5,980\n消費税 ¥598\n(返金 -¥6,578)')).toEqual(
          graded(6578, 0.8, 'credit', 0.5),
        );
      });

      it('still counts an aside in the cash the total was change for', () => {
        expect(parseReceiptOcrText('Shop\nTotal $43.10\nCash $50.00\n(Change $6.90)')).toEqual(
          graded(43.1, 0.6, 'debit', 0),
        );
      });

      it("counts an aside of the total's value as a copy of it", () => {
        expect(parseReceiptOcrText('Shop\nTotal -$12.50\n(Card $12.50)')).toEqual(
          graded(12.5, 0.8, 'debit', 0.3),
        );
      });

      it("reads a label glued to its sign as the sign's capitals, the known gap", () => {
        expect(parseReceiptOcrText('Shop\nTotal $12.50\n(REG$15.00)')).toEqual(
          graded(15, 0.8, 'credit', 0.5),
        );
      });
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

      it("reads a count of a refund's own value on a priced line as a copy of its total, the known gap", () => {
        // The 12 is a count on a line that prints money, which makes it a copy
        // of the total, unmarked, as the size above is (ADR 0186).
        expect(parseReceiptOcrText('Shop\nPack of 12 -$12.00\nTotal -$12.00')).toEqual(
          reading(12, 'debit', 0.3),
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
