import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Caller,
  DAY_MS,
  HouseholdRecord,
  IndexedMembership,
  InviteFacts,
  InvitePlan,
  MAX_HOUSEHOLDS_PER_ACCOUNT,
  MEMBERSHIP_READ_BOUND,
  MembershipIndex,
  PendingInvite,
  Stamp,
  callerOf,
  hasSeat,
  isHouseholdId,
  millisOf,
  nextInboundQuota,
  nextInviteQuota,
  nextMailBudget,
  nextMailCharge,
  normalizeInviteEmail,
  planInvite,
  sameStamp,
  stampOf,
} from './household-invite';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const HID = 'household1';
const OWNER = 'owner-uid';
const INVITEE = 'invitee-uid';
const CREATED: Stamp = { seconds: 1_790_000_000, nanoseconds: 123_456_000 };
const OLDER: Stamp = { seconds: 1_780_000_000, nanoseconds: 0 };

const caller: Caller = { uid: OWNER, email: 'alex@example.com', name: 'Alex' };
const household: HouseholdRecord = { ownerId: OWNER, name: 'Our home', createdAt: CREATED };

type Facts = Required<InviteFacts> & { data: Record<string, unknown> };

/** Every fact present and every step passing. */
function passing(): Facts {
  return {
    caller: { ...caller },
    data: { householdId: HID, email: 'Sam@Example.com', locale: 'ja' },
    now: NOW,
    household: { ...household },
    quotaAllowed: true,
    invitee: { uid: INVITEE, disabled: false },
    standing: { memberSince: null, memberships: listed([]), liveMembers: 1, invites: [] },
  };
}

function refuse(code: string, reason: string): InvitePlan {
  return { kind: 'refuse', refusal: { code, reason } } as InvitePlan;
}

/** An index entry whose membership is live: unended, and one generation throughout. */
function entry(householdId: string, overrides: Partial<IndexedMembership> = {}): IndexedMembership {
  return {
    householdId,
    since: CREATED,
    ended: false,
    memberSince: CREATED,
    householdCreatedAt: CREATED,
    ...overrides,
  };
}

/** Live memberships of `count` other households. */
function liveElsewhere(count: number): IndexedMembership[] {
  return Array.from({ length: count }, (_, i) => entry(`other-${i}`));
}

/** An index read whole unless `overflow` says more entries were left unread. */
function listed(entries: IndexedMembership[], overflow = false): MembershipIndex {
  return { entries, overflow };
}

function pendingFor(uid: string, overrides: Partial<PendingInvite> = {}): PendingInvite {
  return { inviteeUid: uid, expiresAt: NOW + DAY_MS, householdCreatedAt: CREATED, ...overrides };
}

// --- normalizeInviteEmail ---------------------------------------------------

void test('normalizeInviteEmail trims and lower-cases', () => {
  assert.equal(normalizeInviteEmail('  Sam@Example.COM '), 'sam@example.com');
});

void test('normalizeInviteEmail rejects what cannot be an address', () => {
  for (const value of [
    '',
    '   ',
    'no-at-sign',
    '@example.com',
    'sam@',
    'a@b@example.com',
    'sam @example.com',
    'sam\t@example.com',
    42,
    null,
    undefined,
    {},
  ]) {
    assert.equal(normalizeInviteEmail(value), null, JSON.stringify(value));
  }
});

void test('normalizeInviteEmail admits 254 characters and rejects 255', () => {
  const at254 = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;
  assert.equal(at254.length, 254);
  assert.equal(normalizeInviteEmail(at254), at254);
  assert.equal(normalizeInviteEmail(`  ${at254}  `), at254);
  assert.equal(normalizeInviteEmail(`a${at254}`), null);
});

// The address reaches a mail header; a line break anywhere is refused rather
// than trimmed away.
void test('normalizeInviteEmail rejects a carriage return or line feed anywhere', () => {
  for (const value of [
    'sam@example.com\r\nBcc: someone@example.com',
    'sam@exa\nmple.com',
    'sam@example.com\n',
    '\rsam@example.com',
  ]) {
    assert.equal(normalizeInviteEmail(value), null, JSON.stringify(value));
  }
});

// --- isHouseholdId -----------------------------------------------------------

