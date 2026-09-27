import { Injectable, OnDestroy, inject } from '@angular/core';
import { Timestamp, arrayRemove, arrayUnion } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import {
  Category,
  FULL_SWEEP_EVERY_MS,
  Household,
  HouseholdMember,
  HouseholdMembership,
  LEDGER_COMMIT_CHUNK,
  LEDGER_OWN_WRITE_CHUNK,
  LEDGER_PURGE_CHUNK,
  LEDGER_QUERY_SHAPES,
  LedgerCopy,
  LedgerCopyProjection,
  LedgerQueryShape,
  MAX_BULK_SHARE,
  Transaction,
  householdIndexPath,
  ledgerCopyId,
  ledgerCopyPath,
  normalizeShares,
  shareKey
} from '../../models';
import { AuthService } from './auth.service';
import { BatchOp, FirestoreService, QueryOptions } from './firestore.service';
import { PwaService } from './pwa.service';
import { defaultCategories, mergeCategories } from '../utils/category-merge.utils';
import { ProjectableRow, copyDiffers, projectRow } from '../utils/ledger-projection.utils';
import { errorCode, isRefused } from '../utils/firebase-error.utils';
import { HouseholdIndexData, isStamp, sameStamp, toMembership } from '../utils/household-index.utils';
import {
  LedgerJournalRow,
  clearFullPass,
  forgetJournalHousehold,
  journalRows,
  markFullPass,
  readLedgerJournal,
  readSweepStamps,
  settleJournalRows,
  stampSweep
} from './ledger-journal';

/**
 * Copy deletes, each with the arrayRemove of its row's key, per unshare
 * commit: two writes a pair, neither judged with a lookup, so a commit holds
 * as many writes as LEDGER_OWN_WRITE_CHUNK.
 */
export const LEDGER_UNSHARE_PAIRS_PER_COMMIT = LEDGER_OWN_WRITE_CHUNK / 2;

/**
 * How long after a refused copy write the journal is repaired. The refusal
 * is often one of several writes still settling (an edit made from a stale
 * cache, a membership just ended), and the repair reads the server only
 * once they have.
 */
export const LEDGER_REPAIR_DELAY_MS = 2000;

/** Rows, each with its copy, a repair reads from the server at once. */
const REPAIR_READS_AT_ONCE = 10;

/**
 * The generation both projections of an unchanged-edit test are given: the
 * test asks whether the row's revealed fields changed, whichever household
 * the copy is in.
 */
const ANY_GENERATION = new Timestamp(0, 0);

const LOG = '[LedgerShareService]';

/** Why the service swept: the app starting, a connection back, the household page, a restore. */
export type LedgerSweepReason = 'start' | 'reconnect' | 'page' | 'restore';

/**
 * A check compares a server count of each side and settles when they agree;
 * a full pass lists both sides and diffs them copy by copy.
 */
export type LedgerReconcileMode = 'check' | 'full';

/** What one reconcile of a household's copies did. */
export interface LedgerReconcileReport {
  /** The pass that settled the household. */
  pass: LedgerReconcileMode;
  /** Copies a full pass wrote: missing, different or of another generation. */
  written: number;
  /** Copies a full pass took out. */
  deleted: number;
}

/**
 * A row as follow is handed it, whole or composed from an edit. Only the
 * fields a copy reveals and `sharedWith` are read; nothing else of it
 * reaches a copy.
 */
export type LedgerFollowedRow = Partial<Transaction>;

/** One row's change as its copies follow it: the row's id, the row before (null for a new row) and after. */
export type LedgerRowChange = readonly [txId: string, before: LedgerFollowedRow | null, after: LedgerFollowedRow | null];

/**
 * How far a share or an unshare of many rows has got: `done` of the `total`
 * rows asked for have had their commit answered (for a share, the commit of
 * their copies, or no commit at all for rows gone meanwhile). Called only
 * online, where the commits take their time; offline a share or unshare
 * resolves as soon as it is queued.
 */
export type LedgerShareProgress = (done: number, total: number) => void;

/**
 * - `tooMany`: more rows than one bulk action takes (MAX_BULK_SHARE).
 * - `notMember`: a household that is not one of the account's live memberships.
 * - `notOwner`: another member's copies, which only the household's owner purges.
 */
export type LedgerShareRefusalReason = 'tooMany' | 'notMember' | 'notOwner';

/** A share, unshare, reconcile or purge refused before anything was read or written. */
export class LedgerShareRefusal extends Error {
  constructor(readonly reason: LedgerShareRefusalReason, message: string) {
    super(message);
    this.name = 'LedgerShareRefusal';
  }
}

type LiveMembership = HouseholdMembership & { since: Timestamp };
type StoredCopy = Partial<LedgerCopy> & { id: string };
type Where = NonNullable<QueryOptions['where']>[number];

/** One copy to write: its household, its row and the row's projection. */
interface CopyWrite {
  hid: string;
  txId: string;
  data: LedgerCopyProjection;
}

/** The server's word on a membership: live of a generation, over, or not known. */
type MembershipJudgement = { since: Timestamp } | 'ended' | 'unknown';

interface Followed {
  before: LedgerFollowedRow | null;
  after: LedgerFollowedRow | null;
}

/** What the service holds for the signed-in account, dropped when another signs in. */
interface AccountState {
  readonly uid: string;
  index?: HouseholdMembership[];
  indexLoad?: Promise<HouseholdMembership[]>;
  /**
   * The built-ins overlaid with the account's own (mergeCategories), as last
   * read or heard: a listener keeps them current once the first load starts.
   */
  categories?: Category[];
  categoriesLoad?: Promise<Category[]>;
  categoriesWatch?: Subscription;
  /** Category ids read again for since this account was loaded, and the reads still under way. */
  readonly categoriesReadFor: Set<string>;
  readonly categoryReads: Map<string, Promise<void>>;
  /** Follows made before the account was loaded, by row, in the order first made. */
  readonly deferred: Map<string, Followed>;
  draining: boolean;
  /** Copy writes issued and not yet answered, by journal key. */
  readonly inFlight: Map<string, number>;
  /**
   * How many times each journal key was journaled with no write issued for
   * it, for the repair to settle: a household the row stopped naming, one
   * ending or not yet listed, a row no copy may hold. An answer to a write
   * issued before the latest of these settles nothing: that write is older
   * than what is owed.
   */
  readonly owed: Map<string, number>;
  repairTimer?: ReturnType<typeof setTimeout>;
  sweep?: Promise<void>;
  rerun?: LedgerSweepReason;
}

const rowsPath = (uid: string) => `users/${uid}/transactions`;
const rowPath = (uid: string, txId: string) => `${rowsPath(uid)}/${txId}`;
const categoriesPath = (uid: string) => `users/${uid}/categories`;
const householdPath = (hid: string) => `households/${hid}`;
const memberPath = (hid: string, uid: string) => `households/${hid}/members/${uid}`;
const ledgerPath = (hid: string) => `households/${hid}/ledger`;
const journalKey = (row: LedgerJournalRow) => `${row.hid}/${row.txId}`;

