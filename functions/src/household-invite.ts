/**
 * The decisions behind inviting someone to a household, kept apart from the
 * callable that acts on them: this module has no imports and no I/O, so the
 * ten-step refusal order, the generation checks and every cap are pinned by
 * unit tests while the handler (./household-invite-handler) and the wiring
 * (./index) stay thin around them — the same split as ./receipt-quota.
 *
 * Firestore values reach this module structurally: a Timestamp is anything
 * with numeric seconds and nanoseconds, and a stored time anything with a
 * toMillis(). The Admin SDK's own types are assignable to both.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an invite admits its invitee. */
export const INVITE_TTL_MS = 7 * DAY_MS;

/**
 * Lookups one inviter may make per window. Misses count too: the refusals are
 * said plainly ("no account uses that address"), so the cap is what bounds
 * the lookup as an oracle for which addresses hold an account.
 */
export const INVITER_LOOKUPS_PER_WINDOW = 10;

/**
 * Invite mails one recipient may receive per window, from every household
 * together. Past it the invite is still written and only the mail is held:
 * refusing the invite instead would let junk invites lock a person out.
 */
export const INBOUND_MAILS_PER_WINDOW = 3;

/**
 * Invite mails per UTC day, all households together. Invites share the
 * operator's sender with feedback mail, and a suspended sender would silence
 * both.
 */
export const DAILY_MAIL_BUDGET = 100;

/** Members plus pending invites; the callable refuses the ninth seat. */
export const MAX_HOUSEHOLD_MEMBERS = 8;

/** The longest address SMTP can carry (RFC 5321 path limit less the brackets). */
export const MAX_EMAIL_LENGTH = 254;

/** Stored display names are capped at 100 by the rules on member docs. */
const MAX_NAME_LENGTH = 100;

/** The app's languages; the invite mail is written in the inviter's. */
export const INVITE_LOCALES = ['en', 'ja', 'tc'] as const;
export type InviteLocale = (typeof INVITE_LOCALES)[number];

export type InviteMail = 'sent' | 'failed' | 'held';

/** A Firestore Timestamp, read structurally. */
export interface Stamp {
  readonly seconds: number;
  readonly nanoseconds: number;
}

/** A stored quota or budget document, as Firestore hands it over. */
export type StoredDoc = Readonly<Record<string, unknown>> | undefined;

// --- values ------------------------------------------------------------------

/**
 * The address as the lookup and the mail will use it, or null when it cannot
 * be one. A line break anywhere is refused rather than trimmed: the value ends
 * up in a mail header, and an input that carries one was not typed into an
 * address field.
 */
export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  // No whitespace or control characters inside, exactly one @, and something
  // on both sides of it: the shape the Admin SDK's own validator accepts, so
  // a malformed address is refused here rather than thrown by the lookup.
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return email;
}

/**
 * A household id the callable will put into a document path. Anything with a
 * separator, a dot-segment or Firestore's reserved __name__ form would address
 * some other document, so it is refused as malformed.
 */
export function isHouseholdId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value)
  );
}

function isLocale(value: unknown): value is InviteLocale {
  return typeof value === 'string' && (INVITE_LOCALES as readonly string[]).includes(value);
}

/**
 * The value itself when it is Timestamp-shaped, so a real Timestamp passes
 * through untouched and can be written back exactly; null otherwise.
 */
export function stampOf(value: unknown): Stamp | null {
  if (!value || typeof value !== 'object') return null;
  const { seconds, nanoseconds } = value as { seconds?: unknown; nanoseconds?: unknown };
  return typeof seconds === 'number' && typeof nanoseconds === 'number' ? (value as Stamp) : null;
}

/**
 * Whether two stamps name the same household generation. Exact to the
 * nanosecond, as the rules compare them: `createdAt` is the request time of
 * the create, so a re-created household under the same id never matches.
 */
export function sameStamp(a: Stamp | null, b: Stamp | null): boolean {
  return a !== null && b !== null && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}

