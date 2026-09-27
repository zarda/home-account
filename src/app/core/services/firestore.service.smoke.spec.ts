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
  disableNetwork,
  enableNetwork,
  Firestore,
  Timestamp,
  serverTimestamp
} from '@angular/fire/firestore';
import {
  CollectionWithMetadata,
  DocumentWithMetadata,
  FirestoreService,
  PageQueryOptions,
  PageResult
} from './firestore.service';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

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
 * rules-denied error path, transactions, batches, server-only reads and
 * aggregates. getPage has its own suite above.
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

    it('rejects, and never throws, a batch carrying an undefined field, and lands none of it', async () => {
      let committed!: Promise<void>;
      expect(() => {
        committed = service.commitBatch([
          { op: 'set', path: `${path}/rw-batch-undef-legal`, data: legalRow(78) },
          { op: 'set', path: `${path}/rw-batch-undef`, data: legalRow(76, { note: undefined }) }
        ]);
      }).not.toThrow();

      await expectAsync(committed).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-argument' }));
      expect(await service.getDocumentFromServer(`${path}/rw-batch-undef-legal`)).toBeNull();
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

    it('subscribeToDocumentWithMetadata says which emissions the server confirmed, including metadata-only ones', async () => {
      const emissions: DocumentWithMetadata<Row>[] = [];
      const last = () => emissions[emissions.length - 1];
      const confirmed = (e: DocumentWithMetadata<Row>) => !e.fromCache && !e.hasPendingWrites;
      const sub = service.subscribeToDocumentWithMetadata<Row>(`${path}/rw-meta-doc`)
        .subscribe(emission => emissions.push(emission));

      try {
        await waitFor(() => emissions.some(confirmed), 'a server-confirmed emission');
        expect(emissions.find(confirmed)!.data).toBeNull();

        const beforeWrite = emissions.length;
        await setDoc(doc(firestore, `${path}/rw-meta-doc`), legalRow(62));
        await waitFor(() => emissions.some(e => e.data?.id === 'rw-meta-doc' && confirmed(e)),
          'the written doc, confirmed by the server');
        expect(last().data!.amount).toBe(72);
        // The local write was heard first, from a listener already in sync:
        // fromCache false alone would have passed it off as confirmed.
        expect(emissions.slice(beforeWrite).find(e => e.data?.id === 'rw-meta-doc'))
          .toEqual(jasmine.objectContaining({ fromCache: false, hasPendingWrites: true }));

        // Going offline changes no data, only where the snapshot came from:
        // a listener without metadata changes would stay silent here.
        const before = emissions.length;
        await disableNetwork(firestore);
        await waitFor(() => emissions.length > before && last().fromCache, 'the from-cache emission');
        expect(last().data!.id).toBe('rw-meta-doc');

        await enableNetwork(firestore);
        await waitFor(() => confirmed(last()), 'the server again');
      } finally {
        await enableNetwork(firestore);
        sub.unsubscribe();
      }

      const countWhenUnsubscribed = emissions.length;
      await deleteDoc(doc(firestore, `${path}/rw-meta-doc`));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(emissions.length).toBe(countWhenUnsubscribed);
    }, 20000);

    it('subscribeToDocumentWithMetadata forwards a rules denial as an error', async () => {
      const errors: { code?: string }[] = [];
      const sub = service.subscribeToDocumentWithMetadata('users/somebody-else')
        .subscribe({ error: e => errors.push(e) });

      await waitFor(() => errors.length === 1, 'the permission error');
      expect(errors[0].code).toBe('permission-denied');
      sub.unsubscribe();
    });

    // Online only: a full client taken offline with a write queued stalls
    // every other full client in the run (see waitForPendingWrites below).
    it('subscribeToCollectionWithMetadata says which emissions the server confirmed, a metadata-only one included', async () => {
      const probe = { field: 'categoryId', op: '==' as const, value: 'meta_probe' };
      const emissions: CollectionWithMetadata<Row>[] = [];
      const confirmed = (e: CollectionWithMetadata<Row>) => !e.fromCache && !e.hasPendingWrites;
      const holds = (e: CollectionWithMetadata<Row>) => e.docs.some(row => row.id === 'rw-meta-list');
      const sub = service.subscribeToCollectionWithMetadata<Row>(path, { where: [probe] })
        .subscribe(emission => emissions.push(emission));

      try {
        await waitFor(() => emissions.some(confirmed), 'a server-confirmed emission');
        expect(emissions.find(confirmed)!.docs).toEqual([]);

        const beforeWrite = emissions.length;
        await setDoc(doc(firestore, `${path}/rw-meta-list`), legalRow(90, { categoryId: 'meta_probe' }));
        await waitFor(() => emissions.some(e => holds(e) && confirmed(e)), 'the written doc, confirmed by the server');
        const heard = emissions.slice(beforeWrite).filter(holds);
        // The local write was heard first, from a listener already in sync,
        // and its confirmation changed nothing but the metadata.
        expect(heard[0]).toEqual(jasmine.objectContaining({ fromCache: false, hasPendingWrites: true }));
        expect(heard[heard.length - 1].docs.map(row => [row.id, row.amount])).toEqual(heard[0].docs.map(row => [row.id, row.amount]));
      } finally {
        sub.unsubscribe();
      }

      const countWhenUnsubscribed = emissions.length;
      await deleteDoc(doc(firestore, `${path}/rw-meta-list`));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(emissions.length).toBe(countWhenUnsubscribed);
    }, 20000);

    it('subscribeToCollectionWithMetadata forwards a rules denial as an error', async () => {
      const errors: { code?: string }[] = [];
      const sub = service.subscribeToCollectionWithMetadata('users/somebody-else/transactions')
        .subscribe({ error: e => errors.push(e) });

      await waitFor(() => errors.length === 1, 'the permission error');
      expect(errors[0].code).toBe('permission-denied');
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

  describe('batches', () => {
    it('commitBatch lands a set, an update and a delete together, each stamped as asked', async () => {
      await setDoc(doc(firestore, `${path}/rw-batch-update`), legalRow(64));
      await setDoc(doc(firestore, `${path}/rw-batch-delete`), legalRow(65));

      await service.commitBatch([
        { op: 'set', path: `${path}/rw-batch-set`, data: legalRow(66) },
        { op: 'update', path: `${path}/rw-batch-update`, data: { amount: 42 } },
        { op: 'delete', path: `${path}/rw-batch-delete` },
        {
          op: 'set',
          path: `${path}/rw-batch-unstamped`,
          data: legalRow(67, { createdAt: serverTimestamp() }),
          stamp: false
        },
        {
          op: 'set',
          path: `${path}/rw-batch-server`,
          data: legalRow(77, { updatedAt: Timestamp.fromMillis(0) }),
          stamp: 'server'
        }
      ]);

      type Stamped = Row & { createdAt?: Timestamp; updatedAt?: Timestamp };
      const created = await service.getDocument<Stamped>(`${path}/rw-batch-set`);
      expect(created!.amount).toBe(76);
      expect(created!.updatedAt instanceof Timestamp).toBeTrue();

      // The server's own time, written over the stale stamp the op carried.
      const serverStamped = await service.getDocument<Stamped>(`${path}/rw-batch-server`);
      expect(serverStamped!.updatedAt instanceof Timestamp).toBeTrue();
      expect(serverStamped!.updatedAt!.toMillis()).toBeGreaterThan(0);

      const updated = await service.getDocument<Stamped>(`${path}/rw-batch-update`);
      expect(updated!.amount).toBe(42);
      expect(updated!.description).toBe('rw smoke 64');
      expect(updated!.updatedAt instanceof Timestamp).toBeTrue();

      expect(await service.getDocument(`${path}/rw-batch-delete`)).toBeNull();

      // Sent as given: no stamp of the service's own, and the server
      // timestamp the op carried resolved by the server.
      const unstamped = await service.getDocument<Stamped>(`${path}/rw-batch-unstamped`);
      expect(unstamped!.updatedAt).toBeUndefined();
      expect(unstamped!.createdAt instanceof Timestamp).toBeTrue();

      for (const id of ['rw-batch-set', 'rw-batch-update', 'rw-batch-unstamped', 'rw-batch-server']) {
        await deleteDoc(doc(firestore, `${path}/${id}`));
      }
    });

    it('commitBatch merges a set that asks for it, keeping the fields it leaves out', async () => {
      await setDoc(doc(firestore, `${path}/rw-batch-merge`), legalRow(70));

      await service.commitBatch([
        { op: 'set', path: `${path}/rw-batch-merge`, data: { description: 'merged' }, merge: true }
      ]);

      const row = await service.getDocument<Row>(`${path}/rw-batch-merge`);
      expect(row!.description).toBe('merged');
      expect(row!.amount).toBe(80);
      await deleteDoc(doc(firestore, `${path}/rw-batch-merge`));
    });

    it('commitBatch is refused whole: one refused write and nothing in the batch lands', async () => {
      await setDoc(doc(firestore, `${path}/rw-batch-atomic-update`), legalRow(68));

      // The rules refuse a negative amount; the set beside it is legal.
      await expectAsync(service.commitBatch([
        { op: 'set', path: `${path}/rw-batch-atomic-set`, data: legalRow(69) },
        { op: 'update', path: `${path}/rw-batch-atomic-update`, data: { amount: -5 } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'permission-denied' }));

      expect(await service.getDocumentFromServer(`${path}/rw-batch-atomic-set`)).toBeNull();
      expect((await service.getDocumentFromServer<Row>(`${path}/rw-batch-atomic-update`))!.amount).toBe(78);
      await deleteDoc(doc(firestore, `${path}/rw-batch-atomic-update`));
    });
  });

  describe('server reads', () => {
    it('getDocumentFromServer answers what the server holds while a listener on the document shows otherwise', async () => {
      const target = `${path}/rw-server-read`;
      await setDoc(doc(firestore, target), legalRow(63));
      const emissions: DocumentWithMetadata<Row>[] = [];
      const sub = service.subscribeToDocumentWithMetadata<Row>(target)
        .subscribe(emission => emissions.push(emission));

      try {
        await waitFor(() => emissions.some(e => e.data?.amount === 73 && !e.fromCache && !e.hasPendingWrites),
          'the listener in sync with the server');

        // The rules refuse a negative amount, so the server never holds it,
        // while the listener shows it as a local write until the refusal
        // comes back. A get answered by the listener would say -5.
        const refused = service.updateDocument(target, { amount: -5 })
          .then(() => 'accepted', (error: { code?: string }) => error.code);
        const read = await service.getDocumentFromServer<Row>(target);

        expect(read!.amount).toBe(73);
        expect(emissions.some(e => e.data?.amount === -5 && e.hasPendingWrites)).toBeTrue();
        expect(await refused).toBe('permission-denied');
      } finally {
        sub.unsubscribe();
      }
      await deleteDoc(doc(firestore, target));
    });

    it('getDocumentFromServer resolves null for a missing document and rejects a read the rules refuse', async () => {
      expect(await service.getDocumentFromServer(`${path}/never-written`)).toBeNull();
      await expectAsync(service.getDocumentFromServer('users/somebody-else/transactions/x'))
        .toBeRejectedWith(jasmine.objectContaining({ code: 'permission-denied' }));
    });

    // Online on purpose: taking this client offline with a write queued
    // stalled the other full clients' traffic to the emulator for about 25 s,
    // long enough to time out whichever spec file ran next.
    it('waitForPendingWrites resolves once the server holds a write issued before it', async () => {
      const target = `${path}/rw-pending`;
      const write = service.setDocument(target, legalRow(71));

      await service.waitForPendingWrites();
      // Read before the write's own promise is awaited: the server already
      // holds it.
      expect((await service.getDocumentFromServer<Row>(target))!.amount).toBe(81);

      await write;
      await deleteDoc(doc(firestore, target));
    });
  });

  describe('aggregates', () => {
    const probe = [{ field: 'categoryId', op: '==' as const, value: 'agg_probe' }];
    const probeIds = ['rw-agg-0', 'rw-agg-1', 'rw-agg-2', 'rw-agg-other'];

    beforeAll(async () => {
      const amounts = [5, 7.5, 20];
      await Promise.all(amounts.map((amount, i) =>
        setDoc(doc(firestore, `${path}/${probeIds[i]}`), legalRow(72 + i, { amount, categoryId: 'agg_probe' }))));
      await setDoc(doc(firestore, `${path}/rw-agg-other`), legalRow(75, { amount: 100, categoryId: 'agg_other' }));
    });

    afterAll(async () => {
      await Promise.all(probeIds.map(id => deleteDoc(doc(firestore, `${path}/${id}`)).catch(() => undefined)));
    });

    it('aggregateFromServer counts and sums the matching documents in one aggregation', async () => {
      expect(await service.aggregateFromServer(path, { where: probe }, { count: true, sum: 'amount' }))
        .toEqual({ count: 3, sum: 32.5 });
    });

    it('aggregateFromServer answers only the parts asked for', async () => {
      expect(await service.aggregateFromServer(path, { where: probe }, { sum: 'amount' })).toEqual({ sum: 32.5 });
      expect(await service.aggregateFromServer(path, { where: probe }, { count: true })).toEqual({ count: 3 });
    });

    it('aggregateFromServer answers zero for a query nothing matches', async () => {
      expect(await service.aggregateFromServer(path, {
        where: [{ field: 'categoryId', op: '==', value: 'agg_nothing' }]
      }, { count: true, sum: 'amount' })).toEqual({ count: 0, sum: 0 });
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
