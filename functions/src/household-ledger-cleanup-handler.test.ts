import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { CLEANUP_BATCH_SIZE, DeletedDocument, Equality } from './household-ledger-cleanup';
import {
  CleanupLog,
  HouseholdLedgerCleanupDeps,
  handleHouseholdLedgerCleanup,
} from './household-ledger-cleanup-handler';

const HID = 'household1';
const BASE = `households/${HID}`;
const SAM = 'sam-uid';
const ALEX = 'alex-uid';
const GEN = new Timestamp(1_790_000_000, 123_456_000);
const OLDER = new Timestamp(1_780_000_000, 0);
const LATER = new Timestamp(1_800_000_000, 0);

type Data = Record<string, unknown>;

function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Timestamp || b instanceof Timestamp) {
    return a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
  }
  return a === b;
}

/**
 * An in-memory store behind the handler's deps, listing and deleting as
 * Firestore does (a listing in document id order, a delete of a missing
 * document no error), with every call recorded in order.
 */
class World {
  readonly docs = new Map<string, Data>();
  readonly calls: string[] = [];
  readonly removed: string[][] = [];
  readonly infos: Array<[string, Record<string, unknown>]> = [];
  readonly warnings: Array<[string, Record<string, unknown>]> = [];
  readonly errors: Array<[string, unknown, Record<string, unknown>]> = [];
  /** A dep that rejects with the error instead of answering, `times` times. */
  failure: { dep: keyof HouseholdLedgerCleanupDeps; error: unknown; times: number } | null = null;
  /** Deletes nothing when false: a store that answers a delete without making it. */
  removes = true;
  /** Runs before each member read, as a concurrent write landing between the pages. */
  beforeMemberRead: () => void = () => undefined;

  seed(path: string, data: Data): this {
    this.docs.set(path, data);
    return this;
  }

  private call(dep: keyof HouseholdLedgerCleanupDeps, detail: string): void {
    this.calls.push(`${dep} ${detail}`);
    if (this.failure?.dep === dep && this.failure.times > 0) {
      this.failure.times -= 1;
      throw this.failure.error;
    }
  }

  private under(collection: string): string[] {
    const prefix = `${collection}/`;
    return [...this.docs.keys()].filter(key => key.startsWith(prefix)).sort();
  }

  deps(): HouseholdLedgerCleanupDeps {
    const log: CleanupLog = {
      info: (message, context) => this.infos.push([message, context]),
      warn: (message, context) => this.warnings.push([message, context]),
      error: (message, error, context) => this.errors.push([message, error, context]),
    };
    return {
      find: async (collection: string, where: readonly Equality[], limit: number) => {
        this.call('find', `${collection} ${where.map(({ field }) => field).join(',')} ${limit}`);
        return this.under(collection)
          .filter(key => !key.slice(collection.length + 1).includes('/'))
          .filter(key => where.every(({ field, value }) => equal(this.docs.get(key)?.[field], value)))
          .slice(0, limit);
      },
      childIds: async (collection: string) => {
        this.call('childIds', collection);
        // Every id with a document or anything under it, as listDocuments answers.
        const ids = this.under(collection).map(key => key.slice(collection.length + 1).split('/')[0]);
        return [...new Set(ids)];
      },
      memberSince: async (householdId: string, uid: string) => {
        this.call('memberSince', `${householdId}/${uid}`);
        this.beforeMemberRead();
        return this.docs.get(`households/${householdId}/members/${uid}`)?.['since'];
      },
      remove: async (paths: readonly string[]) => {
        this.call('remove', `${paths.length}`);
        this.removed.push([...paths]);
        if (this.removes) for (const path of paths) this.docs.delete(path);
      },
      log,
    };
  }
}

function memberDeleted(data: Data | undefined = { since: GEN }): DeletedDocument {
  return { kind: 'member', householdId: HID, uid: SAM, data };
}

function householdDeleted(data: Data | undefined = { createdAt: GEN }): DeletedDocument {
  return { kind: 'household', householdId: HID, data };
}

