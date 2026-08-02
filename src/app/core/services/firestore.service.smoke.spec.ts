// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { FirestoreService, PageQueryOptions, PageResult } from './firestore.service';

interface PageDoc {
  id: string;
  date: Timestamp;
  index: number;
}

/**
 * Integration smoke test for FirestoreService.getPage against the Firestore
 * emulator.
 *
 * The sliding transaction window depends on document-snapshot cursors paging
 * correctly across rows that share the same `date` (the implicit document-ID
 * tiebreaker). Value cursors cannot express that distinction, so this seeds a
 * collection full of duplicate dates and asserts forward and backward pages
 * are disjoint, ordered, and cover the set completely.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('FirestoreService.getPage (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  const TOTAL_DOCS = 60;
  const TIES_PER_DATE = 4; // every date value is shared by 4 documents
  const PAGE = 7; // not a divisor of 60: exercises the short final page

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: FirestoreService;
  let path: string;

  // The full collection in query order, used as ground truth for every
  // paging assertion.
  let reference: PageResult<PageDoc> | undefined;
  let seededIds: string[] = [];

  const baseOptions = (): Pick<PageQueryOptions, 'orderBy'> => ({
    orderBy: [{ field: 'date', direction: 'desc' }]
  });

  function ref(): PageResult<PageDoc> {
    if (!reference) throw new Error('reference collection was not loaded');
    return reference;
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `firestore-page-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
    path = `users/${uid}/transactions`;

    // 60 docs across 15 distinct dates, 4 documents per date. Random-ish ids
    // so the tiebreak order is decided by Firestore, not by seeding order.
    // Seeded with the raw SDK: the TestBed cannot be configured here, because
    // suites that disable teardown may leave a live test module behind and
    // beforeAll runs before the framework's auto-reset (which is per-test).
    const base = Date.UTC(2026, 5, 30, 12);
    seededIds = Array.from({ length: TOTAL_DOCS }, (_, i) => `smoke-page-${(i * 7919) % 100}-${i}`);
    await Promise.all(
      seededIds.map((id, i) =>
        setDoc(doc(firestore, `${path}/${id}`), {
          date: Timestamp.fromMillis(base - Math.floor(i / TIES_PER_DATE) * 86_400_000),
          index: i,
          userId: uid,
          // firestore.rules validates transaction shape on create; only
          // date/index carry meaning here, the rest just makes the row legal.
          type: 'expense',
          amount: 1,
          currency: 'USD',
          amountInBaseCurrency: 1,
          exchangeRate: 1,
          categoryId: 'smoke',
          description: 'page smoke',
          isRecurring: false
        })
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      seededIds.map(id => deleteDoc(doc(firestore, `${path}/${id}`)).catch(() => undefined))
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [FirestoreService, { provide: Firestore, useValue: firestore }]
    });
    service = TestBed.inject(FirestoreService);
    reference ??= await service.getPage<PageDoc>(path, {
      ...baseOptions(),
      limit: TOTAL_DOCS + 10
    });
  });

  it('seeds the expected collection with duplicate dates', () => {
    expect(ref().items.length).toBe(TOTAL_DOCS);
    expect(ref().snapshots.length).toBe(TOTAL_DOCS);
    // Dates are non-increasing and genuinely duplicated.
    for (let i = 1; i < ref().items.length; i++) {
      expect(ref().items[i].date.toMillis()).toBeLessThanOrEqual(
        ref().items[i - 1].date.toMillis()
      );
    }
    const distinctDates = new Set(ref().items.map(d => d.date.toMillis()));
    expect(distinctDates.size).toBe(TOTAL_DOCS / TIES_PER_DATE);
  });

  it('pages forward with startAfterDoc: disjoint, ordered, complete', async () => {
    const collected: PageDoc[] = [];
    let cursor: PageResult<PageDoc>['snapshots'][number] | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await service.getPage<PageDoc>(path, {
        ...baseOptions(),
        limit: PAGE,
        ...(cursor ? { startAfterDoc: cursor } : {})
      });
      collected.push(...page.items);
      if (page.items.length < PAGE) break;
      cursor = page.snapshots[page.snapshots.length - 1];
    }

    // Complete coverage, no duplicates, exact query order — including inside
    // tie groups that straddle page boundaries.
    expect(collected.map(d => d.id)).toEqual(ref().items.map(d => d.id));
  });

  it('pages backward with endBeforeDoc: disjoint, ordered, complete', async () => {
    // Start from a cursor deep in the collection (index 30 sits mid tie-group
    // with TIES_PER_DATE = 4), then walk back to the beginning.
    const startIndex = 30;
    const collected: PageDoc[] = [];
    let cursor = ref().snapshots[startIndex];

    for (let guard = 0; guard < 20; guard++) {
      const page = await service.getPage<PageDoc>(path, {
        ...baseOptions(),
        limit: PAGE,
        endBeforeDoc: cursor
      });
      if (page.items.length === 0) break;
      // Pages come back in query order and butt up against the cursor.
      collected.unshift(...page.items);
      cursor = page.snapshots[0];
      if (page.items.length < PAGE) break;
    }

    expect(collected.map(d => d.id)).toEqual(
      ref().items.slice(0, startIndex).map(d => d.id)
    );
  });

  it('forward and backward pages around the same cursor are disjoint and adjacent', async () => {
    const pivotIndex = 25;
    const pivot = ref().snapshots[pivotIndex];

    const before = await service.getPage<PageDoc>(path, {
      ...baseOptions(),
      limit: PAGE,
      endBeforeDoc: pivot
    });
    const after = await service.getPage<PageDoc>(path, {
      ...baseOptions(),
      limit: PAGE,
      startAfterDoc: pivot
    });

    expect(before.items.map(d => d.id)).toEqual(
      ref().items.slice(pivotIndex - PAGE, pivotIndex).map(d => d.id)
    );
    expect(after.items.map(d => d.id)).toEqual(
      ref().items.slice(pivotIndex + 1, pivotIndex + 1 + PAGE).map(d => d.id)
    );
  });

  it('re-anchors by date value with startAtValues at the head of a tie group', async () => {
    // Index 20 starts a tie group (20 % TIES_PER_DATE === 0). startAt by value
    // must include the entire group, not just the row a snapshot would name.
    const anchor = ref().items[22]; // mid-group row sharing the group date
    const page = await service.getPage<PageDoc>(path, {
      ...baseOptions(),
      limit: PAGE,
      startAtValues: [anchor.date]
    });

    expect(page.items.map(d => d.id)).toEqual(
      ref().items.slice(20, 20 + PAGE).map(d => d.id)
    );
  });
});

/**
 * Integration smoke test for the rest of FirestoreService against the
 * emulator: one-shot reads, counting, writes and their timestamp stamping,
 * undefined-field behaviour, live subscriptions with teardown, the
 * rules-denied error path, and transactions. getPage has its own suite above.
 *
 * Every row is a legal transaction per firestore.rules — the service is a
 * thin wrapper and the rules run on every write, so an illegal fixture would
 * test the rules, not the wrapper.
 */
