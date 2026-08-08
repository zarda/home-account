// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  deleteDoc,
  Firestore
} from '@angular/fire/firestore';

import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService, GOAL_LINK_INVALID } from './transaction.service';
import { GoalService } from './goal.service';
import { CreateTransactionDTO, Goal, Transaction } from '../../models';

/**
 * Integration smoke test for goal-linked transactions against the emulators.
 *
 * The unit specs stub runTransaction, so they prove the arithmetic but not
 * that the paired writes clear txCreateValid/txUpdateValid and
 * goalUpdateValid in firestore.rules — a link transition that drops or
 * mistypes one field is invisible to a spy and a permission error in
 * production. What matters here is the invariant the feature sells: after
 * any sequence of link, edit, switch, unlink and delete, the goal's
 * linkedAmount equals the sum of the stored figures on its rows.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('Goal-linked transactions (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let transactionService: TransactionService;
  let goalService: GoalService;

  const createdGoals: string[] = [];
  const createdTransactions: string[] = [];

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `goal-link-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await Promise.all([
      ...createdTransactions.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      ),
      ...createdGoals.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/goals/${id}`)).catch(() => undefined)
      )
    ]);
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        GoalService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // A deliberately asymmetric cross-rate (×2) so a conversion that
        // silently degraded to 1:1 fails the assertions below.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1,
            convert: (amount: number, from: string, to: string) =>
              from === to ? amount : amount * 2
          }
        },
        // Receipts and quota are exercised in transaction-receipts.smoke.spec.ts;
        // no receipt files travel through these writes.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    transactionService = TestBed.inject(TransactionService);
    goalService = TestBed.inject(GoalService);
  });

  async function makeGoal(name: string, currency: string): Promise<string> {
    const id = await goalService.createGoal({
      kind: 'saving',
      name,
      targetAmount: 1000,
      currency
    });
    createdGoals.push(id);
    return id;
  }

  async function readGoal(id: string): Promise<Goal> {
    const snapshot = await getDoc(doc(firestore, `users/${uid}/goals/${id}`));
    return snapshot.data() as Goal;
  }

  async function readRow(id: string): Promise<Transaction | undefined> {
    const snapshot = await getDoc(doc(firestore, `users/${uid}/transactions/${id}`));
    return snapshot.data() as Transaction | undefined;
  }

  const dto = (goalId?: string): CreateTransactionDTO => ({
    type: 'expense',
    amount: 100,
    currency: 'USD',
    categoryId: 'cat-savings',
    description: 'Transfer to savings',
    date: new Date(2026, 5, 15, 12),
    ...(goalId ? { goalId } : {})
  });

  it('keeps the counter equal to the stored figures across the whole life cycle', async () => {
    const eurGoal = await makeGoal('EUR goal', 'EUR');
    const usdGoal = await makeGoal('USD goal', 'USD');

    // Link on add: 100 USD into a EUR goal converts through the ×2 stub.
    const rowId = await transactionService.addTransaction(dto(eurGoal));
    createdTransactions.push(rowId);
    expect((await readRow(rowId))?.goalId).toBe(eurGoal);
    expect((await readRow(rowId))?.goalAmount).toBe(200);
    expect((await readGoal(eurGoal)).linkedAmount).toBe(200);

    // An amount edit re-snapshots the stored figure and moves the counter.
    await transactionService.updateTransaction(rowId, { amount: 50 });
    expect((await readRow(rowId))?.goalAmount).toBe(100);
    expect((await readGoal(eurGoal)).linkedAmount).toBe(100);

    // A switch backs the old goal out and charges the new one in its own
    // currency (same currency here, so the raw amount).
    await transactionService.updateTransaction(rowId, { goalId: usdGoal });
    expect((await readRow(rowId))?.goalAmount).toBe(50);
    expect((await readGoal(eurGoal)).linkedAmount).toBe(0);
    expect((await readGoal(usdGoal)).linkedAmount).toBe(50);

    // Unlink clears the pair off the document entirely.
    await transactionService.updateTransaction(rowId, { goalId: undefined });
    const unlinked = await readRow(rowId);
    expect(unlinked && 'goalId' in unlinked).toBeFalse();
    expect(unlinked && 'goalAmount' in unlinked).toBeFalse();
    expect((await readGoal(usdGoal)).linkedAmount).toBe(0);

    // Relink, then delete: the delete backs the figure out again.
    await transactionService.updateTransaction(rowId, { goalId: usdGoal });
    expect((await readGoal(usdGoal)).linkedAmount).toBe(50);
    await transactionService.deleteTransaction(rowId);
    expect(await readRow(rowId)).toBeUndefined();
    expect((await readGoal(usdGoal)).linkedAmount).toBe(0);
  }, 30000);

  it('refuses a new link to a deactivated goal through the same rules', async () => {
    const goalId = await makeGoal('Paused goal', 'USD');
    await goalService.deactivateGoal(goalId);

    await expectAsync(transactionService.addTransaction(dto(goalId)))
      .toBeRejectedWithError(GOAL_LINK_INVALID);
    expect((await readGoal(goalId)).linkedAmount).toBe(0);
  }, 30000);

  it('restores links verbatim and recompute settles the counter from the ledger', async () => {
    // Restore order writes rows before their goals exist: the verbatim path
    // must clear the rules with the goal document absent.
    const rowId = `goal-link-restore-${Date.now()}`;
    await transactionService.addTransaction(dto(), {
      id: rowId,
      goalSnapshot: { goalId: 'goal-link-restored-goal', goalAmount: 77 }
    });
    createdTransactions.push(rowId);
    expect((await readRow(rowId))?.goalAmount).toBe(77);

    const goalId = await goalService.createGoal(
      { kind: 'saving', name: 'Restored goal', targetAmount: 1000, currency: 'USD' },
      { id: 'goal-link-restored-goal', contributedAmount: 5 }
    );
    createdGoals.push(goalId);
    // createGoal never trusts a backup's counter…
    expect((await readGoal(goalId)).linkedAmount).toBe(0);

    // …the recompute pass is what makes it agree with the ledger, and
    // running it twice must not double-count.
    await goalService.recomputeLinkedAmount(goalId);
    expect((await readGoal(goalId)).linkedAmount).toBe(77);
    await goalService.recomputeLinkedAmount(goalId);
    expect((await readGoal(goalId)).linkedAmount).toBe(77);
  }, 30000);

  it('deleteGoal sweeps its links off the rows that carried them', async () => {
    const goalId = await makeGoal('Swept goal', 'USD');
    const rowId = await transactionService.addTransaction(dto(goalId));
    createdTransactions.push(rowId);
    expect((await readRow(rowId))?.goalId).toBe(goalId);

    await goalService.deleteGoal(goalId);

    const row = await readRow(rowId);
    expect(row && 'goalId' in row).toBeFalse();
    expect(row && 'goalAmount' in row).toBeFalse();
  }, 30000);
});