void test('isHouseholdId admits a document id and nothing that could name a path', () => {
  for (const id of ['abc123', 'AbC-_9', 'x'.repeat(128)]) {
    assert.equal(isHouseholdId(id), true, id);
  }
  for (const id of ['', 'a/b', '.', '..', 'x'.repeat(129), '__x__', 'a b', 42, null, undefined]) {
    assert.equal(isHouseholdId(id), false, String(id));
  }
});

// --- stamps and times --------------------------------------------------------

void test('sameStamp compares a generation to the nanosecond', () => {
  assert.equal(sameStamp(CREATED, { ...CREATED }), true);
  assert.equal(
    sameStamp(CREATED, { seconds: CREATED.seconds, nanoseconds: CREATED.nanoseconds + 1000 }),
    false
  );
  assert.equal(sameStamp(CREATED, OLDER), false);
  assert.equal(sameStamp(CREATED, null), false);
  assert.equal(sameStamp(null, null), false);
});

void test('stampOf passes a Timestamp-shaped value through untouched and nothing else', () => {
  assert.equal(stampOf(CREATED), CREATED);
  for (const value of [
    '2026-09-25',
    123,
    { seconds: '1', nanoseconds: 0 },
    { seconds: 1 },
    null,
    undefined,
  ]) {
    assert.equal(stampOf(value), null, JSON.stringify(value));
  }
});

void test('millisOf reads a number, a Date and a stored Timestamp', () => {
  assert.equal(millisOf(NOW), NOW);
  assert.equal(millisOf(new Date(NOW)), NOW);
  assert.equal(millisOf({ toMillis: () => NOW }), NOW);
  for (const value of [Number.NaN, new Date(Number.NaN), '2026', null, undefined, {}]) {
    assert.equal(millisOf(value), null, String(value));
  }
});

// --- callerOf ------------------------------------------------------------------

void test('callerOf keeps the token email only when it is verified', () => {
  assert.equal(callerOf(undefined), null);
  assert.equal(callerOf(null), null);
  const verified = { email: 'Alex@Example.com', email_verified: true, name: 'Alex' };
  assert.deepEqual(callerOf({ uid: OWNER, token: verified }), {
    uid: OWNER,
    email: 'alex@example.com',
    name: 'Alex',
  });
  assert.deepEqual(
    callerOf({ uid: OWNER, token: { email: 'alex@example.com', email_verified: false } }),
    { uid: OWNER, email: null, name: '' }
  );
  assert.deepEqual(callerOf({ uid: OWNER, token: {} }), { uid: OWNER, email: null, name: '' });
});

void test('callerOf drops the invisible characters that could disguise a display name', () => {
  // Bidi overrides and isolates, zero-width characters, a BOM, a soft hyphen
  // and a C1 control: none is visible, and each can make one name read as
  // another where the invitee decides whether to join.
  const disguised = 'Mo\u202Em\u2066\u200B\u200D\uFEFF\u00AD\u0085\u2028 Lin\u061C\u200E';
  const found = callerOf({ uid: OWNER, token: { name: disguised } });
  assert.ok(found);
  assert.equal(found.name, 'Mom  Lin');
  assert.ok(!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(found.name));
});

void test('callerOf flattens and clamps the display name', () => {
  const found = callerOf({ uid: OWNER, token: { name: `Alex\r\nBcc ${'x'.repeat(200)}` } });
  assert.ok(found);
  assert.ok(!/[\r\n]/.test(found.name));
  assert.equal(found.name.length, 100);
});

// --- nextInviteQuota -------------------------------------------------------------

void test('nextInviteQuota opens a fresh window on the first lookup', () => {
  assert.deepEqual(nextInviteQuota(undefined, NOW), {
    allowed: true,
    next: { windowStart: new Date(NOW), count: 1 },
  });
});

void test('nextInviteQuota allows the tenth lookup in a window and refuses the eleventh', () => {
  let doc: Record<string, unknown> | undefined;
  for (let lookup = 1; lookup <= 10; lookup++) {
    const verdict = nextInviteQuota(doc, NOW + lookup * 1000);
    assert.equal(verdict.allowed, true, `lookup ${lookup}`);
    if (verdict.allowed) doc = { ...doc, ...verdict.next };
  }
  assert.deepEqual(doc, { windowStart: new Date(NOW + 1000), count: 10 });
  assert.deepEqual(nextInviteQuota(doc, NOW + 11_000), { allowed: false });
});