const namingKey = (key: string): Where => ({ field: 'sharedWith', op: 'array-contains', value: key });
const authoredBy = (uid: string): Where => ({ field: 'memberUid', op: '==', value: uid });

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** A membership copies are written for: not ending, and its generation known. */
function isLive(membership: HouseholdMembership | undefined): membership is LiveMembership {
  return !!membership && !membership.ended && membership.since !== null;
}

/**
 * The row as projectRow reads it, or null when a revealed field holds what
 * no copy may: the rules would refuse the copy, and a field still to be
 * set by the server (a sentinel) has no value to copy yet. The author is
 * the signed-in account, whose rows alone it may copy.
 */
function projectable(uid: string, txId: string, row: LedgerFollowedRow | null | undefined): ProjectableRow | null {
  if (!row) return null;
  const { type, amount, currency, date, description, categoryId } = row;
  if (type !== 'income' && type !== 'expense') return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (typeof currency !== 'string' || typeof description !== 'string' || typeof categoryId !== 'string') return null;
  if (!isStamp(date)) return null;
  return { id: txId, userId: uid, type, amount, currency, date, description, categoryId };
}

/** What one change of a row does to its copies, household by household. */
interface CopiesTouched {
  /** The row after the change as a copy is projected from it, or null when no copy may hold it. */
  next: ProjectableRow | null;
  /** The households the row names after the change. */
  named: string[];
  /** The households whose copy the change writes: each it names (or each of `only`) but those whose copy it leaves as it was. */
  targets: string[];
  /** The households the row stopped naming, whose copy the repair takes out. */
  unshared: string[];
}

/**
 * The one rule for which copies a change touches, so what intend journals
 * before a commit is what follow writes or leaves to the repair after it.
 * Both sides are projected from the same categories and generation: across
 * one change of a row, its copy changes only with the fields it reveals.
 */
function copiesTouched(
  uid: string,
  txId: string,
  followed: Followed,
  categories: readonly Category[],
  only?: readonly string[]
): CopiesTouched {
  const named = normalizeShares(followed.after?.sharedWith);
  const beforeHids = normalizeShares(followed.before?.sharedWith);
  const next = projectable(uid, txId, followed.after);
  const previous = projectable(uid, txId, followed.before);
  const unchanged = !!next && !!previous
    && !copyDiffers(projectRow(previous, categories, ANY_GENERATION), projectRow(next, categories, ANY_GENERATION));
  return {
    next,
    named,
    targets: (only ?? named).filter(hid => !(unchanged && beforeHids.includes(hid))),
    unshared: beforeHids.filter(hid => !named.includes(hid))
  };
}

/**
 * The equality filters of a query shape, in the shape's field order, so the
 * query is the one its declared composite serves (the ledger contract check
 * holds each shape to its composite).
 */
function equalities(shape: LedgerQueryShape, values: Readonly<Record<string, unknown>>): Where[] {
  return shape.fields.map(([field]) => {
    if (!(field in values)) throw new Error(`No value for ${field}, which the query shape filters on`);
    return { field, op: '==', value: values[field] };
  });
}

function groupByHousehold(rows: readonly LedgerJournalRow[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const { hid, txId } of rows) {
    const txIds = groups.get(hid) ?? [];
    if (!txIds.includes(txId)) txIds.push(txId);
    groups.set(hid, txIds);
  }
  return groups;
}

/**
 * Keeps each household's copies of the account's shared rows
 * (households/{hid}/ledger/{uid}_{txId}) true to the rows, and takes them
 * out with a membership's end.
 *
 * A copy is written in a commit of copies only, after the personal write it
 * follows was issued, and never in the same commit: the rules may refuse a
 * copy (copyFaithful judges it against the row as the commit leaves it; an
 * ended membership writes none), and a refused copy must never take a
 * personal write down with it. Only deletes of the account's own copies share
 * a commit with a row write: an unshare's, beside its arrayRemove, and a row
 * delete's, of the copy in every membership, beside the row delete (in the
 * same transaction for a goal-linked row). The rules judge an author's delete
 * of its own copy without a lookup and never refuse it.
 *
 * So a copy can be missing or behind, and three layers bring it back:
 * - the journal (ledger-journal.ts): each copy write is journaled before it
 *   is issued and settled once acknowledged; repairJournal reads what is
 *   left from the server and writes or deletes each copy;
 * - a check: a server count of the rows naming a household against the
 *   account's copies in it, settled when they agree. It counts only (see
 *   sidesAgree), so a copy behind in its fields alone waits for the journal
 *   or the full pass;
 * - a full pass: both sides listed and diffed, weekly, when the journal marks
 *   a household, after a restore, and whenever a check disagrees.
 *
 * Reached only by dynamic import, so it stays out of the initial bundle: the
 * services that write rows load it when they need it, and app.config.ts arms
 * the start-up and reconnect sweeps with an idle import. It injects no other
 * domain service: the account's memberships are read here, once per account
 * and again by each sweep, and its categories are read once and then heard
 * from a listener of its own, so a copy is projected from the categories as
 * they stand, a change made on another device included.
 */
@Injectable({ providedIn: 'root' })
export class LedgerShareService implements OnDestroy {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly pwa = inject(PwaService);

