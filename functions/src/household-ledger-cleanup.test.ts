import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import {
  CLEANUP_BATCH_SIZE,
  CleanupPlan,
  DeletedDocument,
  Equality,
  Sweep,
  generationOf,
  isTransientError,
  memberReturned,
  planCleanup,
} from './household-ledger-cleanup';

const HID = 'household1';
const SAM = 'sam-uid';
const ALEX = 'alex-uid';
const GEN = new Timestamp(1_790_000_000, 123_456_000);
/** The same second, one nanosecond on: another generation. */
const NEXT_NANO = new Timestamp(1_790_000_000, 123_456_001);
const OLDER = new Timestamp(1_780_000_000, 0);

type Data = Record<string, unknown>;

function member(data: Data | undefined, uid = SAM): DeletedDocument {
  return { kind: 'member', householdId: HID, uid, data };
}

function household(data: Data | undefined): DeletedDocument {
  return { kind: 'household', householdId: HID, data };
}

function sweeps(plan: CleanupPlan): readonly Sweep[] {
  assert.equal(plan.kind, 'sweep');
  return plan.kind === 'sweep' ? plan.sweeps : [];
}

/** Equality as Firestore judges it: a Timestamp to the nanosecond, anything else by value. */
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Timestamp || b instanceof Timestamp) {
    return a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
  }
  return a === b;
}

function holds(where: readonly Equality[], data: Data): boolean {
  return where.every(({ field, value }) => equal(data[field], value));
}

/**
 * Whether the plan would delete the document at `path`: a sweep reaches a
 * document of its collection (or of its child collection under any parent
 * id) whose fields hold every one of its equalities.
 */
function reaches(plan: CleanupPlan, path: string, data: Data): boolean {
  const collection = path.slice(0, path.lastIndexOf('/'));
  return sweeps(plan).some(sweep => {
    if (sweep.kind === 'where') return sweep.collection === collection && holds(sweep.where, data);
    const prefix = `${sweep.parent}/`;
    if (!collection.startsWith(prefix)) return false;
    const [, child, ...rest] = collection.slice(prefix.length).split('/');
    return child === sweep.child && rest.length === 0 && holds(sweep.where, data);
  });
}

// --- the member trigger --------------------------------------------------------

void test("a member's deletion plans one sweep: its copies of its own generation, in the composite's field order", () => {
  const plan = planCleanup(member({ since: GEN, role: 'member' }));
  assert.deepEqual(sweeps(plan), [
    {
      kind: 'where',
      collection: `households/${HID}/ledger`,
      where: [
        { field: 'gen', value: GEN },
        { field: 'memberUid', value: SAM },
      ],
    },
  ]);
});

void test('the generation is passed through untouched, so the query compares the stored Timestamp itself', () => {
  const [sweep] = sweeps(planCleanup(member({ since: GEN })));
  assert.equal(sweep.kind, 'where');
  assert.equal(sweep.where[0].value, GEN);
});

void test("a member's deletion reaches only its own copies of that generation, never its rows or the household's plans", () => {
  const plan = planCleanup(member({ since: GEN }));
  const ledger = `households/${HID}/ledger`;
  assert.equal(reaches(plan, `${ledger}/${SAM}_t1`, { gen: GEN, memberUid: SAM }), true);
  // Another member's copy, and the member's copies of any other generation.
  assert.equal(reaches(plan, `${ledger}/${ALEX}_t1`, { gen: GEN, memberUid: ALEX }), false);
  assert.equal(reaches(plan, `${ledger}/${SAM}_t2`, { gen: OLDER, memberUid: SAM }), false);
  assert.equal(reaches(plan, `${ledger}/${SAM}_t3`, { gen: NEXT_NANO, memberUid: SAM }), false);
  // The member's own rows stay the member's: stripping a key is its own job.
  assert.equal(reaches(plan, `users/${SAM}/transactions/t1`, { gen: GEN, memberUid: SAM }), false);
  for (const collection of ['budgets', 'goals', 'members']) {
    assert.equal(reaches(plan, `households/${HID}/${collection}/x`, { gen: GEN, since: GEN, memberUid: SAM }), false);
  }
  for (const sweep of sweeps(plan)) {
    assert.equal(sweep.kind, 'where');
    if (sweep.kind === 'where') assert.ok(sweep.collection.startsWith(`households/${HID}/`));
  }
});

void test("a member's deletion is stopped by the same member back in the same generation", () => {
  const plan = planCleanup(member({ since: GEN }));
  assert.equal(plan.kind, 'sweep');
  if (plan.kind !== 'sweep') return;
  assert.deepEqual(plan.unlessMember, { householdId: HID, uid: SAM, generation: GEN });
});

// --- the household trigger ------------------------------------------------------

void test("a household's deletion plans its copies, budgets, each goal's contributions, goals and members, the goals' contributions first", () => {
  const plan = planCleanup(household({ name: 'Home', ownerId: ALEX, createdAt: GEN }));
  const base = `households/${HID}`;
  const ofGeneration = [{ field: 'gen', value: GEN }];
  assert.deepEqual(sweeps(plan), [
    { kind: 'where', collection: `${base}/ledger`, where: ofGeneration },
    { kind: 'where', collection: `${base}/budgets`, where: ofGeneration },
    { kind: 'nested', parent: `${base}/goals`, child: 'contributions', where: ofGeneration },
    { kind: 'where', collection: `${base}/goals`, where: ofGeneration },
    { kind: 'where', collection: `${base}/members`, where: [{ field: 'since', value: GEN }] },
  ]);
  assert.equal(plan.kind === 'sweep' ? plan.unlessMember : 'none', undefined);
});

