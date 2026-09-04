import { datedToday, needsDateAnswer, parseAmountInput, withoutFieldConfidence } from './import-review.utils';
import { CategorizedImportTransaction } from '../../models';

/**
 * Dates are built from local parts (`new Date(2026, 5, 15)`), never parsed
 * from an ISO string: `new Date('2026-06-15')` is UTC midnight, which is the
 * 14th in a negative-offset zone. This file runs in `test:dates` under both
 * America/New_York and Asia/Tokyo, and "today" is the local calendar day.
 */
describe('import-review.utils', () => {
  describe('datedToday', () => {
    // A fixed `now` rather than the clock: the edges below sit one
    // millisecond apart, and a run that straddled midnight would otherwise
    // disagree with itself. Mid-June, clear of every DST switch.
    const now = new Date(2026, 5, 15, 12, 30);

    it('is true from local midnight to the last millisecond of the day', () => {
      expect(datedToday(new Date(2026, 5, 15, 0, 0, 0, 0), now)).toBeTrue();
      expect(datedToday(new Date(2026, 5, 15, 23, 59, 59, 999), now)).toBeTrue();
    });

    it('is false one millisecond either side', () => {
      // Overflowing parts roll over: the first is 23:59:59.999 on the 14th,
      // the second 00:00:00.000 on the 16th.
      expect(datedToday(new Date(2026, 5, 15, 0, 0, 0, -1), now)).toBeFalse();
      expect(datedToday(new Date(2026, 5, 15, 23, 59, 59, 1000), now)).toBeFalse();
    });

    it('honours the now it is given over the clock', () => {
      expect(datedToday(now, new Date(2026, 5, 16, 0, 0, 0, 0))).toBeFalse();
      expect(datedToday(now, new Date(2026, 5, 15, 0, 0, 0, 0))).toBeTrue();
    });

    it('defaults now to the clock', () => {
      expect(datedToday(new Date())).toBeTrue();
    });
  });

  describe('withoutFieldConfidence', () => {
    it('drops the named grade and keeps the other', () => {
      expect(withoutFieldConfidence({ amount: 0.5, date: 0.3 }, 'date')).toEqual({ amount: 0.5 });
      expect(withoutFieldConfidence({ amount: 0.5, date: 0.3 }, 'amount')).toEqual({ date: 0.3 });
    });

    it('returns undefined once the last grade is gone, not an empty object', () => {
      // Absent is the documented "nobody graded it" shape (the CSV and JSON
      // rows carry it); `{}` would be a third shape for every reader to learn.
      expect(withoutFieldConfidence({ date: 0.3 }, 'date')).toBeUndefined();
      expect(withoutFieldConfidence({ amount: 0.3 }, 'amount')).toBeUndefined();
    });

    it('passes an absent grade through', () => {
      expect(withoutFieldConfidence(undefined, 'date')).toBeUndefined();
    });

    it('leaves the grade it was given untouched', () => {
      // The grade belongs to a row the parent still holds; the card replaces
      // rows rather than mutating them, and this helper must not undo that.
      const grade = { amount: 0.5, date: 0.3 };
      withoutFieldConfidence(grade, 'date');
      expect(grade).toEqual({ amount: 0.5, date: 0.3 });
    });
  });

  describe('needsDateAnswer', () => {
    const now = new Date(2026, 5, 15, 12, 30);
    const yesterday = new Date(2026, 5, 14, 9, 0);

    const row = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      id: 'r1',
      description: 'Coffee',
      amount: 5,
      currency: 'USD',
      date: new Date(2026, 5, 15, 9, 0),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides,
    });

    it('never asks about a row outside the attention set, whatever its date', () => {
      // Statements, bank PDFs, CSV and JSON rows are historical by nature;
      // flagging every one would train the user to ignore the marker.
      expect(needsDateAnswer(row({ dateAssumed: true }), false, now)).toBeFalse();
      expect(needsDateAnswer(row({ date: yesterday }), false, now)).toBeFalse();
    });

    it('does not ask about a row the reviewer left out', () => {
      expect(needsDateAnswer(row({ selected: false, dateAssumed: true }), true, now)).toBeFalse();
      expect(needsDateAnswer(row({ selected: false, date: yesterday }), true, now)).toBeFalse();
    });

    it('does not ask again once the row was answered', () => {
      expect(needsDateAnswer(row({ dateReviewed: true, dateAssumed: true }), true, now)).toBeFalse();
      expect(needsDateAnswer(row({ dateReviewed: true, date: yesterday }), true, now)).toBeFalse();
    });

    it('asks about an assumed date even though it reads as today', () => {
      expect(needsDateAnswer(row({ dateAssumed: true }), true, now)).toBeTrue();
    });

    it('asks about a confidently read date that is not today', () => {
      expect(needsDateAnswer(row({ date: yesterday, fieldConfidence: { date: 0.95 } }), true, now)).toBeTrue();
    });

    it('leaves a confidently read date of today alone', () => {
      expect(needsDateAnswer(row({ fieldConfidence: { date: 0.95 } }), true, now)).toBeFalse();
    });
  });

  describe('parseAmountInput', () => {
    it('reads an English-grouped amount', () => {
      expect(parseAmountInput('1,234.50')).toBe(1234.5);
    });

    it('ignores a currency symbol the reviewer left in place', () => {
      // The field is seeded from the row's own number, but a reviewer
      // retyping an amount off a receipt types what is printed on it.
      expect(parseAmountInput('¥538')).toBe(538);
    });

    it('reads a lone comma as the decimal mark', () => {
      expect(parseAmountInput('12,5')).toBe(12.5);
    });

    it('reads a European-grouped amount', () => {
      // The comma is the decimal mark here, which makes every dot a group
      // separator — the same string English grouping spells "1234.50".
      expect(parseAmountInput('1.234,50')).toBe(1234.5);
    });

    it('never takes a sign from the text — type owns it', () => {
      // The type toggle is the only control that decides income or expense;
      // a minus typed into the amount would otherwise flip a row silently.
      expect(parseAmountInput('-42')).toBe(42);
    });

    it('reads the full-width digits an IME leaves in the field', () => {
      // ja and tc reviewers type with the IME on, and the receipts this
      // editor exists for are routinely Japanese. Stripping to ASCII threw
      // the whole figure away, so the editor closed on an unchanged amount
      // with nothing to say the correction had been dropped.
      expect(parseAmountInput('１２３')).toBe(123);
      expect(parseAmountInput('１，２３４．５０')).toBe(1234.5);
    });

    it('refuses anything that is not a positive number', () => {
      expect(parseAmountInput('')).toBeNull();
      expect(parseAmountInput('abc')).toBeNull();
      expect(parseAmountInput('0')).toBeNull();
      expect(parseAmountInput('0.00')).toBeNull();
    });

    it('cancels rather than reading a prefix off grouping it cannot place', () => {
      // `parseFloat` stops at the second separator and hands back what it
      // read so far, so each of these used to come back a plausible figure
      // that was not the one typed: the German "1.234.567" as 1.234, the
      // lakh-grouped "1,23,456" as 1.23456. On a money field a cancel leaves
      // the amount and its verify flag standing; a wrong number files
      // silently and takes the flag with it.
      expect(parseAmountInput('1.234.567')).toBeNull();
      expect(parseAmountInput('1,23,456')).toBeNull();
      expect(parseAmountInput('1,2,3')).toBeNull();
    });
  });
});
