import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, of, map } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { SavedSearch } from '../../models';

export const MAX_RECENT_SEARCHES = 10;
export const MIN_RECORDED_QUERY_LENGTH = 2;

/**
 * Per-user memory of transaction searches, one Firestore subcollection
 * (`users/{uid}/savedSearches`). Pinned entries are labeled shortcuts the
 * user manages; unpinned entries are the recent-search history, deduped
 * case-insensitively and pruned past MAX_RECENT_SEARCHES.
 */
@Injectable({ providedIn: 'root' })
export class SearchHistoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  // All entries, lastUsedAt desc (the query order).
  private allSearches = signal<SavedSearch[]>([]);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut(). Search
    // history is per user and must not surface on a shared device.
    effect(() => {
      if (this.authService.userId() === null) {
        this.allSearches.set([]);
      }
    });
  }

  readonly savedSearches = computed(() => this.allSearches().filter(s => s.pinned));
  readonly recentSearches = computed(() =>
    this.allSearches()
      .filter(s => !s.pinned)
      .slice(0, MAX_RECENT_SEARCHES)
  );

  private get userSearchesPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/savedSearches`;
  }

  loadSearches(): Observable<SavedSearch[]> {
    const userId = this.authService.userId();
    if (!userId) {
      // Root-provided service: drop the previous account's entries so they
      // can never flash for the next sign-in on a shared device.
      this.allSearches.set([]);
      return of([]);
    }

    return this.firestoreService
      .subscribeToCollection<SavedSearch>(this.userSearchesPath, {
        orderBy: [{ field: 'lastUsedAt', direction: 'desc' }]
      })
      .pipe(
        map(searches => {
          this.allSearches.set(searches);
          return searches;
        })
      );
  }

  // Remember an executed query. Existing entries (pinned or recent) just get
  // their lastUsedAt refreshed; new queries push out the oldest recents past
  // the cap.
  async recordRecent(query: string): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    const trimmed = query.trim();
    if (trimmed.length < MIN_RECORDED_QUERY_LENGTH) return;

    const existing = this.findByQuery(trimmed);
    if (existing) {
      await this.touch(existing.id);
      return;
    }

    const newId = await this.firestoreService.addDocument(this.userSearchesPath, {
      userId,
      query: trimmed,
      pinned: false,
      lastUsedAt: this.firestoreService.getTimestamp()
    });

    // The new entry occupies one recent slot; drop the oldest beyond the cap.
    // Exclude the new doc explicitly: with a live subscription, the local
    // write's snapshot lands in the signal before addDocument resolves, and
    // counting it again here would prune one entry too many.
    const recents = this.allSearches().filter(s => !s.pinned && s.id !== newId);
    const overflow = recents.length + 1 - MAX_RECENT_SEARCHES;
    if (overflow > 0) {
      await Promise.all(
        recents
          .slice(recents.length - overflow)
          .map(s => this.firestoreService.deleteDocument(`${this.userSearchesPath}/${s.id}`))
      );
    }
  }

  // Pin a query as a labeled shortcut, reusing an existing entry for the
  // same query when there is one.
  async saveSearch(query: string, label: string): Promise<string> {
    const trimmed = query.trim();
    const existing = this.findByQuery(trimmed);

    if (existing) {
      await this.firestoreService.updateDocument(`${this.userSearchesPath}/${existing.id}`, {
        pinned: true,
        label,
        lastUsedAt: this.firestoreService.getTimestamp()
      });
      return existing.id;
    }

    return this.firestoreService.addDocument(this.userSearchesPath, {
      userId: this.authService.userId(),
      query: trimmed,
      label,
      pinned: true,
      lastUsedAt: this.firestoreService.getTimestamp()
    });
  }

  // Re-running a remembered search refreshes its recency.
  async touch(id: string): Promise<void> {
    await this.firestoreService.updateDocument(`${this.userSearchesPath}/${id}`, {
      lastUsedAt: this.firestoreService.getTimestamp()
    });
  }

  async deleteSearch(id: string): Promise<void> {
    await this.firestoreService.deleteDocument(`${this.userSearchesPath}/${id}`);
  }

  private findByQuery(query: string): SavedSearch | undefined {
    const lowered = query.toLowerCase();
    return this.allSearches().find(s => s.query.toLowerCase() === lowered);
  }
}
