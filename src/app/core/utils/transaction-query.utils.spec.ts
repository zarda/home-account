import { applyClientTransactionFilters, buildTransactionWhere } from './transaction-query.utils';
import { createTransaction } from '../services/testing/test-data';

describe('buildTransactionWhere', () => {
  it('is undefined when there is nothing to constrain', () => {
    expect(buildTransactionWhere()).toBeUndefined();
    expect(buildTransactionWhere({})).toBeUndefined();
  });

  it('sends a goal filter to the server as an equality', () => {
    // Server-side, not client-side: the windowed pager filters client-only
    // fields per fetched page, which would leave sparse pages and cost the
    // header its exact count.
    expect(buildTransactionWhere({ goalId: 'g1' })).toEqual([
      { field: 'goalId', op: '==', value: 'g1' }
    ]);
  });

  it('composes a goal filter with the other server-side fields', () => {
    const conditions = buildTransactionWhere({
      goalId: 'g1',
      type: 'expense',
      categoryId: 'food',
      currency: 'USD'
    });

    expect(conditions).toContain({ field: 'goalId', op: '==', value: 'g1' });
    expect(conditions?.length).toBe(4);
  });

  it('constrains the query by country server-side, reading inside the location map', () => {
    // Dot notation, and server-side for the same reason as goalId: country is
    // the sparsest filter the app has, so a client-side pass over each fetched
    // page would render near-empty pages.
    expect(buildTransactionWhere({ country: 'KR' })).toEqual([
      { field: 'location.country', op: '==', value: 'KR' }
    ]);
  });

  it('composes country with every other server-side field', () => {
    const conditions = buildTransactionWhere({
      goalId: 'g1',
      type: 'expense',
      categoryId: 'food',
      currency: 'USD',
      country: 'KR'
    });

    expect(conditions).toContain({ field: 'location.country', op: '==', value: 'KR' });
    // Five equality fields is what check-firestore-indexes.mjs computes the
    // required index set from; the count is the contract it greps for.
    expect(conditions?.length).toBe(5);
  });

  it('leaves country out of the client-side pass', () => {
    const rows = [
      createTransaction({ id: 'a', location: { country: 'KR' } }),
      createTransaction({ id: 'b', location: { country: 'JP' } }),
    ];

    // The server already narrowed; re-filtering here would be a second,
    // page-local pass that the pager's counts do not expect.
    expect(applyClientTransactionFilters(rows, { country: 'KR' }).length).toBe(2);
  });

  it('leaves client-only fields out of the query', () => {
    // Amount bounds, tags and search are applied after fetch; sending them
    // here would demand composite indexes that do not exist.
    expect(buildTransactionWhere({
      minAmount: 10,
      maxAmount: 20,
      tags: ['coffee'],
      searchQuery: 'latte'
    })).toBeUndefined();
  });
});

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

  describe('tags filter', () => {
    const transactions = [
      createTransaction({ id: 't1', description: 'Flight', tags: ['travel', 'reimbursable'] }),
      createTransaction({ id: 't2', description: 'Hotel', tags: ['travel'] }),
      createTransaction({ id: 't3', description: 'Lunch', tags: ['reimbursable'] }),
      createTransaction({ id: 't4', description: 'Gym' })
    ];

    it('narrows to rows carrying the tag', () => {
      const result = applyClientTransactionFilters(transactions, { tags: ['travel'] });
      expect(result.map(t => t.id)).toEqual(['t1', 't2']);
    });

    it('requires every selected tag', () => {
      // Filter chips narrow: two chips mean both, not either.
      const result = applyClientTransactionFilters(transactions, {
        tags: ['travel', 'reimbursable']
      });
      expect(result.map(t => t.id)).toEqual(['t1']);
    });

    it('never matches an untagged row', () => {
      const result = applyClientTransactionFilters(transactions, { tags: ['gym'] });
      expect(result).toEqual([]);
    });

    it('is a no-op for an empty tag list', () => {
      expect(applyClientTransactionFilters(transactions, { tags: [] })).toEqual(transactions);
    });

    it('composes with the amount range and the search query', () => {
      const rows = [
        createTransaction({ id: 'a', description: 'Team lunch', amount: 40, tags: ['work'] }),
        createTransaction({ id: 'b', description: 'Team lunch', amount: 8, tags: ['work'] }),
        createTransaction({ id: 'c', description: 'Team lunch', amount: 40, tags: ['family'] }),
        createTransaction({ id: 'd', description: 'Groceries', amount: 40, tags: ['work'] })
      ];
      const result = applyClientTransactionFilters(rows, {
        tags: ['work'],
        minAmount: 10,
        searchQuery: 'lunch'
      });
      expect(result.map(t => t.id)).toEqual(['a']);
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

    it('ignores null bounds, which a cleared number input produces', () => {
      // `amount <= null` coerces to `<= 0` and would hide every row; a
      // cleared box must behave like an absent filter on both bounds.
      const result = applyClientTransactionFilters(transactions, {
        minAmount: null as unknown as number,
        maxAmount: null as unknown as number,
      });
      expect(result).toEqual(transactions);
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
