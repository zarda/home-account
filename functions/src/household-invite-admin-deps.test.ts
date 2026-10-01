import test from 'node:test';
import assert from 'node:assert/strict';
import type { Auth } from 'firebase-admin/auth';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

import { MEMBERSHIP_READ_BOUND } from './household-invite';
import { householdInviteAdminDeps } from './household-invite-admin-deps';
import type { HouseholdInviteRecord, InviteLog } from './household-invite-handler';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const HID = 'household1';
const CREATED = new Timestamp(1_790_000_000, 123_456_000);
const OLDER = new Timestamp(1_780_000_000, 0);

type Data = Record<string, unknown>;

interface RecordedSet {
  path: string;
  data: Data;
  options: unknown;
}

/**
 * The slice of the Admin Firestore the deps touch, over an in-memory map of
 * documents. Every transaction write is recorded with the options it was
 * given, and every listing limit and batched read with what it asked for,
 * which is what these tests are about: the handler's own tests fake the deps
 * whole and never see how a read or a write is made.
 */
class FakeFirestore {
  readonly docs = new Map<string, Data>();
  readonly sets: RecordedSet[] = [];
  readonly reads: string[] = [];
  /** The limit each listing was given, in order; undefined for none. */
  readonly limits: Array<number | undefined> = [];
  /** The paths of each getAll call, in order. */
  readonly batches: string[][] = [];

  doc(path: string) {
    return {
      path,
      get: async () => this.snapshot(path),
      update: async (data: Data) => {
        const current = this.docs.get(path);
        if (!current) throw Object.assign(new Error('5 NOT_FOUND'), { code: 5 });
        this.docs.set(path, { ...current, ...data });
      },
    };
  }

  collection(path: string) {
    const query = (filter?: { field: string; value: unknown }, limit?: number) => ({
      path,
      get: async () => {
        this.limits.push(limit);
        return this.query(path, filter, limit);
      },
    });
    return {
      ...query(),
      where: (field: string, _op: string, value: unknown) => query({ field, value }),
      limit: (limit: number) => query(undefined, limit),
    };
  }

  async getAll(...refs: { path: string }[]) {
    // The Admin SDK refuses a batched read of nothing.
    if (refs.length === 0) throw new Error('getAll needs at least one document');
    this.batches.push(refs.map(ref => ref.path));
    return refs.map(ref => this.snapshot(ref.path));
  }

  async runTransaction<T>(update: (tx: unknown) => Promise<T>): Promise<T> {
    const staged: RecordedSet[] = [];
    const tx = {
      get: (target: { get(): Promise<unknown> }) => target.get(),
      getAll: (...refs: { get(): Promise<unknown> }[]) => Promise.all(refs.map(ref => ref.get())),
      set: (ref: { path: string }, data: Data, options?: unknown) => {
        staged.push({ path: ref.path, data, options });
      },
    };
    const result = await update(tx);
    for (const write of staged) {
      this.sets.push(write);
      const merge = (write.options as { merge?: boolean } | undefined)?.merge === true;
      this.docs.set(write.path, merge ? { ...this.docs.get(write.path), ...write.data } : write.data);
    }
    return result;
  }

  private snapshot(path: string) {
    this.reads.push(path);
    const data = this.docs.get(path);
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    };
  }

  // Firestore lists a collection in document id order.
  private query(path: string, filter?: { field: string; value: unknown }, limit?: number) {
    const prefix = `${path}/`;
    const docs = [...this.docs.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .filter(key => !filter || this.docs.get(key)?.[filter.field] === filter.value)
      .sort()
      .slice(0, limit)
      .map(key => this.snapshot(key));
    return { docs };
  }
}

const silentLog: InviteLog = { warn: () => undefined, error: () => undefined };

function setup(auth: Partial<Auth> = {}) {
  const firestore = new FakeFirestore();
  const deps = householdInviteAdminDeps({
    firestore: firestore as unknown as Firestore,
    auth: auth as Auth,
    sendMail: async () => undefined,
    log: silentLog,
  });
  return { firestore, deps };
}

function invite(overrides: Partial<HouseholdInviteRecord> = {}): HouseholdInviteRecord {
  return {
    householdId: HID,
    householdCreatedAt: CREATED,
    householdName: 'Our home',
    inviterUid: 'owner-uid',
    inviterName: 'Alex',
    inviterEmail: 'alex@example.com',
    inviteeUid: 'sam-uid',
    inviteeEmail: 'sam@example.com',
    locale: 'en',
    createdAt: new Date(NOW),
    expiresAt: new Date(NOW + 7 * 86_400_000),
    mail: 'failed',
    ...overrides,
  };
}

