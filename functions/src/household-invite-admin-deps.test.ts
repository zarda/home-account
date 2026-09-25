import test from 'node:test';
import assert from 'node:assert/strict';
import type { Auth } from 'firebase-admin/auth';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

import { householdInviteAdminDeps } from './household-invite-admin-deps';
import type { HouseholdInviteRecord, InviteLog } from './household-invite-handler';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const HID = 'household1';
const CREATED = new Timestamp(1_790_000_000, 123_456_000);

type Data = Record<string, unknown>;

interface RecordedSet {
  path: string;
  data: Data;
  options: unknown;
}

/**
 * The slice of the Admin Firestore the deps touch, over an in-memory map of
 * documents. Every transaction write is recorded with the options it was
 * given, which is what these tests are about: the handler's own tests fake
 * the deps whole and never see how a write is made.
 */
class FakeFirestore {
  readonly docs = new Map<string, Data>();
  readonly sets: RecordedSet[] = [];
  readonly reads: string[] = [];

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
    const query = (filter?: { field: string; value: unknown }) => ({
      path,
      get: async () => this.query(path, filter),
    });
    return {
      ...query(),
      where: (field: string, _op: string, value: unknown) => query({ field, value }),
    };
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
    return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
  }

  private query(path: string, filter?: { field: string; value: unknown }) {
    const prefix = `${path}/`;
    const docs = [...this.docs.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .filter(key => !filter || this.docs.get(key)?.[filter.field] === filter.value)
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

void test('a pointer that could not be a household id is followed nowhere', async () => {
  for (const pointer of ['', '../users/x', 'a/b', 42]) {
    const { firestore, deps } = setup();
    firestore.docs.set('users/sam-uid', { householdId: pointer });

    assert.equal(await deps.membershipOf('sam-uid'), null, JSON.stringify(pointer));
    assert.deepEqual(firestore.reads, ['users/sam-uid'], JSON.stringify(pointer));
  }
});

void test("a well-formed pointer reads the member's generation and the household's", async () => {
  const { firestore, deps } = setup();
  firestore.docs.set('users/sam-uid', { householdId: 'other' });
  firestore.docs.set('households/other', { ownerId: 'x', name: 'Elsewhere', createdAt: CREATED });
  firestore.docs.set('households/other/members/sam-uid', { uid: 'sam-uid', since: CREATED });

  assert.deepEqual(await deps.membershipOf('sam-uid'), {
    householdId: 'other',
    since: CREATED,
    householdCreatedAt: CREATED,
  });
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
