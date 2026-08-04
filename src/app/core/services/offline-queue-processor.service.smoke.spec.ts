// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a Firestore
// instance built from root `firebase/firestore` is incompatible with the writes
// FirestoreService issues via @angular/fire — they must come from the same copy.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from '@angular/fire/firestore';

import { OfflineQueueService } from './offline-queue.service';
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
 * Integration smoke test for the offline-queue processor against the Firebase
 * emulators.
 *
 * Unlike the mocked unit tests, this drives the real path a queued receipt
 * takes after reconnecting: the `process-queued-image` event is handled by
 * OfflineQueueProcessorService, whose extracted rows are persisted through
 * TransactionService → FirestoreService → Firestore under real security rules,
 * and only then is the queued item flipped to `completed`.
 *
 * Only the AI call is stubbed — it reaches external cloud or native providers
 * that have no local emulator. Everything after it is real, which is the part
 * these three cases exist to prove: that the write lands before the item is
 * marked done, that another account's item is never drained into the ledger of
 * whoever happens to be signed in (#164), and that a row stranded mid-sync is
 * still a working queue item after the next launch reclaims it (#169).
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
  let ai: jasmine.SpyObj<AIStrategyService>;

  function receiptFile(name = 'receipt.jpg'): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
  }

  /** One income row, so the write path skips budget recalculation. */
  function reads(amount: number, description: string): void {
    ai.processReceipt.and.resolveTo({
      transactions: [{
        date: new Date(2026, 5, 15),
        description,
        amount,
        type: 'income',
        currency: 'USD',
        confidence: 0.9,
        source: 'cloud',
        suggestedCategoryId: 'salary',
      }],
      source: 'cloud',
      confidence: 0.9,
      processingTimeMs: 1,
    });
  }

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
        // The one stub: reading a photo reaches a cloud or native provider with
        // no local emulator. Everything downstream of it is real.
        { provide: AIStrategyService, useValue: ai },
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
    ai = jasmine.createSpyObj<AIStrategyService>('AIStrategyService', ['processReceipt']);
    await configure();
    await queue.clearAll();
  });

  afterEach(() => {
    processor.ngOnDestroy();
    queue.ngOnDestroy();
  });

  it('persists what a queued receipt produced before marking it completed', async () => {
    reads(123.45, 'Smoke salary');
    const id = await queue.queueImage(receiptFile());

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));

    // The handler is fire-and-forget; wait until the item leaves the pending
    // set (status flips to 'completed' once the Firestore write resolves).
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number; type: string }>(
      `users/${uid}/transactions`,
    );
    expect(stored.find((t) => t.amount === 123.45 && t.type === 'income')).toBeDefined();
  }, 20000);

  // The whole point of #164, against a real ledger. addTransaction resolves
  // the account at call time, so before this fix a sync that fired after a
  // different user signed in wrote the first account's receipt into theirs.
  it('does not write another account\'s queued receipt into the signed-in ledger', async () => {
    reads(777.77, 'Smoke leak check');
    const id = await queue.queueImage(receiptFile());
    // As syncQueue leaves it before dispatching, so the processor handing it
    // back is an observable transition rather than a no-op.
    await queue.updateImageStatus(id, 'processing');

    // A second account signs in on the same device before the queue drains.
    const other = `${uid}-other`;
    signedInAs = other;

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));

    // The processor returns the item to 'pending' rather than completing it.
    // (The other account's collection is deliberately unreadable from here —
    // the rules forbid it — so the queue state is what proves no write ran.)
    //
    // Polled through peekQueuedImage, which is owner-blind: reading through an
    // owner-scoped getter would mean flipping the signed-in account on every
    // tick, and the processor re-checks ownership after an await — so the poll
    // itself would hand it a window in which the write looks allowed.
    await waitFor(async () => (await queue.peekQueuedImage(id))?.status === 'pending');
    expect(ai.processReceipt).not.toHaveBeenCalled();

    signedInAs = uid;
    // Nothing landed in the capturing account either — it is still queued.
    const own = await firestoreService.getCollection<{ amount: number }>(
      `users/${uid}/transactions`,
    );
    expect(own.find((t) => t.amount === 777.77)).toBeUndefined();
    expect((await queue.getPendingImages()).map((i) => i.id)).toContain(id);
  }, 30000);

  // #169, end to end. The unit suite proves the sweep flips the status; this
  // proves the row it hands back is still a working queue item — that it
  // drains through the processor into a real Firestore document under real
  // security rules, rather than merely becoming visible again.
  it('drains a row stranded mid-sync once the next launch reclaims it', async () => {
    reads(246.8, 'Smoke stranded');
    const id = await queue.queueImage(receiptFile());

    // The tab dies between syncQueue marking the row and the processor
    // finishing it.
    await queue.updateImageStatus(id, 'processing');
    expect(await queue.getPendingImages()).toEqual([]);

    // Relaunch over the same database.
    processor.ngOnDestroy();
    queue.ngOnDestroy();
    await configure();

    const [reclaimed] = await queue.getPendingImages();
    expect(reclaimed?.id).toBe(id);

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));

    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number }>(
      `users/${uid}/transactions`,
    );
    expect(stored.find((t) => t.amount === 246.8)).toBeDefined();
  }, 30000);
});
