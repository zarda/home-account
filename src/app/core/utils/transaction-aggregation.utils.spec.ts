import {
  bucketByMonth,
  bucketByMonthAndCategory,
  finiteOrNull,
  fnv1a32,
  groupByCategoryAndType,
  groupExpensesByCategory,
  groupExpensesByCategoryWithCounts,
  groupExpensesByCountry,
  median,
  percentDelta,
  percentileNearestRank,
  roundMoney,
  roundRatio,
  sumByType,
} from './transaction-aggregation.utils';
import { Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';

describe('transaction-aggregation.utils', () => {
  const toBase = (t: Transaction) => t.amount;

  function expense(amount: number, categoryId = 'food', date?: Date): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      categoryId,
      ...(date ? { date: createTimestamp(date) } : {}),
    });
  }

  function income(amount: number, categoryId = 'employment_salary', date?: Date): Transaction {
    return createTransaction({
      type: 'income',
      amount,
      categoryId,
      ...(date ? { date: createTimestamp(date) } : {}),
    });
  }

  describe('roundMoney / roundRatio', () => {
    it('rounds money to cents', () => {
      expect(roundMoney(10.004)).toBe(10);
      expect(roundMoney(10.006)).toBe(10.01);
      expect(roundMoney(1 / 3)).toBe(0.33);
    });

    it('rounds ratios to four digits by default', () => {
      expect(roundRatio(1 / 3)).toBe(0.3333);
      expect(roundRatio(1 / 3, 2)).toBe(0.33);
    });

    it('is idempotent, so a regenerated value is byte-identical', () => {
      const once = roundMoney(1 / 7);
      expect(roundMoney(once)).toBe(once);
    });
  });

  describe('finiteOrNull', () => {
    it('nulls the values Firestore refuses to store', () => {
      expect(finiteOrNull(0 / 0)).toBeNull();
      expect(finiteOrNull(1 / 0)).toBeNull();
      expect(finiteOrNull(-1 / 0)).toBeNull();
    });

    it('passes finite values through, including zero', () => {
      expect(finiteOrNull(0)).toBe(0);
      expect(finiteOrNull(-4.5)).toBe(-4.5);
    });
  });

  describe('sumByType', () => {
    it('totals each type and derives the balance', () => {
      expect(sumByType([income(1000), expense(250), expense(150)], toBase)).toEqual({
        income: 1000,
        expense: 400,
        balance: 600,
        count: 3,
      });
    });

    it('returns zeros for an empty list', () => {
      expect(sumByType([], toBase)).toEqual({
        income: 0, expense: 0, balance: 0, count: 0,
      });
    });

    it('counts both types, not just expenses', () => {
      expect(sumByType([income(10), expense(10)], toBase).count).toBe(2);
    });
  });

  describe('groupExpensesByCategory', () => {
    it('sums per category, largest first', () => {
      const result = groupExpensesByCategory(
        [expense(30, 'food'), expense(80, 'transport'), expense(20, 'food')], toBase);
      expect(result).toEqual([
        { categoryId: 'transport', total: 80 },
        { categoryId: 'food', total: 50 },
      ]);
    });

    it('excludes income', () => {
      const result = groupExpensesByCategory([income(500), expense(20, 'food')], toBase);
      expect(result).toEqual([{ categoryId: 'food', total: 20 }]);
    });

    it('breaks ties by category id so the order is total, not incidental', () => {
      const result = groupExpensesByCategory(
        [expense(10, 'zoo'), expense(10, 'art'), expense(10, 'music')], toBase);
      expect(result.map(c => c.categoryId)).toEqual(['art', 'music', 'zoo']);
    });

    it('returns an empty list when there are no expenses', () => {
      expect(groupExpensesByCategory([income(10)], toBase)).toEqual([]);
    });
  });

  describe('groupExpensesByCategoryWithCounts', () => {
    it('carries the transaction count behind each total', () => {
      const result = groupExpensesByCategoryWithCounts(
        [expense(30, 'food'), expense(20, 'food'), expense(80, 'transport')], toBase);
      expect(result).toEqual([
        { categoryId: 'transport', total: 80, count: 1 },
        { categoryId: 'food', total: 50, count: 2 },
      ]);
    });
  });

  describe('groupByCategoryAndType', () => {
    it('returns both sides of the ledger, not expenses alone', () => {
      const result = groupByCategoryAndType(
        [expense(30, 'food'), income(500, 'employment_salary')], toBase);

      expect(result).toEqual([
        { categoryId: 'food', type: 'expense', total: 30, count: 1 },
        { categoryId: 'employment_salary', type: 'income', total: 500, count: 1 },
      ]);
    });

    it('yields two rows for a category used on both sides rather than netting them', () => {
      const result = groupByCategoryAndType(
        [expense(80, 'other'), income(80, 'other')], toBase);

      // Netted, an equal month would read as no activity at all.
      expect(result).toEqual([
        { categoryId: 'other', type: 'expense', total: 80, count: 1 },
        { categoryId: 'other', type: 'income', total: 80, count: 1 },
      ]);
    });

    it('sums the rows behind each category and type', () => {
      const result = groupByCategoryAndType([
        expense(30, 'food'), expense(20, 'food'), income(100, 'gifts'), income(50, 'gifts'),
      ], toBase);

      expect(result).toEqual([
        { categoryId: 'food', type: 'expense', total: 50, count: 2 },
        { categoryId: 'gifts', type: 'income', total: 150, count: 2 },
      ]);
    });

    it('blocks expenses first, then income, each side largest-first', () => {
      // The largest row overall is income: side wins over magnitude, or the
      // two tables the summary export builds would interleave.
      const result = groupByCategoryAndType([
        expense(10, 'zoo'), income(5, 'busking'), expense(30, 'music'),
        income(900, 'salary'),
      ], toBase);

      expect(result.map(r => [r.type, r.categoryId])).toEqual([
        ['expense', 'music'], ['expense', 'zoo'],
        ['income', 'salary'], ['income', 'busking'],
      ]);
    });

    it('breaks ties by category id on each side independently', () => {
      const result = groupByCategoryAndType([
        expense(10, 'zoo'), expense(10, 'art'), income(7, 'yield'), income(7, 'bonus'),
      ], toBase);

      expect(result.map(r => r.categoryId)).toEqual(['art', 'zoo', 'bonus', 'yield']);
    });

    it('rounds each total to cents', () => {
      const result = groupByCategoryAndType(
        [expense(0.1, 'food'), expense(0.2, 'food')], toBase);

      expect(result[0].total).toBe(0.3);
    });

    it('returns an empty list for no transactions', () => {
      expect(groupByCategoryAndType([], toBase)).toEqual([]);
    });
  });

  describe('bucketByMonth', () => {
    const months = ['2026-01', '2026-02', '2026-03'];

    it('places transactions in their own month', () => {
      const result = bucketByMonth([
        expense(10, 'food', new Date(2026, 0, 5)),
        expense(20, 'food', new Date(2026, 2, 28)),
      ], toBase, months);
      expect(result.totals).toEqual([10, 0, 20]);
      expect(result.counts).toEqual([1, 0, 1]);
    });

    it('zero-fills a month with no activity rather than dropping it', () => {
      const result = bucketByMonth(
        [expense(10, 'food', new Date(2026, 0, 5))], toBase, months);
      expect(result.totals.length).toBe(3);
      expect(result.totals).toEqual([10, 0, 0]);
    });

    it('ignores transactions outside the month list', () => {
      const result = bucketByMonth(
        [expense(999, 'food', new Date(2025, 11, 31))], toBase, months);
      expect(result.totals).toEqual([0, 0, 0]);
    });

    it('does not alias the caller\'s month array', () => {
      const result = bucketByMonth([], toBase, months);
      expect(result.months).toEqual(months);
      expect(result.months).not.toBe(months);
    });
  });

  describe('bucketByMonthAndCategory', () => {
    const months = ['2026-01', '2026-02'];

    it('builds a parallel series per category', () => {
      const result = bucketByMonthAndCategory([
        expense(10, 'food', new Date(2026, 0, 5)),
        expense(40, 'food', new Date(2026, 1, 5)),
        expense(25, 'transport', new Date(2026, 1, 6)),
      ], toBase, months);

      expect(result.totalsByCategory).toEqual([
        { categoryId: 'food', values: [10, 40] },
        { categoryId: 'transport', values: [0, 25] },
      ]);
      expect(result.countsByCategory).toEqual([
        { categoryId: 'food', values: [1, 1] },
        { categoryId: 'transport', values: [0, 1] },
      ]);
      expect(result.windowTotal).toBe(75);
    });

    it('sorts categories by id so two runs produce identical arrays', () => {
      const result = bucketByMonthAndCategory([
        expense(10, 'zoo', new Date(2026, 0, 5)),
        expense(10, 'art', new Date(2026, 0, 5)),
      ], toBase, months);
      expect(result.totalsByCategory.map(c => c.categoryId)).toEqual(['art', 'zoo']);
    });

    it('uses flat per-category arrays, never a nested array', () => {
      const result = bucketByMonthAndCategory(
        [expense(10, 'food', new Date(2026, 0, 5))], toBase, months);
      // Firestore forbids nested arrays, and this shape is persisted verbatim.
      for (const series of result.totalsByCategory) {
        expect(series.values.every(v => typeof v === 'number')).toBeTrue();
      }
    });

    it('is empty but well-formed with no transactions', () => {
      const result = bucketByMonthAndCategory([], toBase, months);
      expect(result.totalsByCategory).toEqual([]);
      expect(result.windowTotal).toBe(0);
      expect(result.months).toEqual(months);
    });
  });

  describe('percentDelta', () => {
    it('computes a fractional change', () => {
      expect(percentDelta(118, 100)).toBe(0.18);
      expect(percentDelta(82, 100)).toBe(-0.18);
    });

    it('returns null rather than Infinity when there is no base', () => {
      expect(percentDelta(50, 0)).toBeNull();
      expect(percentDelta(50, -10)).toBeNull();
    });

    it('never returns a value Firestore would reject', () => {
      for (const [current, previous] of [[0, 0], [1, 0], [-1, 0]]) {
        const delta = percentDelta(current, previous);
        expect(delta === null || Number.isFinite(delta)).toBeTrue();
      }
    });
  });

  describe('median', () => {
    it('takes the middle of an odd-length list', () => {
      expect(median([5, 1, 3])).toBe(3);
    });

    it('averages the two middles of an even-length list', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('returns zero for an empty list', () => {
      expect(median([])).toBe(0);
    });

    it('does not mutate the input', () => {
      const values = [3, 1, 2];
      median(values);
      expect(values).toEqual([3, 1, 2]);
    });
  });

  describe('percentileNearestRank', () => {
    // ceil(p * n) - 1, floored at 0. Asserted at small n because the drip
    // detector's threshold is only defensible if this index is exact.
    it('resolves p25 to an exact index', () => {
      expect(percentileNearestRank([10], 0.25)).toBe(10);
      expect(percentileNearestRank([10, 20], 0.25)).toBe(10);
      expect(percentileNearestRank([10, 20, 30], 0.25)).toBe(10);
      expect(percentileNearestRank([10, 20, 30, 40], 0.25)).toBe(10);
      expect(percentileNearestRank([10, 20, 30, 40, 50, 60, 70, 80], 0.25)).toBe(20);
    });

    it('sorts the input first', () => {
      expect(percentileNearestRank([80, 20, 40, 10, 70, 30, 60, 50], 0.25)).toBe(20);
    });

    it('clamps p = 1 to the largest value and p = 0 to the smallest', () => {
      expect(percentileNearestRank([10, 20, 30], 1)).toBe(30);
      expect(percentileNearestRank([10, 20, 30], 0)).toBe(10);
    });

    it('returns zero for an empty list', () => {
      expect(percentileNearestRank([], 0.25)).toBe(0);
    });
  });

  describe('fnv1a32', () => {
    it('is stable for the same input', () => {
      expect(fnv1a32('a:1;b:2')).toBe(fnv1a32('a:1;b:2'));
    });

    it('changes when the input changes', () => {
      expect(fnv1a32('a:1;b:2')).not.toBe(fnv1a32('a:1;b:3'));
    });

    it('always returns 8 lowercase hex characters', () => {
      for (const input of ['', 'a', 'ネットフリックス', 'x'.repeat(500)]) {
        expect(fnv1a32(input)).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    it('distinguishes reorderings', () => {
      expect(fnv1a32('ab')).not.toBe(fnv1a32('ba'));
    });
  });
});

describe('groupExpensesByCountry', () => {
  const toBase = (t: Transaction) => t.amount;
  const expense = (amount: number, country?: string, extra: Partial<Transaction> = {}) =>
    createTransaction({
      type: 'expense',
      amount,
      ...(country ? { location: { country } } : {}),
      ...extra,
    });

  it('groups expenses by the country their location records', () => {
    const result = groupExpensesByCountry(
      [expense(10, 'KR'), expense(5, 'JP'), expense(7, 'KR')],
      toBase
    );

    expect(result.countries).toEqual([
      { country: 'KR', total: 17, count: 2 },
      { country: 'JP', total: 5, count: 1 },
    ]);
  });

  it('orders by total, tie-broken by country code', () => {
    const result = groupExpensesByCountry(
      [expense(10, 'KR'), expense(10, 'JP'), expense(10, 'DE')],
      toBase
    );

    expect(result.countries.map(c => c.country)).toEqual(['DE', 'JP', 'KR']);
  });

  it('excludes rows with no country and reports the coverage', () => {
    const result = groupExpensesByCountry(
      [expense(10, 'KR'), expense(5), expense(3), expense(2, 'JP')],
      toBase
    );

    expect(result.countries.map(c => c.country)).toEqual(['KR', 'JP']);
    expect(result.placed).toBe(2);
    expect(result.expenses).toBe(4);
  });

  it('treats a blank country as no country', () => {
    const result = groupExpensesByCountry([expense(10, '  ')], toBase);

    expect(result.countries).toEqual([]);
    expect(result.placed).toBe(0);
    expect(result.expenses).toBe(1);
  });

  it('counts a location that names a place but no country as unplaced', () => {
    const rows = [
      createTransaction({ type: 'expense', amount: 9, location: { name: 'Aoyama Market' } }),
    ];
    const result = groupExpensesByCountry(rows, toBase);

    expect(result.countries).toEqual([]);
    expect(result.placed).toBe(0);
    expect(result.expenses).toBe(1);
  });

  it('ignores income', () => {
    const income = createTransaction({ type: 'income', amount: 500, location: { country: 'KR' } });
    const result = groupExpensesByCountry([income, expense(10, 'KR')], toBase);

    expect(result.countries).toEqual([{ country: 'KR', total: 10, count: 1 }]);
    expect(result.expenses).toBe(1);
  });

  it('rounds each total at the boundary', () => {
    const result = groupExpensesByCountry(
      [expense(0.1, 'KR'), expense(0.2, 'KR')],
      toBase
    );

    expect(result.countries[0].total).toBe(0.3);
  });

  it('produces identical output for shuffled input', () => {
    const rows = [
      expense(10, 'KR'), expense(10, 'JP'), expense(5, 'DE'),
      expense(7), expense(10, 'DE'), expense(3, 'JP'),
    ];
    const forward = groupExpensesByCountry(rows, toBase);
    const reversed = groupExpensesByCountry([...rows].reverse(), toBase);
    const rotated = groupExpensesByCountry([...rows.slice(3), ...rows.slice(0, 3)], toBase);

    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it('answers for an empty period without dividing by anything', () => {
    expect(groupExpensesByCountry([], toBase)).toEqual({
      countries: [], placed: 0, expenses: 0,
    });
  });
});
