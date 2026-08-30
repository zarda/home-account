import { locationSlot, resolveImportCurrency, resolveImportDate, toCreateTransactionDTO } from './import-dto.utils';
import { parseDateInput } from './transaction-date.utils';

describe('toCreateTransactionDTO', () => {
  const date = new Date(2026, 5, 1);

  it('builds a bare row into exactly the six required keys', () => {
    const dto = toCreateTransactionDTO({ amount: 5, date }, 'USD');

    // The exact key set is the contract: an undefined-valued optional key
    // here would ride through addTransaction's spreads and into Firestore,
    // which rejects undefined.
    expect(Object.keys(dto).sort()).toEqual(
      ['amount', 'categoryId', 'currency', 'date', 'description', 'type'].sort()
    );
    expect(dto.type).toBe('income');
    expect(dto.amount).toBe(5);
    expect(dto.currency).toBe('USD');
    expect(dto.categoryId).toBe('other_expense');
    expect(dto.description).toBe('Imported transaction');
    expect(dto.date).toBe(date);
  });

  it('carries every optional field a row can hold', () => {
    const dto = toCreateTransactionDTO({
      type: 'expense',
      amount: 12.5,
      currency: 'EUR',
      categoryId: 'food',
      description: 'Lunch',
      date,
      note: 'team lunch',
      tags: ['work', 'reimbursable'],
      location: { name: 'Berlin Mitte' },
      isRecurring: true,
      recurringId: 'rec-1',
      period: 'monthly'
    }, 'USD');

    expect(dto).toEqual({
      type: 'expense',
      amount: 12.5,
      currency: 'EUR',
      categoryId: 'food',
      description: 'Lunch',
      date,
      note: 'team lunch',
      tags: ['work', 'reimbursable'],
      location: { name: 'Berlin Mitte' },
      isRecurring: true,
      recurringId: 'rec-1',
      period: 'monthly'
    });
  });

  it('derives the type from the sign when the row has none', () => {
    const dto = toCreateTransactionDTO({ amount: -3, date }, 'USD');

    expect(dto.type).toBe('expense');
    expect(dto.amount).toBe(3);
  });

  it('lets an explicit type override the sign', () => {
    // parseCSV emits absolute amounts with the type resolved separately, so
    // the sign of an already-parsed row says nothing about its direction.
    const dto = toCreateTransactionDTO({ type: 'expense', amount: 7, date }, 'USD');

    expect(dto.type).toBe('expense');
  });

  it('falls back to the base currency on an empty code', () => {
    const dto = toCreateTransactionDTO({ amount: 1, currency: '', date }, 'GBP');

    expect(dto.currency).toBe('GBP');
  });

  it('falls back to the catch-all category on an empty id', () => {
    const dto = toCreateTransactionDTO({ amount: 1, categoryId: '', date }, 'USD');

    expect(dto.categoryId).toBe('other_expense');
  });

  it('lets isRecurring: false travel', () => {
    // false is an answer ("looked, not recurring"); only undefined means
    // nobody looked. The truthy guard the other optionals use would erase it.
    const dto = toCreateTransactionDTO({ amount: 1, date, isRecurring: false }, 'USD');

    expect(dto.isRecurring).toBeFalse();
  });

  it('drops a recurringId the review step cleared', () => {
    // Declining the offered link leaves the key present and undefined on the
    // row. Unlike isRecurring, an id has no "false" to preserve, so the
    // truthy guard is what makes a declined link mean nothing written.
    const dto = toCreateTransactionDTO({ amount: 1, date, recurringId: undefined }, 'USD');

    expect('recurringId' in dto).toBeFalse();
  });

  it('omits an empty tag list rather than writing an empty array', () => {
    const dto = toCreateTransactionDTO({ amount: 1, date, tags: [] }, 'USD');

    expect('tags' in dto).toBeFalse();
  });

  it('omits an empty note', () => {
    const dto = toCreateTransactionDTO({ amount: 1, date, note: '' }, 'USD');

    expect('note' in dto).toBeFalse();
  });
});

describe('resolveImportCurrency', () => {
  it('keeps a currency somebody read, with no flag', () => {
    expect(resolveImportCurrency('JPY', 'USD')).toEqual({ currency: 'JPY' });
  });
  it('substitutes the base currency and says so when nothing was read', () => {
    expect(resolveImportCurrency('', 'USD')).toEqual({ currency: 'USD', currencyFellBack: true });
    expect(resolveImportCurrency(undefined, 'USD')).toEqual({ currency: 'USD', currencyFellBack: true });
  });
});

/**
 * `now` only reaches the function through its default parameter — later
 * callers pass just `raw` and `confidence` — so every case here freezes the
 * clock with `jasmine.clock().mockDate` rather than passing a third
 * argument. Every assertion is an instant or a delegation comparison, never
 * a local calendar part, so this file does not need the `test:dates` TZ
 * sweep (ADR 0050).
 */
