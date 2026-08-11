// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService } from './transaction.service';
import { BudgetService } from './budget.service';
import { Budget, Transaction } from '../../models';

/**
 * Integration smoke test for BudgetService.recalculateBudgetsForCategory
 * against the Firestore emulator.
 *
 * The unit spec can only assert against a mocked budget list. What broke in
 * production was the *work list*: the method filtered the in-memory
 * `budgets()` signal, which only a dashboard or budgets-page subscription
 * populates. In any session that never mounted either, the recalculation ran
 * against [] and silently skipped the spent update. The emulator cannot
 * reproduce a warm IndexedDB cache — what this suite proves is the fix's
 * contract: the recalculation enumerates the budgets collection and persists
 * `spent`, with the signal deliberately never populated.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('BudgetService.recalculateBudgetsForCategory (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: BudgetService;

  // Anchored to the real clock: the recalculation windows the current budget
  // period off `new Date()`, so the seeds must live in the current month.
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);

  const budgetRow = (id: string, overrides: Partial<Budget> = {}) => ({
    id,
    name: id,
    categoryId: 'cat-food',
    amount: 500,
    currency: 'USD',
    period: 'monthly' as const,
    startDate: Timestamp.fromDate(periodStart),
    spent: 0,
    isActive: true,
    alertThreshold: 80,
    ...overrides
  });

  const expenseRow = (id: string, amount: number, overrides: Partial<Transaction> = {}) => ({
    id,
    type: 'expense' as const,
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat-food',
    description: id,
    date: Timestamp.fromDate(now),
    isRecurring: false,
    ...overrides
  });

  const BUDGETS = [
    budgetRow('smoke-recalc-food-1'),
    budgetRow('smoke-recalc-food-2', { amount: 200 }),
    budgetRow('smoke-recalc-other', { categoryId: 'cat-transport', spent: 123 }),
    budgetRow('smoke-recalc-food-off', { isActive: false, spent: 77 })
  ];

  const EXPENSES = [
    expenseRow('smoke-recalc-t1', 40),
    expenseRow('smoke-recalc-t2', 25),
    // Outside the period window: must not count toward this period's spent.
    expenseRow('smoke-recalc-t3', 500, { date: Timestamp.fromDate(lastMonth) }),
    // Another category: invisible to the cat-food recalculation.
    expenseRow('smoke-recalc-t4', 999, { categoryId: 'cat-transport' })
  ];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `budget-recalc-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        BudgetService,
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: async () => undefined,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            convert: (amount: number) => amount
          }
        },
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(BudgetService);

    // Seeded per test: the second test removes a row.
    await Promise.all([
      ...BUDGETS.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/budgets/${id}`), { ...data, userId: uid })
      ),
      ...EXPENSES.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    ]);
  });

  const storedBudget = async (id: string): Promise<Budget> =>
    (await getDoc(doc(firestore, `users/${uid}/budgets/${id}`))).data() as Budget;

  it('writes spent for every active budget in the category with the signal never populated', async () => {
    // Nothing subscribed — the share-target / deep-link session shape.
    expect(service.budgets()).toEqual([]);

    await service.recalculateBudgetsForCategory('cat-food');

    // Both active cat-food budgets carry this period's 40 + 25.
    const food1 = await storedBudget('smoke-recalc-food-1');
    const food2 = await storedBudget('smoke-recalc-food-2');
    expect(food1.spent).toBe(65);
    expect(food2.spent).toBe(65);
    // The stamp records which period the figure belongs to.
    expect(food1.spentPeriod).toBeDefined();

    // The other category and the inactive budget are untouched.
    expect((await storedBudget('smoke-recalc-other')).spent).toBe(123);
    expect((await storedBudget('smoke-recalc-food-off')).spent).toBe(77);

    // The recalculation reads the collection; it never populates the signal.
    expect(service.budgets()).toEqual([]);
  }, 30000);

  it('lowers spent after a deletion the signal never saw', async () => {
    await service.recalculateBudgetsForCategory('cat-food');
    expect((await storedBudget('smoke-recalc-food-1')).spent).toBe(65);

    await deleteDoc(doc(firestore, `users/${uid}/transactions/smoke-recalc-t2`));
    await service.recalculateBudgetsForCategory('cat-food');

    expect((await storedBudget('smoke-recalc-food-1')).spent).toBe(40);
  }, 30000);
});