void test("the inviter's lookup count merges into the quota document it shares", async () => {
  const { firestore, deps } = setup();
  firestore.docs.set('inviteQuotas/owner-uid', { inbound: 2, inboundWindowStart: new Date(NOW) });

  assert.equal(await deps.bumpInviterQuota('owner-uid', NOW), true);

  assert.deepEqual(
    firestore.sets.map(({ path, options }) => ({ path, options })),
    [{ path: 'inviteQuotas/owner-uid', options: { merge: true } }]
  );
  // The recipient half of the same document survives the inviter's write.
  assert.equal(firestore.docs.get('inviteQuotas/owner-uid')?.['inbound'], 2);
});

void test('a spent lookup window writes nothing', async () => {
  const { firestore, deps } = setup();
  firestore.docs.set('inviteQuotas/owner-uid', { windowStart: new Date(NOW), count: 10 });

  assert.equal(await deps.bumpInviterQuota('owner-uid', NOW + 1000), false);
  assert.deepEqual(firestore.sets, []);
});

void test("a mail charge merges the recipient's counter and replaces the day's budget", async () => {
  const { firestore, deps } = setup();
  firestore.docs.set('inviteQuotas/sam-uid', { windowStart: new Date(NOW), count: 4 });

  assert.equal(await deps.chargeMail('sam-uid', NOW), true);

  assert.deepEqual(
    firestore.sets.map(({ path, options }) => ({ path, options })),
    [
      { path: 'inviteQuotas/sam-uid', options: { merge: true } },
      { path: 'mailBudget/daily', options: undefined },
    ]
  );
  // The inviter half of the same document survives the recipient's write.
  assert.equal(firestore.docs.get('inviteQuotas/sam-uid')?.['count'], 4);
});

void test('a household whose createdAt is not a Timestamp reads as no household', async () => {
  const { firestore, deps } = setup();
  firestore.docs.set(`households/${HID}`, {
    ownerId: 'owner-uid',
    name: 'Our home',
    createdAt: { seconds: CREATED.seconds, nanoseconds: CREATED.nanoseconds },
  });
  assert.equal(await deps.getHousehold(HID), null);

  firestore.docs.set(`households/${HID}`, { ownerId: 'owner-uid', name: 'Our home', createdAt: CREATED });
  assert.deepEqual(await deps.getHousehold(HID), {
    ownerId: 'owner-uid',
    name: 'Our home',
    createdAt: CREATED,
  });
});

void test("the member step reads the invitee's member document here, and only it", async () => {
  const { firestore, deps } = setup();
  const member = `households/${HID}/members/sam-uid`;
  firestore.docs.set('users/sam-uid', { householdId: HID });
  firestore.docs.set(member, { uid: 'sam-uid', since: CREATED });

  assert.equal(await deps.memberSince(HID, 'sam-uid'), CREATED);
  assert.deepEqual(firestore.reads, [member]);

  firestore.docs.delete(member);
  assert.equal(await deps.memberSince(HID, 'sam-uid'), null);

  firestore.docs.set(member, { uid: 'sam-uid', since: '2026-09-25' });
  assert.equal(await deps.memberSince(HID, 'sam-uid'), null);
});

void test('an index entry is read with its member doc and household, not the profile', async () => {
  const { firestore, deps } = setup();
  // A householdId on the profile is never read; entries come from the index,
  // its member doc and its household.
  firestore.docs.set('users/sam-uid', { householdId: 'live' });
  const entries: Record<string, Data> = {
    live: { since: CREATED, role: 'member', name: 'Live' },
    ended: { since: CREATED, role: 'member', name: 'Ended', endedAt: CREATED },
    removed: { since: CREATED, role: 'member', name: 'Removed' },
    dissolved: { since: CREATED, role: 'owner', name: 'Dissolved' },
    reformed: { since: OLDER, role: 'member', name: 'Reformed' },
  };
  for (const [id, entry] of Object.entries(entries)) {
    firestore.docs.set(`users/sam-uid/households/${id}`, entry);
    if (id !== 'dissolved') {
      firestore.docs.set(`households/${id}`, { ownerId: 'x', name: id, createdAt: CREATED });
    }
    if (id !== 'removed') {
      firestore.docs.set(`households/${id}/members/sam-uid`, { since: entry['since'] });
    }
  }

  const found = await deps.membershipsOf('sam-uid');

  const read = (householdId: string, since: Timestamp, memberSince: Timestamp | null) => ({
    householdId,
    since,
    ended: householdId === 'ended',
    memberSince,
    householdCreatedAt: householdId === 'dissolved' ? null : CREATED,
  });
  assert.equal(found.overflow, false);
  assert.deepEqual(
    [...found.entries].sort((a, b) => a.householdId.localeCompare(b.householdId)),
    [
      read('dissolved', CREATED, CREATED),
      read('ended', CREATED, CREATED),
      read('live', CREATED, CREATED),
      read('reformed', OLDER, OLDER),
      read('removed', CREATED, null),
    ]
  );
  assert.ok(!firestore.reads.includes('users/sam-uid'), 'the profile was read');
  // Every member doc and household in one batched read.
  assert.equal(firestore.batches.length, 1);
  assert.deepEqual(
    [...firestore.batches[0]].sort(),
    Object.keys(entries)
      .flatMap(id => [`households/${id}`, `households/${id}/members/sam-uid`])
      .sort()
  );
});

