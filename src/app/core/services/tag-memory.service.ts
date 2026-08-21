import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TagMemoryEntry } from '../../models';
import { merchantKeyForStorage, normalizeMerchantKey } from '../utils/merchant-key.utils';
import { normalizeTags } from '../utils/tag.utils';

/**
 * What the user tags a merchant with, and what they refuse to.
 *
 * A suggestion the user removed is a stronger signal than one they never saw:
 * offering it again on the next import of the same merchant is the import
 * arguing with a decision the user already made. So both halves are kept — the
 * tags that survived the last confirm, and the ones that were taken off it.
 *
 * Lookups are synchronous against a warm map so the suggestion path can
 * consult memory per row without serializing a batch on one await each.
 */
@Injectable({ providedIn: 'root' })
export class TagMemoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  private entries = signal<TagMemoryEntry[]>([]);
  private loadedForUser: string | null = null;

  /** Everything remembered, most-confirmed first. For the settings screen. */
  readonly remembered = computed(() =>
    [...this.entries()].sort((a, b) => b.count - a.count)
  );

  readonly rememberedCount = computed(() => this.entries().length);

  private get memoryPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/tagMemory`;
  }

  /**
   * Load the map once per signed-in user.
   *
   * Idempotent, because the import path calls it on every run and a batch of
   * twenty rows must not cost twenty reads. Signing out clears the map so one
   * account's merchants can never surface for the next sign-in on a shared
   * device.
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
      const stored = await this.firestoreService.getCollection<TagMemoryEntry>(this.memoryPath);
      this.entries.set(stored);
      this.loadedForUser = userId;
    } catch (error) {
      // Memory is an optimization. Failing to read it means suggesting from
      // whatever else the import knows, which is what it did before this
      // existed.
      console.warn('[TagMemory] Could not load remembered tags:', error);
      this.entries.set([]);
    }
  }

  /**
   * What this merchant keeps and what it refuses, or null if it is new.
   *
   * Synchronous by design: the caller has already awaited `ensureLoaded`, and
   * a per-row await here would serialize a batch that is otherwise one pass.
   */
  lookup(description: string): { tags: string[]; suppressed: string[] } | null {
    const key = normalizeMerchantKey(description);
    if (!key) return null;
    const entry = this.entries().find(e => e.merchantKey === key);
    return entry ? { tags: entry.tags, suppressed: entry.suppressed } : null;
  }

  /**
   * Record what the user kept for a merchant and what they refused.
   *
   * `tags` is replaced, not merged — the last confirm is the user's current
   * opinion. Refusals accumulate, but a tag kept again stops being refused:
   * the user has overruled their earlier removal.
   */
  async remember(description: string, kept: readonly string[], removed: readonly string[]): Promise<void> {
    const key = merchantKeyForStorage(description);
    if (!key || !this.authService.userId()) return;

    const keptTags = normalizeTags(kept);
    const removedTags = normalizeTags(removed).filter(t => !keptTags.includes(t));
    // Nothing kept and nothing refused is no decision: it must not blank an
    // entry or count as a confirmation.
    if (keptTags.length === 0 && removedTags.length === 0) return;
    const existing = this.entries().find(e => e.merchantKey === key);

    const entry: TagMemoryEntry = {
      merchantKey: key,
      tags: keptTags,
      suppressed: normalizeTags([...(existing?.suppressed ?? []), ...removedTags])
        .filter(t => !keptTags.includes(t)),
      sampleDescription: description,
      count: (existing?.count ?? 0) + 1,
    };

    // Update the map first: the review list should reflect the decision even
    // if the write is still in flight or the device is offline.
    this.entries.update(current => [...current.filter(e => e.merchantKey !== key), entry]);

    try {
      await this.firestoreService.setDocument(`${this.memoryPath}/${key}`, entry, true);
    } catch (error) {
      console.warn('[TagMemory] Could not save remembered tags:', error);
    }
  }

  /** One confirm's worth of decisions, one write per merchant; a tag both kept and removed for the same merchant is recorded as neither. */
  async rememberAll(entries: { description: string; kept: readonly string[]; removed: readonly string[] }[]): Promise<void> {
    const byKey = new Map<string, { description: string; kept: Set<string>; removed: Set<string> }>();

    for (const { description, kept, removed } of entries) {
      const key = merchantKeyForStorage(description);
      if (!key) continue;
      const bucket = byKey.get(key) ?? { description, kept: new Set<string>(), removed: new Set<string>() };
      normalizeTags(kept).forEach(t => bucket.kept.add(t));
      normalizeTags(removed).forEach(t => bucket.removed.add(t));
      byKey.set(key, bucket);
    }

    for (const { description, kept, removed } of byKey.values()) {
      const contested = [...kept].filter(t => removed.has(t));
      contested.forEach(t => {
        kept.delete(t);
        removed.delete(t);
      });
      await this.remember(description, [...kept], [...removed]);
    }
  }

  /** Forget one merchant. */
  async forget(merchantKey: string): Promise<void> {
    if (!merchantKey || !this.authService.userId()) return;
    this.entries.update(current => current.filter(e => e.merchantKey !== merchantKey));
    await this.firestoreService.deleteDocument(`${this.memoryPath}/${merchantKey}`);
  }

  /** Forget everything this session has loaded. */
  async clear(): Promise<void> {
    if (!this.authService.userId()) return;
    const keys = this.entries().map(e => e.merchantKey);
    this.entries.set([]);
    for (const key of keys) {
      await this.firestoreService.deleteDocument(`${this.memoryPath}/${key}`);
    }
  }

  /**
   * Remove every stored memory row, for account deletion. Enumerates the
   * collection rather than the loaded entries — clear() only forgets what
   * this session happened to load, which on a fresh session is nothing.
   */
  async deleteAll(): Promise<number> {
    if (!this.authService.userId()) return 0;
    const rows = await this.firestoreService.getCollection<{ id: string }>(this.memoryPath);
    this.entries.set([]);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.memoryPath}/${row.id}`);
    }
    return rows.length;
  }
}