void test("a household's deletion never reaches a document of another generation under the same id", () => {
  const plan = planCleanup(household({ createdAt: GEN }));
  const base = `households/${HID}`;
  const documents: Array<[string, Data]> = [
    [`${base}/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM }],
    [`${base}/budgets/b1`, { gen: GEN }],
    [`${base}/goals/g1`, { gen: GEN }],
    [`${base}/goals/g1/contributions/c1`, { gen: GEN, memberUid: SAM }],
    [`${base}/goals/gone/contributions/c2`, { gen: GEN, memberUid: SAM }],
    [`${base}/members/${SAM}`, { since: GEN }],
  ];
  for (const [path, data] of documents) {
    assert.equal(reaches(plan, path, data), true, `${path} of the deleted generation is swept`);
    const field = 'since' in data ? 'since' : 'gen';
    for (const other of [OLDER, NEXT_NANO]) {
      assert.equal(reaches(plan, path, { ...data, [field]: other }), false, `${path} of another generation is kept`);
    }
    const unstamped = { ...data };
    delete unstamped[field];
    assert.equal(reaches(plan, path, unstamped), false, `${path} without a generation is kept`);
  }
  // Nothing outside the household, and nothing by path alone.
  assert.equal(reaches(plan, `users/${SAM}/transactions/t1`, { gen: GEN }), false);
  assert.equal(reaches(plan, `users/${SAM}/households/${HID}`, { since: GEN }), false);
  assert.equal(reaches(plan, `households/other/ledger/${SAM}_t1`, { gen: GEN, memberUid: SAM }), false);
  for (const sweep of sweeps(plan)) assert.ok(sweep.where.length > 0, 'no sweep lists a whole collection');
});

// --- no generation, nothing planned ------------------------------------------------

void test('a deleted document with no data plans nothing', () => {
  assert.deepEqual(planCleanup(member(undefined)), { kind: 'skip', reason: 'no-document' });
  assert.deepEqual(planCleanup(household(undefined)), { kind: 'skip', reason: 'no-document' });
});

void test('a deleted document without a Timestamp generation plans nothing', () => {
  const lookAlike = { seconds: GEN.seconds, nanoseconds: GEN.nanoseconds };
  for (const value of [undefined, null, 0, GEN.toMillis(), '2026-09-28', GEN.toDate(), lookAlike, [GEN]]) {
    assert.deepEqual(planCleanup(member({ since: value })), { kind: 'skip', reason: 'no-generation' });
    assert.deepEqual(planCleanup(household({ createdAt: value })), { kind: 'skip', reason: 'no-generation' });
  }
});

void test('each trigger reads its own generation field and no other', () => {
  // A member document's generation is `since`; a household's is `createdAt`.
  assert.equal(planCleanup(member({ createdAt: GEN, gen: GEN })).kind, 'skip');
  assert.equal(planCleanup(household({ since: GEN, gen: GEN })).kind, 'skip');
});

void test('generationOf admits a stored Timestamp and nothing shaped like one', () => {
  assert.equal(generationOf(GEN), GEN);
  assert.equal(generationOf({ seconds: 1, nanoseconds: 2 }), null);
  assert.equal(generationOf({ seconds: 1, nanoseconds: 2, toMillis: 'no' }), null);
  assert.equal(generationOf(new Date()), null);
  assert.equal(generationOf(undefined), null);
});

// --- the member's return -------------------------------------------------------------

void test('memberReturned holds only for a member document of the same generation, to the nanosecond', () => {
  const guard = { householdId: HID, uid: SAM, generation: GEN };
  assert.equal(memberReturned(guard, new Timestamp(GEN.seconds, GEN.nanoseconds)), true);
  assert.equal(memberReturned(guard, NEXT_NANO), false);
  assert.equal(memberReturned(guard, OLDER), false);
  assert.equal(memberReturned(guard, undefined), false);
  assert.equal(memberReturned(guard, { seconds: GEN.seconds, nanoseconds: GEN.nanoseconds }), false);
});

// --- errors ------------------------------------------------------------------------------

void test('isTransientError names the gRPC statuses a later delivery can outlast', () => {
  // CANCELLED, UNKNOWN, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED, INTERNAL, UNAVAILABLE.
  for (const code of [1, 2, 4, 8, 10, 13, 14]) {
    assert.equal(isTransientError(Object.assign(new Error(`${code}`), { code })), true, `code ${code}`);
  }
  // INVALID_ARGUMENT, NOT_FOUND, ALREADY_EXISTS, PERMISSION_DENIED, FAILED_PRECONDITION,
  // OUT_OF_RANGE, UNIMPLEMENTED, DATA_LOSS, UNAUTHENTICATED.
  for (const code of [3, 5, 6, 7, 9, 11, 12, 15, 16]) {
    assert.equal(isTransientError(Object.assign(new Error(`${code}`), { code })), false, `code ${code}`);
  }
  for (const error of [new TypeError('bug'), 'unavailable', null, undefined, { code: '14' }]) {
    assert.equal(isTransientError(error), false);
  }
});

void test('a page of the sweep fits in one commit', () => {
  assert.ok(CLEANUP_BATCH_SIZE > 0 && CLEANUP_BATCH_SIZE <= 500);
});
