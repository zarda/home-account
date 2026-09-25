import { DestroyRef, Injectable, computed, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { isSpentCurrent } from './budget.service';
import {
  Budget,
  Category,
  Goal,
  HouseholdMember,
  Transaction,
  baseCurrencyOf
} from '../../models';
import { defaultCategories, mergeCategories } from '../utils/category-merge.utils';
import { isRefused } from '../utils/firebase-error.utils';
import { buildTransactionWhere } from '../utils/transaction-query.utils';
import { DateWindow, dateOf, toDate } from '../utils/transaction-date.utils';
import { TypeTotals, compareIds, sumByType } from '../utils/transaction-aggregation.utils';

/**
 * The most rows one member's period shows. The query asks for one more, so a
 * period that holds more is known to, and says so, rather than reading as
 * complete.
 */
export const HOUSEHOLD_LEDGER_ROW_CAP = 500;

/** Who a figure belongs to: the parts of a member document the page shows. */
export type LedgerMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'photoURL'>;

/** A member's transaction in the merged list, marked with whose it is. */
export interface LedgerRow extends Transaction {
  memberUid: string;
}

/**
 * A member's budget as the household sees it. `stale` means its stored
 * `spent` was summed for another period, so `spent` reads 0: only the budget's
 * owner can recalculate it.
 */
export interface LedgerBudget extends Budget {
  stale: boolean;
}

/** One member's income and expense in the period, in the viewer's base currency. */
export interface MemberTotals {
  member: LedgerMember;
  totals: TypeTotals;
}

export interface MemberBudgets {
  member: LedgerMember;
  budgets: LedgerBudget[];
}

export interface MemberGoals {
  member: LedgerMember;
  goals: Goal[];
}

type LedgerKind = 'transactions' | 'categories' | 'budgets' | 'goals';

/** What one member's listeners have said; a field is undefined until its listener answers. */
interface MemberFeed {
  rows?: LedgerRow[];
  truncated: boolean;
  categories?: Category[];
  budgets?: Budget[];
  goals?: Goal[];
  /** The rules refused one of the member's listeners. */
  refused: boolean;
  /**
   * Kinds whose listener failed, other than by a refusal, before it ever
   * answered. Each reads as answered with nothing, so the member's figures
   * may be partial.
   */
  failed: readonly LedgerKind[];
}

const EMPTY_FEED: MemberFeed = { truncated: false, refused: false, failed: [] };

/**
 * Budgets and goals are asked for by one equality and sorted here: an
 * equality with an order on another field needs a composite index.
 */
const ACTIVE_ONLY: QueryOptions = { where: [{ field: 'isActive', op: '==', value: true }] };

/**
 * Stands in for a missing base-currency stamp on another member's row. It is
 * no currency code, so amountInBase takes the row as stamped against another
 * base and converts it live.
 */
const UNSTAMPED_BASE = 'unstamped';

const millisOf = (value: Transaction['createdAt'] | undefined) =>
  toDate(value)?.getTime() ?? 0;

function newestFirst(a: LedgerRow, b: LedgerRow): number {
  return dateOf(b).getTime() - dateOf(a).getTime()
    || millisOf(b.createdAt) - millisOf(a.createdAt)
    || compareIds(a.memberUid, b.memberUid)
    || compareIds(a.id, b.id);
}

function byName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return compareIds(a.name, b.name) || compareIds(a.id, b.id);
}

const sameWindow = (a: DateWindow, b: DateWindow) =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

/**
 * Another member's row as this viewer may count and show it.
 *
 * Its snapshot is in that member's base currency. amountInBase trusts an
 * unstamped snapshot unless the row looks unconverted, so a genuinely
 * converted row written before stamping would be counted in the other
 * member's currency as though it were the viewer's. Forcing a stamp that
 * matches no base makes it convert live; a real stamp is left to decide.
 *
 * The receipt fields go: another member's receipts are not shown here.
 */
function asPeerRow(row: Transaction, memberUid: string): LedgerRow {
  const peer: LedgerRow = { ...row, memberUid };
  delete peer.receiptUrl;
  delete peer.receiptUrls;
  delete peer.receiptCount;
  if (!peer.baseCurrency) peer.baseCurrency = UNSTAMPED_BASE;
  return peer;
}

