import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryMemoryEntry } from '../../models';
import { merchantKeyForStorage, normalizeMerchantKey } from '../utils/merchant-key.utils';

/**
 * What the user has already decided about a merchant.
 *
 * Every import used to re-ask the model how to categorize STARBUCKS, ignoring
 * that the user had corrected it the last three times — which costs tokens and,
 * worse, produces a different answer on different runs. The correction was
 * already visible in the preview (`updateCategory` stamps confidence 1.0) and
 * was simply thrown away when the import finished.
 *
 * Lookups are synchronous against a warm map so the categorization path can
 * consult memory before deciding whether it needs the model at all.
 */
@Injectable({ providedIn: 'root' })
export class CategoryMemoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  private entries = signal<CategoryMemoryEntry[]>([]);
  private loadedForUser: string | null = null;

  /** Everything remembered, most-confirmed first. For the settings screen. */
  readonly remembered = computed(() =>
    [...this.entries()].sort((a, b) => b.count - a.count)
  );

  readonly rememberedCount = computed(() => this.entries().length);

  private get memoryPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/categoryMemory`;
  }

  /**
   * Load the map once per signed-in user.
   *
   * Idempotent, because the import path calls it on every run and a batch of
   * twenty rows must not cost twenty reads. Signing out clears the map so one
   * account's merchants can never surface for the next sign-in on a shared
   * device — the same reason search history clears itself.
   */
  async ensureLoaded(): Promise<void> {
    const userId = this.authService.userId();

    if (!userId) {
      this.entries.set([]);
      this.loadedForUser = null;
      return;
    }
    if (this.loadedForUser === userId) {
      return;
    }

    try {
      const stored = await this.firestoreService.getCollection<CategoryMemoryEntry>(
        this.memoryPath
      );
      this.entries.set(stored);
      this.loadedForUser = userId;
    } catch (error) {
      // Memory is an optimization. Failing to read it means asking the model,
      // which is what the app did before this existed.
      console.warn('[CategoryMemory] Could not load remembered categories:', error);
      this.entries.set([]);
    }
  }

  /**
   * The category this merchant was last filed under, or null if it is new.
   *
   * Synchronous by design: the caller has already awaited `ensureLoaded`, and a
   * per-row await here would serialize a batch that is otherwise one pass.
   */
  lookup(description: string): string | null {
    const key = normalizeMerchantKey(description);
    if (!key) return null;
    return this.entries().find(e => e.merchantKey === key)?.categoryId ?? null;
  }

  /**
   * Record what the user chose for a merchant.
   *
   * Writing under the merchant key means a correction replaces the previous
   * answer rather than competing with it, and `count` records how settled the
   * choice is.
   */
  async remember(description: string, categoryId: string): Promise<void> {
    const key = merchantKeyForStorage(description);
    if (!key || !categoryId) {
      return;
    }
    if (!this.authService.userId()) {
      return;
    }

    const existing = this.entries().find(e => e.merchantKey === key);
    const entry: CategoryMemoryEntry = {
      merchantKey: key,
      categoryId,
      sampleDescription: description,
      count: existing && existing.categoryId === categoryId ? existing.count + 1 : 1,
    };

    // Update the map first: the preview should reflect the correction even if
    // the write is still in flight or the device is offline.
    this.entries.update(current => [
      ...current.filter(e => e.merchantKey !== key),
      entry,
    ]);

    try {
      await this.firestoreService.setDocument(`${this.memoryPath}/${key}`, entry, true);
    } catch (error) {
      console.warn('[CategoryMemory] Could not save a remembered category:', error);
    }
  }

  /**
   * Record the corrections from a confirmed import.
   *
   * A merchant the batch categorized two different ways is skipped rather than
   * resolved. Picking the first or the last would be arbitrary, and recording
   * either one invents a preference the user never expressed — which then
   * quietly mis-categorizes that merchant on every future import. Ambiguity is
   * better left unremembered.
   */
  async rememberAll(entries: { description: string; categoryId: string }[]): Promise<void> {
    const byKey = new Map<string, { description: string; categoryId: string } | null>();

    for (const { description, categoryId } of entries) {
      const key = merchantKeyForStorage(description);
      if (!key || !categoryId) continue;

      if (!byKey.has(key)) {
        byKey.set(key, { description, categoryId });
        continue;
      }
      const seen = byKey.get(key);
      if (seen && seen.categoryId !== categoryId) {
        byKey.set(key, null);
      }
    }

    for (const chosen of byKey.values()) {
      if (chosen) {
        await this.remember(chosen.description, chosen.categoryId);
      }
    }
  }

  /** Forget one merchant. */
  async forget(merchantKey: string): Promise<void> {
    if (!merchantKey || !this.authService.userId()) return;
    this.entries.update(current => current.filter(e => e.merchantKey !== merchantKey));
    await this.firestoreService.deleteDocument(`${this.memoryPath}/${merchantKey}`);
  }

  /** Forget everything. */
  async clear(): Promise<void> {
    if (!this.authService.userId()) return;
    const keys = this.entries().map(e => e.merchantKey);
    this.entries.set([]);
    for (const key of keys) {
      await this.firestoreService.deleteDocument(`${this.memoryPath}/${key}`);
    }
  }
}
