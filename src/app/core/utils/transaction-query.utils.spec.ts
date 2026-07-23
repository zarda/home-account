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
