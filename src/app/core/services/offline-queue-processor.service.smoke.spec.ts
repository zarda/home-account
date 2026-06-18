// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a Firestore
// instance built from root `firebase/firestore` is incompatible with the writes
// FirestoreService issues via @angular/fire — they must come from the same copy.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from '@angular/fire/firestore';

import { OfflineQueueService, QueuedTransaction } from './offline-queue.service';
import { OfflineQueueProcessorService } from './offline-queue-processor.service';
import { FirestoreService } from './firestore.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { AIStrategyService } from './ai-strategy.service';
import { PwaService } from './pwa.service';

/**
 * Integration smoke test for the offline-queue transaction handler against the
 * Firebase emulators.
 *
 * Unlike the mocked unit tests, this drives the real path a transaction takes
 * after reconnecting: the `sync-queued-transaction` event is handled by
 * OfflineQueueProcessorService, which persists it through TransactionService →
 * FirestoreService → Firestore, and only then flips the queued item to
 * `completed`. It proves a queued transaction is actually written before being
 * marked done (issue #18, AC #2).
 *
 * The image path is intentionally not covered here: it calls external cloud/
 * native AI providers that have no local emulator.
 *
 * Runs only under the emulators:
 *   npm run smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('OfflineQueueProcessorService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;

  let queue: OfflineQueueService;
  let processor: OfflineQueueProcessorService;
  let firestoreService: FirestoreService;

  async function waitFor(pred: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
    const start = Date.now();
    while (!(await pred())) {
      if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
      },
      `offline-queue-smoke-${Date.now()}`,
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
    const pwa = jasmine.createSpyObj('PwaService', ['isOnline', 'registerBackgroundSync']);
    pwa.isOnline.and.returnValue(true);

    const authMock = {
      userId: () => uid,
      currentUser: () => ({ id: uid, preferences: { baseCurrency: 'USD' } }),
    };

    TestBed.configureTestingModule({
      providers: [
        OfflineQueueService,
        OfflineQueueProcessorService,
        FirestoreService,
        TransactionService,
        { provide: Firestore, useValue: firestore },
        { provide: PwaService, useValue: pwa },
        { provide: AuthService, useValue: authMock },
        { provide: CurrencyService, useValue: { getExchangeRate: () => 1 } },
        { provide: StorageService, useValue: jasmine.createSpyObj('StorageService', ['uploadReceipt', 'deleteReceipt']) },
        { provide: AIStrategyService, useValue: jasmine.createSpyObj('AIStrategyService', ['processReceipt']) },
      ],
    });

    queue = TestBed.inject(OfflineQueueService);
    processor = TestBed.inject(OfflineQueueProcessorService);
    firestoreService = TestBed.inject(FirestoreService);

    await waitFor(() => queue.isReady());
    await queue.clearAll();
  });

  afterEach(() => {
    processor.ngOnDestroy();
    queue.ngOnDestroy();
  });

  it('persists a queued transaction to Firestore before marking it completed', async () => {
    // Use an income transaction so the write path skips budget recalculation.
    await queue.queueTransaction({
      date: '2026-06-15',
      description: 'Smoke salary',
      amount: 123.45,
      type: 'income',
      currency: 'USD',
      categoryId: 'salary',
      source: 'local',
    });

    const [queued] = await queue.getPendingTransactions();
    expect(queued).toBeDefined();

    window.dispatchEvent(
      new CustomEvent<{ transaction: QueuedTransaction }>('sync-queued-transaction', {
        detail: { transaction: queued },
      }),
    );

    // The handler is fire-and-forget; wait until the item leaves the pending set
    // (status flips to 'completed' once the Firestore write resolves).
    await waitFor(async () => (await queue.getPendingTransactions()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number; type: string }>(
      `users/${uid}/transactions`,
    );
    const match = stored.find((t) => t.amount === 123.45 && t.type === 'income');
    expect(match).toBeDefined();
  }, 20000);
});
