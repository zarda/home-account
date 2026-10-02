import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import type { LedgerShareResult, LedgerShareService } from './ledger-share.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { HouseholdIndexData, joinedFirst, toMembership } from '../utils/household-index.utils';
import { ShareChange, ShareTarget } from '../utils/share-change.utils';
import { MAX_BULK_SHARE, householdIndexPath } from '../../models';

/** What an apply did: the part of its change that went through, and whether any of it did not. */
export interface ShareOutcome {
  landed: ShareChange;
  failed: boolean;
}

/** What an apply to many rows did: the households it went through for, and whether any did not. */
export interface BulkShareOutcome {
  landed: string[];
  failed: boolean;
}

/** Many rows shared into households, or taken out of them. */
export type BulkShareKind = 'share' | 'unshare';

const NO_CHANGE: ShareChange = { share: [], unshare: [] };

/**
 * The share controls of the transactions: one row's, through the transaction
 * form's Shared with chips and the list's Share with… dialog and Stop sharing
 * item (`apply`), and many rows' at once, through the list's select mode,
 * whose bar shares them into households or stops sharing them (`applyToRows`).
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
  private readonly pwa = inject(PwaService);
  private readonly injector = inject(Injector);

  /**
   * Moves on each apply that changed a row's shares. The transactions list
   * reads its rows again on it: an edit's shares land after the edit itself,
   * so the refresh the edit started may have read the row before them.
   */
  readonly revision = signal(0);

  /** The signed-in account; a profile edit that keeps it moves nothing here. */
  private readonly accountId = computed(() => this.auth.currentUser()?.id ?? null);

  /**
   * The signed-in account's live memberships, earliest joined first; none
   * while nobody is signed in or when the index cannot be read, which leaves
   * the share controls out rather than failing the form or the list.
   *
   * It follows the account for as long as it is subscribed: on a change the
   * last account's listener is closed and the next account's index is read
   * in its place, with none of the last one's households offered meanwhile.
   * Another tab's sign-in makes that change with no signed-out state
   * between. On the web the page now reloads for it instead (ADR 0163), and
   * this handling stays as a defence: Firestore hears the new session before
   * the app does and may refuse the last account's index under it, so an
   * index that could not be read ends only that account's listing, never the
   * next one's.
   */
  targets(): Observable<ShareTarget[]> {
    return this.accountIds().pipe(
      switchMap((uid, change) => {
        if (!uid) return of([]);
        const memberships = this.memberships(uid);
        return change > 0 ? memberships.pipe(startWith([])) : memberships;
      })
    );
  }

  /** One account's live memberships from its own index, or none once that index cannot be read. */
  private memberships(uid: string): Observable<ShareTarget[]> {
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
   * The signed-in account's id, the current one at once and then each
   * change, for as long as it is subscribed. The watcher belongs to the
   * subscription, so a form that closes leaves none behind; an effect's
   * first run is later than the subscribe, so the current id is read here
   * and the repeat is dropped.
   */
  private accountIds(): Observable<string | null> {
    return new Observable<string | null>(subscriber => {
      subscriber.next(untracked(this.accountId));
      const watcher = effect(() => {
        const uid = this.accountId();
        untracked(() => subscriber.next(uid));
      }, { injector: this.injector });
      return () => watcher.destroy();
    }).pipe(distinctUntilChanged());
  }

  /**
   * Shares one row into each household of `change.share` and stops sharing
   * it with each of `change.unshare`, all at once. Offline, a share or an
   * unshare resolves once it is queued. A change that does not go through is
   * reported here: as a row no copy may hold when it is one, by the
   * household's name when its membership has ended (`targets` names it), and
   * the rest still apply. Never rejects.
   */
  async apply(txId: string, change: ShareChange, targets: readonly ShareTarget[]): Promise<ShareOutcome> {
    if (change.share.length === 0 && change.unshare.length === 0) return { landed: NO_CHANGE, failed: false };

    const loaded = await this.loadLedger(() => this.translation.t('transactions.share.failed'));
    if (!loaded) return { landed: NO_CHANGE, failed: true };
    const { sharing, ledger } = loaded;

    const steps = [
      ...change.share.map(id => ({ id, kind: 'share' as const, run: ledger.share([txId], id) })),
      ...change.unshare.map(id => ({ id, kind: 'unshare' as const, run: ledger.unshare([txId], id) }))
    ];
    const settled = await Promise.allSettled(steps.map(step => step.run));

    const landed: ShareChange = { share: [], unshare: [] };
    let refusedFor: string | null = null;
    let unshareable = false;
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
      } else if (refusal instanceof sharing.LedgerShareRefusal && refusal.reason === 'unshareable') {
        unshareable = true;
      } else {
        console.warn(`[RowSharing] A ${kind} into a household did not go through`, refusal);
      }
    }

    if (landed.share.length > 0 || landed.unshare.length > 0) this.revision.update(seq => seq + 1);
    if (failed) {
      const name = targets.find(target => target.householdId === refusedFor)?.name;
      // The row itself is what keeps it out of every household, so that is said first.
      this.notifications.error(unshareable
        ? this.translation.t('transactions.share.unshareable')
        : name !== undefined
          ? this.translation.t('transactions.share.notMember', { name })
          : this.translation.t('transactions.share.failed'));
    }
    return { landed, failed };
  }

  /**
   * Shares many rows into each of `householdIds`, or stops sharing them
   * with each, one household after another with the same rows every time,
   * so the commits of one run before the next begins and `progress` (0 to 1)
   * moves through them in order. A refusal for too many rows ends the run;
   * any other failure is reported and the other households still go ahead.
   * A row no copy may hold is passed over (LedgerShareService.share), in
   * every household alike: when none of the rows is left to share, no other
   * household is asked. The result is told once, through a notification: the
   * households it went through for, those it did not and why when it can
   * say, how many rows were passed over, or offline what the households see
   * and when. Never rejects.
   */
  async applyToRows(
    kind: BulkShareKind,
    txIds: readonly string[],
    householdIds: readonly string[],
    targets: readonly ShareTarget[],
    progress?: (fraction: number) => void
  ): Promise<BulkShareOutcome> {
    if (txIds.length === 0 || householdIds.length === 0) return { landed: [], failed: false };

    const loaded = await this.loadLedger(() => this.translation.t('transactions.select.failed'));
    if (!loaded) return { landed: [], failed: true };
    const { sharing, ledger } = loaded;

    const rows = [...txIds];
    const steps = householdIds.length;
    const landed: string[] = [];
    // The households that did not take the rows, in the order asked, and
    // whether any of them failed for a reason other than a membership that
    // has ended.
    const failed: string[] = [];
    let onlyRefused = true;
    let tooMany = false;
    // The rows passed over, each once however many households passed it over.
    const skipped = new Set<string>();
    progress?.(0);
    for (const [step, householdId] of householdIds.entries()) {
      const within = (done: number, total: number) => progress?.((step + (total > 0 ? done / total : 1)) / steps);
      try {
        // An unshare answers nothing, and a share that answers nothing passed no row over.
        const result: LedgerShareResult | void = await (kind === 'share'
          ? ledger.share(rows, householdId, within)
          : ledger.unshare(rows, householdId, within));
        for (const txId of (result as LedgerShareResult | undefined)?.skipped ?? []) skipped.add(txId);
        landed.push(householdId);
      } catch (error) {
        if (error instanceof sharing.LedgerShareRefusal && error.reason === 'tooMany') {
          tooMany = true;
          break;
        }
        if (error instanceof sharing.LedgerShareRefusal && error.reason === 'unshareable') {
          for (const txId of rows) skipped.add(txId);
          break;
        }
        failed.push(householdId);
        if (!(error instanceof sharing.LedgerShareRefusal && error.reason === 'notMember')) {
          onlyRefused = false;
          console.warn(`[RowSharing] A ${kind} of many rows into a household did not go through`, error);
        }
      }
      progress?.((step + 1) / steps);
    }

    if (landed.length > 0) this.revision.update(seq => seq + 1);
    const count = rows.length;
    if (tooMany) {
      this.notifications.error(this.translation.t('transactions.select.tooMany', { max: MAX_BULK_SHARE }));
      return { landed, failed: true };
    }
    if (failed.length > 0) {
      this.notifications.error(this.failureMessage(kind, count, targets, landed, failed, onlyRefused));
      return { landed, failed: true };
    }
    if (skipped.size > 0) {
      this.notifications.error(this.translation.t('transactions.select.unshareable', { count: skipped.size }));
      return { landed, failed: false };
    }

    const names = this.householdNames(landed, targets);
    const online = this.pwa.isOnline();
    if (kind === 'share' && !online) {
      this.notifications.info(this.translation.t('transactions.select.sharedOffline', { count, names }));
    } else if (kind === 'share') {
      this.notifications.success(this.translation.t('transactions.select.shared', { count, names }));
    } else {
      this.notifications.success(online
        ? this.translation.t('transactions.select.unshared', { count, names })
        : this.translation.t('transactions.select.unsharedOffline', { count, names }));
    }
    return { landed, failed: false };
  }

  /**
   * What a run of many rows that did not wholly go through says. Beside
   * households that took the rows, it names them and those that did not; it
   * says why only when every one that did not was refused for its
   * membership, the one reason the account can act on.
   */
  private failureMessage(
    kind: BulkShareKind,
    count: number,
    targets: readonly ShareTarget[],
    landed: readonly string[],
    failed: readonly string[],
    onlyRefused: boolean
  ): string {
    const names = this.householdNames(landed, targets);
    const failedNames = this.householdNames(failed, targets);
    if (landed.length === 0) {
      return onlyRefused
        ? this.translation.t('transactions.select.notMember', { name: failedNames })
        : this.translation.t('transactions.select.failed');
    }
    if (onlyRefused) return this.translation.t('transactions.select.partialNotMember', { count, names, failed: failedNames });
    return kind === 'share'
      ? this.translation.t('transactions.select.partialShared', { count, names, failed: failedNames })
      : this.translation.t('transactions.select.partialUnshared', { count, names, failed: failedNames });
  }

  /** Households by name, joined as one list; an id stands in for a name the targets do not hold. */
  private householdNames(ids: readonly string[], targets: readonly ShareTarget[]): string {
    return ids
      .map(id => targets.find(target => target.householdId === id)?.name ?? id)
      .join(this.translation.t('transactions.share.separator'));
  }

  /**
   * The sharing code, reached by dynamic import so it stays out of the
   * initial bundle. When it does not load, `failed` says so to the reader
   * and null comes back: nothing was changed.
   */
  private async loadLedger(
    failed: () => string
  ): Promise<{ sharing: typeof import('./ledger-share.service'); ledger: LedgerShareService } | null> {
    const sharing = await import('./ledger-share.service').catch(error => {
      console.warn('[RowSharing] The sharing code did not load; no share was changed', error);
      return null;
    });
    if (!sharing) {
      this.notifications.error(failed());
      return null;
    }
    return { sharing, ledger: this.injector.get(sharing.LedgerShareService) };
  }
}
