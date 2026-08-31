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
 * Integration smoke test for TransactionService.exportAll against the
 * Firestore emulator.
 *
 * The production defect was the *source* of the export: it took the first
 * emission of a live listener, which a warm IndexedDB cache serves as
 * whichever narrow windows the session browsed, and the backup silently
 * truncated to that. The emulator cannot reproduce a warm persistent cache —
 * what this suite proves is the fix's contract: the export enumerates the
 * collection through a server read, regardless of what the signal holds or
 * whether anything ever subscribed. (`getDocsFromServer` runs for real here;
 * the emulator is the server.)
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionService.exportAll (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: TransactionService;

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
  // the shape of the account whose backup truncated.
  const SEEDED = [
    row('smoke-export-a', new Date(2026, 5, 15, 12)),
    row('smoke-export-b', new Date(2026, 6, 10, 12)),
    row('smoke-export-c', new Date(2026, 7, 2, 12)),
    row('smoke-export-d', new Date(2026, 7, 20, 12))
  ];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `transaction-export-all-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded once — the export never mutates the collection.
    await Promise.all(
      SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    );
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
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
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(TransactionService);
  });

  it('exports every row when nothing has ever been subscribed', async () => {
    // No query has run, so the signal is empty — the session that went
    // straight to the data page and asked for a backup.
    expect(service.transactions()).toEqual([]);

    const exported = await service.exportAll();

    expect(exported.length).toBe(SEEDED.length);
    // The one-shot read carries the export's ordering itself: newest first.
    expect(exported.map(t => t.id)).toEqual([
      'smoke-export-d', 'smoke-export-c', 'smoke-export-b', 'smoke-export-a'
    ]);
  }, 30000);

  it('exports rows outside the window the signal happens to hold', async () => {
    // One month on screen, four rows in the account — the warm-session shape
    // that used to produce a truncated file.
    service.transactions.set([{ ...SEEDED[0], userId: uid } as unknown as Transaction]);

    const exported = await service.exportAll();

    expect(exported.length).toBe(SEEDED.length);
    expect(new Set(exported.map(t => t.id))).toEqual(new Set(SEEDED.map(s => s.id)));
  }, 30000);
});