void test('nextInviteQuota opens a new window 24 h after the first lookup, not the last', () => {
  const doc = { windowStart: new Date(NOW), count: 10 };
  assert.deepEqual(nextInviteQuota(doc, NOW + DAY_MS - 1), { allowed: false });
  assert.deepEqual(nextInviteQuota(doc, NOW + DAY_MS), {
    allowed: true,
    next: { windowStart: new Date(NOW + DAY_MS), count: 1 },
  });
});

void test('nextInviteQuota reads a stored Timestamp', () => {
  const doc = { windowStart: { toMillis: () => NOW }, count: 10 };
  assert.deepEqual(nextInviteQuota(doc, NOW + 1), { allowed: false });
});

// --- nextInboundQuota -------------------------------------------------------------

void test('nextInboundQuota allows the third mail to one recipient and holds the fourth', () => {
  let doc: Record<string, unknown> | undefined;
  for (let mail = 1; mail <= 3; mail++) {
    const verdict = nextInboundQuota(doc, NOW + mail);
    assert.equal(verdict.allowed, true, `mail ${mail}`);
    if (verdict.allowed) doc = { ...doc, ...verdict.next };
  }
  assert.deepEqual(nextInboundQuota(doc, NOW + 4), { allowed: false });
  assert.deepEqual(nextInboundQuota(doc, NOW + 1 + DAY_MS), {
    allowed: true,
    next: { inboundWindowStart: new Date(NOW + 1 + DAY_MS), inbound: 1 },
  });
});

void test("one uid's inviter and inbound counters are independent", () => {
  const inviterSpent = { windowStart: new Date(NOW), count: 10 };
  assert.deepEqual(nextInboundQuota(inviterSpent, NOW + 1), {
    allowed: true,
    next: { inboundWindowStart: new Date(NOW + 1), inbound: 1 },
  });

  const inboundSpent = { inboundWindowStart: new Date(NOW), inbound: 3 };
  assert.deepEqual(nextInviteQuota(inboundSpent, NOW + 1), {
    allowed: true,
    next: { windowStart: new Date(NOW + 1), count: 1 },
  });
});

// --- nextMailBudget / nextMailCharge ---------------------------------------------

void test('nextMailBudget allows 100 mails a day, then holds', () => {
  assert.deepEqual(nextMailBudget(undefined, NOW), {
    allowed: true,
    next: { day: '2026-09-25', count: 1 },
  });
  assert.deepEqual(nextMailBudget({ day: '2026-09-25', count: 99 }, NOW), {
    allowed: true,
    next: { day: '2026-09-25', count: 100 },
  });
  assert.deepEqual(nextMailBudget({ day: '2026-09-25', count: 100 }, NOW), { allowed: false });
});

void test('nextMailBudget starts over on a new UTC day', () => {
  assert.deepEqual(nextMailBudget({ day: '2026-09-24', count: 100 }, NOW), {
    allowed: true,
    next: { day: '2026-09-25', count: 1 },
  });
});

void test('nextMailCharge charges both counters only when both allow', () => {
  assert.deepEqual(nextMailCharge(undefined, undefined, NOW), {
    send: true,
    recipient: { inboundWindowStart: new Date(NOW), inbound: 1 },
    budget: { day: '2026-09-25', count: 1 },
  });
  assert.deepEqual(
    nextMailCharge({ inboundWindowStart: new Date(NOW), inbound: 3 }, undefined, NOW),
    { send: false }
  );
  assert.deepEqual(nextMailCharge(undefined, { day: '2026-09-25', count: 100 }, NOW), {
    send: false,
  });
});

// --- planInvite: the ten steps ------------------------------------------------------

interface Step {
  label: string;
  code: string;
  reason: string;
  breakIt(facts: Facts): void;
}

