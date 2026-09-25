import { HttpsError } from 'firebase-functions/https';

import { composeHouseholdInviteEmail } from './compose-household-invite-email';
import type { OutgoingMail } from './mailer';
import {
  CallerToken,
  HouseholdRecord,
  INVITE_TTL_MS,
  InviteFacts,
  InviteLocale,
  InviteMail,
  InviteNeed,
  InviteTarget,
  InviteeAccount,
  MembershipRecord,
  PendingInvite,
  Refusal,
  Stamp,
  callerOf,
  planInvite,
} from './household-invite';

/**
 * The callable's body, with every read, write, clock and timer injected, so
 * a unit test drives each branch over fakes. The Admin SDK deps are
 * ./household-invite-admin-deps, and index.ts only wires them in. The
 * decisions themselves live in ./household-invite.
 */

/**
 * How long the handler waits on the mail before answering. It is the handler's
 * own bound, not the transport's: nodemailer's timeouts are per phase, not a
 * total, and a fake transport has none at all.
 */
export const INVITE_MAIL_DEADLINE_MS = 10_000;

/** A timer the handler races the mail against; cleared once either settles. */
export interface Deadline {
  fired: Promise<void>;
  clear(): void;
}

/**
 * The transport's mail without its sender, which index.ts supplies. A type-only
 * import: nodemailer never loads under the handler's tests.
 */
export type InviteMailMessage = Omit<OutgoingMail, 'from'>;

/** The gRPC status an Admin SDK update() rejects with when its document is gone. */
const FIRESTORE_NOT_FOUND = 5;

/**
 * `householdInvites/{householdId}_{inviteeUid}`. Written only here: the rules
 * refuse every client create and update, so each field is as trustworthy as
 * this function. The times are Dates, which the Admin SDK stores as
 * Timestamps the rules can compare against request.time.
 */
export interface HouseholdInviteRecord {
  householdId: string;
  /** The household's own createdAt, untouched: the generation a join is admitted to. */
  householdCreatedAt: Stamp;
  householdName: string;
  inviterUid: string;
  /** The inviter's own sign-in name, self-asserted. */
  inviterName: string;
  /**
   * The inviter's sign-in address, as their provider verified it; null when
   * it did not. The invitee is shown it beside inviterName before joining,
   * so the only identity they decide on is not one the inviter typed.
   */
  inviterEmail: string | null;
  inviteeUid: string;
  inviteeEmail: string;
  locale: InviteLocale;
  createdAt: Date;
  expiresAt: Date;
  /**
   * Provisional while the call is in flight: written as `failed` before the
   * mail is charged and sent, and corrected to `sent` or `held` once the send
   * settles, which INVITE_MAIL_DEADLINE_MS bounds (plus the charge and the
   * update). A reader showing mail status treats a `failed` younger than that
   * as still sending.
   */
  mail: InviteMail;
}

export interface InviteLog {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface HouseholdInviteDeps {
  now(): number;
  getHousehold(householdId: string): Promise<HouseholdRecord | null>;
  /** Charges one lookup to the inviter in a transaction; false when the window is spent. */
  bumpInviterQuota(inviterUid: string, now: number): Promise<boolean>;
  /** null when no account uses the address. */
  getUserByEmail(email: string): Promise<InviteeAccount | null>;
  /** Where the uid's profile pointer leads, raw; null when it has none. */
  membershipOf(uid: string): Promise<MembershipRecord | null>;
  /** Member docs of the household carrying the given generation. */
  countMembers(householdId: string, createdAt: Stamp): Promise<number>;
  pendingInvites(householdId: string): Promise<PendingInvite[]>;
  /** Charges the recipient's inbound counter and the global budget as one; false holds the mail. */
  chargeMail(inviteeUid: string, now: number): Promise<boolean>;
  /**
   * A full write (a refresh replaces every field), made only while the
   * household still has a seat for it: hasSeat is asked again, atomically with
   * the write, from the invite's own householdId, householdCreatedAt,
   * inviteeUid and createdAt. False, with nothing written, when the seat went
   * to a concurrent invite after step 9.
   */
  writeInvite(inviteId: string, invite: HouseholdInviteRecord): Promise<boolean>;
  /** An update of the mail field only, so an invite consumed meanwhile is never recreated. */
  recordMail(inviteId: string, mail: InviteMail): Promise<void>;
  sendMail(mail: InviteMailMessage): Promise<void>;
  deadline(ms: number): Deadline;
  log: InviteLog;
}

/** The part of a CallableRequest the handler reads. */
export interface InviteRequest {
  auth?: { uid: string; token: CallerToken } | null;
  data: unknown;
}

export interface InviteResult {
  inviteId: string;
  mail: InviteMail;
}

/** The client maps `details.reason`, never the code or the message. */
function refusalError({ code, reason }: Refusal): HttpsError {
  return new HttpsError(code, `household invite refused: ${reason}`, { reason });
}

/** The production deadline. Nothing else holds the timer, so clearing it releases it. */
export function timerDeadline(ms: number): Deadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = new Promise<void>(resolve => {
    timer = setTimeout(resolve, ms);
  });
  return { fired, clear: () => clearTimeout(timer) };
}

