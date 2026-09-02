// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
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

import { WeeklyRecapService } from './weekly-recap.service';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import { DateWindow } from '../utils/transaction-date.utils';
import {
  clearWeeklyRecapDeviceState,
  recapKey,
  recapWindow,
  weekBeforeWindow
} from '../utils/weekly-recap.utils';
import { Category, DEFAULT_USER_PREFERENCES, Transaction } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for the weekly recap's week bounds against the
 * Firestore emulator.
 *
 * The unit suite hands the service a map of hand-built rows keyed by the day
 * the window opened on, so it can prove which windows were asked for but never
 * which rows those windows actually select. `recapWindow` closes on
 * 23:59:59.999 and the next week opens one millisecond later; both bounds
 * reach Firestore as real `Timestamp`s and are compared by the query engine,
 * which is a comparison a Date-against-Date assertion cannot fail. Only a real
 * read shows a Sunday-night expense counted in the week it belongs to, and the
 * Monday that follows it counted in neither week the recap reads.
 *
 * The seed is millisecond-tight and relative to the clock rather than to a
 * fixed calendar week: "last week" moves every Monday, so a hard-coded week
 * would fall out of the recap the day after it was written.
 *
 * It lives in `test:smoke:dates` because every bound is built from local date
 * parts — at offset 0 a local midnight and a UTC midnight are the same
 * instant, and none of the assertions below can tell them apart.
 *
 * Runs only under the emulators:
 *   npm run smoke:dates
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('WeeklyRecapService week bounds (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: WeeklyRecapService;
  let generateNarrative: jasmine.Spy;

  /** The recapped week and the one before it, from a single clock reading. */
  let week: DateWindow;
  let previous: DateWindow;
  /** Ids written for the current case, so afterEach can take them all back. */
  let seeded: string[] = [];

  /**
   * One transaction document. `amountInBaseCurrency` and `exchangeRate` are
   * not decoration: firestore.rules refuses a create without either, and the
   * snapshot is the figure the CurrencyService double folds.
   */
  const row = (
    id: string,
    date: Date,
    amount: number,
    categoryId: string,
    type: 'income' | 'expense' = 'expense'
  ) => ({
    id,
    type,
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId,
    description: id,
    date: Timestamp.fromDate(date),
    isRecurring: false
  });

  /** 09:00 on the nth day of a week, from local parts as the windows are. */
  const dayIn = (start: Date, offset: number): Date =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 9);

  /**
   * The recapped week runs 70 + 90 + 60 + 60 + 50 = 330 out and 500 in over
   * six rows; the week before it, 100 + 20 = 120. Both neighbouring rows sit
   * one millisecond outside a bound, and their amounts are far enough from
   * everything else that a leak is unmistakable in the fold.
   *
   * cat-dining and cat-utilities tie at 60 for the third and last place the
   * card names, and the query returns cat-utilities first — so the cut is the
   * `compareIds` tiebreak's alone to decide.
   */
  const seedRows = () => [
    row('recap-first-ms', week.start, 70, 'cat-groceries'),
    row('recap-transport', dayIn(week.start, 1), 90, 'cat-transport'),
    row('recap-dining', dayIn(week.start, 2), 60, 'cat-dining'),
    row('recap-utilities', dayIn(week.start, 3), 60, 'cat-utilities'),
    row('recap-income', dayIn(week.start, 4), 500, 'cat-salary', 'income'),
    row('recap-last-ms', week.end, 50, 'cat-groceries'),
    // The live week's own first millisecond: recapped by nothing yet.
    row('recap-next-week-first-ms', new Date(week.end.getTime() + 1), 999, 'cat-groceries'),
    row('recap-prev-first-ms', previous.start, 100, 'cat-groceries'),
    row('recap-prev-last-ms', previous.end, 20, 'cat-groceries')
  ];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `weekly-recap-smoke-${Date.now()}`
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
    // One reading for both windows and the whole seed: two readings either
    // side of Sunday midnight would seed one week and assert against another.
    const now = new Date();
    week = recapWindow(now);
    previous = weekBeforeWindow(now);

    const rows = seedRows();
    seeded = rows.map(t => t.id);
    // Seeded with the raw SDK, before the TestBed exists: the recap reads
    // these back through the service under test rather than through a stub.
    await Promise.all(
      rows.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    );

    // A week dismissed by an earlier run gates load() before it reads
    // anything, and the narrative cache is the other half of the same pair.
    clearWeeklyRecapDeviceState(uid);

    generateNarrative = jasmine.createSpy('generatePatternNarrative');

    TestBed.configureTestingModule({
      providers: [
        WeeklyRecapService,
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        {
          provide: AuthService,
          useValue: {
            userId: () => uid,
            // load() composes nothing for an account that did not ask for the
            // recap, or while the user document has not landed.
            currentUser: () =>
              createMockUser(uid, {
                preferences: { ...DEFAULT_USER_PREFERENCES, enableWeeklyRecap: true }
              })
          }
        },
        // Answers from the row's own snapshot, so a figure below is the sum of
        // what was seeded rather than of a live rate table.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1
          }
        },
        // Empty, and no provider to ask: the narrative is gated twice over, so
        // nothing here spends a request on a week seeded for its bounds. The
        // real TranslationService injects HttpClient, which this suite has no
        // reason to stand up.
        { provide: CategoryService, useValue: { categories: signal<Category[]>([]) } },
        {
          provide: TranslationService,
          useValue: { t: (key: string) => key, currentLocale: signal('en') }
        },
        {
          provide: CloudLLMProviderService,
          useValue: {
            hasAnyCloudProvider: () => false,
            resolveProvider: () => null,
            generatePatternNarrative: generateNarrative
          }
        },
        {
          provide: AnalyticsService,
          useValue: { trackAiAssistUsed: jasmine.createSpy('trackAiAssistUsed') }
        },
        // Neither is reachable from the one-shot range read the recap makes.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });

    service = TestBed.inject(WeeklyRecapService);
  });

  afterEach(async () => {
    clearWeeklyRecapDeviceState(uid);
    await Promise.all(
      seeded.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
  });

  it('holds both millisecond edges of the recapped week, and nothing past them', async () => {
    // The two windows meet on adjacent milliseconds. That much a unit spec can
    // state; which side of the seam a row falls on is Firestore's answer to
    // give, from a stored Timestamp against a bound it converted itself.
    expect(previous.end.getTime() + 1).toBe(week.start.getTime());

    const transactions = TestBed.inject(TransactionService);
    const idsIn = async (window: DateWindow): Promise<string[]> =>
      (await transactions.getTransactionsInRangeOnce(window.start, window.end)).map(t => t.id);

    // Newest first, as the range query orders. The Monday one millisecond past
    // the end is absent, and so is the previous Sunday's last millisecond.
    expect(await idsIn(week)).toEqual([
      'recap-last-ms',
      'recap-income',
      'recap-utilities',
      'recap-dining',
      'recap-transport',
      'recap-first-ms'
    ]);

    expect(await idsIn(previous)).toEqual(['recap-prev-last-ms', 'recap-prev-first-ms']);
  }, 30000);

  it('folds the week it picked, and only that week', async () => {
    const read = spyOn(
      TestBed.inject(TransactionService), 'getTransactionsInRangeOnce').and.callThrough();

    await service.load();

    expect(service.status()).toBe('ready');
    expect(service.weekKey()).toBe(recapKey(week));
    // 999 landing in the spend, or 20 in either figure, is the boundary having
    // moved by a millisecond.
    expect(service.figures()).toEqual(
      jasmine.objectContaining({
        spend: 330,
        income: 500,
        count: 6,
        previousSpend: 120,
        spendDelta: 1.75
      })
    );
    expect(service.visible()).toBeTrue();
    expect(read).toHaveBeenCalledTimes(2);
  }, 30000);

  it('ranks the top three, with the tie at the cut broken by category id', async () => {
    await service.load();
    // The narrative effect only runs on a tick, and running it is what makes
    // "no provider was asked" an assertion rather than a tautology.
    TestBed.tick();

    expect(service.figures()?.topCategories).toEqual([
      { categoryId: 'cat-groceries', total: 120, count: 2, share: 0.3636 },
      { categoryId: 'cat-transport', total: 90, count: 1, share: 0.2727 },
      // Tied with cat-utilities at 60 and behind it in the query's own order,
      // so only the id tiebreak puts cat-dining inside the cut.
      { categoryId: 'cat-dining', total: 60, count: 1, share: 0.1818 }
    ]);
    expect(generateNarrative).not.toHaveBeenCalled();
  }, 30000);

  it('reads nothing on a second load in the same week', async () => {
    const read = spyOn(
      TestBed.inject(TransactionService), 'getTransactionsInRangeOnce').and.callThrough();

    await service.load();
    await service.load();

    // Memoised per account and week: a week that has ended does not move, so a
    // second dashboard open costs no query at all.
    expect(read).toHaveBeenCalledTimes(2);
    expect(service.status()).toBe('ready');
  }, 30000);
});
