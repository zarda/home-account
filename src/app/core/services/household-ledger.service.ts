import { DestroyRef, Injectable, Injector, computed, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import type { LedgerShareService } from './ledger-share.service';
import {
  Household,
  HouseholdMember,
  HouseholdMemberIdentity,
  LEDGER_QUERY_SHAPES,
  LedgerCategorySnapshot,
  LedgerCopy,
  TransactionType,
  baseCurrencyOf
} from '../../models';
import { CappedFeed, UNHEARD, openCappedFeed } from '../utils/capped-feed.utils';
import { isRefused } from '../utils/firebase-error.utils';
import { isStamp, sameStamp } from '../utils/household-index.utils';
import { DateWindow, endOfDay, toDate } from '../utils/transaction-date.utils';
import { TypeTotals, compareIds, sumByType } from '../utils/transaction-aggregation.utils';

/** The household the view reads: which, its generation, and who owns it. */
export type LedgerHousehold = Pick<Household, 'id' | 'createdAt' | 'ownerId'>;

/** A copy as its listener hands it over: the document with its id. */
export type StoredLedgerCopy = LedgerCopy & { id: string };

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
  /** The household goal its member counts it toward, if any; only the member sets it. */
  goalId?: string;
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

/** What one dated listener last said; `docs` is undefined until it answers. */
interface Feed extends CappedFeed<StoredLedgerCopy> {
  /**
   * When the listener held more than LEDGER_VIEW_CAP copies: the date, in
   * milliseconds, of the oldest copy kept. A copy dated at or before it may
   * be missing. +Infinity when that copy's date cannot be read, so every
   * window counts as cut. Null when every copy was kept.
   */
  keptFrom: number | null;
}

const NOTHING_HEARD: Feed = { ...UNHEARD, keptFrom: null };

const NO_TOTALS: LedgerTotals = { income: 0, expense: 0, balance: 0, count: 0, atTodaysRate: false };

const LOG = '[HouseholdLedger]';

const millisOf = (value: Timestamp) => toDate(value)?.getTime() ?? 0;

function newestFirst(a: LedgerRow, b: LedgerRow): number {
  return millisOf(b.date) - millisOf(a.date) || compareIds(a.id, b.id);
}

const fold = (rows: readonly LedgerRow[]): LedgerTotals =>
  ({ ...sumByType(rows, row => row.inBase), atTodaysRate: rows.some(row => row.atTodaysRate) });

const sameWindow = (a: DateWindow | null, b: DateWindow | null) =>
  a === b || (a !== null && b !== null && a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime());

/**
 * The period reads every date of the plan window: its listener then holds
 * every copy the plans count. Both are read through the last millisecond of
 * their final local day.
 */
function holds(period: DateWindow | null, plans: DateWindow): boolean {
  return period !== null
    && period.start.getTime() <= plans.start.getTime()
    && endOfDay(plans.end).getTime() <= endOfDay(period.end).getTime();
}

/** The same household and generation, owned by the same account. */
export const sameHousehold = (a: LedgerHousehold | null, b: LedgerHousehold | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.ownerId === b.ownerId && sameStamp(a.createdAt, b.createdAt));

/**
 * The view's query, built from the shape its composite index serves
 * (LEDGER_QUERY_SHAPES.ledgerByDate): the equality on the generation, the
 * window on the date, and the date's order. The window is widened to the
 * last millisecond of its final day, so the bound takes in a copy posted
 * that evening whatever time of day the window's end carries. The cap is
 * the listener's (openCappedFeed).
 */
function datedQuery(gen: Timestamp, window: DateWindow): QueryOptions {
  const [[genField], [dateField, order]] = LEDGER_QUERY_SHAPES.ledgerByDate.fields;
  return {
    where: [
      { field: genField, op: '==', value: gen },
      { field: dateField, op: '>=', value: Timestamp.fromDate(window.start) },
      { field: dateField, op: '<=', value: Timestamp.fromDate(endOfDay(window.end)) }
    ],
    orderBy: [{ field: dateField, direction: order === 'DESCENDING' ? 'desc' : 'asc' }]
  };
}

/**
 * A copy the view can show: the fields it reads are there and of their
 * types. The household's plans read their copies by the same test.
 */
export function readableCopy(copy: StoredLedgerCopy): boolean {
  return typeof copy.memberUid === 'string'
    && typeof copy.amount === 'number' && Number.isFinite(copy.amount)
    && typeof copy.currency === 'string'
    && (copy.type === 'income' || copy.type === 'expense')
    && isStamp(copy.date);
}

/**
 * One capped listener on a household's ledger over one window of dates, and
 * what it last said. Opened afresh for another household or other dates,
 * and for the same ones once it has stopped, so a failure is retried at the
 * next change the page makes. It fails, and says so, by the rule every
 * capped household list keeps (openCappedFeed).
 */
class DatedListener {
  readonly feed = signal<Feed>(NOTHING_HEARD);
  private listener: Subscription | null = null;
  private household: LedgerHousehold | null = null;
  private dates: DateWindow | null = null;

  constructor(
    private readonly firestore: FirestoreService,
    /** Named in the warning a failure logs. */
    private readonly what: string,
    private readonly answered: () => void
  ) {}

  /** Reads `dates` of the household's ledger; null for either reads nothing. */
  read(household: LedgerHousehold | null, dates: DateWindow | null): void {
    // A listener that failed is closed, and read afresh.
    const reading = this.listener !== null && !this.listener.closed
      && sameHousehold(this.household, household) && sameWindow(this.dates, dates);
    if (household && dates && reading) return;
    this.close();
    // What was read for other dates or another household is not shown under these.
    this.feed.set(NOTHING_HEARD);
    if (!household || !dates) return;
    this.household = household;
    this.dates = dates;
    this.listener = openCappedFeed<StoredLedgerCopy>(
      this.firestore,
      `households/${household.id}/ledger`,
      datedQuery(household.createdAt, dates),
      { capped: true, what: this.what, log: LOG },
      feed => this.heard(feed)
    );
  }

  close(): void {
    this.listener?.unsubscribe();
    this.listener = null;
    this.household = null;
    this.dates = null;
  }

  /**
   * An answer, or a failure reported as one. Delivered newest first, so the
   * copies kept are the newest, and the oldest kept is how far back they
   * reach. Only an answer is judged for strangers.
   */
  private heard(feed: CappedFeed<StoredLedgerCopy>): void {
    const oldest = feed.docs?.at(-1)?.date;
    this.feed.set({
      ...feed,
      keptFrom: !feed.truncated ? null : isStamp(oldest) ? millisOf(oldest) : Number.POSITIVE_INFINITY
    });
    if (!feed.incomplete) this.answered();
  }
}

/**
 * What a household's members shared with it in a period (#71), read from
 * the selected household's ledger (households/{hid}/ledger), filtered to the
 * household's live generation, as the rules require of a member's list.
 * Read only, but for one thing: an owner's purge of a removed member's
 * copies, below.
 *
 * Provided by the household page, not the root: its listeners live exactly
 * as long as the page, and the DestroyRef closes them (ADR 0009). The page
 * hands in the household and its live members (HouseholdService.members());
 * the overview, the period.
 *
 * The household's own budgets fold their spending from the same copies
 * (HouseholdPlansService), each over a window of its own that need not lie
 * inside the period: a budget's month runs on while a past period is
 * viewed. The period keeps a capped listener of its own, and the budgets'
 * window (setPlanWindow) is read through a second one whenever the period
 * does not hold it. One listener over both would be read newest first up to
 * one cap, so the copies of a later budget window, and of the weeks between,
 * could crowd the period's own rows out of it. When the period holds the
 * window, its listener serves the plans too.
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
 * A refusal of a listener is the rules saying the membership has ended.
 * HouseholdService reports that loss; the listener stops, and nothing is
 * raised. Any other failure is logged, and what was shown stays; when the
 * server had not answered by then, what was shown is only this device's
 * cache, or nothing, and the figures are marked as possibly incomplete. A
 * stopped listener is opened again at the next change of dates.
 *
 * Money figures are in the viewer's base currency. A copy in that currency
 * counts exactly; any other is converted at today's rate, through the rates
 * the dashboard converts with, and each figure it reaches says so. Until
 * those rates have settled on a source (CurrencyService.rateSource), such a
 * copy is held out of the rows and every figure, and ratesPending says so.
 * A copy holds no base-currency snapshot: its member's base need not be the
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
  private readonly period = signal<DateWindow | null>(null);
  private readonly planWindow = signal<DateWindow | null>(null);
  private readonly periodListener = new DatedListener(this.firestore, 'ledger', () => this.judgeStrangers());
  private readonly planListener = new DatedListener(this.firestore, "budgets' ledger", () => this.judgeStrangers());
  private destroyed = false;
  /** `{householdId}|{uid}`: accounts whose copies this page has judged for a purge. */
  private readonly judged = new Set<string>();

  /** The live members' uids: only their copies are shown, and only their copies count in a plan. */
  readonly memberUids = computed<ReadonlySet<string>>(() => new Set(this.members().map(member => member.uid)));

  /**
   * What the plans read: the plan window's own listener, or the period's
   * when the period holds the window. Null without a household or a window.
   */
  private readonly planFeed = computed<Feed | null>(() => {
    const plans = this.planWindow();
    if (!this.household() || !plans) return null;
    return holds(this.period(), plans) ? this.periodListener.feed() : this.planListener.feed();
  });

  /** A feed's copies of live members whose fields the view can read. */
  private liveCopies(feed: Feed | null): readonly StoredLedgerCopy[] {
    const members = this.memberUids();
    return (feed?.docs ?? []).filter(copy => members.has(copy.memberUid) && readableCopy(copy));
  }

  /**
   * Every live member's copy read for the plans (setPlanWindow), newest
   * first as delivered: at least those dated in the plan window. A copy
   * whose fields the view cannot read is left out.
   */
  readonly windowCopies = computed<readonly StoredLedgerCopy[]>(() => this.liveCopies(this.planFeed()));

  /**
   * When the copies read for the plans ran past LEDGER_VIEW_CAP, only the
   * newest were kept: the date, in milliseconds, of the oldest kept. A copy
   * dated at or before it may be missing, so a budget window reaching back
   * to it may be incomplete. +Infinity when that copy's date cannot be read,
   * so every window counts as cut. Null when every copy was kept.
   */
  readonly windowKeptFrom = computed(() => this.planFeed()?.keptFrom ?? null);

  /** A plan window is set, and the listener reading it has not answered yet. */
  readonly windowLoading = computed(() => {
    const feed = this.planFeed();
    return feed !== null && feed.docs === undefined;
  });

  /** The copies read for the plans came from this device's cache, not yet in step with the server. */
  readonly windowFromCache = computed(() => this.planFeed()?.fromCache ?? false);

  /** The listener reading the plan window failed before the server answered: the plans may be incomplete. */
  readonly windowIncomplete = computed(() => this.planFeed()?.incomplete ?? false);

  /**
   * The rate table has settled on a source. Until then it is a placeholder
   * that converts every currency 1:1, so nothing is converted through it.
   */
  private readonly ratesSettled = computed(() => this.currency.rateSource() !== null);

  /**
   * Converts into the viewer's base: the amount itself in that currency,
   * today's rate otherwise, and null while the rates have not settled.
   * convert reads the rates, so a rates change refolds every figure that
   * converted.
   */
  private readonly toBase = computed(() => {
    const base = baseCurrencyOf(this.auth.currentUser());
    return (copy: StoredLedgerCopy): Pick<LedgerRow, 'inBase' | 'atTodaysRate'> | null => {
      if (copy.currency === base) return { inBase: copy.amount, atTodaysRate: false };
      // Read only for a copy that converts, so a household in one currency
      // never waits on the rates.
      if (!this.ratesSettled()) return null;
      return { inBase: this.currency.convert(copy.amount, copy.currency, base), atTodaysRate: true };
    };
  });

  /**
   * A live member's copy in the period is in another currency than the
   * viewer's base, and today's rates have not settled: the rows and every
   * figure leave it out until they have, so no figure is the placeholder's
   * 1:1. Figures shown now would be short of it; the page waits instead.
   */
  readonly ratesPending = computed(() => {
    const toBase = this.toBase();
    return this.liveCopies(this.periodListener.feed()).some(copy => toBase(copy) === null);
  });

  /** Every live member's shared rows in the period, newest first; one held for the rates (ratesPending) is left out. */
  readonly rows = computed<LedgerRow[]>(() => {
    const toBase = this.toBase();
    return this.liveCopies(this.periodListener.feed())
      .flatMap(copy => {
        const inBase = toBase(copy);
        return inBase ? [{ copy, inBase }] : [];
      })
      .map(({ copy, inBase }) => ({
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
        ...(typeof copy.goalId === 'string' ? { goalId: copy.goalId } : {}),
        ...inBase
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
  readonly truncated = computed(() => this.periodListener.feed().keptFrom !== null);

  /** A household and a period are set, and the period's listener has not answered yet. */
  readonly loading = computed(() =>
    this.household() !== null && this.period() !== null && this.periodListener.feed().docs === undefined
  );

  /**
   * What the period shows came from this device's cache, not yet in step
   * with the server: offline, it is only what this device last read.
   */
  readonly fromCache = computed(() => this.periodListener.feed().fromCache);

  /**
   * The period's listener failed before the server answered, so its figures
   * are only what this device's cache held, if anything, and may be
   * incomplete.
   */
  readonly incomplete = computed(() => this.periodListener.feed().incomplete);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.periodListener.close();
      this.planListener.close();
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
      this.follow();
    });
  }

  /**
   * The dates the household's budgets count now (planWindow in
   * household-plans.utils.ts), read for them apart from the period unless
   * the period holds them; null for none.
   */
  setPlanWindow(window: DateWindow | null): void {
    untracked(() => {
      if (this.destroyed) return;
      if (sameWindow(this.planWindow(), window)) return;
      this.planWindow.set(window && { start: window.start, end: window.end });
      this.follow();
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

  /** The period whose copies are shown. A different one is read afresh. */
  setPeriod(period: DateWindow): void {
    untracked(() => {
      if (this.destroyed) return;
      if (sameWindow(this.period(), period)) return;
      this.period.set({ start: period.start, end: period.end });
      this.follow();
    });
  }

  /**
   * Points each listener at the dates it reads now: the period's at the
   * period, and the plans' at the plan window unless the period holds it.
   */
  private follow(): void {
    const household = this.household();
    const period = this.period();
    const plans = this.planWindow();
    this.periodListener.read(household, period);
    this.planListener.read(household, plans && !holds(period, plans) ? plans : null);
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
    const members = this.memberUids();
    if (!household || !uid || household.ownerId !== uid || !members.has(uid)) return;
    for (const feed of [this.periodListener.feed(), this.planListener.feed()]) {
      if (!feed.docs || feed.fromCache) continue;
      for (const copy of feed.docs) {
        if (typeof copy.memberUid !== 'string' || members.has(copy.memberUid)) continue;
        const key = `${household.id}|${copy.memberUid}`;
        if (this.judged.has(key)) continue;
        this.judged.add(key);
        void this.purgeIfGone(household, copy.memberUid, key);
      }
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
        console.warn(`${LOG} A removed member's copies were not judged; the next answer asks again:`, error);
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
      console.warn(`${LOG} A removed member's copies were not purged:`, error);
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
