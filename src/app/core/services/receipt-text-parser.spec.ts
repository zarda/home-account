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
        // The bare 10 of 10m shares its line's currency sign, so it is read as
        // money, wins the tie as the first figure printed, and twins the total
        // unmarked. A pin: counting only the copies that carry their own sign
        // or are written like money reads this refund as a credit, and costs
        // the purchases of the next case their twin.
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
