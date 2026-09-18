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
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { filter, firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService, SPLIT_REFUSED } from './transaction.service';
import { BudgetService } from './budget.service';
import { Budget, Transaction } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { stripProviderKeys } from './testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

/**
 * Integration smoke test for the two split-purchase seams —
 * addSplitTransaction and splitTransaction — against the Firestore emulator
 * and the deployed rules.
 *
 * The unit spec mocks FirestoreService, so it can only assert on the
 * tx.set/tx.update calls the service made — never that the multi-document
 * write actually commits atomically, that a goal-linked row is refused
 * before the rules ever see a write, or that a real recalculation and a
 * real query round-trip the parts' categories through stored documents.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionService split purchase (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: TransactionService;
  let budgetService: BudgetService;

  // Anchored to the real clock, never jasmine.clock(): the budget
  // recalculation windows the current period off `new Date()`, and the
  // category-totals reader below is asked for the current month — both need
  // the rows this suite writes to actually fall inside "now".
  const now = new Date();
  const MONTH_START = new Date(now.getFullYear(), now.getMonth(), 1);
  const MONTH_END = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const written: string[] = [];

  const stored = async (id: string): Promise<Transaction> =>
    (await getDoc(doc(firestore, `users/${uid}/transactions/${id}`))).data() as Transaction;

  const expenseRow = (
    id: string,
    categoryId: string,
    amount: number,
    description: string,
    extra: Record<string, unknown> = {}
  ) => ({
    id,
    type: 'expense' as const,
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId,
    description,
    date: Timestamp.fromDate(now),
    isRecurring: false,
    ...extra
  });

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `transaction-split-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await Promise.all(
      written.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        BudgetService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // A loaded 1:1 table: a part's conversion is always the purchase's
        // own rate (docs/money-snapshots.md's never-re-rate rule), never
        // resolved again, so nothing here needs the real fetch-backed service.
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: async () => undefined,
            getExchangeRate: () => 1,
            convert: (amount: number) => amount,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount
          }
        },
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(TransactionService);
    budgetService = TestBed.inject(BudgetService);
  });

  it('writes the remainder and its parts as three documents sharing one splitGroupId', async () => {
    const ids = await service.addSplitTransaction(
      {
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'cat-split-add-purchase',
        description: 'Split add smoke',
        date: now
      },
      [
        { categoryId: 'cat-split-add-part-a', amount: 30 },
        { categoryId: 'cat-split-add-part-b', amount: 20 }
      ]
    );
    written.push(...ids);

    expect(ids.length).toBe(3);
    const [first, partA, partB] = await Promise.all(ids.map(stored));

    expect(first.amount).toBe(50);
    expect(partA.amount).toBe(30);
    expect(partB.amount).toBe(20);
    expect(first.splitGroupId).toBe(ids[0]);
    expect(partA.splitGroupId).toBe(ids[0]);
    expect(partB.splitGroupId).toBe(ids[0]);
    expect(first.createdAt).toBeInstanceOf(Timestamp);
    expect(partA.createdAt).toBeInstanceOf(Timestamp);
    expect(partB.createdAt).toBeInstanceOf(Timestamp);
  }, 20000);

  it('shrinks a stored row to its remainder and creates one part under the row\'s own id', async () => {
    const id = 'smoke-split-edit-purchase';
    await setDoc(doc(firestore, `users/${uid}/transactions/${id}`), {
      ...expenseRow(id, 'cat-split-edit-purchase', 100, 'Split edit smoke'),
      userId: uid
    });
    written.push(id);

    const partIds = await service.splitTransaction(id, [
      { categoryId: 'cat-split-edit-part', amount: 30 }
    ]);
    written.push(...partIds);

    const row = await stored(id);
    expect(row.amount).toBe(70);
    expect(row.splitGroupId).toBe(id);

    expect(partIds.length).toBe(1);
    const part = await stored(partIds[0]);
    expect(part.amount).toBe(30);
    expect(part.splitGroupId).toBe(id);
  }, 20000);

  it('refuses a goal-linked row, leaving it unchanged and writing no part', async () => {
    const id = 'smoke-split-goal-refusal';
    const description = 'Split refusal smoke goal row';
    await setDoc(doc(firestore, `users/${uid}/transactions/${id}`), {
      ...expenseRow(id, 'cat-split-goal-purchase', 100, description, {
        goalId: 'smoke-goal-does-not-need-to-exist',
        goalAmount: 100
      }),
      userId: uid
    });
    written.push(id);

    await expectAsync(
      service.splitTransaction(id, [{ categoryId: 'cat-split-goal-part', amount: 30 }])
    ).toBeRejectedWithError(SPLIT_REFUSED);

    const row = await stored(id);
    expect(row.amount).toBe(100);
    expect(row.goalId).toBe('smoke-goal-does-not-need-to-exist');

    // A part copies the purchase's own description; if the refused
    // transaction had committed anything, a second row carrying it would
    // exist alongside the original.
    const matches = await getDocs(
      query(
        collection(firestore, `users/${uid}/transactions`),
        where('description', '==', description)
      )
    );
    expect(matches.size).toBe(1);
  }, 20000);

  /**
   * Two budgets seeded the way budget-recalc.smoke.spec.ts seeds them: the
   * unit spec can only assert against a mocked budget list, never that a
   * real recalculation persists `spent` for each part's own category while
   * leaving the signal — which nothing here subscribes to — empty.
   */
  describe('budgets and the category sum for a split', () => {
    const budgetIds = ['smoke-split-budget-food', 'smoke-split-budget-home'];
    let ids: string[];

    const storedBudget = async (id: string): Promise<Budget> =>
      (await getDoc(doc(firestore, `users/${uid}/budgets/${id}`))).data() as Budget;

    afterAll(async () => {
      await Promise.all(
        budgetIds.map(id =>
          deleteDoc(doc(firestore, `users/${uid}/budgets/${id}`)).catch(() => undefined)
        )
      );
    });

    // Runs the write fresh per test and tears its rows down again: the
    // recalculation sums the whole category for the period, so a second
    // test reusing the first test's rows would double the total instead of
    // proving its own.
    afterEach(async () => {
      await Promise.all(
        ids.map(id => deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined))
      );
    });

    beforeEach(async () => {
      await Promise.all(
        budgetIds.map((id, i) =>
          setDoc(doc(firestore, `users/${uid}/budgets/${id}`), {
            userId: uid,
            name: id,
            categoryId: i === 0 ? 'cat-food' : 'cat-home',
            amount: 500,
            currency: 'USD',
            period: 'monthly',
            startDate: Timestamp.fromDate(MONTH_START),
            spent: 0,
            isActive: true,
            alertThreshold: 80
          })
        )
      );

      ids = await service.addSplitTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'cat-food',
          description: 'Split budget and totals smoke',
          date: now
        },
        [
          { categoryId: 'cat-home', amount: 30 },
          { categoryId: 'cat-transport', amount: 20 }
        ]
      );
    });

    it('recalculates spent for the purchase\'s category and each part\'s category, the signal never populated', async () => {
      // Nothing subscribed — the share-target / deep-link session shape
      // recalculateBudgetsForCategory has to work without.
      expect(budgetService.budgets()).toEqual([]);

      expect((await storedBudget('smoke-split-budget-food')).spent).toBe(50);
      expect((await storedBudget('smoke-split-budget-home')).spent).toBe(30);

      expect(budgetService.budgets()).toEqual([]);
    }, 20000);

    it('credits each category its own share of the purchase through getPeriodCategoryTotals', async () => {
      const expectedCategories = ['cat-food', 'cat-home', 'cat-transport'];
      // A listener started right after a three-document commit can settle
      // in more than one snapshot — the emulator delivering the last of a
      // transaction's writes a beat behind the rest. A dashboard bound to
      // this Observable would simply repaint on the later snapshot; the
      // filter waits for that same settled snapshot instead of asserting on
      // whichever one happens to arrive first.
      const totals = await firstValueFrom(
        service.getPeriodCategoryTotals(MONTH_START, MONTH_END).pipe(
          filter(t => expectedCategories.every(id => t.byCategory.some(c => c.categoryId === id)))
        )
      );
      const byId = new Map(totals.byCategory.map(c => [c.categoryId, c.total]));

      expect(byId.get('cat-food')).toBe(50);
      expect(byId.get('cat-home')).toBe(30);
      expect(byId.get('cat-transport')).toBe(20);
    }, 20000);
  });
});
