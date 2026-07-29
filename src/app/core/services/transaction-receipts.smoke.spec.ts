// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  deleteDoc,
  where,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { FirestoreService } from './firestore.service';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { BudgetService } from './budget.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService, RECEIPT_ATTACH_FAILED } from './transaction.service';
import { Transaction } from '../../models';

/**
 * Integration smoke test for multi-image receipts against the emulators:
 * the real TransactionService writing through the real FirestoreService and
 * StorageService, with firestore.rules and storage.rules live.
 *
 * What only this suite can prove:
 * - the slot⇄array alignment holds end to end (each receiptUrls entry's
 *   bytes really live at its slot's storage key),
 * - the quota query semantics that motivated keeping receiptUrl a string
 *   (server-side ordering behaviour no unit test can reproduce),
 * - a failed batch leaves neither a document nor stray objects behind.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionService receipts (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let service: TransactionService;
  let storageService: StorageService;

  /** Ids created through the service, swept in afterAll. */
  const createdIds: string[] = [];

  // Payload whose bytes identify it, so slot↔array assertions compare content.
  const markedFile = (marker: number) =>
    new File([new Uint8Array([0xff, 0xd8, marker, 0xd9])], `receipt-${marker}.jpg`, {
      type: 'image/jpeg'
    });

  const markerOf = async (blob: Blob): Promise<number> =>
    new Uint8Array(await blob.arrayBuffer())[2];

  // Rejected by the client-side size guard before any byte moves — enough to
  // fail one upload of a batch; the server-side limit on suffixed names is
  // asserted separately in storage.service.smoke.spec.ts.
  const oversizedFile = () =>
    ({ size: 3 * 1024 * 1024, type: 'image/jpeg', name: 'huge.jpg' }) as File;

  const dto = (description: string, files: File[]) => ({
    type: 'expense' as const,
    amount: 12.5,
    currency: 'USD',
    categoryId: 'food_groceries',
    description,
    date: new Date(),
    receiptFiles: files
  });

  const readDoc = async (id: string): Promise<Record<string, unknown>> => {
    const snapshot = await getDoc(doc(firestore, `users/${uid}/transactions/${id}`));
    return (snapshot.data() ?? {}) as Record<string, unknown>;
  };

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `transaction-receipts-smoke-${Date.now()}`
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
    await Promise.all(
      createdIds.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        FirestoreService,
        StorageService,
        { provide: Firestore, useValue: firestore },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // The real CurrencyService fetches a rates table in its constructor;
        // rates play no part here, so a unit stub keeps the suite hermetic.
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: async () => undefined,
            getExchangeRate: () => 1,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency
          }
        },
        // Expense writes recalculate budgets through a lazily resolved
        // BudgetService; none exist in this suite.
        { provide: BudgetService, useValue: { recalculateBudgetsForCategory: async () => undefined } },
        // Quota decisions are unit-tested; this suite is about what lands in
        // Firestore and Storage.
        {
          provide: ReceiptQuotaService,
          useValue: {
            canAddImages: async () => true,
            noteImagesAdded: () => undefined,
            noteImagesRemoved: () => undefined,
            invalidateCount: () => undefined
          }
        }
      ]
    });
    service = TestBed.inject(TransactionService);
    storageService = TestBed.inject(StorageService);
  });

  it('attaches three images to a new transaction, slots aligned with the array', async () => {
    const id = await service.addTransaction(dto('three images', [
      markedFile(0x50),
      markedFile(0x51),
      markedFile(0x52)
    ]));
    createdIds.push(id);

    const row = await readDoc(id);
    const urls = row['receiptUrls'] as string[];
    expect(urls.length).toBe(3);
    expect(row['receiptCount']).toBe(3);
    expect(row['receiptUrl']).toBe(urls[0]);
    expect(typeof row['receiptUrl']).toBe('string');

    // Each array entry's bytes really live at its slot's storage key.
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 0))).toBe(0x50);
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 1))).toBe(0x51);
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 2))).toBe(0x52);
  }, 20000);

  it('keeps the quota query exact while an array field would betray it', async () => {
    // Four rows: multi-image, legacy single-image, an emptied array, and no
    // receipt fields at all.
    const multiId = await service.addTransaction(dto('quota multi', [markedFile(0x60), markedFile(0x61)]));
    createdIds.push(multiId);

    const legacyId = `smoke-quota-legacy-${Date.now()}`;
    const emptyArrayId = `smoke-quota-empty-${Date.now()}`;
    const bareId = `smoke-quota-bare-${Date.now()}`;
    createdIds.push(legacyId, emptyArrayId, bareId);
    const base = {
      userId: uid,
      type: 'expense',
      amount: 1,
      currency: 'USD',
      amountInBaseCurrency: 1,
      exchangeRate: 1,
      categoryId: 'smoke',
      description: 'quota smoke',
      date: Timestamp.now(),
      isRecurring: false
    };
    await setDoc(doc(firestore, `users/${uid}/transactions/${legacyId}`), {
      ...base,
      receiptUrl: 'https://example.test/legacy.jpg'
    });
    await setDoc(doc(firestore, `users/${uid}/transactions/${emptyArrayId}`), {
      ...base,
      receiptUrls: []
    });
    await setDoc(doc(firestore, `users/${uid}/transactions/${bareId}`), base);

    const idsMatching = async (field: string) => {
      const snapshot = await getDocs(
        query(collection(firestore, `users/${uid}/transactions`), where(field, '>', ''))
      );
      return snapshot.docs.map(d => d.id);
    };

    // The quota's filter: exactly the rows with images, each once.
    const byUrl = await idsMatching('receiptUrl');
    expect(byUrl).toContain(multiId);
    expect(byUrl).toContain(legacyId);
    expect(byUrl).not.toContain(emptyArrayId);
    expect(byUrl).not.toContain(bareId);

    // The rejected design: an inequality against the array field. Firestore
    // range filters only match values of the operand's type, so a string
    // comparison sees no array-valued row at all — not the multi-image row,
    // not even the emptied one. A quota counting through this filter would
    // read zero stored images for every multi-image user and wave everyone
    // past the limit, with nothing throwing. That silent hole is why
    // receiptUrl must stay a plain string: it is the one field the count
    // query can trust.
    const byUrls = await idsMatching('receiptUrls');
    expect(byUrls).toEqual([]);
  }, 20000);

  it('appends to a legacy single-image row without touching its object', async () => {
    // A row written before receiptUrls existed, its object at the bare key.
    const id = `smoke-legacy-append-${Date.now()}`;
    createdIds.push(id);
    const legacyUrl = await storageService.uploadReceipt(uid, id, markedFile(0x70));
    await setDoc(doc(firestore, `users/${uid}/transactions/${id}`), {
      userId: uid,
      type: 'expense',
      amount: 1,
      currency: 'USD',
      amountInBaseCurrency: 1,
      exchangeRate: 1,
      categoryId: 'smoke',
      description: 'legacy append',
      date: Timestamp.now(),
      isRecurring: false,
      receiptUrl: legacyUrl
    });

    await service.updateTransaction(id, { receiptFiles: [markedFile(0x71)] });

    const row = await readDoc(id);
    const urls = row['receiptUrls'] as string[];
    expect(urls.length).toBe(2);
    expect(urls[0]).toBe(legacyUrl);
    expect(row['receiptUrl']).toBe(legacyUrl);
    expect(row['receiptCount']).toBe(2);

    // The legacy object is bit-identical and the new one landed at slot 1.
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 0))).toBe(0x70);
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 1))).toBe(0x71);
  }, 20000);

  it('removes one image without disturbing the others', async () => {
    const id = await service.addTransaction(dto('middle removal', [
      markedFile(0x80),
      markedFile(0x81),
      markedFile(0x82)
    ]));
    createdIds.push(id);
    const before = (await readDoc(id))['receiptUrls'] as string[];

    await service.removeReceiptAt(id, 1);

    const row = await readDoc(id);
    expect(row['receiptUrls']).toEqual([before[0], '', before[2]]);
    expect(row['receiptCount']).toBe(2);
    expect(row['receiptUrl']).toBe(before[0]);

    await expectAsync(storageService.downloadReceipt(uid, id, 1)).toBeRejected();
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 0))).toBe(0x80);
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 2))).toBe(0x82);
  }, 20000);

  it('promotes the next image when the first is removed', async () => {
    const id = await service.addTransaction(dto('promotion', [markedFile(0x90), markedFile(0x91)]));
    createdIds.push(id);
    const before = (await readDoc(id))['receiptUrls'] as string[];

    await service.removeReceiptAt(id, 0);

    const row = await readDoc(id);
    // The pointer follows the surviving image so the quota query and the
    // single-image read sites keep resolving.
    expect(row['receiptUrl']).toBe(before[1]);
    expect(row['receiptUrls']).toEqual(['', before[1]]);
    expect(row['receiptCount']).toBe(1);

    await expectAsync(storageService.downloadReceipt(uid, id, 0)).toBeRejected();
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 1))).toBe(0x91);
  }, 20000);

  it('clears the receipt fields entirely when the last image goes', async () => {
    const id = await service.addTransaction(dto('empty out', [markedFile(0xa0), markedFile(0xa1)]));
    createdIds.push(id);

    await service.removeReceiptAt(id, 1);
    await service.removeReceiptAt(id, 0);

    const row = await readDoc(id);
    // Absent, not empty-string: the row must drop out of the quota query,
    // and stale receipt fields on an imageless row are exactly the shape
    // the case above shows the count cannot see through.
    expect('receiptUrl' in row).toBeFalse();
    expect('receiptUrls' in row).toBeFalse();
    expect(row['receiptCount']).toBe(0);

    const snapshot = await getDocs(
      query(collection(firestore, `users/${uid}/transactions`), where('receiptUrl', '>', ''))
    );
    expect(snapshot.docs.map(d => d.id)).not.toContain(id);
  }, 20000);

  it('deletes every stored object when the transaction is deleted', async () => {
    const id = await service.addTransaction(dto('full delete', [
      markedFile(0xb0),
      markedFile(0xb1),
      markedFile(0xb2)
    ]));
    createdIds.push(id);
    // Remove the middle image first so the sweep has to cross a gap.
    await service.removeReceiptAt(id, 1);

    await service.deleteTransaction(id);

    expect((await readDoc(id))['userId']).toBeUndefined();
    await expectAsync(storageService.downloadReceipt(uid, id, 0)).toBeRejected();
    await expectAsync(storageService.downloadReceipt(uid, id, 1)).toBeRejected();
    await expectAsync(storageService.downloadReceipt(uid, id, 2)).toBeRejected();
  }, 20000);

  it('writes nothing when one upload in a batch fails', async () => {
    // Add path: the batch fails on the middle file, so no document may
    // appear. The generated id never leaves the service, so the document
    // query is the observable surface; the object sweep is asserted on the
    // update path below, where the id is known.
    await expectAsync(
      service.addTransaction(dto('rollback add', [markedFile(0xc0), oversizedFile(), markedFile(0xc2)]))
    ).toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

    const snapshot = await getDocs(
      query(
        collection(firestore, `users/${uid}/transactions`),
        where('description', '==', 'rollback add')
      )
    );
    expect(snapshot.size).toBe(0);

    // Update path: the stored row and its object must come through untouched.
    const id = await service.addTransaction(dto('rollback update', [markedFile(0xd0)]));
    createdIds.push(id);

    await expectAsync(
      service.updateTransaction(id, { receiptFiles: [markedFile(0xd1), oversizedFile()] })
    ).toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

    const row = await readDoc(id);
    expect((row['receiptUrls'] as string[]).length).toBe(1);
    expect(row['receiptCount']).toBe(1);
    expect(await markerOf(await storageService.downloadReceipt(uid, id, 0))).toBe(0xd0);
    // The landed slot of the failed batch was rolled back.
    await expectAsync(storageService.downloadReceipt(uid, id, 1)).toBeRejected();
  }, 20000);
});
