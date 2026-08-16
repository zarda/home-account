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
import { firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService } from './transaction.service';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';
import { Transaction } from '../../models';

/**
 * Integration smoke test for the two range readers of TransactionService
 * against the Firestore emulator.
 *
 * The monthly comparison report fetches a second, year-earlier window while
 * the current one is on screen. That is only safe because
 * getTransactionsInRange() does not write the shared `transactions` signal
 * the way getByDateRange() does — a distinction that lives in the
 * interaction between the two methods and real query results, not in either
 * one alone. If it ever regressed, every report tab would silently render
 * last year's rows.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionService date ranges (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: TransactionService;

  const row = (id: string, type: 'income' | 'expense', date: Date) => ({
    id,
    type,
    amount: 100,
    amountInBaseCurrency: 100,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: type === 'income' ? 'cat-salary' : 'cat-food',
    description: id,
    date: Timestamp.fromDate(date),
    isRecurring: false
  });

  // Two months of the current year, the same two months a year earlier, and
  // one row outside both windows.
  const SEEDED = [
    row('smoke-range-2026-06', 'expense', new Date(2026, 5, 15, 12)),
    row('smoke-range-2026-07', 'income', new Date(2026, 6, 10, 12)),
    row('smoke-range-2025-06', 'expense', new Date(2025, 5, 15, 12)),
    row('smoke-range-2025-07', 'income', new Date(2025, 6, 10, 12)),
    row('smoke-range-2024-12', 'expense', new Date(2024, 11, 5, 12)),
    // Carries a location, to prove the country derived on device survives a
    // write and a read back. A field the rules accept but the service drops on
    // the way through looks exactly like a working feature in unit tests.
    {
      ...row('smoke-range-2026-06-located', 'expense', new Date(2026, 5, 16, 12)),
      location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71, country: 'JP' }
    }
  ];

  const CURRENT_START = new Date(2026, 5, 1);
  const CURRENT_END = new Date(2026, 6, 31);
  const PRIOR_START = new Date(2025, 5, 1);
  const PRIOR_END = new Date(2025, 6, 31);

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `transaction-range-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Rates play no part in a range read; a stub keeps the suite hermetic.
        // The write path also asks for them, so it gets a loaded 1:1 table.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1
          }
        },
        // Receipts and quota are exercised in transaction-receipts.smoke.spec.ts;
        // neither is reachable from the read paths under test.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(TransactionService);
  });

  it('returns only the prior-year rows for a shifted range', async () => {
    const rows = await firstValueFrom(service.getTransactionsInRange(PRIOR_START, PRIOR_END));

    // Date descending, as the query orders them.
    expect(rows.map(t => t.id)).toEqual(['smoke-range-2025-07', 'smoke-range-2025-06']);
  }, 20000);

  it('round-trips the country derived from a location', async () => {
    const rows = await firstValueFrom(service.getTransactionsInRange(CURRENT_START, CURRENT_END));
    const located = rows.find(t => t.id === 'smoke-range-2026-06-located');

    expect(located?.location).toEqual(
      jasmine.objectContaining({ name: 'Aoyama Market', country: 'JP' })
    );
  }, 20000);

  it('leaves the shared transactions signal untouched', async () => {
    await firstValueFrom(service.getByDateRange(CURRENT_START, CURRENT_END));
    const onScreen = ['smoke-range-2026-07', 'smoke-range-2026-06-located', 'smoke-range-2026-06'];
    expect(service.transactions().map(t => t.id)).toEqual(onScreen);

    await firstValueFrom(service.getTransactionsInRange(PRIOR_START, PRIOR_END));

    // The whole year-over-year feature rests on this: the reports page holds
    // the current window in this signal while fetching the year-earlier one.
    expect(service.transactions().map(t => t.id)).toEqual(onScreen);
  }, 20000);

  it('a bare getTransactions query cannot repaint the published window', async () => {
    await firstValueFrom(service.getByDateRange(CURRENT_START, CURRENT_END));
    const onScreen = service.transactions().map(t => t.id);
    expect(onScreen.length).toBeGreaterThan(0);

    // Duplicate detection and AI import run getTransactions with their own
    // narrow filters. Against the emulator this range returns a different row
    // set, so a leaked publish would repaint the window and fail the check.
    const priorRows = await firstValueFrom(
      service.getTransactions({ startDate: PRIOR_START, endDate: PRIOR_END })
    );
    expect(priorRows.map(t => t.id)).not.toEqual(onScreen);

    expect(service.transactions().map(t => t.id)).toEqual(onScreen);
  }, 20000);

  it('includes both income and expense rows in the prior window', async () => {
    const rows = await firstValueFrom(service.getTransactionsInRange(PRIOR_START, PRIOR_END));

    // getExpensesByCategory-style type filtering must not leak into this path:
    // a year-over-year income comparison needs both halves.
    expect(rows.map(t => t.type).sort()).toEqual(['expense', 'income']);
  }, 20000);

  /**
   * A receipt's date arrives as `YYYY-MM-DD` and has to survive being parsed,
   * converted to a Timestamp, stored, and matched by a range query. Every step
   * of that is a chance to lose a day, and the unit suite sees none of it: it
   * stops at the literal handed to a mocked FirestoreService.
   *
   * This is zone-sensitive on purpose. At UTC it passes either way, which is
   * why CI runs this file again under TZ=America/New_York and TZ=Asia/Tokyo
   * (`npm run smoke:dates`) — west of UTC is where the old UTC parse put a
   * 1 August receipt in July, in July's budget and July's monthly comparison.
   */
  describe('a date-only receipt date', () => {
    const AUGUST_START = new Date(2026, 7, 1);
    const AUGUST_END = new Date(2026, 7, 31);
    let id: string;

    beforeEach(async () => {
      id = await service.addTransaction({
        type: 'income',
        amount: 42.5,
        currency: 'USD',
        categoryId: 'cat-salary',
        description: 'First of the month',
        date: parseDateInput('2026-08-01')!
      });
    });

    afterEach(async () => {
      await deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined);
    });

    it('falls inside the month the receipt names', async () => {
      const rows = await firstValueFrom(service.getTransactionsInRange(AUGUST_START, AUGUST_END));

      expect(rows.map(t => t.id)).toContain(id);
    }, 20000);

    it('does not fall into the month before it', async () => {
      const rows = await firstValueFrom(
        service.getTransactionsInRange(new Date(2026, 6, 1), new Date(2026, 6, 31))
      );

      expect(rows.map(t => t.id)).not.toContain(id);
    }, 20000);

    it('reads back as the first of August, not the last of July', async () => {
      const snapshot = await getDoc(doc(firestore, `users/${uid}/transactions/${id}`));

      expect(dayKey((snapshot.data()!['date'] as Timestamp).toDate())).toBe('2026-08-01');
    }, 20000);
  });

  /**
   * The unit suite can only assert the literal handed to a mocked
   * FirestoreService. It cannot catch a rules rejection, and it cannot catch a
   * deleteField() that never reaches the document — both of which look exactly
   * like a working feature until someone reopens the transaction.
   *
   * Income, so the write does not pull BudgetService in behind it.
   */
  describe('budget period round-trip', () => {
    const written: string[] = [];

    afterAll(async () => {
      await Promise.all(
        written.map(id =>
          deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
        )
      );
    });

    const add = async (period?: 'weekly' | 'monthly' | 'yearly') => {
      const id = await service.addTransaction({
        type: 'income',
        amount: 100,
        currency: 'USD',
        categoryId: 'cat-salary',
        description: 'Period round-trip',
        date: new Date(2026, 5, 20, 12),
        ...(period ? { period } : {})
      });
      written.push(id);
      return id;
    };

    const stored = async (id: string) =>
      (await getDoc(doc(firestore, `users/${uid}/transactions/${id}`))).data() ?? {};

    it('keeps the period through a real write and read back', async () => {
      const id = await add('monthly');
      expect((await stored(id))['period']).toBe('monthly');
    }, 20000);

    it('omits the field entirely when no period was chosen', async () => {
      const id = await add();
      expect('period' in (await stored(id))).toBeFalse();
    }, 20000);

    it('removes the field when the period is cleared, rather than leaving the old one', async () => {
      const id = await add('monthly');

      await service.updateTransaction(id, { period: undefined });

      expect('period' in (await stored(id))).toBeFalse();
    }, 20000);
  });
});
