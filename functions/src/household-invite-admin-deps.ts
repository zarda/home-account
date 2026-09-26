import type { Auth } from 'firebase-admin/auth';
import { Firestore, QuerySnapshot, Timestamp } from 'firebase-admin/firestore';

import {
  PendingInvite,
  Stamp,
  hasSeat,
  isHouseholdId,
  millisOf,
  nextInviteQuota,
  nextMailCharge,
  sameStamp,
  stampOf,
} from './household-invite';
import {
  HouseholdInviteDeps,
  InviteLog,
  InviteMailMessage,
  timerDeadline,
} from './household-invite-handler';

export interface HouseholdInviteAdminWiring {
  firestore: Firestore;
  auth: Pick<Auth, 'getUserByEmail'>;
  /** The transport with its sender and SMTP secrets already bound. */
  sendMail(mail: InviteMailMessage): Promise<void>;
  log: InviteLog;
}

/**
 * The Admin SDK behind the invite handler. Every decision is made in
 * ./household-invite; each dep here reads or writes, and holds only the
 * shape guards a stored value needs before a decision may trust it: a
 * household's createdAt must be a real Timestamp, and a profile's pointer a
 * possible household id. The handles come in as arguments so a test can
 * record how each write is made, which the handler's own fakes never see.
 */
export function householdInviteAdminDeps({
  firestore,
  auth,
  sendMail,
  log,
}: HouseholdInviteAdminWiring): HouseholdInviteDeps {
  const membersOf = (householdId: string) =>
    firestore.collection(`households/${householdId}/members`);
  const invitesTo = (householdId: string) =>
    firestore.collection('householdInvites').where('householdId', '==', householdId);
  const liveMemberCount = (members: QuerySnapshot, createdAt: Stamp) =>
    members.docs.filter(member => sameStamp(stampOf(member.get('since')), createdAt)).length;
  const pendingOf = (invites: QuerySnapshot): PendingInvite[] =>
    invites.docs.map(invite => ({
      inviteeUid: String(invite.get('inviteeUid')),
      expiresAt: millisOf(invite.get('expiresAt')) ?? 0,
      householdCreatedAt: stampOf(invite.get('householdCreatedAt')),
    }));

  return {
    now: () => Date.now(),

    getHousehold: async householdId => {
      const snapshot = await firestore.doc(`households/${householdId}`).get();
      const ownerId: unknown = snapshot.get('ownerId');
      const name: unknown = snapshot.get('name');
      const createdAt: unknown = snapshot.get('createdAt');
      // createdAt is written back into the invite and compared by the join
      // rule, so only a real Timestamp will do; a look-alike map never matches.
      if (typeof ownerId !== 'string' || typeof name !== 'string') return null;
      if (!(createdAt instanceof Timestamp)) return null;
      return { ownerId, name, createdAt };
    },

    bumpInviterQuota: (inviterUid, now) =>
      firestore.runTransaction(async transaction => {
        const ref = firestore.doc(`inviteQuotas/${inviterUid}`);
        const verdict = nextInviteQuota((await transaction.get(ref)).data(), now);
        // A merge: the same document holds this uid's inbound mail counter.
        if (verdict.allowed) transaction.set(ref, verdict.next, { merge: true });
        return verdict.allowed;
      }),

    getUserByEmail: async email => {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, disabled: user.disabled };
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'auth/user-not-found') return null;
        throw error;
      }
    },

    membershipOf: async uid => {
      const householdId: unknown = (await firestore.doc(`users/${uid}`).get()).get('householdId');
      // The pointer is client-written; one that could not be a household id
      // names no household this function will read through.
      if (!isHouseholdId(householdId)) return null;
      const [member, household] = await Promise.all([
        firestore.doc(`households/${householdId}/members/${uid}`).get(),
        firestore.doc(`households/${householdId}`).get(),
      ]);
      return {
        householdId,
        since: stampOf(member.get('since')),
        householdCreatedAt: stampOf(household.get('createdAt')),
      };
    },

    countMembers: async (householdId, createdAt) =>
      liveMemberCount(await membersOf(householdId).get(), createdAt),

    pendingInvites: async householdId => pendingOf(await invitesTo(householdId).get()),

    chargeMail: (inviteeUid, now) =>
      firestore.runTransaction(async transaction => {
        const quotaRef = firestore.doc(`inviteQuotas/${inviteeUid}`);
        const budgetRef = firestore.doc('mailBudget/daily');
        const [quota, budget] = await transaction.getAll(quotaRef, budgetRef);
        const charge = nextMailCharge(quota.data(), budget.data(), now);
        if (charge.send) {
          // A merge: the same document holds this uid's own lookup quota.
          transaction.set(quotaRef, charge.recipient, { merge: true });
          // Whole: the budget is one day's count, replaced when the day turns.
          transaction.set(budgetRef, charge.budget);
        }
        return charge.send;
      }),

    // The seat is counted again from reads inside the write's transaction.
    // Firestore runs transactions with serializable isolation, so two invites
    // racing for the last seat cannot both commit.
    writeInvite: (inviteId, invite) =>
      firestore.runTransaction(async transaction => {
        const members = await transaction.get(membersOf(invite.householdId));
        const invites = await transaction.get(invitesTo(invite.householdId));
        const seat = hasSeat(
          {
            liveMembers: liveMemberCount(members, invite.householdCreatedAt),
            invites: pendingOf(invites),
          },
          {
            inviteeUid: invite.inviteeUid,
            generation: invite.householdCreatedAt,
            now: invite.createdAt.getTime(),
          }
        );
        if (seat) transaction.set(firestore.doc(`householdInvites/${inviteId}`), invite);
        return seat;
      }),

    recordMail: async (inviteId, mail) => {
      await firestore.doc(`householdInvites/${inviteId}`).update({ mail });
    },

    sendMail,

    deadline: timerDeadline,

    log,
  };
}
