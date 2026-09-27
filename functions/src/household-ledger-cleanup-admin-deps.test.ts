import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

import { CLEANUP_BATCH_SIZE, MEMBER_GENERATION_FIELD } from './household-ledger-cleanup';
import { householdLedgerCleanupAdminDeps } from './household-ledger-cleanup-admin-deps';
import { CleanupLog, handleHouseholdLedgerCleanup } from './household-ledger-cleanup-handler';

const HID = 'household1';
const BASE = `households/${HID}`;
const SAM = 'sam-uid';
const ALEX = 'alex-uid';
const GEN = new Timestamp(1_790_000_000, 123_456_000);
const OLDER = new Timestamp(1_780_000_000, 0);
const LATER = new Timestamp(1_800_000_000, 0);

type Data = Record<string, unknown>;
type Clause = [field: string, op: string, value: unknown];

interface RecordedQuery {
  collection: string;
  where: Clause[];
  limit: number | undefined;
  /** The fields asked for; undefined when select() was never called. */
  select: string[] | undefined;
}

/**
 * The slice of the Admin Firestore the deps touch, over an in-memory map of
 * documents. Every query is recorded with its clauses, limit and projection,
 * every commit with the paths it deleted and every listDocuments with its
 * collection: the handler's own tests fake the deps whole and never see how
 * a query or a delete is made.
 */
class FakeFirestore {
  readonly docs = new Map<string, Data>();
  readonly queries: RecordedQuery[] = [];
  readonly commits: string[][] = [];
  readonly listed: string[] = [];
  readonly reads: string[] = [];

  seed(path: string, data: Data): this {
    this.docs.set(path, data);
    return this;
  }

  doc(path: string) {
    return {
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      get: async () => {
        this.reads.push(path);
        return this.snapshot(path);
      },
    };
  }

  collection(path: string) {
    const query = (where: Clause[], limit?: number, select?: string[]) => ({
      where: (field: string, op: string, value: unknown) => query([...where, [field, op, value]], limit, select),
      limit: (n: number) => query(where, n, select),
      select: (...fields: string[]) => query(where, limit, fields),
      get: async () => {
        this.queries.push({ collection: path, where, limit, select });
        return { docs: this.run(path, where, limit).map(key => this.snapshot(key)) };
      },
    });
    return {
      ...query([]),
      listDocuments: async () => {
        this.listed.push(path);
        const prefix = `${path}/`;
        const ids = [...this.docs.keys()]
          .filter(key => key.startsWith(prefix))
          .map(key => key.slice(prefix.length).split('/')[0]);
        return [...new Set(ids)].sort().map(id => this.doc(`${prefix}${id}`));
      },
    };
  }

  batch() {
    const deletes: string[] = [];
    const batch = {
      delete: (ref: { path: string }) => {
        deletes.push(ref.path);
        return batch;
      },
      commit: async () => {
        // The Admin SDK refuses a commit of more than 500 writes.
        if (deletes.length > 500) throw new Error(`a commit of ${deletes.length} writes`);
        this.commits.push([...deletes]);
        for (const path of deletes) this.docs.delete(path);
        return [];
      },
    };
    return batch;
  }

  private snapshot(path: string) {
    const data = this.docs.get(path);
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      ref: this.doc(path),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    };
  }

  // Equality only, in document id order, over the collection's own documents.
  private run(path: string, where: Clause[], limit?: number): string[] {
    const prefix = `${path}/`;
    const equal = (a: unknown, b: unknown) =>
      a instanceof Timestamp && b instanceof Timestamp ? a.isEqual(b) : a === b;
    return [...this.docs.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .filter(key => where.every(([field, op, value]) => op === '==' && equal(this.docs.get(key)?.[field], value)))
      .sort()
      .slice(0, limit);
  }
}

const silentLog: CleanupLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

function setup() {
  const firestore = new FakeFirestore();
  const deps = householdLedgerCleanupAdminDeps({
    firestore: firestore as unknown as Firestore,
    log: silentLog,
  });
  return { firestore, deps };
}

// --- each dep -------------------------------------------------------------------------

void test('find queries by equality on each field in the order given, lists ids only, and answers full paths', async () => {
  const { firestore, deps } = setup();
  firestore
    .seed(`${BASE}/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/ledger/${ALEX}_t1`, { gen: GEN, memberUid: ALEX });
  const found = await deps.find(
    `${BASE}/ledger`,
    [
      { field: 'gen', value: GEN },
      { field: 'memberUid', value: SAM },
    ],
    CLEANUP_BATCH_SIZE
  );
  assert.deepEqual(found, [`${BASE}/ledger/${SAM}_t1`]);
  assert.equal(firestore.queries.length, 1);
  const [query] = firestore.queries;
  assert.equal(query.collection, `${BASE}/ledger`);
  assert.deepEqual(query.where, [
    ['gen', '==', GEN],
    ['memberUid', '==', SAM],
  ]);
  // The stored Timestamp itself is the value compared.
  assert.equal(query.where[0][2], GEN);
  assert.equal(query.limit, CLEANUP_BATCH_SIZE);
  // No field is read: a delete needs only the reference.
  assert.deepEqual(query.select, []);
});

void test('remove deletes in commits of at most 500, in the order given', async () => {
  const { firestore, deps } = setup();
  const paths = Array.from({ length: 1201 }, (_, i) => `${BASE}/ledger/c${String(i).padStart(4, '0')}`);
  for (const path of paths) firestore.seed(path, { gen: GEN });
  await deps.remove(paths);
  assert.deepEqual(firestore.commits.map(commit => commit.length), [500, 500, 201]);
  assert.ok(firestore.commits.every(commit => commit.length <= CLEANUP_BATCH_SIZE));
  assert.deepEqual(firestore.commits.flat(), paths);
  assert.equal(firestore.docs.size, 0);
});

