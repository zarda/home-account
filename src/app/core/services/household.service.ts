import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import type { FunctionsError } from '@angular/fire/functions';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { HOUSEHOLD_INVITE_CALLABLE, HouseholdInviteResponse } from './household-invite-callable';
import {
  Household,
  HouseholdInvite,
  HouseholdMember,
  HouseholdMemberIdentity,
  User,
  isMemberPhotoUrl
} from '../../models';
import { errorCode, isRefused } from '../utils/firebase-error.utils';

/** firestore.rules, householdNameValid. */
export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

/** firestore.rules, memberShapeValid. */
const MEMBER_NAME_MAX_LENGTH = 100;

/**
 * The most documents one commit deletes. Firestore allows the rules twenty
 * document lookups per commit, and the owner's delete of another member's
 * document looks up only the household, so four stays well inside that.
 * Invite deletes make no lookups and share the size only for simplicity.
 */
export const HOUSEHOLD_COMMIT_CHUNK = 4;

/**
 * The rules judge an invite's expiry by the server's clock. After a refused
 * join, an invite within this much of its expiry by the device's clock is
 * taken to have expired, so a device clock running up to this far behind
 * still names the right reason.
 */
const EXPIRY_CLOCK_MARGIN_MS = 15 * 60 * 1000;

const INVITES = 'householdInvites';

/**
 * - `idle` before connect().
 * - `loading` until the household and its members have both answered.
 * - `none` with no live membership.
 * - `member` with one. An owner's sentInvites() is not part of it and can
 *   trail it by a round trip.
 * - `unavailable` when the household or members listener failed, for a
 *   reason other than the rules ending the membership, before the member
 *   view was first heard. A failure after that keeps the last view.
 */
export type HouseholdStatus = 'idle' | 'loading' | 'none' | 'member' | 'unavailable';

/** A refusal or failure whose message is already in the user's language. */
export class HouseholdError extends Error {
  override name = 'HouseholdError';
}

const profilePath = (uid: string) => `users/${uid}`;
const householdPath = (householdId: string) => `households/${householdId}`;
const membersPath = (householdId: string) => `households/${householdId}/members`;
const memberPath = (householdId: string, uid: string) => `${membersPath(householdId)}/${uid}`;
const invitePath = (inviteId: string) => `${INVITES}/${inviteId}`;
const inviteIdOf = (householdId: string, uid: string) => `${householdId}_${uid}`;

function isStamp(value: unknown): value is Timestamp {
  return !!value && typeof (value as Timestamp).toMillis === 'function';
}

function millisOf(value: unknown): number {
  return isStamp(value) ? value.toMillis() : 0;
}

function newestFirst(a: HouseholdInvite, b: HouseholdInvite): number {
  return millisOf(b.createdAt) - millisOf(a.createdAt) || a.id.localeCompare(b.id);
}

function ownerThenJoined(a: HouseholdMember, b: HouseholdMember): number {
  if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
  return millisOf(a.joinedAt) - millisOf(b.joinedAt) || a.uid.localeCompare(b.uid);
}

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += HOUSEHOLD_COMMIT_CHUNK) {
    chunks.push(items.slice(i, i + HOUSEHOLD_COMMIT_CHUNK));
  }
  return chunks;
}

