import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';
import {
  MAX_SEARCH_ANSWERS,
  SearchAnswerHistoryService,
} from './search-answer-history.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { createTransaction, createUser } from './testing/test-data';
import {
  AggregateAnswer,
  SEARCH_ANSWER_SCHEMA_VERSION,
  SearchAnswerRecord,
} from '../../models';

describe('SearchAnswerHistoryService', () => {
  let service: SearchAnswerHistoryService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let userIdSpy: jasmine.Spy;

  const PATH = 'users/user123/searchAnswers';
  const NOW = Timestamp.fromMillis(1_800_000_000_000);

  const sumAnswer = (overrides: Partial<AggregateAnswer> = {}): AggregateAnswer => ({
    operation: 'sum',
    value: 421.5,
    currency: 'USD',
    transactionCount: 17,
    scope: {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 31, 23, 59, 59, 999),
    },
    ...overrides,
  });

  const stored = (
    id: string,
    lastUsedMillis: number,
    overrides: Partial<Omit<SearchAnswerRecord, 'kind'>> = {},
  ): SearchAnswerRecord => ({
    id,
    userId: 'user123',
    schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
    kind: 'aggregate',
    query: `query ${id}`,
    operation: 'sum',
    limit: 3,
    scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
    baseCurrency: 'USD',
    value: 10,
    currency: 'USD',
    transactionCount: 2,
    computedAt: Timestamp.fromMillis(lastUsedMillis),
    lastUsedAt: Timestamp.fromMillis(lastUsedMillis),
    ...overrides,
  });

  const seed = async (records: SearchAnswerRecord[]): Promise<void> => {
    mockFirestoreService.subscribeToCollection.and.returnValue(of(records));
    await firstValueFrom(service.loadAnswers());
  };

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getCollection',
      'getTimestamp',
    ]);
    userIdSpy = jasmine.createSpy('userId').and.returnValue('user123');
    const currentUserSpy = jasmine.createSpy('currentUser').and.returnValue(
      createUser({ preferences: createUser().preferences }),
    );
    const mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: userIdSpy,
      currentUser: currentUserSpy,
    });

    mockFirestoreService.subscribeToCollection.and.returnValue(of([]));
    mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-answer-id'));
    mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.getTimestamp.and.returnValue(NOW);

    TestBed.configureTestingModule({
      providers: [
        SearchAnswerHistoryService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    });
    service = TestBed.inject(SearchAnswerHistoryService);
  });

  it('caps the history at fifty records', () => {
    expect(MAX_SEARCH_ANSWERS).toBe(50);
  });

  describe('loadAnswers', () => {
    it('orders by recency and feeds the answers signal', async () => {
      await seed([stored('a-1', 2_000), stored('a-2', 1_000)]);
      expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(PATH, {
        orderBy: [{ field: 'lastUsedAt', direction: 'desc' }],
      });
      expect(service.answers().map(a => a.id)).toEqual(['a-1', 'a-2']);
    });

    it('returns empty and clears when signed out', async () => {
      userIdSpy.and.returnValue(null);
      const records = await firstValueFrom(service.loadAnswers());
      expect(records).toEqual([]);
      expect(service.answers()).toEqual([]);
    });
  });

  describe('recordAnswer', () => {
    it('writes the full snapshot for a money answer', async () => {
      await service.recordAnswer('how much on food', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.addDocument).toHaveBeenCalledWith(PATH, jasmine.objectContaining({
        userId: 'user123',
        schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
        query: 'how much on food',
        operation: 'sum',
        limit: 3,
        scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
        baseCurrency: 'USD',
        value: 421.5,
        currency: 'USD',
        transactionCount: 17,
        computedAt: NOW,
        lastUsedAt: NOW,
      }));
    });

    it('writes a count answer without a currency key and falls back to the profile base', async () => {
      await service.recordAnswer('how many trips', { operation: 'count', limit: 3 }, sumAnswer({
        operation: 'count',
        value: 4,
        currency: undefined,
        transactionCount: 4,
      }));

      const payload = mockFirestoreService.addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect('currency' in payload).toBeFalse();
      expect(payload['baseCurrency']).toBe('USD');
    });

    it('stores the extreme row by id only', async () => {
      await service.recordAnswer('biggest expense', { operation: 'max', limit: 3 }, sumAnswer({
        operation: 'max',
        extremeTransaction: createTransaction({ id: 'tx-9' }),
      }));

      const payload = mockFirestoreService.addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(payload['extremeTransactionId']).toBe('tx-9');
      expect('extremeTransaction' in payload).toBeFalse();
    });

    it('does nothing signed out', async () => {
      userIdSpy.and.returnValue(null);
      await service.recordAnswer('how much on food', { operation: 'sum', limit: 3 }, sumAnswer());
      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('updates the existing record when the same question covers the same scope', async () => {
      await seed([stored('a-1', 1_000, { query: '  How MUCH on Food ' })]);

      await service.recordAnswer('how much on food', { operation: 'sum', limit: 3 }, sumAnswer({ value: 500 }));

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/a-1`, jasmine.objectContaining({
        value: 500,
        transactionCount: 17,
        computedAt: NOW,
        lastUsedAt: NOW,
      }));
    });

    it('prunes the oldest record past the cap', async () => {
      const full = Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i));
      await seed(full);

      await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(1);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(`${PATH}/a-${MAX_SEARCH_ANSWERS - 1}`);
    });

    it('never counts the just-written record against the cap', async () => {
      // With a live subscription the local write's snapshot lands in the
      // signal before addDocument resolves; counting it again would prune one
      // record too many.
      const full = Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i));
      await seed([stored('new-answer-id', 2_000_000, { query: 'a brand new question' }), ...full]);

      await service.recordAnswer('a different question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(1);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(`${PATH}/a-${MAX_SEARCH_ANSWERS - 1}`);
    });

    it('writes a new record unpinned', async () => {
      await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.addDocument).toHaveBeenCalledWith(
        PATH,
        jasmine.objectContaining({ pinned: false }),
      );
    });

    // The whole point of pinning: idle questions must not evict the one that
    // was worth keeping, even when it is the least recently used of the lot.
    it('prunes past a pinned record rather than through it', async () => {
      // One over the cap once the pinned record stops occupying a slot, so
      // there is exactly one eviction to place.
      const full = Array.from({ length: MAX_SEARCH_ANSWERS + 1 }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i, { pinned: i === MAX_SEARCH_ANSWERS }));
      await seed(full);

      await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(1);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        `${PATH}/a-${MAX_SEARCH_ANSWERS - 1}`,
      );
    });

    it('leaves the history alone when pinning has freed a slot', async () => {
      const full = Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i, { pinned: i === MAX_SEARCH_ANSWERS - 1 }));
      await seed(full);

      await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.deleteDocument).not.toHaveBeenCalled();
    });

    // Pinned records do not occupy slots, so a history that is at the cap on
    // paper but pinned throughout has nothing to prune.
    it('counts only unpinned records against the cap', async () => {
      const full = Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i, { pinned: true }));
      await seed(full);

      await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

      expect(mockFirestoreService.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('recordFilter', () => {
    const AUGUST = {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 31, 23, 59, 59, 999),
    };

    it('stores the question and its scope, and none of the aggregate fields', async () => {
      await service.recordFilter('coffee last month', { ...AUGUST, searchQuery: 'coffee' });

      const payload = mockFirestoreService.addDocument.calls.mostRecent().args[1] as Record<
        string,
        unknown
      >;
      expect(payload['kind']).toBe('filter');
      expect(payload['query']).toBe('coffee last month');
      expect(payload['scope']).toEqual({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        searchQuery: 'coffee',
      });
      for (const key of ['operation', 'limit', 'baseCurrency', 'value', 'transactionCount']) {
        expect(key in payload).withContext(key).toBeFalse();
      }
    });

    // There are no figures to rewrite, which is the whole difference from
    // recordAnswer: re-asking only moves the record back up the list.
    it('only refreshes recency when the same filter is asked again', async () => {
      await seed([
        {
          ...stored('f-1', 1_000),
          kind: 'filter',
          query: 'coffee last month',
        } as never,
      ]);

      await service.recordFilter('  Coffee LAST Month ', AUGUST);

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/f-1`, {
        lastUsedAt: NOW,
      });
    });

    it('does not collide with an aggregate record of the same question', async () => {
      await seed([stored('a-1', 1_000, { query: 'coffee last month' })]);

      await service.recordFilter('coffee last month', AUGUST);

      expect(mockFirestoreService.addDocument).toHaveBeenCalled();
    });

    it('does nothing signed out', async () => {
      userIdSpy.and.returnValue(null);

      await service.recordFilter('coffee last month', AUGUST);

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
    });

    it('takes a slot like any other record', async () => {
      const full = Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        stored(`a-${i}`, 1_000_000 - i));
      await seed(full);

      await service.recordFilter('a brand new filter', AUGUST);

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        `${PATH}/a-${MAX_SEARCH_ANSWERS - 1}`,
      );
    });
  });

  describe('records written before the kind existed', () => {
    // Aggregates are all this collection ever held, so a record with no kind
    // has to read as one — otherwise every pre-version-2 row renders as a
    // filter with no figures.
    it('reads as an aggregate', async () => {
      const legacy = stored('old-1', 1_000) as unknown as Record<string, unknown>;
      delete legacy['kind'];
      await seed([legacy as never]);

      expect(service.answers()[0].kind).toBe('aggregate');
    });
  });

  describe('togglePin', () => {
    it('writes only the pin', async () => {
      await service.togglePin('a-1', true);

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/a-1`, {
        pinned: true,
      });
    });

    it('releases a record back into the prune', async () => {
      await service.togglePin('a-1', false);

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/a-1`, {
        pinned: false,
      });
    });

    it('sorts pinned records above the rest, each still by recency', async () => {
      await seed([
        stored('recent', 3_000_000),
        stored('pinned-old', 1_000_000, { pinned: true }),
        stored('older', 2_000_000),
        stored('pinned-newer', 2_500_000, { pinned: true }),
      ]);

      expect(service.answers().map(r => r.id)).toEqual([
        'pinned-old',
        'pinned-newer',
        'recent',
        'older',
      ]);
    });

    // A refresh replaces figures; it is not a decision about the record.
    it('is not disturbed by a refresh', async () => {
      await service.refreshAnswer('a-1', sumAnswer());

      const written = mockFirestoreService.updateDocument.calls.mostRecent().args[1] as Record<
        string,
        unknown
      >;
      expect('pinned' in written).toBe(false);
    });
  });

  describe('refreshAnswer', () => {
    it('replaces the figures and stamps a new computed-at', async () => {
      await service.refreshAnswer('a-1', sumAnswer({ value: 999, transactionCount: 21 }));

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/a-1`, jasmine.objectContaining({
        value: 999,
        transactionCount: 21,
        baseCurrency: 'USD',
        currency: 'USD',
        computedAt: NOW,
        lastUsedAt: NOW,
      }));
    });

    it('clears vanished optionals with sentinels rather than leaving stale values', async () => {
      await service.refreshAnswer('a-1', sumAnswer({
        operation: 'count',
        currency: undefined,
        extremeTransaction: undefined,
        groups: undefined,
      }));

      const update = mockFirestoreService.updateDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      // Keys present but not their live types: the deleteField() sentinel.
      expect('currency' in update).toBeTrue();
      expect(typeof update['currency']).not.toBe('string');
      expect('extremeTransactionId' in update).toBeTrue();
      expect(typeof update['extremeTransactionId']).not.toBe('string');
      expect('groups' in update).toBeTrue();
      expect(Array.isArray(update['groups'])).toBeFalse();
    });

    it('never touches the record identity', async () => {
      await service.refreshAnswer('a-1', sumAnswer());
      const update = mockFirestoreService.updateDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      for (const key of ['query', 'operation', 'limit', 'scope', 'schemaVersion', 'userId']) {
        expect(key in update).withContext(key).toBeFalse();
      }
    });
  });

  describe('touch / deleteAnswer', () => {
    it('touch refreshes recency only', async () => {
      await service.touch('a-1');
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(`${PATH}/a-1`, { lastUsedAt: NOW });
    });

    it('deleteAnswer removes the document', async () => {
      await service.deleteAnswer('a-1');
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(`${PATH}/a-1`);
    });
  });

  describe('sign-out', () => {
    it('clears the cached answers so they cannot flash for the next account', async () => {
      // Fresh injector with a signal-backed auth stub: the reset effect
      // tracks userId() reactively, which a jasmine spy cannot express.
      TestBed.resetTestingModule();
      const userId = signal<string | null>('user-1');
      const firestore = jasmine.createSpyObj('FirestoreService', ['subscribeToCollection']);
      firestore.subscribeToCollection.and.returnValue(of([stored('a-1', 1_000)]));
      TestBed.configureTestingModule({
        providers: [
          SearchAnswerHistoryService,
          { provide: FirestoreService, useValue: firestore },
          { provide: AuthService, useValue: { userId, currentUser: () => null } },
        ],
      });
      const fresh = TestBed.inject(SearchAnswerHistoryService);
      await firstValueFrom(fresh.loadAnswers());
      expect(fresh.answers().length).toBe(1);

      userId.set(null);
      TestBed.tick();

      expect(fresh.answers()).toEqual([]);
    });
  });

  describe('deleteAll', () => {
    it('deletes every document and resets the in-memory state', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'a-1' }, { id: 'a-2' }]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestoreService.deleteDocument.calls.allArgs()).toEqual([
        [`${PATH}/a-1`],
        [`${PATH}/a-2`]
      ]);
      expect(service.answers()).toEqual([]);
    });

    it('enumerates the collection rather than the signal', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'a-1' }, { id: 'a-2' }]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestoreService.getCollection).toHaveBeenCalledWith(PATH);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(2);
    });
  });
});