/** A member's copies and everything the member trigger must leave alone. */
function memberWorld(copies = 3): World {
  const world = new World();
  for (let i = 0; i < copies; i++) world.seed(`${BASE}/ledger/${SAM}_t${String(i).padStart(4, '0')}`, { gen: GEN, memberUid: SAM });
  return world
    .seed(`${BASE}/ledger/${ALEX}_t1`, { gen: GEN, memberUid: ALEX })
    .seed(`${BASE}/ledger/${SAM}_old`, { gen: OLDER, memberUid: SAM })
    .seed(`${BASE}/budgets/b1`, { gen: GEN })
    .seed(`${BASE}/members/${ALEX}`, { since: GEN })
    .seed(`users/${SAM}/transactions/t0000`, { sharedWith: [`households/${HID}`] });
}

/**
 * A dissolved household's leftovers, and the documents of the household
 * formed again under its id.
 */
function householdWorld(): World {
  return new World()
    .seed(`${BASE}/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM })
    .seed(`${BASE}/ledger/${ALEX}_t1`, { gen: GEN, memberUid: ALEX })
    .seed(`${BASE}/ledger/${SAM}_next`, { gen: LATER, memberUid: SAM })
    .seed(`${BASE}/budgets/b1`, { gen: GEN })
    .seed(`${BASE}/budgets/b2`, { gen: LATER })
    .seed(`${BASE}/goals/g1`, { gen: GEN })
    .seed(`${BASE}/goals/g1/contributions/c1`, { gen: GEN, memberUid: SAM })
    // A goal already deleted, its contributions left behind.
    .seed(`${BASE}/goals/gone/contributions/c2`, { gen: GEN, memberUid: ALEX })
    .seed(`${BASE}/goals/g2`, { gen: LATER })
    .seed(`${BASE}/goals/g2/contributions/c3`, { gen: LATER, memberUid: SAM })
    .seed(`${BASE}/members/${SAM}`, { since: GEN })
    .seed(`${BASE}/members/${ALEX}`, { since: LATER })
    .seed(`users/${SAM}/households/${HID}`, { since: GEN })
    .seed(`users/${SAM}/transactions/t1`, { sharedWith: [`households/${HID}`] });
}

function kept(world: World): string[] {
  return [...world.docs.keys()].sort();
}

// --- the member trigger ---------------------------------------------------------

void test("a member's deletion lists its copies, checks the member is still gone, then deletes them", async () => {
  const world = memberWorld();
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(world.calls, [
    `find ${BASE}/ledger gen,memberUid ${CLEANUP_BATCH_SIZE}`,
    `memberSince ${HID}/${SAM}`,
    'remove 3',
  ]);
  assert.deepEqual(result, { outcome: 'swept', deleted: 3 });
  assert.deepEqual(kept(world), [
    `${BASE}/budgets/b1`,
    `${BASE}/ledger/${ALEX}_t1`,
    `${BASE}/ledger/${SAM}_old`,
    `${BASE}/members/${ALEX}`,
    `users/${SAM}/transactions/t0000`,
  ]);
  assert.equal(world.infos.length, 1);
  assert.deepEqual(world.infos[0][1], { trigger: 'member', householdId: HID, uid: SAM, deleted: 3 });
});

void test("a member's copies go a page at a time, each page one call to remove", async () => {
  const world = memberWorld(2 * CLEANUP_BATCH_SIZE + 1);
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'swept', deleted: 2 * CLEANUP_BATCH_SIZE + 1 });
  assert.deepEqual(world.removed.map(page => page.length), [CLEANUP_BATCH_SIZE, CLEANUP_BATCH_SIZE, 1]);
  // A short page is the last: nothing is listed again after it.
  assert.equal(world.calls.filter(call => call.startsWith('find')).length, 3);
});

void test('a full last page is followed by one listing that finds nothing', async () => {
  const world = memberWorld(CLEANUP_BATCH_SIZE);
  await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(world.calls, [
    `find ${BASE}/ledger gen,memberUid ${CLEANUP_BATCH_SIZE}`,
    `memberSince ${HID}/${SAM}`,
    `remove ${CLEANUP_BATCH_SIZE}`,
    `find ${BASE}/ledger gen,memberUid ${CLEANUP_BATCH_SIZE}`,
  ]);
});

void test('a member back in the same generation keeps every copy', async () => {
  const world = memberWorld().seed(`${BASE}/members/${SAM}`, { since: new Timestamp(GEN.seconds, GEN.nanoseconds) });
  const before = kept(world);
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'member-back', deleted: 0 });
  assert.deepEqual(kept(world), before);
  assert.equal(world.removed.length, 0);
  assert.equal(world.errors.length, 0);
});

void test('a member who comes back part-way stops the sweep before the next page', async () => {
  const world = memberWorld(CLEANUP_BATCH_SIZE + 2);
  let reads = 0;
  world.beforeMemberRead = () => {
    reads += 1;
    if (reads === 2) world.seed(`${BASE}/members/${SAM}`, { since: GEN });
  };
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'member-back', deleted: CLEANUP_BATCH_SIZE });
  assert.deepEqual(world.removed.map(page => page.length), [CLEANUP_BATCH_SIZE]);
});

void test('a member who comes back and shares a swept row again ends the sweep as member-back, not as a failure', async () => {
  const world = memberWorld(CLEANUP_BATCH_SIZE);
  const deps = world.deps();
  const remove = deps.remove;
  deps.remove = async paths => {
    await remove(paths);
    // Between the first page's delete and the next listing the member rejoins
    // the generation and shares one of the same rows, so its copy's path is
    // listed again.
    if (world.removed.length === 1) {
      world
        .seed(`${BASE}/members/${SAM}`, { since: GEN })
        .seed(paths[0], { gen: GEN, memberUid: SAM });
    }
  };
  const result = await handleHouseholdLedgerCleanup(deps, memberDeleted());
  assert.deepEqual(result, { outcome: 'member-back', deleted: CLEANUP_BATCH_SIZE });
  assert.equal(world.errors.length, 0);
  assert.equal(world.removed.length, 1);
  assert.ok(world.docs.has(world.removed[0][0]));
});

void test('a member document of another generation does not stop the sweep', async () => {
  const world = memberWorld().seed(`${BASE}/members/${SAM}`, { since: OLDER });
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'swept', deleted: 3 });
});

// --- the household trigger ---------------------------------------------------------

void test("a household's deletion sweeps its generation in order, each goal's contributions before the goals", async () => {
  const world = householdWorld();
  const result = await handleHouseholdLedgerCleanup(world.deps(), householdDeleted());
  const page = CLEANUP_BATCH_SIZE;
  assert.deepEqual(world.calls, [
    `find ${BASE}/ledger gen ${page}`,
    'remove 2',
    `find ${BASE}/budgets gen ${page}`,
    'remove 1',
    `childIds ${BASE}/goals`,
    `find ${BASE}/goals/g1/contributions gen ${page}`,
    'remove 1',
    `find ${BASE}/goals/g2/contributions gen ${page}`,
    `find ${BASE}/goals/gone/contributions gen ${page}`,
    'remove 1',
    `find ${BASE}/goals gen ${page}`,
    'remove 1',
    `find ${BASE}/members since ${page}`,
    'remove 1',
  ]);
  assert.deepEqual(result, { outcome: 'swept', deleted: 7 });
  // The re-formed household's documents, the members' rows and their index entries stay.
  assert.deepEqual(kept(world), [
    `${BASE}/budgets/b2`,
    `${BASE}/goals/g2`,
    `${BASE}/goals/g2/contributions/c3`,
    `${BASE}/ledger/${SAM}_next`,
    `${BASE}/members/${ALEX}`,
    `users/${SAM}/households/${HID}`,
    `users/${SAM}/transactions/t1`,
  ]);
  // A household's sweep reads no member document: nobody can be back in a generation that is gone.
  assert.ok(!world.calls.some(call => call.startsWith('memberSince')));
});

// --- re-delivery ----------------------------------------------------------------------

void test('a second delivery of either event deletes nothing and succeeds', async () => {
  for (const [world, deleted] of [
    [memberWorld(), memberDeleted()],
    [householdWorld(), householdDeleted()],
  ] as const) {
    await handleHouseholdLedgerCleanup(world.deps(), deleted);
    const after = kept(world);
    world.removed.length = 0;
    const again = await handleHouseholdLedgerCleanup(world.deps(), deleted);
    assert.deepEqual(again, { outcome: 'swept', deleted: 0 });
    assert.equal(world.removed.length, 0);
    assert.deepEqual(kept(world), after);
    assert.equal(world.errors.length, 0);
  }
});

// --- no generation -----------------------------------------------------------------------

void test('a deleted document without a Timestamp generation is logged and nothing is read or deleted', async () => {
  for (const deleted of [
    memberDeleted({ role: 'member' }),
    { kind: 'member', householdId: HID, uid: SAM, data: undefined } satisfies DeletedDocument,
    householdDeleted({ createdAt: { seconds: GEN.seconds, nanoseconds: GEN.nanoseconds } }),
  ]) {
    const world = memberWorld();
    const result = await handleHouseholdLedgerCleanup(world.deps(), deleted);
    assert.deepEqual(result, { outcome: 'skipped', deleted: 0 });
    assert.deepEqual(world.calls, []);
    assert.equal(world.warnings.length, 1);
  }
});

// --- errors ---------------------------------------------------------------------------------

void test('a transient failure is rethrown, so the event is delivered again, and the next delivery finishes', async () => {
  const world = householdWorld();
  const unavailable = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
  // The budgets' delete fails after the copies are gone.
  const deps = world.deps();
  const remove = deps.remove;
  let removes = 0;
  deps.remove = async paths => {
    removes += 1;
    if (removes === 2) throw unavailable;
    return remove(paths);
  };
  await assert.rejects(handleHouseholdLedgerCleanup(deps, householdDeleted()), error => error === unavailable);
  assert.equal(world.warnings.length, 1);
  assert.deepEqual(world.warnings[0][1], { trigger: 'household', householdId: HID, deleted: 2, code: 14 });
  assert.equal(world.errors.length, 0);
  assert.ok(world.docs.has(`${BASE}/budgets/b1`));

  const retried = await handleHouseholdLedgerCleanup(world.deps(), householdDeleted());
  assert.deepEqual(retried, { outcome: 'swept', deleted: 5 });
  assert.ok(!world.docs.has(`${BASE}/budgets/b1`));
  assert.ok(!world.docs.has(`${BASE}/members/${SAM}`));
});

void test('a transient failure of a listing or of the member read is rethrown too', async () => {
  for (const dep of ['find', 'memberSince', 'childIds'] as const) {
    const world = dep === 'childIds' ? householdWorld() : memberWorld();
    const aborted = Object.assign(new Error('10 ABORTED'), { code: 10 });
    world.failure = { dep, error: aborted, times: 1 };
    const deleted = dep === 'childIds' ? householdDeleted() : memberDeleted();
    await assert.rejects(handleHouseholdLedgerCleanup(world.deps(), deleted), error => error === aborted, dep);
  }
});

void test('a permanent failure is logged with its error and the event let go', async () => {
  const world = memberWorld();
  const denied = Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
  world.failure = { dep: 'remove', error: denied, times: 1 };
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'failed', deleted: 0 });
  assert.equal(world.errors.length, 1);
  const [, cause, context] = world.errors[0];
  assert.equal(cause, denied);
  assert.deepEqual(context, { trigger: 'member', householdId: HID, uid: SAM, deleted: 0 });
  // Nothing after the failed step runs.
  assert.equal(world.calls.at(-1), 'remove 3');
});

void test('a listing that still holds what was deleted fails the sweep rather than loop', async () => {
  const world = memberWorld(CLEANUP_BATCH_SIZE);
  world.removes = false;
  const result = await handleHouseholdLedgerCleanup(world.deps(), memberDeleted());
  assert.deepEqual(result, { outcome: 'failed', deleted: CLEANUP_BATCH_SIZE });
  assert.equal(world.removed.length, 1);
  assert.equal(world.errors.length, 1);
});
