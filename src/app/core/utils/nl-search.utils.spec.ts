import { parseSearchIntent } from './nl-search.utils';
import { SearchQueryContext } from '../../models';

describe('nl-search.utils', () => {
  const context: SearchQueryContext = {
    today: '2026-07-24',
    baseCurrency: 'USD',
    categories: [
      { id: 'food', name: 'Food & Drinks', type: 'expense' },
      { id: 'food_groceries', name: 'Food & Drinks / Groceries', type: 'expense' },
      { id: 'employment', name: 'Employment', type: 'income' },
    ],
    goals: [
      { id: 'g1', name: 'Japan trip' },
      { id: 'g2', name: 'Emergency fund' },
    ],
    budgets: [
      {
        id: 'b1',
        name: 'Groceries',
        categoryId: 'food_groceries',
        period: 'monthly',
        anchor: '2026-01-10',
      },
    ],
  };

  describe('parseSearchIntent', () => {
    it('accepts a well-formed filter intent', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: {
          type: 'expense',
          categoryId: 'food',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          minAmount: 50,
          maxAmount: 200,
          currency: 'USD',
          searchQuery: 'starbucks',
        },
      }, context);

      expect(intent.kind).toBe('filter');
      expect(intent.filters).toEqual(jasmine.objectContaining({
        type: 'expense',
        categoryId: 'food',
        minAmount: 50,
        maxAmount: 200,
        currency: 'USD',
        searchQuery: 'starbucks',
      }));
      expect(intent.filters.startDate).toEqual(new Date(2026, 5, 1));
      expect(intent.filters.endDate).toEqual(new Date(2026, 5, 30));
    });

    it('accepts an aggregate intent and clamps the limit', () => {
      const intent = parseSearchIntent(
        { kind: 'aggregate', operation: 'topCategories', filters: {}, limit: 99 },
        context
      );
      expect(intent.kind).toBe('aggregate');
      if (intent.kind === 'aggregate') {
        expect(intent.operation).toBe('topCategories');
        expect(intent.limit).toBe(10);
      }
    });

    it('defaults a missing limit to 3', () => {
      const intent = parseSearchIntent(
        { kind: 'aggregate', operation: 'sum', filters: {} },
        context
      );
      if (intent.kind === 'aggregate') {
        expect(intent.limit).toBe(3);
      }
    });

    it('throws on an unknown kind', () => {
      expect(() => parseSearchIntent({ kind: 'chat', filters: {} }, context)).toThrow();
      expect(() => parseSearchIntent('nonsense', context)).toThrow();
      expect(() => parseSearchIntent(null, context)).toThrow();
    });

    it('throws on an unknown aggregate operation', () => {
      expect(() => parseSearchIntent(
        { kind: 'aggregate', operation: 'median', filters: {} },
        context
      )).toThrow();
    });

    it('drops a category ID that is not in the catalog and keeps the term as keyword', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { categoryId: 'dining_out' },
      }, context);
      expect(intent.filters.categoryId).toBeUndefined();
      expect(intent.filters.searchQuery).toBe('dining_out');
    });

    it('keeps an explicit searchQuery over a dropped category ID', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { categoryId: 'dining_out', searchQuery: 'sushi' },
      }, context);
      expect(intent.filters.categoryId).toBeUndefined();
      expect(intent.filters.searchQuery).toBe('sushi');
    });

    it('drops malformed dates and impossible calendar dates', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { startDate: 'June 1st', endDate: '2026-02-31' },
      }, context);
      expect(intent.filters.startDate).toBeUndefined();
      expect(intent.filters.endDate).toBeUndefined();
    });

    it('swaps a reversed date range', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { startDate: '2026-06-30', endDate: '2026-06-01' },
      }, context);
      expect(intent.filters.startDate).toEqual(new Date(2026, 5, 1));
      expect(intent.filters.endDate).toEqual(new Date(2026, 5, 30));
    });

    it('drops out-of-range years', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { startDate: '1024-01-01', endDate: '3000-01-01' },
      }, context);
      expect(intent.filters.startDate).toBeUndefined();
      expect(intent.filters.endDate).toBeUndefined();
    });

    it('drops negative or non-numeric amounts and swaps a reversed range', () => {
      const dropped = parseSearchIntent({
        kind: 'filter',
        filters: { minAmount: -5, maxAmount: 'lots' },
      }, context);
      expect(dropped.filters.minAmount).toBeUndefined();
      expect(dropped.filters.maxAmount).toBeUndefined();

      const swapped = parseSearchIntent({
        kind: 'filter',
        filters: { minAmount: 200, maxAmount: 50 },
      }, context);
      expect(swapped.filters.minAmount).toBe(50);
      expect(swapped.filters.maxAmount).toBe(200);
    });

    it('drops invalid type and currency values', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { type: 'transfer', currency: 'dollars' },
      }, context);
      expect(intent.filters.type).toBeUndefined();
      expect(intent.filters.currency).toBeUndefined();
    });

    it('trims and caps the search query length', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { searchQuery: `  ${'x'.repeat(300)}  ` },
      }, context);
      expect(intent.filters.searchQuery?.length).toBe(100);
    });
  });

  describe('goal scope', () => {
    it('keeps a goal from the catalog', () => {
      const intent = parseSearchIntent({
        kind: 'aggregate',
        operation: 'sum',
        filters: { goalId: 'g1' },
      }, context);

      expect(intent.filters.goalId).toBe('g1');
    });

    it('drops an unlisted goal into the search query rather than guessing', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { goalId: 'new boat' },
      }, context);

      expect(intent.filters.goalId).toBeUndefined();
      expect(intent.filters.searchQuery).toBe('new boat');
    });

    it('leaves an explicit search query alone when it drops a goal', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { goalId: 'unknown', searchQuery: 'ferry' },
      }, context);

      expect(intent.filters.goalId).toBeUndefined();
      expect(intent.filters.searchQuery).toBe('ferry');
    });
  });

  describe('budget scope', () => {
    it('resolves a budget to its category and current window', () => {
      // Monthly budget anchored on the 10th, asked on 2026-07-24: the live
      // period runs 10 July – 9 August.
      const intent = parseSearchIntent({
        kind: 'aggregate',
        operation: 'sum',
        filters: { budgetId: 'b1' },
      }, context);

      expect(intent.filters.categoryId).toBe('food_groceries');
      expect(intent.filters.startDate).toEqual(new Date(2026, 6, 10));
      expect(intent.filters.endDate?.getMonth()).toBe(7);
      expect(intent.filters.endDate?.getDate()).toBe(9);
    });

    it('never lets budgetId reach the filters — a transaction has no such field', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { budgetId: 'b1' },
      }, context);

      expect('budgetId' in intent.filters).toBeFalse();
    });

    it('keeps the dates the question supplied over the budget window', () => {
      // "against my groceries budget last year" must narrow to last year,
      // not snap back to the current period.
      const intent = parseSearchIntent({
        kind: 'aggregate',
        operation: 'sum',
        filters: { budgetId: 'b1', startDate: '2025-01-01', endDate: '2025-12-31' },
      }, context);

      expect(intent.filters.startDate).toEqual(new Date(2025, 0, 1));
      expect(intent.filters.endDate).toEqual(new Date(2025, 11, 31));
      expect(intent.filters.categoryId).toBe('food_groceries');
    });

    it('keeps a category the model named itself', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { budgetId: 'b1', categoryId: 'food' },
      }, context);

      expect(intent.filters.categoryId).toBe('food');
    });

    it('ignores an unlisted budget entirely', () => {
      const intent = parseSearchIntent({
        kind: 'filter',
        filters: { budgetId: 'nope' },
      }, context);

      expect(intent.filters.categoryId).toBeUndefined();
      expect(intent.filters.startDate).toBeUndefined();
    });
  });
});
