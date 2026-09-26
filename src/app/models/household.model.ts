import { Timestamp } from '@angular/fire/firestore';

/**
 * households/{householdId}. Formed, renamed and dissolved by its owner only;
 * read by its live members.
 */
export interface Household {
  id: string;
  /** 1–60 characters, trimmed. */
  name: string;
  ownerId: string;
  /**
   * The request time of the create, and the household's generation: a member
   * document counts only while its `since` equals this, so the members of a
   * dissolved household read nothing of one formed again under the same id.
   */
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type HouseholdRole = 'owner' | 'member';

/** households/{householdId}/members/{uid}, written by the member itself. */
export interface HouseholdMember {
  uid: string;
  /** At most 100 characters. */
  displayName: string;
  /**
   * On one of Google's account-picture hosts, at most 2048 characters (see
   * isMemberPhotoUrl); omitted when there is no picture.
   */
  photoURL?: string;
  role: HouseholdRole;
  /** The household's `createdAt` at the time of joining. */
  since: Timestamp;
  joinedAt: Timestamp;
  /** `${householdId}_${uid}`: the invite a member joined through. The owner has none. */
  inviteId?: string;
}

/** Who a member is, as the household page shows them beside a figure or a row. */
export type HouseholdMemberIdentity = Pick<HouseholdMember, 'uid' | 'displayName' | 'photoURL'>;

/**
 * The most live memberships one account holds. The rules do not count them:
 * the client refuses a create or a join past it, and the invite callable
 * refuses to invite an account already at it. The invite callable keeps its
 * own copy (MAX_HOUSEHOLDS_PER_ACCOUNT in functions/src/household-invite.ts,
 * a separate build); the functions test household-client-mirrors.test.ts
 * fails when the two differ.
 */
export const MAX_HOUSEHOLDS_PER_ACCOUNT = 10;

/**
 * users/{uid}/households/{householdId}: the account's own entry for one
 * membership, written in the same commit as its member document and read by
 * the account alone. It is how the account's client finds every household it
 * belongs to.
 */
export interface HouseholdIndexEntry {
  /** The household id. */
  id: string;
  /** The member document's `since`: the generation joined. */
  since: Timestamp;
  role: HouseholdRole;
  /** The household's name when last seen, for listing; the household document is the truth. */
  name: string;
  joinedAt: Timestamp;
  /** Set once the membership's ending is under way; the entry goes after. */
  endedAt?: Timestamp;
}

/** One membership as the account's index lists it. */
export interface HouseholdMembership {
  householdId: string;
  name: string;
  role: HouseholdRole;
  /**
   * The generation joined. Null only while the commit that stamps it with
   * the server's time is still on its way.
   */
  since: Timestamp | null;
  /** Null only while the commit that stamps it is still on its way. */
  joinedAt: Timestamp | null;
  /** The ending is under way: the entry no longer counts as a live membership. */
  ended: boolean;
}

/** The longest picture address a member document may hold. */
export const MEMBER_PHOTO_MAX_LENGTH = 2048;

/**
 * Google's account-picture hosts. Every member's browser loads every other
 * member's picture, so whoever serves it learns each viewer's address and
 * when they open the household page; the app signs in with Google only, so
 * no genuine picture is served from anywhere else. memberPhotoValid in
 * firestore.rules holds the same pattern.
 */
const MEMBER_PHOTO_PATTERN = /^https:\/\/lh[3-6]\.googleusercontent\.com\/.*$/;

/** A picture a member document may name, and so one a page may load. */
export function isMemberPhotoUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.length <= MEMBER_PHOTO_MAX_LENGTH && MEMBER_PHOTO_PATTERN.test(url);
}

/**
 * What became of an invite's mail. `held` means a mail cap was reached: the
 * invite stands and is shown in the app, but nothing was sent.
 *
 * `failed` is also the provisional value while the invite callable is
 * sending: it is written before the mail and corrected to `sent` or `held`
 * once the send settles. So a `failed` whose `createdAt` is younger than the
 * callable's mail deadline (INVITE_MAIL_DEADLINE_MS in
 * functions/src/household-invite-handler.ts, plus the charge and the update)
 * reads as still sending.
 */
export type HouseholdInviteMail = 'sent' | 'failed' | 'held';

/**
 * householdInvites/{householdId}_{inviteeUid}. Written only by the invite
 * callable; read and deleted by the inviter or the invitee.
 */
export interface HouseholdInvite {
  id: string;
  householdId: string;
  /**
   * The generation the invite admits to, copied into the joiner's `since`:
   * the joiner cannot read the household before it belongs to it.
   */
  householdCreatedAt: Timestamp;
  householdName: string;
  inviterUid: string;
  /** The inviter's sign-in name. Self-asserted: the inviter chose it. */
  inviterName: string;
  /**
   * The inviter's sign-in address as their provider verified it, or null when
   * it did not: what the invitee is shown beside the name before joining.
   * Read as null when absent.
   */
  inviterEmail?: string | null;
  inviteeUid: string;
  inviteeEmail: string;
  /** The inviter's app language when the invite was sent. */
  locale: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  mail: HouseholdInviteMail;
}
