import type { Subscription } from 'rxjs';
import type { CollectionWithMetadata, FirestoreService, QueryOptions } from '../services/firestore.service';
import { LEDGER_VIEW_CAP } from '../../models';
import { isRefused } from './firebase-error.utils';

/** What one listener last said; `docs` is undefined until it answers. */
export interface CappedFeed<T> {
  docs?: readonly T[];
  /** It held more than LEDGER_VIEW_CAP documents, and only the first were kept. */
  truncated: boolean;
  fromCache: boolean;
  /** It failed, other than by a refusal, before the server answered. */
  incomplete: boolean;
}

/** A listener that has not answered. */
export const UNHEARD: CappedFeed<never> = { truncated: false, fromCache: false, incomplete: false };

export interface CappedFeedOptions {
  /**
   * Asks for one document past LEDGER_VIEW_CAP and keeps the first
   * LEDGER_VIEW_CAP, so a list that holds more is known to (`truncated`).
   */
  capped: boolean;
  /** Named in the warning a failure logs. */
  what: string;
  /** The logging service's prefix, such as "[HouseholdPlans]". */
  log: string;
}

/**
 * Opens one listener on a household's collection, handing each answer to
 * `heard`, and answers its subscription, or null when it failed while being
 * opened. Every household view that caps what it reads opens its listeners
 * here, so they agree on when a list is cut and when it is incomplete.
 *
 * A refusal is the rules saying the membership has ended: HouseholdService
 * reports that loss, and the listener stops quietly. Any other failure is
 * logged, and what was shown stays; a stopped listener hears nothing more,
 * so one the server never answered is reported answered with what the cache
 * held, or with nothing, and incomplete.
 */
export function openCappedFeed<T>(
  firestore: Pick<FirestoreService, 'subscribeToCollectionWithMetadata'>,
  path: string,
  query: QueryOptions,
  { capped, what, log }: CappedFeedOptions,
  heard: (feed: CappedFeed<T>) => void
): Subscription | null {
  let last: CappedFeed<T> = UNHEARD;
  const answer = (feed: CappedFeed<T>) => {
    last = feed;
    heard(feed);
  };
  const subscription = firestore
    .subscribeToCollectionWithMetadata<T>(path, capped ? { ...query, limit: LEDGER_VIEW_CAP + 1 } : query)
    .subscribe({
      next: ({ docs, fromCache }: CollectionWithMetadata<T>) => {
        const truncated = capped && docs.length > LEDGER_VIEW_CAP;
        answer({ docs: truncated ? docs.slice(0, LEDGER_VIEW_CAP) : docs, truncated, fromCache, incomplete: false });
      },
      error: (error: unknown) => {
        if (isRefused(error)) return;
        console.warn(`${log} The ${what} listener stopped:`, error);
        if (last.docs === undefined || last.fromCache) answer({ ...last, docs: last.docs ?? [], incomplete: true });
      }
    });
  return subscription.closed ? null : subscription;
}
