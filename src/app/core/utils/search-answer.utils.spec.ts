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
  answerDedupeKey,
  buildAnswerFields,
  deserializeScope,
  recordToAnswer,
  recordToIntent,
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
        query: 'How much on food in August',
        operation: 'sum',
        limit: 3,
        scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
        baseCurrency: 'USD',
        value: 421.5,
        currency: 'USD',
        transactionCount: 17,
      });
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

  describe('answerDedupeKey', () => {
    const scope: SerializableSearchScope = { startDate: '2026-08-01', endDate: '2026-08-31' };

    it('is insensitive to query case and surrounding whitespace', () => {
      expect(answerDedupeKey('  Food THIS Month ', 'sum', 3, scope))
        .toBe(answerDedupeKey('food this month', 'sum', 3, scope));
    });

    it('is insensitive to scope key order', () => {
      const reordered: SerializableSearchScope = { endDate: '2026-08-31', startDate: '2026-08-01' };
      expect(answerDedupeKey('food', 'sum', 3, scope))
        .toBe(answerDedupeKey('food', 'sum', 3, reordered));
    });

    it('separates different operations, limits and scopes', () => {
      const base = answerDedupeKey('food', 'sum', 3, scope);
      expect(answerDedupeKey('food', 'average', 3, scope)).not.toBe(base);
      expect(answerDedupeKey('food', 'sum', 5, scope)).not.toBe(base);
      expect(answerDedupeKey('food', 'sum', 3, { ...scope, currency: 'JPY' })).not.toBe(base);
    });
  });
});