void test('remove of nothing commits nothing', async () => {
  const { firestore, deps } = setup();
  await deps.remove([]);
  assert.deepEqual(firestore.commits, []);
});

void test('childIds lists every document id under the collection, one whose document is gone included', async () => {
  const { firestore, deps } = setup();
  firestore
    .seed(`${BASE}/goals/g1`, { gen: GEN })
    .seed(`${BASE}/goals/gone/contributions/c1`, { gen: GEN });
  assert.deepEqual(await deps.childIds(`${BASE}/goals`), ['g1', 'gone']);
  assert.deepEqual(firestore.listed, [`${BASE}/goals`]);
  assert.deepEqual(firestore.queries, []);
});

void test("memberSince reads the member document's since, and nothing when there is none", async () => {
  const { firestore, deps } = setup();
  firestore.seed(`${BASE}/members/${SAM}`, { [MEMBER_GENERATION_FIELD]: GEN, role: 'member' });
  assert.equal(await deps.memberSince(HID, SAM), GEN);
  assert.equal(await deps.memberSince(HID, ALEX), undefined);
  assert.deepEqual(firestore.reads, [`${BASE}/members/${SAM}`, `${BASE}/members/${ALEX}`]);
});

// --- the handler over the Admin deps ----------------------------------------------------------

void test("a member's deletion queries the (gen, memberUid) composite's fields and deletes only what it found", async () => {
  const { firestore, deps } = setup();
  firestore
    .seed(`${BASE}/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/ledger/${SAM}_t2`, { gen: OLDER, memberUid: SAM })
    .seed(`${BASE}/ledger/${ALEX}_t1`, { gen: GEN, memberUid: ALEX })
    .seed(`users/${SAM}/transactions/t1`, { sharedWith: [`households/${HID}`] });
  const result = await handleHouseholdLedgerCleanup(deps, {
    kind: 'member',
    householdId: HID,
    uid: SAM,
    data: { [MEMBER_GENERATION_FIELD]: GEN },
  });
  assert.deepEqual(result, { outcome: 'swept', deleted: 1 });
  assert.deepEqual(
    firestore.queries.map(({ collection, where, limit }) => ({ collection, where, limit })),
    [
      {
        collection: `${BASE}/ledger`,
        where: [
          ['gen', '==', GEN],
          ['memberUid', '==', SAM],
        ],
        limit: CLEANUP_BATCH_SIZE,
      },
    ]
  );
  assert.deepEqual(firestore.reads, [`${BASE}/members/${SAM}`]);
  assert.deepEqual(firestore.commits, [[`${BASE}/ledger/${SAM}_t1`]]);
  assert.deepEqual([...firestore.docs.keys()].sort(), [
    `${BASE}/ledger/${ALEX}_t1`,
    `${BASE}/ledger/${SAM}_t2`,
    `users/${SAM}/transactions/t1`,
  ]);
});

void test("a household's deletion sweeps each goal's contributions, a deleted goal's too, before the goals", async () => {
  const { firestore, deps } = setup();
  firestore
    .seed(`${BASE}/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/budgets/b1`, { gen: GEN })
    .seed(`${BASE}/goals/g1`, { gen: GEN })
    .seed(`${BASE}/goals/g1/contributions/c1`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/goals/g1/contributions/c2`, { gen: GEN, memberUid: ALEX })
    .seed(`${BASE}/goals/gone/contributions/c3`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/members/${SAM}`, { [MEMBER_GENERATION_FIELD]: GEN })
    // The household formed again under the same id.
    .seed(`${BASE}/goals/later`, { gen: LATER })
    .seed(`${BASE}/goals/later/contributions/c4`, { gen: LATER, memberUid: SAM })
    .seed(`${BASE}/members/${ALEX}`, { [MEMBER_GENERATION_FIELD]: LATER });
  const result = await handleHouseholdLedgerCleanup(deps, {
    kind: 'household',
    householdId: HID,
    data: { createdAt: GEN, ownerId: SAM, name: 'Home' },
  });
  assert.deepEqual(result, { outcome: 'swept', deleted: 7 });

  const ofGeneration: Clause[] = [['gen', '==', GEN]];
  assert.deepEqual(
    firestore.queries.map(({ collection, where }) => ({ collection, where })),
    [
      { collection: `${BASE}/ledger`, where: ofGeneration },
      { collection: `${BASE}/budgets`, where: ofGeneration },
      { collection: `${BASE}/goals/g1/contributions`, where: ofGeneration },
      { collection: `${BASE}/goals/gone/contributions`, where: ofGeneration },
      { collection: `${BASE}/goals/later/contributions`, where: ofGeneration },
      { collection: `${BASE}/goals`, where: ofGeneration },
      { collection: `${BASE}/members`, where: [[MEMBER_GENERATION_FIELD, '==', GEN]] },
    ]
  );
  assert.deepEqual(firestore.listed, [`${BASE}/goals`]);
  assert.deepEqual(firestore.commits, [
    [`${BASE}/ledger/${SAM}_t1`],
    [`${BASE}/budgets/b1`],
    [`${BASE}/goals/g1/contributions/c1`, `${BASE}/goals/g1/contributions/c2`],
    [`${BASE}/goals/gone/contributions/c3`],
    [`${BASE}/goals/g1`],
    [`${BASE}/members/${SAM}`],
  ]);
  // The re-formed household's documents are untouched.
  assert.deepEqual([...firestore.docs.keys()].sort(), [
    `${BASE}/goals/later`,
    `${BASE}/goals/later/contributions/c4`,
    `${BASE}/members/${ALEX}`,
  ]);
  // Nothing is read of a household that is gone.
  assert.deepEqual(firestore.reads, []);
});
