// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from the root packages are incompatible with the service layer.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  deleteUser,
  Auth
} from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { openDB } from 'idb';

import { AccountDeletionService } from './account-deletion.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { StorageService } from './storage.service';
import { SHARE_STASH_DB, SHARE_STASH_STORE, ShareStashStore } from './share-stash.store';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * End-to-end smoke test for the account-deletion cascade against the
 * emulators.
 *
 * The unit spec proves ordering and partial-failure semantics with spies;
 * only a real backend proves that every subcollection actually empties, that
 * the amended rules permit the sweeps (the emulator enforces
 * firestore.rules), that the receipt object leaves Storage, and that the
 * auth user itself is gone at the end.
 *
 * The AuthService stub keeps the heavyweight real service out of the DI
 * graph: reauthentication is stubbed as a no-op because the anonymous user
 * signs in freshly here (recent login by construction) and anonymous
 * accounts cannot re-run a Google flow. deleteFirebaseUser only records its
 * call: the rules make every read owner-only, so the emptied collections are
 * only assertable while the session still exists. The real deleteUser runs
 * directly afterwards, once nothing readable is left to check.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('AccountDeletionService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: Storage;
  let uid: string;

  let service: AccountDeletionService;
  let firestoreService: FirestoreService;
  let storageService: StorageService;

  const RECEIPT_TX_ID = 'smoke-del-rx';

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account', storageBucket: 'demo-home-account.appspot.com' },
      `account-deletion-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  /** One valid document per subcollection, shaped to pass firestore.rules. */
  async function seedEverything(): Promise<void> {
    const now = Timestamp.now();

    await setDoc(doc(firestore, `users/${uid}`), {
      email: 'smoke@example.test',
      displayName: 'Smoke',
      createdAt: now,
      lastLoginAt: now,
      preferences: { baseCurrency: 'USD', language: 'en' }
    });

    await setDoc(doc(firestore, `users/${uid}/transactions/${RECEIPT_TX_ID}`), {
      userId: uid,
      type: 'expense',
      amount: 12.5,
      currency: 'USD',
      amountInBaseCurrency: 12.5,
      exchangeRate: 1,
      categoryId: 'food_groceries',
      description: 'deletion smoke',
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      receiptUrl: await uploadReceipt()
    });

    await setDoc(doc(firestore, `users/${uid}/categories/smoke-del-cat`), {
      userId: uid,
      name: 'Custom',
      icon: 'star',
      color: '#FF0000',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: false
    });

    await setDoc(doc(firestore, `users/${uid}/budgets/smoke-del-budget`), {
      userId: uid,
      categoryId: 'food',
      name: 'Groceries',
      amount: 400,
      currency: 'USD',
      period: 'monthly',
      startDate: now,
      spent: 0,
      isActive: true,
      alertThreshold: 80
    });

    await setDoc(doc(firestore, `users/${uid}/recurring/smoke-del-rec`), {
      userId: uid,
      name: 'Salary',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      categoryId: 'employment_salary',
      description: 'monthly salary',
      frequency: { type: 'monthly', interval: 1 },
      startDate: now,
      nextOccurrence: now,
      isActive: true
    });

    await setDoc(doc(firestore, `users/${uid}/goals/smoke-del-goal`), {
      userId: uid,
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true
    });

    await setDoc(doc(firestore, `users/${uid}/savedSearches/smoke-del-search`), {
      userId: uid,
      query: 'coffee',
      pinned: false,
      lastUsedAt: now
    });

    await setDoc(doc(firestore, `users/${uid}/searchAnswers/smoke-del-answer`), {
      userId: uid,
      schemaVersion: 2,
      kind: 'aggregate',
      query: 'how much on food in august',
      operation: 'sum',
      limit: 3,
      scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
      baseCurrency: 'USD',
      value: 421.5,
      currency: 'USD',
      transactionCount: 17,
      computedAt: now,
      lastUsedAt: now
    });

    await setDoc(doc(firestore, `users/${uid}/categoryMemory/starbucks`), {
      merchantKey: 'starbucks',
      categoryId: 'food_coffee',
      sampleDescription: 'STARBUCKS #123',
      count: 1
    });

    await setDoc(doc(firestore, `users/${uid}/tagMemory/starbucks`), {
      merchantKey: 'starbucks',
      tags: ['coffee'],
      suppressed: ['lunch'],
      sampleDescription: 'STARBUCKS #123',
      count: 1
    });

    await setDoc(doc(firestore, `users/${uid}/imports/smoke-del-import`), {
      userId: uid,
      importedAt: now,
      source: 'csv',
      fileType: 'bank_csv',
      fileName: 'statement.csv',
      status: 'completed'
    });

    await setDoc(doc(firestore, `users/${uid}/insightSnapshots/2026-07`), {
      userId: uid,
      monthKey: '2026-07',
      detectorVersion: 1,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: { tx: 'abcd1234:10', count: 10, timeZone: 'Asia/Taipei', baseCurrency: 'USD' },
      totals: { income: 4000, expense: 1200, balance: 2800, count: 10 },
      byCategory: [{ categoryId: 'food_groceries', total: 800, count: 6 }],
      facts: { detectorVersion: 1, baseCurrency: 'USD' },
      cards: [],
      generatedAt: now,
      createdAt: now,
      revision: 1
    });

    await setDoc(doc(firestore, `users/${uid}/secrets/providers`), { gemini: 'g-key' });

    await setDoc(doc(firestore, `users/${uid}/feedback/smoke-del-feedback`), {
      userId: uid,
      category: 'idea',
      message: 'smoke feedback',
      appVersion: '1.23.129',
      platform: 'web',
      locale: 'en'
    });

    await setDoc(doc(firestore, `users/${uid}/securityEvents/smoke-del-event`), {
      userId: uid,
      type: 'signIn',
      occurredAt: now,
      platform: 'web'
    });
  }

  async function uploadReceipt(): Promise<string> {
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'receipt.png', {
      type: 'image/png'
    });
    return storageService.uploadReceipt(uid, RECEIPT_TX_ID, file);
  }

  let deleteFirebaseUserCalls = 0;

  beforeEach(() => {
    deleteFirebaseUserCalls = 0;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        {
          provide: AuthService,
          useValue: {
            userId: () => uid,
            currentUser: () => null,
            reauthenticate: async () => undefined,
            deleteFirebaseUser: async () => {
              deleteFirebaseUserCalls += 1;
            }
          }
        }
      ]
    });

    service = TestBed.inject(AccountDeletionService);
    firestoreService = TestBed.inject(FirestoreService);
    storageService = TestBed.inject(StorageService);
  });

  it('erases every subcollection, the receipt, the user document, and the auth user', async () => {
    await seedEverything();

    // The share stash is the one device-local store the cascade used to
    // skip. Seed it the way the service worker writes — raw rows, one owned
    // and one ownerless — and let the shareStash step erase both. The
    // store's session effect never fires here (nothing ticks), so the rows
    // are stamped explicitly.
    await TestBed.inject(ShareStashStore).clearAll(); // creates the schema
    const stashDb = await openDB(SHARE_STASH_DB);
    await stashDb.put(SHARE_STASH_STORE, {
      id: 'smoke-owned',
      name: 'mine.png',
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: Date.now(),
      userId: uid
    });
    await stashDb.put(SHARE_STASH_STORE, {
      id: 'smoke-ownerless',
      name: 'nobody.png',
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: Date.now()
    });
    stashDb.close();

    const report = await service.deleteAccount();

    expect(report.failed).toEqual([]);
    expect(report.ok).toBeTrue();
    expect(deleteFirebaseUserCalls).toBe(1);

    const subcollections = [
      'transactions',
      'categories',
      'budgets',
      'recurring',
      'goals',
      'savedSearches',
      'searchAnswers',
      'categoryMemory',
      'tagMemory',
      'imports',
      'insightSnapshots',
      'secrets',
      'feedback',
      'securityEvents'
    ];
    for (const name of subcollections) {
      const rows = await firestoreService.getCollection(`users/${uid}/${name}`);
      expect(rows).toEqual([], `expected users/{uid}/${name} to be empty`);
    }

    expect(await firestoreService.getDocument(`users/${uid}`)).toBeNull();
    await expectAsync(storageService.downloadReceipt(uid, RECEIPT_TX_ID)).toBeRejected();

    // Erasure is device-scoped: no rows survive, owned or ownerless.
    const stashAfter = await openDB(SHARE_STASH_DB);
    expect(await stashAfter.count(SHARE_STASH_STORE)).toBe(0);
    stashAfter.close();

    // The step the cascade invoked above, run for real now that the
    // owner-only reads are done: the emulator accepts deleting this
    // recently-signed-in user, and the session ends with it.
    const user = auth.currentUser;
    expect(user).not.toBeNull();
    await deleteUser(user!);
    expect(auth.currentUser).toBeNull();
  }, 60000);
});
