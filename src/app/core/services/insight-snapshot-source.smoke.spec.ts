// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  Auth
} from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { PwaService } from './pwa.service';
import { RecurringService } from './recurring.service';
import { TransactionService } from './transaction.service';
import { InsightSnapshotService } from './insight-snapshot.service';
import { InsightSnapshot, Transaction } from '../../models';
import { addMonths, endOfMonth, monthKey, startOfMonth } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { stripProviderKeys } from './testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

/**
 * Where a frozen month's numbers come from, settled against the emulator.
 *
 * The unit spec mocks TransactionService away, so the most it can say is
 * which method buildAndWrite called. It cannot say what that method answers
 * while a live listener over a narrower window is holding part of the month
 * in the local cache — and that is the whole of #427. A Firestore listener
 * raises its first snapshot from the cache as soon as the cached result is
 * non-empty, so `firstValueFrom` over one used to hand back whichever rows
 * this device happened to have, and the generator wrote that subset down as
 * the month's total.
 *
 * Two clients, because one cannot state the problem. A client's own
 * acknowledged writes land in its own cache, so a suite that seeds its
 * fixtures through the client under test has a complete cache before it
 * starts and no listener can be caught short. The writer therefore seeds
 * and stays out of the way; the reader arrives cold, and the only rows it
 * caches are the three the warm listener holds — a real partial cache, the
 * state a phone is in after browsing one category.
 *
 * Both clients sign in as the same account by email and password rather than
 * anonymously, which would mint a second uid and fail isOwner.
 *
 * The stored expense total is compared against a getDocsFromServer sum of
 * the same window: the one figure in the file that cannot have been served
 * from a cache.
 *
 * Runs only under the emulators:
 *   npm run smoke
 */
