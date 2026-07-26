import { buildSearchPrompt, parseSearchIntent } from './nl-search.utils';
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
  };

  describe('buildSearchPrompt', () => {
    it('embeds today, the base currency, the catalog and the query', () => {
      const prompt = buildSearchPrompt('coffee last month', context);
      expect(prompt).toContain('Today is 2026-07-24');
      expect(prompt).toContain('base currency is USD');
      expect(prompt).toContain('food_groceries: Food & Drinks / Groceries');
      expect(prompt).toContain('"coffee last month"');
    });

    it('instructs the model to only return JSON with the two shapes', () => {
      const prompt = buildSearchPrompt('x', context);
      expect(prompt).toContain('"kind":"filter"');
      expect(prompt).toContain('"kind":"aggregate"');
      expect(prompt).toContain('Return ONLY one JSON object');
    });
  });

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
});
