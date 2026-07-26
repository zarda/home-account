import {
  computeAmountAnomalies,
  computeCategoryDeltas,
  computeTopExpenses,
} from './spending-insight.utils';
import { Transaction } from '../../models';
import { createTransaction } from '../services/testing/test-data';

describe('spending-insight.utils', () => {
  const toBase = (t: Transaction) => t.amount;

  function expense(amount: number, categoryId = 'food', description = `spend ${amount}`): Transaction {
    return createTransaction({ type: 'expense', amount, categoryId, description });
  }

  describe('computeTopExpenses', () => {
    it('sorts by amount descending and caps the list', () => {
      const result = computeTopExpenses([expense(5), expense(50), expense(20)], toBase, 2);
      expect(result.map(e => e.value)).toEqual([50, 20]);
    });

    it('returns an empty list for no expenses', () => {
      expect(computeTopExpenses([], toBase, 3)).toEqual([]);
    });
  });

  describe('computeAmountAnomalies', () => {
    // Baseline 10,10,10,10 -> mean 10, stddev 0, threshold 10.
    const baseline = [expense(10), expense(10), expense(10), expense(10)];

    it('flags current transactions above mean + 2*stddev', () => {
      const outlier = expense(100);
      const result = computeAmountAnomalies([outlier, expense(10)], baseline, toBase, 5);
      expect(result.length).toBe(1);
      expect(result[0].transaction).toBe(outlier);
      expect(result[0].value).toBe(100);
      expect(result[0].typical).toBe(10);
      // Zero-variance baseline: the threshold collapses to the mean.
      expect(result[0].threshold).toBe(10);
    });

    it('skips categories with fewer than 4 baseline samples', () => {
      const outlier = expense(100, 'transport');
      const result = computeAmountAnomalies(
        [outlier],
        [expense(10, 'transport'), expense(10, 'transport'), outlier],
        toBase,
        5
      );
      expect(result).toEqual([]);
    });

    it('sorts by amount descending and caps the list', () => {
      const big = expense(200);
      const bigger = expense(300);
      const result = computeAmountAnomalies([big, bigger], baseline, toBase, 1);
      expect(result.length).toBe(1);
      expect(result[0].transaction).toBe(bigger);
    });

    it('only flags current-period transactions, not baseline rows', () => {
      const historicalOutlier = expense(100);
      const result = computeAmountAnomalies(
        [expense(10)],
        [...baseline, historicalOutlier],
        toBase,
        5
      );
      expect(result).toEqual([]);
    });
  });

  describe('computeCategoryDeltas', () => {
    it('returns empty without a previous-period breakdown', () => {
      expect(computeCategoryDeltas([expense(50)], null, toBase, 5)).toEqual([]);
      expect(computeCategoryDeltas([expense(50)], [], toBase, 5)).toEqual([]);
    });

    it('computes per-category change vs. the previous period', () => {
      const result = computeCategoryDeltas(
        [expense(80, 'food'), expense(20, 'food')],
        [{ categoryId: 'food', total: 40 }],
        toBase,
        5
      );
      expect(result.length).toBe(1);
      expect(result[0]).toEqual(jasmine.objectContaining({
        categoryId: 'food',
        current: 100,
        previous: 40,
        change: 60,
        isNew: false,
      }));
    });

    it('marks categories with no previous spending as new', () => {
      const result = computeCategoryDeltas(
        [expense(30, 'pets')],
        [{ categoryId: 'food', total: 40 }],
        toBase,
        5
      );
      const pets = result.find(d => d.categoryId === 'pets');
      expect(pets?.isNew).toBeTrue();
      expect(pets?.current).toBe(30);
    });

    it('ignores negligible changes and caps by absolute change', () => {
      const result = computeCategoryDeltas(
        [expense(40.001, 'food'), expense(90, 'transport')],
        [{ categoryId: 'food', total: 40 }, { categoryId: 'transport', total: 10 }],
        toBase,
        1
      );
      expect(result.length).toBe(1);
      expect(result[0].categoryId).toBe('transport');
    });
  });
});
