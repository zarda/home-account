import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import type { FunctionsError } from '@angular/fire/functions';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { HOUSEHOLD_INVITE_CALLABLE, HouseholdInviteResponse } from './household-invite-callable';
import { clearLedgerDeviceState } from './ledger-journal';
import {
  Household,
  HouseholdInvite,
  HouseholdMember,
  HouseholdMemberIdentity,
  HouseholdMembership,
  MAX_HOUSEHOLDS_PER_ACCOUNT,
  isMemberPhotoUrl
} from '../../models';
import { errorCode, isRefused } from '../utils/firebase-error.utils';
import { HouseholdIndexData as IndexData, isStamp, sameStamp, toMembership } from '../utils/household-index.utils';

/** firestore.rules, householdNameValid. */
export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

/**
 * Whether a household name is one the rules accept once trimmed, as it is
 * stored. Every form that takes a name judges it by this, as the service
 * does before it writes one.
 */
export function householdNameValid(name: string): boolean {
  const length = name.trim().length;
  return length > 0 && length <= HOUSEHOLD_NAME_MAX_LENGTH;
}

/** householdNameValid as a form control's validator. */
export function householdNameValidator(control: AbstractControl<string>): ValidationErrors | null {
  return householdNameValid(control.value) ? null : { householdName: true };
}

/**
 * The longest address the invite callable accepts: MAX_EMAIL_LENGTH in
 * functions/src/household-invite.ts, a separate build. The functions test
 * household-client-mirrors.test.ts fails when the two differ.
 */
const INVITE_EMAIL_MAX_LENGTH = 254;

/**
 * Whether an address, trimmed as invite() sends it, has the shape the invite
 * callable accepts (normalizeInviteEmail in functions/src/household-invite.ts):
 * something on both sides of exactly one @, no space or control character,
 * at most INVITE_EMAIL_MAX_LENGTH characters. A form judging by it never
 * refuses what the callable would take, nor sends what it would only refuse.
 */
export function inviteEmailValid(email: string): boolean {
  const address = email.trim();
  const parts = address.split('@');
  return (
    address.length > 0 &&
    address.length <= INVITE_EMAIL_MAX_LENGTH &&
    !hasSpaceOrControl(address) &&
    parts.length === 2 &&
    !!parts[0] &&
    !!parts[1]
  );
}

function hasSpaceOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || /\s/.test(char)) return true;
  }
  return false;
}

/**
 * Where this device remembers the household last selected for an account.
 * A convenience only: storage that is missing or refuses leaves the default
 * selection, the earliest joined live membership.
 */
export function householdSelectionKey(uid: string): string {
  return `household.selected.${uid}`;
}

function readSelection(uid: string): string | null {
  try {
    return localStorage.getItem(householdSelectionKey(uid));
  } catch {
    return null;
  }
}

function writeSelection(uid: string, householdId: string): void {
  try {
    localStorage.setItem(householdSelectionKey(uid), householdId);
  } catch {
    // The selection still holds for this session; only the next visit loses it.
  }
}

function forgetSelection(uid: string): void {
  try {
    localStorage.removeItem(householdSelectionKey(uid));
  } catch {
    // Storage this client cannot reach is storage it cannot erase either.
  }
}

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
 * The index entries marked ended: an inequality matches only a document
 * that holds the field, and endedAt is only ever a timestamp.
 */
const ENDED_ENTRIES = { field: 'endedAt', op: '>' as const, value: new Timestamp(0, 0) };

/**
 * The selected household's view:
 * - `idle` before connect().
 * - `loading` until the account's index has answered and, for the selected
 *   household, the household and its members have both answered.
 * - `none` with no live membership to show: the index lists none, or the
 *   selected one's own member document is gone.
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

/**
 * What the server says of one index entry's membership:
 * - `live`: the own member document of the entry's generation, in a
 *   household of that generation;
 * - `orphan`: that member document, with its household gone or re-formed;
 * - `gone`: no member document of the entry's generation.
 */
type MembershipState = 'live' | 'orphan' | 'gone';

const profilePath = (uid: string) => `users/${uid}`;
const indexCollectionPath = (uid: string) => `users/${uid}/households`;
const indexPath = (uid: string, householdId: string) => `${indexCollectionPath(uid)}/${householdId}`;
const householdPath = (householdId: string) => `households/${householdId}`;
const membersPath = (householdId: string) => `households/${householdId}/members`;
const memberPath = (householdId: string, uid: string) => `${membersPath(householdId)}/${uid}`;
const invitePath = (inviteId: string) => `${INVITES}/${inviteId}`;
const inviteIdOf = (householdId: string, uid: string) => `${householdId}_${uid}`;

