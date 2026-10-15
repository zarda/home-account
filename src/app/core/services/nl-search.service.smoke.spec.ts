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
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';

import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { AIStrategyService } from './ai-strategy.service';
import { AnalyticsService } from './analytics.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { GoalService } from './goal.service';
import { NlSearchService } from './nl-search.service';
import { PwaService } from './pwa.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { SearchHistoryService } from './search-history.service';
import { TransactionService } from './transaction.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { Transaction } from '../../models';
import { dayKey } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { createCategory } from './testing/test-data';
silenceFirebaseWarnings();

/**
 * Integration smoke test for the goal- and budget-aware smart search against
 * the emulators.
 *
 * `replayAggregate()` never calls the model, so the whole aggregate path —
 * the ranged fetch, the scope narrowing, the arithmetic — is testable for
 * real. The unit spec feeds it a stubbed array; here the rows come back from
 * Firestore, which is what proves the goal scope survives a round trip
 * through stored documents rather than only through a fixture.
 *
 * The catalog half proves the other seam: the goal and budget lists reach the
 * model's context even when no page has warmed either signal, which is the
 * normal case for a search opened from the dashboard. The category catalog
 * does the same from a cold category signal, for the roll-up as well as for
 * the model's list.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('NlSearchService goal and budget scope, ties and the cold category catalog (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  const AUGUST = new Date(2026, 7, 15, 12);

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: NlSearchService;
  let interpretSearchQuery: jasmine.Spy;

  const row = (id: string, amount: number, goalId?: string) => ({
    id,
    userId: '',
    type: 'expense' as const,
    amount,
    currency: 'USD',
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    categoryId: 'cat-savings',
    description: id,
    date: Timestamp.fromDate(AUGUST),
    isRecurring: false,
    ...(goalId ? { goalId, goalAmount: amount } : {})
  });

  // A row in a category and on a day of its own, in the same stored shape as
  // `row`. Two cases write through it: the tie case in September, and the
  // cold category catalog's roll-up in October. Neither month is the August
  // window the goal and budget cases pin, so those never see these rows.
  const tieRow = (id: string, categoryId: string, amount: number, date: Date) => ({
    ...row(id, amount),
    categoryId,
    date: Timestamp.fromDate(date)
  });

  const SEEDED = [
    row('nl-smoke-linked-1', 100, 'nl-smoke-goal-a'),
    row('nl-smoke-linked-2', 40, 'nl-smoke-goal-a'),
    row('nl-smoke-other-goal', 999, 'nl-smoke-goal-b'),
    row('nl-smoke-unlinked', 555)
  ];

  const GOALS = [
    { id: 'nl-smoke-goal-a', name: 'Japan trip', isActive: true },
    { id: 'nl-smoke-goal-b', name: 'Emergency fund', isActive: true },
    { id: 'nl-smoke-goal-retired', name: 'Old goal', isActive: false }
  ];

  const BUDGETS = [
    { id: 'nl-smoke-budget', name: 'Groceries', categoryId: 'cat-groceries', isActive: true }
  ];

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `nl-search-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded with the raw SDK: beforeAll runs before the per-test TestBed.
    await Promise.all([
      ...SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      ),
      ...GOALS.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/goals/${id}`), {
          ...data,
          userId: uid,
          kind: 'saving',
          targetAmount: 1000,
          contributedAmount: 0,
          linkedAmount: 0,
          currency: 'USD'
        })
      ),
      ...BUDGETS.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/budgets/${id}`), {
          ...data,
          userId: uid,
          amount: 400,
          currency: 'USD',
          period: 'monthly',
          startDate: Timestamp.fromDate(new Date(2026, 0, 10)),
          spent: 0,
          alertThreshold: 80
        })
      )
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      ...SEEDED.map(t =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
      ),
      ...GOALS.map(g =>
        deleteDoc(doc(firestore, `users/${uid}/goals/${g.id}`)).catch(() => undefined)
      ),
      ...BUDGETS.map(b =>
        deleteDoc(doc(firestore, `users/${uid}/budgets/${b.id}`)).catch(() => undefined)
      )
    ]);
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    interpretSearchQuery = jasmine.createSpy('interpretSearchQuery');

    TestBed.configureTestingModule({
      providers: [
        NlSearchService,
        GoalService,
        BudgetService,
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // The model is the one thing that cannot run here; everything it
        // would decide is fed in directly.
        { provide: CloudLLMProviderService, useValue: { interpretSearchQuery } },
        { provide: AIStrategyService, useValue: { canUseCloud: () => true } },
        { provide: PwaService, useValue: { isOnline: () => true } },
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1,
            convert: (amount: number) => amount
          }
        },
        { provide: SearchHistoryService, useValue: { recordRecent: () => Promise.resolve() } },
        {
          provide: SearchAnswerHistoryService,
          // A filter reading is recorded too; without recordFilter a search
          // that interprets to a filter threw into the keyword fallback.
          useValue: { recordAnswer: () => Promise.resolve(), recordFilter: () => Promise.resolve() }
        },
        { provide: AnalyticsService, useValue: { trackAiAssistUsed: () => undefined } },
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(NlSearchService);
  });

  it('sums only the rows linked to the goal, read back from Firestore', async () => {
    const answer = await service.replayAggregate(
      'sum',
      {
        goalId: 'nl-smoke-goal-a',
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 7, 31, 23, 59, 59, 999)
      },
      3
    );

    // 100 + 40; the other goal's 999 and the unlinked 555 stay out.
    expect(answer.value).toBe(140);
    expect(answer.transactionCount).toBe(2);
  }, 30000);

  it('counts every row in the window when no goal narrows it', async () => {
    // The control: without the goal scope the same window is much larger, so
    // the assertion above cannot be passing by an empty fetch.
    const answer = await service.replayAggregate(
      'sum',
      { startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 31, 23, 59, 59, 999) },
      3
    );

    expect(answer.transactionCount).toBe(4);
    expect(answer.value).toBe(1694);
  }, 30000);

  // The figures a replay produces are written back to the account's stored
  // answer, so they have to enumerate rather than take a live listener's
  // first emission (docs/one-shot-reads.md). The emulator has no persistent
  // cache, so what this proves is the door — that the rows arrive without a
  // listener being opened at all; the cached-first emission itself is pinned
  // in nl-search.service.spec.ts.
  it('reads the rows without opening a listener', async () => {
    const listener = spyOn(TestBed.inject(FirestoreService), 'subscribeToCollection')
      .and.callThrough();

    const answer = await service.replayAggregate(
      'sum',
      { startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 31, 23, 59, 59, 999) },
      3
    );

    expect(answer.value).toBe(1694);
    expect(listener).not.toHaveBeenCalled();
  }, 30000);

  // Rows come back date-descending, so the later 'tie-b-kid' row reaches the
  // fold before 'tie-a' and its parent 'tie-b' is inserted first: with a sort
  // on the total alone the limit keeps 'tie-b', the higher id, on arrival.
  it('ranks a tie among parents at the limit by category id', async () => {
    const rows = [
      tieRow('nl-smoke-tie-top', 'tie-top', 80, new Date(2026, 8, 10, 12)),
      tieRow('nl-smoke-tie-b-kid', 'tie-b-kid', 40, new Date(2026, 8, 15, 12)),
      tieRow('nl-smoke-tie-a', 'tie-a', 40, new Date(2026, 8, 15, 9))
    ];
    TestBed.inject(CategoryService).categories.set([
      createCategory({ id: 'tie-top', name: 'Top', type: 'expense' }),
      createCategory({ id: 'tie-a', name: 'A', type: 'expense' }),
      createCategory({ id: 'tie-b', name: 'B', type: 'expense' }),
      createCategory({ id: 'tie-b-kid', name: 'B kid', type: 'expense', parentId: 'tie-b' })
    ]);

    try {
      await Promise.all(rows.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      ));

      const answer = await service.replayAggregate(
        'topCategories',
        { startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 30, 23, 59, 59, 999) },
        2
      );

      expect(answer.groups).toEqual([
        { categoryId: 'tie-top', total: 80 },
        { categoryId: 'tie-a', total: 40 }
      ]);
    } finally {
      await Promise.all(rows.map(t =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
      ));
    }
  }, 30000);

  it('sends the active goal and budget catalogs to the model from cold signals', async () => {
    // Nothing subscribed to GoalService or BudgetService in this TestBed, so
    // both signals are empty and the one-shot reads are the only source.
    interpretSearchQuery.and.resolveTo({ kind: 'filter', filters: {} });

    await service.search('how much toward the japan trip');

    const context = interpretSearchQuery.calls.mostRecent().args[1];
    expect(context.today).toBe(dayKey(new Date()));
    expect(context.goals).toContain(
      jasmine.objectContaining({ id: 'nl-smoke-goal-a', name: 'Japan trip' })
    );
    // Deactivated goals are not offered as scope targets.
    expect(context.goals.some((g: { id: string }) => g.id === 'nl-smoke-goal-retired')).toBeFalse();
    expect(context.budgets).toContain(jasmine.objectContaining({
      id: 'nl-smoke-budget',
      categoryId: 'cat-groceries',
      period: 'monthly',
      anchor: '2026-01-10'
    }));
  }, 30000);

  // The category half of the same seam. Nothing in this TestBed subscribed to
  // CategoryService, so its signal is empty and holds no built-in either: the
  // rollup and the model's catalog come from one stored read merged over the
  // built-ins. October holds these rows alone (every other case pins August or
  // September), and the rows and the custom category are deleted in a `finally`.
  describe('from a cold category catalog', () => {
    const CHILD_ID = 'nl-smoke-cold-mine';
    const childPath = () => `users/${uid}/categories/${CHILD_ID}`;

    // The shape categoryCreateValid accepts: every required field and the
    // owner stamp, plus the parent the rollup follows.
    const customChild = () => ({
      userId: uid,
      name: 'Mine',
      icon: 'category',
      color: '#607D8B',
      type: 'expense',
      order: 900,
      isActive: true,
      isDefault: false,
      parentId: 'bills'
    });

    it('rolls a built-in child and a stored custom child into their parent', async () => {
      const rows = [
        tieRow('nl-smoke-cold-bills', 'bills', 10, new Date(2026, 9, 3, 12)),
        tieRow('nl-smoke-cold-electricity', 'bills_electricity', 20, new Date(2026, 9, 4, 12)),
        tieRow('nl-smoke-cold-custom', CHILD_ID, 40, new Date(2026, 9, 5, 12)),
        tieRow('nl-smoke-cold-transport', 'transport', 5, new Date(2026, 9, 6, 12))
      ];
      const listener = spyOn(TestBed.inject(FirestoreService), 'subscribeToCollection')
        .and.callThrough();

      try {
        await setDoc(doc(firestore, childPath()), customChild());
        await Promise.all(rows.map(({ id, ...data }) =>
          setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
        ));
        expect(TestBed.inject(CategoryService).categories()).toEqual([]);

        const answer = await service.replayAggregate(
          'topCategories',
          { startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31, 23, 59, 59, 999) },
          5
        );

        // Four groups without the catalog: 'bills', 'bills_electricity', the
        // custom id and 'transport'.
        expect(answer.groups).toEqual([
          { categoryId: 'bills', total: 70 },
          { categoryId: 'transport', total: 5 }
        ]);
        // The read is one-shot: no listener opened to warm the signal.
        expect(listener).not.toHaveBeenCalled();
      } finally {
        await Promise.all([
          deleteDoc(doc(firestore, childPath())).catch(() => undefined),
          ...rows.map(t =>
            deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
          )
        ]);
      }
    }, 30000);

    it('sends the model the built-in and the stored categories together', async () => {
      interpretSearchQuery.and.resolveTo({ kind: 'filter', filters: {} });

      try {
        await setDoc(doc(firestore, childPath()), customChild());

        const result = await service.search('what did I spend on bills');

        expect(result.kind).toBe('filter');
        const context = interpretSearchQuery.calls.mostRecent().args[1];
        const ids = context.categories.map((c: { id: string }) => c.id);
        expect(ids).toContain('bills_electricity');
        expect(ids).toContain(CHILD_ID);
      } finally {
        await deleteDoc(doc(firestore, childPath())).catch(() => undefined);
      }
    }, 30000);
  });
});