const steps: Step[] = [
  {
    label: '1 signed out',
    code: 'unauthenticated',
    reason: 'signed-out',
    breakIt: f => { f.caller = null; },
  },
  {
    label: '2 malformed email',
    code: 'invalid-argument',
    reason: 'email',
    breakIt: f => { f.data['email'] = 'not-an-address'; },
  },
  {
    label: '2 unsupported locale',
    code: 'invalid-argument',
    reason: 'locale',
    breakIt: f => { f.data['locale'] = 'fr'; },
  },
  {
    label: '2 malformed household',
    code: 'invalid-argument',
    reason: 'household',
    breakIt: f => { f.data['householdId'] = 'a/b'; },
  },
  {
    label: '2 unknown household',
    code: 'invalid-argument',
    reason: 'household',
    breakIt: f => { f.household = null; },
  },
  {
    label: '3 not the owner',
    code: 'permission-denied',
    reason: 'not-owner',
    breakIt: f => { f.household = { ...household, ownerId: 'someone-else' }; },
  },
  {
    label: '4 own verified address',
    code: 'failed-precondition',
    reason: 'self',
    breakIt: f => { f.data['email'] = ' ALEX@example.com'; },
  },
  {
    label: '5 inviter quota spent',
    code: 'resource-exhausted',
    reason: 'quota',
    breakIt: f => { f.quotaAllowed = false; },
  },
  {
    label: '6 no account',
    code: 'not-found',
    reason: 'no-account',
    breakIt: f => { f.invitee = null; },
  },
  {
    label: '7 own uid',
    code: 'failed-precondition',
    reason: 'self',
    breakIt: f => { f.invitee = { uid: OWNER, disabled: false }; },
  },
  {
    label: '8 already a member',
    code: 'already-exists',
    reason: 'member',
    breakIt: f => { f.standing = { ...f.standing, memberSince: CREATED }; },
  },
  {
    label: '9 household full',
    code: 'failed-precondition',
    reason: 'full',
    breakIt: f => { f.standing = { ...f.standing, liveMembers: 8 }; },
  },
  {
    label: '10 at the most households one account can hold',
    code: 'failed-precondition',
    reason: 'too-many',
    breakIt: f => {
      f.standing = { ...f.standing, memberships: listed(liveElsewhere(MAX_HOUSEHOLDS_PER_ACCOUNT)) };
    },
  },
];

// Step k is broken together with every later step it can coexist with. The
// breakers are applied from the last to k, so step k's own break is applied
// last and wins wherever two steps touch the same fact.
void test('planInvite refuses at the first failing step, in order', () => {
  for (let k = 0; k < steps.length; k++) {
    const facts = passing();
    for (let j = steps.length - 1; j >= k; j--) steps[j].breakIt(facts);
    assert.deepEqual(planInvite(facts), refuse(steps[k].code, steps[k].reason), steps[k].label);
  }
});

void test('planInvite names the target once every step has passed', () => {
  assert.deepEqual(planInvite(passing()), {
    kind: 'invite',
    target: {
      caller,
      householdId: HID,
      household,
      email: 'sam@example.com',
      locale: 'ja',
      inviteeUid: INVITEE,
    },
  });
});

void test('planInvite asks for each fact only once every earlier step has passed', () => {
  const base: InviteFacts = {
    caller,
    data: { householdId: HID, email: 'Sam@Example.com', locale: 'tc' },
    now: NOW,
  };
  assert.deepEqual(planInvite(base), {
    kind: 'need',
    need: { fact: 'household', householdId: HID },
  });
  assert.deepEqual(planInvite({ ...base, household }), {
    kind: 'need',
    need: { fact: 'quota', inviterUid: OWNER },
  });
  assert.deepEqual(planInvite({ ...base, household, quotaAllowed: true }), {
    kind: 'need',
    need: { fact: 'invitee', email: 'sam@example.com' },
  });
  const invitee = { uid: INVITEE, disabled: false };
  assert.deepEqual(planInvite({ ...base, household, quotaAllowed: true, invitee }), {
    kind: 'need',
    need: { fact: 'standing', householdId: HID, inviteeUid: INVITEE, household },
  });
});

