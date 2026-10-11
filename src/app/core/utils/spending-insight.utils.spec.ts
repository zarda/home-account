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
    // Baseline 10,10,10,10 -> mean 10, stddev 0, threshold 10, for food and pets.
    const baseline = [
      expense(10), expense(10), expense(10), expense(10),
      expense(10, 'pets'), expense(10, 'pets'), expense(10, 'pets'), expense(10, 'pets'),
    ];

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

    // #488: the sort ends in the row id, so a tie at the cap names the same row
    // on every load. The function lists the candidates in the order its input
    // holds them (grouped by category), so the tie hands the HIGHER id over first.
    describe('a tie in the amount', () => {
      it('ranks equal amounts by row id', () => {
        const hi = { ...expense(100, 'pets'), id: 'row-b' };
        const lo = { ...expense(100, 'food'), id: 'row-a' };
        const result = computeAmountAnomalies([hi, lo], baseline, toBase, 5);
        expect(result.map(a => a.transaction.id)).toEqual(['row-a', 'row-b']);
      });

      it('keeps the lower id when the cap falls between the tied pair', () => {
        const hi = { ...expense(100, 'pets'), id: 'row-b' };
        const lo = { ...expense(100, 'food'), id: 'row-a' };
        const result = computeAmountAnomalies([hi, lo], baseline, toBase, 1);
        expect(result.map(a => a.transaction.id)).toEqual(['row-a']);
      });

      it('still ranks a larger amount ahead of a lower id', () => {
        // Pin: the id only breaks a tie, it never outranks the size.
        const big = { ...expense(300, 'pets'), id: 'row-z' };
        const small = { ...expense(100, 'food'), id: 'row-a' };
        const result = computeAmountAnomalies([small, big], baseline, toBase, 5);
        expect(result.map(a => a.transaction.id)).toEqual(['row-z', 'row-a']);
      });
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

    it('reads isNew from the cent-rounded previous total', () => {
      // Pin: a previous total below half a cent rounds to nothing, so the
      // category counts as new and reports a previous of exactly 0.
      const result = computeCategoryDeltas(
        [expense(50, 'pets')],
        [{ categoryId: 'pets', total: 0.004 }],
        toBase,
        5
      );
      expect(result.length).toBe(1);
      expect(result[0].isNew).toBeTrue();
      expect(result[0].previous).toBe(0);
      expect(result[0].change).toBe(50);
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

    // #488: the sort ends in the category id, so a tie names the same category
    // on every load. The function lists the ids in its own order (this
    // period's rows first, then the ids found only in the previous period),
    // so each tie below hands the HIGHER id over first.
    describe('a tie in the absolute change', () => {
      it('ranks a grower and a category that fell to nothing by id', () => {
        // transport grew by 30 and arrives first; food fell by 30 to nothing.
        const result = computeCategoryDeltas(
          [expense(40, 'transport')],
          [{ categoryId: 'food', total: 30 }, { categoryId: 'transport', total: 10 }],
          toBase,
          5
        );
        expect(result.map(d => d.categoryId)).toEqual(['food', 'transport']);
      });

      it('ranks changes that tie once rounded to the cent by id', () => {
        // food grew 0.1 -> 0.3, a change of 0.19999999999999998; pets is new
        // at exactly 0.2. Over the raw floats pets ranks first.
        const result = computeCategoryDeltas(
          [expense(0.3, 'food'), expense(0.2, 'pets')],
          [{ categoryId: 'food', total: 0.1 }],
          toBase,
          5
        );
        expect(result.map(d => d.categoryId)).toEqual(['food', 'pets']);
        expect(result.map(d => d.change)).toEqual([0.2, 0.2]);
      });

      it('keeps the lower id when the cap falls between the tied pair', () => {
        const result = computeCategoryDeltas(
          [expense(30, 'transport'), expense(30, 'food')],
          [{ categoryId: 'utilities', total: 5 }],
          toBase,
          1
        );
        expect(result.map(d => d.categoryId)).toEqual(['food']);
      });

      it('still ranks a larger change ahead of a lower id', () => {
        // Pin: the id only breaks a tie, it never outranks the size.
        const result = computeCategoryDeltas(
          [expense(50, 'transport'), expense(30, 'food')],
          [{ categoryId: 'utilities', total: 5 }],
          toBase,
          5
        );
        expect(result.map(d => d.categoryId)).toEqual(['transport', 'food', 'utilities']);
      });
    });

    it('rounds the totals and the change to the cent', () => {
      const result = computeCategoryDeltas(
        [expense(0.1, 'food'), expense(0.2, 'food')],
        [{ categoryId: 'food', total: 0.1 }],
        toBase,
        5
      );
      expect(result.length).toBe(1);
      expect(result[0].current).toBe(0.3);
      expect(result[0].previous).toBe(0.1);
      expect(result[0].change).toBe(0.2);
    });
  });
});
