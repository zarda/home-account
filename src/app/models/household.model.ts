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
  /** https only, at most 2048 characters; omitted when there is no picture. */
  photoURL?: string;
  role: HouseholdRole;
  /** The household's `createdAt` at the time of joining. */
  since: Timestamp;
  joinedAt: Timestamp;
  /** `${householdId}_${uid}`: the invite a member joined through. The owner has none. */
  inviteId?: string;
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
  inviterName: string;
  inviteeUid: string;
  inviteeEmail: string;
  /** The inviter's app language when the invite was sent. */
  locale: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  mail: HouseholdInviteMail;
}
