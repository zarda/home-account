import { resolveImportCurrency, toCreateTransactionDTO } from './import-dto.utils';

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
});
