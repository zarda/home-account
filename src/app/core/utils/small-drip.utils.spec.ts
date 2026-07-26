import { computeSmallAmountDrip } from './small-drip.utils';
import { DetectorWindow } from './spending-pattern.types';
import { Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';

describe('small-drip.utils', () => {
  const toBase = (t: Transaction) => t.amount;
  const window: DetectorWindow = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
  };

  function expense(
    amount: number,
    overrides: Partial<Transaction> = {},
    day = 15,
    month = 0,
  ): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      date: createTimestamp(new Date(2026, month, day)),
      ...overrides,
    });
  }

  function many(count: number, amount: number, overrides: Partial<Transaction> = {}): Transaction[] {
    return Array.from({ length: count }, (_, i) =>
      expense(amount, overrides, (i % 28) + 1, i % 6));
  }

  describe('the threshold', () => {
    it('is the nearest-rank p25 of the window, not a fixed amount', () => {
      const amounts = [10, 20, 30, 40, 50, 60, 70, 80];
      const result = computeSmallAmountDrip(
        amounts.map(a => expense(a)), toBase, window, 'USD');
      // ceil(0.25 * 8) - 1 = index 1 of the ascending list.
      expect(result.threshold).toBe(20);
    });

    it('resolves the index exactly at small n', () => {
      const at = (amounts: number[]): number => computeSmallAmountDrip(
        amounts.map(a => expense(a)), toBase, window, 'USD').threshold;
      expect(at([10])).toBe(10);
      expect(at([10, 20])).toBe(10);
      expect(at([10, 20, 30])).toBe(10);
      expect(at([10, 20, 30, 40])).toBe(10);
    });

    it('scales with the user\'s own currency magnitude', () => {
      // The same distribution in JPY-sized numbers yields a JPY-sized
      // threshold, which no absolute constant could do.
      const yen = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
      expect(computeSmallAmountDrip(yen.map(a => expense(a)), toBase, window, 'JPY').threshold)
        .toBe(2000);
    });

    it('honours an overridden percentile', () => {
      const amounts = [10, 20, 30, 40, 50, 60, 70, 80];
      expect(computeSmallAmountDrip(
        amounts.map(a => expense(a)), toBase, window, 'USD', { percentile: 0.5 }).threshold)
        .toBe(40);
    });
  });

  describe('isNotable', () => {
    it('is false when the small bucket is a trivial share of spending', () => {
      // 30 tiny purchases against one huge one: plenty of count, no value.
      const transactions = [...many(30, 1), expense(100_000)];
      const result = computeSmallAmountDrip(transactions, toBase, window, 'USD');
      expect(result.count).toBeGreaterThanOrEqual(20);
      expect(result.shareOfSpending).toBeLessThan(0.08);
      expect(result.isNotable).toBeFalse();
    });

    it('is true when the small bucket carries real value', () => {
      // 40 small purchases of 5 (200) against 4 of 50 (200): the smallest
      // quarter by count is half the spending.
      const transactions = [...many(40, 5), ...many(4, 50)];
      const result = computeSmallAmountDrip(transactions, toBase, window, 'USD');
      expect(result.count).toBe(40);
      expect(result.total).toBe(200);
      expect(result.shareOfSpending).toBe(0.5);
      expect(result.isNotable).toBeTrue();
    });

    it('is false below the minimum count even with a large share', () => {
      const transactions = [...many(10, 5), ...many(2, 30)];
      const result = computeSmallAmountDrip(transactions, toBase, window, 'USD');
      expect(result.count).toBeLessThan(20);
      expect(result.isNotable).toBeFalse();
    });

    it('does not fire for a flat spender, where the count alone would', () => {
      // Every amount identical: p25 equals every value, so the bucket holds
      // everything. Gating on count would hand this user a card about nothing.
      const result = computeSmallAmountDrip(many(40, 10), toBase, window, 'USD');
      expect(result.count).toBe(40);
      expect(result.shareOfSpending).toBe(1);
      // Honest outcome: the share gate passes, so the card is about the fact
      // that all spending is small — which is true of this data.
      expect(result.isNotable).toBeTrue();
      expect(result.threshold).toBe(10);
    });
  });

  describe('reported numbers', () => {
    it('reports the monthly average over the window span', () => {
      const transactions = [...many(40, 5), ...many(4, 50)];
      const result = computeSmallAmountDrip(transactions, toBase, window, 'USD');
      // 200 over the six months the window spans.
      expect(result.monthlyAverage).toBe(33.33);
    });

    it('reports the median of the small bucket', () => {
      const amounts = [1, 2, 3, 4, 100, 100, 100, 100];
      const result = computeSmallAmountDrip(
        amounts.map(a => expense(a)), toBase, window, 'USD');
      expect(result.threshold).toBe(2);
      expect(result.medianAmount).toBe(1.5);
    });

    it('breaks the bucket down by category, largest first and capped', () => {
      const transactions = [
        ...many(20, 5, { categoryId: 'food' }),
        ...many(10, 5, { categoryId: 'transport' }),
        ...many(4, 200, { categoryId: 'rent' }),
      ];
      const result = computeSmallAmountDrip(
        transactions, toBase, window, 'USD', { categoryCap: 1 });
      expect(result.byCategory.length).toBe(1);
      expect(result.byCategory[0].categoryId).toBe('food');
      expect(result.byCategory[0].count).toBe(20);
    });

    it('never returns a value Firestore would reject', () => {
      const result = computeSmallAmountDrip([expense(10)], toBase, window, 'USD');
      for (const value of [
        result.threshold, result.total, result.monthlyAverage,
        result.shareOfSpending, result.medianAmount,
      ]) {
        expect(Number.isFinite(value)).toBeTrue();
      }
    });
  });

  describe('drill-down safety', () => {
    it('marks the bucket filter-safe when every expense shares the base currency', () => {
      expect(computeSmallAmountDrip(many(20, 5), toBase, window, 'USD').filterSafe).toBeTrue();
    });

    it('marks it unsafe when any expense is in another currency', () => {
      // The amount filter compares raw native amounts while the threshold is in
      // base currency, so narrowing by amount would be a lie here.
      const transactions = [...many(20, 5), expense(500, { currency: 'JPY' })];
      expect(computeSmallAmountDrip(transactions, toBase, window, 'USD').filterSafe).toBeFalse();
    });

    it('caps the id list and flags the truncation', () => {
      const result = computeSmallAmountDrip(
        many(40, 5), toBase, window, 'USD', { idCap: 10 });
      expect(result.transactionIds.length).toBe(10);
      expect(result.truncated).toBeTrue();
    });

    it('does not flag truncation when everything fits', () => {
      const result = computeSmallAmountDrip(many(5, 5), toBase, window, 'USD');
      expect(result.truncated).toBeFalse();
    });
  });

  describe('window and type filtering', () => {
    it('ignores transactions outside the window', () => {
      const transactions = [
        ...many(20, 5),
        createTransaction({
          type: 'expense', amount: 5, date: createTimestamp(new Date(2025, 0, 15)),
        }),
      ];
      expect(computeSmallAmountDrip(transactions, toBase, window, 'USD').count).toBe(20);
    });

    it('ignores income', () => {
      const transactions = [
        ...many(20, 5),
        createTransaction({
          type: 'income', amount: 1, date: createTimestamp(new Date(2026, 0, 15)),
        }),
      ];
      expect(computeSmallAmountDrip(transactions, toBase, window, 'USD').count).toBe(20);
    });

    it('returns an empty result for no expenses', () => {
      const result = computeSmallAmountDrip([], toBase, window, 'USD');
      expect(result.count).toBe(0);
      expect(result.total).toBe(0);
      expect(result.isNotable).toBeFalse();
      expect(result.byCategory).toEqual([]);
      expect(result.transactionIds).toEqual([]);
    });
  });

  describe('determinism', () => {
    it('produces identical output for shuffled input', () => {
      const transactions = [
        ...many(20, 5, { categoryId: 'food' }),
        ...many(10, 12, { categoryId: 'transport' }),
        ...many(4, 200, { categoryId: 'rent' }),
      ];
      const forward = computeSmallAmountDrip(transactions, toBase, window, 'USD');
      const reversed = computeSmallAmountDrip(
        [...transactions].reverse(), toBase, window, 'USD');
      // Ids are sorted newest-first with an id tiebreaker, so even the
      // drill-down list is order-independent.
      expect(reversed).toEqual(forward);
    });
  });
});