  private state: AccountState | null = null;
  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.dropState();
  }

  /**
   * Loads the account's memberships and categories, so a follow made after
   * it resolves issues its writes before it returns. The categories are
   * heard from then on.
   */
  async prepare(): Promise<void> {
    const state = this.stateFor(this.requireUser());
    await Promise.all([this.loadIndex(state), this.loadCategories(state)]);
  }

  /**
   * Every entry in the account's index (users/{uid}/households), ended ones
   * included, read afresh: from the server when online, from the cache when
   * not. What follow uses until the next read.
   */
  membershipsOnce(): Promise<HouseholdMembership[]> {
    return this.loadIndex(this.stateFor(this.requireUser()), true);
  }

  /**
   * Carries a row's change to its copies: `before` is the row as it was
   * (null for a new row), `after` as the personal write just issued leaves
   * it. Call it right after issuing that write and before awaiting it: the
   * copy writes are issued behind it, in the same persistent queue, before
   * this returns. Once the account is loaded (prepare), that is; until then
   * each household the row names is journaled at once and the writes follow
   * the load.
   *
   * One commit per live household the row names whose copy changes. A
   * household `before` names and `after` does not is journaled for the
   * repair, which takes its copy out: an unshare does that itself, and this
   * never deletes. A household that is ending, or whose row holds a value no
   * copy may, is journaled for the repair too. Never throws.
   *
   * A change a transaction commits comes another way: it is journaled with
   * intend before the commit and handed to followMany once the commit has
   * landed, so its copy writes are issued after the commit rather than
   * queued behind a write.
   */
  follow(txId: string, before: LedgerFollowedRow | null, after: LedgerFollowedRow | null): void {
    try {
      const uid = this.auth.userId();
      if (!uid) return;
      const named = [...new Set([...normalizeShares(after?.sharedWith), ...normalizeShares(before?.sharedWith)])];
      if (named.length === 0) return;
      const state = this.stateFor(uid);
      if (this.loaded(state)) {
        this.followNow(state, txId, { before, after });
        return;
      }
      this.owe(state, named.map(hid => ({ hid, txId })));
      this.defer(state, txId, { before, after });
    } catch (error) {
      this.warn('A row\'s copies were not followed; the journal and the sweep repair them', error);
    }
  }

  /**
   * follow for the changes one transaction committed, once its commit has
   * landed: each row by follow's rule, the copy writes grouped by household
   * and issued before this returns, at most LEDGER_COMMIT_CHUNK to a commit,
   * so the rows of a split share their commits rather than taking one each.
   * Until the account is loaded, each change goes to follow. A row appears
   * at most once among the changes. Never throws.
   */
  followMany(changes: readonly LedgerRowChange[]): void {
    try {
      const uid = this.auth.userId();
      if (!uid) return;
      const shared = changes.filter(([, before, after]) =>
        normalizeShares(after?.sharedWith).length > 0 || normalizeShares(before?.sharedWith).length > 0);
      if (shared.length === 0) return;
      const state = this.stateFor(uid);
      if (!this.loaded(state)) {
        for (const change of shared) this.follow(...change);
        return;
      }
      const writes: CopyWrite[] = [];
      for (const [txId, before, after] of shared) this.followNow(state, txId, { before, after }, undefined, writes);
      const byHousehold = new Map<string, CopyWrite[]>();
      for (const write of writes) byHousehold.set(write.hid, [...(byHousehold.get(write.hid) ?? []), write]);
      for (const household of byHousehold.values()) {
        for (const chunk of chunked(household, LEDGER_COMMIT_CHUNK)) {
          try {
            void this.issue(state, chunk, true);
          } catch (error) {
            this.owe(state, chunk.map(({ hid, txId }) => ({ hid, txId })));
            this.warn('A copy write was not issued; the journal keeps it for the repair', error);
          }
        }
      }
    } catch (error) {
      this.warn('Rows\' copies were not followed; the journal and the sweep repair them', error);
    }
  }

  /**
   * Journals, before a transaction commits a row's change, each household
   * whose copy the change will write or take out, so a copy the app never
   * gets to follow (it stops between the commit and the follow) is still
   * repaired. Takes what follow takes and applies the same rule
   * (copiesTouched), so an edit that leaves the copies as they were journals
   * nothing. It issues nothing and reads nothing: once the commit lands, the
   * change is handed to followMany, whose acknowledged writes settle the
   * entries. A commit that never lands leaves them to the repair, which finds
   * the row as it stands. Never throws.
   */
  intend(txId: string, before: LedgerFollowedRow | null, after: LedgerFollowedRow | null): void {
    try {
      const uid = this.auth.userId();
      if (!uid) return;
      // Projected with no categories read: both sides share whichever are
      // used, so they cannot decide whether the copy changes.
      const { targets, unshared } = copiesTouched(uid, txId, { before, after }, []);
      const hids = [...targets, ...unshared];
      if (hids.length > 0) this.owe(this.stateFor(uid), hids.map(hid => ({ hid, txId })));
    } catch (error) {
      this.warn('A row\'s change was not journaled; the sweep repairs its copies', error);
    }
  }

  /**
   * Shares rows into a household: the key is added to each row with
   * arrayUnion, in commits of at most LEDGER_OWN_WRITE_CHUNK, then each copy
   * is written, at most LEDGER_COMMIT_CHUNK per commit. A row deleted since
   * it was chosen is passed over. Offline, a single row's copy is queued
   * behind its key, from the row as the cache holds it; for more rows only
   * the key writes queue, and the household is marked for a full pass, which
   * writes the copies once the device is back. Resolves once the writes are
   * answered, or offline once they are queued. Rejects only when the keys
   * did not all land (or the household is refused): once they have, a copy
   * that could not be written is left to a full pass. `progress` hears the
   * rows done as each commit of copies is answered.
   */
  async share(txIds: readonly string[], householdId: string, progress?: LedgerShareProgress): Promise<void> {
    const uid = this.requireUser();
    const ids = [...new Set(txIds)];
    this.refuseBulk(ids);
    const state = this.stateFor(uid);
    const membership = (await this.loadIndex(state, true)).find(entry => entry.householdId === householdId);
    if (!isLive(membership)) {
      throw new LedgerShareRefusal('notMember', 'Rows are shared only into a household the account belongs to');
    }
    if (ids.length === 0) return;

    const key = shareKey(householdId);
    const keyed = chunked(ids, LEDGER_OWN_WRITE_CHUNK).map(chunk => this.keyRows(uid, key, chunk));
    if (!this.pwa.isOnline()) {
      this.quietly(keyed, 'A share queued offline did not land');
      if (ids.length === 1) await this.shareOneOffline(state, ids[0], householdId);
      else markFullPass(uid, householdId);
      return;
    }
    try {
      await Promise.all(keyed);
    } catch (error) {
      // Other chunks may have landed: their rows name the household with no
      // copies yet.
      markFullPass(uid, householdId);
      throw error;
    }

    // From here the rows name the household, so the share has gone through
    // and a failure resolves: a caller reads a rejection as the key not
    // landing. Copies this phase does not write are owed to a full pass, as
    // a refused copy write is to the journal.
    try {
      // The rows as this device's writes leave them, the key included: the
      // copies are judged against the same.
      const categories = await this.loadCategories(state);
      const copies: Promise<boolean>[] = [];
      let done = 0;
      for (const chunk of chunked(ids, LEDGER_COMMIT_CHUNK)) {
        const rows = await Promise.all(chunk.map(txId => this.firestore.getDocument<Transaction>(rowPath(uid, txId))));
        const writes: CopyWrite[] = [];
        chunk.forEach((txId, i) => {
          const source = normalizeShares(rows[i]?.sharedWith).includes(householdId) ? projectable(uid, txId, rows[i]) : null;
          if (source) writes.push({ hid: householdId, txId, data: projectRow(source, categories, membership.since) });
        });
        const rowsDone = () => {
          done += chunk.length;
          this.report(progress, done, ids.length);
        };
        // issue() never rejects: the rows are done whether the commit landed
        // or was left to the journal.
        if (writes.length > 0) copies.push(this.issue(state, writes, true).finally(rowsDone));
        else rowsDone();
      }
      await Promise.all(copies);
    } catch (error) {
      markFullPass(uid, householdId);
      this.warn('A share\'s copies were not all written; a full pass writes them', error);
    }
  }

  /**
   * Stops sharing rows with a household: each copy's delete and its row's
   * arrayRemove in one commit, at most LEDGER_UNSHARE_PAIRS_PER_COMMIT pairs
   * each. The rules refuse neither, member or not, so it works offline and
   * after a membership has ended. A row gone meanwhile still has its copy
   * taken out. Settles once every commit is answered, rejecting with the
   * first refusal, or offline resolves once they are queued. `progress`
   * hears the rows done as each commit is answered, never after it settles.
   */
  async unshare(txIds: readonly string[], householdId: string, progress?: LedgerShareProgress): Promise<void> {
    const uid = this.requireUser();
    const ids = [...new Set(txIds)];
    this.refuseBulk(ids);
    const key = shareKey(householdId);
    const chunks = chunked(ids, LEDGER_UNSHARE_PAIRS_PER_COMMIT);
    const commits = chunks.map(chunk => this.unshareChunk(uid, householdId, key, chunk));
    if (!this.pwa.isOnline()) {
      this.quietly(commits, 'An unshare queued offline did not land');
      return;
    }
    let done = 0;
    // Every commit is waited for, a refused one included: the others are
    // still in flight, and a report after the unshare settled would reach a
    // caller that has moved on.
    const answers = await Promise.allSettled(commits.map((commit, i) => commit.then(() => {
      done += chunks[i].length;
      this.report(progress, done, ids.length);
    })));
    const refused = answers.find((answer): answer is PromiseRejectedResult => answer.status === 'rejected');
    if (refused) throw refused.reason;
  }

  /**
   * Settles what the journal holds, online only, once every write this
   * device issued before it has been answered. Each row and its copy are read
   * from the server: a row that names a live household has its copy written
   * as the row stands; a row gone, or no longer naming the household, has
   * its copy taken out; a membership that has ended is cleaned up
   * (cleanupMembership). An entry it cannot judge is kept. Never rejects.
   */
  async repairJournal(): Promise<void> {
    try {
      const uid = this.auth.userId();
      if (!uid || !this.pwa.isOnline()) return;
      await this.repair(this.stateFor(uid));
    } catch (error) {
      this.warn('The journal was not repaired; it is kept for the next sweep', error);
    }
  }

  /**
   * Compares the account's copies in a household with its rows naming it,
   * and repairs the difference. A check that disagrees, or that the server
   * does not answer, goes on to a full pass. Online only: every read is the
   * server's. Rejects when a full pass could not write or take out every
   * copy it had to, leaving the household marked for another.
   */
  async reconcile(householdId: string, mode: LedgerReconcileMode): Promise<LedgerReconcileReport> {
    const state = this.stateFor(this.requireUser());
    const membership = (await this.loadIndex(state, true)).find(entry => entry.householdId === householdId);
    if (!isLive(membership)) {
      throw new LedgerShareRefusal('notMember', 'Only a live membership\'s copies are reconciled');
    }
    // Read again, as a sweep does, so a full pass never writes a copy from
    // categories the listener has not caught up with.
    await this.loadCategories(state, true);
    return this.reconcileMembership(state, membership, mode);
  }

  /**
   * The sweep, online and signed in only: the journal repaired, then each
   * live membership checked, or diffed in full when the journal marks it,
   * when its last full pass on this device is a week old or unknown, or
   * after a restore. One sweep runs at a time; a call made while one runs
   * runs it once more afterwards. Never rejects.
   */
  reconcileAll(reason: LedgerSweepReason): Promise<void> {
    const uid = this.auth.userId();
    if (!uid || !this.pwa.isOnline() || this.destroyed) return Promise.resolve();
    const state = this.stateFor(uid);
    if (state.sweep) {
      state.rerun = state.rerun === 'restore' || reason === 'restore' ? 'restore' : reason;
      return state.sweep;
    }
    const sweep = (async () => {
      try {
        let next: LedgerSweepReason | undefined = reason;
        while (next) {
          state.rerun = undefined;
          await this.sweepOnce(state, next);
          next = state.rerun;
        }
      } catch (error) {
        this.warn('The sweep stopped early; the next one starts over', error);
      } finally {
        // In the same step as the last read of rerun, so no call can land
        // between them and be joined to a sweep that has already ended.
        // Always after the assignment below: the loop awaits at least once.
        state.sweep = undefined;
      }
    })();
    state.sweep = sweep;
    return sweep;
  }

  /**
   * Takes out every copy the account wrote into a household, member or not,
   * at most LEDGER_OWN_WRITE_CHUNK per commit. Answers how many.
   */
  purgeOwn(householdId: string): Promise<number> {
    return this.purgeOwnOf(this.requireUser(), householdId);
  }

  /**
   * Removes a household's key from every row of the account's that names
   * it, at most LEDGER_OWN_WRITE_CHUNK per commit. Answers how many rows.
   */
  stripKey(householdId: string): Promise<number> {
    return this.stripKeyOf(this.requireUser(), householdId);
  }

  /**
   * What is left of a membership that has ended, in order: the account's
   * copies purged, then the key stripped from its rows, then this device's
   * journal entries for it forgotten. The membership must have ended first,
   * so no copy can be written behind the purge. The index entry is not
   * touched: HouseholdService deletes it once this resolves, last.
   */
  cleanupMembership(householdId: string): Promise<void> {
    return this.cleanup(this.requireUser(), householdId);
  }

  /**
   * The owner's purge of a removed member's copies of the household's live
   * generation, at most LEDGER_PURGE_CHUNK per commit (one lookup each).
   * Refused, before anything is read, to any account but the owner. Answers
   * how many.
   *
   * The copies are listed first, and before each commit the server is asked
   * whether the account is a member of this generation again; once it is,
   * nothing more is deleted. The rules let an owner delete any member's
   * copy, and a copy shared again after a rejoin takes the id of the one
   * listed, so only this order keeps the purge off a live member's copies.
   * A member document the rules refuse is another generation's: no member.
   */
  async purgeMember(householdId: string, memberUid: string): Promise<number> {
    const state = this.stateFor(this.requireUser());
    const membership = (await this.loadIndex(state, true)).find(entry => entry.householdId === householdId);
    if (!isLive(membership)) {
      throw new LedgerShareRefusal('notMember', 'Only a live member purges a household\'s copies');
    }
    // The index entry's role is pinned to the member document by the rules,
    // which refuse another member's copy delete to anyone but the owner.
    if (membership.role !== 'owner') {
      throw new LedgerShareRefusal('notOwner', 'Only the household\'s owner purges another member\'s copies');
    }
    const gen = membership.since;
    const copies = await this.firestore.getCollectionFromServer<StoredCopy>(ledgerPath(householdId), {
      where: equalities(LEDGER_QUERY_SHAPES.ledgerByMember, { gen, memberUid })
    });
    const paths = copies
      .filter(copy => copy.memberUid === memberUid && sameStamp(copy.gen, gen))
      .map(copy => `${ledgerPath(householdId)}/${copy.id}`);
    let purged = 0;
    for (const chunk of chunked(paths, LEDGER_PURGE_CHUNK)) {
      if (await this.memberOfGeneration(householdId, memberUid, gen)) break;
      await this.firestore.commitBatch(chunk.map(path => ({ op: 'delete', path })));
      purged += chunk.length;
    }
    return purged;
  }

  /** Whether the server holds a member document of this generation for the account. */
  private async memberOfGeneration(householdId: string, memberUid: string, gen: Timestamp): Promise<boolean> {
    try {
      const member = await this.firestore.getDocumentFromServer<Partial<HouseholdMember>>(memberPath(householdId, memberUid));
      return member !== null && sameStamp(member.since, gen);
    } catch (error) {
      if (isRefused(error)) return false;
      throw error;
    }
  }

  /**
   * After a category changes, rewrites the copies of the account's shared
   * rows in it, from the categories read again. Each copy is read first
   * (from the cache offline) and written only when it differs from the
   * row's projection, so a change that leaves the copies as they were writes
   * nothing, whatever the service held before. A copy that cannot be read is
   * written. The writes are follow's: journaled, at most LEDGER_COMMIT_CHUNK
   * per commit, and queued offline. Never rejects.
   */
  async reprojectCategory(categoryId: string): Promise<void> {
    try {
      const uid = this.auth.userId();
      if (!uid) return;
      const state = this.stateFor(uid);
      const [categories, index] = await Promise.all([this.loadCategories(state, true), this.loadIndex(state)]);
      const rows = await this.firestore.getCollection<Transaction>(rowsPath(uid), {
        where: [{ field: 'categoryId', op: '==', value: categoryId }]
      });
      const wanted: CopyWrite[] = [];
      for (const row of rows) {
        const source = row.categoryId === categoryId ? projectable(uid, row.id, row) : null;
        if (!source) continue;
        for (const hid of normalizeShares(row.sharedWith)) {
          const membership = index.find(entry => entry.householdId === hid);
          if (!isLive(membership)) continue;
          wanted.push({ hid, txId: row.id, data: projectRow(source, categories, membership.since) });
        }
      }
      const byHousehold = new Map<string, CopyWrite[]>();
      for (const chunk of chunked(wanted, REPAIR_READS_AT_ONCE)) {
        const stored = await Promise.all(chunk.map(write => this.firestore
          .getDocument<StoredCopy>(ledgerCopyPath(write.hid, uid, write.txId))
          .catch(() => undefined)));
        chunk.forEach((write, i) => {
          const copy = stored[i];
          if (copy !== undefined && !copyDiffers(copy, write.data)) return;
          byHousehold.set(write.hid, [...(byHousehold.get(write.hid) ?? []), write]);
        });
      }
      const issued: Promise<boolean>[] = [];
      for (const writes of byHousehold.values()) {
        for (const chunk of chunked(writes, LEDGER_COMMIT_CHUNK)) issued.push(this.issue(state, chunk, true));
      }
      if (this.pwa.isOnline()) await Promise.all(issued);
    } catch (error) {
      this.warn('A category\'s copies were not rewritten; the sweep repairs them', error);
    }
  }

  // ---- following ----

  /** Whether a follow made now issues its writes before it returns. */
  private loaded(state: AccountState): boolean {
    return !!state.index && !!state.categories && state.deferred.size === 0;
  }

  /**
   * Follows one change on a loaded account. Each copy write is issued in a
   * commit of its own, or, when `collect` is given, added to it for the
   * caller to issue with others; a write this makes later (once a category
   * or the index is read again) is always issued on its own.
   */
  private followNow(
    state: AccountState,
    txId: string,
    followed: Followed,
    only?: readonly string[],
    collect?: CopyWrite[]
  ): void {
    const { uid } = state;
    const index = state.index ?? [];
    const categories = state.categories ?? [];
    const { next, named, targets, unshared } = copiesTouched(uid, txId, followed, categories, only);
    if (!only && unshared.length > 0) this.owe(state, unshared.map(hid => ({ hid, txId })));
    if (!next && named.length > 0) {
      this.warn('A shared row holds a value no copy may; the repair reads it again from the server', txId);
    }
    if (targets.length === 0) return;

    // A category the account's list does not hold: one made since it was
    // read, the listener not caught up yet. Journaled, and followed once more
    // after the categories are read again; one still missing then (a
    // category gone) is projected as the built-in it counts under.
    const reading = next && !categories.some(category => category.id === next.categoryId)
      ? this.readCategoriesFor(state, next.categoryId)
      : null;
    if (reading) {
      this.owe(state, targets.map(hid => ({ hid, txId })));
      reading
        .then(() => {
          if (this.state === state && !this.destroyed) this.followNow(state, txId, followed, targets);
        })
        .catch(error => this.warn('A row\'s copies were not followed; the journal keeps the row', error));
      return;
    }

    const unknown: string[] = [];
    for (const hid of targets) {
      try {
        const membership = index.find(entry => entry.householdId === hid);
        if (!membership) {
          unknown.push(hid);
        } else if (!isLive(membership) || !next) {
          this.owe(state, [{ hid, txId }]);
        } else {
          const write = { hid, txId, data: projectRow(next, categories, membership.since) };
          if (collect) collect.push(write);
          else void this.issue(state, [write], true);
        }
      } catch (error) {
        this.owe(state, [{ hid, txId }]);
        this.warn('A copy write was not issued; the journal keeps it for the repair', error);
      }
    }
    if (unknown.length === 0) return;

    // A household the index read did not list: a membership joined since,
    // or none at all. Journaled either way, and followed once more after the
    // index is read again.
    this.owe(state, unknown.map(hid => ({ hid, txId })));
    if (only) return;
    this.loadIndex(state, true)
      .then(() => {
        if (this.state === state && !this.destroyed) this.followNow(state, txId, followed, unknown);
      })
      .catch(error => this.warn('The account\'s households were not read again; the journal keeps the row', error));
  }

  private defer(state: AccountState, txId: string, followed: Followed): void {
    const held = state.deferred.get(txId);
    state.deferred.set(txId, { before: held ? held.before : followed.before, after: followed.after });
    if (state.draining) return;
    state.draining = true;
    Promise.all([this.loadIndex(state), this.loadCategories(state)])
      .then(() => {
        if (this.state !== state || this.destroyed) return;
        const work = [...state.deferred];
        state.deferred.clear();
        for (const [deferredTxId, deferred] of work) this.followNow(state, deferredTxId, deferred);
      })
      .catch(error => {
        state.deferred.clear();
        this.warn('The account was not loaded; the journal keeps the rows followed meanwhile', error);
      })
      .then(() => {
        state.draining = false;
      });
  }

  /**
   * Journals the copies, then issues their writes in one commit. Settles
   * the journal once the commit is acknowledged; a refusal keeps it, and
   * schedules a repair when asked to. Resolves to whether the commit landed,
   * never rejects.
   *
   * `owedSince` is what was owed when the caller read the rows it writes
   * from; by default, what is owed as the commit is issued.
   */
  private issue(
    state: AccountState,
    writes: readonly CopyWrite[],
    repairOnRefusal: boolean,
    owedSince?: ReadonlyMap<string, number>
  ): Promise<boolean> {
    const ops: BatchOp[] = writes.map(write => ({
      op: 'set',
      path: ledgerCopyPath(write.hid, state.uid, write.txId),
      data: write.data,
      merge: true,
      stamp: 'server'
    }));
    const rows = writes.map(({ hid, txId }) => ({ hid, txId }));
    const owedAt = rows.map(row => (owedSince ?? state.owed).get(journalKey(row)) ?? 0);
    journalRows(state.uid, rows);
    for (const row of rows) {
      const key = journalKey(row);
      state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + 1);
    }
    return this.firestore.commitBatch(ops).then(
      () => {
        this.answered(state, rows, owedAt, true);
        return true;
      },
      error => {
        this.answered(state, rows, owedAt, false);
        this.warn('A copy write was refused; the journal keeps it for the repair', error);
        if (repairOnRefusal) this.scheduleRepair(state);
        return false;
      }
    );
  }

  /**
   * An entry is settled once the last write in flight for it is
   * acknowledged, unless something was owed for it after that write was
   * issued. Writes land in the order issued, so that write reflects the
   * latest row; an earlier refusal it follows no longer matters, and a later
   * one keeps the entry.
   */
  private answered(
    state: AccountState,
    rows: readonly LedgerJournalRow[],
    owedAt: readonly number[],
    acknowledged: boolean
  ): void {
    const settled: LedgerJournalRow[] = [];
    rows.forEach((row, i) => {
      const key = journalKey(row);
      const left = (state.inFlight.get(key) ?? 1) - 1;
      if (left > 0) {
        state.inFlight.set(key, left);
      } else {
        state.inFlight.delete(key);
        if (acknowledged && (state.owed.get(key) ?? 0) === owedAt[i]) settled.push(row);
      }
    });
    if (settled.length > 0) settleJournalRows(state.uid, settled);
  }

  /** Journals rows no write is issued for here, for the repair to settle. */
  private owe(state: AccountState, rows: readonly LedgerJournalRow[]): void {
    journalRows(state.uid, rows);
    for (const row of rows) {
      const key = journalKey(row);
      state.owed.set(key, (state.owed.get(key) ?? 0) + 1);
    }
  }

  private scheduleRepair(state: AccountState): void {
    if (state.repairTimer !== undefined || this.destroyed) return;
    state.repairTimer = setTimeout(() => {
      state.repairTimer = undefined;
      if (this.state === state && !this.destroyed) void this.repairJournal();
    }, LEDGER_REPAIR_DELAY_MS);
  }

  // ---- sharing ----

  /**
   * One commit of key writes. A row gone since it was chosen refuses its
   * update, and with it the whole commit: row by row then, passing over a
   * row that is gone.
   */
  private keyRows(uid: string, key: string, txIds: readonly string[]): Promise<void> {
    const keyOf = (txId: string): BatchOp =>
      ({ op: 'update', path: rowPath(uid, txId), data: { sharedWith: arrayUnion(key) }, stamp: 'client' });
    return this.firestore.commitBatch(txIds.map(keyOf)).catch(async error => {
      if (errorCode(error) !== 'not-found') throw error;
      for (const txId of txIds) {
        try {
          await this.firestore.commitBatch([keyOf(txId)]);
        } catch (rowError) {
          if (errorCode(rowError) !== 'not-found') throw rowError;
        }
      }
    });
  }

  /**
   * The copy of one row shared offline, queued behind its key: the row as
   * the cache holds it, the queued key included, followed as an edit that
   * adds the household. A row the cache cannot read, or that it shows
   * without the key, leaves the copy to a full pass.
   */
  private async shareOneOffline(state: AccountState, txId: string, householdId: string): Promise<void> {
    try {
      const [cached] = await Promise.all([
        this.firestore.getDocument<Transaction>(rowPath(state.uid, txId)),
        this.loadCategories(state)
      ]);
      if (cached && normalizeShares(cached.sharedWith).includes(householdId)) {
        const key = shareKey(householdId);
        const before = { ...cached, sharedWith: (cached.sharedWith ?? []).filter(held => held !== key) };
        this.follow(txId, before, cached);
        return;
      }
    } catch (error) {
      this.warn('A row shared offline was not read from the cache; a full pass writes its copy', error);
    }
    markFullPass(state.uid, householdId);
  }

  // ---- unsharing ----

  private unsharePair(uid: string, hid: string, key: string, txId: string): BatchOp[] {
    return [
      { op: 'delete', path: ledgerCopyPath(hid, uid, txId) },
      { op: 'update', path: rowPath(uid, txId), data: { sharedWith: arrayRemove(key) }, stamp: 'client' }
    ];
  }

  /**
   * One unshare commit. A row gone since it was listed refuses its key
   * write, and with it the whole commit: pair by pair then, and a pair
   * whose row is gone takes out its copy alone.
   */
  private unshareChunk(uid: string, hid: string, key: string, txIds: readonly string[]): Promise<void> {
    const ops = txIds.flatMap(txId => this.unsharePair(uid, hid, key, txId));
    return this.firestore.commitBatch(ops).catch(async error => {
      if (errorCode(error) !== 'not-found') throw error;
      for (const txId of txIds) {
        try {
          await this.firestore.commitBatch(this.unsharePair(uid, hid, key, txId));
        } catch (pairError) {
          if (errorCode(pairError) !== 'not-found') throw pairError;
          await this.firestore.commitBatch([{ op: 'delete', path: ledgerCopyPath(hid, uid, txId) }]);
        }
      }
    });
  }

  // ---- repairing ----

  private async repair(state: AccountState): Promise<void> {
    const { uid } = state;
    if (readLedgerJournal(uid).rows.length === 0) return;
    // An entry owed again after this, by a follow made while the repair
    // reads, is owed past what the repair read: it stays for the next.
    const owedSince = new Map(state.owed);
    await this.firestore.waitForPendingWrites();
    const rows = readLedgerJournal(uid).rows;
    if (rows.length === 0) return;
    const categories = await this.loadCategories(state);
    for (const [hid, txIds] of groupByHousehold(rows)) {
      try {
        const judged = await this.judgeMembership(uid, hid);
        if (judged === 'unknown') continue;
        if (judged === 'ended') {
          await this.cleanup(uid, hid);
        } else {
          await this.repairHousehold(state, hid, judged.since, txIds, categories, owedSince);
        }
      } catch (error) {
        this.warn('A household\'s journaled copies were not repaired; they are kept', error);
      }
    }
  }

  /**
   * Whether the account is a live member of the household, asked of the
   * server alone: its own member document, and the household of that
   * generation. Never the index entry, which a listener on the index can
   * answer with what it last heard, while 'ended' purges every copy and
   * strips every key. An interrupted leave or dissolve still reads as ended:
   * the commit that marks the entry ended deletes the member document.
   */
  private async judgeMembership(uid: string, hid: string): Promise<MembershipJudgement> {
    try {
      const own = await this.firestore.getDocumentFromServer<Partial<HouseholdMember>>(memberPath(hid, uid));
      if (!own || !isStamp(own.since)) return 'ended';
      let household: Partial<Household> | null;
      try {
        household = await this.firestore.getDocumentFromServer<Partial<Household>>(householdPath(hid));
      } catch (error) {
        // A live member reads its household; a get of one that is gone is refused.
        if (isRefused(error)) return 'ended';
        throw error;
      }
      if (!household || !sameStamp(household.createdAt, own.since)) return 'ended';
      return { since: own.since };
    } catch (error) {
      this.warn('A membership was not judged; its journaled copies are kept', error);
      return 'unknown';
    }
  }

  private async repairHousehold(
    state: AccountState,
    hid: string,
    since: Timestamp,
    txIds: readonly string[],
    categories: readonly Category[],
    owedSince: ReadonlyMap<string, number>
  ): Promise<void> {
    const { uid } = state;
    const deletes: string[] = [];
    const sets: CopyWrite[] = [];
    const settled: LedgerJournalRow[] = [];
    for (const chunk of chunked(txIds, REPAIR_READS_AT_ONCE)) {
      for (const pair of await Promise.all(chunk.map(txId => this.readPair(uid, hid, txId)))) {
        if (!pair) continue;
        const { txId, row, copy } = pair;
        const source = row && normalizeShares(row.sharedWith).includes(hid) ? projectable(uid, txId, row) : null;
        if (!source) {
          if (copy) deletes.push(txId);
          else settled.push({ hid, txId });
          continue;
        }
        const next = projectRow(source, categories, since);
        // A copy of another generation cannot be updated into this one.
        const otherGeneration = !!copy && !sameStamp(copy.gen, since);
        if (otherGeneration) deletes.push(txId);
        if (!copy || otherGeneration || copyDiffers(copy, next)) sets.push({ hid, txId, data: next });
        else settled.push({ hid, txId });
      }
    }

    const failed = await this.deletePaths(deletes.map(txId => ledgerCopyPath(hid, uid, txId)));
    for (const txId of deletes) {
      if (!failed.has(ledgerCopyPath(hid, uid, txId)) && !sets.some(set => set.txId === txId)) settled.push({ hid, txId });
    }
    const writable = sets.filter(set => !failed.has(ledgerCopyPath(hid, uid, set.txId)));
    for (const chunk of chunked(writable, LEDGER_COMMIT_CHUNK)) await this.issue(state, chunk, false, owedSince);
    // An entry a write issued since the repair began is in flight for is that
    // write's to settle, and one owed again since it began is the next repair's.
    settleJournalRows(uid, settled.filter(row => {
      const key = journalKey(row);
      return !state.inFlight.has(key) && (state.owed.get(key) ?? 0) === (owedSince.get(key) ?? 0);
    }));
  }

  private async readPair(
    uid: string,
    hid: string,
    txId: string
  ): Promise<{ txId: string; row: Transaction | null; copy: StoredCopy | null } | null> {
    try {
      const [row, copy] = await Promise.all([
        this.firestore.getDocumentFromServer<Transaction>(rowPath(uid, txId)),
        this.firestore.getDocumentFromServer<StoredCopy>(ledgerCopyPath(hid, uid, txId))
      ]);
      return { txId, row, copy };
    } catch (error) {
      this.warn('A journaled copy was not read; it is kept for the next repair', error);
      return null;
    }
  }

  /** Deletes own copies, at most LEDGER_OWN_WRITE_CHUNK per commit. Answers the paths not deleted. */
  private async deletePaths(paths: readonly string[]): Promise<Set<string>> {
    const failed = new Set<string>();
    for (const chunk of chunked(paths, LEDGER_OWN_WRITE_CHUNK)) {
      try {
        await this.firestore.commitBatch(chunk.map(path => ({ op: 'delete', path })));
      } catch (error) {
        for (const path of chunk) failed.add(path);
        this.warn('Copies were not taken out; the next pass tries again', error);
      }
    }
    return failed;
  }

  // ---- reconciling ----

  private async reconcileMembership(
    state: AccountState,
    membership: LiveMembership,
    mode: LedgerReconcileMode
  ): Promise<LedgerReconcileReport> {
    const hid = membership.householdId;
    if (mode === 'check' && (await this.sidesAgree(state.uid, hid))) {
      stampSweep(state.uid, hid, 'check', Date.now());
      return { pass: 'check', written: 0, deleted: 0 };
    }
    return this.fullPass(state, membership);
  }

  /**
   * Whether the rows naming a household and the account's copies in it are
   * as many, as the server counts them. An aggregation the server does not
   * answer proves nothing alike.
   *
   * A count only: under one filter it is served by the automatic
   * single-field indexes. A sum filtered on another field needs a composite
   * of the filter and the summed field in production, for the rows one over
   * every account's transactions, and the emulator never asks for it. A copy
   * behind in its amount alone waits for the journal or the full pass, as
   * one behind in any other field does.
   */
  private async sidesAgree(uid: string, hid: string): Promise<boolean> {
    const asked = { count: true };
    try {
      const [rows, copies] = await Promise.all([
        this.firestore.aggregateFromServer(rowsPath(uid), { where: [namingKey(shareKey(hid))] }, asked),
        this.firestore.aggregateFromServer(ledgerPath(hid), { where: [authoredBy(uid)] }, asked)
      ]);
      return rows.count === copies.count;
    } catch (error) {
      this.warn(errorCode(error) === 'failed-precondition'
        ? 'The server refused to count a household\'s copies for want of an index; a full pass compares them'
        : 'The server did not count a household\'s copies; a full pass compares them', error);
      return false;
    }
  }

  /**
   * Lists the account's rows naming the household and its copies in it,
   * both from the server, and diffs them by row: a missing copy is written,
   * a different one written again, and an orphan taken out (its row gone or
   * no longer naming the household, or of another generation). Deletes go
   * first, then the writes, each journaled. Any failure marks the household
   * for another full pass and rejects.
   */
  private async fullPass(state: AccountState, membership: LiveMembership): Promise<LedgerReconcileReport> {
    const { uid } = state;
    const hid = membership.householdId;
    const since = membership.since;
    const owedSince = new Map(state.owed);
    try {
      const categories = await this.loadCategories(state);
      const [rows, copies] = await Promise.all([
        this.firestore.getCollectionFromServer<Transaction>(rowsPath(uid), { where: [namingKey(shareKey(hid))] }),
        this.firestore.getCollectionFromServer<StoredCopy>(ledgerPath(hid), { where: [authoredBy(uid)] })
      ]);
      const held = new Map(copies.filter(copy => copy.memberUid === uid).map(copy => [copy.id, copy]));
      const wanted = new Set<string>();
      const deletes: string[] = [];
      const sets: CopyWrite[] = [];
      for (const row of rows) {
        const source = normalizeShares(row.sharedWith).includes(hid) ? projectable(uid, row.id, row) : null;
        if (!source) continue;
        const id = ledgerCopyId(uid, row.id);
        wanted.add(id);
        const next = projectRow(source, categories, since);
        const copy = held.get(id);
        const otherGeneration = !!copy && !sameStamp(copy.gen, since);
        if (otherGeneration) deletes.push(id);
        if (!copy || otherGeneration || copyDiffers(copy, next)) sets.push({ hid, txId: row.id, data: next });
      }
      for (const id of held.keys()) {
        if (!wanted.has(id)) deletes.push(id);
      }

      const failed = await this.deletePaths(deletes.map(id => `${ledgerPath(hid)}/${id}`));
      const writable = sets.filter(set => !failed.has(ledgerCopyPath(hid, uid, set.txId)));
      let written = 0;
      for (const chunk of chunked(writable, LEDGER_COMMIT_CHUNK)) {
        if (await this.issue(state, chunk, false, owedSince)) written += chunk.length;
      }
      const missed = failed.size + (sets.length - written);
      if (missed > 0) throw new Error(`${missed} of a household's copies were not written or taken out`);
      clearFullPass(uid, hid);
      stampSweep(uid, hid, 'full', Date.now());
      return { pass: 'full', written, deleted: deletes.length };
    } catch (error) {
      markFullPass(uid, hid);
      throw error;
    }
  }

  private async sweepOnce(state: AccountState, reason: LedgerSweepReason): Promise<void> {
    try {
      if (this.state !== state || this.destroyed || !this.pwa.isOnline()) return;
      const { uid } = state;
      await this.loadCategories(state, true);
      try {
        await this.repair(state);
      } catch (error) {
        this.warn('The journal was not repaired; it is kept for the next sweep', error);
      }
      const live = (await this.loadIndex(state, true)).filter(isLive);
      const marked = readLedgerJournal(uid).full;
      const now = Date.now();
      for (const membership of live) {
        const hid = membership.householdId;
        const lastFull = readSweepStamps(uid, hid).full;
        const full = reason === 'restore' || marked.includes(hid)
          || lastFull === undefined || now - lastFull >= FULL_SWEEP_EVERY_MS;
        try {
          await this.reconcileMembership(state, membership, full ? 'full' : 'check');
        } catch (error) {
          this.warn('A household\'s copies were not reconciled; the next sweep tries again', error);
        }
      }
    } catch (error) {
      this.warn('The sweep stopped early; the next one starts over', error);
    }
  }

  // ---- ending ----

  private async cleanup(uid: string, hid: string): Promise<void> {
    await this.purgeOwnOf(uid, hid);
    await this.stripKeyOf(uid, hid);
    forgetJournalHousehold(uid, hid);
  }

  private async purgeOwnOf(uid: string, hid: string): Promise<number> {
    const copies = await this.firestore.getCollectionFromServer<StoredCopy>(ledgerPath(hid), {
      where: [authoredBy(uid)]
    });
    const paths = copies.filter(copy => copy.memberUid === uid).map(copy => `${ledgerPath(hid)}/${copy.id}`);
    for (const chunk of chunked(paths, LEDGER_OWN_WRITE_CHUNK)) {
      await this.firestore.commitBatch(chunk.map(path => ({ op: 'delete', path })));
    }
    return paths.length;
  }

  private async stripKeyOf(uid: string, hid: string): Promise<number> {
    const key = shareKey(hid);
    const rows = await this.firestore.getCollectionFromServer<Transaction>(rowsPath(uid), { where: [namingKey(key)] });
    const ids = rows.filter(row => Array.isArray(row.sharedWith) && row.sharedWith.includes(key)).map(row => row.id);
    for (const chunk of chunked(ids, LEDGER_OWN_WRITE_CHUNK)) {
      await this.firestore.commitBatch(chunk.map(txId => ({
        op: 'update',
        path: rowPath(uid, txId),
        data: { sharedWith: arrayRemove(key) },
        stamp: 'client'
      })));
    }
    return ids.length;
  }

  // ---- the account ----

  private requireUser(): string {
    const uid = this.auth.userId();
    if (!uid) throw new Error('No account is signed in');
    return uid;
  }

  private stateFor(uid: string): AccountState {
    if (this.state?.uid !== uid) {
      this.dropState();
      this.state = {
        uid,
        categoriesReadFor: new Set(),
        categoryReads: new Map(),
        deferred: new Map(),
        draining: false,
        inFlight: new Map(),
        owed: new Map()
      };
    }
    return this.state;
  }

  private dropState(): void {
    if (this.state?.repairTimer !== undefined) clearTimeout(this.state.repairTimer);
    this.state?.categoriesWatch?.unsubscribe();
    this.state = null;
  }

  private loadIndex(state: AccountState, fresh = false): Promise<HouseholdMembership[]> {
    if (!fresh && state.index) return Promise.resolve(state.index);
    if (!fresh && state.indexLoad) return state.indexLoad;
    const load = this.firestore.getCollection<HouseholdIndexData>(householdIndexPath(state.uid)).then(entries => {
      const index = entries.map(toMembership);
      state.index = index;
      return index;
    });
    state.indexLoad = load;
    const done = () => {
      if (state.indexLoad === load) state.indexLoad = undefined;
    };
    load.then(done, done);
    return load;
  }

  /**
   * The account's categories: as held, or read (afresh when asked, from the
   * server when online). The first call also starts a listener that keeps
   * them current.
   */
  private loadCategories(state: AccountState, fresh = false): Promise<Category[]> {
    this.watchCategories(state);
    if (!fresh && state.categories) return Promise.resolve(state.categories);
    if (!fresh && state.categoriesLoad) return state.categoriesLoad;
    const load = this.firestore.getCollection<Category>(categoriesPath(state.uid)).then(stored => {
      const categories = mergeCategories(defaultCategories(), stored);
      state.categories = categories;
      return categories;
    });
    state.categoriesLoad = load;
    const done = () => {
      if (state.categoriesLoad === load) state.categoriesLoad = undefined;
    };
    load.then(done, done);
    return load;
  }

  /**
   * Keeps the categories current from a listener. One that fails is
   * dropped, so the next load starts another; a refusal (the account signed
   * out) is expected and not logged.
   */
  private watchCategories(state: AccountState): void {
    if (state.categoriesWatch || this.destroyed || this.state !== state) return;
    // Declared before it is assigned: an error can arrive while subscribe runs.
    let watch: Subscription | undefined;
    let failed = false;
    try {
      watch = this.firestore.subscribeToCollection<Category>(categoriesPath(state.uid)).subscribe({
        next: stored => {
          state.categories = mergeCategories(defaultCategories(), stored);
        },
        error: error => {
          failed = true;
          if (watch && state.categoriesWatch === watch) state.categoriesWatch = undefined;
          if (!isRefused(error)) this.warn('The account\'s categories are no longer heard; the next read starts again', error);
        }
      });
      if (!failed) state.categoriesWatch = watch;
    } catch (error) {
      this.warn('The account\'s categories are not heard; each read takes them as they stand', error);
    }
  }

  /**
   * A read of the categories again for a category the list does not hold,
   * or null once one has been made for it: at most one per category for the
   * account, so a category that is gone costs no read on each edit. Follows
   * made while it runs wait for it, in the order made.
   */
  private readCategoriesFor(state: AccountState, categoryId: string): Promise<void> | null {
    const running = state.categoryReads.get(categoryId);
    if (running) return running;
    if (state.categoriesReadFor.has(categoryId)) return null;
    state.categoriesReadFor.add(categoryId);
    const read = this.loadCategories(state, true)
      .then(
        () => undefined,
        error => this.warn('The categories were not read again; the copy is projected from those held', error)
      )
      .then(() => {
        state.categoryReads.delete(categoryId);
      });
    state.categoryReads.set(categoryId, read);
    return read;
  }

  private refuseBulk(ids: readonly string[]): void {
    if (ids.length > MAX_BULK_SHARE) {
      throw new LedgerShareRefusal('tooMany', `At most ${MAX_BULK_SHARE} rows are shared or unshared at once`);
    }
  }

  /** A caller's progress callback, which cannot stop the writes it watches. */
  private report(progress: LedgerShareProgress | undefined, done: number, total: number): void {
    try {
      progress?.(done, total);
    } catch (error) {
      this.warn('A progress report threw; the rows are shared or unshared all the same', error);
    }
  }

  /** Writes left queued offline: a later refusal is logged, never left unhandled. */
  private quietly(writes: readonly Promise<unknown>[], message: string): void {
    for (const write of writes) write.catch(error => this.warn(message, error));
  }

  private warn(message: string, detail: unknown): void {
    console.warn(`${LOG} ${message}`, detail);
  }
}