/** Epoch milliseconds from a number, a Date or a stored Timestamp. */
export function millisOf(value: unknown): number | null {
  let millis: unknown = null;
  if (typeof value === 'number') millis = value;
  else if (value instanceof Date) millis = value.getTime();
  else if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis: unknown }).toMillis;
    if (typeof toMillis === 'function') millis = toMillis.call(value);
  }
  return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
}

// --- the caller --------------------------------------------------------------

/** The claims of a decoded ID token this module reads. */
export interface CallerToken {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

export interface Caller {
  uid: string;
  /** The token's email, normalised, only when the provider verified it. */
  email: string | null;
  /**
   * Shown in-app to the invitee; never mailed. Empty when the token has none.
   * Self-asserted: the inviter picks it, so the invitee is shown `email`
   * beside it.
   */
  name: string;
}

/**
 * Format characters (bidi overrides and isolates, zero-width characters, the
 * BOM, the soft hyphen) are invisible and can make one name read as another,
 * so they go; that also splits an emoji joined by a zero-width joiner into its
 * parts. Control characters and line breaks become a space.
 */
const INVISIBLE = /\p{Cf}+/gu;
const BREAKING = /[\p{Cc}\u2028\u2029]+/gu;

export function callerOf(
  auth: { uid: string; token: CallerToken } | null | undefined
): Caller | null {
  if (!auth) return null;
  const { email, email_verified: verified, name } = auth.token;
  return {
    uid: auth.uid,
    email: verified === true ? normalizeInviteEmail(email) : null,
    name:
      typeof name === 'string'
        ? name
            .replace(INVISIBLE, '')
            .replace(BREAKING, ' ')
            .trim()
            .slice(0, MAX_NAME_LENGTH)
        : '',
  };
}

// --- quotas ------------------------------------------------------------------

export type QuotaVerdict<T> = { allowed: true; next: T } | { allowed: false };

export interface InviterQuota {
  windowStart: Date;
  count: number;
}

export interface InboundQuota {
  inboundWindowStart: Date;
  inbound: number;
}

export interface MailBudget {
  /** The UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
}

/**
 * One step of a fixed window that opens on the first event and runs 24 h from
 * it. A missing or unreadable stored window opens a fresh one: only the
 * callable writes these documents, so an unreadable one is a first use.
 */
function nextWindow(
  start: unknown,
  count: unknown,
  limit: number,
  now: number
): QuotaVerdict<{ start: Date; count: number }> {
  const startMillis = millisOf(start);
  const current = typeof count === 'number' && Number.isInteger(count) ? count : null;
  if (startMillis === null || current === null || now >= startMillis + DAY_MS) {
    return { allowed: true, next: { start: new Date(now), count: 1 } };
  }
  if (current >= limit) return { allowed: false };
  return { allowed: true, next: { start: new Date(startMillis), count: current + 1 } };
}

/**
 * The inviter's lookup quota, charged before the lookup so a miss counts. It
 * lives on `inviteQuotas/{inviterUid}` beside the inbound counter and touches
 * only its own two fields: keyed by uid, it survives dissolving a household.
 */
export function nextInviteQuota(doc: StoredDoc, now: number): QuotaVerdict<InviterQuota> {
  const verdict = nextWindow(
    doc?.['windowStart'],
    doc?.['count'],
    INVITER_LOOKUPS_PER_WINDOW,
    now
  );
  return verdict.allowed
    ? { allowed: true, next: { windowStart: verdict.next.start, count: verdict.next.count } }
    : verdict;
}

/** The recipient's inbound mail counter on the same document, independent of the above. */
export function nextInboundQuota(doc: StoredDoc, now: number): QuotaVerdict<InboundQuota> {
  const verdict = nextWindow(
    doc?.['inboundWindowStart'],
    doc?.['inbound'],
    INBOUND_MAILS_PER_WINDOW,
    now
  );
  return verdict.allowed
    ? {
        allowed: true,
        next: { inboundWindowStart: verdict.next.start, inbound: verdict.next.count },
      }
    : verdict;
}

/** The global daily budget; a new UTC day starts over. */
export function nextMailBudget(doc: StoredDoc, now: number): QuotaVerdict<MailBudget> {
  const day = new Date(now).toISOString().slice(0, 10);
  const count = doc?.['count'];
  if (doc?.['day'] !== day || typeof count !== 'number' || !Number.isInteger(count)) {
    return { allowed: true, next: { day, count: 1 } };
  }
  if (count >= DAILY_MAIL_BUDGET) return { allowed: false };
  return { allowed: true, next: { day, count: count + 1 } };
}

export type MailCharge =
  | { send: true; recipient: InboundQuota; budget: MailBudget }
  | { send: false };

/**
 * Both counters or neither: a mail held by one cap must not spend the other,
 * or a recipient at their cap would drain the global budget for nothing.
 */
export function nextMailCharge(
  recipientDoc: StoredDoc,
  budgetDoc: StoredDoc,
  now: number
): MailCharge {
  const recipient = nextInboundQuota(recipientDoc, now);
  const budget = nextMailBudget(budgetDoc, now);
  if (!recipient.allowed || !budget.allowed) return { send: false };
  return { send: true, recipient: recipient.next, budget: budget.next };
}

// --- the ten steps -----------------------------------------------------------

export interface HouseholdRecord {
  ownerId: string;
  name: string;
  /** The generation stamp: the request time of the household's create. */
  createdAt: Stamp;
}

export interface InviteeAccount {
  uid: string;
  disabled: boolean;
}

/**
 * Where the invitee's profile pointer leads, read raw. The pointer alone is
 * never trusted — a client writes its own profile — so a membership is live
 * only when the member doc exists and carries the household's current
 * generation.
 */
export interface MembershipRecord {
  householdId: string;
  /** The member doc's `since`; null when the doc is gone. */
  since: Stamp | null;
  /** The household's `createdAt`; null when the household is gone. */
  householdCreatedAt: Stamp | null;
}

export interface PendingInvite {
  inviteeUid: string;
  expiresAt: number;
  householdCreatedAt: Stamp | null;
}

/** What a household's seats are counted from. */
export interface SeatCount {
  /** Member docs of this household carrying its current generation. */
  liveMembers: number;
  /** Every invite doc naming this household, live or not. */
  invites: readonly PendingInvite[];
}

/** The invite a seat is wanted for. */
export interface SeatRequest {
  inviteeUid: string;
  /** The household's createdAt: only invites of this generation hold a seat. */
  generation: Stamp;
  now: number;
}

/**
 * Whether the household has a seat for this invite: live members plus the
 * other invites that still admit someone, against the cap. The invitee's own
 * pending invite is excluded, so a refresh never takes a second seat; an
 * expired invite, or one from an earlier generation of this id, admits no one
 * and holds no seat. Step 9 asks this, and the invite write asks it again
 * inside its transaction, where two invites cannot both take the last seat.
 */
export function hasSeat(count: SeatCount, request: SeatRequest): boolean {
  const pending = count.invites.filter(
    invite =>
      invite.inviteeUid !== request.inviteeUid &&
      invite.expiresAt > request.now &&
      sameStamp(invite.householdCreatedAt, request.generation)
  ).length;
  return count.liveMembers + pending < MAX_HOUSEHOLD_MEMBERS;
}

export interface InviteeStanding extends SeatCount {
  membership: MembershipRecord | null;
}

/**
 * What is known so far. A fact left undefined has not been fetched; the plan
 * says which one to fetch next, so no lookup runs before the steps that must
 * precede it.
 */
export interface InviteFacts {
  caller: Caller | null;
  /** The callable's raw request body. */
  data: unknown;
  now: number;
  household?: HouseholdRecord | null;
  /** The result of charging the inviter's quota. */
  quotaAllowed?: boolean;
  invitee?: InviteeAccount | null;
  standing?: InviteeStanding;
}

export type RefusalCode =
  | 'unauthenticated'
  | 'invalid-argument'
  | 'permission-denied'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'not-found'
  | 'already-exists';

/** The client maps these, never the code: a reason-less error is not a business answer. */
export type RefusalReason =
  | 'signed-out'
  | 'email'
  | 'locale'
  | 'household'
  | 'not-owner'
  | 'self'
  | 'quota'
  | 'no-account'
  | 'member'
  | 'full'
  | 'elsewhere';

export interface Refusal {
  code: RefusalCode;
  reason: RefusalReason;
}

export type InviteNeed =
  | { fact: 'household'; householdId: string }
  | { fact: 'quota'; inviterUid: string }
  | { fact: 'invitee'; email: string }
  | { fact: 'standing'; householdId: string; inviteeUid: string; household: HouseholdRecord };

export interface InviteTarget {
  caller: Caller;
  householdId: string;
  household: HouseholdRecord;
  email: string;
  locale: InviteLocale;
  inviteeUid: string;
}

export type InvitePlan =
  | { kind: 'refuse'; refusal: Refusal }
  | { kind: 'need'; need: InviteNeed }
  | { kind: 'invite'; target: InviteTarget };

function refuse(code: RefusalCode, reason: RefusalReason): InvitePlan {
  return { kind: 'refuse', refusal: { code, reason } };
}

function need(fact: InviteNeed): InvitePlan {
  return { kind: 'need', need: fact };
}

function isLive(membership: MembershipRecord): boolean {
  return sameStamp(membership.since, membership.householdCreatedAt);
}

/**
 * The next thing to do for an invite: refuse it, fetch one more fact, or write
 * it. The steps run in a fixed order, and a step whose facts are missing asks
 * for them before any later step is considered:
 *
 *  1. signed out;
 *  2. a malformed email, an unsupported locale, a malformed or unknown household;
 *  3. not the household's owner;
 *  4. the caller's own verified address;
 *  5. the inviter's quota (charged before the lookup, so misses count);
 *  6. no account, or a disabled one, uses the address;
 *  7. the account is the caller's own (covers a token with no email);
 *  8. already a live member of this household;
 *  9. members plus other pending invites fill every seat (asked again at the write);
 * 10. a live member of another household.
 */
export function planInvite(facts: InviteFacts): InvitePlan {
  const { caller } = facts;
  if (!caller) return refuse('unauthenticated', 'signed-out');

  const data =
    facts.data !== null && typeof facts.data === 'object'
      ? (facts.data as Record<string, unknown>)
      : {};
  const email = normalizeInviteEmail(data['email']);
  if (!email) return refuse('invalid-argument', 'email');
  const locale = data['locale'];
  if (!isLocale(locale)) return refuse('invalid-argument', 'locale');
  const householdId = data['householdId'];
  if (!isHouseholdId(householdId)) return refuse('invalid-argument', 'household');

  const { household } = facts;
  if (household === undefined) return need({ fact: 'household', householdId });
  if (household === null) return refuse('invalid-argument', 'household');

  if (household.ownerId !== caller.uid) return refuse('permission-denied', 'not-owner');
  if (caller.email !== null && caller.email === email) return refuse('failed-precondition', 'self');

  if (facts.quotaAllowed === undefined) return need({ fact: 'quota', inviterUid: caller.uid });
  if (!facts.quotaAllowed) return refuse('resource-exhausted', 'quota');

  const { invitee } = facts;
  if (invitee === undefined) return need({ fact: 'invitee', email });
  if (invitee === null || invitee.disabled) return refuse('not-found', 'no-account');
  if (invitee.uid === caller.uid) return refuse('failed-precondition', 'self');

  const { standing } = facts;
  if (standing === undefined) {
    return need({ fact: 'standing', householdId, inviteeUid: invitee.uid, household });
  }

  const membership =
    standing.membership !== null && isLive(standing.membership) ? standing.membership : null;
  if (membership?.householdId === householdId) return refuse('already-exists', 'member');

  const seat = { inviteeUid: invitee.uid, generation: household.createdAt, now: facts.now };
  if (!hasSeat(standing, seat)) return refuse('failed-precondition', 'full');

  if (membership !== null) return refuse('failed-precondition', 'elsewhere');

  return {
    kind: 'invite',
    target: { caller, householdId, household, email, locale, inviteeUid: invitee.uid },
  };
}