/**
 * Every member's transactions for a period, and their categories, active
 * budgets and active goals, merged for the household page (#71). Read only:
 * nothing here writes, and the rules would refuse a write to another
 * member's documents.
 *
 * Provided by the household page, not the root: its listeners live exactly as
 * long as the page, and the DestroyRef closes them (ADR 0009). The page hands
 * in the members, from HouseholdService.members(), and the period. Each
 * member, the viewer included, is read through the same four listeners: the
 * rules let the viewer read its own documents and a live member's alike.
 *
 * A refusal is the rules saying the member's documents are no longer shared
 * with the viewer, typically a member removed before the list says so. That
 * member is `unavailable` and what it showed is dropped. Nothing is raised:
 * the listener's error is its answer.
 *
 * Any other listener failure is logged and says nothing about sharing. What
 * the member last showed stays. A listener that failed before it ever
 * answered puts the member in `incomplete`, since what it shows may be
 * partial; a period change clears that for its transactions, which it reads
 * afresh.
 *
 * Money figures are in the viewer's base currency, through the same
 * amountInBase the dashboard folds with, so they follow a rates or base
 * change without a read. Budgets and goals keep their own currency.
 */
@Injectable()
export class HouseholdLedgerService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);

  private readonly members = signal<readonly LedgerMember[]>([]);
  private readonly feeds = signal<ReadonlyMap<string, MemberFeed>>(new Map());
  private readonly window = signal<DateWindow | null>(null);
  /** Every listed member has an entry, emptied when its listeners are closed. */
  private readonly listeners = new Map<string, Partial<Record<LedgerKind, Subscription>>>();
  private destroyed = false;

  /** Listed members whose documents can be read, in list order, with what they said. */
  private readonly shown = computed(() => {
    const feeds = this.feeds();
    return this.members()
      .map(member => ({ member, feed: feeds.get(member.uid) ?? EMPTY_FEED }))
      .filter(({ feed }) => !feed.refused);
  });

  // Each kind apart: one listener's answer must not rebuild what the others
  // feed, or every row's category map would change with every row.
  private readonly shownRows = this.shownPart('rows');
  private readonly shownCategories = this.shownPart('categories');
  private readonly shownBudgets = this.shownPart('budgets');
  private readonly shownGoals = this.shownPart('goals');
  private readonly shownTruncated = this.shownPart('truncated');
  private readonly shownFailed = this.shownPart('failed');

  private readonly toBase = computed(() => {
    const base = baseCurrencyOf(this.auth.currentUser());
    return (transaction: Transaction) => this.currency.amountInBase(transaction, base);
  });

  /** Every shown member's rows in the period, newest first. */
  readonly rows = computed<LedgerRow[]>(() =>
    this.shownRows().flatMap(({ part }) => part ?? []).sort(newestFirst)
  );

  readonly totalsByMember = computed<MemberTotals[]>(() => {
    const toBase = this.toBase();
    return this.shownRows().map(({ member, part }) => ({ member, totals: sumByType(part ?? [], toBase) }));
  });

  /** The household's totals, folded from every row rather than from the rounded member totals. */
  readonly combined = computed<TypeTotals>(() => sumByType(this.rows(), this.toBase()));

  /**
   * Each shown member's categories by id: the built-ins overlaid with that
   * member's own. A row resolves its category through its own member's map,
   * since a custom category's id means nothing in anyone else's.
   */
  readonly categoriesByMember = computed<ReadonlyMap<string, Map<string, Category>>>(() => {
    const maps = new Map<string, Map<string, Category>>();
    for (const { member, part } of this.shownCategories()) {
      const merged = mergeCategories(defaultCategories(), part ?? []);
      maps.set(member.uid, new Map(merged.map(category => [category.id, category])));
    }
    return maps;
  });

  readonly budgetsByMember = computed<MemberBudgets[]>(() => {
    const now = new Date();
    return this.shownBudgets().map(({ member, part }) => ({
      member,
      budgets: (part ?? []).map(budget => this.asShownBudget(budget, now)).sort(byName)
    }));
  });

  readonly goalsByMember = computed<MemberGoals[]>(() =>
    this.shownGoals().map(({ member, part }) => ({ member, goals: [...(part ?? [])].sort(byName) }))
  );

  /** Listed members whose documents the rules refused, in list order. */
  readonly unavailable = computed<LedgerMember[]>(() => {
    const feeds = this.feeds();
    return this.members().filter(member => feeds.get(member.uid)?.refused);
  });

  /** Shown members whose period holds more rows than HOUSEHOLD_LEDGER_ROW_CAP. */
  readonly truncated = computed<LedgerMember[]>(() =>
    this.shownTruncated().filter(({ part }) => part).map(({ member }) => member)
  );

  /**
   * Shown members one of whose listeners failed before it answered: their
   * figures may be partial. Distinct from `unavailable`, which is the rules
   * ending the sharing.
   */
  readonly incomplete = computed<LedgerMember[]>(() =>
    this.shownFailed().filter(({ part }) => part.length > 0).map(({ member }) => member)
  );

  /** A shown member's listener has not answered yet. */
  readonly loading = computed(() => {
    const hasPeriod = this.window() !== null;
    return this.shown().some(({ feed }) =>
      !feed.categories || !feed.budgets || !feed.goals || (hasPeriod && !feed.rows)
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const uid of [...this.listeners.keys()]) this.close(uid);
      this.listeners.clear();
    });
  }

  /**
   * The members to read, in the order they are shown. A member new to the list
   * gains its listeners; one gone from it loses them and drops out. A member
   * still listed keeps its listeners, a refused one included: the rules
   * already answered for it.
   */
  setMembers(members: readonly LedgerMember[]): void {
    // Untracked: the page calls this from an effect, and a listener can
    // answer synchronously inside it.
    untracked(() => {
      if (this.destroyed) return;
      const listed = new Map<string, LedgerMember>();
      for (const member of members) if (!listed.has(member.uid)) listed.set(member.uid, member);

      for (const uid of [...this.listeners.keys()]) {
        if (listed.has(uid)) continue;
        this.close(uid);
        this.listeners.delete(uid);
      }
      this.feeds.update(feeds => {
        const next = new Map<string, MemberFeed>();
        for (const uid of listed.keys()) next.set(uid, feeds.get(uid) ?? EMPTY_FEED);
        return next;
      });
      this.members.set([...listed.values()]);

      for (const uid of listed.keys()) {
        if (this.listeners.has(uid)) continue;
        this.listeners.set(uid, {});
        this.open(uid, 'categories');
        this.open(uid, 'budgets');
        this.open(uid, 'goals');
        this.open(uid, 'transactions');
      }
    });
  }

  /** The period whose transactions are read. A different one re-reads every member's. */
  setPeriod(period: DateWindow): void {
    untracked(() => {
      if (this.destroyed) return;
      const current = this.window();
      if (current && sameWindow(current, period)) return;
      this.window.set({ start: period.start, end: period.end });

      for (const [uid, subs] of this.listeners) {
        const feed = this.feeds().get(uid);
        if (!feed || feed.refused) continue;
        subs.transactions?.unsubscribe();
        delete subs.transactions;
        // The last period's rows are not shown under the new one.
        this.patch(uid, {
          rows: undefined,
          truncated: false,
          failed: feed.failed.filter(kind => kind !== 'transactions')
        });
        this.open(uid, 'transactions');
      }
    });
  }

  private open(uid: string, kind: LedgerKind): void {
    const subs = this.listeners.get(uid);
    if (!subs || this.feeds().get(uid)?.refused) return;
    const path = `users/${uid}/${kind}`;
    const handlers = {
      error: (error: unknown) => this.listenerFailed(uid, kind, error)
    };

    let subscription: Subscription;
    switch (kind) {
      case 'transactions': {
        const period = this.window();
        if (!period) return;
        subscription = this.firestore
          .subscribeToCollection<Transaction>(path, {
            where: buildTransactionWhere({ startDate: period.start, endDate: period.end }),
            orderBy: [{ field: 'date', direction: 'desc' }],
            limit: HOUSEHOLD_LEDGER_ROW_CAP + 1
          })
          .subscribe({ next: docs => this.heardRows(uid, docs), ...handlers });
        break;
      }
      case 'categories':
        subscription = this.firestore
          .subscribeToCollection<Category>(path)
          .subscribe({ next: categories => this.patch(uid, { categories }), ...handlers });
        break;
      case 'budgets':
        subscription = this.firestore
          .subscribeToCollection<Budget>(path, ACTIVE_ONLY)
          .subscribe({ next: budgets => this.patch(uid, { budgets }), ...handlers });
        break;
      case 'goals':
        subscription = this.firestore
          .subscribeToCollection<Goal>(path, ACTIVE_ONLY)
          .subscribe({ next: goals => this.patch(uid, { goals }), ...handlers });
        break;
    }

    // A refusal delivered while subscribing has already closed the member.
    if (this.listeners.get(uid) !== subs || this.feeds().get(uid)?.refused) {
      subscription.unsubscribe();
      return;
    }
    subs[kind] = subscription;
  }

  private heardRows(uid: string, docs: Transaction[]): void {
    // Delivered newest first, so the rows kept are the newest.
    const truncated = docs.length > HOUSEHOLD_LEDGER_ROW_CAP;
    const kept = truncated ? docs.slice(0, HOUSEHOLD_LEDGER_ROW_CAP) : docs;
    const own = uid === untracked(() => this.auth.userId());
    const rows = kept.map(row => (own ? { ...row, memberUid: uid } : asPeerRow(row, uid)));
    this.patch(uid, { rows, truncated });
  }

  private listenerFailed(uid: string, kind: LedgerKind, error: unknown): void {
    const subs = this.listeners.get(uid);
    if (subs) delete subs[kind];
    if (isRefused(error)) {
      // The rules answer for every kind alike, so the rest would be refused
      // too: close them now rather than hear each refusal.
      this.close(uid);
      this.patch(uid, {
        refused: true,
        rows: undefined,
        truncated: false,
        categories: undefined,
        budgets: undefined,
        goals: undefined,
        failed: []
      });
      return;
    }
    console.warn(`[HouseholdLedgerService] The ${kind} listener stopped:`, error);
    // What the member last showed stays. A listener that never answered
    // counts as having answered nothing, so the page stops waiting on it,
    // and is marked so the page can say the figures may be partial.
    const feed = this.feeds().get(uid);
    if (!feed) return;
    const failed = [...feed.failed, kind];
    switch (kind) {
      case 'transactions': if (!feed.rows) this.patch(uid, { rows: [], failed }); break;
      case 'categories': if (!feed.categories) this.patch(uid, { categories: [], failed }); break;
      case 'budgets': if (!feed.budgets) this.patch(uid, { budgets: [], failed }); break;
      case 'goals': if (!feed.goals) this.patch(uid, { goals: [], failed }); break;
    }
  }

  /** Unsubscribes a member's listeners, keeping its entry. */
  private close(uid: string): void {
    const subs = this.listeners.get(uid);
    if (!subs) return;
    for (const kind of Object.keys(subs) as LedgerKind[]) {
      subs[kind]?.unsubscribe();
      delete subs[kind];
    }
  }

  private patch(uid: string, change: Partial<MemberFeed>): void {
    this.feeds.update(feeds => {
      const feed = feeds.get(uid);
      if (!feed) return feeds;
      return new Map(feeds).set(uid, { ...feed, ...change });
    });
  }

  /** One field of each shown member's feed, unchanged until that field or the list moves. */
  private shownPart<K extends keyof MemberFeed>(key: K) {
    return computed(
      () => this.shown().map(({ member, feed }) => ({ member, part: feed[key] })),
      {
        equal: (a, b) =>
          a.length === b.length && a.every((entry, i) => entry.member === b[i].member && entry.part === b[i].part)
      }
    );
  }

  private asShownBudget(budget: Budget, now: Date): LedgerBudget {
    // isSpentCurrent reads the period in this device's time zone, and the
    // stamp was written in the budget owner's. A viewer in another zone can
    // put the period's start on a neighbouring day and see a current figure
    // as stale; only the owner re-stamps, so for that viewer it stays 0.
    // Known and accepted rather than corrected here.
    return isSpentCurrent(budget, now)
      ? { ...budget, stale: false }
      : { ...budget, spent: 0, stale: true };
  }
}
