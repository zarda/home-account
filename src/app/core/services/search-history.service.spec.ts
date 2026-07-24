import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import {
  MAX_RECENT_SEARCHES,
  SearchHistoryService
} from './search-history.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { SavedSearch } from '../../models';

const PATH = 'users/user123/savedSearches';

describe('SearchHistoryService', () => {
  let service: SearchHistoryService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let userIdSpy: jasmine.Spy;

  // Entries come back from the query ordered lastUsedAt desc; hoursAgo keeps
  // fixtures in that order.
  const entry = (
    id: string,
    query: string,
    overrides: Partial<SavedSearch> = {},
    hoursAgo = 0
  ): SavedSearch => ({
    id,
    userId: 'user123',
    query,
    pinned: false,
    lastUsedAt: Timestamp.fromMillis(Date.UTC(2026, 5, 30, 12) - hoursAgo * 3_600_000),
    ...overrides
  });

  function seed(searches: SavedSearch[]): void {
    mockFirestoreService.subscribeToCollection.and.returnValue(of(searches));
    service.loadSearches().subscribe();
  }

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getTimestamp'
    ]);

    userIdSpy = jasmine.createSpy('userId').and.returnValue('user123');
    const mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: userIdSpy
    });

    mockFirestoreService.subscribeToCollection.and.returnValue(of([]));
    mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-search-id'));
    mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.fromMillis(1_800_000_000_000));

    TestBed.configureTestingModule({
      providers: [
        SearchHistoryService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService }
      ]
    });

    service = TestBed.inject(SearchHistoryService);
  });

  describe('loadSearches', () => {
    it('splits pinned and recent entries', () => {
      seed([
        entry('s1', 'coffee', { pinned: true, label: 'Coffee runs' }),
        entry('s2', 'gym', {}, 1),
        entry('s3', 'rent', {}, 2)
      ]);

      expect(service.savedSearches().map(s => s.id)).toEqual(['s1']);
      expect(service.recentSearches().map(s => s.id)).toEqual(['s2', 's3']);
    });

    it('caps recents at MAX_RECENT_SEARCHES', () => {
      const many = Array.from({ length: MAX_RECENT_SEARCHES + 3 }, (_, i) =>
        entry(`r${i}`, `query ${i}`, {}, i)
      );
      seed(many);

      expect(service.recentSearches().length).toBe(MAX_RECENT_SEARCHES);
      expect(service.recentSearches()[0].id).toBe('r0');
    });

    it('orders the query by lastUsedAt descending', () => {
      seed([]);
      const options = mockFirestoreService.subscribeToCollection.calls.mostRecent().args[1];
      expect(options?.orderBy).toEqual([{ field: 'lastUsedAt', direction: 'desc' }]);
    });

    it('clears stale entries when loading without a signed-in user', () => {
      seed([entry('s1', 'coffee'), entry('s2', 'gym', { pinned: true })]);
      expect(service.recentSearches().length).toBe(1);

      userIdSpy.and.returnValue(null);
      service.loadSearches().subscribe();

      expect(service.recentSearches()).toEqual([]);
      expect(service.savedSearches()).toEqual([]);
    });
  });

  describe('recordRecent', () => {
    it('adds a new unpinned entry for an unseen query', async () => {
      seed([]);
      await service.recordRecent('  starbucks  ');

      expect(mockFirestoreService.addDocument).toHaveBeenCalledWith(
        PATH,
        jasmine.objectContaining({
          userId: 'user123',
          query: 'starbucks',
          pinned: false
        })
      );
    });

    it('only touches lastUsedAt for an existing query, case-insensitively', async () => {
      seed([entry('s1', 'Starbucks')]);
      await service.recordRecent('starbucks');

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        `${PATH}/s1`,
        jasmine.objectContaining({ lastUsedAt: jasmine.anything() })
      );
    });

    it('ignores queries shorter than two characters', async () => {
      seed([]);
      await service.recordRecent('a');
      await service.recordRecent('  x ');

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('prunes the oldest unpinned entries past the cap', async () => {
      const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_, i) =>
        entry(`r${i}`, `query ${i}`, {}, i)
      );
      seed([entry('pinned1', 'rent', { pinned: true }), ...full]);

      await service.recordRecent('a brand new query');

      expect(mockFirestoreService.addDocument).toHaveBeenCalled();
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(1);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        `${PATH}/r${MAX_RECENT_SEARCHES - 1}`
      );
    });

    it('does not over-prune when the live snapshot already delivered the new doc', async () => {
      // In production a persistent subscription is active, and the local
      // write's latency-compensated snapshot lands before addDocument's
      // promise resolves — so the signal already contains the new entry.
      const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_, i) =>
        entry(`r${i}`, `query ${i}`, {}, i)
      );
      seed(full);
      mockFirestoreService.addDocument.and.callFake((path: string, data: object) => {
        seed([
          entry('new-search-id', (data as { query: string }).query, {}, -1),
          ...full
        ]);
        return Promise.resolve('new-search-id');
      });

      await service.recordRecent('a brand new query');

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(1);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        `${PATH}/r${MAX_RECENT_SEARCHES - 1}`
      );
    });

    it('does nothing when unauthenticated', async () => {
      userIdSpy.and.returnValue(null);
      await service.recordRecent('starbucks');

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
    });
  });

  describe('saveSearch', () => {
    it('pins an existing recent entry with the label', async () => {
      seed([entry('s1', 'starbucks')]);
      const id = await service.saveSearch('starbucks', 'Coffee runs');

      expect(id).toBe('s1');
      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        `${PATH}/s1`,
        jasmine.objectContaining({ pinned: true, label: 'Coffee runs' })
      );
    });

    it('creates a pinned entry for a new query', async () => {
      seed([]);
      const id = await service.saveSearch('utilities', 'Bills');

      expect(id).toBe('new-search-id');
      expect(mockFirestoreService.addDocument).toHaveBeenCalledWith(
        PATH,
        jasmine.objectContaining({
          query: 'utilities',
          label: 'Bills',
          pinned: true
        })
      );
    });
  });

  describe('touch / deleteSearch', () => {
    it('touch refreshes lastUsedAt', async () => {
      seed([entry('s1', 'gym')]);
      await service.touch('s1');

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        `${PATH}/s1`,
        jasmine.objectContaining({ lastUsedAt: jasmine.anything() })
      );
    });

    it('deleteSearch removes the document', async () => {
      seed([entry('s1', 'gym')]);
      await service.deleteSearch('s1');

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(`${PATH}/s1`);
    });
  });
});
