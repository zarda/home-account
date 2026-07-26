import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { of, throwError } from 'rxjs';
import {
  InsightSnapshotService,
  SNAPSHOT_BACKFILL_MONTHS,
} from './insight-snapshot.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { PwaService } from './pwa.service';
import { TransactionService } from './transaction.service';
import { InsightSnapshot, Transaction, User } from '../../models';
import { createTimestamp, createTransaction, createUser } from './testing/test-data';
import { findSerializationIssues } from '../utils/firestore-value.utils';

describe('InsightSnapshotService', () => {
  let service: InsightSnapshotService;
  let firestoreService: jasmine.SpyObj<FirestoreService>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let userId: ReturnType<typeof signal<string | null>>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let isOnline: ReturnType<typeof signal<boolean>>;

  /** June closed relative to this, so 2026-06 is the newest due month. */
  const now = new Date(2026, 6, 15, 9, 0);

  function expense(date: Date, amount: number, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'expense', amount, amountInBaseCurrency: amount,
      date: createTimestamp(date), ...overrides,
    });
  }

  function monthOf(month: number, count = 5): Transaction[] {
    return Array.from({ length: count }, (_, i) =>
      expense(new Date(2026, month, i + 1), 10 + i));
  }

  function stored(monthKey: string, overrides: Partial<InsightSnapshot> = {}): InsightSnapshot {
    return {
      id: monthKey, userId: 'u1', monthKey,
      detectorVersion: 1, schemaVersion: 1, status: 'complete',
      fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency: 'USD' },
      totals: { income: 0, expense: 10, balance: -10, count: 1 },
      byCategory: [],
      facts: {} as InsightSnapshot['facts'],
      cards: [],
      generatedAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      createdAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      revision: 1,
      ...overrides,
    };
  }

  /** Serve each month's range query from a single flat history. */
  function serveHistory(history: Transaction[]): void {
    transactionService.getTransactionsInRange.and.callFake((start: Date, end: Date) =>
      of(history.filter(t => {
        const date = t.date.toDate();
        return date >= start && date <= end;
      })));
  }

  beforeEach(() => {
    userId = signal<string | null>('u1');
    currentUser = signal<User | null>(createUser());
    isOnline = signal(true);

    firestoreService = jasmine.createSpyObj<FirestoreService>(
      'FirestoreService',
      ['subscribeToCollection', 'setDocument', 'getCollection', 'deleteDocument',
        'getTimestamp']);
    firestoreService.subscribeToCollection.and.returnValue(of([]));
    firestoreService.setDocument.and.returnValue(Promise.resolve());
    firestoreService.getCollection.and.returnValue(Promise.resolve([]));
    firestoreService.deleteDocument.and.returnValue(Promise.resolve());
    firestoreService.getTimestamp.and.returnValue(
      Timestamp.fromDate(new Date(2026, 6, 15)));

    transactionService = jasmine.createSpyObj<TransactionService>(
      'TransactionService', ['getTransactionsInRange']);
    transactionService.getTransactionsInRange.and.returnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        InsightSnapshotService,
        { provide: FirestoreService, useValue: firestoreService },
        { provide: TransactionService, useValue: transactionService },
        { provide: PwaService, useValue: { isOnline } },
        { provide: AuthService, useValue: { userId, currentUser } },
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
          },
        },
      ],
    });
    service = TestBed.inject(InsightSnapshotService);
  });

  describe('watch', () => {
    it('sorts snapshots newest first', async () => {
      firestoreService.subscribeToCollection.and.returnValue(
        of([stored('2026-03'), stored('2026-06'), stored('2026-01')]));
      await service.watch().toPromise();
      expect(service.snapshots().map(s => s.monthKey))
        .toEqual(['2026-06', '2026-03', '2026-01']);
      expect(service.latest()?.monthKey).toBe('2026-06');
    });

    it('drops a document written by a newer schema', async () => {
      firestoreService.subscribeToCollection.and.returnValue(
        of([stored('2026-06'), stored('2026-05', { schemaVersion: 99 })]));
      await service.watch().toPromise();
      expect(service.snapshots().map(s => s.monthKey)).toEqual(['2026-06']);
    });

    it('clears the signal on sign-out, so no history flashes for the next user', async () => {
      firestoreService.subscribeToCollection.and.returnValue(of([stored('2026-06')]));
      await service.watch().toPromise();
      expect(service.snapshots().length).toBe(1);

      userId.set(null);
      await service.watch().toPromise();
      expect(service.snapshots()).toEqual([]);
      expect(firestoreService.subscribeToCollection).toHaveBeenCalledTimes(1);
    });

    it('reads through a subscription, never getCollection', async () => {
      await service.watch().toPromise();
      // getDocs rejects on a cold cache offline; onSnapshot serves the cache.
      expect(firestoreService.subscribeToCollection).toHaveBeenCalled();
      expect(firestoreService.getCollection).not.toHaveBeenCalled();
    });
  });

  describe('generateClosedMonths', () => {
    it('writes a document per closed month with data', async () => {
      serveHistory([...monthOf(4), ...monthOf(5)]);
      const written = await service.generateClosedMonths(now);

      expect(written.map(s => s.monthKey)).toEqual(['2026-05', '2026-06']);
      expect(firestoreService.setDocument).toHaveBeenCalledTimes(2);
      expect(firestoreService.setDocument.calls.first().args[0])
        .toBe('users/u1/insightSnapshots/2026-05');
    });

    it('skips months that already have a snapshot', async () => {
      firestoreService.subscribeToCollection.and.returnValue(of([stored('2026-05')]));
      serveHistory([...monthOf(4), ...monthOf(5)]);

      const written = await service.generateClosedMonths(now);
      expect(written.map(s => s.monthKey)).toEqual(['2026-06']);
    });

    it('skips a month with no transactions rather than writing an empty one', async () => {
      serveHistory(monthOf(5));
      const written = await service.generateClosedMonths(now);
      expect(written.map(s => s.monthKey)).toEqual(['2026-06']);
    });

    it('never writes the current, still-open month', async () => {
      serveHistory([...monthOf(5), ...monthOf(6)]);
      const written = await service.generateClosedMonths(now);
      expect(written.map(s => s.monthKey)).not.toContain('2026-07');
    });

    it('caps how far back a fresh install backfills', async () => {
      const history = Array.from({ length: 30 }, (_, i) =>
        expense(new Date(2024, i, 5), 20));
      serveHistory(history);

      const written = await service.generateClosedMonths(now);
      expect(written.length).toBeLessThanOrEqual(SNAPSHOT_BACKFILL_MONTHS);
    });

    it('defers while offline rather than freezing an under-counted month', async () => {
      // A partially warm cache would produce a wrong month with nothing to
      // detect it against, since countDocuments is server-only.
      isOnline.set(false);
      serveHistory(monthOf(5));

      expect(await service.generateClosedMonths(now)).toEqual([]);
      expect(firestoreService.setDocument).not.toHaveBeenCalled();
    });

    it('does nothing without a signed-in user', async () => {
      userId.set(null);
      expect(await service.generateClosedMonths(now)).toEqual([]);
      expect(firestoreService.setDocument).not.toHaveBeenCalled();
    });

    it('shares one in-flight run across concurrent callers', async () => {
      serveHistory(monthOf(5));
      const [a, b] = await Promise.all([
        service.generateClosedMonths(now),
        service.generateClosedMonths(now),
      ]);
      expect(a).toBe(b);
      expect(firestoreService.setDocument).toHaveBeenCalledTimes(1);
    });

    it('swallows a write failure, since history is not a precondition', async () => {
      serveHistory(monthOf(5));
      firestoreService.setDocument.and.returnValue(Promise.reject(new Error('denied')));
      expect(await service.generateClosedMonths(now)).toEqual([]);
      expect(service.isGenerating()).toBeFalse();
    });

    it('reports a failed read as no snapshots', async () => {
      transactionService.getTransactionsInRange.and.returnValue(
        throwError(() => new Error('offline')));
      expect(await service.generateClosedMonths(now)).toEqual([]);
    });
  });

  describe('the written payload', () => {
    async function payload(): Promise<Record<string, unknown>> {
      serveHistory(monthOf(5, 8));
      await service.generateClosedMonths(now);
      return firestoreService.setDocument.calls.mostRecent().args[1] as Record<string, unknown>;
    }

    it('carries createdAt explicitly, which setDocument does not add', async () => {
      const written = await payload();
      expect(written['createdAt']).toBeDefined();
      expect(written['generatedAt']).toBeDefined();
    });

    it('starts at revision 1', async () => {
      expect((await payload())['revision']).toBe(1);
    });

    it('stamps both versions and the closed status', async () => {
      const written = await payload();
      expect(written['detectorVersion']).toBe(1);
      expect(written['schemaVersion']).toBe(1);
      expect(written['status']).toBe('complete');
    });

    it('records the fingerprint inputs', async () => {
      const fingerprint = (await payload())['fingerprint'] as Record<string, unknown>;
      expect(fingerprint['count']).toBe(8);
      expect(typeof fingerprint['tx']).toBe('string');
      expect(fingerprint['baseCurrency']).toBe('USD');
      expect(typeof fingerprint['timeZone']).toBe('string');
    });

    it('holds no references to individual transactions', async () => {
      const written = await payload();
      expect(JSON.stringify(written)).not.toContain('transactionIds');
    });

    it('is serialisable as Firestore requires', async () => {
      // The guard that mocked tests would otherwise miss entirely: undefined,
      // NaN, a nested array or a stray Date each fail the real write.
      const written = await payload();
      const issues = findSerializationIssues({
        ...written,
        createdAt: undefined,
        generatedAt: undefined,
      }).filter(issue => !issue.path.endsWith('At'));
      expect(issues).toEqual([]);
    });
  });

  describe('regenerate', () => {
    beforeEach(() => {
      firestoreService.subscribeToCollection.and.returnValue(of([
        stored('2026-05', {
          revision: 3,
          createdAt: Timestamp.fromDate(new Date(2026, 5, 2)),
        }),
      ]));
      serveHistory(monthOf(4, 6));
    });

    it('advances the revision, so a rewrite is recorded', async () => {
      await service.watch().toPromise();
      await service.regenerate('2026-05');

      const written = firestoreService.setDocument.calls.mostRecent()
        .args[1] as Record<string, unknown>;
      expect(written['revision']).toBe(4);
    });

    it('preserves the original createdAt', async () => {
      await service.watch().toPromise();
      await service.regenerate('2026-05');

      const written = firestoreService.setDocument.calls.mostRecent()
        .args[1] as Record<string, unknown>;
      expect((written['createdAt'] as Timestamp).toDate().getMonth()).toBe(5);
    });

    it('starts at revision 1 for a month never stored', async () => {
      await service.watch().toPromise();
      serveHistory(monthOf(3, 6));
      await service.regenerate('2026-04');

      const written = firestoreService.setDocument.calls.mostRecent()
        .args[1] as Record<string, unknown>;
      expect(written['revision']).toBe(1);
    });

    it('refuses a malformed month key', async () => {
      expect(await service.regenerate('2026-13')).toBeNull();
      expect(firestoreService.setDocument).not.toHaveBeenCalled();
    });
  });

  describe('staleness', () => {
    beforeEach(() => {
      firestoreService.subscribeToCollection.and.returnValue(of([
        stored('2026-05', {
          fingerprint: {
            tx: 'stale:2', count: 2, timeZone: 'UTC', baseCurrency: 'USD',
          },
        }),
      ]));
    });

    it('reports null for a month with no snapshot', async () => {
      await service.watch().toPromise();
      expect(await service.staleness('2026-01')).toBeNull();
    });

    it('flags a month whose transactions changed', async () => {
      await service.watch().toPromise();
      serveHistory(monthOf(4, 6));
      const result = await service.staleness('2026-05');
      expect(result?.isStale).toBeTrue();
      expect(result?.reasons).toContain('transactionsChanged');
    });

    it('claims nothing when the month cannot be read', async () => {
      await service.watch().toPromise();
      transactionService.getTransactionsInRange.and.returnValue(
        throwError(() => new Error('offline')));
      const result = await service.staleness('2026-05');
      expect(result?.isStale).toBeFalse();
      expect(result?.currentFingerprint).toBeNull();
    });
  });

  describe('deleteAll', () => {
    it('enumerates the collection rather than the in-memory signal', async () => {
      // The signal only holds what a subscription delivered, which is why
      // deleteAllTransactions is incomplete for large histories.
      firestoreService.getCollection.and.returnValue(
        Promise.resolve([stored('2026-01'), stored('2026-02'), stored('2026-03')]));

      await service.deleteAll();

      expect(firestoreService.getCollection).toHaveBeenCalledWith('users/u1/insightSnapshots');
      expect(firestoreService.deleteDocument).toHaveBeenCalledTimes(3);
      expect(service.snapshots()).toEqual([]);
    });

    it('does nothing without a user', async () => {
      userId.set(null);
      await service.deleteAll();
      expect(firestoreService.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('exportAll and nextDueMonth', () => {
    it('reads every snapshot once for the backup', async () => {
      firestoreService.getCollection.and.returnValue(
        Promise.resolve([stored('2026-01'), stored('2026-03')]));
      const rows = await service.exportAll();
      expect(rows.map(s => s.monthKey)).toEqual(['2026-03', '2026-01']);
    });

    it('names the month that is due', async () => {
      expect(service.nextDueMonth(now)).toBe('2026-06');
    });

    it('names nothing once the closed month is stored', async () => {
      firestoreService.subscribeToCollection.and.returnValue(of([stored('2026-06')]));
      await service.watch().toPromise();
      expect(service.nextDueMonth(now)).toBeNull();
    });
  });
});