// The refusals that need no lookup never wait for one.
void test('a non-owner and the own address are refused before the quota is asked for', () => {
  const base: InviteFacts = {
    caller,
    data: { householdId: HID, email: 'sam@example.com', locale: 'en' },
    now: NOW,
  };
  assert.deepEqual(
    planInvite({ ...base, household: { ...household, ownerId: 'someone-else' } }),
    refuse('permission-denied', 'not-owner')
  );
  assert.deepEqual(
    planInvite({
      ...base,
      data: { householdId: HID, email: 'alex@example.com', locale: 'en' },
      household,
    }),
    refuse('failed-precondition', 'self')
  );
});

// The id reaches a document path, so it is checked before the household is
// asked for; the unknown-household refusal must not be what catches it.
void test('a malformed household id is refused before the household is asked for', () => {
  for (const householdId of ['a/b', '..', '__x__', '', 42, null]) {
    assert.deepEqual(
      planInvite({
        caller,
        data: { householdId, email: 'sam@example.com', locale: 'en' },
        now: NOW,
      }),
      refuse('invalid-argument', 'household'),
      String(householdId)
    );
  }
});

void test('a request body that is not an object is a malformed email', () => {
  for (const data of [null, undefined, 'sam@example.com', 42]) {
    assert.deepEqual(planInvite({ ...passing(), data }), refuse('invalid-argument', 'email'));
  }
});

// Without a verified token email, step 4 cannot fire; the uid check at step 7
// is what refuses an invite to oneself.
void test('an unverified token email never refuses by address', () => {
  const unverified: InviteFacts = {
    caller: { ...caller, email: null },
    data: { householdId: HID, email: 'alex@example.com', locale: 'en' },
    now: NOW,
    household,
  };
  assert.deepEqual(planInvite(unverified), {
    kind: 'need',
    need: { fact: 'quota', inviterUid: OWNER },
  });
  assert.deepEqual(
    planInvite({ ...unverified, quotaAllowed: true, invitee: { uid: OWNER, disabled: false } }),
    refuse('failed-precondition', 'self')
  );
});

void test('a disabled account is no account', () => {
  const facts = passing();
  facts.invitee = { uid: INVITEE, disabled: true };
  assert.deepEqual(planInvite(facts), refuse('not-found', 'no-account'));
});

void test("full counts live members and pending invites, but not the invitee's own", () => {
  const others = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(uid => pendingFor(uid));
  const facts = passing();
  facts.standing = { ...facts.standing, liveMembers: 1, invites: others };
  assert.deepEqual(planInvite(facts), refuse('failed-precondition', 'full'));

  // A refresh of a pending invitee at eight takes no new seat.
  facts.standing = {
    ...facts.standing,
    liveMembers: 1,
    invites: [...others.slice(0, 6), pendingFor(INVITEE)],
  };
  assert.equal(planInvite(facts).kind, 'invite');
});

void test('full ignores expired invites and invites from an older generation', () => {
  const facts = passing();
  facts.standing = {
    ...facts.standing,
    liveMembers: 1,
    invites: [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(uid => pendingFor(uid)),
      pendingFor('expired', { expiresAt: NOW }),
      pendingFor('older', { householdCreatedAt: OLDER }),
      pendingFor('unstamped', { householdCreatedAt: null }),
    ],
  };
  assert.equal(planInvite(facts).kind, 'invite');
});

// The rule step 9 applies, and the one the invite write applies again inside
// its transaction.
void test("hasSeat counts live members and live pending invites, but not the invitee's own", () => {
  const invite = { inviteeUid: INVITEE, generation: CREATED, now: NOW };
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(uid => pendingFor(uid));

  assert.equal(hasSeat({ liveMembers: 7, invites: [] }, invite), true);
  assert.equal(hasSeat({ liveMembers: 8, invites: [] }, invite), false);
  assert.equal(hasSeat({ liveMembers: 1, invites: six }, invite), true);
  assert.equal(hasSeat({ liveMembers: 1, invites: [...six, pendingFor('g')] }, invite), false);
  assert.equal(hasSeat({ liveMembers: 1, invites: [...six, pendingFor(INVITEE)] }, invite), true);
  assert.equal(
    hasSeat(
      {
        liveMembers: 1,
        invites: [
          ...six,
          pendingFor('expired', { expiresAt: NOW }),
          pendingFor('older', { householdCreatedAt: OLDER }),
          pendingFor('unstamped', { householdCreatedAt: null }),
        ],
      },
      invite
    ),
    true
  );
});

