import { DestroyRef, Injectable, Injector, computed, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { CollectionWithMetadata, FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import type { LedgerShareService } from './ledger-share.service';
import {
  Household,
  HouseholdMember,
  HouseholdMemberIdentity,
  LEDGER_QUERY_SHAPES,
  LEDGER_VIEW_CAP,
  LedgerCategorySnapshot,
  LedgerCopy,
  TransactionType,
  baseCurrencyOf
} from '../../models';
import { isRefused } from '../utils/firebase-error.utils';
import { isStamp, sameStamp } from '../utils/household-index.utils';
import { DateWindow, endOfDay, toDate } from '../utils/transaction-date.utils';
import { TypeTotals, compareIds, sumByType } from '../utils/transaction-aggregation.utils';

/** The household the view reads: which, its generation, and who owns it. */
export type LedgerHousehold = Pick<Household, 'id' | 'createdAt' | 'ownerId'>;

/** A copy as its listener hands it over: the document with its id. */
type StoredCopy = LedgerCopy & { id: string };

/**
 * One row a member shared into the household, as this viewer sees it. What
 * it reveals is the copy's; nothing else of the member's row reaches here.
 */
export interface LedgerRow {
  /** The copy's id, `{memberUid}_{sourceId}`: one per row across the household. */
  id: string;
  /** Whose row it is. */
  memberUid: string;
  /** The row's id among its member's own transactions. */
  sourceId: string;
  type: TransactionType;
  /** As its member entered it, in `currency`. */
  amount: number;
  currency: string;
  date: Timestamp;
  description: string;
  categoryId: string;
  /**
   * The category as its member's app held it when the row was shared. `name`
   * is a translation key for a built-in and the member's own text otherwise,
   * so it is shown through the translation, as every category name is.
   */
  category: LedgerCategorySnapshot;
  /**
   * What the row counts as in the viewer's base currency: `amount` itself in
   * that currency, any other converted at today's rate.
   */
  inBase: number;
  /** `inBase` was converted at today's rate. */
  atTodaysRate: boolean;
}

/** Income and expense in the viewer's base currency. */
export interface LedgerTotals extends TypeTotals {
  /** Some amount in these figures was converted at today's rate. */
  atTodaysRate: boolean;
}

/** One member's income and expense in the period, from the rows they shared. */
export interface MemberTotals {
  member: HouseholdMemberIdentity;
  totals: LedgerTotals;
}

/** What the listener last said; `copies` is undefined until it answers. */
interface Feed {
  copies?: readonly StoredCopy[];
  truncated: boolean;
  fromCache: boolean;
  /** The listener failed, other than by a refusal, before the server answered. */
  incomplete: boolean;
}

const UNHEARD: Feed = { truncated: false, fromCache: false, incomplete: false };

const NO_TOTALS: LedgerTotals = { income: 0, expense: 0, balance: 0, count: 0, atTodaysRate: false };

const millisOf = (value: Timestamp) => toDate(value)?.getTime() ?? 0;

function newestFirst(a: LedgerRow, b: LedgerRow): number {
  return millisOf(b.date) - millisOf(a.date) || compareIds(a.id, b.id);
}

const fold = (rows: readonly LedgerRow[]): LedgerTotals =>
  ({ ...sumByType(rows, row => row.inBase), atTodaysRate: rows.some(row => row.atTodaysRate) });

const sameWindow = (a: DateWindow, b: DateWindow) =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

const sameHousehold = (a: LedgerHousehold | null, b: LedgerHousehold | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.ownerId === b.ownerId && sameStamp(a.createdAt, b.createdAt));

/**
 * The view's query, built from the shape its composite index serves
 * (LEDGER_QUERY_SHAPES.ledgerByDate): the equality on the generation, the
 * period on the date, and the date's order. One copy past the cap is asked
 * for, so a period that holds more is known to.
 */
function periodQuery(gen: Timestamp, period: DateWindow): QueryOptions {
  const [[genField], [dateField, order]] = LEDGER_QUERY_SHAPES.ledgerByDate.fields;
  return {
    where: [
      { field: genField, op: '==', value: gen },
      { field: dateField, op: '>=', value: Timestamp.fromDate(period.start) },
      // Widened to the last millisecond of the day, so the bound takes in a
      // row posted that evening whatever time of day the period carries.
      { field: dateField, op: '<=', value: Timestamp.fromDate(endOfDay(period.end)) }
    ],
    orderBy: [{ field: dateField, direction: order === 'DESCENDING' ? 'desc' : 'asc' }],
    limit: LEDGER_VIEW_CAP + 1
  };
}

/** A copy the view can show: the fields it reads are there and of their types. */
function readable(copy: StoredCopy): boolean {
  return typeof copy.memberUid === 'string'
    && typeof copy.amount === 'number' && Number.isFinite(copy.amount)
    && typeof copy.currency === 'string'
    && (copy.type === 'income' || copy.type === 'expense')
    && isStamp(copy.date);
}

/**
 * What a household's members shared with it in a period (#71): one listener
 * on the selected household's ledger (households/{hid}/ledger), filtered to
 * the household's live generation, as the rules require of a member's list.
 * Read only, but for one thing: an owner's purge of a removed member's
 * copies, below.
 *
 * Provided by the household page, not the root: its listener lives exactly
 * as long as the page, and the DestroyRef closes it (ADR 0009). The page
 * hands in the household, its live members (HouseholdService.members()) and
 * the period.
 *
 * Only the copies of a live member are shown. The rules keep a copy readable
 * until its author or the owner deletes it, and a removal deletes the member
 * document first; the purge follows. When the viewer is the owner, a copy by
 * an account the server confirms is no member of this generation starts
 * that purge (LedgerShareService.purgeMember), once per account while the
 * page lives, which finishes a removal cut off part-way. The server is asked
 * first because the members list and the ledger arrive on listeners of their
 * own, and the ledger can name a member who has just joined before the list
 * does. Each copy is written by a member who was live when writing it.
 *
 * A refusal of the listener is the rules saying the membership has ended.
 * HouseholdService reports that loss; the listener stops, and nothing is
 * raised. Any other failure is logged, and what was shown stays; when the
 * server had not answered by then, what was shown is only this device's
 * cache, or nothing, and the figures are marked as possibly incomplete.
 *
 * Money figures are in the viewer's base currency. A copy in that currency
 * counts exactly; any other is converted at today's rate, through the rates
 * the dashboard converts with, and each figure it reaches says so. A copy
 * holds no base-currency snapshot: its member's base need not be the
 * viewer's.
 */
@Injectable()
export class HouseholdLedgerService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly injector = inject(Injector);

  private readonly household = signal<LedgerHousehold | null>(null, { equal: sameHousehold });
  private readonly members = signal<readonly HouseholdMemberIdentity[]>([]);
  private readonly window = signal<DateWindow | null>(null);
  private readonly feed = signal<Feed>(UNHEARD);
  private listener: Subscription | null = null;
  private destroyed = false;
  /** `{householdId}|{uid}`: accounts whose copies this page has judged for a purge. */
  private readonly judged = new Set<string>();

  /** The live members' uids: only their copies are shown. */
  private readonly memberUids = computed(() => new Set(this.members().map(member => member.uid)));

  /**
   * Converts into the viewer's base: the amount itself in that currency,
   * today's rate otherwise. convert reads the rates, so a rates change
   * refolds every figure that converted.
   */
  private readonly toBase = computed(() => {
    const base = baseCurrencyOf(this.auth.currentUser());
    return (copy: StoredCopy): Pick<LedgerRow, 'inBase' | 'atTodaysRate'> =>
      copy.currency === base
        ? { inBase: copy.amount, atTodaysRate: false }
        : { inBase: this.currency.convert(copy.amount, copy.currency, base), atTodaysRate: true };
  });

  /** Every live member's shared rows in the period, newest first. */
  readonly rows = computed<LedgerRow[]>(() => {
    const members = this.memberUids();
    const toBase = this.toBase();
    return (this.feed().copies ?? [])
      .filter(copy => members.has(copy.memberUid) && readable(copy))
      .map(copy => ({
        id: copy.id,
        memberUid: copy.memberUid,
        sourceId: copy.sourceId,
        type: copy.type,
        amount: copy.amount,
        currency: copy.currency,
        date: copy.date,
        description: copy.description,
        categoryId: copy.categoryId,
        category: copy.category,
        ...toBase(copy)
      }))
      .sort(newestFirst);
  });

  /** Each listed member in list order, one who shared nothing in the period at zero. */
  readonly totalsByMember = computed<MemberTotals[]>(() => {
    const byMember = new Map<string, LedgerRow[]>();
    for (const row of this.rows()) {
      let list = byMember.get(row.memberUid);
      if (!list) byMember.set(row.memberUid, (list = []));
      list.push(row);
    }
    return this.members().map(member => {
      const rows = byMember.get(member.uid);
      return { member, totals: rows ? fold(rows) : NO_TOTALS };
    });
  });

  /** The household's totals, folded from every row rather than from the rounded member totals. */
  readonly combined = computed<LedgerTotals>(() => fold(this.rows()));

  /** The period holds more copies than LEDGER_VIEW_CAP: only the newest are shown and counted. */
  readonly truncated = computed(() => this.feed().truncated);

  /** A household and a period are set, and the listener has not answered yet. */
  readonly loading = computed(() =>
    this.household() !== null && this.window() !== null && this.feed().copies === undefined
  );

  /**
   * What is shown came from this device's cache, not yet in step with the
   * server: offline, it is only what this device last read.
   */
  readonly fromCache = computed(() => this.feed().fromCache);

  /**
   * The listener failed before the server answered, so the figures are only
   * what this device's cache held, if anything, and may be incomplete.
   */
  readonly incomplete = computed(() => this.feed().incomplete);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.close();
    });
  }

  /** The household to read; null reads nothing. Another household or generation is read afresh. */
  setHousehold(household: LedgerHousehold | null): void {
    // Untracked: the page calls this from an effect, and a listener can
    // answer synchronously inside it.
    untracked(() => {
      if (this.destroyed) return;
      const next = household && { id: household.id, ownerId: household.ownerId, createdAt: household.createdAt };
      if (sameHousehold(this.household(), next)) return;
      this.household.set(next);
      this.listen();
    });
  }

  /** The household's live members, in the order they are shown. */
  setMembers(members: readonly HouseholdMemberIdentity[]): void {
    untracked(() => {
      if (this.destroyed) return;
      const listed = new Map<string, HouseholdMemberIdentity>();
      for (const member of members) if (!listed.has(member.uid)) listed.set(member.uid, member);
      this.members.set([...listed.values()]);
      this.judgeStrangers();
    });
  }

  /** The period whose copies are read. A different one is read afresh. */
  setPeriod(period: DateWindow): void {
    untracked(() => {
      if (this.destroyed) return;
      const current = this.window();
      if (current && sameWindow(current, period)) return;
      this.window.set({ start: period.start, end: period.end });
      this.listen();
    });
  }

  /** (Re)opens the one listener for the household and period, dropping what the last one said. */
  private listen(): void {
    this.close();
    // The last household's or period's copies are not shown under the next.
    this.feed.set(UNHEARD);
    const household = this.household();
    const period = this.window();
    if (!household || !period) return;
    // Declared first: a listener can fail while it is being subscribed.
    let subscription: Subscription | undefined = undefined;
    subscription = this.firestore
      .subscribeToCollectionWithMetadata<StoredCopy>(
        `households/${household.id}/ledger`,
        periodQuery(household.createdAt, period)
      )
      .subscribe({
        next: answer => this.heard(answer),
        error: error => this.failed(subscription, error)
      });
    // A failure delivered while subscribing has already ended it.
    if (!subscription.closed) this.listener = subscription;
  }

  private heard({ docs, fromCache }: CollectionWithMetadata<StoredCopy>): void {
    // Delivered newest first, so the copies kept are the newest.
    const truncated = docs.length > LEDGER_VIEW_CAP;
    this.feed.set({
      copies: truncated ? docs.slice(0, LEDGER_VIEW_CAP) : docs,
      truncated,
      fromCache,
      incomplete: false
    });
    this.judgeStrangers();
  }

  private failed(subscription: Subscription | undefined, error: unknown): void {
    if (subscription && this.listener === subscription) this.listener = null;
    // The membership ended; HouseholdService says so.
    if (isRefused(error)) return;
    console.warn('[HouseholdLedger] The ledger listener stopped:', error);
    // What was shown stays. A stopped listener hears nothing more, so one
    // the server never answered counts as answered with what the cache
    // held, or with nothing: the page stops waiting, and says the figures
    // may be incomplete. The cache's answer keeps saying where it came from.
    const feed = this.feed();
    if (feed.copies === undefined || feed.fromCache) this.feed.set({ ...feed, copies: feed.copies ?? [], incomplete: true });
  }

  private close(): void {
    this.listener?.unsubscribe();
    this.listener = null;
  }

  /**
   * As the owner, judges each account whose copies are shown by the server
   * but missing from the members list, once. Nothing is judged from the
   * cache, nor before the members are known: the viewer is always one of
   * them.
   */
  private judgeStrangers(): void {
    const household = this.household();
    const uid = this.auth.userId();
    const feed = this.feed();
    const members = this.memberUids();
    if (!household || !uid || household.ownerId !== uid || !members.has(uid)) return;
    if (!feed.copies || feed.fromCache) return;
    for (const copy of feed.copies) {
      if (typeof copy.memberUid !== 'string' || members.has(copy.memberUid)) continue;
      const key = `${household.id}|${copy.memberUid}`;
      if (this.judged.has(key)) continue;
      this.judged.add(key);
      void this.purgeIfGone(household, copy.memberUid, key);
    }
  }

  /**
   * Purges an account's copies once the server confirms it holds no member
   * document of this generation. Never rejects. A live member, whom the
   * list had not reached yet, and a read the server did not answer, are
   * judged again the next time they show as strangers; a purge is asked for
   * once.
   */
  private async purgeIfGone(household: LedgerHousehold, memberUid: string, key: string): Promise<void> {
    let live: boolean;
    try {
      const member = await this.firestore.getDocumentFromServer<HouseholdMember>(
        `households/${household.id}/members/${memberUid}`
      );
      live = member !== null && sameStamp(member.since, household.createdAt);
    } catch (error) {
      // The rules refuse a live member the document of another generation's
      // member: no member of this one. They refuse it too once the viewer's
      // own membership is over, which purgeMember then refuses in turn.
      if (!isRefused(error)) {
        this.judged.delete(key);
        console.warn('[HouseholdLedger] A removed member\'s copies were not judged; the next answer asks again:', error);
        return;
      }
      live = false;
    }
    if (live) {
      this.judged.delete(key);
      return;
    }
    try {
      const sharing = await this.ledgerShare();
      await sharing.purgeMember(household.id, memberUid);
    } catch (error) {
      console.warn('[HouseholdLedger] A removed member\'s copies were not purged:', error);
    }
  }

  /**
   * The code that deletes copies (LedgerShareService), reached only by this
   * dynamic import, and only for an owner's purge, so the page loads it
   * rarely and the initial bundle never.
   */
  private async ledgerShare(): Promise<LedgerShareService> {
    const { LedgerShareService } = await import('./ledger-share.service');
    return this.injector.get(LedgerShareService);
  }
}
