import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpsError } from 'firebase-functions/https';

import { composeHouseholdInviteEmail } from './compose-household-invite-email';
import {
  DAY_MS,
  HouseholdRecord,
  InviteeAccount,
  PendingInvite,
  Stamp,
  hasSeat,
  nextInviteQuota,
  nextMailCharge,
  sameStamp,
} from './household-invite';
import {
  Deadline,
  HouseholdInviteDeps,
  HouseholdInviteRecord,
  InviteMailMessage,
  InviteRequest,
  handleHouseholdInvite,
  timerDeadline,
} from './household-invite-handler';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const HID = 'household1';
const OWNER = 'owner-uid';
const SAM = 'sam-uid';
const INVITE_ID = `${HID}_${SAM}`;
const CREATED: Stamp = { seconds: 1_790_000_000, nanoseconds: 123_456_000 };
const OLDER: Stamp = { seconds: 1_780_000_000, nanoseconds: 0 };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * An in-memory stand-in for everything the handler reads and writes. The quota
 * fakes run the real pure reducers, so the caps under test are the shipped ones.
 */
class World {
  now = NOW;
  households = new Map<string, HouseholdRecord>();
  /** householdId → uid → since */
  members = new Map<string, Map<string, Stamp>>();
  /** uid → the profile's householdId */
  pointers = new Map<string, string>();
  /** normalised email → account */
  accounts = new Map<string, InviteeAccount>();
  invites = new Map<string, HouseholdInviteRecord>();
  quotas = new Map<string, Record<string, unknown>>();
  budget: Record<string, unknown> | undefined;
  sent: InviteMailMessage[] = [];
  calls: string[] = [];
  warnings: string[] = [];
  errors: string[] = [];
  /** What each log.error call was handed positionally. */
  errorCauses: unknown[] = [];
  cleared = 0;
  requestedDeadlines: number[] = [];
  mailer: (mail: InviteMailMessage) => Promise<void> = async mail => {
    this.sent.push(mail);
  };
  /** Never fires unless a test replaces it: the timer is driven by hand. */
  timer: () => Promise<void> = () => deferred<void>().promise;
  /** Another call's write landing between this call's seat check and its own write. */
  beforeWrite: () => void = () => undefined;
  /** When set, recordMail rejects with it instead of updating. */
  recordFailure: unknown = undefined;

  liveMemberCount(householdId: string, createdAt: Stamp): number {
    const sinces = [...(this.members.get(householdId)?.values() ?? [])];
    return sinces.filter(since => sameStamp(since, createdAt)).length;
  }

  pendingOf(householdId: string): PendingInvite[] {
    return [...this.invites.values()]
      .filter(invite => invite.householdId === householdId)
      .map(invite => ({
        inviteeUid: invite.inviteeUid,
        expiresAt: invite.expiresAt.getTime(),
        householdCreatedAt: invite.householdCreatedAt,
      }));
  }

