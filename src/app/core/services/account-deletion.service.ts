import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppLockService } from './app-lock.service';
import { OfflineQueueService } from './offline-queue.service';
import { TransactionService } from './transaction.service';
import { CategoryService } from './category.service';
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { SearchHistoryService } from './search-history.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { CategoryMemoryService } from './category-memory.service';
import { GoalService } from './goal.service';
import { ImportHistoryService } from './import-history.service';
import { InsightSnapshotService } from './insight-snapshot.service';
import { ProviderKeyService } from './provider-key.service';
import { SecurityLogService } from './security-log.service';
import { ShareIntakeService } from './share-intake.service';
import { FirestoreService } from './firestore.service';

/**
 * Every step the cascade can report a failure for, in execution order.
 *
 * A list rather than a bare union because the data hub's catalogue is checked
 * against it: a new stored kind has to be given a door, or an explicit reason
 * for not having one, and only a runtime list can enforce that.
 */
export const DELETION_STEPS = [
  'reauth',
  'appLock',
  'offlineQueue',
  'shareStash',
  'transactions',
  'categories',
  'budgets',
  'recurring',
  'goals',
  'savedSearches',
  'searchAnswers',
  'categoryMemory',
  'imports',
  'insightSnapshots',
  'secrets',
  'securityEvents',
  'userDoc',
  'authUser'
] as const;

export type DeletionStep = (typeof DELETION_STEPS)[number];

export interface DeletionReport {
  ok: boolean;
  failed: { step: DeletionStep; error: unknown }[];
}

/**
 * Permanent account erasure as a client-side cascade: every users/{uid}
 * subcollection, the receipts in Storage (swept per transaction), the
 * device-local state keyed by the uid, the user document, and finally the
 * Firebase Auth user. There is no backend to fall back on — the Firestore
 * rules grant only the owner, so the signed-in session is the one principal
 * that can do this work.
 *
 * Best-effort by design: a mid-cascade failure (offline, revoked token)
 * reports the failed steps and leaves the session signed in so the user can
 * retry; every sweep is idempotent. The auth user is only deleted once every
 * cloud step succeeded, because deleting it earlier would sign the session
 * out and strand whatever rows remain behind owner-only rules.
 */
@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private authService = inject(AuthService);
  private appLock = inject(AppLockService);
  private offlineQueue = inject(OfflineQueueService);
  private shareIntake = inject(ShareIntakeService);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private budgetService = inject(BudgetService);
  private recurringService = inject(RecurringService);
  private searchHistory = inject(SearchHistoryService);
  private searchAnswers = inject(SearchAnswerHistoryService);
  private categoryMemory = inject(CategoryMemoryService);
  private goalService = inject(GoalService);
  private importHistory = inject(ImportHistoryService);
  private insightSnapshots = inject(InsightSnapshotService);
  private providerKeys = inject(ProviderKeyService);
  private securityLog = inject(SecurityLogService);
  private firestoreService = inject(FirestoreService);

  async deleteAccount(): Promise<DeletionReport> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const failed: DeletionReport['failed'] = [];

    // Fresh credentials first: deleteUser at the end demands a recent login,
    // and discovering that after the data is gone would strand a dead but
    // undeletable account. A failure here aborts with nothing touched.
    try {
      await this.authService.reauthenticate();
    } catch (error) {
      return { ok: false, failed: [{ step: 'reauth', error }] };
    }

    // Device-local state reads the signed-in uid, so it clears while the
    // session still exists. Failures report but never block the erasure:
    // an orphaned local record is junk on this device, not retained account
    // data in the cloud.
    await this.attempt('appLock', () => this.appLock.clearCredential(), failed);
    await this.attempt('offlineQueue', () => this.offlineQueue.clearAll(), failed);
    await this.attempt('shareStash', () => this.shareIntake.clearAll(), failed);

    // The cloud cascade runs every step even after one fails, so a retry has
    // less left to do. securityEvents goes last of the subcollections — while
    // earlier steps can still fail, the sign-in log is the record worth
    // keeping — and the user document falls after all of them.
    const cloudSteps: [DeletionStep, () => Promise<unknown>][] = [
      ['transactions', () => this.transactionService.deleteAllTransactions()],
      ['categories', () => this.categoryService.deleteAll()],
      ['budgets', () => this.budgetService.deleteAll()],
      ['recurring', () => this.recurringService.deleteAll()],
      ['goals', () => this.goalService.deleteAll()],
      ['savedSearches', () => this.searchHistory.deleteAll()],
      ['searchAnswers', () => this.searchAnswers.deleteAll()],
      ['categoryMemory', () => this.categoryMemory.deleteAll()],
      ['imports', () => this.importHistory.clearImportHistory()],
      ['insightSnapshots', () => this.insightSnapshots.deleteAll()],
      ['secrets', () => this.providerKeys.deleteAll()],
      ['securityEvents', () => this.securityLog.deleteAll(userId)],
      ['userDoc', () => this.firestoreService.deleteDocument(`users/${userId}`)]
    ];

    let cloudFailed = false;
    for (const [step, run] of cloudSteps) {
      const ok = await this.attempt(step, run, failed);
      cloudFailed = cloudFailed || !ok;
    }

    // Only a fully erased account loses its auth user; otherwise stay signed
    // in and report, so the remaining rows are still reachable on retry.
    if (!cloudFailed) {
      await this.attempt('authUser', () => this.authService.deleteFirebaseUser(), failed);
    }

    return { ok: failed.length === 0, failed };
  }

  private async attempt(
    step: DeletionStep,
    run: () => Promise<unknown> | void,
    failed: DeletionReport['failed']
  ): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (error) {
      failed.push({ step, error });
      return false;
    }
  }
}
