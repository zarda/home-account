import { Injectable, Injector, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import type { LedgerShareService } from './ledger-share.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { HouseholdIndexData, joinedFirst, toMembership } from '../utils/household-index.utils';
import { ShareChange, ShareTarget } from '../utils/share-change.utils';
import { householdIndexPath } from '../../models';

/** What an apply did: the part of its change that went through, and whether any of it did not. */
export interface ShareOutcome {
  landed: ShareChange;
  failed: boolean;
}

const NO_CHANGE: ShareChange = { share: [], unshare: [] };

/**
 * The share controls of one row: the transaction form's Shared with chips
 * and the transaction list's Share with… dialog and Stop sharing item.
 *
 * The memberships are read from the account's own index
 * (users/{uid}/households) with a listener, which answers from the cache
 * first, offline included. The sharing code (LedgerShareService) is reached
 * only by dynamic import, and only once a share actually changes. The form,
 * which the initial bundle holds, reaches this service by dynamic import as
 * well.
 */
@Injectable({ providedIn: 'root' })
export class RowSharingService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly translation = inject(TranslationService);
  private readonly injector = inject(Injector);

  /**
   * Moves on each apply that changed a row's shares. The transactions list
   * reads its rows again on it: an edit's shares land after the edit itself,
   * so the refresh the edit started may have read the row before them.
   */
  readonly revision = signal(0);

  /**
   * The account's live memberships, earliest joined first; none while
   * nobody is signed in or when the index cannot be read, which leaves the
   * share controls out rather than failing the form or the list.
   */
  targets(): Observable<ShareTarget[]> {
    const uid = this.auth.currentUser()?.id;
    if (!uid) return of([]);
    return this.firestore.subscribeToCollection<HouseholdIndexData>(householdIndexPath(uid)).pipe(
      map(entries => entries
        .map(toMembership)
        .filter(membership => !membership.ended)
        .sort(joinedFirst)
        .map(({ householdId, name }) => ({ householdId, name }))),
      catchError(error => {
        console.warn('[RowSharing] The account\'s households were not read; no share controls are offered', error);
        return of([]);
      })
    );
  }

  /**
   * Shares one row into each household of `change.share` and stops sharing
   * it with each of `change.unshare`, all at once. Offline, a share or an
   * unshare resolves once it is queued. A change that does not go through is
   * reported here, by the household's name when its membership has ended
   * (`targets` names it), and the rest still apply. Never rejects.
   */
  async apply(txId: string, change: ShareChange, targets: readonly ShareTarget[]): Promise<ShareOutcome> {
    if (change.share.length === 0 && change.unshare.length === 0) return { landed: NO_CHANGE, failed: false };

    const sharing = await import('./ledger-share.service').catch(error => {
      console.warn('[RowSharing] The sharing code did not load; no share was changed', error);
      return null;
    });
    if (!sharing) {
      this.notifications.error(this.translation.t('transactions.share.failed'));
      return { landed: NO_CHANGE, failed: true };
    }
    const ledger: LedgerShareService = this.injector.get(sharing.LedgerShareService);

    const steps = [
      ...change.share.map(id => ({ id, kind: 'share' as const, run: ledger.share([txId], id) })),
      ...change.unshare.map(id => ({ id, kind: 'unshare' as const, run: ledger.unshare([txId], id) }))
    ];
    const settled = await Promise.allSettled(steps.map(step => step.run));

    const landed: ShareChange = { share: [], unshare: [] };
    let refusedFor: string | null = null;
    let failed = false;
    for (const [i, result] of settled.entries()) {
      const { id, kind } = steps[i];
      if (result.status === 'fulfilled') {
        landed[kind].push(id);
        continue;
      }
      failed = true;
      const refusal: unknown = result.reason;
      if (refusal instanceof sharing.LedgerShareRefusal && refusal.reason === 'notMember') {
        refusedFor ??= id;
      } else {
        console.warn(`[RowSharing] A ${kind} into a household did not go through`, refusal);
      }
    }

    if (landed.share.length > 0 || landed.unshare.length > 0) this.revision.update(seq => seq + 1);
    if (failed) {
      const name = targets.find(target => target.householdId === refusedFor)?.name;
      this.notifications.error(name !== undefined
        ? this.translation.t('transactions.share.notMember', { name })
        : this.translation.t('transactions.share.failed'));
    }
    return { landed, failed };
  }
}
