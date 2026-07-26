import { computeCategoryTrends } from './category-trend.utils';
import { MonthlyCategorySeries } from './transaction-aggregation.utils';

describe('category-trend.utils', () => {
  /** Build a series directly, so the windowing decisions stay the caller's. */
  function seriesOf(
    entries: { categoryId: string; values: number[]; counts?: number[] }[],
    months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  ): MonthlyCategorySeries {
    const windowTotal = entries.reduce(
      (sum, entry) => sum + entry.values.reduce((a, b) => a + b, 0), 0);
    return {
      months,
      totalsByCategory: entries.map(({ categoryId, values }) => ({ categoryId, values })),
      countsByCategory: entries.map(({ categoryId, values, counts }) => ({
        categoryId,
        values: counts ?? values.map(v => (v > 0 ? 1 : 0)),
      })),
      windowTotal,
    };
  }

  describe('gates', () => {
    it('returns nothing below the minimum month count', () => {
      const series = seriesOf([{ categoryId: 'food', values: [10, 20] }], ['2026-01', '2026-02']);
      expect(computeCategoryTrends(series)).toEqual([]);
    });

    it('returns nothing when the window has no spending', () => {
      const series = seriesOf([{ categoryId: 'food', values: [0, 0, 0, 0, 0, 0] }]);
      expect(computeCategoryTrends(series)).toEqual([]);
    });

    it('drops a category below the window-share floor', () => {
      // food is 99% of the window; noise is under 2% and must not surface.
      const series = seriesOf([
        { categoryId: 'food', values: [1000, 1100, 1200, 1300, 1400, 1500] },
        { categoryId: 'noise', values: [1, 2, 3, 4, 5, 6] },
      ]);
      expect(computeCategoryTrends(series).map(t => t.categoryId)).toEqual(['food']);
    });

    it('needs three active months before claiming a direction', () => {
      const series = seriesOf([
        { categoryId: 'sparse', values: [0, 0, 0, 0, 100, 300] },
      ]);
      expect(computeCategoryTrends(series)).toEqual([]);
    });
  });

  describe('direction', () => {
    it('reports a rising category', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [100, 120, 140, 160, 180, 200] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.direction).toBe('rising');
      expect(trend.slopePerMonth).toBe(20);
      expect(trend.activeMonths).toBe(6);
    });

    it('reports a falling category with a negative slope', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [200, 180, 160, 140, 120, 100] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.direction).toBe('falling');
      expect(trend.slopePerMonth).toBe(-20);
    });

    it('omits a flat category, which has no story', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [100, 100, 100, 100, 100, 100] },
      ]);
      expect(computeCategoryTrends(series)).toEqual([]);
    });

    it('treats zero-filled gap months as part of the trend, not as missing points', () => {
      // Active in months 1, 3 and 5 with the gaps zero-filled. Dropping the
      // empty months would leave three descending points of equal weight; the
      // zeros are what make the decline as steep as it really is.
      const series = seriesOf([
        { categoryId: 'food', values: [600, 0, 300, 0, 100, 0] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.direction).toBe('falling');
      expect(trend.activeMonths).toBe(3);
      expect(trend.slopePerMonth).toBeLessThan(0);
    });

    it('will not claim a direction from only two active months', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [600, 0, 0, 0, 0, 100] },
      ]);
      expect(computeCategoryTrends(series)).toEqual([]);
    });

    it('resolves the direction threshold at the boundary', () => {
      // mean 100, slope must reach 8 for relativeSlope 0.08.
      const rising = seriesOf([
        { categoryId: 'food', values: [80, 88, 96, 104, 112, 120] },
      ]);
      const [trend] = computeCategoryTrends(rising);
      expect(trend.relativeSlope).toBe(0.08);
      expect(trend.direction).toBe('rising');

      const below = seriesOf([
        { categoryId: 'food', values: [90, 94, 98, 102, 106, 110] },
      ]);
      expect(computeCategoryTrends(below)).toEqual([]);
    });
  });

  describe('reported numbers', () => {
    it('computes the half-mean change ratio used for the sentence', () => {
      // First half mean 100, second half 140 -> +40%. A step this size is
      // needed to clear the 0.08 relative-slope gate; a +18% step over six
      // months reads as steady, which is the gate doing its job.
      const series = seriesOf([
        { categoryId: 'food', values: [100, 100, 100, 140, 140, 140] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.firstHalfMean).toBe(100);
      expect(trend.secondHalfMean).toBe(140);
      expect(trend.changeRatio).toBe(0.4);
    });

    it('nulls the change ratio rather than dividing by a zero first half', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [0, 0, 0, 100, 200, 300] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.changeRatio).toBeNull();
    });

    it('never returns a value Firestore would reject', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [0, 0, 0, 100, 200, 300] },
      ]);
      for (const trend of computeCategoryTrends(series)) {
        for (const value of [trend.relativeSlope, trend.changeRatio]) {
          expect(value === null || Number.isFinite(value)).toBeTrue();
        }
      }
    });

    it('carries the window share and the transaction count', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [100, 120, 140, 160, 180, 200], counts: [2, 2, 2, 2, 2, 2] },
        { categoryId: 'transport', values: [100, 100, 100, 100, 100, 100] },
      ]);
      const food = computeCategoryTrends(series).find(t => t.categoryId === 'food')!;
      expect(food.transactionCount).toBe(12);
      // food totals 900 of a 1500 window.
      expect(food.windowShare).toBe(0.6);
    });

    it('does not alias the series array it was handed', () => {
      const series = seriesOf([
        { categoryId: 'food', values: [100, 120, 140, 160, 180, 200] },
      ]);
      const [trend] = computeCategoryTrends(series);
      expect(trend.series).toEqual(series.totalsByCategory[0].values);
      expect(trend.series).not.toBe(series.totalsByCategory[0].values);
    });
  });

  describe('ordering and cap', () => {
    it('orders by absolute relative slope and caps the list', () => {
      const series = seriesOf([
        { categoryId: 'gentle', values: [100, 105, 110, 115, 120, 125] },
        { categoryId: 'steep', values: [20, 60, 100, 140, 180, 220] },
        { categoryId: 'dropping', values: [220, 180, 140, 100, 60, 20] },
      ]);
      const trends = computeCategoryTrends(series, { cap: 2 });
      expect(trends.length).toBe(2);
      expect(trends[0].categoryId).not.toBe('gentle');
    });

    it('breaks ties by category id so the order is not incidental', () => {
      const values = [100, 120, 140, 160, 180, 200];
      const series = seriesOf([
        { categoryId: 'zoo', values: [...values] },
        { categoryId: 'art', values: [...values] },
      ]);
      expect(computeCategoryTrends(series).map(t => t.categoryId)).toEqual(['art', 'zoo']);
    });

    it('produces identical output when the category order is reversed', () => {
      const entries = [
        { categoryId: 'food', values: [100, 120, 140, 160, 180, 200] },
        { categoryId: 'transport', values: [200, 180, 160, 140, 120, 100] },
      ];
      const forward = computeCategoryTrends(seriesOf(entries));
      const reversed = computeCategoryTrends(seriesOf([...entries].reverse()));
      expect(reversed).toEqual(forward);
    });
  });
});
