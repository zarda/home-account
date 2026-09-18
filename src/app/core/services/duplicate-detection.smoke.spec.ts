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
  doc,
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
import { TransactionService } from './transaction.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { CategorizedImportTransaction, Transaction } from '../../models';
import { addMonths } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { stripProviderKeys } from './testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

/**
 * What the duplicate check compares an import against, settled against the
 * emulator.
 *
 * The unit spec hands the service a stubbed list of stored rows, so it can
 * only prove the matching rules over a list somebody else chose. It cannot
 * prove where that list comes from — and under #427 that was the defect: the
 * check read a live listener's first emission, Firestore serves that first
 * emission from the local cache as soon as the cached result is non-empty,
 * and a cache warmed by any narrower window holds a subset of the day. A
 * stored row outside that subset was invisible, the import row sailed
 * through unflagged, and the wizard created the duplicate it exists to
 * prevent.
 *
 * Two clients, because one cannot state the problem. A client's own
 * acknowledged writes land in its own cache, so a suite that seeds its
 * fixtures through the client under test has a complete cache before it
 * starts. Here the writer seeds both rows and stays out of the way, and the
 * reader arrives cold: the only row it caches is the one its warm listener
 * holds, and the twin the import actually repeats is deliberately not that
 * row. Only a read that goes past the cache can see it.
 *
 * Both clients sign in as the same account by email and password rather than
 * anonymously, which would mint a second uid and fail isOwner.
 *
 * Runs only under the emulators:
 *   npm run smoke
 */
describe('DuplicateDetectionService source of truth (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  const WARM_CATEGORY = 'cat-duplicate-source-warm';
  const COLD_CATEGORY = 'cat-duplicate-source-cold';

  const WARM_ID = 'smoke-duplicate-source-warm';
  const TWIN_ID = 'smoke-duplicate-source-twin';

  const EMAIL = `duplicate-source-${Date.now()}@smoke.test`;
  const PASSWORD = 'duplicate-source-smoke';

  let writerApp: FirebaseApp;
  let writerFirestore: Firestore;
  let app: FirebaseApp;
  let firestore: Firestore;
  let uid: string;
  let transactionService: TransactionService;
  let service: DuplicateDetectionService;
  let warmListener: Subscription | null = null;

  // Anchored to the real clock, never jasmine.clock(): the check windows its
  // query around the import row's own date, so the seeded day only has to be
  // old enough not to collide with anything a neighbouring suite writes.
  const anchor = addMonths(new Date(), -3);
  const DAY = new Date(anchor.getFullYear(), anchor.getMonth(), 12, 12, 0, 0);

  // Deliberately unalike: the import row has to match the twin and nothing
  // else, so a passing assertion cannot be the warmed row matching by
  // accident.
  const TWIN_AMOUNT = 87.65;
  const TWIN_DESCRIPTION = 'Harbour bakery';

  const expenseRow = (
    id: string,
    categoryId: string,
    amount: number,
    description: string
  ) => ({
    id,
    userId: uid,
    type: 'expense' as const,
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId,
    description,
    date: Timestamp.fromDate(DAY),
    isRecurring: false
  });

  const importRow = (): CategorizedImportTransaction => ({
    id: 'import-duplicate-source-1',
    description: TWIN_DESCRIPTION,
    amount: TWIN_AMOUNT,
    currency: 'USD',
    date: DAY,
    type: 'expense',
    suggestedCategoryId: COLD_CATEGORY,
    categoryConfidence: 0.9,
    isDuplicate: false,
    selected: true
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
    const writer = connect(`duplicate-detection-source-smoke-writer-${stamp}`);
    writerApp = writer.app;
    writerFirestore = writer.firestore;

    const credential = await createUserWithEmailAndPassword(writer.auth, EMAIL, PASSWORD);
    uid = credential.user.uid;

    await Promise.all([
      setDoc(
        doc(writerFirestore, `users/${uid}/transactions/${WARM_ID}`),
        expenseRow(WARM_ID, WARM_CATEGORY, 12.34, 'Ferry ticket')
      ),
      setDoc(
        doc(writerFirestore, `users/${uid}/transactions/${TWIN_ID}`),
        expenseRow(TWIN_ID, COLD_CATEGORY, TWIN_AMOUNT, TWIN_DESCRIPTION)
      )
    ]);

    const reader = connect(`duplicate-detection-source-smoke-${stamp}`);
    app = reader.app;
    firestore = reader.firestore;
    await signInWithEmailAndPassword(reader.auth, EMAIL, PASSWORD);
  });

  afterAll(async () => {
    warmListener?.unsubscribe();
    await Promise.all(
      [WARM_ID, TWIN_ID].map(id =>
        deleteDoc(doc(writerFirestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
    await deleteApp(writerApp).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        DuplicateDetectionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // A loaded 1:1 table: the check compares stored amounts as written and
        // never converts, so nothing here needs the real fetch-backed service.
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
    transactionService = TestBed.inject(TransactionService);
    service = TestBed.inject(DuplicateDetectionService);
  });

  it('flags a twin the warmed cache never held', async () => {
    // The premise: one open listener over the other category is enough to put
    // a strict subset of the day in this client's cache and keep it there.
    const warmed = await new Promise<Transaction[]>(resolve => {
      warmListener = transactionService
        .getExpensesInRange(DAY, DAY, WARM_CATEGORY)
        .subscribe(rows => {
          if (rows.length === 1) {
            resolve(rows);
          }
        });
    });
    expect(warmed.map(row => row.id))
      .withContext('the held listener must cache the day without the twin')
      .toEqual([WARM_ID]);

    const checks = await service.checkDuplicates([importRow()]);

    expect(checks.length).toBe(1);
    expect(checks[0].isDuplicate)
      .withContext('the stored twin is outside the warmed window and must still be found')
      .toBeTrue();
    expect(checks[0].matchType).toBe('exact');
    expect(checks[0].existingTransactionId).toBe(TWIN_ID);
  }, 30000);
});
