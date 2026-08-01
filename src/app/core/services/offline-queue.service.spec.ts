import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { OfflineQueueService, QUEUE_NOT_SIGNED_IN } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';

async function waitFor(pred: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function imageFile(name = 'r.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

/** Every account this suite signs in as; all of them get cleared between tests. */
const TEST_ACCOUNTS = ['user-a', 'user-b'] as const;

describe('OfflineQueueService', () => {
  let service: OfflineQueueService;
  let pwa: jasmine.SpyObj<PwaService>;
  let userId: WritableSignal<string | null>;

  beforeEach(async () => {
    pwa = jasmine.createSpyObj('PwaService', ['isOnline', 'registerBackgroundSync']);
    pwa.isOnline.and.returnValue(true);

    userId = signal<string | null>('user-a');

    TestBed.configureTestingModule({
      providers: [
        OfflineQueueService,
        { provide: PwaService, useValue: pwa },
        { provide: AuthService, useValue: { userId } },
      ],
    });
    service = TestBed.inject(OfflineQueueService);
    await waitFor(() => service.isReady());

    // Reset shared IndexedDB state between tests (the DB name is a constant).
    // clearAll() is scoped to the signed-in account now, so every account the
    // suite uses has to be cleared, not just the default one.
    for (const uid of TEST_ACCOUNTS) {
      userId.set(uid);
      await service.clearAll();
    }
    userId.set(TEST_ACCOUNTS[0]);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('initializes the database', () => {
    expect(service.isReady()).toBeTrue();
    expect(service.pendingCount()).toBe(0);
  });

  describe('queueing', () => {
    it('queues an image and tracks it as pending', async () => {
      const id = await service.queueImage(imageFile());
      expect(id).toMatch(/^img_/);
      expect(service.pendingCount()).toBe(1);
      expect(service.hasPendingItems()).toBeTrue();
      expect(pwa.registerBackgroundSync).toHaveBeenCalledWith('sync-offline-queue');
      const pending = await service.getPendingImages();
      expect(pending.length).toBe(1);
    });

    it('queues multiple images', async () => {
      const ids = await service.queueImages([imageFile('a.jpg'), imageFile('b.jpg')]);
      expect(ids.length).toBe(2);
      expect(service.pendingCount()).toBe(2);
    });

    it('queues a transaction', async () => {
      const id = await service.queueTransaction({
        date: '2026-06-15', description: 'Coffee', amount: 4, type: 'expense',
        currency: 'USD', categoryId: 'food', source: 'local',
      });
      expect(id).toMatch(/^tx_/);
      const pending = await service.getPendingTransactions();
      expect(pending[0].description).toBe('Coffee');
    });

    it('throws when queueing without an initialized database', async () => {
      (service as unknown as { db: null }).db = null;
      await expectAsync(service.queueImage(imageFile())).toBeRejectedWithError('Database not initialized');
      await expectAsync(
        service.queueTransaction({
          date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
          currency: 'USD', categoryId: 'c', source: 'local',
        }),
      ).toBeRejectedWithError('Database not initialized');
    });
  });

  describe('retrieval and conversion', () => {
    it('reads a queued image back as a File', async () => {
      const id = await service.queueImage(imageFile('receipt.jpg'));
      const queued = await service.getQueuedImage(id);
      expect(queued?.fileName).toBe('receipt.jpg');
      const file = await service.getQueuedImageAsFile(id);
      expect(file?.name).toBe('receipt.jpg');
    });

    it('returns null for a missing image file', async () => {
      expect(await service.getQueuedImageAsFile('nope')).toBeNull();
    });
  });

  describe('status updates', () => {
    it('updates image status and increments retry count on error', async () => {
      const id = await service.queueImage(imageFile());
      await service.updateImageStatus(id, 'failed', 'boom');
      const img = await service.getQueuedImage(id);
      expect(img?.status).toBe('failed');
      expect(img?.retryCount).toBe(1);
      expect(img?.lastError).toBe('boom');
    });

    it('marks a transaction completed with a synced timestamp', async () => {
      const id = await service.queueTransaction({
        date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
        currency: 'USD', categoryId: 'c', source: 'local',
      });
      await service.updateTransactionStatus(id, 'completed');
      const txs = await service.getPendingTransactions();
      expect(txs.length).toBe(0); // no longer pending
    });

    it('records an error on a failed transaction', async () => {
      const id = await service.queueTransaction({
        date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
        currency: 'USD', categoryId: 'c', source: 'local',
      });
      await service.updateTransactionStatus(id, 'failed', 'nope');
      const txs = await service.getPendingTransactions();
      expect(txs[0].lastError).toBe('nope');
      expect(txs[0].retryCount).toBe(1);
    });
  });

  describe('removal and clearing', () => {
    it('removes an image and a transaction', async () => {
      const imgId = await service.queueImage(imageFile());
      const txId = await service.queueTransaction({
        date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
        currency: 'USD', categoryId: 'c', source: 'local',
      });
      await service.removeImage(imgId);
      await service.removeTransaction(txId);
      expect(service.pendingCount()).toBe(0);
    });

    it('clears completed, failed and all items', async () => {
      const a = await service.queueImage(imageFile('a.jpg'));
      const b = await service.queueImage(imageFile('b.jpg'));
      await service.updateImageStatus(a, 'completed');
      await service.updateImageStatus(b, 'failed', 'e');
      await service.clearCompleted();
      expect((await service.getStats()).failedItems).toBe(1);
      await service.clearFailed();
      expect((await service.getStats()).failedItems).toBe(0);
      await service.queueImage(imageFile('c.jpg'));
      await service.clearAll();
      expect(service.pendingCount()).toBe(0);
    });
  });

  describe('syncQueue', () => {
    it('does nothing while offline', async () => {
      pwa.isOnline.and.returnValue(false);
      const result = await service.syncQueue();
      expect(result).toEqual({ success: 0, failed: 0 });
    });

    it('reports completion with no pending items', async () => {
      const result = await service.syncQueue();
      expect(result).toEqual({ success: 0, failed: 0 });
      expect(service.lastSyncTime()).not.toBeNull();
    });

    it('dispatches processing events for pending images and transactions', async () => {
      await service.queueImage(imageFile());
      await service.queueTransaction({
        date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
        currency: 'USD', categoryId: 'c', source: 'local',
      });
      const imageEvents: Event[] = [];
      const txEvents: Event[] = [];
      const imageListener = (e: Event) => imageEvents.push(e);
      const txListener = (e: Event) => txEvents.push(e);
      window.addEventListener('process-queued-image', imageListener);
      window.addEventListener('sync-queued-transaction', txListener);

      const result = await service.syncQueue();

      window.removeEventListener('process-queued-image', imageListener);
      window.removeEventListener('sync-queued-transaction', txListener);
      // success now counts items handed off for async processing (image + tx);
      // the real outcome is set later by OfflineQueueProcessorService.
      expect(result.success).toBe(2);
      expect(imageEvents.length).toBe(1);
      expect(txEvents.length).toBe(1);
      expect(service.isSyncing()).toBeFalse();
    });

    it('fails transactions that exceeded the retry limit', async () => {
      const id = await service.queueTransaction({
        date: '2026-06-15', description: 'x', amount: 1, type: 'expense',
        currency: 'USD', categoryId: 'c', source: 'local',
      });
      // Push retry count past the limit.
      for (let i = 0; i < 3; i++) await service.updateTransactionStatus(id, 'failed', 'e');
      const result = await service.syncQueue();
      expect(result.failed).toBeGreaterThanOrEqual(1);
    });

    it('fails images that exceeded the retry limit', async () => {
      const id = await service.queueImage(imageFile());
      // Push retry count past the limit.
      for (let i = 0; i < 3; i++) await service.updateImageStatus(id, 'failed', 'e');
      const result = await service.syncQueue();
      expect(result.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('stats and logs', () => {
    it('reports queue statistics', async () => {
      await service.queueImage(imageFile());
      const stats = await service.getStats();
      expect(stats.pendingImages).toBe(1);
      expect(stats.pendingTransactions).toBe(0);
    });

    it('records and trims the sync log', async () => {
      await service.queueImage(imageFile());
      const log = await service.getSyncLog();
      expect(log.length).toBeGreaterThan(0);
      await service.clearOldLogs(0); // everything is "old"
      expect((await service.getSyncLog()).length).toBe(0);
    });

    it('trims entries logged in the same millisecond as the cutoff', async () => {
      // On a fast run the queue write and the cutoff computation can land in
      // the same millisecond; freezing the clock reproduces that timing
      // deterministically instead of once in a blue moon mid-suite.
      spyOn(Date, 'now').and.returnValue(1_800_000_000_000);
      await service.queueImage(imageFile());
      await service.clearOldLogs(0);
      expect((await service.getSyncLog()).length).toBe(0);
    });

    it('reports storage usage', async () => {
      const usage = await service.getStorageUsage();
      expect(usage.used).toBeGreaterThanOrEqual(0);
      expect(usage.quota).toBeGreaterThanOrEqual(0);
    });
  });

  describe('without a database', () => {
    beforeEach(() => {
      (service as unknown as { db: null }).db = null;
    });

    it('degrades gracefully on reads and clears', async () => {
      expect(await service.getPendingImages()).toEqual([]);
      expect(await service.getPendingTransactions()).toEqual([]);
      expect(await service.getQueuedImage('x')).toBeUndefined();
      expect(await service.getSyncLog()).toEqual([]);
      await service.removeImage('x');
      await service.removeTransaction('x');
      await service.clearCompleted();
      await service.clearFailed();
      await service.clearAll();
      await service.clearOldLogs();
      await service.updateImageStatus('x', 'failed');
      await service.updateTransactionStatus('x', 'failed');
      const stats = await service.getStats();
      expect(stats.pendingImages).toBe(0);
      expect(service.pendingCount()).toBe(0);
    });
  });

  describe('account isolation', () => {
    // The regression. The queue is one device-global IndexedDB with no owner
    // recorded, so a receipt captured offline by one account was drained into
    // whichever account happened to be signed in when the connection came back.
    it('hides one account\'s queued images from another', async () => {
      await service.queueImage(imageFile());
      expect((await service.getPendingImages()).length).toBe(1);

      userId.set('user-b');

      expect(await service.getPendingImages()).toEqual([]);
      expect((await service.getStats()).pendingImages).toBe(0);
    });

    it('gives them back when the owning account returns', async () => {
      const id = await service.queueImage(imageFile());

      userId.set('user-b');
      expect(await service.getPendingImages()).toEqual([]);

      userId.set('user-a');
      const pending = await service.getPendingImages();
      expect(pending.map(i => i.id)).toEqual([id]);
    });

    it('does not hand a foreign image to a caller by id', async () => {
      const id = await service.queueImage(imageFile());

      userId.set('user-b');

      expect(await service.getQueuedImage(id)).toBeUndefined();
      expect(await service.getQueuedImageAsFile(id)).toBeNull();
      // peek is the deliberate exception, so the processor can tell "not mine"
      // apart from "gone".
      expect((await service.peekQueuedImage(id))?.userId).toBe('user-a');
    });

    it('refuses to queue while signed out rather than writing an ownerless row', async () => {
      userId.set(null);

      await expectAsync(service.queueImage(imageFile()))
        .toBeRejectedWithError(QUEUE_NOT_SIGNED_IN);
    });

    it('does not sync or dispatch while signed out', async () => {
      await service.queueImage(imageFile());
      const dispatched = spyOn(window, 'dispatchEvent').and.callThrough();

      userId.set(null);
      const result = await service.syncQueue();

      expect(result).toEqual({ success: 0, failed: 0 });
      expect(dispatched).not.toHaveBeenCalled();
    });

    it('dispatches only the signed-in account\'s items', async () => {
      await service.queueImage(imageFile('a.jpg'));
      userId.set('user-b');
      await service.queueImage(imageFile('b.jpg'));

      const events: string[] = [];
      spyOn(window, 'dispatchEvent').and.callFake((event: Event) => {
        const detail = (event as CustomEvent<{ id: string }>).detail;
        if (event.type === 'process-queued-image') events.push(detail.id);
        return true;
      });

      await service.syncQueue();

      const bPending = await service.getPendingImages();
      expect(events.length).toBe(1);
      expect(bPending.length).toBe(0); // now 'processing', so no longer pending
      expect(events[0]).toMatch(/^img_/);
    });

    it('clears only the signed-in account\'s queue', async () => {
      await service.queueImage(imageFile('a.jpg'));
      userId.set('user-b');
      await service.queueImage(imageFile('b.jpg'));

      await service.clearAll();
      expect(await service.getPendingImages()).toEqual([]);

      userId.set('user-a');
      expect((await service.getPendingImages()).length).toBe(1);
    });

    it('counts only the signed-in account\'s pending items', async () => {
      await service.queueImage(imageFile('a.jpg'));
      await service.queueImage(imageFile('a2.jpg'));
      expect(service.pendingCount()).toBe(2);

      userId.set('user-b');
      await service.queueImage(imageFile('b.jpg'));

      expect(service.pendingCount()).toBe(1);
    });
  });
});
