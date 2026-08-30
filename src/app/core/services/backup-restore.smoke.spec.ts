// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
  Firestore
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';

import { BackupRestoreService } from './backup-restore.service';
import { TransactionService } from './transaction.service';
import { RecurringService } from './recurring.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TranslationService } from './translation.service';
import { ExportData } from './export.service';
import { Category, InsightSnapshot, RecurringTransaction, Transaction } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for restoring a backup onto an account that still
 * holds data, against the emulators.
 *
 * The unit spec drives a mocked TransactionService, so it can see which DTO
 * the restore builds but never the write that DTO becomes. That blind spot is
 * exactly where the bugs lived: the write replaced the whole document, so
 * every receipt field on a surviving row was erased and the Storage objects
 * behind them became unreachable for good — reachable only through the
 * transaction that named them, so no delete path could ever reclaim them.
 * Only a real overwrite against real rules shows that.
 *
 * What only this suite can prove:
 * - a merged restore leaves the receipt fields, and the quota query that reads
 *   them, exactly as they were,
 * - the paused flag survives, and the catch-up engine still honours it when
 *   the restored rule next comes due,
 * - restoring one file twice is accepted by the snapshot rules, which demand a
 *   strictly increasing revision on every rewrite.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('Backup restore (emulator smoke test)', () => {
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
  let service: BackupRestoreService;
  let transactionService: TransactionService;
  let recurringService: RecurringService;

  /** Unique per run, so a crashed run cannot collide with the next. */
  const run = `${Date.now()}`;

  // Swept in afterAll, per collection.
  const created: Record<string, string[]> = {
    transactions: [], categories: [], recurring: [], insightSnapshots: [],
  };

  const track = (section: keyof typeof created, id: string): string => {
    created[section].push(id);
    return id;
  };

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `backup-restore-smoke-${run}`
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
      Object.entries(created).flatMap(([section, ids]) =>
        ids.map(id =>
          deleteDoc(doc(firestore, `users/${uid}/${section}/${id}`)).catch(() => undefined)
        )
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Every restored row carries its own conversion in options.snapshot, so
        // no rate is looked up on the restore path; the stub keeps the one row
        // this suite writes live from reaching the network.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1,
            convert: (amount: number) => amount
          }
        },
        {
          provide: ReceiptQuotaService,
          useValue: {
            canAddImages: () => Promise.resolve(true),
            noteImagesAdded: () => undefined,
            noteImagesRemoved: () => undefined,
            invalidateCount: () => undefined
          }
        },
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ]
    });
    // Everything else is root-provided and constructed for real: this suite is
    // about what the orchestrator hands down and what the rules do with it.
    service = TestBed.inject(BackupRestoreService);
    transactionService = TestBed.inject(TransactionService);
    recurringService = TestBed.inject(RecurringService);
  });

  const emptyBackup = (overrides: Partial<ExportData> = {}): ExportData => ({
    transactions: [], categories: [], budgets: [], recurring: [], goals: [],
    insightSnapshots: [],
    exportDate: '2026-08-01T00:00:00.000Z',
    version: '1.4',
    ...overrides,
  });

  const readRaw = async (section: string, id: string): Promise<Record<string, unknown>> => {
    const snapshot = await getDoc(doc(firestore, `users/${uid}/${section}/${id}`));
    return (snapshot.data() ?? {}) as Record<string, unknown>;
  };

  it('keeps the receipts a live row already carries when a backup writes over it', async () => {
    const receipt = new File([new Uint8Array([0xff, 0xd8, 0x42, 0xd9])], 'receipt.jpg', {
      type: 'image/jpeg'
    });
    const id = track('transactions', await transactionService.addTransaction({
      type: 'expense',
      amount: 12.5,
      currency: 'USD',
      categoryId: 'food_groceries',
      description: 'Groceries',
      date: new Date(2026, 5, 15, 12),
      receiptFiles: [receipt]
    }));

    const before = await readRaw('transactions', id);
    expect(before['receiptUrl']).toBeTruthy();
    expect(before['receiptCount']).toBe(1);

    // The backup carries the same row without a single receipt field — a file
    // holds no Storage objects, so it never could.
    const backedUp = Timestamp.fromDate(new Date(2026, 5, 15, 12));
    const summary = await service.restore(emptyBackup({
      transactions: [{
        id,
        userId: uid,
        type: 'expense',
        amount: 12.5,
        currency: 'USD',
        amountInBaseCurrency: 12.5,
        exchangeRate: 1,
        baseCurrency: 'USD',
        categoryId: 'food_groceries',
        description: 'Groceries',
        date: backedUp,
        createdAt: backedUp,
        updatedAt: backedUp,
        isRecurring: true,
        recurringId: 'rule-7',
      } as Transaction],
    }));

    expect(summary.skipped).toEqual([]);
    expect(summary.transactions).toBe(1);

    const after = await readRaw('transactions', id);
    expect(after['receiptUrl']).toBe(before['receiptUrl']);
    expect(after['receiptUrls']).toEqual(before['receiptUrls']);
    expect(after['receiptCount']).toBe(1);
    // The link the file does carry lands, and createdAt comes from the file
    // rather than being restamped at today.
    expect(after['recurringId']).toBe('rule-7');
    expect((after['createdAt'] as Timestamp).toMillis()).toBe(backedUp.toMillis());

    // The manager and the quota both find their rows through this query, and
    // it is the one an erased receiptUrl silently drops the row out of.
    const withReceipts = await getDocs(query(
      collection(firestore, `users/${uid}/transactions`),
      where('receiptUrl', '>', '')
    ));
    expect(withReceipts.docs.some(d => d.id === id)).toBeTrue();
  }, 30000);

  it('brings a paused rule back paused, and the catch-up still refuses to post it', async () => {
    const paused = track('recurring', `backup-restore-smoke-paused-${run}`);
    const active = track('recurring', `backup-restore-smoke-active-${run}`);

    const rule = (id: string, isActive: boolean): RecurringTransaction => ({
      id,
      userId: uid,
      name: 'Rent',
      type: 'expense',
      amount: 1000,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: 'Rent',
      frequency: { type: 'monthly', interval: 1 },
      startDate: Timestamp.fromDate(new Date(2026, 0, 1, 9)),
      nextOccurrence: Timestamp.fromDate(new Date(2026, 0, 1, 9)),
      isActive,
    } as RecurringTransaction);

    const summary = await service.restore(emptyBackup({
      recurring: [rule(paused, false), rule(active, true)],
    }));

    expect(summary.skipped).toEqual([]);
    expect((await readRaw('recurring', paused))['isActive']).toBeFalse();
    expect((await readRaw('recurring', active))['isActive']).toBeTrue();

    // createRecurring recomputes nextOccurrence forward past today, so a
    // freshly restored rule is never immediately due. Backdate both pointers
    // to stand in for the time that passes before the next dashboard load —
    // catch-up runs there with no user action at all.
    const due = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await Promise.all([paused, active].map(id =>
      setDoc(doc(firestore, `users/${uid}/recurring/${id}`),
        { nextOccurrence: due, updatedAt: Timestamp.now() }, { merge: true })
    ));

    const posted = await recurringService.catchUpRecurringTransactions();
    posted.forEach(row => track('transactions', row.id));

    const postedFor = (id: string) => posted.filter(row => row.recurringId === id);
    expect(postedFor(paused)).toEqual([]);
    expect(postedFor(active).length).toBeGreaterThan(0);
  }, 30000);

  it('restores the same insight snapshot twice with nothing skipped', async () => {
    const month = '2026-03';
    track('insightSnapshots', month);

    const snapshot: InsightSnapshot = {
      id: month,
      userId: uid,
      monthKey: month,
      detectorVersion: 1,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency: 'USD' },
      totals: { income: 0, expense: 10, balance: -10, count: 1 },
      byCategory: [],
      facts: {} as InsightSnapshot['facts'],
      cards: [],
      generatedAt: Timestamp.fromDate(new Date(2026, 3, 1)),
      createdAt: Timestamp.fromDate(new Date(2026, 3, 1)),
      revision: 1,
    };
    const file = emptyBackup({ insightSnapshots: [snapshot] });

    const first = await service.restore(file);
    expect(first.skipped).toEqual([]);
    expect(first.insightSnapshots).toBe(1);
    const afterFirst = await readRaw('insightSnapshots', month);
    expect(afterFirst['revision']).toBe(1);

    // The whole point. Writing revision 1 over a stored revision 1 is an
    // update as far as the rules are concerned, and the update rule demands a
    // strictly higher revision — so this used to be PERMISSION_DENIED, and the
    // user restoring twelve backfilled months a second time saw twelve skips.
    const second = await service.restore(file);
    expect(second.skipped).toEqual([]);
    expect(second.insightSnapshots).toBe(1);

    const afterSecond = await readRaw('insightSnapshots', month);
    expect(afterSecond['revision']).toBe(1);
    expect((afterSecond['createdAt'] as Timestamp).toMillis())
      .toBe((afterFirst['createdAt'] as Timestamp).toMillis());
  }, 30000);

  it('yields to a month regenerated since the backup was taken', async () => {
    const month = '2026-04';
    track('insightSnapshots', month);

    const base = {
      userId: uid,
      monthKey: month,
      detectorVersion: 1,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: { tx: 'x:9', count: 9, timeZone: 'UTC', baseCurrency: 'USD' },
      totals: { income: 0, expense: 99, balance: -99, count: 9 },
      byCategory: [],
      facts: {},
      cards: [],
      generatedAt: Timestamp.fromDate(new Date(2026, 4, 20)),
      createdAt: Timestamp.fromDate(new Date(2026, 4, 1)),
    };
    // A month the user regenerated after taking the backup: newer detector
    // output than the file holds.
    await setDoc(doc(firestore, `users/${uid}/insightSnapshots/${month}`),
      { ...base, revision: 5 });

    const summary = await service.restore(emptyBackup({
      insightSnapshots: [{
        ...base, id: month, revision: 2,
        fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency: 'USD' },
      } as unknown as InsightSnapshot],
    }));

    expect(summary.skipped).toEqual([]);
    expect(summary.insightSnapshots).toBe(1);
    const stored = await readRaw('insightSnapshots', month);
    expect(stored['revision']).toBe(5);
    expect((stored['fingerprint'] as { count: number }).count).toBe(9);
  }, 30000);

  it('leaves a category deleted before the backup was taken deleted', async () => {
    const id = track('categories', `backup-restore-smoke-cat-${run}`);

    const summary = await service.restore(emptyBackup({
      categories: [{
        id,
        userId: uid,
        name: 'Bouldering',
        icon: 'sports_handball',
        color: '#ff8800',
        type: 'expense',
        order: 5,
        isActive: false,
        isDefault: false,
      } as Category],
    }));

    expect(summary.skipped).toEqual([]);
    expect((await readRaw('categories', id))['isActive']).toBeFalse();
  }, 30000);
});
