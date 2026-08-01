import { TestBed } from '@angular/core/testing';
import { CategoryService } from './category.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import { createCategory, createCategoryHierarchy } from './testing/test-data';
import { findSerializationIssues } from '../utils/firestore-value.utils';
import { DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../models';

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
  });
});
