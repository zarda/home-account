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
 * normal case for a search opened from the dashboard.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('NlSearchService goal and budget scope (emulator smoke test)', () => {
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
        { provide: SearchAnswerHistoryService, useValue: { recordAnswer: () => Promise.resolve() } },
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

  it('sends the active goal and budget catalogs to the model from cold signals', async () => {
    // Nothing subscribed to GoalService or BudgetService in this TestBed, so
    // both signals are empty and the one-shot reads are the only source.
    interpretSearchQuery.and.resolveTo({ kind: 'filter', filters: {} });

    await service.search('how much toward the japan trip');

    const context = interpretSearchQuery.calls.mostRecent().args[1];
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
});