  deps(): HouseholdInviteDeps {
    const called = (name: string) => this.calls.push(name);
    return {
      now: () => this.now,
      getHousehold: async householdId => {
        called('getHousehold');
        return this.households.get(householdId) ?? null;
      },
      bumpInviterQuota: async (uid, now) => {
        called('bumpInviterQuota');
        const verdict = nextInviteQuota(this.quotas.get(uid), now);
        if (verdict.allowed) this.quotas.set(uid, { ...this.quotas.get(uid), ...verdict.next });
        return verdict.allowed;
      },
      getUserByEmail: async email => {
        called('getUserByEmail');
        return this.accounts.get(email) ?? null;
      },
      membershipOf: async uid => {
        called('membershipOf');
        const householdId = this.pointers.get(uid);
        if (!householdId) return null;
        return {
          householdId,
          since: this.members.get(householdId)?.get(uid) ?? null,
          householdCreatedAt: this.households.get(householdId)?.createdAt ?? null,
        };
      },
      countMembers: async (householdId, createdAt) => {
        called('countMembers');
        return this.liveMemberCount(householdId, createdAt);
      },
      pendingInvites: async householdId => {
        called('pendingInvites');
        return this.pendingOf(householdId);
      },
      chargeMail: async (uid, now) => {
        called('chargeMail');
        const charge = nextMailCharge(this.quotas.get(uid), this.budget, now);
        if (charge.send) {
          this.quotas.set(uid, { ...this.quotas.get(uid), ...charge.recipient });
          this.budget = { ...charge.budget };
        }
        return charge.send;
      },
      // The seat judged again at the write, as the Admin transaction does.
      writeInvite: async (inviteId, invite) => {
        called('writeInvite');
        this.beforeWrite();
        const seat = hasSeat(
          {
            liveMembers: this.liveMemberCount(invite.householdId, invite.householdCreatedAt),
            invites: this.pendingOf(invite.householdId),
          },
          {
            inviteeUid: invite.inviteeUid,
            generation: invite.householdCreatedAt,
            now: invite.createdAt.getTime(),
          }
        );
        if (seat) this.invites.set(inviteId, { ...invite });
        return seat;
      },
      recordMail: async (inviteId, mail) => {
        called('recordMail');
        if (this.recordFailure !== undefined) throw this.recordFailure;
        const invite = this.invites.get(inviteId);
        // An update, as in Firestore: a consumed invite is not recreated, and
        // the rejection carries the gRPC NOT_FOUND status the Admin SDK uses.
        if (!invite) {
          throw Object.assign(new Error('5 NOT_FOUND: No document to update'), { code: 5 });
        }
        invite.mail = mail;
      },
      sendMail: mail => {
        called('sendMail');
        return this.mailer(mail);
      },
      deadline: (ms): Deadline => {
        called('deadline');
        this.requestedDeadlines.push(ms);
        return {
          fired: this.timer(),
          clear: () => {
            this.cleared++;
          },
        };
      },
      log: {
        warn: message => void this.warnings.push(message),
        error: (message, error) => {
          this.errors.push(message);
          this.errorCauses.push(error);
        },
      },
    };
  }
}

/** Alex owns HID alone; Sam has an account and no household. */
function world(): World {
  const w = new World();
  w.households.set(HID, { ownerId: OWNER, name: 'Our home', createdAt: CREATED });
  w.members.set(HID, new Map([[OWNER, CREATED]]));
  w.pointers.set(OWNER, HID);
  w.accounts.set('sam@example.com', { uid: SAM, disabled: false });
  return w;
}

const ownerAuth = {
  uid: OWNER,
  token: { email: 'alex@example.com', email_verified: true, name: 'Alex' },
};

function request(
  data: Record<string, unknown> = {},
  auth: InviteRequest['auth'] = ownerAuth
): InviteRequest {
  return { auth, data: { householdId: HID, email: 'Sam@Example.com', locale: 'ja', ...data } };
}

function pendingInvite(uid: string): HouseholdInviteRecord {
  return {
    householdId: HID,
    householdCreatedAt: CREATED,
    householdName: 'Our home',
    inviterUid: OWNER,
    inviterName: 'Alex',
    inviterEmail: 'alex@example.com',
    inviteeUid: uid,
    inviteeEmail: `${uid}@example.com`,
    locale: 'en',
    createdAt: new Date(NOW - DAY_MS),
    expiresAt: new Date(NOW + 6 * DAY_MS),
    mail: 'sent',
  };
}

