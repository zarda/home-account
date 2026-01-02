import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
  Category,
  CategoryGroup,
  CreateCategoryDTO,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS
} from '../../models';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  // Signals
  categories = signal<Category[]>([]);
  isLoading = signal<boolean>(false);

  // Computed signals
  expenseCategories = computed(() =>
    this.categories().filter(c => c.type !== 'income' && c.isActive)
  );

  incomeCategories = computed(() =>
    this.categories().filter(c => c.type !== 'expense' && c.isActive)
  );

  activeCategories = computed(() =>
    this.categories().filter(c => c.isActive)
  );

  private get userCategoriesPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/categories`;
  }

  // Load all categories (user + defaults)
  loadCategories(): Observable<Category[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Category>(
      this.userCategoriesPath,
      { orderBy: [{ field: 'order', direction: 'asc' }] }
    ).pipe(
      map(userCategories => {
        // Merge user categories with defaults
        const defaultCategories = this.generateDefaultCategories();
        const mergedCategories = this.mergeCategories(defaultCategories, userCategories);
        this.categories.set(mergedCategories);
        return mergedCategories;
      })
    );
  }

  // Get default system categories
  getDefaultCategories(): Category[] {
    return this.generateDefaultCategories();
  }

  // Get category by ID
  getCategoryById(id: string): Category | undefined {
    return this.categories().find(c => c.id === id);
  }

  // Get categories by type
  getCategoriesByType(type: 'income' | 'expense'): Category[] {
    return this.categories().filter(c =>
      c.isActive && (c.type === type || c.type === 'both')
    );
  }

  // Add a custom category
  async addCategory(data: CreateCategoryDTO): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const maxOrder = Math.max(
        0,
        ...this.categories().map(c => c.order)
      );

      const category: Omit<Category, 'id'> = {
        userId,
        name: data.name,
        icon: data.icon,
        color: data.color,
        type: data.type,
        parentId: data.parentId,
        order: maxOrder + 1,
        isActive: true,
        isDefault: false
      };

      return await this.firestoreService.addDocument(
        this.userCategoriesPath,
        category
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing category
  async updateCategory(id: string, data: Partial<Category>): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.updateDocument(
        `${this.userCategoriesPath}/${id}`,
        data
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a category (soft delete - set isActive to false)
  async deleteCategory(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.updateDocument(
        `${this.userCategoriesPath}/${id}`,
        { isActive: false }
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Hard delete a category
  async permanentlyDeleteCategory(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userCategoriesPath}/${id}`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Reorder categories
  async reorderCategories(categoryIds: string[]): Promise<void> {
    this.isLoading.set(true);

    try {
      const updates = categoryIds.map((id, index) =>
        this.firestoreService.updateDocument(
          `${this.userCategoriesPath}/${id}`,
          { order: index }
        )
      );

      await Promise.all(updates);
    } finally {
      this.isLoading.set(false);
    }
  }

  // Get expense category groups (for UI display)
  getExpenseCategoryGroups(): CategoryGroup[] {
    return DEFAULT_EXPENSE_GROUPS;
  }

  // Get income category groups (for UI display)
  getIncomeCategoryGroups(): CategoryGroup[] {
    return DEFAULT_INCOME_GROUPS;
  }

  // Initialize default categories for a new user
  async initializeDefaultCategories(): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    const defaultCategories = this.generateDefaultCategories();

    // Check if user already has categories
    const existingCategories = await this.firestoreService.getCollection<Category>(
      this.userCategoriesPath
    );

    if (existingCategories.length > 0) {
      return; // Already initialized
    }

    // Create default categories for user
    const createPromises = defaultCategories.map(category =>
      this.firestoreService.setDocument(
        `${this.userCategoriesPath}/${category.id}`,
        { ...category, userId }
      )
    );

    await Promise.all(createPromises);
  }

  // Generate flat list of default categories from groups
  private generateDefaultCategories(): Category[] {
    const categories: Category[] = [];
    let order = 0;

    // Helper to extract key name from translation key for ID generation
    const getKeyName = (nameKey: string): string => {
      const parts = nameKey.split('.');
      return parts[parts.length - 1];
    };

    // Process expense groups
    for (const group of DEFAULT_EXPENSE_GROUPS) {
      // Add group as parent category
      categories.push({
        id: group.id,
        userId: null,
        name: group.nameKey,  // Store translation key as name
        icon: group.icon,
        color: group.color,
        type: 'expense',
        order: order++,
        isActive: true,
        isDefault: true
      });

      // Add subcategories
      for (const item of group.categories) {
        const keyName = getKeyName(item.nameKey);
        categories.push({
          id: `${group.id}_${keyName}`,
          userId: null,
          name: item.nameKey,  // Store translation key as name
          icon: item.icon,
          color: group.color,
          type: 'expense',
          parentId: group.id,
          order: order++,
          isActive: true,
          isDefault: true
        });
      }
    }

    // Process income groups
    for (const group of DEFAULT_INCOME_GROUPS) {
      // Add group as parent category
      categories.push({
        id: group.id,
        userId: null,
        name: group.nameKey,  // Store translation key as name
        icon: group.icon,
        color: group.color,
        type: 'income',
        order: order++,
        isActive: true,
        isDefault: true
      });

      // Add subcategories
      for (const item of group.categories) {
        const keyName = getKeyName(item.nameKey);
        categories.push({
          id: `${group.id}_${keyName}`,
          userId: null,
          name: item.nameKey,  // Store translation key as name
          icon: item.icon,
          color: group.color,
          type: 'income',
          parentId: group.id,
          order: order++,
          isActive: true,
          isDefault: true
        });
      }
    }

    return categories;
  }

  // Merge default categories with user custom categories
  private mergeCategories(
    defaults: Category[],
    userCategories: Category[]
  ): Category[] {
    const userCategoryIds = new Set(userCategories.map(c => c.id));

    // Filter out defaults that have been overridden by user
    const filteredDefaults = defaults.filter(d => !userCategoryIds.has(d.id));

    // Combine and sort by order
    return [...filteredDefaults, ...userCategories].sort(
      (a, b) => a.order - b.order
    );
  }

  // Get parent categories (groups)
  getParentCategories(type?: 'income' | 'expense'): Category[] {
    let categories = this.categories().filter(c => !c.parentId && c.isActive);

    if (type) {
      categories = categories.filter(c => c.type === type || c.type === 'both');
    }

    return categories;
  }

  // Get subcategories by parent ID
  getSubcategories(parentId: string): Category[] {
    return this.categories().filter(
      c => c.parentId === parentId && c.isActive
    );
  }
}
