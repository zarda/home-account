import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CategoryMemoryService } from './category-memory.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryMemoryEntry } from '../../models';

describe('CategoryMemoryService', () => {
  let service: CategoryMemoryService;
  let firestore: jasmine.SpyObj<FirestoreService>;
  let userId: ReturnType<typeof signal<string | null>>;

  const entry = (overrides: Partial<CategoryMemoryEntry> = {}): CategoryMemoryEntry => ({
    merchantKey: 'starbucks',
    categoryId: 'food_coffee',
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
        CategoryMemoryService,
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', [], { userId }) },
      ],
    });
    service = TestBed.inject(CategoryMemoryService);
  });

  describe('ensureLoaded', () => {
    it('reads the collection once per user', async () => {
      // The import path calls this on every run; a twenty-row batch must not
      // cost twenty reads.
      await service.ensureLoaded();
      await service.ensureLoaded();
      await service.ensureLoaded();
      expect(firestore.getCollection).toHaveBeenCalledTimes(1);
      expect(firestore.getCollection).toHaveBeenCalledWith('users/user-1/categoryMemory');
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
      expect(service.lookup('STARBUCKS #123')).toBeNull();
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
      firestore.getCollection.and.resolveTo([entry()]);
      await service.ensureLoaded();
    });

    it('matches a merchant however it is punctuated', () => {
      expect(service.lookup('Starbucks')).toBe('food_coffee');
      expect(service.lookup('  STARBUCKS  ')).toBe('food_coffee');
      expect(service.lookup('star-bucks')).toBe('food_coffee');
      expect(service.lookup('STAR BUCKS')).toBe('food_coffee');
    });

    it('treats a differently-suffixed branch as a different merchant', () => {
      // "STARBUCKS #123" keys as starbucks123, so a store number makes it a
      // distinct merchant. That is deliberate: branches can be categorized
      // differently, and a wrong merge is worse than a missed one.
      expect(service.lookup('STARBUCKS #123')).toBeNull();
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
    it('writes under the merchant key so a correction replaces the last answer', async () => {
      await service.remember('STARBUCKS #123', 'food_coffee');
      expect(firestore.setDocument).toHaveBeenCalledWith(
        'users/user-1/categoryMemory/starbucks123',
        jasmine.objectContaining({ merchantKey: 'starbucks123', categoryId: 'food_coffee', count: 1 }),
        true
      );
    });

    it('raises the count when the same choice is confirmed again', async () => {
      firestore.getCollection.and.resolveTo([entry({ merchantKey: 'starbucks123', count: 2 })]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS #123', 'food_coffee');

      expect(firestore.setDocument).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({ count: 3 }),
        true
      );
    });

    it('restarts the count when the user changes their mind', async () => {
      firestore.getCollection.and.resolveTo([entry({ merchantKey: 'starbucks123', count: 5 })]);
      await service.ensureLoaded();

      await service.remember('STARBUCKS #123', 'food_restaurants');

      expect(firestore.setDocument).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({ categoryId: 'food_restaurants', count: 1 }),
        true
      );
      expect(service.lookup('STARBUCKS #123')).toBe('food_restaurants');
    });

    it('never writes an empty document id', async () => {
      // An empty path segment addresses the collection rather than a document
      // in it, so this has to be refused before the write.
      await service.remember('***', 'food_coffee');
      await service.remember('', 'food_coffee');
      expect(firestore.setDocument).not.toHaveBeenCalled();
    });

    it('ignores an empty category', async () => {
      await service.remember('STARBUCKS', '');
      expect(firestore.setDocument).not.toHaveBeenCalled();
    });

    it('does nothing when signed out', async () => {
      userId.set(null);
      await service.remember('STARBUCKS', 'food_coffee');
      expect(firestore.setDocument).not.toHaveBeenCalled();
    });

    it('updates the map even when the write fails', async () => {
      // The preview should reflect the correction offline; the write catches up.
      spyOn(console, 'warn');
      firestore.setDocument.and.rejectWith(new Error('offline'));
      await service.remember('STARBUCKS', 'food_coffee');
      expect(service.lookup('STARBUCKS')).toBe('food_coffee');
    });
  });

  describe('rememberAll', () => {
    it('writes one entry per merchant', async () => {
      await service.rememberAll([
        { description: 'STARBUCKS', categoryId: 'food_coffee' },
        { description: 'Starbucks', categoryId: 'food_coffee' },
        { description: 'COSTA', categoryId: 'food_coffee' },
      ]);

      expect(firestore.setDocument).toHaveBeenCalledTimes(2);
      expect(service.lookup('starbucks')).toBe('food_coffee');
    });

    it('remembers nothing for a merchant the batch categorized two ways', async () => {
      // Picking either answer would invent a preference the user never
      // expressed, and then apply it to every future import of that merchant.
      await service.rememberAll([
        { description: 'STARBUCKS', categoryId: 'food_coffee' },
        { description: 'Starbucks', categoryId: 'food_restaurants' },
        { description: 'COSTA', categoryId: 'food_coffee' },
      ]);

      expect(service.lookup('starbucks')).toBeNull();
      expect(service.lookup('costa')).toBe('food_coffee');
      expect(firestore.setDocument).toHaveBeenCalledTimes(1);
    });

    it('skips rows with no usable merchant key', async () => {
      await service.rememberAll([
        { description: '---', categoryId: 'food_coffee' },
        { description: 'COSTA', categoryId: 'food_coffee' },
      ]);
      expect(firestore.setDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('forget and clear', () => {
    beforeEach(async () => {
      firestore.getCollection.and.resolveTo([
        entry({ merchantKey: 'starbucks' }),
        entry({ merchantKey: 'costa', categoryId: 'food_coffee' }),
      ]);
      await service.ensureLoaded();
    });

    it('forgets one merchant', async () => {
      await service.forget('starbucks');
      expect(firestore.deleteDocument).toHaveBeenCalledWith('users/user-1/categoryMemory/starbucks');
      expect(service.lookup('starbucks')).toBeNull();
      expect(service.lookup('costa')).toBe('food_coffee');
    });

    it('clears everything', async () => {
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
});