function refusal(code: string, reason: string): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof HttpsError, `expected an HttpsError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.deepEqual(error.details, { reason });
    return true;
  };
}

// --- the invite -----------------------------------------------------------------

void test('an invite is written for the looked-up account and mailed', async () => {
  const w = world();
  const result = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'sent' });
  assert.deepEqual(w.invites.get(INVITE_ID), {
    householdId: HID,
    householdCreatedAt: CREATED,
    householdName: 'Our home',
    inviterUid: OWNER,
    inviterName: 'Alex',
    inviterEmail: 'alex@example.com',
    inviteeUid: SAM,
    inviteeEmail: 'sam@example.com',
    locale: 'ja',
    createdAt: new Date(NOW),
    expiresAt: new Date(NOW + 7 * DAY_MS),
    mail: 'sent',
  });
  // The household's own stamp object, so a Firestore Timestamp is written back
  // to the nanosecond the join rule compares against.
  assert.equal(w.invites.get(INVITE_ID)?.householdCreatedAt, CREATED);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, 'sam@example.com');
});

void test('the mail sent is the composed invite mail, in the inviter\'s language', async () => {
  const w = world();
  await handleHouseholdInvite(w.deps(), request({ locale: 'tc' }));

  const composed = composeHouseholdInviteEmail({
    inviterEmail: 'alex@example.com',
    expiresAt: new Date(NOW + 7 * DAY_MS),
    locale: 'tc',
  });
  assert.deepEqual(w.sent, [
    { to: 'sam@example.com', subject: composed.subject, text: composed.text },
  ]);
});

void test('the call returns only the invite id and the mail status', async () => {
  const w = world();
  const result = await handleHouseholdInvite(w.deps(), request());
  assert.deepEqual(Object.keys(result).sort(), ['inviteId', 'mail']);
});

void test('a refresh rewrites the generation, the creation time and the expiry', async () => {
  const w = world();
  w.invites.set(INVITE_ID, {
    ...pendingInvite(SAM),
    householdCreatedAt: OLDER,
    createdAt: new Date(NOW - 3 * DAY_MS),
    expiresAt: new Date(NOW + 4 * DAY_MS),
  });

  await handleHouseholdInvite(w.deps(), request());

  const invite = w.invites.get(INVITE_ID);
  assert.equal(invite?.householdCreatedAt, CREATED);
  assert.deepEqual(invite?.createdAt, new Date(NOW));
  assert.deepEqual(invite?.expiresAt, new Date(NOW + 7 * DAY_MS));
});

void test('an invitee with a stale pointer to another household is invited', async () => {
  const w = world();
  w.households.set('other', { ownerId: 'someone', name: 'Theirs', createdAt: CREATED });
  // Removed from 'other': the member doc is gone and the pointer outlived it.
  w.pointers.set(SAM, 'other');
  const result = await handleHouseholdInvite(w.deps(), request());
  assert.equal(result.mail, 'sent');
});

// --- the mail -------------------------------------------------------------------

void test('a rejected mail leaves the invite written with mail failed', async () => {
  const w = world();
  w.mailer = async () => {
    throw new Error('535 authentication failed');
  };

  const result = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'failed' });
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'failed');
  assert.equal(w.errors.length, 1);
  assert.equal(w.cleared, 1);
});

void test('a mail still pending when the deadline fires gives failed, and the call resolves', async () => {
  const w = world();
  const send = deferred<void>();
  const fired = deferred<void>();
  w.timer = () => fired.promise;
  // The deadline fires only once the send has started.
  w.mailer = () => {
    fired.resolve();
    return send.promise;
  };

  const result = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(w.requestedDeadlines, [10_000]);
  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'failed' });
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'failed');
  assert.equal(w.cleared, 1);

  // The abandoned send settling late changes nothing and raises nothing.
  send.reject(new Error('late failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'failed');
});

void test('the deadline is cleared once the mail settles', async () => {
  const w = world();
  await handleHouseholdInvite(w.deps(), request());
  assert.equal(w.cleared, 1);
});

void test('an invite accepted while its mail was in flight is not written back', async () => {
  const w = world();
  w.mailer = async mail => {
    w.sent.push(mail);
    w.invites.delete(INVITE_ID);
  };

  const result = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'sent' });
  assert.equal(w.invites.has(INVITE_ID), false);
  assert.equal(w.warnings.length, 1);
  assert.deepEqual(w.errors, []);
});

void test('a mail status that fails to record for another reason is an error, and the answer stands', async () => {
  const w = world();
  const failure = Object.assign(new Error('14 UNAVAILABLE: connection reset'), { code: 14 });
  w.recordFailure = failure;

  const result = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'sent' });
  // The record keeps its provisional status; the answer says what happened.
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'failed');
  assert.deepEqual(w.warnings, []);
  assert.equal(w.errors.length, 1);
  // Handed over positionally, so the logger keeps its stack.
  assert.equal(w.errorCauses[0], failure);
});

void test('the fourth mail to one recipient in a day is held, and the invite is still written', async () => {
  const w = world();
  for (let i = 0; i < 3; i++) {
    w.now = NOW + i * 1000;
    assert.equal((await handleHouseholdInvite(w.deps(), request())).mail, 'sent');
  }

  w.now = NOW + 3000;
  const fourth = await handleHouseholdInvite(w.deps(), request());

  assert.deepEqual(fourth, { inviteId: INVITE_ID, mail: 'held' });
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'held');
  assert.deepEqual(w.invites.get(INVITE_ID)?.createdAt, new Date(NOW + 3000));
  assert.equal(w.sent.length, 3);
});

void test('a revoke and re-invite still counts toward the recipient cap', async () => {
  const w = world();
  for (let i = 0; i < 3; i++) {
    await handleHouseholdInvite(w.deps(), request());
    w.invites.delete(INVITE_ID);
  }

  const again = await handleHouseholdInvite(w.deps(), request());

  assert.equal(again.mail, 'held');
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'held');
  assert.equal(w.sent.length, 3);
});

void test('the global mail budget reached holds the mail', async () => {
  const w = world();
  w.budget = { day: '2026-09-25', count: 100 };

  const result = await handleHouseholdInvite(w.deps(), request());

  assert.equal(result.mail, 'held');
  assert.ok(w.invites.has(INVITE_ID));
  assert.equal(w.sent.length, 0);
  // A mail that never went out is not charged to its recipient.
  assert.equal(w.quotas.get(SAM), undefined);
});

void test('with no verified inviter email the invite is written and not mailed', async () => {
  const w = world();
  const unverified = {
    uid: OWNER,
    token: { email: 'alex@example.com', email_verified: false, name: 'Alex' },
  };

  const result = await handleHouseholdInvite(w.deps(), request({}, unverified));

  assert.deepEqual(result, { inviteId: INVITE_ID, mail: 'failed' });
  assert.equal(w.invites.get(INVITE_ID)?.mail, 'failed');
  // The invitee is told the inviter's address is unverified rather than
  // shown one the provider never vouched for.
  assert.equal(w.invites.get(INVITE_ID)?.inviterEmail, null);
  assert.ok(!w.calls.includes('sendMail'));
  assert.ok(!w.calls.includes('chargeMail'));
  assert.equal(w.warnings.length, 1);
});

// --- charging and order ------------------------------------------------------------

void test('a lookup that misses charges only the inviter', async () => {
  const w = world();
  await assert.rejects(
    handleHouseholdInvite(w.deps(), request({ email: 'nobody@example.com' })),
    refusal('not-found', 'no-account')
  );
  assert.equal(w.quotas.get(OWNER)?.['count'], 1);
  assert.ok(!w.calls.includes('chargeMail'));
  assert.ok(!w.calls.includes('writeInvite'));
});

void test('a non-owner is refused before any quota or lookup', async () => {
  const w = world();
  const stranger = { uid: 'stranger', token: { email: 'x@example.com', email_verified: true } };
  await assert.rejects(
    handleHouseholdInvite(w.deps(), request({}, stranger)),
    refusal('permission-denied', 'not-owner')
  );
  assert.deepEqual(w.calls, ['getHousehold']);
});

void test('the own verified address is refused before any quota or lookup', async () => {
  const w = world();
  await assert.rejects(
    handleHouseholdInvite(w.deps(), request({ email: ' ALEX@example.com ' })),
    refusal('failed-precondition', 'self')
  );
  assert.deepEqual(w.calls, ['getHousehold']);
});

void test('the ninth seat is refused, but a refresh of a pending invitee at eight is not', async () => {
  const w = world();
  for (let i = 1; i <= 7; i++) {
    const uid = `pending-${i}`;
    w.accounts.set(`${uid}@example.com`, { uid, disabled: false });
    w.invites.set(`${HID}_${uid}`, pendingInvite(uid));
  }

  await assert.rejects(
    handleHouseholdInvite(w.deps(), request()),
    refusal('failed-precondition', 'full')
  );

  const refresh = await handleHouseholdInvite(
    w.deps(),
    request({ email: 'pending-1@example.com' })
  );
  assert.deepEqual(refresh, { inviteId: `${HID}_pending-1`, mail: 'sent' });
});

void test('a seat taken between the check and the write refuses full, and nothing is written or mailed', async () => {
  const w = world();
  for (let i = 1; i <= 6; i++) w.invites.set(`${HID}_pending-${i}`, pendingInvite(`pending-${i}`));
  // Seven seats taken at step 9; another invite takes the eighth before this write.
  w.beforeWrite = () => w.invites.set(`${HID}_late`, pendingInvite('late'));

  await assert.rejects(
    handleHouseholdInvite(w.deps(), request()),
    refusal('failed-precondition', 'full')
  );
  assert.equal(w.invites.has(INVITE_ID), false);
  assert.ok(!w.calls.includes('chargeMail'));
  assert.ok(!w.calls.includes('sendMail'));
});

// --- every refusal -------------------------------------------------------------------

void test('a refusal of the request itself reads nothing', async () => {
  const cases: Array<[string, InviteRequest, string]> = [
    ['signed out', request({}, null), 'signed-out'],
    ['email', request({ email: 'nope' }), 'email'],
    ['locale', request({ locale: 'fr' }), 'locale'],
    ['household id', request({ householdId: 'a/b' }), 'household'],
  ];
  for (const [label, req, reason] of cases) {
    const w = world();
    await assert.rejects(handleHouseholdInvite(w.deps(), req), error => {
      assert.ok(error instanceof HttpsError, label);
      assert.deepEqual(error.details, { reason }, label);
      return true;
    });
    assert.deepEqual(w.calls, [], label);
  }
});

void test('every refusal is an HttpsError carrying its reason, and writes nothing', async () => {
  const cases: Array<[string, (w: World) => InviteRequest, string, string]> = [
    ['signed out', () => request({}, null), 'unauthenticated', 'signed-out'],
    ['email', () => request({ email: 'nope' }), 'invalid-argument', 'email'],
    ['locale', () => request({ locale: 'fr' }), 'invalid-argument', 'locale'],
    ['household id', () => request({ householdId: 'a/b' }), 'invalid-argument', 'household'],
    ['unknown household', () => request({ householdId: 'gone' }), 'invalid-argument', 'household'],
    [
      'not the owner',
      () => request({}, { uid: 'stranger', token: {} }),
      'permission-denied',
      'not-owner',
    ],
    ['own address', () => request({ email: 'alex@example.com' }), 'failed-precondition', 'self'],
    [
      'quota',
      w => {
        w.quotas.set(OWNER, { windowStart: new Date(NOW), count: 10 });
        return request();
      },
      'resource-exhausted',
      'quota',
    ],
    ['no account', () => request({ email: 'nobody@example.com' }), 'not-found', 'no-account'],
    [
      'disabled account',
      w => {
        w.accounts.set('sam@example.com', { uid: SAM, disabled: true });
        return request();
      },
      'not-found',
      'no-account',
    ],
    [
      'own uid',
      w => {
        w.accounts.set('alias@example.com', { uid: OWNER, disabled: false });
        return request({ email: 'alias@example.com' });
      },
      'failed-precondition',
      'self',
    ],
    [
      'member',
      w => {
        w.members.get(HID)?.set(SAM, CREATED);
        w.pointers.set(SAM, HID);
        return request();
      },
      'already-exists',
      'member',
    ],
    [
      'full',
      w => {
        for (let i = 1; i <= 7; i++) w.members.get(HID)?.set(`member-${i}`, CREATED);
        return request();
      },
      'failed-precondition',
      'full',
    ],
    [
      'elsewhere',
      w => {
        w.households.set('other', { ownerId: 'someone', name: 'Theirs', createdAt: OLDER });
        w.members.set('other', new Map([[SAM, OLDER]]));
        w.pointers.set(SAM, 'other');
        return request();
      },
      'failed-precondition',
      'elsewhere',
    ],
  ];

  for (const [label, setup, code, reason] of cases) {
    const w = world();
    const req = setup(w);
    await assert.rejects(handleHouseholdInvite(w.deps(), req), refusal(code, reason), label);
    assert.ok(!w.calls.includes('writeInvite'), label);
    assert.ok(!w.calls.includes('sendMail'), label);
  }
});

// --- the real deadline -----------------------------------------------------------------

function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length;
}

void test('timerDeadline fires after its delay', async () => {
  const deadline = timerDeadline(5);
  await deadline.fired;
  deadline.clear();
});

void test('a cleared timerDeadline leaves no timer behind', () => {
  const before = activeTimeouts();
  const deadline = timerDeadline(60_000);
  assert.equal(activeTimeouts(), before + 1);
  deadline.clear();
  assert.equal(activeTimeouts(), before);
});
