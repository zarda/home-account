// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
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
import { TransactionService } from './transaction.service';
import { Transaction } from '../../models';

/**
 * Integration smoke test for the rate fallback ladder against the emulators.
 *
 * Every other smoke suite stubs CurrencyService out, which is exactly the
 * seam the defects here lived in: a rates response that is HTTP 200 with an
 * error body used to resolve as success and leave the table at its USD-only
 * placeholder, and a failed fetch used to discard an expired-but-real device
 * cache in favour of compiled-in constants. Both let the write path persist
 * wrong money. This is the one suite that runs the real CurrencyService
 * inside a real write: addTransaction converts through whatever table the
 * initialization ladder actually chose, the document lands under the
 * deployed rules, and the assertions read it back off the emulator.
 *
 * The cached probe rates differ from every compiled-in constant (JPY is
 * 149.5 there, 157 here), so the persisted figures say which rung of the
 * ladder produced them.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('Currency fallback ladder (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const RATES_API_PREFIX = 'https://open.er-api.com/';
  const HOUR_MS = 60 * 60 * 1000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;

  const createdTransactions: string[] = [];

  /** How the intercepted rates endpoint fails; each spec picks its shape. */
  let ratesFailure: 'reject' | 'error-body';
  /** Every URL the fetch fake saw, so specs can prove the ladder really ran. */
  let fetchedUrls: string[];

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `currency-fallback-smoke-${Date.now()}`
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
      createdTransactions.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    ratesFailure = 'reject';
    fetchedUrls = [];

    // An expired cache with real market data: 13 hours old against the
    // service's 12-hour TTL.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({
        rates: { USD: 1, JPY: 157, MXN: 17.2 },
        lastUpdatedMs: Date.now() - 13 * HOUR_MS
      })
    );

    // Only the rates endpoint is intercepted. Auth token exchange and the
    // Firestore transport ride window.fetch too, and they must keep reaching
    // the emulators, so everything else passes through to the real fetch.
    const realFetch = window.fetch.bind(window);
    spyOn(window, 'fetch').and.callFake(((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);
      if (url.startsWith(RATES_API_PREFIX)) {
        return ratesFailure === 'reject'
          ? Promise.reject(new Error('rates endpoint unreachable'))
          : Promise.resolve(
              new Response(
                JSON.stringify({ result: 'error', 'error-type': 'rate-limited' }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
      }
      return realFetch(input, init);
    }) as typeof window.fetch);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        TransactionService,
        CurrencyService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Receipts and quota are exercised in transaction-receipts.smoke.spec.ts;
        // no receipt files travel through these writes.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
  });

  afterEach(() => {
    localStorage.removeItem(RATES_CACHE_KEY);
  });

  /**
   * Injected inside each spec, after ratesFailure is set: CurrencyService
   * starts its initialization chain the moment the injector constructs it.
   */
  function buildTransactionService(): TransactionService {
    return TestBed.inject(TransactionService);
  }

  async function addYenRow(service: TransactionService): Promise<Transaction | undefined> {
    const id = await service.addTransaction({
      type: 'expense',
      amount: 1000,
      currency: 'JPY',
      categoryId: 'cat-food',
      description: 'Offline ramen',
      date: new Date(2026, 7, 10, 12)
    });
    createdTransactions.push(id);

    const snapshot = await getDoc(doc(firestore, `users/${uid}/transactions/${id}`));
    return snapshot.data() as Transaction | undefined;
  }

  function expectCachedRateSnapshot(row: Transaction | undefined): void {
    // 1/157 is the cached rung; 1/149.5 would be the constants rung and 1
    // the placeholder that used to leak through.
    expect(row?.exchangeRate).toBeCloseTo(1 / 157, 6);
    expect(row?.exchangeRate).not.toBeCloseTo(1 / 149.5, 6);
    expect(row?.exchangeRate).not.toBe(1);
    expect(row?.amountInBaseCurrency).toBeCloseTo(1000 / 157, 4);
    expect(row?.amountInBaseCurrency).not.toBe(1000);
    expect(row?.baseCurrency).toBe('USD');
    // The ladder was actually exercised — this was not the fresh-cache path.
    expect(fetchedUrls.some(url => url.startsWith(RATES_API_PREFIX))).toBeTrue();
  }

  it('persists a row converted through the expired cache when the rates endpoint is down', async () => {
    ratesFailure = 'reject';
    const service = buildTransactionService();

    const row = await addYenRow(service);

    expectCachedRateSnapshot(row);
  }, 30000);

  it('persists a row converted through the expired cache when the API answers 200 with an error body', async () => {
    ratesFailure = 'error-body';
    const service = buildTransactionService();

    const row = await addYenRow(service);

    expectCachedRateSnapshot(row);
  }, 30000);
});
