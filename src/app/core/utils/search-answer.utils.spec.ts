import { Timestamp } from '@angular/fire/firestore';
import {
  AggregateAnswer,
  SEARCH_ANSWER_SCHEMA_VERSION,
  SearchAnswerRecord,
  SerializableSearchScope,
  TransactionFilters,
} from '../../models';
import { createTransaction } from '../services/testing/test-data';
import {
  buildAnswerFields,
  buildFilterFields,
  deserializeScope,
  recordToAnswer,
  recordToFilters,
  recordToIntent,
  searchRecordDedupeKey,
  serializeScope,
} from './search-answer.utils';

// Runs in test:dates under both CI timezones (America/New_York and
// Asia/Tokyo): the day-key round trip is exactly the place a UTC-midnight
// parse would shift a stored scope by one day west of UTC.
describe('search-answer.utils', () => {
  const august = (): TransactionFilters => ({
    startDate: new Date(2026, 7, 1),
    endDate: new Date(2026, 7, 31, 23, 59, 59, 999),
  });

  const record = (overrides: Partial<SearchAnswerRecord> = {}): SearchAnswerRecord => ({
    id: 'rec-1',
    userId: 'user123',
    schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
    kind: 'aggregate',
    query: 'how much on food in august',
    operation: 'sum',
    limit: 3,
    scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
    baseCurrency: 'USD',
    value: 421.5,
    currency: 'USD',
    transactionCount: 17,
    computedAt: Timestamp.fromMillis(1_800_000_000_000),
    lastUsedAt: Timestamp.fromMillis(1_800_000_000_000),
    ...overrides,
  });

  describe('serializeScope', () => {
    it('writes dates as local-part day keys', () => {
      const scope = serializeScope(august());
      expect(scope.startDate).toBe('2026-08-01');
      expect(scope.endDate).toBe('2026-08-31');
    });

    it('omits absent fields entirely rather than writing undefined', () => {
      const scope = serializeScope(august());
      expect(Object.keys(scope).sort()).toEqual(['endDate', 'startDate']);
    });

    it('carries every non-date filter an aggregate scope can hold', () => {
      const scope = serializeScope({
        ...august(),
        type: 'expense',
        categoryId: 'cat-food',
        minAmount: 10,
        maxAmount: 500,
        currency: 'JPY',
        searchQuery: 'coffee',
      });
      expect(scope).toEqual(jasmine.objectContaining({
        type: 'expense',
        categoryId: 'cat-food',
        minAmount: 10,
        maxAmount: 500,
        currency: 'JPY',
        searchQuery: 'coffee',
      }));
    });

    it('drops tags: the stored scope has no such field', () => {
      const scope = serializeScope({ ...august(), tags: ['travel'] });
      expect('tags' in scope).toBeFalse();
    });

    it('carries a goal scope, so a goal-worded answer replays as asked', () => {
      const scope = serializeScope({ ...august(), goalId: 'g1' });
      expect(scope.goalId).toBe('g1');
    });
  });

  describe('deserializeScope', () => {
    it('revives day keys as local midnight, not UTC midnight', () => {
      const filters = deserializeScope({ startDate: '2026-08-01', endDate: '2026-08-31' });
      expect(filters.startDate).toEqual(new Date(2026, 7, 1));
      expect(filters.endDate).toEqual(new Date(2026, 7, 31));
    });

    it('keeps absent fields absent', () => {
      const filters = deserializeScope({ startDate: '2026-08-01', endDate: '2026-08-31' });
      expect(Object.keys(filters).sort()).toEqual(['endDate', 'startDate']);
    });

    it('revives a goal scope, so replay and "view transactions" both narrow', () => {
      const filters = deserializeScope({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        goalId: 'g1',
      });
      expect(filters.goalId).toBe('g1');
    });

    it('round-trips a serialized scope to the same day keys', () => {
      // The end date's 23:59:59.999 truncates to its day key by design:
      // getTransactionsInRange re-clamps the end of the range to end-of-day,
      // so replaying the revived scope fetches the identical window.
      const roundTripped = serializeScope(deserializeScope(serializeScope(august())));
      expect(roundTripped).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });
    });
  });

  describe('buildAnswerFields', () => {
    const sumAnswer = (): AggregateAnswer => ({
      operation: 'sum',
      value: 421.5,
      currency: 'USD',
      transactionCount: 17,
      scope: august(),
    });

    it('assembles the stored snapshot for a money answer', () => {
      const fields = buildAnswerFields('How much on food in August', { operation: 'sum', limit: 3 }, sumAnswer(), 'USD');
      expect(fields).toEqual({
        schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
        kind: 'aggregate',
        query: 'How much on food in August',
        operation: 'sum',
        limit: 3,
        scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
        baseCurrency: 'USD',
        value: 421.5,
        currency: 'USD',
        transactionCount: 17,
        pinned: false,
      });
    });

    // Written explicitly rather than left absent, the way SavedSearch does it:
    // the prune reads the field, and a create that omitted it would rely on
    // undefined being falsy everywhere it is consulted.
    it('writes a new snapshot unpinned', () => {
      const fields = buildAnswerFields('anything', { operation: 'sum', limit: 3 }, sumAnswer(), 'USD');

      expect(fields.pinned).toBeFalse();
    });

    it('writes a count answer without a currency key', () => {
      const fields = buildAnswerFields('how many trips', { operation: 'count', limit: 3 }, {
        operation: 'count',
        value: 4,
        transactionCount: 4,
        scope: august(),
      }, 'USD');
      expect('currency' in fields).toBeFalse();
      expect(fields.value).toBe(4);
      expect(fields.baseCurrency).toBe('USD');
    });

    it('stores the extreme row as an id, never the transaction itself', () => {
      const extreme = createTransaction({ id: 'tx-9', description: 'Omakase dinner' });
      const fields = buildAnswerFields('biggest expense', { operation: 'max', limit: 3 }, {
        operation: 'max',
        value: 180,
        currency: 'USD',
        transactionCount: 12,
        scope: august(),
        extremeTransaction: extreme,
      }, 'USD');
      expect(fields.extremeTransactionId).toBe('tx-9');
      expect('extremeTransaction' in fields).toBeFalse();
    });

    it('keeps topCategories groups in stored order', () => {
      const fields = buildAnswerFields('top categories', { operation: 'topCategories', limit: 2 }, {
        operation: 'topCategories',
        value: 300,
        currency: 'USD',
        transactionCount: 20,
        scope: august(),
        groups: [
          { categoryId: 'cat-food', total: 300 },
          { categoryId: 'cat-transport', total: 120 },
        ],
      }, 'USD');
      expect(fields.groups).toEqual([
        { categoryId: 'cat-food', total: 300 },
        { categoryId: 'cat-transport', total: 120 },
      ]);
    });
  });

  describe('recordToAnswer', () => {
    it('rebuilds the answer with a revived scope and no extreme transaction', () => {
      const answer = recordToAnswer(record({ extremeTransactionId: 'tx-9' }));
      expect(answer.operation).toBe('sum');
      expect(answer.value).toBe(421.5);
      expect(answer.currency).toBe('USD');
      expect(answer.transactionCount).toBe(17);
      expect(answer.scope.startDate).toEqual(new Date(2026, 7, 1));
      expect(answer.extremeTransaction).toBeUndefined();
    });

    it('leaves currency off a stored count', () => {
      const answer = recordToAnswer(record({ operation: 'count', value: 4, currency: undefined }));
      expect('currency' in answer).toBeFalse();
    });

    it('carries stored groups through', () => {
      const groups = [{ categoryId: 'cat-food', total: 300 }];
      expect(recordToAnswer(record({ groups })).groups).toEqual(groups);
    });
  });

  describe('recordToIntent', () => {
    it('yields the replay intent the aggregate path expects', () => {
      const intent = recordToIntent(record({ operation: 'topCategories', limit: 5 }));
      expect(intent.operation).toBe('topCategories');
      expect(intent.limit).toBe(5);
      expect(intent.filters.startDate).toEqual(new Date(2026, 7, 1));
      expect(intent.filters.endDate).toEqual(new Date(2026, 7, 31));
    });
  });

  describe('searchRecordDedupeKey', () => {
    const scope: SerializableSearchScope = { startDate: '2026-08-01', endDate: '2026-08-31' };
    const agg = (overrides = {}) =>
      ({ kind: 'aggregate' as const, query: 'food', operation: 'sum' as const, limit: 3, scope, ...overrides });

    it('is insensitive to query case and surrounding whitespace', () => {
      expect(searchRecordDedupeKey(agg({ query: '  Food THIS Month ' })))
        .toBe(searchRecordDedupeKey(agg({ query: 'food this month' })));
    });

    it('is insensitive to scope key order', () => {
      const reordered: SerializableSearchScope = { endDate: '2026-08-31', startDate: '2026-08-01' };
      expect(searchRecordDedupeKey(agg()))
        .toBe(searchRecordDedupeKey(agg({ scope: reordered })));
    });

    it('separates different operations, limits and scopes', () => {
      const base = searchRecordDedupeKey(agg());
      expect(searchRecordDedupeKey(agg({ operation: 'average' }))).not.toBe(base);
      expect(searchRecordDedupeKey(agg({ limit: 5 }))).not.toBe(base);
      expect(searchRecordDedupeKey(agg({ scope: { ...scope, currency: 'JPY' } }))).not.toBe(base);
    });

    // The same sentence can produce either shape across prompt revisions, and
    // an answer must never be overwritten by a filter reading of those words.
    it('separates the two kinds of record for one question', () => {
      expect(searchRecordDedupeKey({ kind: 'filter', query: 'food', scope }))
        .not.toBe(searchRecordDedupeKey(agg()));
    });

    // A filter record has no operation or limit, so folding them in would make
    // its identity depend on fields it never carries.
    it('ignores operation and limit on a filter record', () => {
      expect(searchRecordDedupeKey({ kind: 'filter', query: 'food', scope, operation: 'sum', limit: 3 }))
        .toBe(searchRecordDedupeKey({ kind: 'filter', query: 'food', scope }));
    });

    it('still separates filter records by scope', () => {
      expect(searchRecordDedupeKey({ kind: 'filter', query: 'food', scope: { ...scope, type: 'expense' } }))
        .not.toBe(searchRecordDedupeKey({ kind: 'filter', query: 'food', scope }));
    });
  });

  describe('buildFilterFields', () => {
    it('stores the question and its resolved scope, and nothing else', () => {
      const fields = buildFilterFields('coffee last month', { ...august(), searchQuery: 'coffee' });

      expect(fields).toEqual({
        schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
        kind: 'filter',
        query: 'coffee last month',
        scope: { startDate: '2026-08-01', endDate: '2026-08-31', searchQuery: 'coffee' },
        pinned: false,
      });
    });

    // A filter record carrying a value would render as an answer nobody
    // computed, so the shape has to stay free of the aggregate half.
    it('carries none of the aggregate fields', () => {
      const fields = buildFilterFields('coffee last month', august()) as Record<string, unknown>;

      for (const key of ['operation', 'limit', 'baseCurrency', 'value', 'transactionCount']) {
        expect(key in fields).withContext(key).toBeFalse();
      }
    });
  });

  describe('recordToFilters', () => {
    it('revives the scope a filter record replays', () => {
      const filters = recordToFilters({
        ...record(),
        kind: 'filter',
        scope: { startDate: '2026-08-01', endDate: '2026-08-31', type: 'expense' },
      } as never);

      expect(filters.startDate).toEqual(new Date(2026, 7, 1));
      expect(filters.type).toBe('expense');
    });
  });
});
