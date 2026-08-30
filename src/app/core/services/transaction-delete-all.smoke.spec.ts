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
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService } from './transaction.service';
import { Transaction } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for deleteAllTransactions against the Firestore
 * emulator.
 *
 * The unit spec can only assert that a mock's delete spy fired N times. What
 * broke in production was the *source* of that N: the method enumerated the
 * in-memory `transactions` signal, which holds whichever window the last live
 * query published. Against a real collection that nothing has subscribed to,
 * the old code deleted zero documents and reported success. Only a real
 * backend shows that.
 *
 * Has its own Firebase app and anonymous uid because it wipes the collection —
 * it must not share seeded rows with any other suite.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionService.deleteAllTransactions (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: TransactionService;
  let firestoreService: FirestoreService;

  const row = (id: string, date: Date) => ({
    id,
    type: 'expense' as const,
    amount: 100,
    amountInBaseCurrency: 100,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat-food',
    description: id,
    date: Timestamp.fromDate(date),
    isRecurring: false
  });

  // Spread across three months, so no single period window covers them all —
  // the shape of the account that lost data.
  const SEEDED = [
    row('smoke-wipe-a', new Date(2026, 5, 15, 12)),
    row('smoke-wipe-b', new Date(2026, 6, 10, 12)),
    row('smoke-wipe-c', new Date(2026, 7, 2, 12)),
    row('smoke-wipe-d', new Date(2026, 7, 20, 12))
  ];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `transaction-delete-all-smoke-${Date.now()}`
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
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        {
          provide: CurrencyService,
          useValue: { amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount }
        },
        // None of the seeded rows carries a receipt, so the slot sweep is
        // never reached; receipts have their own smoke suite.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(TransactionService);
    firestoreService = TestBed.inject(FirestoreService);

    // Seeded per test, because each test wipes the collection.
    await Promise.all(
      SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    );
  });

  it('deletes every document when nothing has ever been subscribed', async () => {
    // No query has run, so the signal is empty — the deep-link-to-Settings case.
    expect(service.transactions()).toEqual([]);

    const deleted = await service.deleteAllTransactions();

    expect(deleted).toBe(SEEDED.length);
    const remaining = await firestoreService.getCollection<Transaction>(
      `users/${uid}/transactions`
    );
    expect(remaining).toEqual([]);
  }, 30000);

  it('deletes rows outside the window the signal happens to hold', async () => {
    // One month on screen, four rows in the account.
    service.transactions.set([{ ...SEEDED[0], userId: uid } as unknown as Transaction]);

    const deleted = await service.deleteAllTransactions();

    expect(deleted).toBe(SEEDED.length);
    const remaining = await firestoreService.getCollection<Transaction>(
      `users/${uid}/transactions`
    );
    expect(remaining).toEqual([]);
    expect(service.transactions()).toEqual([]);
  }, 30000);
});
