import {
  blankImportRow,
  datedToday,
  imageSources,
  joinSentences,
  needsDateAnswer,
  parseAmountInput,
  rowIsUnfilled,
  sameSplit,
  splitImportRow,
  withoutFieldConfidence,
} from './import-review.utils';
import { CategorizedImportTransaction, ImagePositionMetadata } from '../../models';

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

  describe('blankImportRow', () => {
    const neighbour = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      id: 'r1',
      description: 'Coffee',
      amount: 5,
      currency: 'KRW',
      date: new Date(2026, 5, 14, 9, 0),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides,
    });

    it('takes the date and the currency of the row it follows', () => {
      // A row the reviewer adds belongs to the receipt above it: the trip's
      // currency and the day that receipt was issued, not today in the
      // account's base.
      const previous = neighbour();
      const row = blankImportRow('manual_1', previous, 'USD');

      expect(row.date.getTime()).toBe(previous.date.getTime());
      expect(row.currency).toBe('KRW');
    });

    it('falls back to today and the fallback currency on an empty list', () => {
      const row = blankImportRow('manual_1', undefined, 'JPY');

      expect(datedToday(row.date)).toBeTrue();
      expect(row.currency).toBe('JPY');
    });

    it('carries nothing a reader would have produced', () => {
      // No photo to attach, nothing read and so nothing graded: an absent
      // grade is the "nobody doubts it" shape needsVerification already
      // reads, and a mark would flag a row nobody could have misread.
      const row = blankImportRow('manual_1', neighbour({
        imageMetadata: {
          imageIndex: 0, imageId: 'image_0', positionInImage: 'top', confidenceScore: 0.9, receiptId: 1,
        },
        fieldConfidence: { amount: 0.2, date: 0.3 },
        dateAssumed: true,
        currencyFellBack: true,
        tags: ['coffee'],
        location: { name: 'Myeongdong' },
      }), 'USD');

      expect(row.imageMetadata).toBeUndefined();
      expect(row.fieldConfidence).toBeUndefined();
      expect(row.dateAssumed).toBeUndefined();
      expect(row.currencyFellBack).toBeUndefined();
      expect(row.tags).toBeUndefined();
      expect(row.location).toBeUndefined();
    });

    it('starts empty, selected, and nobody\'s duplicate', () => {
      const row = blankImportRow('manual_1', undefined, 'USD');

      expect(row.id).toBe('manual_1');
      expect(row.description).toBe('');
      expect(row.amount).toBe(0);
      expect(row.type).toBe('expense');
      expect(row.suggestedCategoryId).toBe('other_expense');
      expect(row.categoryConfidence)
        .withContext('nothing suggested the category, so the card offers it as a guess')
        .toBe(0);
      expect(row.isDuplicate).toBeFalse();
      expect(row.selected).toBeTrue();
    });

    it('keeps its own date object, so an edit to one row cannot move another', () => {
      const previous = neighbour();
      const row = blankImportRow('manual_1', previous, 'USD');

      expect(row.date).not.toBe(previous.date);
    });
  });

  describe('rowIsUnfilled', () => {
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

    it('is false for a row that carries both an amount and a description', () => {
      expect(rowIsUnfilled(row())).toBeFalse();
    });

    it('is true while the amount is still nothing', () => {
      // The figure a blank row is born with, and the one no import may ship.
      expect(rowIsUnfilled(row({ amount: 0 }))).toBeTrue();
    });

    it('is true for any other figure an import could not ship', () => {
      // The reading is "not more than zero", not "is zero", which `=== 0`
      // would satisfy for the case above and for nothing here: NaN is what a
      // truthy non-number in a model's answer parses to, and a negative
      // figure is a sign `type` — not the amount — is what states.
      expect(rowIsUnfilled(row({ amount: NaN }))).toBeTrue();
      expect(rowIsUnfilled(row({ amount: -5 }))).toBeTrue();
    });

    it('is true for a description that is blank or only whitespace', () => {
      expect(rowIsUnfilled(row({ description: '' }))).toBeTrue();
      expect(rowIsUnfilled(row({ description: '   ' }))).toBeTrue();
    });

    it('ignores a row the reviewer left out', () => {
      // A deselected row is not going to be imported, so nothing about it
      // holds Continue — the same rule needsDateAnswer follows.
      expect(rowIsUnfilled(row({ selected: false, amount: 0, description: '' }))).toBeFalse();
    });
  });

  describe('joinSentences', () => {
    it('drops the leading sentence\'s own stop before adding one', () => {
      expect(joinSentences('This receipt is dated another day.', 'Change date'))
        .toBe('This receipt is dated another day. Change date');
    });

    it('drops a CJK stop too, so ja and tc are not read out with two', () => {
      // The reasons are whole sentences in every catalog, and ja and tc end
      // them with 。 A joiner that only knew the Latin stop left the name as
      // "…ください。. 日付を変更" — two terminators, both spoken.
      expect(joinSentences('別の日を選んでください。', '日付を変更'))
        .toBe('別の日を選んでください. 日付を変更');
    });

    it('takes trailing whitespace with the stop', () => {
      expect(joinSentences('Read off the receipt . ', 'Use KRW')).toBe('Read off the receipt. Use KRW');
    });

    it('adds a stop to a sentence that carries none', () => {
      expect(joinSentences('import.currencyFellBack', 'import.setCurrency'))
        .toBe('import.currencyFellBack. import.setCurrency');
    });

    it('is the trailing half alone when there is no reason to lead with', () => {
      // A row nobody doubts is not announced as suspect.
      expect(joinSentences('', 'Change date')).toBe('Change date');
    });

    it('leaves a lone leading sentence exactly as it is', () => {
      expect(joinSentences('Dated another day.', '')).toBe('Dated another day.');
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

    it('reads a figure the reviewer paused on at the decimal mark', () => {
      // Both conventions, because the editor commits on blur as well as on
      // Enter: a reviewer who types the whole part, stops at the separator
      // and taps the next card would otherwise have the edit refused.
      expect(parseAmountInput('12.')).toBe(12);
      expect(parseAmountInput('12,')).toBe(12);
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

  describe('imageSources', () => {
    const meta = (overrides: Partial<ImagePositionMetadata> = {}): ImagePositionMetadata => ({
      imageIndex: 0,
      imageId: 'image_0',
      positionInImage: 'middle',
      confidenceScore: 0.9,
      ...overrides,
    });

    it('reads mergedFromImages when consolidation left something in it', () => {
      // imageIndex is hardcoded to 0 on a merged row (receipt-attachment.utils
      // .spec.ts pins the same reading on the planner's side); mergedFromImages
      // is the only honest source list once that has happened.
      expect(imageSources(meta({ imageIndex: 0, mergedFromImages: [2, 0, 1] }))).toEqual([2, 0, 1]);
    });

    it('falls back to imageIndex when mergedFromImages is empty or absent', () => {
      expect(imageSources(meta({ imageIndex: 3, mergedFromImages: [] }))).toEqual([3]);
      expect(imageSources(meta({ imageIndex: 3 }))).toEqual([3]);
    });
  });

  describe('sameSplit', () => {
    const row = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      id: 'r1',
      description: 'Coffee',
      amount: 5,
      currency: 'USD',
      date: new Date(2026, 5, 15),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides,
    });

    it('is true from a part to its original', () => {
      expect(sameSplit(row({ id: 'b', splitFrom: 'a' }), row({ id: 'a' }))).toBeTrue();
    });

    it('is true from an original to its part', () => {
      expect(sameSplit(row({ id: 'a' }), row({ id: 'b', splitFrom: 'a' }))).toBeTrue();
    });

    it('is true for two parts split from the same original', () => {
      expect(sameSplit(row({ id: 'b', splitFrom: 'a' }), row({ id: 'c', splitFrom: 'a' }))).toBeTrue();
    });

    it('is false for two rows that share no split', () => {
      expect(sameSplit(row({ id: 'a' }), row({ id: 'b' }))).toBeFalse();
    });
  });

  describe('splitImportRow', () => {
    const row = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      id: 'r1',
      description: 'Groceries',
      amount: 5.4,
      currency: 'USD',
      date: new Date(2026, 5, 15, 9, 0),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides,
    });

    it('splits the amount so the two halves sum to the original, rounded to cents', () => {
      const [kept, part] = splitImportRow(row(), 1.2, 'split_1')!;
      expect(kept.amount).toBe(4.2);
      expect(part.amount).toBe(1.2);
    });

    it('rounds a figure with more than two decimals before splitting, so the two halves still sum to the original', () => {
      const [kept, part] = splitImportRow(row({ amount: 20 }), 10.005, 'split_1')!;
      expect(part.amount).toBe(10.01);
      expect(kept.amount).toBe(9.99);
      expect(kept.amount + part.amount).toBe(20);
    });

    it('rounds a row amount with more than two decimals before splitting, so the two halves still sum to the cent', () => {
      const [kept, part] = splitImportRow(row({ amount: 45.675 }), 20, 'split_1')!;
      expect(part.amount).toBe(20);
      expect(kept.amount).toBe(25.67);
      // Not roundMoney(45.675) (45.68): that figure only rounds up because
      // *100 on the whole amount happens to land exactly on the boundary.
      // kept.amount subtracts taken first and rounds once, the same order
      // the guard now judges by, and reads the same double a cent honester.
      expect(kept.amount + part.amount).toBe(45.67);
    });

    it('gives the part the id it was handed and marks it split from the original, which carries no mark itself', () => {
      const [kept, part] = splitImportRow(row({ id: 'r1' }), 1.2, 'split_1')!;
      expect(part.id).toBe('split_1');
      expect(part.splitFrom).toBe('r1');
      expect(kept.splitFrom).toBeUndefined();
    });

    it('copies imageMetadata onto the part rather than sharing the original\'s object', () => {
      const meta: ImagePositionMetadata = {
        imageIndex: 0, imageId: 'image_0', positionInImage: 'top', confidenceScore: 0.9, receiptId: 1,
      };
      const [, part] = splitImportRow(row({ imageMetadata: meta }), 1.2, 'split_1')!;
      expect(part.imageMetadata).toEqual(meta);
      expect(part.imageMetadata).not.toBe(meta);
    });

    it('drops notes, duplicateOf, recurringId, isRecurring and recurringMatch from the part entirely', () => {
      const [, part] = splitImportRow(row({
        notes: 'lunch',
        duplicateOf: 'txn-9',
        recurringId: 'rule-1',
        isRecurring: true,
        recurringMatch: { id: 'rule-1', name: 'Coffee' },
      }), 1.2, 'split_1')!;

      // Deleted, not set to undefined: a key present-but-undefined still
      // answers 'notes' in part, and the mapper the part eventually reaches
      // spreads on truthiness rather than presence for most of these.
      expect('notes' in part).toBeFalse();
      expect('duplicateOf' in part).toBeFalse();
      expect('recurringId' in part).toBeFalse();
      expect('isRecurring' in part).toBeFalse();
      expect('recurringMatch' in part).toBeFalse();
    });

    it('starts the part unchecked and selected, whatever the original carried', () => {
      const [, part] = splitImportRow(row({ isDuplicate: true, selected: false }), 1.2, 'split_1')!;
      expect(part.isDuplicate).toBeFalse();
      expect(part.selected).toBeTrue();
    });

    it('drops the amount grade from both halves and keeps the date grade on both', () => {
      const [kept, part] = splitImportRow(
        row({ fieldConfidence: { amount: 0.3, date: 0.5 } }), 1.2, 'split_1'
      )!;
      expect(kept.fieldConfidence).toEqual({ date: 0.5 });
      expect(part.fieldConfidence).toEqual({ date: 0.5 });
    });

    it('gives the part its own date object, equal to the original\'s but not shared', () => {
      const original = row();
      const [, part] = splitImportRow(original, 1.2, 'split_1')!;
      expect(part.date.getTime()).toBe(original.date.getTime());
      expect(part.date).not.toBe(original.date);
    });

    it('carries tags and location to the part', () => {
      const [, part] = splitImportRow(
        row({ tags: ['coffee'], location: { name: 'Myeongdong' } }), 1.2, 'split_1'
      )!;
      expect(part.tags).toEqual(['coffee']);
      expect(part.location).toEqual({ name: 'Myeongdong' });
    });

    it('refuses an amount that is not a positive figure smaller than the row', () => {
      expect(splitImportRow(row({ amount: 5.4 }), 0, 'split_1')).toBeNull();
      expect(splitImportRow(row({ amount: 5.4 }), -1, 'split_1')).toBeNull();
      expect(splitImportRow(row({ amount: 5.4 }), NaN, 'split_1')).toBeNull();
      expect(splitImportRow(row({ amount: 5.4 }), 5.4, 'split_1')).withContext('the whole amount leaves nothing behind').toBeNull();
      expect(splitImportRow(row({ amount: 5.4 }), 6, 'split_1')).toBeNull();
      expect(splitImportRow(row({ amount: 5.4 }), 5.399, 'split_1'))
        .withContext('rounds up to the whole amount, leaving a sub-cent remainder behind')
        .toBeNull();
      expect(splitImportRow(row({ amount: 45.675 }), 45.67, 'split_1'))
        .withContext('the row amount itself rounds up to 45.68, but taken leaves only a sub-cent remainder behind')
        .toBeNull();
      expect(splitImportRow(row({ amount: NaN }), 5, 'split_1'))
        .withContext('a row amount that was never a usable figure')
        .toBeNull();
    });

    it('never mutates the row it was given', () => {
      const original = row();
      const snapshot = { ...original };
      splitImportRow(original, 1.2, 'split_1');
      expect(original).toEqual(snapshot);
    });
  });
});
