import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
  AggregateAnswer,
  AggregateOperation,
  SearchAnswerRecord,
  baseCurrencyOf,
} from '../../models';
import { answerDedupeKey, buildAnswerFields } from '../utils/search-answer.utils';

export const MAX_SEARCH_ANSWERS = 50;

/**
 * Per-user history of smart-search aggregate answers, one Firestore
 * subcollection (`users/{uid}/searchAnswers`). Each record is a snapshot of
 * the figures at `computedAt` over a resolved scope; re-asking the same
 * question over the same scope refreshes the one record instead of
 * duplicating it, and the newest MAX_SEARCH_ANSWERS win — the oldest by
 * recency are pruned on write.
 */
@Injectable({ providedIn: 'root' })
export class SearchAnswerHistoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  // All records, lastUsedAt desc (the query order).
  private allAnswers = signal<SearchAnswerRecord[]>([]);

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

  loadAnswers(): Observable<SearchAnswerRecord[]> {
    const userId = this.authService.userId();
    if (!userId) {
      // Root-provided service: drop the previous account's records so they
      // can never flash for the next sign-in on a shared device.
      this.allAnswers.set([]);
      return of([]);
    }

    return this.firestoreService
      .subscribeToCollection<SearchAnswerRecord>(this.userAnswersPath, {
        orderBy: [{ field: 'lastUsedAt', direction: 'desc' }]
      })
      .pipe(
        map(records => {
          this.allAnswers.set(records);
          return records;
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
    const key = answerDedupeKey(fields.query, fields.operation, fields.limit, fields.scope);
    const existing = this.allAnswers().find(
      record => answerDedupeKey(record.query, record.operation, record.limit, record.scope) === key
    );
    if (existing) {
      await this.writeSnapshot(existing.id, answer);
      return;
    }

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
    await this.firestoreService.updateDocument<SearchAnswerRecord>(
      `${this.userAnswersPath}/${id}`,
      { pinned }
    );
  }

  // Re-opening a record refreshes its recency.
  async touch(id: string): Promise<void> {
    await this.firestoreService.updateDocument<SearchAnswerRecord>(
      `${this.userAnswersPath}/${id}`,
      { lastUsedAt: this.firestoreService.getTimestamp() }
    );
  }

  async deleteAnswer(id: string): Promise<void> {
    await this.firestoreService.deleteDocument(`${this.userAnswersPath}/${id}`);
  }

  /**
   * Remove every persisted answer, for account deletion. Enumerates the
   * collection rather than the signal — the signal only holds what a
   * subscription happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<SearchAnswerRecord>(this.userAnswersPath);
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