describe('resolveImportDate', () => {
  const now = new Date(2026, 7, 20, 9, 30);
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(now);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('keeps a parsed date-only string, delegating to parseDateInput', () => {
    const result = resolveImportDate('2026-08-12');

    expect(+result.date).toBe(+parseDateInput('2026-08-12')!);
    expect(result.dateAssumed).toBeUndefined();
  });

  it("keeps a confident reading's own confidence, unmarked", () => {
    const result = resolveImportDate('2026-08-12', 0.95);

    expect(+result.date).toBe(+parseDateInput('2026-08-12')!);
    expect(result.dateConfidence).toBe(0.95);
    expect(result.dateAssumed).toBeUndefined();
  });

  it('substitutes now, marks the row, and forces confidence 0 on an unreadable string', () => {
    // The reader's own 0.95 does not matter: an unparseable value is worse
    // than an unconfident one, and the forced 0 says so.
    const result = resolveImportDate('31/12/2024', 0.95);

    expect(+result.date).toBe(+now);
    expect(result.dateConfidence).toBe(0);
    expect(result.dateAssumed).toBeTrue();
  });

  it('substitutes now on a well-shaped but impossible date', () => {
    const result = resolveImportDate('2026-02-31');

    expect(+result.date).toBe(+now);
    expect(result.dateConfidence).toBe(0);
    expect(result.dateAssumed).toBeTrue();
  });

  it('substitutes now and marks a parsed date graded below the threshold, keeping its confidence', () => {
    const result = resolveImportDate('2026-08-12', 0.5);

    expect(+result.date).toBe(+now);
    expect(result.dateConfidence).toBe(0.5);
    expect(result.dateAssumed).toBeTrue();
  });

  it('keeps a parsed date when confidence is undefined, unmarked', () => {
    // CSV and JSON rows have no reader to grade them — the same rationale
    // needsVerification uses on the preview card. Absence must never read as
    // zero.
    const result = resolveImportDate('2026-08-12', undefined);

    expect(+result.date).toBe(+parseDateInput('2026-08-12')!);
    expect('dateConfidence' in result).toBeFalse();
    expect(result.dateAssumed).toBeUndefined();
  });

  it('keeps a date read at exactly the verify threshold', () => {
    const result = resolveImportDate('2026-08-12', 0.7);

    expect(+result.date).toBe(+parseDateInput('2026-08-12')!);
    expect(result.dateConfidence).toBe(0.7);
    expect(result.dateAssumed).toBeUndefined();
  });

  it('a graded date beyond tomorrow lands on today, marked implausible', () => {
    const beyondTomorrow = new Date(+now + 2 * DAY_MS);
    const result = resolveImportDate(beyondTomorrow, 0.9);

    expect(+result.date).toBe(+now);
    expect(result.dateConfidence).toBe(0.9);
    expect(result.dateAssumed).toBeTrue();
    expect(result.dateImplausible).toBeTrue();
  });

  it('a graded date older than ten years lands on today, marked implausible', () => {
    const elevenYearsBack = new Date(now.getFullYear() - 11, now.getMonth(), now.getDate());
    const result = resolveImportDate(elevenYearsBack, 0.9);

    expect(+result.date).toBe(+now);
    expect(result.dateConfidence).toBe(0.9);
    expect(result.dateAssumed).toBeTrue();
    expect(result.dateImplausible).toBeTrue();
  });

  it('tomorrow within the grace day is kept', () => {
    const withinGrace = new Date(+now + 20 * 60 * 60 * 1000);
    const result = resolveImportDate(withinGrace, 0.9);

    expect(+result.date).toBe(+withinGrace);
    expect(result.dateConfidence).toBe(0.9);
    expect(result.dateAssumed).toBeUndefined();
    expect(result.dateImplausible).toBeUndefined();
  });

  it('a nine-year-old graded date is kept', () => {
    const nineYearsBack = new Date(now.getFullYear() - 9, now.getMonth(), now.getDate());
    const result = resolveImportDate(nineYearsBack, 0.9);

    expect(+result.date).toBe(+nineYearsBack);
    expect(result.dateConfidence).toBe(0.9);
    expect(result.dateAssumed).toBeUndefined();
    expect(result.dateImplausible).toBeUndefined();
  });

  it('an ungraded absurd date is kept untouched', () => {
    // The window must gate on a grade existing at all: CSV and JSON rows
    // have no reader behind them, so an ungated window would redate every
    // row of a years-old backup to today on re-import.
    const elevenYearsBack = new Date(now.getFullYear() - 11, now.getMonth(), now.getDate());
    const result = resolveImportDate(elevenYearsBack, undefined);

    expect(+result.date).toBe(+elevenYearsBack);
    expect('dateConfidence' in result).toBeFalse();
    expect(result.dateAssumed).toBeUndefined();
    expect(result.dateImplausible).toBeUndefined();
  });

  it("the implausible branch forwards the reader's grade", () => {
    const elevenYearsBack = new Date(now.getFullYear() - 11, now.getMonth(), now.getDate());
    const result = resolveImportDate(elevenYearsBack, 0.4);

    expect(result.dateImplausible).toBeTrue();
    expect(result.dateConfidence).toBe(0.4);
  });
});