describe('InsightSnapshotService source of truth (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  const WARM_CATEGORY = 'cat-snapshot-source-warm';
  const COLD_CATEGORY = 'cat-snapshot-source-cold';

  const EMAIL = `snapshot-source-${Date.now()}@smoke.test`;
  const PASSWORD = 'snapshot-source-smoke';

  let writerApp: FirebaseApp;
  let writerFirestore: Firestore;
  let app: FirebaseApp;
  let firestore: Firestore;
  let uid: string;
  let transactionService: TransactionService;
  let snapshotService: InsightSnapshotService;
  let warmListener: Subscription | null = null;

  // Anchored to the real clock, never jasmine.clock(): generateClosedMonths
  // walks back from the month before `now`, and the seeded rows have to fall
  // inside the month it decides to freeze.
  const now = new Date();
  const lastClosed = startOfMonth(addMonths(now, -1));
  const MONTH_START = lastClosed;
  const MONTH_END = endOfMonth(lastClosed);
  const MONTH_KEY = monthKey(lastClosed);

  // Integers, so the expected total is exact and a rounding difference can
  // never be mistaken for a short read.
  const warmRows = [
    { id: 'smoke-snapshot-source-warm-1', amount: 11 },
    { id: 'smoke-snapshot-source-warm-2', amount: 22 },
    { id: 'smoke-snapshot-source-warm-3', amount: 33 }
  ];
  const coldRows = [
    { id: 'smoke-snapshot-source-cold-1', amount: 44 },
    { id: 'smoke-snapshot-source-cold-2', amount: 55 },
    { id: 'smoke-snapshot-source-cold-3', amount: 66 }
  ];

  const seededIds = [...warmRows, ...coldRows].map(row => row.id);

  const dayInMonth = (day: number): Date =>
    new Date(lastClosed.getFullYear(), lastClosed.getMonth(), day, 12, 0, 0);

  const expenseRow = (id: string, categoryId: string, amount: number, date: Date) => ({
    id,
    userId: uid,
    type: 'expense' as const,
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId,
    description: `Snapshot source smoke ${id}`,
    date: Timestamp.fromDate(date),
    isRecurring: false
  });

  const connect = (name: string): { app: FirebaseApp; auth: Auth; firestore: Firestore } => {
    const created = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' }, name);
    const createdAuth = getAuth(created);
    connectAuthEmulator(createdAuth, AUTH_URL, { disableWarnings: true });
    const createdFirestore = getFirestore(created);
    connectFirestoreEmulator(createdFirestore, FIRESTORE_HOST, FIRESTORE_PORT);
    return { app: created, auth: createdAuth, firestore: createdFirestore };
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const writer = connect(`insight-snapshot-source-smoke-writer-${stamp}`);
    writerApp = writer.app;
    writerFirestore = writer.firestore;

    const credential = await createUserWithEmailAndPassword(writer.auth, EMAIL, PASSWORD);
    uid = credential.user.uid;

    await Promise.all([
      ...warmRows.map((row, i) =>
        setDoc(
          doc(writerFirestore, `users/${uid}/transactions/${row.id}`),
          expenseRow(row.id, WARM_CATEGORY, row.amount, dayInMonth(4 + i))
        )
      ),
      ...coldRows.map((row, i) =>
        setDoc(
          doc(writerFirestore, `users/${uid}/transactions/${row.id}`),
          expenseRow(row.id, COLD_CATEGORY, row.amount, dayInMonth(14 + i))
        )
      )
    ]);

    const reader = connect(`insight-snapshot-source-smoke-${stamp}`);
    app = reader.app;
    firestore = reader.firestore;
    await signInWithEmailAndPassword(reader.auth, EMAIL, PASSWORD);
  });

  afterAll(async () => {
    warmListener?.unsubscribe();
    await Promise.all(
      seededIds.map(id =>
        deleteDoc(doc(writerFirestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    // The generator backfills every empty month it walks, so the collection
    // is emptied by enumeration rather than by the one month under test.
    const snapshots = await getDocs(collection(writerFirestore, `users/${uid}/insightSnapshots`));
    await Promise.all(
      snapshots.docs.map(snapshot => deleteDoc(snapshot.ref).catch(() => undefined))
    );
    await deleteApp(app).catch(() => undefined);
    await deleteApp(writerApp).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        InsightSnapshotService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        {
          provide: AuthService,
          useValue: {
            userId: () => uid,
            // generateClosedMonths refuses to run for a session still loading
            // or on the in-memory fallback profile, and the build reads the
            // profile's base currency.
            isLoading: () => false,
            profileDegraded: () => false,
            currentUser: () => ({ preferences: { baseCurrency: 'USD' } })
          }
        },
        // A loaded 1:1 table: every seeded row already carries its base-currency
        // amount, so nothing here needs the real fetch-backed service.
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
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } },
        { provide: RecurringService, useValue: { listAll: async () => [] } },
        { provide: PwaService, useValue: { isOnline: () => true } }
      ]
    });
    transactionService = TestBed.inject(TransactionService);
    snapshotService = TestBed.inject(InsightSnapshotService);
  });

  it('freezes the account\'s month, not the window a listener had cached', async () => {
    // The premise: one open listener over one category is enough to put a
    // strict subset of the month in this client's cache and keep it there.
    // Whatever is read next, this is what a cache can answer with.
    const warmed = await new Promise<Transaction[]>(resolve => {
      warmListener = transactionService
        .getExpensesInRange(MONTH_START, MONTH_END, WARM_CATEGORY)
        .subscribe(rows => resolve(rows));
    });
    expect(warmed.map(row => row.id).sort())
      .withContext('the held listener must cache exactly the warm category rows')
      .toEqual([...warmRows.map(row => row.id)].sort());
    expect(warmed.length)
      .withContext('the held listener must cache a strict subset of the month')
      .toBeLessThan(seededIds.length);

    const written = await snapshotService.generateClosedMonths(now);
    expect(written.map(snapshot => snapshot.monthKey))
      .withContext(`the last closed month ${MONTH_KEY} should have been written`)
      .toContain(MONTH_KEY);

    const monthRows = await getDocsFromServer(
      query(
        collection(firestore, `users/${uid}/transactions`),
        where('date', '>=', Timestamp.fromDate(MONTH_START)),
        where('date', '<=', Timestamp.fromDate(MONTH_END))
      )
    );
    const serverTotal = monthRows.docs.reduce(
      (sum, row) => sum + (row.data()['amountInBaseCurrency'] as number), 0);

    const stored = (
      await getDocFromServer(doc(firestore, `users/${uid}/insightSnapshots/${MONTH_KEY}`))
    ).data() as InsightSnapshot;

    expect(stored.fingerprint.count)
      .withContext('the stored month counts every row the account holds')
      .toBe(monthRows.size);
    expect(stored.totals.expense)
      .withContext('the stored expense total is the server sum, not the cached subset')
      .toBe(serverTotal);
  }, 60000);
});
