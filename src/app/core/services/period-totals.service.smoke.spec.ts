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
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { PeriodTotalsService } from './period-totals.service';
import { TransactionWindowService, MAX_WINDOW } from './transaction-window.service';
import { Transaction } from '../../models';
import { sumByType } from '../utils/transaction-aggregation.utils';
import { endOfDay } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for the period-totals sweep against the Firestore
 * emulator.
 *
 * The seam only observable here: the sweep must produce the same figure as
 * folding the entire seeded set, from real cursor-paged queries with real
 * where clauses — while the windowed list holds at most MAX_WINDOW rows and
 * trims under scroll. The unit suite drives a mock whose pages are sliced
 * arrays; this proves the document-snapshot cursors, the server-side range
 * bounds, and the live `amountInBase` repair of legacy rows against real
 * documents.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('PeriodTotalsService sweep (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  // Mid-day UTC so no assertion depends on the runner's zone; rows step 18
  // hours apart across ~90 days, far beyond any single window page.
  const BASE = Date.UTC(2026, 5, 30, 12);
  const HOUR = 60 * 60 * 1000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: PeriodTotalsService;
  let currencyService: CurrencyService;
  let firestoreService: FirestoreService;

  // 140 USD expenses with write-time snapshots, 15 EUR expenses whose
  // snapshot is the corrupt cross-currency shape amountInBase repairs by
  // live-converting (rate stored as 1 on a foreign row — the rules require
  // the fields, so a truly absent snapshot cannot be seeded), 5 USD incomes.
  // 160 rows so scrolling pushes the window past its trim threshold twice.
  // With the seeded EUR rate of 0.5 the exact totals are:
  //   expense = 140×10 + 15×20 = 1700, income = 5×100 = 500, balance = −1200.
  const SEEDED: Transaction[] = Array.from({ length: 160 }, (_, i) => {
    const id = `txn-${String(i).padStart(4, '0')}`;
    const date = Timestamp.fromMillis(BASE - i * 18 * HOUR);
    if (i % 8 === 5 && i < 40) {
      // 5 incomes, spread through the first pages.
      return {
        id,
        type: 'income',
        amount: 100,
        currency: 'USD',
        amountInBaseCurrency: 100,
        exchangeRate: 1,
        categoryId: 'cat-salary',
        description: `income ${i}`,
        date,
        isRecurring: false
      } as Transaction;
    }
    if (i % 8 === 1 && i < 120) {
      // 15 EUR rows in the corrupt cross-currency shape: a foreign row whose
      // stored rate is 1, which amountInBase rejects and live-converts
      // through the loaded table.
      return {
        id,
        type: 'expense',
        amount: 10,
        currency: 'EUR',
        amountInBaseCurrency: 10,
        exchangeRate: 1,
        categoryId: 'cat-food',
        description: `euro ${i}`,
        date,
        isRecurring: false
      } as Transaction;
    }
    return {
      id,
      type: 'expense',
      amount: 10,
      currency: 'USD',
      amountInBaseCurrency: 10,
      exchangeRate: 1,
      categoryId: 'cat-food',
      // One page-2-deep row carries a distinctive description for the
      // client-filter-over-the-whole-set case.
      description: i === 60 ? 'Aurora telescope deposit' : `expense ${i}`,
      date,
      isRecurring: false
    } as Transaction;
  });

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `period-totals-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // A rates cache leaked from another spec file would outrank the seeded
    // table under the initialization ladder.
    localStorage.removeItem('home-account.exchangeRates');

    // Seeded with the raw SDK: the TestBed cannot be configured here, because
    // beforeAll runs before the framework's per-test auto-reset.
    await Promise.all(
      SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      SEEDED.map(t =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        PeriodTotalsService,
        TransactionWindowService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        {
          provide: AuthService,
          useValue: {
            userId: () => uid,
            currentUser: () => ({ preferences: { baseCurrency: 'USD' } })
          }
        },
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ]
    });

    service = TestBed.inject(PeriodTotalsService);
    firestoreService = TestBed.inject(FirestoreService);
    // Four real cursor pages over the 160 seeded rows.
    service.sweepPageSize = 50;

    // The real CurrencyService, settled and then pinned: 0.5 differs from
    // the compiled-in 0.92 and from any live rate, so a fold that bypasses
    // the loaded table (or runs before it) produces a visibly wrong figure.
    currencyService = TestBed.inject(CurrencyService);
    await currencyService.ensureRatesLoaded();
    currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.5]]));
  });

  function expectedTotals(rows: Transaction[]) {
    return sumByType(rows, t => currencyService.amountInBase(t, 'USD'));
  }

  it('sweeps the whole set beyond the window cap, matching the dashboard fold', async () => {
    await service.reset({});

    expect(service.status().kind).toBe('ready');
    const totals = service.totals()!;
    expect(totals.count).toBe(160);
    expect(totals.expense).toBe(1700);
    expect(totals.income).toBe(500);
    expect(totals.balance).toBe(-1200);
    // The same figure the dashboard's fold produces over the same rows,
    // through the same amountInBase chokepoint.
    expect(totals).toEqual(expectedTotals(SEEDED));
  });

  it('repairs corrupt foreign snapshots through the loaded table, never at 1:1', async () => {
    await service.reset({});

    // 15 corrupt EUR rows at amount 10: trusting their stored snapshot
    // would contribute 150 total, the compiled-in fallback about 163; the
    // seeded 0.5 table makes 300.
    const euroContribution = service.totals()!.expense - 1400;
    expect(euroContribution).toBe(300);
  });

  it('does not move while the window scrolls and trims', async () => {
    await service.reset({});
    const before = service.totals();

    const windowSource = TestBed.inject(TransactionWindowService);
    await windowSource.reset();
    // Scroll to the far end: the window slides past MAX_WINDOW and trims
    // its head — the exact motion that made a window sum shrink.
    for (let i = 0; i < 20 && !windowSource.reachedEnd(); i++) {
      await windowSource.fetchNext();
    }
    expect(windowSource.reachedEnd()).toBeTrue();
    // The head was trimmed away and rows were lost from the window; a sum
    // over these rows could no longer see the whole set.
    expect(windowSource.reachedStart()).toBeFalse();
    expect(windowSource.window().length).toBeLessThan(SEEDED.length);
    expect(windowSource.window().length).toBeGreaterThanOrEqual(MAX_WINDOW);

    expect(service.totals()).toEqual(before);
  });

  it('applies a search over the whole swept set without re-reading', async () => {
    await service.reset({});

    const getPage = spyOn(firestoreService, 'getPage').and.callThrough();
    await service.reset({ searchQuery: 'aurora telescope' });

    // Row 60 lives on the second sweep page; the filter still finds it in
    // the cached rows, with zero additional server traffic.
    expect(getPage).not.toHaveBeenCalled();
    expect(service.status().kind).toBe('ready');
    expect(service.totals()!.count).toBe(1);
    expect(service.totals()!.expense).toBe(10);
  });

  it('scopes a server-side date range exactly', async () => {
    const startDate = new Date(BASE - 30 * 24 * HOUR);
    const endDate = new Date(BASE - 10 * 24 * HOUR);
    await service.reset({ startDate, endDate });

    // Expected membership mirrors buildTransactionWhere's own bounds
    // (including the endOfDay widening), so the assertion holds in any
    // runner timezone while still proving the range ran server-side.
    const inRange = SEEDED.filter(
      t =>
        t.date.toMillis() >= startDate.getTime() &&
        t.date.toMillis() <= endOfDay(endDate).getTime()
    );
    expect(inRange.length).toBeGreaterThan(10);
    expect(service.totals()).toEqual(expectedTotals(inRange));
  });
});
