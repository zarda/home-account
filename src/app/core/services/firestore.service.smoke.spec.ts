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
          userId: uid
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
