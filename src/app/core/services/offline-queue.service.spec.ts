import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { openDB } from 'idb';
import { DB_NAME, OfflineQueueService, QUEUE_NOT_SIGNED_IN } from './offline-queue.service';
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

    it('throws when queueing without an initialized database', async () => {
      (service as unknown as { db: null }).db = null;
      await expectAsync(service.queueImage(imageFile())).toBeRejectedWithError('Database not initialized');
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

  });

  describe('removal and clearing', () => {
    it('removes an image', async () => {
      const imgId = await service.queueImage(imageFile());
      await service.removeImage(imgId);
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

    it('dispatches a processing event for each pending image', async () => {
      await service.queueImage(imageFile('a.jpg'));
      await service.queueImage(imageFile('b.jpg'));
      const imageEvents: Event[] = [];
      const imageListener = (e: Event) => imageEvents.push(e);
      window.addEventListener('process-queued-image', imageListener);

      const result = await service.syncQueue();

      window.removeEventListener('process-queued-image', imageListener);
      // success counts items handed off for async processing; the real outcome
      // is set later by OfflineQueueProcessorService.
      expect(result.success).toBe(2);
      expect(imageEvents.length).toBe(2);
      expect(service.isSyncing()).toBeFalse();
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
      expect(stats.failedItems).toBe(0);
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
      expect(await service.getQueuedImage('x')).toBeUndefined();
      expect(await service.getSyncLog()).toEqual([]);
      await service.removeImage('x');
      await service.clearCompleted();
      await service.clearFailed();
      await service.clearAll();
      await service.clearOldLogs();
      await service.updateImageStatus('x', 'failed');
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

  /**
   * `syncQueue` marks an item `processing` and then only dispatches a DOM
   * event; the processor's work is `void`-ed, so nothing can await it. If the
   * tab closes mid-receipt the row is stranded — and `processing` is invisible
   * to every getter, counter, retry and clear, so the receipt is lost while its
   * bytes stay in IndexedDB.
   *
   * The database name is a constant, so closing this service and opening a
   * second one is exactly the app relaunching over the same data.
   */
  describe('reclaiming work interrupted mid-sync', () => {
    /** Close this connection and open a fresh service over the same database. */
    async function relaunch(): Promise<OfflineQueueService> {
      service.ngOnDestroy();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          OfflineQueueService,
          { provide: PwaService, useValue: pwa },
          { provide: AuthService, useValue: { userId } },
        ],
      });
      const reopened = TestBed.inject(OfflineQueueService);
      await waitFor(() => reopened.isReady());
      return reopened;
    }

    it('hides an item that is in flight, which is why losing one is silent', async () => {
      const id = await service.queueImage(imageFile('a.jpg'));
      await service.updateImageStatus(id, 'processing');

      // Documents the hole rather than asserting it is acceptable: none of
      // these ever sees the row again on its own.
      expect(await service.getPendingImages()).toEqual([]);
      expect(service.pendingCount()).toBe(0);
      expect((await service.getStats()).pendingImages).toBe(0);
      await service.clearCompleted();
      await service.clearFailed();
      // Still there, taking up space, reachable only by id.
      expect((await service.getQueuedImage(id))?.status).toBe('processing');
    });

    it('reclaims a stranded image on the next launch', async () => {
      const id = await service.queueImage(imageFile('a.jpg'));
      await service.updateImageStatus(id, 'processing');

      service = await relaunch();

      expect((await service.getPendingImages()).map((i) => i.id)).toEqual([id]);
      expect(service.pendingCount()).toBe(1);
    });

    it('counts the reclaimed item the moment the queue reports ready', async () => {
      const id = await service.queueImage(imageFile('a.jpg'));
      await service.updateImageStatus(id, 'processing');

      service = await relaunch();

      // The sweep runs before _isReady flips, so a syncQueue() fired off the
      // readiness signal cannot race past a row that is still `processing`.
      expect(service.pendingCount()).toBe(1);
    });

    it('charges the reclaim a retry, so a row that kills the tab cannot loop forever', async () => {
      const id = await service.queueImage(imageFile('a.jpg'));
      await service.updateImageStatus(id, 'processing');

      service = await relaunch();

      const [reclaimed] = await service.getPendingImages();
      expect(reclaimed.retryCount).toBe(1);
    });

    it('reclaims another account\'s stranded row too, rather than wedging it', async () => {
      userId.set('user-b');
      const id = await service.queueImage(imageFile('b.jpg'));
      await service.updateImageStatus(id, 'processing');

      // Nobody is signed in when the database opens, which is why the sweep is
      // the one operation here that is deliberately not scoped by owner.
      userId.set(null);
      service = await relaunch();

      userId.set('user-b');
      expect((await service.getPendingImages()).map((i) => i.id)).toEqual([id]);
    });
  });

  /**
   * The queued-transaction path never had a caller in the shipped app, so the
   * store it wrote to is empty on every device that has one, and deleting an
   * object store is only legal inside a `versionchange` transaction — which is
   * why the schema version moved rather than the store being left to rot.
   *
   * What this asserts is the shape the app opens, not the v2 → v3 migration
   * itself. Seeding a real v2 database here needs `deleteDB`, and that blocks
   * on any connection this suite still holds open, which made the whole file
   * flaky. The migration branch is a `contains()` guard around one call, and
   * the store's absence afterwards is what any of it is for.
   */
  describe('schema', () => {
    it('carries no queued-transaction store', async () => {
      const open = await openDB(DB_NAME);
      const stores = Array.from(open.objectStoreNames);
      open.close();

      expect(stores).not.toContain('pending-transactions');
      expect(stores).toContain('pending-images');
      expect(stores).toContain('sync-log');
    });
  });
});