/** Clips to a length the rules accept without splitting a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * A household (#71): forming, joining, leaving, managing and dissolving it,
 * and the live view of the caller's own membership.
 *
 * Nothing listens until a page calls connect(), and the last disconnect()
 * closes every listener: a root service holding a session-long listener would
 * outlive the page and keep streaming into sign-out and account deletion
 * (ADR 0009). The caller's own member document is the anchor. It is the one
 * household document always readable to its owner, so its server-confirmed
 * absence is the only thing that says access was lost; the household, the
 * members and the sent invites are listened to only while it is live, and a
 * refusal of any of them is the rules ending the membership, not a fault.
 *
 * Every write is refused offline before it starts: a transaction needs the
 * server, and a household commit left queued would land long after the
 * state it was decided on. Each write is shaped for firestore.rules exactly:
 * the rules, not this service, decide who may do what.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly pwa = inject(PwaService);
  private readonly translation = inject(TranslationService);
  private readonly inviteCallable = inject(HOUSEHOLD_INVITE_CALLABLE);

  private readonly connected = signal(false);
  /** The profile's pointer; undefined until the profile listener answers. */
  private readonly pointer = signal<string | null | undefined>(undefined);
  /** Undefined while unknown, null when there is no member document. */
  private readonly ownMemberDoc = signal<HouseholdMember | null | undefined>(undefined);
  /** Undefined while unknown, null when refused or absent. */
  private readonly householdDoc = signal<Household | null | undefined>(undefined);
  /** Undefined until the members listener first answers. */
  private readonly memberDocs = signal<HouseholdMember[] | undefined>(undefined);
  /** The household or members listener failed for a reason other than a refusal. */
  private readonly membershipFailed = signal(false);
  private readonly receivedDocs = signal<HouseholdInvite[]>([]);
  private readonly sentDocs = signal<HouseholdInvite[]>([]);
  private readonly lostAccessFlag = signal(false);

  readonly status = computed<HouseholdStatus>(() => {
    if (!this.connected()) return 'idle';
    const pointer = this.pointer();
    if (pointer === undefined) return 'loading';
    if (pointer === null) return 'none';
    const own = this.ownMemberDoc();
    if (own === undefined) return 'loading';
    if (own === null) return 'none';
    const household = this.householdDoc();
    if (household === null) return 'none';
    if (household && this.memberDocs()) return 'member';
    return this.membershipFailed() ? 'unavailable' : 'loading';
  });

  readonly household = computed(() => (this.status() === 'member' ? this.householdDoc() ?? null : null));
  readonly ownMember = computed(() => (this.status() === 'member' ? this.ownMemberDoc() ?? null : null));
  /** The owner first, then by joining order. */
  readonly members = computed(() => (this.status() === 'member' ? this.memberDocs() ?? [] : []));
  readonly isOwner = computed(() => this.ownMember()?.role === 'owner');
  /** Invites addressed to the account, newest first. */
  readonly receivedInvites = this.receivedDocs.asReadonly();
  /** The owner's pending invites into this household, newest first. */
  readonly sentInvites = computed(() => {
    const household = this.household();
    if (!household || !this.isOwner()) return [];
    return this.sentDocs().filter(invite => invite.householdId === household.id);
  });
  /**
   * The server confirmed that a membership seen live in this session is
   * gone: a removal, or a dissolve by the owner. Never set by the caller's
   * own leaving, nor by anything the cache says.
   */
  readonly lostAccess = this.lostAccessFlag.asReadonly();

  private connections = 0;
  private uid: string | null = null;
  /** The membership (household, generation, role) the attached listeners serve. */
  private membershipKey: string | null = null;
  /** The household whose membership was seen live, for telling a loss from a boot. */
  private liveHouseholdId: string | null = null;
  /** A household this client is itself leaving, so its own deletion is not reported as lost access. */
  private endingOwnMembership: string | null = null;

  private profileSub: Subscription | null = null;
  private receivedSub: Subscription | null = null;
  private ownSub: Subscription | null = null;
  private householdSub: Subscription | null = null;
  private membersSub: Subscription | null = null;
  private sentSub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
    // One account's household must not outlive it (ADR 0009). This acts
    // only while a page holds a connection, so no listener opens outside a
    // page's lifetime, and the listeners it opens for the next account
    // refill the state themselves. Comparing against the account the
    // listeners serve, not resetting on every change, is what keeps a
    // connect() made after sign-in from being torn down again.
    effect(() => {
      const uid = this.auth.userId();
      untracked(() => {
        if (this.connections === 0 || uid === this.uid) return;
        this.closeListeners();
        this.open(uid);
      });
    });
  }

  /** Opens the listeners on the first call; each call needs its own disconnect(). */
  connect(): void {
    this.connections++;
    if (this.connections > 1) return;

    this.connected.set(true);
    this.open(this.auth.userId());
  }

  /** Closes every listener once each connect() has been matched. */
  disconnect(): void {
    if (this.connections === 0) return;
    this.connections--;
    if (this.connections === 0) this.close();
  }

  /** Forms a household owned by the caller and returns its id. */
  async create(name: string): Promise<string> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      const clean = this.validName(name);
      const householdId = this.firestore.generateId('households');
      // One commit: the rules admit the household only with its owner's
      // member document and the pointer, and createdAt and since must both be
      // the request time, which only the server can stamp.
      await this.firestore.runTransaction(async tx => {
        tx.set(this.ref(householdPath(householdId)), {
          name: clean,
          ownerId: uid,
          createdAt: serverTimestamp()
        });
        tx.set(this.ref(memberPath(householdId, uid)), {
          ...this.identity(uid),
          role: 'owner',
          since: serverTimestamp(),
          joinedAt: serverTimestamp()
        });
        tx.update(this.ref(profilePath(uid)), { householdId });
      });
      return householdId;
    });
  }

  /**
   * Joins through the invite addressed to the caller. The joiner cannot read
   * the household before it belongs to it, so the generation comes from the
   * invite, copied unchanged: the rules compare it to the microsecond.
   */
  async accept(householdId: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      // The rules would refuse the commit; a connected page already knows why.
      if (this.uid === uid && this.status() === 'member') {
        throw new HouseholdError(this.t('household.errors.alreadyMember'));
      }
      const inviteId = inviteIdOf(householdId, uid);
      const inviteRef = this.ref(invitePath(inviteId));
      const profileRef = this.ref(profilePath(uid));
      const read: { invite?: HouseholdInvite; pointer?: string | null } = {};
      try {
        // Expiry is left to the rules, which judge it by the server's clock:
        // this device's clock can be wrong either way.
        await this.firestore.runTransaction(async tx => {
          const snapshot = await tx.get(inviteRef).catch((error: unknown) => {
            // The rules read an invite to decide who may read it, so a get of
            // one that is gone is refused rather than answered empty.
            if (isRefused(error)) throw new HouseholdError(this.t('household.errors.inviteGone'), { cause: error });
            throw error;
          });
          if (!snapshot.exists()) throw new HouseholdError(this.t('household.errors.inviteGone'));
          const invite = snapshot.data() as HouseholdInvite;
          // Read so that a pointer moved by another device meanwhile makes this
          // commit retry against it rather than write over it.
          const profile = (await tx.get(profileRef)).data() as Partial<User> | undefined;
          read.invite = invite;
          read.pointer = profile?.householdId || null;
          tx.set(this.ref(memberPath(householdId, uid)), {
            ...this.identity(uid),
            role: 'member',
            since: invite.householdCreatedAt,
            joinedAt: serverTimestamp(),
            inviteId
          });
          tx.delete(inviteRef);
          tx.update(profileRef, { householdId });
        });
      } catch (error) {
        if (!isRefused(error) || !read.invite) throw error;
        throw await this.joinRefusal(uid, householdId, read.invite, read.pointer ?? null, error);
      }
    });
  }

  /** Deletes the invite addressed to the caller. */
  async decline(householdId: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(() => this.deleteInvite(inviteIdOf(householdId, uid)));
  }

  /** Sends an invite from the owner through the callable. */
  async invite(email: string): Promise<HouseholdInviteResponse> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      const { householdId } = this.ownedMembership(uid);
      return this.inviteCallable({
        householdId,
        email: email.trim(),
        locale: this.translation.currentLocale()
      });
    });
  }

  /** Withdraws one of the owner's pending invites. */
  async revoke(inviteId: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      this.ownedMembership(uid);
      await this.deleteInvite(inviteId);
    });
  }

  async rename(name: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId } = this.ownedMembership(uid);
      const clean = this.validName(name);
      await this.firestore.runTransaction(async tx => {
        tx.update(this.ref(householdPath(householdId)), { name: clean, updatedAt: serverTimestamp() });
      });
    });
  }

  /** The owner removes another member. The removed member's pointer is its own to clear. */
  async remove(memberUid: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId } = this.ownedMembership(uid);
      if (memberUid === uid) throw new HouseholdError(this.t('household.errors.ownerLeaves'));
      await this.commitDeletes([memberPath(householdId, memberUid)]);
    });
  }

  /** A member leaves. The owner cannot: it dissolves instead. */
  async leave(): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId, member } = this.liveMembership(uid);
      if (member.role === 'owner') throw new HouseholdError(this.t('household.errors.ownerLeaves'));
      await this.endOwnMembership(uid, householdId, { member: true, household: false });
    });
  }

  async dissolve(): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId, member } = this.ownedMembership(uid);
      await this.dissolveHousehold(uid, householdId, member.since);
    });
  }

  /**
   * Clears a pointer whose membership is gone, with an orphaned member
   * document if one is left. Answers whether anything was stale. Read once
   * from the server rather than from the listeners, which a page may not have
   * connected.
   */
  async clearStalePointer(): Promise<boolean> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      const householdId = (await this.firestore.getDocument<User>(profilePath(uid)))?.householdId;
      if (!householdId) return false;
      const own = await this.firestore.getDocument<HouseholdMember>(memberPath(householdId, uid));
      if (own && (await this.isLive(householdId))) return false;
      await this.endOwnMembership(uid, householdId, { member: own !== null, household: false });
      return true;
    });
  }

  /**
   * For account deletion: an owner dissolves, a member leaves, a stale
   * pointer is cleared, and then every invite addressed to or sent by the
   * account is deleted. It must run before the profile is deleted: the rules
   * refuse that delete while the membership it names is live.
   */
  async deleteAll(): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const householdId = (await this.firestore.getDocument<User>(profilePath(uid)))?.householdId;
      if (householdId) {
        const own = await this.firestore.getDocument<HouseholdMember>(memberPath(householdId, uid));
        if (own?.role === 'owner' && isStamp(own.since) && (await this.isLive(householdId))) {
          await this.dissolveHousehold(uid, householdId, own.since);
        } else {
          await this.endOwnMembership(uid, householdId, { member: own !== null, household: false });
        }
      }
      const received = await this.inviteIdsWhere('inviteeUid', uid);
      const sent = await this.inviteIdsWhere('inviterUid', uid);
      await this.deleteInvites([...received, ...sent]);
    });
  }

  private open(uid: string | null): void {
    this.uid = uid;
    if (!uid) {
      this.pointer.set(null);
      return;
    }

    this.profileSub = this.firestore.subscribeToDocument<User>(profilePath(uid)).subscribe({
      next: profile => this.followPointer(uid, profile?.householdId || null),
      error: error => {
        this.quietly(error, 'profile');
        this.closeMembership();
        this.pointer.set(null);
      }
    });
    this.receivedSub = this.firestore
      .subscribeToCollection<HouseholdInvite>(INVITES, {
        where: [{ field: 'inviteeUid', op: '==', value: uid }]
      })
      .subscribe({
        next: invites => this.receivedDocs.set([...invites].sort(newestFirst)),
        error: error => {
          this.quietly(error, 'received invites');
          this.receivedDocs.set([]);
        }
      });
  }

  private close(): void {
    this.connections = 0;
    this.closeListeners();
    this.connected.set(false);
  }

  /** Every listener and everything they told; the connection count is the caller's. */
  private closeListeners(): void {
    this.profileSub?.unsubscribe();
    this.receivedSub?.unsubscribe();
    this.profileSub = null;
    this.receivedSub = null;
    this.closeMembership();
    this.uid = null;
    this.endingOwnMembership = null;
    this.pointer.set(undefined);
    this.ownMemberDoc.set(undefined);
    this.receivedDocs.set([]);
    this.lostAccessFlag.set(false);
  }

  private followPointer(uid: string, householdId: string | null): void {
    // Untracked: a mock listener can answer synchronously, inside whatever
    // reactive context called connect().
    if (householdId === untracked(this.pointer)) return;
    // The pointer moved (a leave, a join, a clear), so whatever this client
    // was ending is over, and a later loss of the same id is real.
    this.endingOwnMembership = null;
    this.closeMembership();
    this.pointer.set(householdId);
    if (!householdId) {
      this.ownMemberDoc.set(null);
      return;
    }
    this.ownMemberDoc.set(undefined);
    this.ownSub = this.firestore
      .subscribeToDocumentWithMetadata<HouseholdMember>(memberPath(householdId, uid))
      .subscribe({
        next: ({ data, fromCache, hasPendingWrites }) =>
          this.onOwnMember(uid, householdId, data, !fromCache && !hasPendingWrites),
        error: error => {
          this.quietly(error, 'membership');
          this.detachMembership();
          this.ownMemberDoc.set(null);
        }
      });
  }

  private onOwnMember(uid: string, householdId: string, data: HouseholdMember | null, confirmed: boolean): void {
    if (data) {
      // A member doc without a Timestamp `since` cannot anchor the
      // generation-filtered members query or the membership key, so it
      // attaches nothing.
      if (!isStamp(data.since)) return;
      this.ownMemberDoc.set(data);
      this.liveHouseholdId = householdId;
      this.lostAccessFlag.set(false);
      this.attachMembership(uid, householdId, data);
      return;
    }
    if (!confirmed) {
      // Only the server says the document is gone. An uncached document
      // reads null offline, and a local delete not yet committed may still
      // be refused. It decides nothing, beyond ending the wait.
      if (this.ownMemberDoc() === undefined) this.ownMemberDoc.set(null);
      return;
    }
    const wasLive = this.liveHouseholdId === householdId;
    this.detachMembership();
    this.liveHouseholdId = null;
    this.ownMemberDoc.set(null);
    if (wasLive && this.endingOwnMembership !== householdId) this.lostAccessFlag.set(true);
  }

  private attachMembership(uid: string, householdId: string, member: HouseholdMember): void {
    const key = `${householdId}|${member.since.seconds}.${member.since.nanoseconds}|${member.role}`;
    if (key === this.membershipKey) return;
    this.detachMembership();
    this.membershipKey = key;

    this.householdSub = this.firestore.subscribeToDocument<Household>(householdPath(householdId)).subscribe({
      next: household => this.householdDoc.set(household),
      error: error => this.membershipListenerFailed(error, 'household')
    });
    // The rules admit a members list only when it filters on the caller's
    // own generation: that is how they prove it holds no orphan of an
    // earlier household under the same id.
    this.membersSub = this.firestore
      .subscribeToCollection<HouseholdMember>(membersPath(householdId), {
        where: [{ field: 'since', op: '==', value: member.since }]
      })
      .subscribe({
        next: members => this.memberDocs.set([...members].sort(ownerThenJoined)),
        error: error => this.membershipListenerFailed(error, 'members')
      });
    if (member.role === 'owner') {
      this.sentSub = this.firestore
        .subscribeToCollection<HouseholdInvite>(INVITES, {
          where: [{ field: 'inviterUid', op: '==', value: uid }]
        })
        .subscribe({
          next: invites => this.sentDocs.set([...invites].sort(newestFirst)),
          error: error => {
            this.quietly(error, 'sent invites');
            this.sentDocs.set([]);
          }
        });
    }
  }

  /**
   * The rules refuse the household and members listeners once the
   * membership ends. The listeners close, and the same membership is not
   * asked for again; the own member document says whether access was lost.
   *
   * Any other failure says nothing about the membership. The listeners
   * close, the view keeps what was last heard (`unavailable` while it had
   * heard nothing), and the next own-member emission attaches afresh.
   */
  private membershipListenerFailed(error: unknown, listener: string): void {
    this.quietly(error, listener);
    if (isRefused(error)) {
      const key = this.membershipKey;
      this.detachMembership();
      this.membershipKey = key;
      this.householdDoc.set(null);
      return;
    }
    this.unsubscribeMembership();
    this.membershipKey = null;
    this.membershipFailed.set(true);
  }

  private closeMembership(): void {
    this.ownSub?.unsubscribe();
    this.ownSub = null;
    this.detachMembership();
    this.liveHouseholdId = null;
  }

  private detachMembership(): void {
    this.unsubscribeMembership();
    this.membershipKey = null;
    this.membershipFailed.set(false);
    this.householdDoc.set(undefined);
    this.memberDocs.set(undefined);
    this.sentDocs.set([]);
  }

  private unsubscribeMembership(): void {
    this.householdSub?.unsubscribe();
    this.membersSub?.unsubscribe();
    this.sentSub?.unsubscribe();
    this.householdSub = null;
    this.membersSub = null;
    this.sentSub = null;
  }

  /** A refusal is the rules ending a membership; anything else is worth a line. */
  private quietly(error: unknown, listener: string): void {
    if (!isRefused(error)) {
      console.warn(`[HouseholdService] The ${listener} listener stopped:`, error);
    }
  }

  /**
   * The owner's sent invites go first: with none left, nobody can join
   * between the member sweep and the final commit. The members are read
   * from the server, not from a listener that may hold a partial view.
   */
  private async dissolveHousehold(uid: string, householdId: string, since: Timestamp): Promise<void> {
    await this.deleteInvites(await this.inviteIdsWhere('inviterUid', uid));
    const members = await this.firestore.getCollectionFromServer<HouseholdMember>(membersPath(householdId), {
      where: [{ field: 'since', op: '==', value: since }]
    });
    const others = members.map(member => member.uid).filter(memberUid => memberUid !== uid);
    for (const chunk of chunked(others)) {
      await this.commitDeletes(chunk.map(memberUid => memberPath(householdId, memberUid)));
    }
    await this.endOwnMembership(uid, householdId, { member: true, household: true });
  }

  /**
   * The caller's own member document (when there is one), the household
   * (for a dissolve) and the pointer, in one commit: the rules clear a
   * pointer only once the membership it names is gone.
   */
  private async endOwnMembership(
    uid: string,
    householdId: string,
    parts: { member: boolean; household: boolean }
  ): Promise<void> {
    this.endingOwnMembership = householdId;
    try {
      await this.firestore.runTransaction(async tx => {
        if (parts.household) tx.delete(this.ref(householdPath(householdId)));
        if (parts.member) tx.delete(this.ref(memberPath(householdId, uid)));
        tx.update(this.ref(profilePath(uid)), { householdId: deleteField() });
      });
    } catch (error) {
      this.endingOwnMembership = null;
      throw error;
    }
  }

  /**
   * What a refused join most likely ran into, worked out from what its
   * transaction read. The rules refuse one for a live membership elsewhere,
   * an expired invite, or a household or generation that is gone, and do
   * not say which.
   */
  private async joinRefusal(
    uid: string,
    householdId: string,
    invite: HouseholdInvite,
    pointer: string | null,
    cause: unknown
  ): Promise<HouseholdError> {
    if (pointer && pointer !== householdId && (await this.belongsTo(uid, pointer))) {
      return new HouseholdError(this.t('household.errors.alreadyMember'), { cause });
    }
    if (millisOf(invite.expiresAt) <= Date.now() + EXPIRY_CLOCK_MARGIN_MS) {
      return new HouseholdError(this.t('household.errors.expired'), { cause });
    }
    return new HouseholdError(this.t('household.errors.inviteGone'), { cause });
  }

  /** A live membership: its member document and a household it can read. */
  private async belongsTo(uid: string, householdId: string): Promise<boolean> {
    try {
      const own = await this.firestore.getDocument<HouseholdMember>(memberPath(householdId, uid));
      return own !== null && (await this.isLive(householdId));
    } catch {
      // Only the message depends on it: an unanswered read leaves the invite
      // to explain the refusal.
      return false;
    }
  }

  private async isLive(householdId: string): Promise<boolean> {
    try {
      return (await this.firestore.getDocument<Household>(householdPath(householdId))) !== null;
    } catch (error) {
      // Only a live member may read the household, and a get of one that is
      // gone is refused rather than answered empty.
      if (isRefused(error)) return false;
      throw error;
    }
  }

  private async inviteIdsWhere(field: 'inviteeUid' | 'inviterUid', uid: string): Promise<string[]> {
    const invites = await this.firestore.getCollectionFromServer<HouseholdInvite>(INVITES, {
      where: [{ field, op: '==', value: uid }]
    });
    return invites.map(invite => invite.id);
  }

  private async deleteInvites(inviteIds: string[]): Promise<void> {
    for (const chunk of chunked(inviteIds)) {
      try {
        await this.commitDeletes(chunk.map(invitePath));
      } catch (error) {
        if (!isRefused(error)) throw error;
        // One invite consumed or withdrawn meanwhile refuses the whole
        // commit; one at a time, a gone invite only skips itself.
        for (const inviteId of chunk) await this.deleteInvite(inviteId);
      }
    }
  }

  /**
   * Deletes one invite, treating a refusal as the invite already gone: the
   * rules read the invite to decide, so an accept or a revoke that got there
   * first leaves nothing to delete and nothing to be allowed.
   */
  private async deleteInvite(inviteId: string): Promise<void> {
    try {
      await this.commitDeletes([invitePath(inviteId)]);
    } catch (error) {
      if (!isRefused(error)) throw error;
    }
  }

  private commitDeletes(paths: string[]): Promise<void> {
    return this.firestore.runTransaction(async tx => {
      for (const path of paths) tx.delete(this.ref(path));
    });
  }

  private liveMembership(uid: string): { householdId: string; member: HouseholdMember } {
    const household = this.household();
    const member = this.ownMember();
    if (!household || !member || this.uid !== uid) {
      throw new HouseholdError(this.t('errors.generic'));
    }
    return { householdId: household.id, member };
  }

  private ownedMembership(uid: string): { householdId: string; member: HouseholdMember } {
    const live = this.liveMembership(uid);
    if (live.member.role !== 'owner') throw new HouseholdError(this.t('household.errors.notOwner'));
    return live;
  }

  /**
   * How the caller appears to the other members, within the rules' limits.
   * A picture the rules would refuse is left out rather than refusing the
   * whole write.
   */
  private identity(uid: string): HouseholdMemberIdentity {
    const user = this.auth.currentUser();
    const identity: HouseholdMemberIdentity = {
      uid,
      displayName: clip((user?.displayName ?? '').trim(), MEMBER_NAME_MAX_LENGTH)
    };
    const photo = user?.photoURL;
    if (isMemberPhotoUrl(photo)) identity.photoURL = photo;
    return identity;
  }

  private validName(name: string): string {
    const clean = name.trim();
    if (!clean || clean.length > HOUSEHOLD_NAME_MAX_LENGTH) {
      throw new HouseholdError(this.t('household.errors.name', { max: HOUSEHOLD_NAME_MAX_LENGTH }));
    }
    return clean;
  }

  private requireUser(): string {
    const uid = this.auth.userId();
    if (!uid) throw new Error('User not authenticated');
    return uid;
  }

  /** Refuses offline before anything starts, and puts every failure into words. */
  private async attempt<T>(work: () => Promise<T>): Promise<T> {
    if (!this.pwa.isOnline()) throw new HouseholdError(this.t('household.errors.offline'));
    try {
      return await work();
    } catch (error) {
      throw this.failure(error);
    }
  }

  private failure(error: unknown): HouseholdError {
    if (error instanceof HouseholdError) return error;
    const refusal = this.refusalMessage(error);
    if (refusal) return new HouseholdError(refusal, { cause: error });
    const code = errorCode(error);
    if (!this.pwa.isOnline() || code === 'unavailable' || code === 'deadline-exceeded') {
      return new HouseholdError(this.t('household.errors.offline'), { cause: error });
    }
    return new HouseholdError(this.t('errors.generic'), { cause: error });
  }

  /**
   * The invite callable's business answers, by `details.reason`. The code
   * alone says nothing: a function that is missing, private or in the wrong
   * region answers not-found or permission-denied with no reason at all,
   * and must not read as "no account uses that address".
   */
  private refusalMessage(error: unknown): string | null {
    if (!errorCode(error)?.startsWith('functions/')) return null;
    const details = (error as FunctionsError).details;
    const reason = details !== null && typeof details === 'object'
      ? (details as { reason?: unknown }).reason
      : undefined;
    switch (reason) {
      case 'signed-out': return this.t('household.errors.signedOut');
      case 'email': return this.t('household.errors.email');
      case 'locale': return this.t('household.errors.locale');
      case 'household': return this.t('household.errors.household');
      case 'not-owner': return this.t('household.errors.notOwner');
      case 'self': return this.t('household.errors.self');
      case 'quota': return this.t('household.errors.quota');
      case 'no-account': return this.t('household.errors.noAccount');
      case 'member': return this.t('household.errors.member');
      case 'full': return this.t('household.errors.full');
      case 'elsewhere': return this.t('household.errors.elsewhere');
      default: return null;
    }
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translation.t(key, params);
  }

  private ref(path: string) {
    return this.firestore.getDocRef(path);
  }
}
