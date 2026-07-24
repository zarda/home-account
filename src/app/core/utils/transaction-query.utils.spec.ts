import { applyClientTransactionFilters } from './transaction-query.utils';
import { createTransaction } from '../services/testing/test-data';

describe('applyClientTransactionFilters', () => {
  describe('searchQuery over intrinsic fields', () => {
    const transactions = [
      createTransaction({ id: 't1', description: 'Lunch at restaurant' }),
      createTransaction({ id: 't2', description: 'Groceries', note: 'weekly shopping run' }),
      createTransaction({ id: 't3', description: 'Gym', tags: ['health', 'membership'] }),
      createTransaction({ id: 't4', description: 'Taxi ride' })
    ];

    it('matches description case-insensitively', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'LUNCH' });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('matches note', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'shopping' });
      expect(result.map(t => t.id)).toEqual(['t2']);
    });

    it('matches tags', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'membership' });
      expect(result.map(t => t.id)).toEqual(['t3']);
    });

    it('returns everything when no filters are given', () => {
      expect(applyClientTransactionFilters(transactions)).toEqual(transactions);
    });

    it('returns no rows when nothing matches', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'zzz-no-match' });
      expect(result).toEqual([]);
    });
  });

  describe('searchQuery over location names', () => {
    const transactions = [
      createTransaction({
        id: 't1',
        description: 'Morning espresso',
        location: { name: 'Blue Bottle Aoyama' }
      }),
      createTransaction({ id: 't2', description: 'Espresso beans' })
    ];

    it('matches location.name case-insensitively', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'aoyama' });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });
  });

  describe('searchQuery over resolved category names', () => {
    const transactions = [
      createTransaction({ id: 't1', description: 'Morning espresso', categoryId: 'cat-coffee' }),
      createTransaction({ id: 't2', description: 'Bus ticket', categoryId: 'cat-transport' })
    ];
    const categoryNames = new Map([
      ['cat-coffee', 'Coffee & Tea'],
      ['cat-transport', 'Transportation']
    ]);

    it('matches the translated category display name via context', () => {
      const result = applyClientTransactionFilters(
        transactions,
        { searchQuery: 'coffee' },
        { categoryNames }
      );
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('does not match category names without context', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'coffee' });
      expect(result).toEqual([]);
    });

    it('ignores context entries for other categories', () => {
      const result = applyClientTransactionFilters(
        transactions,
        { searchQuery: 'transportation' },
        { categoryNames }
      );
      expect(result.map(t => t.id)).toEqual(['t2']);
    });
  });

  describe('searchQuery fuzzy fallback', () => {
    const transactions = [
      createTransaction({ id: 't1', description: 'Coffee at Starbucks' }),
      createTransaction({ id: 't2', description: 'Toffee crisps' }),
      createTransaction({ id: 't3', description: 'Dinner' })
    ];

    it('surfaces typo matches when the exact pass finds nothing', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'Starbcks' });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('never runs when any exact match exists', () => {
      // "toffee" is within one edit of "coffee", but the exact hit wins alone.
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'coffee' });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('does not run for queries under 3 characters', () => {
      const result = applyClientTransactionFilters(transactions, { searchQuery: 'gm' });
      expect(result).toEqual([]);
    });

    it('reaches location and category names', () => {
      const rows = [
        createTransaction({
          id: 't1',
          description: 'Fruit',
          location: { name: 'Aoyama Market' }
        }),
        createTransaction({ id: 't2', description: 'Espresso', categoryId: 'cat-coffee' })
      ];
      const categoryNames = new Map([['cat-coffee', 'Coffee & Tea']]);

      expect(
        applyClientTransactionFilters(rows, { searchQuery: 'Aoyma' }).map(t => t.id)
      ).toEqual(['t1']);
      expect(
        applyClientTransactionFilters(rows, { searchQuery: 'cofee' }, { categoryNames }).map(
          t => t.id
        )
      ).toEqual(['t2']);
    });

    it('matches multi-token typo queries across different fields of one row', () => {
      const rows = [
        createTransaction({
          id: 't1',
          description: 'Coffee at Starbucks',
          tags: ['health'],
          location: { name: 'Aoyama Market' }
        }),
        createTransaction({ id: 't2', description: 'Coffee at Starbucks' })
      ];
      // "starbcks" lands on the description, "helth" only on t1's tag.
      const result = applyClientTransactionFilters(rows, { searchQuery: 'starbcks helth' });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('keeps the amount filters applied to fuzzy results', () => {
      const rows = [
        createTransaction({ id: 't1', amount: 10, description: 'Starbucks small' }),
        createTransaction({ id: 't2', amount: 500, description: 'Starbucks machine' })
      ];
      const result = applyClientTransactionFilters(rows, {
        searchQuery: 'starbcks',
        maxAmount: 100
      });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });
  });

  describe('amount filters', () => {
    const transactions = [
      createTransaction({ id: 't1', amount: 10 }),
      createTransaction({ id: 't2', amount: 50 }),
      createTransaction({ id: 't3', amount: 200 })
    ];

    it('applies minAmount inclusively', () => {
      const result = applyClientTransactionFilters(transactions, { minAmount: 50 });
      expect(result.map(t => t.id)).toEqual(['t2', 't3']);
    });

    it('applies maxAmount inclusively', () => {
      const result = applyClientTransactionFilters(transactions, { maxAmount: 50 });
      expect(result.map(t => t.id)).toEqual(['t1', 't2']);
    });

    it('combines amount range with searchQuery', () => {
      const result = applyClientTransactionFilters(
        [
          createTransaction({ id: 't1', amount: 10, description: 'Coffee small' }),
          createTransaction({ id: 't2', amount: 500, description: 'Coffee machine' })
        ],
        { searchQuery: 'coffee', maxAmount: 100 }
      );
      expect(result.map(t => t.id)).toEqual(['t1']);
    });
  });
});