async function gather(
  deps: HouseholdInviteDeps,
  facts: InviteFacts,
  need: InviteNeed
): Promise<void> {
  switch (need.fact) {
    case 'household':
      facts.household = await deps.getHousehold(need.householdId);
      return;
    case 'quota':
      facts.quotaAllowed = await deps.bumpInviterQuota(need.inviterUid, facts.now);
      return;
    case 'invitee':
      facts.invitee = await deps.getUserByEmail(need.email);
      return;
    case 'standing': {
      const [membership, liveMembers, invites] = await Promise.all([
        deps.membershipOf(need.inviteeUid),
        deps.countMembers(need.householdId, need.household.createdAt),
        deps.pendingInvites(need.householdId),
      ]);
      facts.standing = { membership, liveMembers, invites };
      return;
    }
  }
}

/**
 * Sends the invite mail if the caps allow, and says what became of it. A mail
 * failure never fails the invite: the invite is already written and shown
 * in-app, so every failure here is logged and reported as `failed`.
 */
async function deliver(
  deps: HouseholdInviteDeps,
  target: InviteTarget,
  inviteId: string,
  expiresAt: Date,
  now: number
): Promise<InviteMail> {
  const inviterEmail = target.caller.email;
  if (inviterEmail === null) {
    // The mail names the inviter by their verified address and nothing else;
    // without one there is nothing it may say about who is inviting.
    deps.log.warn('household invite not mailed: the inviter has no verified email', { inviteId });
    return 'failed';
  }

  try {
    if (!(await deps.chargeMail(target.inviteeUid, now))) return 'held';
  } catch (error) {
    deps.log.error('household invite mail could not be charged', error, { inviteId });
    return 'failed';
  }

  const { subject, text } = composeHouseholdInviteEmail({
    inviterEmail,
    expiresAt,
    locale: target.locale,
  });
  const mail: InviteMailMessage = { to: target.email, subject, text };

  const deadline = deps.deadline(INVITE_MAIL_DEADLINE_MS);
  try {
    const outcome = await Promise.race([
      deps.sendMail(mail).then(() => 'sent' as const),
      deadline.fired.then(() => 'late' as const),
    ]);
    if (outcome === 'late') {
      // Abandoned, not cancelled: the transport's own timeouts bound the
      // socket, and the send may still deliver after the record says failed.
      deps.log.warn('household invite mail passed its deadline', { inviteId });
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    deps.log.error('household invite mail failed', error, { inviteId });
    return 'failed';
  } finally {
    deadline.clear();
  }
}

export async function handleHouseholdInvite(
  deps: HouseholdInviteDeps,
  request: InviteRequest
): Promise<InviteResult> {
  const now = deps.now();
  const facts: InviteFacts = { caller: callerOf(request.auth), data: request.data, now };

  let plan = planInvite(facts);
  while (plan.kind === 'need') {
    await gather(deps, facts, plan.need);
    plan = planInvite(facts);
  }
  if (plan.kind === 'refuse') throw refusalError(plan.refusal);

  const { target } = plan;
  const inviteId = `${target.householdId}_${target.inviteeUid}`;
  const expiresAt = new Date(now + INVITE_TTL_MS);

  // Written before the mail, so the link in it never leads to nothing. It
  // starts as `failed`, the claim that stays true if this call dies mid-send.
  const written = await deps.writeInvite(inviteId, {
    householdId: target.householdId,
    householdCreatedAt: target.household.createdAt,
    householdName: target.household.name,
    inviterUid: target.caller.uid,
    inviterName: target.caller.name,
    inviterEmail: target.caller.email,
    inviteeUid: target.inviteeUid,
    inviteeEmail: target.email,
    locale: target.locale,
    createdAt: new Date(now),
    expiresAt,
    mail: 'failed',
  });
  // Step 9 passed on reads outside the write's transaction; a concurrent
  // invite has taken the last seat since, and nothing was written.
  if (!written) throw refusalError({ code: 'failed-precondition', reason: 'full' });

  const mail = await deliver(deps, target, inviteId, expiresAt, now);
  if (mail !== 'failed') {
    try {
      await deps.recordMail(inviteId, mail);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === FIRESTORE_NOT_FOUND) {
        // Accepted or revoked while the mail was in flight: the update will
        // not recreate the invite, and there is no record left to correct.
        deps.log.warn('household invite gone before its mail status was recorded', {
          inviteId,
          mail,
        });
      } else {
        // The record keeps its provisional `failed`; the answer below still
        // says what became of the mail. The error goes positionally so the
        // logger keeps its stack.
        deps.log.error('household invite mail status not recorded', error, { inviteId, mail });
      }
    }
  }

  return { inviteId, mail };
}
