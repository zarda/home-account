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
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';

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
  let signedInAs: string | null;

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

  /**
   * Build the TestBed and take fresh instances.
   *
   * Extracted so a test can relaunch the app over the same IndexedDB: both
   * services are `providedIn: 'root'`, so re-injecting after ngOnDestroy hands
   * back the same closed instance. Only a module reset gives a new one.
   */
  async function configure(): Promise<void> {
    const pwa = jasmine.createSpyObj('PwaService', ['isOnline', 'registerBackgroundSync']);
    pwa.isOnline.and.returnValue(true);

    const authMock = {
      userId: () => signedInAs,
      currentUser: () => ({ id: signedInAs, preferences: { baseCurrency: 'USD' } }),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OfflineQueueService,
        OfflineQueueProcessorService,
        FirestoreService,
        TransactionService,
        { provide: Firestore, useValue: firestore },
        { provide: PwaService, useValue: pwa },
        { provide: AuthService, useValue: authMock },
        {
          provide: CurrencyService,
          useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
        },
        { provide: StorageService, useValue: jasmine.createSpyObj('StorageService', ['uploadReceipt', 'deleteReceipt']) },
        { provide: AIStrategyService, useValue: jasmine.createSpyObj('AIStrategyService', ['processReceipt']) },
        // Stubbed so the processor's user feedback stays out of this test:
        // the real NotificationService pulls in the snackbar and the HTTP-backed
        // translation loader, neither of which the emulator run has.
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: TranslationService, useValue: jasmine.createSpyObj('TranslationService', ['t']) },
      ],
    });

    queue = TestBed.inject(OfflineQueueService);
    processor = TestBed.inject(OfflineQueueProcessorService);
    firestoreService = TestBed.inject(FirestoreService);

    await waitFor(() => queue.isReady());
  }

  beforeEach(async () => {
    // Mutable so a test can queue as one account and sync as another.
    signedInAs = uid;
    await configure();
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

  // The whole point of #164, against a real ledger. addTransaction resolves
  // the account at call time, so before this fix a sync that fired after a
  // different user signed in wrote the first account's spending into theirs.
  it('does not write another account\'s queued transaction into the signed-in ledger', async () => {
    await queue.queueTransaction({
      date: '2026-06-16',
      description: 'Smoke leak check',
      amount: 777.77,
      type: 'income',
      currency: 'USD',
      categoryId: 'salary',
      source: 'local',
    });

    const [queued] = await queue.getPendingTransactions();
    expect(queued.userId).toBe(uid);

    // A second account signs in on the same device before the queue drains.
    const other = `${uid}-other`;
    signedInAs = other;

    window.dispatchEvent(
      new CustomEvent<{ transaction: QueuedTransaction }>('sync-queued-transaction', {
        detail: { transaction: queued },
      }),
    );

    // The processor returns the item to 'pending' rather than completing it.
    // (The other account's collection is deliberately unreadable from here —
    // the rules forbid it — so the queue state is what proves no write ran.)
    await waitFor(async () => {
      signedInAs = uid;
      const pending = await queue.getPendingTransactions();
      const found = pending.find((t) => t.id === queued.id);
      signedInAs = other;
      return found?.status === 'pending';
    });

    signedInAs = uid;
    // Nothing landed in the capturing account either — it is still queued.
    const own = await firestoreService.getCollection<{ amount: number }>(
      `users/${uid}/transactions`,
    );
    expect(own.find((t) => t.amount === 777.77)).toBeUndefined();

    const stillPending = await queue.getPendingTransactions();
    expect(stillPending.map((t) => t.id)).toContain(queued.id);
  }, 30000);

  // #169, end to end. The unit suite proves the sweep flips the status; this
  // proves the row it hands back is still a working queue item — that it
  // drains through the processor into a real Firestore document under real
  // security rules, rather than merely becoming visible again.
  it('drains a row stranded mid-sync once the next launch reclaims it', async () => {
    await queue.queueTransaction({
      date: '2026-06-17',
      description: 'Smoke stranded',
      amount: 246.8,
      type: 'income',
      currency: 'USD',
      categoryId: 'salary',
      source: 'local',
    });

    // The tab dies between syncQueue marking the row and the processor
    // finishing it.
    const [inFlight] = await queue.getPendingTransactions();
    await queue.updateTransactionStatus(inFlight.id, 'processing');
    expect(await queue.getPendingTransactions()).toEqual([]);

    // Relaunch over the same database.
    processor.ngOnDestroy();
    queue.ngOnDestroy();
    await configure();

    const [reclaimed] = await queue.getPendingTransactions();
    expect(reclaimed?.id).toBe(inFlight.id);

    window.dispatchEvent(
      new CustomEvent<{ transaction: QueuedTransaction }>('sync-queued-transaction', {
        detail: { transaction: reclaimed },
      }),
    );

    await waitFor(async () => (await queue.getPendingTransactions()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number }>(
      `users/${uid}/transactions`,
    );
    expect(stored.find((t) => t.amount === 246.8)).toBeDefined();
  }, 30000);
});
