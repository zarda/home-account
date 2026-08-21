import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TagMemoryService } from './tag-memory.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TagMemoryEntry } from '../../models';

describe('TagMemoryService', () => {
  let service: TagMemoryService;
  let firestore: jasmine.SpyObj<FirestoreService>;
  let userId: ReturnType<typeof signal<string | null>>;

  const entry = (overrides: Partial<TagMemoryEntry> = {}): TagMemoryEntry => ({
    merchantKey: 'starbucks',
    tags: ['coffee'],
    suppressed: [],
    sampleDescription: 'STARBUCKS #123',
    count: 1,
    ...overrides,
  });

  beforeEach(() => {
    firestore = jasmine.createSpyObj<FirestoreService>('FirestoreService', [
      'getCollection',
      'setDocument',
      'deleteDocument',
    ]);
    firestore.getCollection.and.resolveTo([]);
    firestore.setDocument.and.resolveTo(undefined);
    firestore.deleteDocument.and.resolveTo(undefined);

    userId = signal<string | null>('user-1');

    TestBed.configureTestingModule({
      providers: [
        TagMemoryService,
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', [], { userId }) },
      ],
    });
    service = TestBed.inject(TagMemoryService);
  });

  describe('ensureLoaded', () => {
    it('reads the collection once per user', async () => {
      await service.ensureLoaded();
      await service.ensureLoaded();
      expect(firestore.getCollection).toHaveBeenCalledTimes(1);
      expect(firestore.getCollection).toHaveBeenCalledWith('users/user-1/tagMemory');
    });

    it('reloads after the user changes', async () => {
      await service.ensureLoaded();
      userId.set('user-2');
      await service.ensureLoaded();
      expect(firestore.getCollection).toHaveBeenCalledTimes(2);
    });

    it('clears the map when signed out', async () => {
      firestore.getCollection.and.resolveTo([entry()]);
      await service.ensureLoaded();
      expect(service.rememberedCount()).toBe(1);

      userId.set(null);
      await service.ensureLoaded();

      // One account's merchants must never surface for the next sign-in on a
      // shared device.
      expect(service.rememberedCount()).toBe(0);
      expect(service.lookup('Starbucks')).toBeNull();
    });

    it('survives a read failure by remembering nothing', async () => {
      spyOn(console, 'warn');
      firestore.getCollection.and.rejectWith(new Error('offline'));
      await service.ensureLoaded();
      expect(service.rememberedCount()).toBe(0);
    });
  });

  describe('lookup', () => {
    beforeEach(async () => {
      firestore.getCollection.and.resolveTo([
        entry({ tags: ['coffee', 'work'], suppressed: ['travel'] }),
      ]);
      await service.ensureLoaded();
    });

    it('answers with what the merchant keeps and what it refuses', () => {
      expect(service.lookup('Starbucks')).toEqual({
        tags: ['coffee', 'work'],
        suppressed: ['travel'],
      });
    });

    it('returns null for a merchant it has not seen', () => {
      expect(service.lookup('Costa Coffee')).toBeNull();
    });

    it('returns null for a description with nothing to key on', () => {
      expect(service.lookup('---')).toBeNull();
      expect(service.lookup('')).toBeNull();
    });
  });

  describe('remember', () => {
    it('writes the kept tags under the merchant key', async () => {
      await service.remember('STARBUCKS #123', ['Coffee', ' work '], []);

      expect(firestore.setDocument).toHaveBeenCalledWith(
        'users/user-1/tagMemory/starbucks123',
        jasmine.objectContaining({
          merchantKey: 'starbucks123',
          tags: ['coffee', 'work'],
          suppressed: [],
          count: 1,
        }),
        true
      );
    });

    it('accumulates refusals and raises the count', async () => {
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks123', suppressed: ['travel'], count: 2 }),
      ]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS #123', ['coffee'], ['lunch']);

      expect(firestore.setDocument).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({
          tags: ['coffee'],
          suppressed: ['travel', 'lunch'],
          count: 3,
        }),
        true
      );
    });

    it('replaces the kept tags rather than merging them', async () => {
      // The last confirm is the user's current opinion, so a tag they dropped
      // this time must not survive from the previous one.
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks', tags: ['coffee', 'work'] }),
      ]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS', ['coffee'], []);

      expect(service.lookup('STARBUCKS')?.tags).toEqual(['coffee']);
    });

    it('un-suppresses a tag the user kept again', async () => {
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks', suppressed: ['lunch', 'travel'] }),
      ]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS', ['lunch'], []);

      expect(service.lookup('STARBUCKS')).toEqual({ tags: ['lunch'], suppressed: ['travel'] });
    });

    it('records neither side of a tag kept and removed at once', async () => {
      await service.remember('STARBUCKS', ['coffee'], ['coffee', 'lunch']);

      expect(service.lookup('STARBUCKS')).toEqual({ tags: ['coffee'], suppressed: ['lunch'] });
    });

    it('updates the map before the write resolves', async () => {
      // The review list should show the decision even while the write is
      // still in flight or the device is offline.
      let release!: () => void;
      firestore.setDocument.and.returnValue(
        new Promise<void>(resolve => {
          release = () => resolve();
        })
      );

      const pending = service.remember('STARBUCKS', ['coffee'], []);
      expect(service.lookup('STARBUCKS')).toEqual({ tags: ['coffee'], suppressed: [] });

      release();
      await pending;
    });

    it('keeps the decision even when the write fails', async () => {
      spyOn(console, 'warn');
      firestore.setDocument.and.rejectWith(new Error('offline'));

      await service.remember('STARBUCKS', ['coffee'], []);

      expect(service.lookup('STARBUCKS')?.tags).toEqual(['coffee']);
    });

    it('writes nothing when nothing was kept and nothing removed', async () => {
      // No tags at all is not a decision: an untagged row must not blank an
      // entry or count as a confirmation.
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks', tags: ['coffee'], suppressed: ['lunch'], count: 4 }),
      ]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS', [], []);
      await service.remember('STARBUCKS', ['  '], ['']);

      expect(firestore.setDocument).not.toHaveBeenCalled();
      expect(service.lookup('STARBUCKS')).toEqual({ tags: ['coffee'], suppressed: ['lunch'] });
      expect(service.remembered()[0].count).toBe(4);
    });

    it('writes nothing for a merchant with no entry and no decision', async () => {
      await service.remember('STARBUCKS', [], []);

      expect(firestore.setDocument).not.toHaveBeenCalled();
      expect(service.rememberedCount()).toBe(0);
    });

    it('never writes an empty document id', async () => {
      // An empty path segment addresses the collection rather than a document
      // in it, so this has to be refused before the write.
      await service.remember('***', ['coffee'], []);
      await service.remember('', ['coffee'], []);
      expect(firestore.setDocument).not.toHaveBeenCalled();
    });

    it('does nothing when signed out', async () => {
      userId.set(null);
      await service.remember('STARBUCKS', ['coffee'], []);
      expect(firestore.setDocument).not.toHaveBeenCalled();
    });
  });

  describe('rememberAll', () => {
    it('unions the decisions of every row for one merchant', async () => {
      await service.rememberAll([
        { description: 'STARBUCKS', kept: ['coffee'], removed: ['travel'] },
        { description: 'Starbucks', kept: ['work'], removed: ['lunch'] },
        { description: 'COSTA', kept: ['coffee'], removed: [] },
      ]);

      expect(firestore.setDocument).toHaveBeenCalledTimes(2);
      expect(service.lookup('starbucks')).toEqual({
        tags: ['coffee', 'work'],
        suppressed: ['travel', 'lunch'],
      });
      expect(service.lookup('costa')).toEqual({ tags: ['coffee'], suppressed: [] });
    });

    it('records neither side of a tag both kept and removed in one batch', async () => {
      // One row keeping what another dropped is not a preference; recording
      // either side would invent one and reuse it on every later import.
      await service.rememberAll([
        { description: 'STARBUCKS', kept: ['coffee'], removed: ['lunch'] },
        { description: 'Starbucks', kept: [], removed: ['coffee'] },
      ]);

      expect(service.lookup('starbucks')).toEqual({ tags: [], suppressed: ['lunch'] });
    });

    it('writes nothing for a merchant whose only decision was contested', async () => {
      await service.rememberAll([
        { description: 'STARBUCKS', kept: ['coffee'], removed: [] },
        { description: 'Starbucks', kept: [], removed: ['coffee'] },
      ]);

      expect(firestore.setDocument).not.toHaveBeenCalled();
    });

    it('skips rows with no usable merchant key', async () => {
      await service.rememberAll([
        { description: '---', kept: ['coffee'], removed: [] },
        { description: 'COSTA', kept: ['coffee'], removed: [] },
      ]);
      expect(firestore.setDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('forget and clear', () => {
    beforeEach(async () => {
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks' }),
        entry({ merchantKey: 'costa' }),
      ]);
      await service.ensureLoaded();
    });

    it('forgets one merchant', async () => {
      await service.forget('starbucks');
      expect(firestore.deleteDocument).toHaveBeenCalledWith('users/user-1/tagMemory/starbucks');
      expect(service.lookup('starbucks')).toBeNull();
      expect(service.lookup('costa')).not.toBeNull();
    });

    it('clears everything it had loaded', async () => {
      await service.clear();
      expect(firestore.deleteDocument).toHaveBeenCalledTimes(2);
      expect(service.rememberedCount()).toBe(0);
    });
  });

  describe('remembered', () => {
    it('lists the most-confirmed merchants first', async () => {
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'a', count: 1 }),
        entry({ merchantKey: 'b', count: 9 }),
        entry({ merchantKey: 'c', count: 4 }),
      ]);
      await service.ensureLoaded();
      expect(service.remembered().map(e => e.merchantKey)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('deleteAll', () => {
    it('enumerates the collection rather than the loaded entries', async () => {
      // Loaded first, so the count assertion below is about deleteAll
      // emptying the cache rather than about a cache that was never filled.
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks' }),
        entry({ merchantKey: 'costa' }),
      ]);
      await service.ensureLoaded();
      expect(service.rememberedCount()).toBe(2);

      firestore.getCollection.and.resolveTo([{ id: 'starbucks' }, { id: 'costa' }]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(firestore.deleteDocument.calls.allArgs()).toEqual([
        ['users/user-1/tagMemory/starbucks'],
        ['users/user-1/tagMemory/costa'],
      ]);
      expect(service.rememberedCount()).toBe(0);
    });

    it('resolves to zero while signed out', async () => {
      userId.set(null);

      expect(await service.deleteAll()).toBe(0);
      expect(firestore.deleteDocument).not.toHaveBeenCalled();
    });
  });
});
