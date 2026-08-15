import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';
import { FeedbackCategory, FeedbackEntry } from '../../models';
import packageJson from '../../../../package.json';

/** Hard cap on a message, enforced again by the Firestore rules. */
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;

/** Entries shown on the About page. The stored list itself is never truncated. */
export const MAX_DISPLAYED_FEEDBACK_ENTRIES = 20;

/**
 * Feedback the user sends to the developer from the About page, one
 * subcollection (`users/{uid}/feedback`). Entries are unrewritable by rule:
 * the operator is mailed a copy of each entry on create, so a rewrite would
 * make the stored record diverge from the mail already sent. The owner may
 * delete entries — account deletion has to empty the list.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);

  private path(userId: string): string {
    return `users/${userId}/feedback`;
  }

  /**
   * Store one feedback entry. Unlike SecurityLogService.record this
   * propagates failure: the write is the whole point of the user's action,
   * so a rejection must reach the dialog instead of vanishing into a log.
   */
  async add(category: FeedbackCategory, message: string): Promise<string> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const trimmed = message.trim().slice(0, MAX_FEEDBACK_MESSAGE_LENGTH);
    if (!trimmed) throw new Error('Feedback message is empty');

    return this.firestoreService.addDocument(this.path(userId), {
      userId,
      category,
      message: trimmed,
      appVersion: packageJson.version,
      platform: Capacitor.getPlatform(),
      locale: this.translationService.currentLocale()
    });
  }

  watchOwn(
    userId: string | null,
    max: number = MAX_DISPLAYED_FEEDBACK_ENTRIES
  ): Observable<FeedbackEntry[]> {
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<FeedbackEntry>(this.path(userId), {
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
      limit: max
    });
  }

  /**
   * Remove every entry, for account deletion. Enumerates the collection
   * rather than any cached view — a cache only holds what a subscription
   * happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<FeedbackEntry>(this.path(userId));
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.path(userId)}/${row.id}`);
    }
    return rows.length;
  }
}
