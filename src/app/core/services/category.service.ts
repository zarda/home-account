import { Injectable, Injector, effect, inject, signal, computed } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import type { LedgerShareService } from './ledger-share.service';
import {
  Category,
  CategoryGroup,
  CreateCategoryDTO,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
  householdIndexPath
} from '../../models';
import type { LedgerCategorySnapshot } from '../../models';
import { defaultCategories, mergeCategories } from '../utils/category-merge.utils';
import type { HouseholdIndexData } from '../utils/household-index.utils';

/**
 * What a shared row's household copy takes from its category: the snapshot
 * it shows, and the parent that decides the built-in it counts under
 * (ledger-projection.utils.ts). Keyed by the snapshot's fields, so one added
 * there does not compile until it is named here. A write that sets none of
 * them leaves every copy as it was.
 */
const SHOWN_ON_COPIES = { name: true, icon: true, color: true, parentId: true } as const satisfies
  Record<keyof LedgerCategorySnapshot | 'parentId', true>;

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private injector = inject(Injector);

  // Signals
  categories = signal<Category[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.categories.set([]);
      }
    });
  }

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
        const mergedCategories = mergeCategories(defaultCategories(), userCategories);
        this.categories.set(mergedCategories);
        return mergedCategories;
      })
    );
  }

  // Get default system categories
  getDefaultCategories(): Category[] {
    return defaultCategories();
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

  /**
   * One-shot read of the account's own categories, for the backup export.
   * Server-only: cache-served categories are safe for the app but not for a
   * backup, which must reflect what is actually stored.
   *
   * Not the `categories` signal: that holds the built-in defaults merged in,
   * and only whatever a subscription happened to deliver.
   */
  async exportAll(): Promise<Category[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollectionFromServer<Category>(
      this.userCategoriesPath, { orderBy: [{ field: 'order', direction: 'asc' }] });
  }

  /**
   * Remove every stored category, for account deletion. Enumerates the
   * collection rather than the signal — the signal only holds what a
   * subscription happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<Category>(this.userCategoriesPath);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.userCategoriesPath}/${row.id}`);
    }
    this.categories.set([]);
    return rows.length;
  }

  /**
   * Add a custom category.
   *
   * `options.id` writes at a caller-chosen id instead of an auto-generated
   * one, so restoring a backup twice overwrites rather than duplicating.
   * `options.isActive` carries a restore's soft-deleted category back as
   * deleted; without it a restore returns every category the user removed to
   * the pickers. `options.order` carries the position the file recorded — and
   * lives here rather than on CreateCategoryDTO, which is the create form's
   * shape and has no business naming a position.
   *
   * `maxOrder` reads the in-memory signal, which is safe for the one-at-a-time
   * create form and unsafe for a loop: mid-restore the signal holds whatever
   * the subscription has delivered so far, so a restore that let every
   * category compute its own position would not merely reshuffle the list — it
   * could hand several of them the same number.
   */
  async addCategory(
    data: CreateCategoryDTO,
    options?: { id?: string; isActive?: boolean; order?: number }
  ): Promise<string> {
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
        // Only include optional fields if they have values (Firestore rejects undefined)
        ...(data.parentId ? { parentId: data.parentId } : {}),
        // `typeof`, not `??`: position zero is a position.
        order: typeof options?.order === 'number' ? options.order : maxOrder + 1,
        isActive: options?.isActive ?? true,
        isDefault: false
      };

      if (options?.id) {
        await this.firestoreService.setDocument(
          `${this.userCategoriesPath}/${options.id}`,
          category
        );
        return options.id;
      }

      return await this.firestoreService.addDocument(
        this.userCategoriesPath,
        category
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Update an existing category. A shared row's write is followed by its
   * copies' (issue, follow, await), and so is this: the write is issued,
   * the copies are handed on (reprojectShared) before it is awaited, and the
   * edit resolves once the write lands. Offline the write waits in the
   * persistent queue and the copy writes queue behind it.
   *
   * Once the write lands, each live household is marked for a full pass
   * again (markSharesAgain): a full pass that read the categories before the
   * write reached the server began before that mark, so its end leaves it.
   */
  async updateCategory(id: string, data: Partial<Category>): Promise<void> {
    this.isLoading.set(true);

    try {
      const write = this.materializeDefaultWith(id, data)
        ?? this.firestoreService.updateDocument(`${this.userCategoriesPath}/${id}`, data);
      const pass = this.reprojectShared(id, data);
      try {
        await write;
      } catch (error) {
        // Refused, the edit is rolled back in the cache after the first pass
        // may have projected copies from it. A second pass, once the first
        // is done, projects them from the category as it stands.
        void pass?.then(() => this.reprojectShared(id, data));
        throw error;
      }
      if (pass) void this.markSharesAgain();
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Hands a category write that sets something a copy shows to the copies
   * of the account's shared rows in it, for an account whose index
   * (users/{uid}/households) names a live household. Each such household is
   * first marked for a full pass (ledger-journal.ts), which the next sweep
   * runs and clears: the copies stay owed if the page closes before they are
   * written, if the rewrite fails, or if the write lands only after a
   * restart, and the pass also rewrites the copies of rows in the categories
   * below one whose parent changed. Then LedgerShareService.reprojectCategory
   * rewrites each copy in the category that differs; its reads see the
   * pending category write, offline included. Null when there is nothing to
   * hand on; the promise never rejects. The sharing code and the journal are
   * reached only by dynamic import, so neither is in the initial bundle.
   */
  private reprojectShared(categoryId: string, data: Partial<Category>): Promise<void> | null {
    const userId = this.authService.userId();
    if (!userId || !Object.keys(SHOWN_ON_COPIES).some(field => field in data)) return null;
    return this.liveHouseholds(userId)
      .then(live => {
        if (live.length === 0) return;
        // Marked as soon as the journal loads, whether or not the sharing code does.
        const marked = this.markFullPasses(userId, live);
        return Promise.all([marked, this.ledgerShare()])
          .then(([, ledger]) => ledger.reprojectCategory(categoryId));
      })
      .catch(error => console.warn('[Categories] A category\'s shared copies were not rewritten', error));
  }

  /**
   * Marks each live household in the account's index for a full pass
   * again, for a category write reprojectShared handed on, once it has
   * landed. Never rejects: the mark made before the write stays owed.
   */
  private markSharesAgain(): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return Promise.resolve();
    return this.liveHouseholds(userId)
      .then(live => this.markFullPasses(userId, live))
      .catch(error => console.warn('[Categories] The households were not marked again after a category write', error));
  }

  /** The ids of the live households in the account's index (users/{uid}/households). */
  private liveHouseholds(userId: string): Promise<string[]> {
    return this.firestoreService.getCollection<HouseholdIndexData>(householdIndexPath(userId))
      .then(index => index.filter(entry => entry.endedAt === undefined).map(entry => entry.id));
  }

  /** Marks households for a full pass (ledger-journal.ts), loaded only when there is one to mark. */
  private markFullPasses(userId: string, households: readonly string[]): Promise<void> {
    if (households.length === 0) return Promise.resolve();
    return import('./ledger-journal')
      .then(({ markFullPass }) => households.forEach(hid => markFullPass(userId, hid)));
  }

  /** Reached only by this dynamic import, so the sharing code stays out of the initial bundle. */
  private ledgerShare(): Promise<LedgerShareService> {
    return import('./ledger-share.service')
      .then(({ LedgerShareService }) => this.injector.get(LedgerShareService));
  }

  /**
   * Built-in categories exist only in memory until edited: mergeCategories()
   * supplies them with `userId: null` whenever no user document with the same
   * id exists. Writing an update to that path would be rejected as NOT_FOUND,
   * so the first edit creates the document instead — and it must carry the
   * complete row, because to the rules a merge write onto a missing document
   * is a create, and categoryCreateValid requires every field plus the owner
   * stamp. Answers the write, issued and not awaited, so a caller can follow
   * it before it lands; null when the id belongs to a real document (or is
   * not in the loaded signal), in which case a plain update is correct.
   */
  private materializeDefaultWith(id: string, data: Partial<Category>): Promise<void> | null {
    const row = this.categories().find(c => c.id === id);
    if (!row || row.userId !== null) return null;

    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    return this.firestoreService.setDocument(
      `${this.userCategoriesPath}/${id}`,
      { ...row, ...data, userId },
      true
    );
  }

  // Delete a category (soft delete - set isActive to false). Not handed to
  // the copies: none shows the flag, and a copy is projected from a
  // category whatever its flag, so every copy of a row in it stays equal.
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

  // Hard delete a category. Its rows keep naming it, and their household
  // copies keep the snapshot they hold until each row is next projected (its
  // next edit, the journal's repair or the weekly full pass), which shows the
  // row under the built-in it then counts under: the type's catch-all for a
  // custom category, the built-in as shipped for an edited one.
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

  // Reorder categories. Built-ins in the list are materialized on the way
  // (see materializeDefaultWith): the old per-id updateDocument rejected on
  // the first default it met, so no order containing one could ever be saved.
  async reorderCategories(categoryIds: string[]): Promise<void> {
    this.isLoading.set(true);

    try {
      const updates = categoryIds.map(async (id, index) => {
        await (this.materializeDefaultWith(id, { order: index })
          ?? this.firestoreService.updateDocument(`${this.userCategoriesPath}/${id}`, { order: index }));
      });

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

    const builtIns = defaultCategories();

    // Check if user already has categories
    const existingCategories = await this.firestoreService.getCollection<Category>(
      this.userCategoriesPath
    );

    if (existingCategories.length > 0) {
      return; // Already initialized
    }

    // Create default categories for user
    const createPromises = builtIns.map(category =>
      this.firestoreService.setDocument(
        `${this.userCategoriesPath}/${category.id}`,
        { ...category, userId }
      )
    );

    await Promise.all(createPromises);
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