// The account writes its own index, so its length is the account's to choose;
// one invite reads a bounded number of documents whatever it holds.
void test('an index longer than the read bound is listed no further, in one batched read', async () => {
  const { firestore, deps } = setup();
  const total = MEMBERSHIP_READ_BOUND + 5;
  for (let i = 0; i < total; i++) {
    const id = `h${String(i).padStart(3, '0')}`;
    firestore.docs.set(`users/sam-uid/households/${id}`, { since: CREATED, role: 'owner' });
    firestore.docs.set(`households/${id}`, { ownerId: 'sam-uid', name: id, createdAt: CREATED });
    firestore.docs.set(`households/${id}/members/sam-uid`, { since: CREATED });
  }

  const found = await deps.membershipsOf('sam-uid');

  assert.deepEqual(firestore.limits, [MEMBERSHIP_READ_BOUND + 1]);
  assert.equal(found.overflow, true);
  assert.equal(found.entries.length, MEMBERSHIP_READ_BOUND);
  assert.equal(firestore.batches.length, 1);
  assert.equal(firestore.batches[0].length, 2 * MEMBERSHIP_READ_BOUND);
  assert.equal(
    firestore.reads.filter(path => path.startsWith('households/')).length,
    2 * MEMBERSHIP_READ_BOUND
  );
});

void test('an index of exactly the read bound is read whole', async () => {
  const { firestore, deps } = setup();
  for (let i = 0; i < MEMBERSHIP_READ_BOUND; i++) {
    firestore.docs.set(`users/sam-uid/households/h${i}`, { since: CREATED, role: 'member' });
  }

  const found = await deps.membershipsOf('sam-uid');

  assert.equal(found.overflow, false);
  assert.equal(found.entries.length, MEMBERSHIP_READ_BOUND);
});

void test('an index entry whose id could not be a household id is followed nowhere', async () => {
  const { firestore, deps } = setup();
  for (const id of ['__x__', 'a b']) {
    firestore.docs.set(`users/sam-uid/households/${id}`, { since: CREATED, role: 'member' });
  }

  assert.deepEqual(await deps.membershipsOf('sam-uid'), { entries: [], overflow: false });
  assert.deepEqual(
    firestore.reads.filter(path => path.startsWith('households/')),
    []
  );
  assert.deepEqual(firestore.batches, []);
});

void test('an account with no index lists no memberships', async () => {
  const { firestore, deps } = setup();
  assert.deepEqual(await deps.membershipsOf('sam-uid'), { entries: [], overflow: false });
  assert.deepEqual(firestore.batches, []);
});

void test('an invite is written only while its household still has a seat', async () => {
  const { firestore, deps } = setup();
  for (let seat = 0; seat < 8; seat++) {
    firestore.docs.set(`households/${HID}/members/m${seat}`, { uid: `m${seat}`, since: CREATED });
  }

  assert.equal(await deps.writeInvite(`${HID}_sam-uid`, invite()), false);
  assert.deepEqual(firestore.sets, []);

  firestore.docs.delete(`households/${HID}/members/m7`);
  assert.equal(await deps.writeInvite(`${HID}_sam-uid`, invite()), true);
  assert.deepEqual(
    firestore.sets.map(({ path, options }) => ({ path, options })),
    [{ path: `householdInvites/${HID}_sam-uid`, options: undefined }]
  );
});

void test('an address no account uses is no account, and any other failure is thrown', async () => {
  const missing = Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
  const broken = Object.assign(new Error('down'), { code: 'auth/internal-error' });

  const { deps: none } = setup({ getUserByEmail: async () => Promise.reject(missing) });
  assert.equal(await none.getUserByEmail('sam@example.com'), null);

  const { deps: failing } = setup({ getUserByEmail: async () => Promise.reject(broken) });
  await assert.rejects(failing.getUserByEmail('sam@example.com'), broken);

  const { deps: found } = setup({
    getUserByEmail: async () => ({ uid: 'sam-uid', disabled: false }) as never,
  });
  assert.deepEqual(await found.getUserByEmail('sam@example.com'), { uid: 'sam-uid', disabled: false });
});

void test('a mail status is recorded as an update, which a consumed invite refuses', async () => {
  const { firestore, deps } = setup();
  await assert.rejects(deps.recordMail(`${HID}_sam-uid`, 'sent'), { code: 5 });
  assert.equal(firestore.docs.has(`householdInvites/${HID}_sam-uid`), false);

  firestore.docs.set(`householdInvites/${HID}_sam-uid`, { mail: 'failed' });
  await deps.recordMail(`${HID}_sam-uid`, 'sent');
  assert.equal(firestore.docs.get(`householdInvites/${HID}_sam-uid`)?.['mail'], 'sent');
});
