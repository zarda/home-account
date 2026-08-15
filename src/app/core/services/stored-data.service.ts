import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { DeletionStep } from './account-deletion.service';
import { FirestoreService } from './firestore.service';

/** One kind of stored record, and the door that manages it. */
export interface StoredDataKind {
  /** The cascade step that erases this kind. Keeps the two lists in step. */
  readonly id: DeletionStep;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly icon: string;
  readonly route: string;
  readonly queryParams?: Readonly<Record<string, string>>;
  /**
   * The `users/{uid}` subcollection to count, or null when the kind has no
   * countable collection behind it.
   */
  readonly subcollection: string | null;
}

/**
 * Every kind of stored record, in the order the hub lists them.
 *
 * The ids are `DeletionStep` values on purpose: the deletion cascade is the
 * only place that already enumerated everything the app stores, and a
 * catalogue that drifts from it is a catalogue that has quietly lost a record
 * kind. `stored-data.service.spec.ts` fails when the two disagree.
 */
export const STORED_DATA_KINDS: readonly StoredDataKind[] = [
  {
    id: 'transactions',
    labelKey: 'data.kinds.transactions.label',
    descriptionKey: 'data.kinds.transactions.description',
    icon: 'receipt_long',
    route: '/transactions',
    subcollection: 'transactions'
  },
  {
    id: 'categories',
    labelKey: 'data.kinds.categories.label',
    descriptionKey: 'data.kinds.categories.description',
    icon: 'category',
    route: '/settings',
    queryParams: { panel: 'categories' },
    subcollection: 'categories'
  },
  {
    id: 'budgets',
    labelKey: 'data.kinds.budgets.label',
    descriptionKey: 'data.kinds.budgets.description',
    icon: 'savings',
    route: '/budgets',
    queryParams: { tab: 'budgets' },
    subcollection: 'budgets'
  },
  {
    id: 'recurring',
    labelKey: 'data.kinds.recurring.label',
    descriptionKey: 'data.kinds.recurring.description',
    icon: 'repeat',
    route: '/budgets',
    queryParams: { tab: 'recurring' },
    subcollection: 'recurring'
  },
  {
    id: 'goals',
    labelKey: 'data.kinds.goals.label',
    descriptionKey: 'data.kinds.goals.description',
    icon: 'flag',
    route: '/budgets',
    queryParams: { tab: 'goals' },
    subcollection: 'goals'
  },
  {
    id: 'savedSearches',
    labelKey: 'data.kinds.savedSearches.label',
    descriptionKey: 'data.kinds.savedSearches.description',
    icon: 'bookmark',
    route: '/transactions',
    subcollection: 'savedSearches'
  },
  {
    id: 'searchAnswers',
    labelKey: 'data.kinds.searchAnswers.label',
    descriptionKey: 'data.kinds.searchAnswers.description',
    icon: 'question_answer',
    route: '/search-history',
    subcollection: 'searchAnswers'
  },
  {
    id: 'categoryMemory',
    labelKey: 'data.kinds.categoryMemory.label',
    descriptionKey: 'data.kinds.categoryMemory.description',
    icon: 'psychology',
    route: '/ai',
    subcollection: 'categoryMemory'
  },
  {
    id: 'imports',
    labelKey: 'data.kinds.imports.label',
    descriptionKey: 'data.kinds.imports.description',
    icon: 'upload_file',
    route: '/import/history',
    subcollection: 'imports'
  },
  {
    id: 'insightSnapshots',
    labelKey: 'data.kinds.insightSnapshots.label',
    descriptionKey: 'data.kinds.insightSnapshots.description',
    icon: 'insights',
    route: '/reports',
    queryParams: { tab: 'insights' },
    subcollection: 'insightSnapshots'
  },
  {
    id: 'secrets',
    labelKey: 'data.kinds.secrets.label',
    descriptionKey: 'data.kinds.secrets.description',
    icon: 'key',
    route: '/ai',
    // users/{uid}/secrets/providers is one document holding the encrypted
    // keys, not a collection of records. Counting it would report 1, and
    // reading it to count the configured providers would decrypt secrets for
    // a number nobody needs.
    subcollection: null
  },
  {
    id: 'securityEvents',
    labelKey: 'data.kinds.securityEvents.label',
    descriptionKey: 'data.kinds.securityEvents.description',
    icon: 'security',
    route: '/settings',
    subcollection: 'securityEvents'
  },
  {
    id: 'feedback',
    labelKey: 'data.kinds.feedback.label',
    descriptionKey: 'data.kinds.feedback.description',
    icon: 'feedback',
    route: '/about',
    subcollection: 'feedback'
  }
];