// Step 8 asks the member document of this household itself; the invitee's
// index is not what says whether they are in it.
void test('member is the invitee\'s member document here, of this generation', () => {
  const facts = passing();
  facts.standing = { ...facts.standing, memberSince: CREATED };
  assert.deepEqual(planInvite(facts), refuse('already-exists', 'member'));

  for (const memberSince of [
    // No member document: never joined, left, or removed.
    null,
    // A leftover from an earlier household under the same id.
    OLDER,
    { seconds: CREATED.seconds, nanoseconds: CREATED.nanoseconds + 1000 },
  ]) {
    const again = passing();
    again.standing = { ...again.standing, memberSince };
    assert.equal(planInvite(again).kind, 'invite', JSON.stringify(memberSince));
  }

  // An index entry naming this household is not a membership of it.
  const indexed = passing();
  indexed.standing = { ...indexed.standing, memberships: listed([entry(HID)]) };
  assert.equal(planInvite(indexed).kind, 'invite');
});

void test('too-many refuses at ten live memberships and admits nine', () => {
  assert.equal(MAX_HOUSEHOLDS_PER_ACCOUNT, 10);

  const nine = passing();
  nine.standing = { ...nine.standing, memberships: listed(liveElsewhere(9)) };
  assert.equal(planInvite(nine).kind, 'invite');

  for (const count of [10, 11]) {
    const facts = passing();
    facts.standing = { ...facts.standing, memberships: listed(liveElsewhere(count)) };
    assert.deepEqual(planInvite(facts), refuse('failed-precondition', 'too-many'), String(count));
  }
});

// Only the invitee's own client writes its index, so an entry is counted only
// once the server's member document and household agree it is live.
void test('an index entry counts only while its membership is live', () => {
  const dead: Array<[string, IndexedMembership]> = [
    ['ended', entry('x', { ended: true })],
    ['member document gone', entry('x', { memberSince: null })],
    ['household gone', entry('x', { householdCreatedAt: null })],
    // Dissolved and formed again under the same id: an older generation.
    ['dead generation', entry('x', { since: OLDER, memberSince: OLDER })],
    // The entry outlived one membership and names a later one's document.
    ['entry and member document disagree', entry('x', { since: OLDER })],
    ['entry stamp unreadable', entry('x', { since: null })],
  ];
  for (const [label, stale] of dead) {
    const facts = passing();
    facts.standing = { ...facts.standing, memberships: listed([...liveElsewhere(9), stale]) };
    assert.equal(planInvite(facts).kind, 'invite', label);
  }

  const facts = passing();
  facts.standing = { ...facts.standing, memberships: listed([...liveElsewhere(9), entry('x')]) };
  assert.deepEqual(planInvite(facts), refuse('failed-precondition', 'too-many'));
});

// Joining writes this household's entry again, so it is never one more; a
// live membership of it is step 8's to refuse.
void test('this household\'s own index entry is not counted toward too-many', () => {
  const facts = passing();
  facts.standing = { ...facts.standing, memberships: listed([...liveElsewhere(9), entry(HID)]) };
  assert.equal(planInvite(facts).kind, 'invite');
});

// The callable stops reading an index at the bound, so one longer than that
// cannot be shown to hold fewer than the most; the steps before it still
// answer first.
void test('an index longer than the read bound is too-many, after member and full', () => {
  assert.ok(MEMBERSHIP_READ_BOUND > MAX_HOUSEHOLDS_PER_ACCOUNT);
  const unread = listed([], true);

  const facts = passing();
  facts.standing = { ...facts.standing, memberships: unread };
  assert.deepEqual(planInvite(facts), refuse('failed-precondition', 'too-many'));

  const member = passing();
  member.standing = { ...member.standing, memberships: unread, memberSince: CREATED };
  assert.deepEqual(planInvite(member), refuse('already-exists', 'member'));

  const full = passing();
  full.standing = { ...full.standing, memberships: unread, liveMembers: 8 };
  assert.deepEqual(planInvite(full), refuse('failed-precondition', 'full'));
});
