import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
  AggregateAnswer,
  AggregateOperation,
  SearchAnswerRecord,
  SearchRecord,
  TransactionFilters,
  baseCurrencyOf,
} from '../../models';
import {
  SearchAnswerSnapshot,
  SearchFilterSnapshot,
  buildAnswerFields,
  buildFilterFields,
  searchRecordDedupeKey,
} from '../utils/search-answer.utils';
import { optionalTimestamp, reviveTimestamp } from '../utils/backup-revive.utils';

export const MAX_SEARCH_ANSWERS = 50;

/**
 * Per-user history of interpreted smart searches, one Firestore subcollection
 * (`users/{uid}/searchAnswers`). Two kinds share it: an aggregate record is a
 * snapshot of the figures at `computedAt` over a resolved scope, a filter
 * record is the scope alone. Both cost the same model call, which is why both
 * are worth storing.
 *
 * Re-asking the same question over the same scope reuses the one record
 * instead of duplicating it — refreshing its figures for an aggregate, its
 * recency for a filter. The newest MAX_SEARCH_ANSWERS unpinned records win;
 * the rest are pruned on write.
 */
@Injectable({ providedIn: 'root' })
export class SearchAnswerHistoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  // All records, lastUsedAt desc (the query order).
  private allAnswers = signal<SearchRecord[]>([]);

  /**
   * Pinned records first, then the rest by recency.
   *
   * Sorted here rather than as a compound orderBy: at fifty records the client
   * sort costs nothing, and a `pinned desc, lastUsedAt desc` query would need
   * a composite index deployed before the feature worked at all.
   */
  readonly answers = computed(() =>
    [...this.allAnswers()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  );

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut(). Stored
    // answers are per user and must not surface on a shared device.
    effect(() => {
      if (this.authService.userId() === null) {
        this.allAnswers.set([]);
      }
    });
  }

  private get userAnswersPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/searchAnswers`;
  }

  loadAnswers(): Observable<SearchRecord[]> {
    const userId = this.authService.userId();
    if (!userId) {
      // Root-provided service: drop the previous account's records so they
      // can never flash for the next sign-in on a shared device.
      this.allAnswers.set([]);
      return of([]);
    }

    return this.firestoreService
      .subscribeToCollection<SearchRecord>(this.userAnswersPath, {
        orderBy: [{ field: 'lastUsedAt', direction: 'desc' }]
      })
      .pipe(
        map(records => {
          // The one read path, so the one place a pre-version-2 record without
          // a kind is settled: aggregates are all this collection ever held.
          const normalized = records.map(record => ({
            ...record,
            kind: record.kind ?? 'aggregate',
          })) as SearchRecord[];
          this.allAnswers.set(normalized);
          return normalized;
        })
      );
  }

  /**
   * Persist a freshly computed aggregate answer. The same question over the
   * same resolved scope refreshes its existing record — new figures, new
   * computedAt — rather than appending a duplicate; a genuinely new question
   * takes a slot and pushes the oldest record out past the cap.
   */
  async recordAnswer(
    query: string,
    intent: { operation: AggregateOperation; limit: number },
    answer: AggregateAnswer,
  ): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    const fields = buildAnswerFields(query, intent, answer, this.baseCurrencyFor(answer));
    const existing = this.findByIdentity(fields);
    if (existing) {
      await this.writeSnapshot(existing.id, answer);
      return;
    }

    await this.create(userId, fields);
  }

  /**
   * Persist a filter-shaped interpretation. It costs the same model call as
   * an aggregate one, so it earns the same slot: reopening it re-applies the
   * scope without asking the model again.
   *
   * Re-asking the same question over the same scope only refreshes recency —
   * there are no figures to rewrite, which is the whole difference from
   * recordAnswer.
   */
  async recordFilter(query: string, filters: TransactionFilters): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    const fields = buildFilterFields(query, filters);
    const existing = this.findByIdentity(fields);
    if (existing) {
      await this.touch(existing.id);
      return;
    }

    await this.create(userId, fields);
  }

  private findByIdentity(
    fields: SearchAnswerSnapshot | SearchFilterSnapshot,
  ): SearchRecord | undefined {
    const key = searchRecordDedupeKey(fields);
    return this.allAnswers().find(record => searchRecordDedupeKey(record) === key);
  }

  /** Write a new record and prune the unpinned tail back to the cap. */
  private async create(
    userId: string,
    fields: SearchAnswerSnapshot | SearchFilterSnapshot,
  ): Promise<void> {
    const now = this.firestoreService.getTimestamp();
    const newId = await this.firestoreService.addDocument(this.userAnswersPath, {
      userId,
      ...fields,
      computedAt: now,
      lastUsedAt: now,
    });

    // The new record occupies one slot; drop the oldest beyond the cap.
    // Exclude the new doc explicitly: with a live subscription, the local
    // write's snapshot lands in the signal before addDocument resolves, and
    // counting it again here would prune one record too many.
    //
    // Pinned records are excluded outright, so the cap counts only the
    // unpinned — the same split MAX_RECENT_SEARCHES already applies to
    // savedSearches. Pinning is the answer to "fifty idle questions pruned
    // the one I cared about", which a pinned record still subject to the cap
    // would not be.
    const others = this.allAnswers().filter(record => !record.pinned && record.id !== newId);
    const overflow = others.length + 1 - MAX_SEARCH_ANSWERS;
    if (overflow > 0) {
      await Promise.all(
        others
          .slice(others.length - overflow)
          .map(record => this.firestoreService.deleteDocument(`${this.userAnswersPath}/${record.id}`))
      );
    }
  }

  /**
   * Replace a record's figures with a fresh local recomputation. The identity
   * — question, operation, limit, scope — never changes; only the numbers,
   * their currency context and the computed-at stamp do.
   */
  async refreshAnswer(id: string, answer: AggregateAnswer): Promise<void> {
    await this.writeSnapshot(id, answer);
  }

  /**
   * Keep a record out of the prune, or release it back into it.
   *
   * Deliberately not part of writeSnapshot, which only ever writes figures:
   * pinning is a decision about the record, and a refresh must not disturb it.
   */
  async togglePin(id: string, pinned: boolean): Promise<void> {
    await this.firestoreService.updateDocument<SearchRecord>(
      `${this.userAnswersPath}/${id}`,
      { pinned }
    );
  }

  // Re-opening a record refreshes its recency.
  async touch(id: string): Promise<void> {
    await this.firestoreService.updateDocument<SearchRecord>(
      `${this.userAnswersPath}/${id}`,
      { lastUsedAt: this.firestoreService.getTimestamp() }
    );
  }

  async deleteAnswer(id: string): Promise<void> {
    await this.firestoreService.deleteDocument(`${this.userAnswersPath}/${id}`);
  }

  /**
   * Write one stored interpretation back from a backup, at its own id.
   *
   * `create()` is the wrong door for this: it takes an auto id, stamps both
   * `computedAt` and `lastUsedAt` from now — which would claim every restored
   * answer was computed during the restore — and prunes the unpinned tail back
   * to MAX_SEARCH_ANSWERS on every write.
   *
   * The record arrives already in stored form, so nothing is rebuilt from an
   * AggregateAnswer or a TransactionFilters; what the file carries is what the
   * document held. Three things still change. `id` is stripped, because
   * answerCreateValid `hasOnly()`s a field list without it and a write
   * carrying it is denied outright. `userId` becomes the current account's.
   * And the three stamps are revived from the objects JSON.stringify left
   * behind — but `scope.startDate`/`endDate` are deliberately untouched:
   * answerScopeValid requires day-key strings, because a calendar window with
   * a timezone in it is not the window that was asked about.
   *
   * `setDocument` stamps `updatedAt` from today regardless; it is in the
   * allowed field list, and it is the one field a restore cannot carry
   * verbatim.
   */
  async restore(record: SearchRecord): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    // Everything the file holds rides along; these three cannot, in the shape
    // the file holds them. `id` was injected on read, and `createdAt` is
    // re-added below only when it revives — left as the plain object
    // JSON.stringify made of it, the rules refuse the whole write.
    const stored: Record<string, unknown> = { ...record };
    delete stored['id'];
    delete stored['createdAt'];
    delete stored['updatedAt'];

    await this.firestoreService.setDocument(
      `${this.userAnswersPath}/${record.id}`,
      {
        ...stored,
        userId,
        computedAt: reviveTimestamp(record.computedAt) ?? this.firestoreService.getTimestamp(),
        lastUsedAt: reviveTimestamp(record.lastUsedAt) ?? this.firestoreService.getTimestamp(),
        ...optionalTimestamp('createdAt', record.createdAt),
      },
      true
    );
  }

  /**
   * One-shot read of every stored interpretation, for the backup export.
   * Server-only: a cache-served subset is safe for the app but not for a file
   * the user is offered before deleting the account.
   *
   * Not the `answers` signal and not capped at MAX_SEARCH_ANSWERS: the cap is
   * a write-path prune, and the backup has to carry what erasure removes.
   */
  async exportAll(): Promise<SearchRecord[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollectionFromServer<SearchRecord>(
      this.userAnswersPath, { orderBy: [{ field: 'lastUsedAt', direction: 'desc' }] });
  }

  /**
   * Remove every persisted answer, for account deletion. Enumerates the
   * collection rather than the signal — the signal only holds what a
   * subscription happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<SearchRecord>(this.userAnswersPath);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.userAnswersPath}/${row.id}`);
    }
    this.allAnswers.set([]);
    return rows.length;
  }

  /**
   * The snapshot fields a refresh (or dedupe re-record) overwrites. Vanished
   * optionals are cleared with deleteField() sentinels — leaving a stale
   * extreme-row id or category breakdown on a record whose fresh computation
   * has neither would misdescribe the stored figures.
   */
  private async writeSnapshot(id: string, answer: AggregateAnswer): Promise<void> {
    const now = this.firestoreService.getTimestamp();
    await this.firestoreService.updateDocument<SearchAnswerRecord>(`${this.userAnswersPath}/${id}`, {
      value: answer.value,
      transactionCount: answer.transactionCount,
      baseCurrency: this.baseCurrencyFor(answer),
      currency: answer.currency ?? (deleteField() as unknown as string),
      extremeTransactionId:
        answer.extremeTransaction?.id ?? (deleteField() as unknown as string),
      groups:
        answer.groups?.map(group => ({ ...group }))
        ?? (deleteField() as unknown as SearchAnswerRecord['groups']),
      computedAt: now,
      lastUsedAt: now,
    });
  }

  /**
   * Money operations already carry the base currency on the answer; count is
   * currency-free, so the profile's base stands in — the figures must always
   * say what currency they were computed in.
   */
  private baseCurrencyFor(answer: AggregateAnswer): string {
    return answer.currency ?? baseCurrencyOf(this.authService.currentUser());
  }
}
