import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import {
  BATCH_SIZE,
  INITIAL_BATCH,
  MAX_WINDOW,
  TransactionWindowService
} from './transaction-window.service';
import { FirestoreService, PageResult } from './firestore.service';
import { AuthService } from './auth.service';
import { MockAuthService, MockFirestoreService, createTransaction } from './testing';
import { Transaction } from '../../models';

const PATH = 'users/test-user-123/transactions';
const TRIM_THRESHOLD = MAX_WINDOW + BATCH_SIZE;

describe('TransactionWindowService', () => {
  let service: TransactionWindowService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;

  // Seeded newest-first (the query order of the default date-desc window).
  function seedTransactions(count: number): Transaction[] {
    const base = new Date(2026, 5, 30, 12).getTime();
    const transactions = Array.from({ length: count }, (_, i) =>
      createTransaction({
        id: `txn-${String(i).padStart(4, '0')}`,
        date: Timestamp.fromMillis(base - i * 60 * 60 * 1000),
        amount: 10 + i,
        description: `row ${i}`
      })
    );
    mockFirestore.setMockCollection(PATH, transactions);
    return transactions;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionWindowService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService }
      ]
    });
    service = TestBed.inject(TransactionWindowService);
    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    mockAuth.setAuthenticated(true);
    service.retryBaseDelayMs = 0;
  });

  describe('reset', () => {
    it('loads the initial batch and marks the start reached', async () => {
      const seeded = seedTransactions(300);
      await service.reset();

      expect(service.window().length).toBe(INITIAL_BATCH);
      expect(service.window()[0].id).toBe(seeded[0].id);
      expect(service.reachedStart()).toBeTrue();
      expect(service.reachedEnd()).toBeFalse();
      expect(service.isInitialLoading()).toBeFalse();
      expect(service.resetSeq()).toBe(1);

      await Promise.resolve();
      expect(service.totalCount()).toBe(300);
    });

    it('marks the end reached when the collection is smaller than a batch', async () => {
      seedTransactions(30);
      await service.reset();

      expect(service.window().length).toBe(30);
      expect(service.reachedEnd()).toBeTrue();
      expect(service.reachedStart()).toBeTrue();
    });

    it('does nothing when unauthenticated', async () => {
      mockAuth.setAuthenticated(false);
      seedTransactions(10);
      await service.reset();
      expect(service.window().length).toBe(0);
    });
  });

  describe('fetchNext / trim hysteresis', () => {
    it('appends batches and trims the head only past the overflow threshold', async () => {
      const seeded = seedTransactions(300);
      await service.reset();

      expect(await service.fetchNext()).toBe(BATCH_SIZE);
      expect(service.window().length).toBe(75);
      expect(service.reachedStart()).toBeTrue();

      expect(await service.fetchNext()).toBe(BATCH_SIZE);
      expect(service.window().length).toBe(MAX_WINDOW);
      expect(service.reachedStart()).toBeTrue();

      // Third batch overflows to 125: direction confirmed, head trimmed.
      expect(await service.fetchNext()).toBe(BATCH_SIZE);
      expect(service.window().length).toBe(MAX_WINDOW);
      expect(service.reachedStart()).toBeFalse();
      expect(service.window()[0].id).toBe(seeded[BATCH_SIZE].id);
      expect(service.window()[MAX_WINDOW - 1].id).toBe(seeded[TRIM_THRESHOLD - 1].id);
    });

    it('detects the end on a short page and stops querying afterwards', async () => {
      seedTransactions(60);
      await service.reset();

      expect(await service.fetchNext()).toBe(10);
      expect(service.reachedEnd()).toBeTrue();

      const calls = mockFirestore.getPageSpy.calls.length;
      expect(await service.fetchNext()).toBe(0);
      expect(mockFirestore.getPageSpy.calls.length).toBe(calls);
    });

    it('issues a single query for concurrent calls', async () => {
      seedTransactions(300);
      await service.reset();

      let release!: (value: PageResult<Transaction>) => void;
      const gate = new Promise<PageResult<Transaction>>(resolve => (release = resolve));
      const realGetPage = mockFirestore.getPage.bind(mockFirestore);
      spyOn(mockFirestore, 'getPage').and.returnValue(gate as never);

      const first = service.fetchNext();
      const second = service.fetchNext();
      release((await realGetPage(PATH, {
        orderBy: [{ field: 'date', direction: 'desc' }],
        startAfterDoc: { id: 'txn-0049' },
        limit: BATCH_SIZE
      })) as unknown as PageResult<Transaction>);

      expect(await second).toBe(0);
      expect(await first).toBe(BATCH_SIZE);
      expect(mockFirestore.getPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchPrev', () => {
    async function scrollPastTrim(): Promise<Transaction[]> {
      const seeded = seedTransactions(300);
      await service.reset();
      await service.fetchNext();
      await service.fetchNext();
      await service.fetchNext(); // window now rows 25..124, reachedStart false
      return seeded;
    }

    it('prepends a batch and trims the tail past the overflow threshold', async () => {
      const seeded = await scrollPastTrim();

      expect(await service.fetchPrev()).toBe(BATCH_SIZE);
      expect(service.window().length).toBe(MAX_WINDOW);
      expect(service.window()[0].id).toBe(seeded[0].id);
      expect(service.window()[MAX_WINDOW - 1].id).toBe(seeded[MAX_WINDOW - 1].id);
      expect(service.reachedEnd()).toBeFalse();
    });

    it('marks the start reached on an empty page', async () => {
      await scrollPastTrim();
      await service.fetchPrev(); // back to rows 0..99

      expect(await service.fetchPrev()).toBe(0);
      expect(service.reachedStart()).toBeTrue();
    });

    it('is a no-op while the start is already reached', async () => {
      seedTransactions(300);
      await service.reset();

      const calls = mockFirestore.getPageSpy.calls.length;
      expect(await service.fetchPrev()).toBe(0);
      expect(mockFirestore.getPageSpy.calls.length).toBe(calls);
    });
  });

  describe('failure fallback', () => {
    it('retries a failing page fetch before surfacing an error', async () => {
      seedTransactions(300);
      await service.reset();

      const realGetPage = mockFirestore.getPage.bind(mockFirestore);
      let attempts = 0;
      spyOn(mockFirestore, 'getPage').and.callFake(((path: string, options: never) => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error('offline'));
        return realGetPage(path, options);
      }) as never);

      expect(await service.fetchNext()).toBe(BATCH_SIZE);
      expect(attempts).toBe(3);
      expect(service.loadError()).toBeNull();
    });

    it('sets loadError without touching the window when all attempts fail, and retry() recovers', async () => {
      seedTransactions(300);
      await service.reset();
      const before = service.window();

      const realGetPage = mockFirestore.getPage.bind(mockFirestore);
      const spy = spyOn(mockFirestore, 'getPage').and.rejectWith(new Error('offline'));

      expect(await service.fetchNext()).toBe(0);
      expect(service.loadError()).toBe('next');
      expect(service.window()).toBe(before);
      expect(service.reachedEnd()).toBeFalse();

      spy.and.callFake(realGetPage as never);
      await service.retry();
      expect(service.loadError()).toBeNull();
      expect(service.window().length).toBe(75);
    });

    it('re-runs the initial load when retrying an initial error', async () => {
      seedTransactions(300);
      const realGetPage = mockFirestore.getPage.bind(mockFirestore);
      const spy = spyOn(mockFirestore, 'getPage').and.rejectWith(new Error('offline'));

      await service.reset();
      expect(service.loadError()).toBe('initial');
      expect(service.window().length).toBe(0);

      spy.and.callFake(realGetPage as never);
      await service.retry();
      expect(service.loadError()).toBeNull();
      expect(service.window().length).toBe(INITIAL_BATCH);
    });
  });

  describe('refresh', () => {
    it('reloads from the top while the start is reached', async () => {
      const seeded = seedTransactions(300);
      await service.reset();

      const added = createTransaction({
        id: 'txn-new',
        date: Timestamp.fromMillis(seeded[0].date.toMillis() + 1000)
      });
      mockFirestore.setMockCollection(PATH, [added, ...seeded]);

      await service.refresh();
      expect(service.window()[0].id).toBe('txn-new');
      expect(service.window().length).toBe(INITIAL_BATCH);
      expect(service.reachedStart()).toBeTrue();
    });

    it('re-anchors on the first row date after the start was trimmed away', async () => {
      const seeded = seedTransactions(300);
      await service.reset();
      await service.fetchNext();
      await service.fetchNext();
      await service.fetchNext(); // rows 25..124

      // Delete a row inside the window; the window re-fetches around its
      // previous top by date value, not by the (possibly deleted) document.
      const remaining = seeded.filter(t => t.id !== seeded[30].id);
      mockFirestore.setMockCollection(PATH, remaining);

      await service.refresh();
      expect(service.window()[0].id).toBe(seeded[25].id);
      expect(service.window().some(t => t.id === seeded[30].id)).toBeFalse();
      expect(service.window().length).toBe(MAX_WINDOW);
      expect(service.reachedStart()).toBeFalse();
    });
  });

  describe('jumpTo', () => {
    it('re-seeds the window around an out-of-range date with context above', async () => {
      const seeded = seedTransactions(300);
      await service.reset(); // rows 0..49 loaded

      const target = seeded[200];
      await service.jumpTo(target.date);

      const ids = service.window().map(t => t.id);
      expect(ids).toContain(target.id);
      // BATCH_SIZE rows of context precede the target.
      expect(ids[0]).toBe(seeded[200 - BATCH_SIZE].id);
      expect(ids[BATCH_SIZE]).toBe(target.id);
      expect(service.reachedStart()).toBeFalse();
      expect(service.reachedEnd()).toBeFalse();
    });

    it('falls back to a top-of-list load when the date matches nothing', async () => {
      seedTransactions(40);
      await service.reset();

      // Older than every seeded row: the "below" page comes back empty.
      await service.jumpTo(Timestamp.fromMillis(0));
      expect(service.window().length).toBe(40);
      expect(service.reachedStart()).toBeTrue();
      expect(service.reachedEnd()).toBeTrue();
    });
  });

  describe('isInLoadedRange', () => {
    it('classifies dates against the loaded range and reached edges', async () => {
      const seeded = seedTransactions(300);
      await service.reset();
      await service.fetchNext();
      await service.fetchNext();
      await service.fetchNext(); // rows 25..124, reachedStart false

      const inside = seeded[60].date;
      const newerThanWindow = seeded[0].date;
      const olderThanWindow = seeded[200].date;

      expect(service.isInLoadedRange(inside)).toBeTrue();
      expect(service.isInLoadedRange(newerThanWindow)).toBeFalse();
      expect(service.isInLoadedRange(olderThanWindow)).toBeFalse();
    });

    it('treats a reached boundary as in range', async () => {
      const seeded = seedTransactions(60);
      await service.reset(); // reachedStart true

      const newer = Timestamp.fromMillis(seeded[0].date.toMillis() + 5000);
      expect(service.isInLoadedRange(newer)).toBeTrue();

      await service.fetchNext(); // reachedEnd true
      const older = Timestamp.fromMillis(seeded[59].date.toMillis() - 5000);
      expect(service.isInLoadedRange(older)).toBeTrue();
    });
  });

  describe('visibleWindow', () => {
    it('applies client-only filters to the view but keeps raw rows for paging', async () => {
      seedTransactions(300); // amounts are 10 + index
      await service.reset({ minAmount: 30 });

      expect(service.window().length).toBe(INITIAL_BATCH);
      expect(service.visibleWindow().length).toBe(30);
      expect(service.visibleWindow().every(t => t.amount >= 30)).toBeTrue();

      // Paging continues from the raw window edge, unaffected by the filter.
      expect(await service.fetchNext()).toBe(BATCH_SIZE);
      expect(service.visibleWindow().length).toBe(55);
    });
  });
});