function millisOf(value: unknown): number {
  return isStamp(value) ? value.toMillis() : 0;
}

/** Two readings of one index entry as the same join: every join stamps joinedAt afresh. */
function sameJoin(a: IndexData, b: IndexData): boolean {
  return sameStamp(a.since, b.since) && sameStamp(a.joinedAt, b.joinedAt);
}

function newestFirst(a: HouseholdInvite, b: HouseholdInvite): number {
  return millisOf(b.createdAt) - millisOf(a.createdAt) || a.id.localeCompare(b.id);
}

function ownerThenJoined(a: HouseholdMember, b: HouseholdMember): number {
  if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
  return millisOf(a.joinedAt) - millisOf(b.joinedAt) || a.uid.localeCompare(b.uid);
}

/** Earliest joined first; one whose join is still being stamped comes last. */
function joinedFirst(a: HouseholdMembership, b: HouseholdMembership): number {
  const at = (m: HouseholdMembership) => (m.joinedAt ? m.joinedAt.toMillis() : Number.POSITIVE_INFINITY);
  return at(a) - at(b) || a.householdId.localeCompare(b.householdId);
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
 * Households (#71): forming, joining, leaving, managing and dissolving them,
 * and the live view of the caller's own memberships.
 *
 * An account holds up to MAX_HOUSEHOLDS_PER_ACCOUNT memberships, each listed
 * by an entry in its own index (users/{uid}/households), which the rules tie
 * to its member document and which only the account reads. The index is the
 * one place the account's client finds every household it belongs to. One
 * of them is the selected household, and the per-household view (the
 * household, its members, the owner's sent invites) follows that one only.
 *
 * Nothing listens until a page calls connect(), and the last disconnect()
 * closes every listener: a root service holding a session-long listener would
 * outlive the page and keep streaming into sign-out and account deletion
 * (ADR 0009). For the selected household, the caller's own member document
 * is the anchor. It is the one household document always readable to its
 * owner, so its server-confirmed absence is the only thing that says access
 * was lost; the household, the members and the sent invites are listened to
 * only while it is live, and a refusal of any of them is the rules ending
 * the membership, not a fault.
 *
 * Every write is refused offline before it starts: a transaction needs the
 * server, and a household commit left queued would land long after the
 * state it was decided on. Each write is shaped for firestore.rules exactly:
 * the rules, not this service, decide who may do what. A membership ends in
 * a fixed order: its member document goes and its index entry is marked
 * ended in one commit, and the entry itself goes last.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly pwa = inject(PwaService);
  private readonly translation = inject(TranslationService);
  private readonly inviteCallable = inject(HOUSEHOLD_INVITE_CALLABLE);

  private readonly connected = signal(false);
  /** The account's index as its listener last answered; undefined until it has. */
  private readonly index = signal<HouseholdMembership[] | undefined>(undefined);
  /** The household asked for on this device: select(), or the one remembered. */
  private readonly preferred = signal<string | null>(null);
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
  private readonly lostSet = signal<ReadonlySet<string>>(new Set());
  /** The selected household's own member document as the server last confirmed it, while live. */
  private readonly confirmedOwn = signal<{ householdId: string; member: HouseholdMember } | null>(null);

  /** Every membership the account's index lists, earliest joined first. */
  readonly memberships = computed<HouseholdMembership[]>(() => this.index() ?? []);
  /** The memberships not marked ended, in the same order. */
  readonly liveMemberships = computed(() => this.memberships().filter(m => !m.ended));

  /**
   * The household the per-household view follows: the one asked for on this
   * device while it is a live membership, else the earliest joined live one;
   * null with none.
   */
  readonly selectedHouseholdId = computed<string | null>(() => {
    const live = this.liveMemberships();
    const preferred = this.preferred();
    return live.find(m => m.householdId === preferred)?.householdId ?? live[0]?.householdId ?? null;
  });

  readonly status = computed<HouseholdStatus>(() => {
    if (!this.connected()) return 'idle';
    if (this.index() === undefined) return 'loading';
    if (!this.selectedHouseholdId()) return 'none';
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
  /** The owner's pending invites into the selected household, newest first. */
  readonly sentInvites = computed(() => {
    const household = this.household();
    if (!household || !this.isOwner()) return [];
    return this.sentDocs().filter(invite => invite.householdId === household.id);
  });
  /**
   * The households whose membership, seen live in this session, the server
   * confirmed gone: a removal, or a dissolve by the owner. Never one the
   * caller is ending itself, nor anything the cache says. A household leaves
   * the set when it is seen live again, or when another membership is seen
   * live once the index no longer lists it as live.
   */
  readonly lostHouseholds = this.lostSet.asReadonly();
  /** Some membership seen live in this session is confirmed gone (lostHouseholds). */
  readonly lostAccess = computed(() => this.lostSet().size > 0);

  private connections = 0;
  private uid: string | null = null;
  /** The household the per-household listeners were opened for. */
  private followed: string | null = null;
  /** The membership (household, generation, role) the attached listeners serve. */
  private membershipKey: string | null = null;
  /** The selected household, once its membership was seen live, for telling a loss from a boot. */
  private liveHouseholdId: string | null = null;
  /**
   * Households this client is ending itself, so its own deletion is not
   * reported as lost access. One leaves the set when the ending fails, or
   * when its index entry is gone.
   */
  private readonly ending = new Set<string>();
  /**
   * Writes and reads already asked for in this session, by what they would
   * write: a refused or failed one is not tried again at every answer the
   * listeners bring.
   */
  private readonly asked = new Set<string>();
  /** The account whose profile was already looked at for a pointer from before the index. */
  private pointerCheckedFor: string | null = null;

  private indexSub: Subscription | null = null;
  private receivedSub: Subscription | null = null;
  private ownSub: Subscription | null = null;
  private householdSub: Subscription | null = null;
  private membersSub: Subscription | null = null;
  private sentSub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
    // One account's households must not outlive it (ADR 0009). This acts
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

    // A member document is how the others see the account, and nothing
    // else writes it after the join: a rename in Settings reaches it here,
    // the next time the account's own page is open. The selected household's
    // document is compared as its listener last confirmed it; every other
    // live membership's is read once from the server. Like the listeners,
    // this acts only while a page holds a connection.
    effect(() => {
      const own = this.confirmedOwn();
      const selected = this.selectedHouseholdId();
      const others = this.liveMemberships().filter(m => m.householdId !== selected);
      this.auth.currentUser();
      if (!this.pwa.isOnline()) return;
      untracked(() => {
        if (own) this.showAsProfile(own.householdId, own.member);
        for (const membership of others) this.showAsProfileIn(membership);
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

  /**
   * Makes a household the one the per-household view follows, and remembers
   * it on this device. A household that is not a live membership leaves the
   * default in place until it is one.
   */
  select(householdId: string): void {
    this.preferred.set(householdId);
    const uid = this.auth.userId();
    if (uid) writeSelection(uid, householdId);
    this.followSelection();
  }

  /**
   * Forms a household owned by the caller, selects it and returns its id.
   * Refused at MAX_HOUSEHOLDS_PER_ACCOUNT live memberships.
   */
  async create(name: string): Promise<string> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      const clean = this.validName(name);
      await this.refuseAtLimit(uid);
      const householdId = this.firestore.generateId('households');
      try {
        // One commit: the rules admit the household only with its owner's
        // member document and index entry, and createdAt and both copies of
        // since must be the request time, which only the server can stamp.
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
          tx.set(this.ref(indexPath(uid, householdId)), {
            since: serverTimestamp(),
            role: 'owner',
            name: clean,
            joinedAt: serverTimestamp()
          });
        });
      } catch (error) {
        if (!(await this.landedCreate(uid, householdId, error))) throw error;
      }
      this.select(householdId);
      return householdId;
    });
  }

  /**
   * Joins through the invite addressed to the caller, and selects the
   * household. The joiner cannot read the household before it belongs to it,
   * so the generation comes from the invite, copied unchanged onto the member
   * document and the index entry: the rules compare it to the microsecond.
   * Refused at MAX_HOUSEHOLDS_PER_ACCOUNT live memberships.
   *
   * Answers the household's name as the new member can now read it. The
   * invite holds a copy made when it was sent, which a rename since then
   * leaves behind; that copy is the answer only when the read fails.
   */
  async accept(householdId: string): Promise<string> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      await this.refuseAtLimit(uid, householdId);
      const inviteId = inviteIdOf(householdId, uid);
      const inviteRef = this.ref(invitePath(inviteId));
      const read: { invite?: HouseholdInvite } = {};
      // A new membership of this id: whatever ending of an earlier one this
      // client ran is over, and a later loss is real.
      this.ending.delete(householdId);
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
          read.invite = invite;
          tx.set(this.ref(memberPath(householdId, uid)), {
            ...this.identity(uid),
            role: 'member',
            since: invite.householdCreatedAt,
            joinedAt: serverTimestamp(),
            inviteId
          });
          tx.delete(inviteRef);
          tx.set(this.ref(indexPath(uid, householdId)), {
            since: invite.householdCreatedAt,
            role: 'member',
            name: invite.householdName,
            joinedAt: serverTimestamp()
          });
        });
      } catch (error) {
        if (!(await this.landedJoin(uid, householdId, read.invite, error))) {
          if (!isRefused(error) || !read.invite) throw error;
          throw this.joinRefusal(read.invite, error);
        }
      }
      this.select(householdId);
      const joined = await this.firestore.getDocument<Household>(householdPath(householdId)).catch(() => null);
      return joined?.name || read.invite?.householdName || '';
    });
  }

  /** Deletes the invite addressed to the caller. */
  async decline(householdId: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(() => this.deleteInvite(inviteIdOf(householdId, uid)));
  }

  /** Sends an invite into the selected household from its owner, through the callable. */
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

  /**
   * The owner removes another member of the selected household. The removed
   * member's index entry is its own to delete (tidyEndedMemberships).
   */
  async remove(memberUid: string): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId } = this.ownedMembership(uid);
      if (memberUid === uid) throw new HouseholdError(this.t('household.errors.ownerLeaves'));
      await this.commitDeletes([memberPath(householdId, memberUid)]);
    });
  }

  /** A member leaves the selected household. The owner cannot: it dissolves instead. */
  async leave(): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      const { householdId, member } = this.liveMembership(uid);
      if (member.role === 'owner') throw new HouseholdError(this.t('household.errors.ownerLeaves'));
      await this.endingMembership(householdId, () =>
        this.endOwnMembership(uid, householdId, { member: true, household: false }));
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
   * Ends every index entry whose membership the server says is over: a
   * removal, a dissolve, or an ending cut off part-way. What is left of each
   * goes in the usual order, an orphaned member document of the entry's own
   * generation with it. Also removes, once per account in a session, the
   * profile's householdId left from before the index. Answers whether
   * anything stale was ended.
   *
   * Each entry is judged by reads the server answers, never by the
   * listeners, which a page may not have connected and which can answer
   * from what they last heard. The listing of the entries is the exception
   * (indexEntries).
   */
  async tidyEndedMemberships(): Promise<boolean> {
    const uid = this.requireUser();
    return this.attempt(async () => {
      let tidied = false;
      for (const entry of await this.indexEntries(uid)) {
        const { state } = await this.membershipState(uid, entry);
        if (state === 'live') continue;
        if (await this.endEntry(uid, entry, state)) tidied = true;
      }
      return (await this.dropLeftoverPointer(uid)) || tidied;
    });
  }

  /**
   * For account deletion: every entry in the index is ended, live or not.
   * An owner dissolves, a member leaves, and what is left of an ended one is
   * cleared. Then every invite addressed to or sent by the account is
   * deleted, and this device forgets the household it last selected for the
   * account. The index outlives the profile, so a retry after a failure
   * finds whatever is left.
   */
  async deleteAll(): Promise<void> {
    const uid = this.requireUser();
    await this.attempt(async () => {
      for (const entry of await this.indexEntries(uid)) {
        const { state, own } = await this.membershipState(uid, entry);
        if (state === 'live' && own?.role === 'owner') {
          await this.dissolveHousehold(uid, entry.id, own.since);
        } else {
          await this.endEntry(uid, entry, state);
        }
      }
      const received = await this.inviteIdsWhere('inviteeUid', uid);
      const sent = await this.inviteIdsWhere('inviterUid', uid);
      await this.deleteInvites([...received, ...sent]);
      forgetSelection(uid);
      // After the whole walk, so no membership ended in it writes the
      // journal again behind the erasure.
      clearLedgerDeviceState(uid);
    });
  }

  private open(uid: string | null): void {
    this.uid = uid;
    if (!uid) {
      this.index.set([]);
      return;
    }

    this.preferred.set(readSelection(uid));
    this.indexSub = this.firestore.subscribeToCollection<IndexData>(indexCollectionPath(uid)).subscribe({
      next: entries => this.onIndex(entries),
      error: error => {
        this.quietly(error, 'memberships');
        this.index.set([]);
        this.followSelection();
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
    this.indexSub?.unsubscribe();
    this.receivedSub?.unsubscribe();
    this.indexSub = null;
    this.receivedSub = null;
    this.closeMembership();
    this.uid = null;
    this.followed = null;
    this.ending.clear();
    this.asked.clear();
    this.index.set(undefined);
    this.preferred.set(null);
    this.ownMemberDoc.set(undefined);
    this.receivedDocs.set([]);
    this.lostSet.set(new Set());
  }

  private onIndex(entries: IndexData[]): void {
    const memberships = entries.map(toMembership).sort(joinedFirst);
    const listed = new Set(memberships.map(m => m.householdId));
    // An ending this client ran is over once its entry is gone, so a later
    // loss of the same household is real.
    for (const householdId of [...this.ending]) {
      if (!listed.has(householdId)) this.ending.delete(householdId);
    }
    this.index.set(memberships);
    this.followSelection();
  }

  /** Points the per-household listeners at the selected household, when it changed. */
  private followSelection(): void {
    const uid = this.uid;
    if (!uid) return;
    // Untracked: a mock listener can answer synchronously, inside whatever
    // reactive context called connect().
    const householdId = untracked(this.selectedHouseholdId);
    if (householdId === this.followed) return;
    this.followed = householdId;
    this.closeMembership();
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
      this.liftLosses(householdId);
      this.attachMembership(uid, householdId, data);
      // Compared only against what the server holds: a cached copy can be
      // older than a write this account made on another device.
      if (confirmed) this.confirmedOwn.set({ householdId, member: data });
      return;
    }
    this.confirmedOwn.set(null);
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
    if (wasLive && !this.ending.has(householdId)) this.reportLoss(householdId);
  }

  private reportLoss(householdId: string): void {
    this.lostSet.update(lost => new Set(lost).add(householdId));
  }

  /**
   * The account is seen live in a household. That household's own loss is
   * over, and so is any loss whose entry the index no longer lists as live:
   * it was tidied, and the view has moved on. A loss whose entry is still
   * listed live stays until it is tidied or seen live again.
   */
  private liftLosses(householdId: string): void {
    const lost = untracked(this.lostSet);
    if (lost.size === 0) return;
    const listed = new Set(untracked(this.liveMemberships).map(m => m.householdId));
    const kept = [...lost].filter(id => id !== householdId && listed.has(id));
    if (kept.length < lost.size) this.lostSet.set(new Set(kept));
  }

  private attachMembership(uid: string, householdId: string, member: HouseholdMember): void {
    const key = `${householdId}|${member.since.seconds}.${member.since.nanoseconds}|${member.role}`;
    if (key === this.membershipKey) return;
    this.detachMembership();
    this.membershipKey = key;

    this.householdSub = this.firestore.subscribeToDocument<Household>(householdPath(householdId)).subscribe({
      next: household => {
        this.householdDoc.set(household);
        if (household) this.refreshIndexName(uid, household);
      },
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
    this.confirmedOwn.set(null);
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
   * Rewrites the name an index entry lists its household under when the
   * household now reads otherwise: a rename reaches each member's own
   * listing the next time that member opens the household. The name is a
   * copy for listing, so a failure is left for the next time.
   */
  private refreshIndexName(uid: string, household: Household): void {
    const listed = untracked(this.memberships).find(m => m.householdId === household.id);
    if (!listed || listed.ended || listed.name === household.name || !householdNameValid(household.name)) return;
    if (!this.pwa.isOnline() || !this.askOnce(`name|${household.id}|${household.name}`)) return;
    this.firestore
      .runTransaction(async tx => {
        tx.update(this.ref(indexPath(uid, household.id)), { name: household.name });
      })
      .catch(() => undefined);
  }

  /**
   * The owner's sent invites into this household go first: with none left,
   * nobody can join between the member sweep and the final commit. Invites
   * into another household it owns stay. The members are read from the
   * server, not from a listener that may hold a partial view.
   *
   * A step refused because the household is already gone means a dissolve
   * got there first: this one's own final commit, sent again after its
   * answer was lost, or another tab's. What is left of the membership is
   * cleared, which the rules allow once the household is gone, and the
   * dissolve stands (ADR 0156). The index entry goes last either way.
   */
  private dissolveHousehold(uid: string, householdId: string, since: Timestamp): Promise<void> {
    return this.endingMembership(householdId, async () => {
      try {
        await this.deleteInvites(await this.inviteIdsWhere('inviterUid', uid, householdId));
        const members = await this.firestore.getCollectionFromServer<HouseholdMember>(membersPath(householdId), {
          where: [{ field: 'since', op: '==', value: since }]
        });
        const others = members.map(member => member.uid).filter(memberUid => memberUid !== uid);
        for (const chunk of chunked(others)) {
          await this.commitDeletes(chunk.map(memberUid => memberPath(householdId, memberUid)));
        }
        await this.markEnded(uid, householdId, { member: true, household: true });
      } catch (error) {
        if (!isRefused(error) || !(await this.householdGone(householdId))) throw error;
        await this.markEnded(uid, householdId, { member: true, household: false });
      }
      await this.dropIndex(uid, householdId);
    });
  }

  /**
   * Whether the household is gone, asked of the server as the rules stand
   * now. A plain get is answered by a listener still attached to the
   * household from what it last heard, which after a refused commit can be
   * the household that commit found gone; a transaction's read always goes
   * to the server, and this one is abandoned before it commits. A get of a
   * household that is gone is refused rather than answered empty, and an
   * unanswered read proves nothing gone.
   */
  private async householdGone(householdId: string): Promise<boolean> {
    const readOnly = new Error('read only');
    let gone = false;
    try {
      await this.firestore.runTransaction(async tx => {
        gone = !(await tx.get(this.ref(householdPath(householdId)))).exists();
        throw readOnly;
      });
    } catch (error) {
      return error === readOnly ? gone : isRefused(error);
    }
    return gone;
  }

  /**
   * Runs work that ends one of this account's own memberships, so its
   * listeners hearing the member document go do not report that as lost
   * access. Work that fails, or answers false because the membership turned
   * out not to be its to end, leaves a later loss to be reported.
   */
  private async endingMembership(householdId: string, work: () => Promise<boolean | void>): Promise<void> {
    this.ending.add(householdId);
    try {
      if ((await work()) === false) this.ending.delete(householdId);
    } catch (error) {
      this.ending.delete(householdId);
      throw error;
    }
  }

  /**
   * What is left of one entry's membership, ended in order as an ending of
   * the account's own. `state` is the server's judgement of the entry as
   * listed; answers false, having written nothing, when the entry no longer
   * reads as it did then.
   */
  private async endEntry(uid: string, entry: IndexData, state: MembershipState): Promise<boolean> {
    let ended = false;
    await this.endingMembership(entry.id, async () => {
      if (state === 'gone' && entry.endedAt !== undefined) {
        await this.dropIndex(uid, entry.id);
        ended = true;
      } else {
        ended = await this.endOwnMembership(uid, entry.id, { member: state !== 'gone', household: false }, entry);
      }
      return ended;
    });
    return ended;
  }

  /**
   * The two steps that end a membership in order: marked ended with its
   * member document gone, then the entry. Answers false, having written
   * nothing, when the entry no longer reads as `judged` (markEnded).
   */
  private async endOwnMembership(
    uid: string,
    householdId: string,
    parts: { member: boolean; household: boolean },
    judged?: IndexData
  ): Promise<boolean> {
    if (!(await this.markEnded(uid, householdId, parts, judged))) return false;
    await this.dropIndex(uid, householdId);
    return true;
  }

  /**
   * One commit: the household (for a dissolve), the caller's own member
   * document (when there is one), and the ending marked on the index entry.
   * The entry is read in the same transaction: one another tab already
   * deleted, or already marked, is left as it is, so a second ending of the
   * same membership still lands.
   *
   * `judged` is the entry as a server judgement found it, for an ending the
   * judgement decided (a tidy, an erasure). When the transaction reads the
   * entry as another join, or gone, the commit is abandoned unwritten: a
   * join of the same household since the judgement writes the entry again
   * with a fresh joinedAt beside a live member document, which this commit
   * would otherwise mark ended, or delete as an orphan; and an entry already
   * gone was ended in full by whoever deleted it. Answers whether it
   * committed.
   */
  private async markEnded(
    uid: string,
    householdId: string,
    parts: { member: boolean; household: boolean },
    judged?: IndexData
  ): Promise<boolean> {
    const entryRef = this.ref(indexPath(uid, householdId));
    const moved = new Error('entry moved');
    try {
      await this.firestore.runTransaction(async tx => {
        const snapshot = await tx.get(entryRef);
        const entry = snapshot.exists() ? (snapshot.data() as IndexData) : null;
        if (judged && !(entry && sameJoin(entry, judged))) throw moved;
        if (parts.household) tx.delete(this.ref(householdPath(householdId)));
        if (parts.member) tx.delete(this.ref(memberPath(householdId, uid)));
        if (entry && entry.endedAt === undefined) {
          tx.update(entryRef, { endedAt: serverTimestamp() });
        }
      });
    } catch (error) {
      if (error === moved) return false;
      throw error;
    }
    return true;
  }

  /** The last step of every ending. The rules let it through only once the membership is gone. */
  private dropIndex(uid: string, householdId: string): Promise<void> {
    return this.commitDeletes([indexPath(uid, householdId)]);
  }

  /**
   * What a refused join most likely ran into, worked out from the invite it
   * read. The rules refuse one for an expired invite, or a household or
   * generation that is gone, and do not say which.
   */
  private joinRefusal(invite: HouseholdInvite, cause: unknown): HouseholdError {
    if (millisOf(invite.expiresAt) <= Date.now() + EXPIRY_CLOCK_MARGIN_MS) {
      return new HouseholdError(this.t('household.errors.expired'), { cause });
    }
    return new HouseholdError(this.t('household.errors.inviteGone'), { cause });
  }

  /**
   * Whether a create answered with a refusal had in fact landed: a commit
   * sent again after its answer was lost is judged against what its first
   * delivery left, and refused. It landed when the server holds the
   * household with the caller's owner document of its generation. Read from
   * the server: nothing else can say what the refused commit found.
   */
  private async landedCreate(uid: string, householdId: string, error: unknown): Promise<boolean> {
    if (!isRefused(error)) return false;
    try {
      const createdAt = await this.liveGeneration(householdId);
      if (!createdAt) return false;
      const own = await this.firestore.getDocumentFromServer<HouseholdMember>(memberPath(householdId, uid));
      return own?.role === 'owner' && sameStamp(own.since, createdAt);
    } catch {
      return false;
    }
  }

  /**
   * Whether a join answered with a refusal, or with its invite gone, had in
   * fact landed: sent again after its answer was lost, the join reads an
   * invite its first delivery consumed; pressed twice, the second meets the
   * first's member document. It landed when the server holds the caller's
   * member document of the invite's generation, or, with no invite read,
   * of the household's live one.
   */
  private async landedJoin(
    uid: string,
    householdId: string,
    invite: HouseholdInvite | undefined,
    error: unknown
  ): Promise<boolean> {
    if (!isRefused(error) && !(error instanceof HouseholdError)) return false;
    try {
      const own = await this.firestore.getDocumentFromServer<HouseholdMember>(memberPath(householdId, uid));
      if (!own || !isStamp(own.since)) return false;
      if (invite) return sameStamp(own.since, invite.householdCreatedAt);
      return sameStamp(await this.liveGeneration(householdId), own.since);
    } catch {
      // An unanswered read proves nothing landed: the first answer stands.
      return false;
    }
  }

  /**
   * The household's generation as the server holds it, or null when the
   * caller cannot read it: only a live member may, and a get of a household
   * that is gone is refused rather than answered empty.
   */
  private async liveGeneration(householdId: string): Promise<Timestamp | null> {
    try {
      const household = await this.firestore.getDocumentFromServer<Household>(householdPath(householdId));
      return household && isStamp(household.createdAt) ? household.createdAt : null;
    } catch (error) {
      if (isRefused(error)) return null;
      throw error;
    }
  }

  /**
   * The server's word on one index entry. A member document of another
   * generation is not the entry's own: it reads as gone, and is left where
   * it is.
   */
  private async membershipState(
    uid: string,
    entry: IndexData
  ): Promise<{ state: MembershipState; own: HouseholdMember | null }> {
    const own = await this.firestore.getDocumentFromServer<HouseholdMember>(memberPath(entry.id, uid));
    if (!own || !sameStamp(own.since, entry.since)) return { state: 'gone', own: null };
    const createdAt = await this.liveGeneration(entry.id);
    return { state: sameStamp(createdAt, own.since) ? 'live' : 'orphan', own };
  }

  /**
   * Every entry in the account's index. While the page's index listener is
   * attached, the SDK answers this from that listener's last synced view
   * rather than a fresh server read; an entry that view has yet to hear of
   * is left for the next tidy, or the next erasure run.
   */
  private indexEntries(uid: string): Promise<IndexData[]> {
    return this.firestore.getCollectionFromServer<IndexData>(indexCollectionPath(uid));
  }

  /**
   * The limit on live memberships. Counted first by two aggregations on the
   * server, every index entry less those marked ended, rather than a
   * listing, which opens a listen stream on the client just to be read
   * once. Only an account the count puts at the limit pays for more: its
   * unended entries are listed and each is judged on the server as
   * tidyEndedMemberships judges it, so one whose membership ended without
   * this client (a removal, a dissolve) is not counted, and is ended on the
   * way. That ending is a tidy's, and a failure of it leaves the entry for
   * the next one without holding up the join or create. A join of a
   * household whose entry is listed unended (a rejoin) is not one more: the
   * join writes that entry again.
   */
  private async refuseAtLimit(uid: string, joining?: string): Promise<void> {
    const path = indexCollectionPath(uid);
    const [all, ended] = await Promise.all([
      this.firestore.aggregateFromServer(path, undefined, { count: true }),
      this.firestore.aggregateFromServer(path, { where: [ENDED_ENTRIES] }, { count: true })
    ]);
    let live = (all.count ?? 0) - (ended.count ?? 0);
    if (live < MAX_HOUSEHOLDS_PER_ACCOUNT) return;
    for (const entry of await this.indexEntries(uid)) {
      if (entry.endedAt !== undefined) continue;
      if (entry.id === joining) {
        live--;
        continue;
      }
      const { state } = await this.membershipState(uid, entry);
      if (state === 'live') continue;
      live--;
      await this.endEntry(uid, entry, state).catch(() => false);
    }
    if (live >= MAX_HOUSEHOLDS_PER_ACCOUNT) {
      throw new HouseholdError(this.t('household.errors.tooMany', { max: MAX_HOUSEHOLDS_PER_ACCOUNT }));
    }
  }

  /**
   * Removes the profile's householdId, the one-household pointer the index
   * replaced: the rules accept only its removal. Looked at once per account
   * in a session, read from the server, which alone says it is still there.
   */
  private async dropLeftoverPointer(uid: string): Promise<boolean> {
    if (this.pointerCheckedFor === uid) return false;
    const profile = await this.firestore.getDocumentFromServer<Record<string, unknown>>(profilePath(uid));
    const left = !!profile && 'householdId' in profile;
    if (left) {
      await this.firestore.runTransaction(async tx => {
        tx.update(this.ref(profilePath(uid)), { householdId: deleteField() });
      });
    }
    this.pointerCheckedFor = uid;
    return left;
  }

  /**
   * The ids of the invites addressed to, or sent by, the account; given a
   * household, only those into it. That one is kept on the client, so the
   * listing stays the single-field query the rules already admit.
   */
  private async inviteIdsWhere(
    field: 'inviteeUid' | 'inviterUid',
    uid: string,
    householdId?: string
  ): Promise<string[]> {
    const invites = await this.firestore.getCollectionFromServer<HouseholdInvite>(INVITES, {
      where: [{ field, op: '==', value: uid }]
    });
    return invites.filter(invite => !householdId || invite.householdId === householdId).map(invite => invite.id);
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

  /** Whether a write or read keyed so has yet to be asked for in this session; asking marks it. */
  private askOnce(key: string): boolean {
    if (this.asked.has(key)) return false;
    this.asked.add(key);
    return true;
  }

  /**
   * Rewrites the own member document's name and picture when the profile
   * shows the account otherwise. The rules let a member change exactly these
   * two fields of its own document. Compared as identity() writes them,
   * clipped and filtered, or a name the rules clip would be written again at
   * every answer. A failure is left alone: it is a removal or a dissolve
   * racing the write, or a lost connection. The same identity is asked for
   * once per household in a session, so a refused write is not retried at
   * every answer the listener brings.
   */
  private showAsProfile(householdId: string, stored: HouseholdMember): void {
    const uid = this.uid;
    if (!uid || stored.uid !== uid) return;
    const wanted = this.identity(uid);
    if (stored.displayName === wanted.displayName && stored.photoURL === wanted.photoURL) return;
    if (!this.askOnce(`identity|${householdId}|${wanted.displayName}|${wanted.photoURL ?? ''}`)) return;
    this.firestore
      .runTransaction(async tx => {
        tx.update(this.ref(memberPath(householdId, uid)), {
          displayName: wanted.displayName,
          photoURL: wanted.photoURL ?? deleteField()
        });
      })
      .catch(() => undefined);
  }

  /**
   * showAsProfile for a live membership other than the selected one, whose
   * member document no listener holds: read once from the server per
   * identity in a session. A document of another generation is not this
   * membership's to rewrite.
   */
  private showAsProfileIn(membership: HouseholdMembership): void {
    const uid = this.uid;
    const since = membership.since;
    if (!uid || !since) return;
    const wanted = this.identity(uid);
    if (!this.askOnce(`read|${membership.householdId}|${wanted.displayName}|${wanted.photoURL ?? ''}`)) return;
    this.firestore
      .getDocumentFromServer<HouseholdMember>(memberPath(membership.householdId, uid))
      .then(stored => {
        if (stored && this.uid === uid && sameStamp(stored.since, since)) {
          this.showAsProfile(membership.householdId, stored);
        }
      })
      .catch(() => undefined);
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
    if (!householdNameValid(name)) {
      throw new HouseholdError(this.t('household.errors.name', { max: HOUSEHOLD_NAME_MAX_LENGTH }));
    }
    return name.trim();
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
      case 'too-many': return this.t('household.errors.inviteeTooMany', { max: MAX_HOUSEHOLDS_PER_ACCOUNT });
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
