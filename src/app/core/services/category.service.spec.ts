import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { CategoryService } from './category.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { LedgerShareService } from './ledger-share.service';
import { clearLedgerDeviceState, readLedgerJournal } from './ledger-journal';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import { createCategory, createCategoryHierarchy } from './testing/test-data';
import { findSerializationIssues } from '../utils/firestore-value.utils';
import { Category, DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../models';

describe('CategoryService', () => {
  let service: CategoryService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CategoryService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    service = TestBed.inject(CategoryService);

    // Set up authenticated user
    mockAuth.setAuthenticated(true);
  });

  afterEach(() => {
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
  });

  describe('sign-out reset', () => {
    it('clears the cached categories on the signed-out edge', () => {
      service.categories.set(service.getDefaultCategories());
      expect(service.categories().length).toBeGreaterThan(0);

      mockAuth.setMockUser(null);
      TestBed.tick();

      expect(service.categories()).toEqual([]);
    });
  });

  describe('editing and reordering built-ins', () => {
    beforeEach(() => {
      service.categories.set(service.getDefaultCategories());
    });

    it('materializes the full row when a built-in is edited', async () => {
      const target = service.categories().find(c => c.userId === null)!;

      await service.updateCategory(target.id, { name: 'Fancy Groceries' });

      // No update to a document that does not exist — that was the silent
      // NOT_FOUND this replaces.
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
      const call = mockFirestore.setDocumentSpy.mostRecent()!;
      expect(call.args[0]).toBe(`users/test-user-123/categories/${target.id}`);
      const payload = call.args[1] as Record<string, unknown>;
      // The rules treat a merge onto a missing document as a create and
      // require the complete field set plus the owner stamp.
      expect(payload['userId']).toBe('test-user-123');
      expect(payload['name']).toBe('Fancy Groceries');
      for (const field of ['icon', 'color', 'type', 'order', 'isActive', 'isDefault']) {
        expect(field in payload).withContext(field).toBeTrue();
      }
      expect(call.args[2]).toBeTrue();
    });

    it('updates a user category document in place', async () => {
      const mine = { ...service.getDefaultCategories()[0], id: 'mine', userId: 'test-user-123' };
      service.categories.set([mine]);

      await service.updateCategory('mine', { name: 'Mine' });

      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockFirestore.updateDocumentSpy.mostRecent()!.args[1]).toEqual({ name: 'Mine' });
    });

    it('reorders a list containing built-ins by materializing them', async () => {
      const defaults = service.getDefaultCategories().filter(c => c.userId === null).slice(0, 2);
      const mine = { ...defaults[0], id: 'mine', userId: 'test-user-123', isDefault: false };
      service.categories.set([...defaults, mine]);

      await service.reorderCategories([mine.id, defaults[0].id, defaults[1].id]);

      // The user document gets a plain order update...
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(1);
      expect(mockFirestore.updateDocumentSpy.mostRecent()!.args[1]).toEqual({ order: 0 });
      // ...and each built-in is created whole, carrying its new order.
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(2);
      const orders = mockFirestore.setDocumentSpy.calls
        .map(c => (c.args[1] as { order: number }).order)
        .sort();
      expect(orders).toEqual([1, 2]);
      for (const c of mockFirestore.setDocumentSpy.calls) {
        expect((c.args[1] as { userId: string }).userId).toBe('test-user-123');
      }
    });
  });

  describe('getDefaultCategories', () => {
    it('should return default categories', () => {
      const categories = service.getDefaultCategories();
      expect(categories.length).toBeGreaterThan(0);
    });

    it('should include expense categories', () => {
      const categories = service.getDefaultCategories();
      const expenseCategories = categories.filter(c => c.type === 'expense');
      expect(expenseCategories.length).toBeGreaterThan(0);
    });

    it('should include income categories', () => {
      const categories = service.getDefaultCategories();
      const incomeCategories = categories.filter(c => c.type === 'income');
      expect(incomeCategories.length).toBeGreaterThan(0);
    });

    it('should mark all default categories as isDefault', () => {
      const categories = service.getDefaultCategories();
      categories.forEach(c => {
        expect(c.isDefault).toBe(true);
      });
    });

    // Transactions reference these ids, so a collision would silently merge two
    // catalog entries into one.
    it('should generate a unique id for every default category', () => {
      const ids = service.getDefaultCategories().map(c => c.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(duplicates).toEqual([]);
    });

    it('should generate one category per catalog entry', () => {
      const expected = [...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].reduce(
        (total, group) => total + 1 + group.categories.length,
        0
      );
      expect(service.getDefaultCategories().length).toBe(expected);
    });

    it('should parent every subcategory to a real group', () => {
      const categories = service.getDefaultCategories();
      const groupIds = new Set(categories.filter(c => !c.parentId).map(c => c.id));
      categories
        .filter(c => c.parentId)
        .forEach(c => {
          expect(groupIds.has(c.parentId as string)).toBe(true, `${c.id} has no group`);
        });
    });
  });

  describe('computed signals', () => {
    beforeEach(() => {
      // Set up test categories
      const testCategories = createCategoryHierarchy();
      service.categories.set(testCategories);
    });

    it('expenseCategories should filter correctly', () => {
      const expenseCategories = service.expenseCategories();
      expect(expenseCategories.length).toBeGreaterThan(0);
      expenseCategories.forEach(c => {
        expect(c.type).not.toBe('income');
        expect(c.isActive).toBe(true);
      });
    });

    it('incomeCategories should filter correctly', () => {
      const incomeCategories = service.incomeCategories();
      expect(incomeCategories.length).toBeGreaterThan(0);
      incomeCategories.forEach(c => {
        expect(c.type).not.toBe('expense');
        expect(c.isActive).toBe(true);
      });
    });

    it('activeCategories should filter by isActive', () => {
      // Add an inactive category
      const categories = [...service.categories()];
      categories.push(createCategory({ id: 'inactive', isActive: false }));
      service.categories.set(categories);

      const activeCategories = service.activeCategories();
      activeCategories.forEach(c => {
        expect(c.isActive).toBe(true);
      });
    });

    it('activeCategories should exclude inactive categories', () => {
      const allCategories = service.categories();
      const inactiveCategory = createCategory({ id: 'inactive', isActive: false });
      service.categories.set([...allCategories, inactiveCategory]);

      const activeCategories = service.activeCategories();
      const foundInactive = activeCategories.find(c => c.id === 'inactive');
      expect(foundInactive).toBeUndefined();
    });
  });

  describe('getCategoryById', () => {
    beforeEach(() => {
      service.categories.set(createCategoryHierarchy());
    });

    it('should find category by ID', () => {
      const category = service.getCategoryById('food');
      expect(category).toBeDefined();
      expect(category?.id).toBe('food');
      expect(category?.name).toBe('Food & Drinks');
    });

    it('should return undefined for non-existent ID', () => {
      const category = service.getCategoryById('non-existent');
      expect(category).toBeUndefined();
    });
  });

  describe('getCategoriesByType', () => {
    beforeEach(() => {
      service.categories.set(createCategoryHierarchy());
    });

    it('should return expense categories', () => {
      const categories = service.getCategoriesByType('expense');
      expect(categories.length).toBeGreaterThan(0);
      categories.forEach(c => {
        expect(c.type === 'expense' || c.type === 'both').toBe(true);
      });
    });

    it('should return income categories', () => {
      const categories = service.getCategoriesByType('income');
      expect(categories.length).toBeGreaterThan(0);
      categories.forEach(c => {
        expect(c.type === 'income' || c.type === 'both').toBe(true);
      });
    });

    it('should include "both" type in expense results', () => {
      const categories = service.getCategoriesByType('expense');
      const bothCategory = categories.find(c => c.type === 'both');
      expect(bothCategory).toBeDefined();
    });

    it('should include "both" type in income results', () => {
      const categories = service.getCategoriesByType('income');
      const bothCategory = categories.find(c => c.type === 'both');
      expect(bothCategory).toBeDefined();
    });

    it('should only return active categories', () => {
      const categories = service.getCategoriesByType('expense');
      categories.forEach(c => {
        expect(c.isActive).toBe(true);
      });
    });
  });

  describe('getParentCategories', () => {
    beforeEach(() => {
      service.categories.set(createCategoryHierarchy());
    });

    it('should return only parent categories (no parentId)', () => {
      const parents = service.getParentCategories();
      parents.forEach(c => {
        expect(c.parentId).toBeUndefined();
      });
    });

    it('should filter by type when provided', () => {
      const expenseParents = service.getParentCategories('expense');
      expenseParents.forEach(c => {
        expect(c.type === 'expense' || c.type === 'both').toBe(true);
      });
    });
  });

  describe('getSubcategories', () => {
    beforeEach(() => {
      service.categories.set(createCategoryHierarchy());
    });

    it('should return children of parent', () => {
      const children = service.getSubcategories('food');
      expect(children.length).toBeGreaterThan(0);
      children.forEach(c => {
        expect(c.parentId).toBe('food');
      });
    });

    it('should return empty array for category with no children', () => {
      const children = service.getSubcategories('food_restaurants');
      expect(children.length).toBe(0);
    });

    it('should only return active subcategories', () => {
      const children = service.getSubcategories('food');
      children.forEach(c => {
        expect(c.isActive).toBe(true);
      });
    });
  });

  describe('getExpenseCategoryGroups', () => {
    it('should return default expense groups', () => {
      const groups = service.getExpenseCategoryGroups();
      expect(groups).toBe(DEFAULT_EXPENSE_GROUPS);
      expect(groups.length).toBeGreaterThan(0);
    });

    it('should have expense type for all groups', () => {
      const groups = service.getExpenseCategoryGroups();
      groups.forEach(g => {
        expect(g.type).toBe('expense');
      });
    });
  });

  describe('getIncomeCategoryGroups', () => {
    it('should return default income groups', () => {
      const groups = service.getIncomeCategoryGroups();
      expect(groups).toBe(DEFAULT_INCOME_GROUPS);
      expect(groups.length).toBeGreaterThan(0);
    });

    it('should have income type for all groups', () => {
      const groups = service.getIncomeCategoryGroups();
      groups.forEach(g => {
        expect(g.type).toBe('income');
      });
    });
  });

  describe('addCategory', () => {
    function writtenPayload(): Record<string, unknown> {
      const call = mockFirestore.addDocumentSpy.mostRecent();
      expect(call).toBeDefined();
      return call!.args[1] as Record<string, unknown>;
    }

    // The dialog returns only name, icon and colour, so parentId arrives
    // undefined on every real call. ignoreUndefinedProperties is deliberately
    // off, so writing the key at all fails the whole document — which is why
    // "Add Category" never worked. The mock accepts anything, so assert on the
    // payload rather than on the call.
    it('writes no undefined values when the optional parent is omitted', async () => {
      await service.addCategory({
        name: 'Bouldering',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense'
      });

      expect(findSerializationIssues(writtenPayload())).toEqual([]);
    });

    it('omits the parentId key entirely rather than sending undefined', async () => {
      await service.addCategory({
        name: 'Bouldering',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense'
      });

      expect('parentId' in writtenPayload()).toBeFalse();
    });

    it('keeps parentId when the caller supplies one', async () => {
      await service.addCategory({
        name: 'Indoor',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense',
        parentId: 'sports'
      });

      expect(writtenPayload()['parentId']).toBe('sports');
    });

    it('writes the category under the signed-in account', async () => {
      await service.addCategory({
        name: 'Bouldering',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense'
      });

      const call = mockFirestore.addDocumentSpy.mostRecent();
      expect(call!.args[0]).toBe('users/test-user-123/categories');
      expect(writtenPayload()['isDefault']).toBeFalse();
    });

    it('rejects when nobody is signed in', async () => {
      mockAuth.setAuthenticated(false);

      await expectAsync(service.addCategory({
        name: 'Bouldering',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense'
      })).toBeRejected();
    });

    it('writes the order the caller names', async () => {
      // A restore knows where each category sat. maxOrder reads the in-memory
      // signal, so a restore loop that let this compute would not merely
      // reshuffle the list — several categories would be handed the same
      // number before any of them reached the signal.
      service.categories.set([createCategory({ id: 'c1', order: 1 })]);

      await service.addCategory(
        { name: 'Bouldering', icon: 'sports_handball', color: '#ff8800', type: 'expense' },
        { id: 'cat-9', order: 7 }
      );

      const call = mockFirestore.setDocumentSpy.mostRecent();
      expect(call!.args[0]).toBe('users/test-user-123/categories/cat-9');
      expect((call!.args[1] as Record<string, unknown>)['order']).toBe(7);
    });

    it('accepts a zeroth position rather than reading it as "none named"', async () => {
      await service.addCategory(
        { name: 'Bouldering', icon: 'sports_handball', color: '#ff8800', type: 'expense' },
        { id: 'cat-0', order: 0 }
      );

      expect((mockFirestore.setDocumentSpy.mostRecent()!.args[1] as Record<string, unknown>)['order'])
        .toBe(0);
    });

    it('still computes maxOrder + 1 when none is named', async () => {
      service.categories.set([
        createCategory({ id: 'c1', order: 3 }),
        createCategory({ id: 'c2', order: 9 }),
      ]);

      await service.addCategory({
        name: 'Bouldering', icon: 'sports_handball', color: '#ff8800', type: 'expense',
      });

      expect(writtenPayload()['order']).toBe(10);
    });
  });

  describe('deleteAll', () => {
    const path = 'users/test-user-123/categories';

    it('deletes every document and resets the signal', async () => {
      const rows = [createCategory({ id: 'c1' }), createCategory({ id: 'c2' })];
      mockFirestore.setMockCollection(path, rows);
      service.categories.set(rows);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestore.deleteDocumentSpy.calls.map(c => c.args[0]))
        .toEqual([`${path}/c1`, `${path}/c2`]);
      expect(service.categories()).toEqual([]);
    });

    it('enumerates the collection rather than the signal', async () => {
      const rows = [createCategory({ id: 'c1' }), createCategory({ id: 'c2' })];
      mockFirestore.setMockCollection(path, rows);
      service.categories.set([rows[0]]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(2);
    });
  });

  describe('exportAll', () => {
    const path = 'users/test-user-123/categories';

    it('reads the server, not the cache', async () => {
      const rows = [createCategory({ id: 'c1' }), createCategory({ id: 'c2' })];
      mockFirestore.setMockCollection(path, rows);

      const result = await service.exportAll();

      expect(result).toEqual(rows);
      expect(mockFirestore.getCollectionFromServerSpy.calls.map(c => c.args)).toEqual([
        [path, { orderBy: [{ field: 'order', direction: 'asc' }] }]
      ]);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });
  });
  describe('loadCategories', () => {
    const path = 'users/test-user-123/categories';

    /**
     * Subscribe-and-capture rather than firstValueFrom: ADR 0139 made
     * awaiting a listener a house defect, and loadCategories returns one.
     * The mock's stream is synchronous, so the first emission is already in
     * hand when subscribe returns.
     */
    function firstEmission(): ReturnType<typeof createCategory>[] {
      let seen: ReturnType<typeof createCategory>[] | undefined;
      service.loadCategories().subscribe(value => (seen ??= value));
      expect(seen).withContext('the stream emitted synchronously').toBeDefined();
      return seen!;
    }

    it('answers an empty list without subscribing when nobody is signed in', () => {
      mockAuth.setMockUser(null);

      const emitted = firstEmission();

      expect(emitted).toEqual([]);
      expect(mockFirestore.subscribeToCollectionSpy.calls.length).toBe(0);
    });

    it('merges the stored categories over the built-ins and caches the result', () => {
      // A stored row carrying a built-in's own id replaces that built-in
      // rather than doubling it — that is what `isDefault` rows are for.
      const builtIn = service.getDefaultCategories()[0];
      const overridden = createCategory({
        id: builtIn.id, name: 'My Groceries', order: builtIn.order, isDefault: false,
      });
      const custom = createCategory({ id: 'custom-1', name: 'Hobbies', order: 9999 });
      mockFirestore.setMockCollection(path, [overridden, custom]);

      const emitted = firstEmission();

      expect(emitted.filter(c => c.id === builtIn.id).length).toBe(1);
      expect(emitted.find(c => c.id === builtIn.id)?.name).toBe('My Groceries');
      expect(emitted.find(c => c.id === 'custom-1')).toBeDefined();
      // The subscription's merge is what fills the signal every consumer reads.
      expect(service.categories()).toEqual(emitted);
    });

    it('orders the merged list by order, not by which side it came from', () => {
      mockFirestore.setMockCollection(path, [
        createCategory({ id: 'late', name: 'Late', order: 99999 }),
        createCategory({ id: 'early', name: 'Early', order: -1 }),
      ]);

      const emitted = firstEmission();

      expect(emitted[0].id).toBe('early');
      expect(emitted[emitted.length - 1].id).toBe('late');
      expect(emitted.map(c => c.order)).toEqual([...emitted.map(c => c.order)].sort((a, b) => a - b));
    });

    it('reads in stored order', () => {
      mockFirestore.setMockCollection(path, []);

      firstEmission();

      expect(mockFirestore.subscribeToCollectionSpy.calls[0].args[0]).toBe(path);
      expect(mockFirestore.subscribeToCollectionSpy.calls[0].args[1])
        .toEqual({ orderBy: [{ field: 'order', direction: 'asc' }] });
    });
  });

  describe('deleting a category', () => {
    const path = 'users/test-user-123/categories';

    it('soft-deletes by clearing isActive, leaving the row in place', async () => {
      await service.deleteCategory('cat-1');

      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(1);
      expect(mockFirestore.updateDocumentSpy.calls[0].args[0]).toBe(`${path}/cat-1`);
      expect(mockFirestore.updateDocumentSpy.calls[0].args[1]).toEqual({ isActive: false });
      expect(mockFirestore.deleteDocumentSpy.calls.length)
        .withContext('a soft delete must not remove the document')
        .toBe(0);
    });

    it('hard-deletes the document on the permanent path', async () => {
      await service.permanentlyDeleteCategory('cat-1');

      expect(mockFirestore.deleteDocumentSpy.calls.map(c => c.args[0])).toEqual([`${path}/cat-1`]);
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
    });

    it('lowers the loading flag even when the write rejects', async () => {
      // The flag is raised before the write and lowered in a finally: a
      // rejected delete that left it raised would freeze the manager's
      // spinner for the rest of the session.
      spyOn(mockFirestore, 'updateDocument').and.rejectWith(new Error('denied'));

      await expectAsync(service.deleteCategory('cat-1')).toBeRejected();

      expect(service.isLoading()).toBeFalse();
    });

    it('lowers the loading flag even when the hard delete rejects', async () => {
      spyOn(mockFirestore, 'deleteDocument').and.rejectWith(new Error('denied'));

      await expectAsync(service.permanentlyDeleteCategory('cat-1')).toBeRejected();

      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('initializeDefaultCategories', () => {
    const path = 'users/test-user-123/categories';

    it('writes one document per built-in, each at its own id and owned', async () => {
      mockFirestore.setMockCollection(path, []);

      await service.initializeDefaultCategories();

      const writes = mockFirestore.setDocumentSpy.calls;
      expect(writes.length).toBe(service.getDefaultCategories().length);
      const first = service.getDefaultCategories()[0];
      const written = writes.find(c => c.args[0] === `${path}/${first.id}`);
      expect(written).toBeDefined();
      expect((written!.args[1] as { userId: string }).userId).toBe('test-user-123');
    });

    it('writes nothing into an account that already has categories', async () => {
      mockFirestore.setMockCollection(path, [createCategory({ id: 'existing' })]);

      await service.initializeDefaultCategories();

      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
    });

    it('writes nothing when nobody is signed in', async () => {
      mockAuth.setMockUser(null);

      await service.initializeDefaultCategories();

      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });
  });
});

/**
 * A shared row's household copy shows its category's name, icon and colour,
 * and the category's parent decides the built-in the copy counts under in a
 * household budget. A category write that sets any of those is followed the
 * way a row's write is: issued, then the copies owed, then awaited. Each live
 * household in the account's index is marked for a full pass
 * (ledger-journal.ts), and the category is handed to
 * LedgerShareService.reprojectCategory, which rewrites each copy that
 * differs; its reads see the pending write, offline included. The sharing
 * code is reached only by a dynamic import, and only for an account whose
 * index names a live household.
 */
describe('CategoryService and the household copies', () => {
  const UID = 'test-user-123';
  const INDEX = `users/${UID}/households`;
  const CATEGORIES = `users/${UID}/categories`;
  const G1 = new Timestamp(1_790_000_000, 123_456_000);

  /** The service's one way to the sharing code, a dynamic import. */
  interface SharingLoader { ledgerShare: () => Promise<LedgerShareService> }

  /** A category write the spec lands or refuses by hand. */
  interface HeldWrite {
    /** The path of each write issued, in order. */
    issued: string[];
    land: () => void;
    refuse: (error: Error) => void;
  }

  let service: CategoryService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let ledger: LedgerShareService;
  let load: jasmine.Spy;
  let reproject: jasmine.Spy;
  let warn: jasmine.Spy;
  let online: boolean;
  /** Each category id handed to reprojectCategory, in order. */
  let reprojected: string[];
  /** The households marked for a full pass as each reprojection started. */
  let markedAtEachPass: string[][];

  const mine = (overrides: Partial<Category> = {}): Category =>
    createCategory({ id: 'custom1', userId: UID, name: 'Bouldering', isDefault: false, order: 90, ...overrides });

  /** The account's index: one live membership, and one that has ended. */
  function seedIndex(): void {
    mockFirestore.setMockCollection(INDEX, [
      { id: 'h1', since: G1, role: 'member', name: 'Home', joinedAt: G1 },
      { id: 'h2', since: G1, role: 'member', name: 'Old flat', joinedAt: G1, endedAt: G1 }
    ]);
  }

  /** The households this device owes a full pass. */
  const marked = () => Object.keys(readLedgerJournal(UID).full);

  /** Holds every write of one kind pending until the spec settles it. */
  function hold(method: 'updateDocument' | 'setDocument'): HeldWrite {
    const held: HeldWrite = { issued: [], land: () => undefined, refuse: () => undefined };
    const writes = mockFirestore as unknown as Record<typeof method, (path: string) => Promise<void>>;
    spyOn(writes, method).and.callFake((path: string) => {
      held.issued.push(path);
      return new Promise<void>((resolve, reject) => {
        held.land = resolve;
        held.refuse = reject;
      });
    });
    return held;
  }

  /** Lets the work a write leaves running reach its next step. */
  const settle = () => new Promise<void>(resolve => setTimeout(resolve));

  /** Waits for a condition the unawaited work meets, failing after a bound. */
  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 50 && !condition(); i++) await settle();
    if (!condition()) fail(`timed out waiting for ${what}`);
  }

  /** Waits long enough for any work a write left running to have loaded the sharing code. */
  async function drained(): Promise<void> {
    for (let i = 0; i < 5; i++) await settle();
  }

  beforeEach(() => {
    online = true;
    TestBed.configureTestingModule({
      providers: [
        CategoryService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService },
        { provide: PwaService, useValue: { isOnline: () => online } }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    service = TestBed.inject(CategoryService);
    ledger = TestBed.inject(LedgerShareService);
    load = spyOn(service as unknown as SharingLoader, 'ledgerShare').and.callThrough();
    reprojected = [];
    markedAtEachPass = [];
    reproject = spyOn(ledger, 'reprojectCategory').and.callFake(async (id: string) => {
      reprojected.push(id);
      markedAtEachPass.push(marked());
    });
    warn = spyOn(console, 'warn');
    clearLedgerDeviceState(UID);
    mockAuth.setAuthenticated(true);
    service.categories.set([...service.getDefaultCategories(), mine()]);
  });

  afterEach(() => {
    clearLedgerDeviceState(UID);
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
  });

  describe('with a household membership', () => {
    beforeEach(() => seedIndex());

    it('reprojects a custom category from the edit it has issued', async () => {
      await service.updateCategory('custom1', { name: 'Climbing', icon: 'terrain', color: '#00aa88' });
      await until(() => reprojected.length > 0, 'the reprojection');

      expect(reprojected).toEqual(['custom1']);
      // The write first, then the index, then the code: the reads the
      // reprojection makes see the write, landed or pending.
      const order = mockFirestore.callLog.map(call => `${call.method} ${call.path}`);
      expect(order.indexOf(`updateDocument ${CATEGORIES}/custom1`))
        .toBeLessThan(order.indexOf(`getCollection ${INDEX}`));
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('reprojects a built-in from the override its first edit issues', async () => {
      await service.updateCategory('food_groceries', { name: 'Fancy Groceries' });
      await until(() => reprojected.length > 0, 'the reprojection');

      expect(mockFirestore.setDocumentSpy.calls.map(call => call.args[0])).toEqual([`${CATEGORIES}/food_groceries`]);
      expect(reprojected).toEqual(['food_groceries']);
    });

    for (const field of ['name', 'icon', 'color'] as const) {
      it(`reprojects when the edit sets the ${field} alone`, async () => {
        await service.updateCategory('custom1', { [field]: 'changed' });
        await until(() => reprojected.length > 0, 'the reprojection');

        expect(reprojected).toEqual(['custom1']);
      });
    }

    it('marks each live household for a full pass before the copies are rewritten', async () => {
      await service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length > 0, 'the reprojection');

      // The mark outlives the page: the next sweep diffs the household in
      // full and clears it, whatever became of the rewrite. An ended
      // membership is owed nothing.
      expect(markedAtEachPass).toEqual([['h1']]);
      expect(marked()).toEqual(['h1']);
    });

    it('marks each live household again once the edit lands, for a full pass begun before it that did not see it', async () => {
      const write = hold('updateDocument');
      const markOf = () => readLedgerJournal(UID).full['h1'];

      const updating = service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length > 0, 'the reprojection');
      const first = markOf();
      expect(first).toEqual(jasmine.any(Number));
      write.land();
      await updating;
      await until(() => (markOf() ?? 0) > first, 'the mark made once the edit landed');

      expect(marked()).toEqual(['h1']);
    });

    it('does not mark again for an edit that is refused', async () => {
      const write = hold('updateDocument');
      const markOf = () => readLedgerJournal(UID).full['h1'];
      let finishFirst!: () => void;
      reproject.and.callFake((id: string) => {
        reprojected.push(id);
        return reprojected.length === 1
          ? new Promise<void>(resolve => { finishFirst = resolve; })
          : Promise.resolve();
      });

      const updating = service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length === 1, 'the first pass');
      const first = markOf();
      write.refuse(new Error('permission-denied'));
      await expectAsync(updating).toBeRejectedWithError('permission-denied');
      await drained();

      // The first pass is still running, so the second has not marked yet either.
      expect(markOf()).toBe(first);
      finishFirst();
      await until(() => reprojected.length === 2, 'the second pass');
    });

    it('reprojects the category when its parent changes, and owes the categories below it a full pass', async () => {
      // A new parent moves the rows of the categories below it to another
      // built-in too. reprojectCategory rewrites the category's own; the
      // full pass the mark owes rewrites theirs (no form edits a parent: it
      // sets the name, icon and colour).
      service.categories.set([
        ...service.getDefaultCategories(),
        mine(),
        mine({ id: 'custom2', name: 'Indoor', parentId: 'custom1' })
      ]);

      await service.updateCategory('custom1', { parentId: 'entertainment' });
      await until(() => reprojected.length > 0, 'the reprojection');
      await drained();

      expect(reprojected).toEqual(['custom1']);
      expect(marked()).toEqual(['h1']);
    });

    it('leaves the copies alone for an edit that sets nothing a copy shows', async () => {
      await service.updateCategory('custom1', { order: 3 });
      await service.updateCategory('custom1', { isActive: true });
      await drained();

      expect(load).not.toHaveBeenCalled();
      expect(mockFirestore.getCollectionSpy.calls.map(call => call.args[0])).not.toContain(INDEX);
      expect(marked()).toEqual([]);
    });

    it('leaves the copies alone on a soft delete, which a copy does not show', async () => {
      // The projection reads a category whatever its active flag (the merged
      // list keeps a soft-deleted one), so every copy stays equal.
      await service.deleteCategory('custom1');
      await drained();

      expect(mockFirestore.updateDocumentSpy.calls.map(call => call.args[1])).toEqual([{ isActive: false }]);
      expect(load).not.toHaveBeenCalled();
      expect(reproject).not.toHaveBeenCalled();
      expect(marked()).toEqual([]);
    });

    it('leaves the copies as they are on a permanent delete', async () => {
      // No cascade: each copy keeps the snapshot it holds until its row is
      // next projected (an edit of the row, the journal's repair or the
      // weekly full pass), which shows it under the built-in it counts under.
      await service.permanentlyDeleteCategory('custom1');
      await drained();

      expect(load).not.toHaveBeenCalled();
      expect(reproject).not.toHaveBeenCalled();
      expect(marked()).toEqual([]);
    });

    it('leaves the copies alone on a reorder, built-ins materialized included', async () => {
      await service.reorderCategories(['food_groceries', 'custom1']);
      await drained();

      expect(mockFirestore.setDocumentSpy.calls.length).toBe(1);
      expect(load).not.toHaveBeenCalled();
      expect(marked()).toEqual([]);
    });

    it('resolves the edit without waiting on the copies', async () => {
      let finish!: () => void;
      reproject.and.callFake((id: string) => {
        reprojected.push(id);
        return new Promise<void>(resolve => { finish = resolve; });
      });

      await service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length > 0, 'the reprojection');

      expect(service.isLoading()).toBeFalse();
      finish();
    });

    it('rewrites the copies while the edit waits to land, and resolves once it lands', async () => {
      const write = hold('updateDocument');
      const issuedAtPass: string[][] = [];
      reproject.and.callFake(async (id: string) => {
        reprojected.push(id);
        issuedAtPass.push([...write.issued]);
      });
      let resolved = false;

      const updating = service.updateCategory('custom1', { name: 'Climbing' }).then(() => { resolved = true; });
      await until(() => reprojected.length > 0, 'the reprojection');

      // Issue, follow, await: the copy writes queue behind the category's.
      expect(issuedAtPass).toEqual([[`${CATEGORIES}/custom1`]]);
      expect(resolved).toBeFalse();
      expect(service.isLoading()).toBeTrue();
      write.land();
      await updating;
      expect(resolved).toBeTrue();
      expect(service.isLoading()).toBeFalse();
    });

    it('owes and rewrites the copies offline, for a custom category and a built-in, before either edit lands', async () => {
      online = false;
      const update = hold('updateDocument');
      const set = hold('setDocument');

      void service.updateCategory('custom1', { name: 'Climbing' });
      void service.updateCategory('food_groceries', { color: '#123456' });
      await until(() => reprojected.length === 2, 'both reprojections');

      // Neither write has landed. A page closed at this point leaves the
      // full pass owed, and the copy writes already issued sit in the
      // persistent queue behind the category writes.
      expect(update.issued).toEqual([`${CATEGORIES}/custom1`]);
      expect(set.issued).toEqual([`${CATEGORIES}/food_groceries`]);
      expect([...reprojected].sort()).toEqual(['custom1', 'food_groceries']);
      expect(marked()).toEqual(['h1']);
    });

    it('rewrites the copies again, once the first pass is done, when the edit is refused', async () => {
      const write = hold('updateDocument');
      let finishFirst!: () => void;
      reproject.and.callFake((id: string) => {
        reprojected.push(id);
        return reprojected.length === 1
          ? new Promise<void>(resolve => { finishFirst = resolve; })
          : Promise.resolve();
      });

      const updating = service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length === 1, 'the first pass');
      write.refuse(new Error('permission-denied'));
      await expectAsync(updating).toBeRejectedWithError('permission-denied');
      await drained();

      // A refused edit is rolled back in the cache, and the first pass may
      // have rewritten copies from it: the second waits for it, then
      // projects them from the category as it stands.
      expect(reprojected).toEqual(['custom1']);
      finishFirst();
      await until(() => reprojected.length === 2, 'the second pass');
      expect(reprojected).toEqual(['custom1', 'custom1']);
      expect(marked()).toEqual(['h1']);
      expect(service.isLoading()).toBeFalse();
    });

    it('keeps the edit and the mark when the copies are not rewritten, and says so', async () => {
      reproject.and.rejectWith(new Error('unavailable'));

      await expectAsync(service.updateCategory('custom1', { name: 'Climbing' })).toBeResolved();
      await until(() => warn.calls.count() > 0, 'the warning');

      expect(warn.calls.mostRecent().args[0]).toMatch(/^\[Categories\] /);
      expect(marked()).toEqual(['h1']);
    });

    it('keeps the edit and the mark when the sharing code does not load', async () => {
      load.and.rejectWith(new Error('chunk load failed'));

      await expectAsync(service.updateCategory('custom1', { name: 'Climbing' })).toBeResolved();
      await until(() => warn.calls.count() > 0, 'the warning');
      await until(() => marked().length > 0, 'the mark');

      expect(warn.calls.mostRecent().args[0]).toMatch(/^\[Categories\] /);
      expect(reproject).not.toHaveBeenCalled();
      expect(marked()).toEqual(['h1']);
    });

    it('keeps the edit when the index cannot be read', async () => {
      const read = mockFirestore.getCollection.bind(mockFirestore);
      spyOn(mockFirestore, 'getCollection').and.callFake(<T>(path: string, options?: unknown) =>
        path === INDEX ? Promise.reject(new Error('unavailable')) : read<T>(path, options));

      await expectAsync(service.updateCategory('custom1', { name: 'Climbing' })).toBeResolved();
      await until(() => warn.calls.count() > 0, 'the warning');

      expect(warn.calls.mostRecent().args[0]).toMatch(/^\[Categories\] /);
      expect(load).not.toHaveBeenCalled();
    });

    it('reprojects on each edit that sets something a copy shows', async () => {
      await service.updateCategory('custom1', { name: 'Climbing' });
      await until(() => reprojected.length === 1, 'the first reprojection');
      await service.updateCategory('food_groceries', { color: '#123456' });
      await until(() => reprojected.length === 2, 'the second reprojection');

      expect(reprojected).toEqual(['custom1', 'food_groceries']);
    });
  });

  describe('without a live household membership', () => {
    it('never loads the sharing code for an account whose index is empty', async () => {
      mockFirestore.setMockCollection(INDEX, []);

      await service.updateCategory('custom1', { name: 'Climbing' });
      await service.updateCategory('food_groceries', { name: 'Fancy Groceries' });
      await drained();

      expect(mockFirestore.getCollectionSpy.calls.map(call => call.args[0])).toContain(INDEX);
      expect(load).not.toHaveBeenCalled();
      expect(reproject).not.toHaveBeenCalled();
      expect(marked()).toEqual([]);
    });

    it('neither loads it nor marks a household for an account whose memberships have all ended', async () => {
      // An ended membership's copies go with it (cleanupMembership), so none
      // is rewritten and no sweep is owed one.
      mockFirestore.setMockCollection(INDEX, [
        { id: 'h2', since: G1, role: 'member', name: 'Old flat', joinedAt: G1, endedAt: G1 }
      ]);

      await service.updateCategory('custom1', { name: 'Climbing' });
      await drained();

      expect(load).not.toHaveBeenCalled();
      expect(reproject).not.toHaveBeenCalled();
      expect(marked()).toEqual([]);
    });
  });
});
