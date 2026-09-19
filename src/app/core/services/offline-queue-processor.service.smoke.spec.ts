// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a Firestore
// instance built from root `firebase/firestore` is incompatible with the writes
// FirestoreService issues via @angular/fire — they must come from the same copy.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore, Timestamp } from '@angular/fire/firestore';
import {
  getStorage,
  connectStorageEmulator,
  getMetadata,
  listAll,
  ref,
  Storage,
} from '@angular/fire/storage';

import { OfflineQueueService } from './offline-queue.service';
import { OfflineQueueProcessorService } from './offline-queue-processor.service';
import { FirestoreService } from './firestore.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { AIStrategyService } from './ai-strategy.service';
import { PwaService } from './pwa.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { AnalyticsService } from './analytics.service';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

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
 * these four cases exist to prove: that the write lands before the item is
 * marked done, that another account's item is never drained into the ledger of
 * whoever happens to be signed in (#164), that a row stranded mid-sync is
 * still a working queue item after the next launch reclaims it (#169), and
 * that draining such a row a second time does not post its rows twice (#205).
 *
 * Runs only under the emulators:
 *   npm run smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('OfflineQueueProcessorService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let signedInAs: string | null;

  let queue: OfflineQueueService;
  let processor: OfflineQueueProcessorService;
  let firestoreService: FirestoreService;
  let ai: jasmine.SpyObj<AIStrategyService>;

  function receiptFile(name = 'receipt.jpg'): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
  }

  /** Payload whose third byte identifies it, so an uploaded object can be traced back. */
  function markedFile(marker: number, name = 'receipt.jpg'): File {
    return new File([new Uint8Array([0xff, 0xd8, marker, 0xd9])], name, { type: 'image/jpeg' });
  }

  /** One income row, so the write path skips budget recalculation. */
  function reads(amount: number, description: string, currency = 'USD'): void {
    ai.processReceipt.and.resolveTo({
      transactions: [{
        date: new Date(2026, 5, 15),
        description,
        amount,
        type: 'income',
        currency,
        confidence: 0.9,
        source: 'cloud',
        suggestedCategoryId: 'salary',
        imageIndex: 0,
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
        storageBucket: 'demo-home-account.appspot.com',
      },
      `offline-queue-smoke-${Date.now()}`,
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
        // The photo travels through the real upload: what these cases prove is
        // that a drained receipt's bytes land at the slot its document points
        // at, which a stubbed StorageService cannot say anything about.
        StorageService,
        { provide: Storage, useValue: storage },
        // Quota decisions are unit-tested, and the real service injects
        // RemoteConfigService, which this run has no transport for.
        {
          provide: ReceiptQuotaService,
          useValue: {
            canAddImages: async () => true,
            noteImagesAdded: () => undefined,
            noteImagesRemoved: () => undefined,
            invalidateCount: () => undefined,
          },
        },
        // The one stub: reading a photo reaches a cloud or native provider with
        // no local emulator. Everything downstream of it is real.
        { provide: AIStrategyService, useValue: ai },
        // Stubbed so the processor's user feedback stays out of this test:
        // the real NotificationService pulls in the snackbar and the HTTP-backed
        // translation loader, neither of which the emulator run has.
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: TranslationService, useValue: jasmine.createSpyObj('TranslationService', ['t']) },
        // The processor's attempt record: the history write is real (it is
        // what the case below proves), analytics is stubbed because the
        // queue door never sends and the real service needs a transport.
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['trackReceiptImport']) },
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

  // #205, the other half of #169. Reclaiming a stranded row is only safe if
  // draining it a second time is a no-op for whatever the first drain already
  // wrote — and the row that gets reclaimed is most often one whose rows *did*
  // land, since the crash window sits between the ledger write and the status
  // flip. Before this fix the replay posted the whole receipt again, and the
  // user found every row of it twice in their ledger with no way to tell which
  // copy was which.
  it('posts a reclaimed receipt once even when its rows already landed', async () => {
    const amount = 531.97;
    const description = 'Smoke replay once';
    const matching = async (): Promise<unknown[]> => {
      const stored = await firestoreService.getCollection<{ amount: number; description: string }>(
        `users/${uid}/transactions`,
      );
      return stored.filter((t) => t.amount === amount && t.description === description);
    };

    reads(amount, description);
    const id = await queue.queueImage(receiptFile());

    // First drain: the receipt posts and the row is marked completed.
    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);
    expect((await matching()).length).toBe(1);

    // Exactly the state a crash between the ledger write and the status flip
    // leaves behind: the rows are in Firestore, the row still says processing.
    await queue.updateImageStatus(id, 'processing');

    // Next launch over the same database reclaims it.
    processor.ngOnDestroy();
    queue.ngOnDestroy();
    await configure();

    const [reclaimed] = await queue.getPendingImages();
    expect(reclaimed?.id).toBe(id);

    // The replay re-reads the image and re-posts what it read — at the same
    // ids as the first pass, so the ledger is unchanged.
    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    expect((await matching()).length).toBe(1);
  }, 45000);

  // #151. A queued image that reads nothing used to leave no trace outside
  // the IndexedDB row's lastError. Now it is a failed record in Import
  // History, written under the real rules, and no analytics event.
  it('leaves a failed Import History record when a queued receipt reads nothing', async () => {
    ai.processReceipt.and.resolveTo({ transactions: [], source: 'cloud', confidence: 0, processingTimeMs: 1 });
    const id = await queue.queueImage(receiptFile('blank.jpg'));

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.peekQueuedImage(id))?.status === 'failed');

    await waitFor(async () => {
      const imports = await firestoreService.getCollection<{ door?: string; errorType?: string; fileName: string }>(
        `users/${uid}/imports`,
      );
      return imports.some((i) => i.fileName === 'blank.jpg' && i.door === 'queue' && i.errorType === 'nothing_extracted');
    });
    expect(TestBed.inject(AnalyticsService).trackReceiptImport).not.toHaveBeenCalled();
  }, 20000);

  // ADR 0059 through the queue door, under real rules: the printed address
  // survives to the stored document, and a slot nobody filled is absent.
  it('stores the location a queued receipt printed, through the one mapper', async () => {
    ai.processReceipt.and.resolveTo({
      transactions: [{
        date: new Date(2026, 5, 15), description: 'Smoke located', amount: 88.8, type: 'income',
        currency: 'USD', confidence: 0.9, source: 'cloud', suggestedCategoryId: 'salary',
        location: { name: 'Shibuya 1-2-3', country: 'JP' }, tags: ['trip'],
      }],
      source: 'cloud', confidence: 0.9, processingTimeMs: 1,
    });
    const id = await queue.queueImage(receiptFile());

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{
      amount: number; location?: { name: string; country?: string }; tags?: string[]; period?: unknown;
    }>(`users/${uid}/transactions`);
    const row = stored.find((t) => t.amount === 88.8);
    expect(row?.location).toEqual({ name: 'Shibuya 1-2-3', country: 'JP' });
    expect(row?.tags).toEqual(['trip']);
    expect(row && 'period' in row).toBeFalse();
  }, 20000);

  // This task: resolveImportDate now runs ahead of toCreateTransactionDTO on
  // this door, so a doubted reading has to be proved against a real write —
  // the unit suite mocks the clock and asserts instant equality, which this
  // emulator run cannot do (the smoke rules ban mocking the clock here, since
  // it would fight the Firebase SDK's own timers). `testStart` and `>=` are
  // the substitute: the row's stored date must fall at or after the moment
  // the drain began, never at the stale reading the engine doubted.
  it('drains a queued receipt whose engine doubted the date into a transaction dated at drain time', async () => {
    const testStart = Date.now();
    ai.processReceipt.and.resolveTo({
      transactions: [{
        date: new Date(2020, 0, 1), description: 'Smoke doubted date', amount: 64.19, type: 'income',
        currency: 'USD', confidence: 0.9, source: 'cloud', suggestedCategoryId: 'salary',
        fieldConfidence: { date: 0.3 },
      }],
      source: 'cloud', confidence: 0.9, processingTimeMs: 1,
    });
    const id = await queue.queueImage(receiptFile());

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number; date: Timestamp }>(
      `users/${uid}/transactions`,
    );
    const row = stored.find((t) => t.amount === 64.19);
    expect(row?.date.toMillis()).toBeGreaterThanOrEqual(testStart);
  }, 20000);

  // The companion case: resolveImportDate leaves a reading the engine
  // trusted alone, proved the same way — through the real write.
  it('drains a confident queued date into the transaction unchanged', async () => {
    const original = new Date(2026, 5, 15);
    ai.processReceipt.and.resolveTo({
      transactions: [{
        date: original, description: 'Smoke confident date', amount: 73.28, type: 'income',
        currency: 'USD', confidence: 0.9, source: 'cloud', suggestedCategoryId: 'salary',
        fieldConfidence: { date: 0.9 },
      }],
      source: 'cloud', confidence: 0.9, processingTimeMs: 1,
    });
    const id = await queue.queueImage(receiptFile());

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{ amount: number; date: Timestamp }>(
      `users/${uid}/transactions`,
    );
    const row = stored.find((t) => t.amount === 73.28);
    expect(row?.date.toMillis()).toBe(original.getTime());
  }, 20000);

  // This door builds no review row, so toCreateTransactionDTO's own rounding
  // is the only thing between a fractional reading and the ledger — and yen
  // has no minor unit to hold the fraction in.
  it('writes a queued yen fraction whole', async () => {
    reads(179.4, 'Queued yen', 'JPY');
    const id = await queue.queueImage(receiptFile());

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{
      amount: number; currency: string; description: string;
    }>(`users/${uid}/transactions`);
    const row = stored.find((t) => t.description === 'Queued yen');
    expect(row?.amount).toBe(179);
    expect(row?.currency).toBe('JPY');
  }, 20000);

  // #431 P1, against real Storage. A receipt queued offline is queued
  // precisely because its photograph was the point of the capture, and this
  // was the one import door that dropped it.
  it('a drained receipt lands with its photo attached', async () => {
    reads(311.11, 'Smoke queued photo');
    const id = await queue.queueImage(markedFile(0x41));

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    const stored = await firestoreService.getCollection<{
      amount: number; receiptUrls?: string[]; receiptCount?: number;
    }>(`users/${uid}/transactions`);
    const row = stored.find((t) => t.amount === 311.11);
    expect(row?.receiptUrls?.length).toBe(1);
    expect(row?.receiptCount).toBe(1);

    // The slot key is the row's own id, so the bytes are findable from the
    // id alone — which is what makes the replay below land on them again.
    await expectAsync(
      getMetadata(ref(storage, `users/${uid}/receipts/${id}-0`)),
    ).toBeResolved();
  }, 30000);

  // The upload precedes the document write, so a drain interrupted between
  // them leaves bytes at the slot with nothing pointing at them. The replay
  // has to land on that same slot: a fresh key per pass would leave the
  // orphan behind and bill the account for it on every retry.
  it('re-uploads into the same slot on a replay', async () => {
    reads(412.12, 'Smoke replay slot');
    const id = await queue.queueImage(markedFile(0x42));
    const rowId = `${id}-0`;
    const objectsForRow = async (): Promise<string[]> => {
      const listed = await listAll(ref(storage, `users/${uid}/receipts`));
      return listed.items.map((i) => i.name).filter((name) => name.startsWith(rowId));
    };

    // Exactly the interruption: the photo is uploaded, the document is not.
    spyOn(firestoreService, 'setDocument').and.rejectWith(new Error('Interrupted'));
    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.peekQueuedImage(id))?.status === 'failed');
    expect(await objectsForRow()).toEqual([rowId]);

    // Back to the state syncQueue leaves behind, then the next launch
    // reclaims it — over a fresh service stack, so the spy is gone.
    await queue.updateImageStatus(id, 'processing');
    processor.ngOnDestroy();
    queue.ngOnDestroy();
    await configure();

    const [reclaimed] = await queue.getPendingImages();
    expect(reclaimed?.id).toBe(id);

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.getPendingImages()).length === 0);

    expect(await objectsForRow()).toEqual([rowId]);
    const stored = await firestoreService.getCollection<{
      amount: number; receiptUrls?: string[];
    }>(`users/${uid}/transactions`);
    expect(stored.find((t) => t.amount === 412.12)?.receiptUrls?.length).toBe(1);
  }, 45000);

  // #431 P2, through the client guard that does the refusing
  // (TransactionService checks the amount before it writes, so importers get
  // a row they can report rather than an opaque permission error). A sub-unit
  // yen figure rounds to zero, which every pass this image ever gets will
  // refuse — so failing the image for it only kept the rows beside it out of
  // the ledger too. The refused row is first, which is also the row the
  // planner handed the receipt's photo to: the picture has to reach the row
  // behind it rather than go down with it.
  it('one refused row does not fail the image, and its photo lands on the next row', async () => {
    const row = (description: string, amount: number, currency = 'USD') => ({
      date: new Date(2026, 5, 15),
      description,
      amount,
      type: 'income' as const,
      currency,
      confidence: 0.9,
      source: 'cloud' as const,
      suggestedCategoryId: 'salary',
      imageIndex: 0,
    });
    ai.processReceipt.and.resolveTo({
      transactions: [
        row('Smoke refused first', 0.4, 'JPY'),
        row('Smoke refused second', 55.55),
        row('Smoke refused last', 66.66),
      ],
      source: 'cloud', confidence: 0.9, processingTimeMs: 1,
    });
    const id = await queue.queueImage(markedFile(0x44));

    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
    await waitFor(async () => (await queue.peekQueuedImage(id))?.status === 'completed');

    const stored = await firestoreService.getCollection<{
      description: string; receiptUrls?: string[];
    }>(`users/${uid}/transactions`);
    const drained = stored.filter((t) => t.description.startsWith('Smoke refused'));
    expect(drained.map((t) => t.description).sort()).toEqual([
      'Smoke refused last', 'Smoke refused second',
    ]);
    // The photo was planned for the row the ledger refused, so the one
    // document holding it has to be the row behind it — not none of them.
    expect(
      drained.filter((t) => t.receiptUrls?.length === 1).map((t) => t.description),
    ).toEqual(['Smoke refused second']);
  }, 30000);
});