/**
 * Cascade steps that are deliberately not record kinds, and why.
 *
 * The parity spec reads this, so adding a step to the cascade forces a
 * decision here rather than silently leaving the new records without a door.
 */
export const NOT_A_RECORD_KIND: Readonly<Record<string, string>> = {
  reauth: 'A credentials check, not stored data.',
  appLock: 'Device-local: the lock credential never leaves this device.',
  offlineQueue: 'Device-local: queued receipts drain into transactions on reconnect.',
  shareStash: 'Device-local: files shared into the app await import on this device.',
  userDoc: 'The profile document itself, managed from Settings.',
  authUser: 'The Firebase Auth user, not a collection of records.'
};

/** Absent while a count is in flight, null once it is known to be unavailable. */
export type StoredDataCounts = Partial<Record<DeletionStep, number | null>>;

/**
 * What the app has stored, and how much of it.
 *
 * Counts come from `getCountFromServer`, which aggregates server-side and
 * downloads no documents — the difference between a page that costs thirteen
 * reads and one that costs the whole account. It is also server-only: it does
 * not fall back to the offline cache, so a count that cannot be fetched
 * resolves to null and the row shows a dash. A wrong number on a page whose
 * whole job is telling you what you have stored is worse than no number.
 *
 * Each kind resolves independently rather than through one `Promise.all`
 * result, so a slow collection delays its own row and nothing else.
 */
@Injectable({ providedIn: 'root' })
export class StoredDataService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  private _counts = signal<StoredDataCounts>({});

  readonly kinds = STORED_DATA_KINDS;
  readonly counts = computed(() => this._counts());

  constructor() {
    // Signing out drops the numbers with the session: the next account to
    // sign in on a shared device must never see the previous one's totals.
    effect(() => {
      if (this.authService.userId() === null) {
        this._counts.set({});
      }
    });
  }

  /**
   * Fetch every countable kind at once, writing each into the signal as it
   * lands. Resolves when they all have, but the page renders from the signal
   * and does not wait.
   */
  async loadCounts(): Promise<void> {
    const userId = this.authService.userId();
    this._counts.set({});
    if (!userId) return;

    await Promise.all(
      STORED_DATA_KINDS.filter(kind => kind.subcollection !== null).map(kind =>
        this.loadCount(userId, kind)
      )
    );
  }

  private async loadCount(userId: string, kind: StoredDataKind): Promise<void> {
    try {
      const count = await this.firestoreService.countDocuments(
        `users/${userId}/${kind.subcollection}`
      );
      this.publish(userId, kind.id, count);
    } catch (error) {
      console.warn(`[StoredData] Count unavailable for ${kind.id}:`, error);
      this.publish(userId, kind.id, null);
    }
  }

  /**
   * Drop a result that outlived its session. Twelve counts are in flight at
   * once and a sign-out mid-flight would otherwise land one account's totals
   * in the next account's page.
   */
  private publish(userId: string, id: DeletionStep, count: number | null): void {
    if (this.authService.userId() !== userId) return;
    this._counts.update(counts => ({ ...counts, [id]: count }));
  }
}