describe('FirestoreService reads, writes and subscriptions (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const BASE = Date.UTC(2026, 5, 30, 12);

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: FirestoreService;
  let path: string;

  interface Row {
    id: string;
    index: number;
    amount: number;
    categoryId: string;
    description: string;
  }

  function legalRow(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      date: Timestamp.fromMillis(BASE - index * 86_400_000),
      index,
      userId: uid,
      type: 'expense',
      amount: 10 + index,
      currency: 'USD',
      amountInBaseCurrency: 10 + index,
      exchangeRate: 1,
      categoryId: index % 2 === 0 ? 'smoke_even' : 'smoke_odd',
      description: `rw smoke ${index}`,
      isRecurring: false,
      ...overrides
    };
  }

  async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `firestore-rw-smoke-${Date.now()}`
    );
    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
    path = `users/${uid}/transactions`;

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        setDoc(doc(firestore, `${path}/rw-smoke-${i}`), legalRow(i))
      )
    );
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FirestoreService, { provide: Firestore, useValue: firestore }]
    });
    service = TestBed.inject(FirestoreService);
  });

  describe('one-shot reads', () => {
    it('getDocument merges the document id into the data', async () => {
      const row = await service.getDocument<Row>(`${path}/rw-smoke-0`);

      expect(row).not.toBeNull();
      expect(row!.id).toBe('rw-smoke-0');
      expect(row!.amount).toBe(10);
      expect(row!.description).toBe('rw smoke 0');
    });

    it('getDocument resolves null for a missing document', async () => {
      expect(await service.getDocument(`${path}/never-written`)).toBeNull();
    });

    it('getCollection honours where, orderBy and limit together', async () => {
      const rows = await service.getCollection<Row>(path, {
        where: [{ field: 'categoryId', op: '==', value: 'smoke_even' }],
        orderBy: [{ field: 'amount', direction: 'desc' }],
        limit: 2
      });

      expect(rows.map(r => r.id)).toEqual(['rw-smoke-4', 'rw-smoke-2']);
    });

    it('countDocuments counts server-side without downloading', async () => {
      expect(await service.countDocuments(path, {
        where: [{ field: 'categoryId', op: '==', value: 'smoke_odd' }]
      })).toBe(3);
    });
  });

  describe('writes', () => {
    it('addDocument stamps createdAt and updatedAt and returns the new id', async () => {
      const id = await service.addDocument(path, legalRow(50));

      const written = await service.getDocument<Row & { createdAt: Timestamp; updatedAt: Timestamp }>(
        `${path}/${id}`);
      expect(written!.createdAt instanceof Timestamp).toBeTrue();
      expect(written!.updatedAt instanceof Timestamp).toBeTrue();
      expect(written!.amount).toBe(60);
      await deleteDoc(doc(firestore, `${path}/${id}`));
    });

    it('setDocument with merge keeps untouched fields and bumps updatedAt', async () => {
      await setDoc(doc(firestore, `${path}/rw-merge`), legalRow(51));

      await service.setDocument(`${path}/rw-merge`, { description: 'merged' }, true);

      const row = await service.getDocument<Row & { updatedAt: Timestamp }>(`${path}/rw-merge`);
      expect(row!.description).toBe('merged');
      expect(row!.amount).toBe(61);
      expect(row!.updatedAt instanceof Timestamp).toBeTrue();
      await deleteDoc(doc(firestore, `${path}/rw-merge`));
    });

    it('setDocument without merge replaces the whole document', async () => {
      await setDoc(doc(firestore, `${path}/rw-replace`), legalRow(52, { note: 'to be dropped' }));

      await service.setDocument(`${path}/rw-replace`, legalRow(53));

      const row = await service.getDocument<Row & { note?: string }>(`${path}/rw-replace`);
      expect(row!.amount).toBe(63);
      expect(row!.note).toBeUndefined();
      await deleteDoc(doc(firestore, `${path}/rw-replace`));
    });

    it('updateDocument patches fields and stamps updatedAt', async () => {
      await setDoc(doc(firestore, `${path}/rw-update`), legalRow(54));

      await service.updateDocument(`${path}/rw-update`, { amount: 42 });

      const row = await service.getDocument<Row & { updatedAt: Timestamp }>(`${path}/rw-update`);
      expect(row!.amount).toBe(42);
      expect(row!.description).toBe('rw smoke 54');
      expect(row!.updatedAt instanceof Timestamp).toBeTrue();
      await deleteDoc(doc(firestore, `${path}/rw-update`));
    });

    it('deleteDocument removes the document', async () => {
      await setDoc(doc(firestore, `${path}/rw-delete`), legalRow(55));

      await service.deleteDocument(`${path}/rw-delete`);

      expect(await service.getDocument(`${path}/rw-delete`)).toBeNull();
    });

    it('rejects a write carrying an undefined field, so callers must strip them', async () => {
      // The SDK refuses undefined field values outright; the wrapper adds no
      // sanitisation. This is the contract every caller has to respect —
      // exactly the surface the tier-3 write-shape defects live on.
      await expectAsync(
        service.addDocument(path, legalRow(56, { note: undefined }))
      ).toBeRejected();
    });
  });

  describe('live subscriptions', () => {
    it('subscribeToCollection emits the initial set, live changes, and stops after unsubscribe', async () => {
      const probe = { field: 'categoryId', op: '==' as const, value: 'live_probe' };
      const emissions: Row[][] = [];
      const sub = service.subscribeToCollection<Row>(path, { where: [probe] })
        .subscribe(rows => emissions.push(rows));

      await waitFor(() => emissions.length >= 1, 'initial emission');
      expect(emissions[0]).toEqual([]);

      await setDoc(doc(firestore, `${path}/rw-live-1`), legalRow(57, { categoryId: 'live_probe' }));
      await waitFor(() => emissions.some(rows => rows.some(r => r.id === 'rw-live-1')),
        'the live add to arrive');

      const countWhenUnsubscribed = emissions.length;
      sub.unsubscribe();

      await setDoc(doc(firestore, `${path}/rw-live-2`), legalRow(58, { categoryId: 'live_probe' }));
      // A fresh listener proves the server processed the second write...
      const late = service.subscribeToCollection<Row>(path, { where: [probe] });
      const lateRows: Row[][] = [];
      const lateSub = late.subscribe(rows => lateRows.push(rows));
      await waitFor(() => lateRows.some(rows => rows.some(r => r.id === 'rw-live-2')),
        'the fresh listener to see the second write');
      lateSub.unsubscribe();

      // ...while the torn-down one never heard about it.
      expect(emissions.length).toBe(countWhenUnsubscribed);

      await deleteDoc(doc(firestore, `${path}/rw-live-1`));
      await deleteDoc(doc(firestore, `${path}/rw-live-2`));
    });

    it('subscribeToDocument emits null for a missing doc, then values, and stops after unsubscribe', async () => {
      const emissions: (Row | null)[] = [];
      const sub = service.subscribeToDocument<Row>(`${path}/rw-live-doc`)
        .subscribe(row => emissions.push(row));

      await waitFor(() => emissions.length >= 1, 'initial emission');
      expect(emissions[0]).toBeNull();

      await setDoc(doc(firestore, `${path}/rw-live-doc`), legalRow(59));
      await waitFor(() => emissions.some(row => row?.id === 'rw-live-doc'), 'the created doc');

      const countWhenUnsubscribed = emissions.length;
      sub.unsubscribe();

      await deleteDoc(doc(firestore, `${path}/rw-live-doc`));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(emissions.length).toBe(countWhenUnsubscribed);
    });

    it('surfaces a rules denial as a subscription error', async () => {
      const errors: unknown[] = [];
      const sub = service.subscribeToCollection('users/somebody-else/transactions')
        .subscribe({ error: e => errors.push(e) });

      await waitFor(() => errors.length === 1, 'the permission error');
      sub.unsubscribe();
    });
  });

  describe('transactions', () => {
    it('runTransaction commits a read-modify-write atomically', async () => {
      await setDoc(doc(firestore, `${path}/rw-txn`), legalRow(60));
      const ref = service.getDocRef<Row>(`${path}/rw-txn`);

      const result = await service.runTransaction(async txn => {
        const snap = await txn.get(ref);
        const amount = (snap.data() as Row).amount;
        txn.update(ref, { amount: amount + 5 });
        return amount;
      });

      expect(result).toBe(70);
      expect((await service.getDocument<Row>(`${path}/rw-txn`))!.amount).toBe(75);
      await deleteDoc(doc(firestore, `${path}/rw-txn`));
    });

    it('runTransaction rejects and applies nothing when the update function throws', async () => {
      await setDoc(doc(firestore, `${path}/rw-txn-abort`), legalRow(61));
      const ref = service.getDocRef<Row>(`${path}/rw-txn-abort`);

      await expectAsync(service.runTransaction(async txn => {
        await txn.get(ref);
        txn.update(ref, { amount: 999 });
        throw new Error('abort');
      })).toBeRejectedWithError('abort');

      expect((await service.getDocument<Row>(`${path}/rw-txn-abort`))!.amount).toBe(71);
      await deleteDoc(doc(firestore, `${path}/rw-txn-abort`));
    });
  });

  describe('reference and timestamp helpers', () => {
    it('generateId issues distinct non-empty ids', () => {
      const a = service.generateId(path);
      const b = service.generateId(path);
      expect(a.length).toBeGreaterThan(0);
      expect(a).not.toBe(b);
    });

    it('converts between Date and Timestamp both ways', () => {
      const date = new Date(2026, 7, 1, 12, 30);
      expect(service.timestampToDate(service.dateToTimestamp(date)).getTime())
        .toBe(date.getTime());
      expect(service.getTimestamp() instanceof Timestamp).toBeTrue();
      expect(service.getCollectionRef(path).path).toBe(path);
      expect(service.getDocRef(`${path}/x`).path).toBe(`${path}/x`);
    });
  });
});