describe('toCreateTransactionDTO and the review flags', () => {
  it('never forwards currencyFellBack — it is a review-step mark, not a field', () => {
    const dto = toCreateTransactionDTO(
      { amount: 5, date: new Date(2026, 0, 1), currency: 'USD', currencyFellBack: true } as never,
      'USD'
    );
    expect('currencyFellBack' in dto).toBeFalse();
  });

  it('never forwards receiptCountry — it is a review-step mark, not a field', () => {
    const dto = toCreateTransactionDTO(
      {
        amount: 5,
        date: new Date(2026, 0, 1),
        location: { name: 'Shibuya', country: 'JP' },
        receiptCountry: 'JP'
      } as never,
      'USD'
    );
    expect('receiptCountry' in dto).toBeFalse();
    expect(dto.location).toEqual({ name: 'Shibuya', country: 'JP' });
  });

  it('never forwards dateAssumed — it is a review-step mark, not a field', () => {
    const dto = toCreateTransactionDTO(
      { amount: 5, date: new Date(2026, 0, 1), dateAssumed: true } as never,
      'USD'
    );
    expect('dateAssumed' in dto).toBeFalse();
  });
});

describe('locationSlot', () => {
  it('writes a country-only location when a receipt named a country and printed no address', () => {
    expect(locationSlot(undefined, 'KR')).toEqual({ location: { country: 'KR' } });
  });

  it('keeps the printed address and its country together', () => {
    expect(locationSlot('Myeongdong', 'KR')).toEqual({
      location: { name: 'Myeongdong', country: 'KR' }
    });
  });

  it('writes no location at all when neither a name nor a country was read', () => {
    expect(locationSlot(undefined, undefined)).toEqual({});
  });

  it('never writes an empty location map', () => {
    // The shape a truthy spread waves through and the rules used to accept.
    expect(locationSlot('', '')).toEqual({});
    expect(locationSlot('   ', '   ')).toEqual({});
  });

  it('never writes a blank name', () => {
    // A present-but-empty name is the hole toCreateTransactionDTO's own
    // comment named for as long as the truthy spread owned this decision.
    const slot = locationSlot('   ', 'JP');
    expect(slot.location).toEqual({ country: 'JP' });
    expect('name' in slot.location!).toBeFalse();
  });

  it('trims a name rather than storing the padding', () => {
    expect(locationSlot('  Shibuya  ')).toEqual({ location: { name: 'Shibuya' } });
  });

  it('carries coordinates only alongside something that names the place', () => {
    expect(locationSlot('Shibuya', undefined, { lat: 35.6, lng: 139.7 })).toEqual({
      location: { name: 'Shibuya', lat: 35.6, lng: 139.7 }
    });
    // Coordinates alone are not a location: nothing renders them, and the
    // rules refuse the map they would produce.
    expect(locationSlot(undefined, undefined, { lat: 35.6, lng: 139.7 })).toEqual({});
  });

  it('keeps a zero coordinate, which is a real place and not an absent one', () => {
    const slot = locationSlot(undefined, 'GH', { lat: 0, lng: 0 });
    expect(slot.location).toEqual({ lat: 0, lng: 0, country: 'GH' });
  });
});

describe('toCreateTransactionDTO and the location it writes', () => {
  const date = new Date(2026, 5, 1);

  it('writes a country-only location from the review-step mark', () => {
    const dto = toCreateTransactionDTO({ amount: 9, date, receiptCountry: 'KR' }, 'USD');

    expect(dto.location).toEqual({ country: 'KR' });
  });

  it('prefers the row location country over the review-step mark', () => {
    // The address and its country came from the same answer; the mark is the
    // weaker copy of it, so it must not overwrite what the address carried.
    const dto = toCreateTransactionDTO({
      amount: 9,
      date,
      location: { name: 'Myeongdong', country: 'KR' },
      receiptCountry: 'JP'
    }, 'USD');

    expect(dto.location).toEqual({ name: 'Myeongdong', country: 'KR' });
  });

  it('lends the mark to a location the address named but left countryless', () => {
    const dto = toCreateTransactionDTO({
      amount: 9,
      date,
      location: { name: 'Myeongdong' },
      receiptCountry: 'KR'
    }, 'USD');

    expect(dto.location).toEqual({ name: 'Myeongdong', country: 'KR' });
  });

  it('writes no location when neither the row nor the mark says anything', () => {
    const dto = toCreateTransactionDTO({ amount: 9, date }, 'USD');

    expect('location' in dto).toBeFalse();
  });

  it('never lets the mark itself reach the document', () => {
    // receiptCountry is the one review mark allowed to become a field, and
    // it becomes location.country — never a key of its own.
    const dto = toCreateTransactionDTO({ amount: 9, date, receiptCountry: 'KR' }, 'USD');

    expect('receiptCountry' in dto).toBeFalse();
  });
});
