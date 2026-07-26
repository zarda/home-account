import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { FirestoreService } from './firestore.service';
import { SecurityEvent, SecurityEventType } from '../../models';

/** Entries shown in settings. The log itself is never truncated. */
export const MAX_DISPLAYED_SECURITY_EVENTS = 20;

/**
 * Append-only sign-in history, so a user can check for account activity they
 * do not recognise. Entries are immutable by rule: a client holding the
 * credentials must not be able to erase the record of its own sign-in.
 */
@Injectable({ providedIn: 'root' })
export class SecurityLogService {
  private firestoreService = inject(FirestoreService);

  private path(userId: string): string {
    return `users/${userId}/securityEvents`;
  }

  /**
   * Takes the id rather than injecting AuthService: AuthService is what calls
   * this on sign-in, so injecting it here would close a DI cycle.
   */
  async record(userId: string, type: SecurityEventType): Promise<void> {
    try {
      await this.firestoreService.addDocument(this.path(userId), {
        userId,
        type,
        occurredAt: this.firestoreService.getTimestamp(),
        platform: Capacitor.getPlatform()
      });
    } catch (error) {
      // An audit trail is never a precondition for signing in; a rejected or
      // queued-offline write must not surface as a failed sign-in.
      console.error('Failed to record security event:', error);
    }
  }

  watchRecent(
    userId: string | null,
    max: number = MAX_DISPLAYED_SECURITY_EVENTS
  ): Observable<SecurityEvent[]> {
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<SecurityEvent>(this.path(userId), {
      orderBy: [{ field: 'occurredAt', direction: 'desc' }],
      limit: max
    });
  }
}
