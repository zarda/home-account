import { Transaction } from '../../models';
import {
  ToBase,
  groupExpensesByCategoryWithCounts,
  percentDelta,
  roundRatio,
  sumByType,
} from './transaction-aggregation.utils';
import {
  DateWindow,
  addDays,
  dayKey,
  weekWindow,
} from './transaction-date.utils';

/**
 * The weekly recap's arithmetic: which week is being recapped, when the nudge
 * announcing it is due, the fold from two weeks of transactions to the figures
 * every recap surface reads, and the device-local state remembering a
 * dismissal.
 *
 * Pure by design — the service, the reminder sweep and the dashboard card all
 * agree on the week boundary by construction rather than through three private
 * copies of the same arithmetic, which is the standing rule in ADR 0026 and
 * the reason weekWindow is reused here rather than reimplemented.
 *
 * Two things are load-bearing:
 *
 * 1. A week is identified by `dayKey` of its Monday, not by
 *    `budgetPeriodKey(…, 'weekly')`. That label is an unpadded ISO week number
 *    (`2026-W5`), so a set of them does not sort — and this key is compared
 *    against a stored one to decide whether the card was already dismissed.
 *
 * 2. The nudge moment is built from its Monday's own local parts, the
 *    `reminderMoment` idiom: shifting by hours or milliseconds across a DST
 *    transition schedules the notification an hour either side of nine.
 *
 * The fold inherits transaction-aggregation.utils' determinism contract —
 * every sort ends in an explicit tiebreaker, money rounds at the output
 * boundary — by delegating to it rather than re-summing anything.
 */

/** 09:00 local, the hour the bill reminders already use. */
export const RECAP_NUDGE_HOUR = 9;

/** Leading categories the recap names. Beyond three a card reads as a list. */
const TOP_CATEGORY_COUNT = 3;

const STORAGE_PREFIX = 'home-account.recap';

/** One leading category of the recapped week. */
export interface RecapCategory {
  categoryId: string;
  total: number;
  /** Transactions behind the total. */
  count: number;
  /** Fraction of `RecapFigures.spend`, rounded like every other ratio. */
  share: number;
}

/** Everything the card, the nudge and the narrative read about a week. */
export interface RecapFigures {
  /** Expenses only, in base currency. */
  spend: number;
  income: number;
  /** Transactions in the recapped week, both types. */
  count: number;
  previousSpend: number;
  /** Fractional change against `previousSpend`; null when there is no base. */
  spendDelta: number | null;
  topCategories: RecapCategory[];
}

/**
 * The week the recap speaks about: the last one that finished, never the one
 * in progress. Stepping a day back from this week's Monday lands on the
 * previous Sunday, which `weekWindow` then opens on its own Monday.
 */
export function recapWindow(now: Date): DateWindow {
  return weekWindow(addDays(weekWindow(now).start, -1));
}

/** The week before the recapped one — what the recap compares against. */
export function weekBeforeWindow(now: Date): DateWindow {
  return weekWindow(addDays(recapWindow(now).start, -1));
}

/**
 * A recapped week's identity: the day key of its Monday, zero-padded and
 * therefore sortable. See the note on `budgetPeriodKey` above.
 */
export function recapKey(window: DateWindow): string {
  return dayKey(window.start);
}

/**
 * When the next nudge falls due: 09:00 on the Monday opening a week — this
 * week's while it is still ahead, the following week's once it has arrived.
 */
export function nextRecapMoment(now: Date): Date {
  const monday = weekWindow(now).start;
  const thisWeek = nudgeMomentOn(monday);
  return now < thisWeek ? thisWeek : nudgeMomentOn(addDays(monday, 7));
}

/**
 * 09:00 local on this day, built from the day's own local parts so a week
 * spanning a DST change still lands at nine rather than an hour out.
 */
function nudgeMomentOn(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), RECAP_NUDGE_HOUR);
}

/** The week a nudge delivered at this moment is announcing. */
export function recapKeyAnnouncedBy(moment: Date): string {
  return recapKey(recapWindow(moment));
}

/**
 * Fold two already-fetched weeks into the recap's figures.
 *
 * Neither list is filtered by date: each is the caller's own window query, and
 * a row outside the window it was fetched for counts as if it were inside.
 */
export function composeRecapFigures(
  lastWeek: Transaction[],
  weekBefore: Transaction[],
  toBase: ToBase,
): RecapFigures {
  const totals = sumByType(lastWeek, toBase);
  const previousSpend = sumByType(weekBefore, toBase).expense;
  const spend = totals.expense;

  // Already largest-first with the id tiebreak; re-sorting here would be a
  // second ordering to keep in step with that one.
  const topCategories = groupExpensesByCategoryWithCounts(lastWeek, toBase)
    .slice(0, TOP_CATEGORY_COUNT)
    .map(({ categoryId, total, count }) => ({
      categoryId,
      total,
      count,
      // A week of zero-amount expenses ranks categories with nothing to divide
      // by, and NaN would reach the card as its share.
      share: spend > 0 ? roundRatio(total / spend) : 0,
    }));

  return {
    spend,
    income: totals.income,
    count: totals.count,
    previousSpend,
    spendDelta: percentDelta(spend, previousSpend),
    topCategories,
  };
}

/**
 * Whether the week is worth a card at all. An empty week still has something
 * to say when the one before it had spending — that nothing went out is the
 * story — but two silent weeks in a row are not news.
 */
export function hasSomethingToSay(figures: RecapFigures): boolean {
  return figures.count > 0 || figures.previousSpend > 0;
}

/**
 * The allowlist that goes to a provider, one fact per line like the insight
 * narrative's. Figures and locally-resolved category names only: no
 * description, note, merchant, budget name or rule name, no transaction id and
 * no individual date. Category names do cross, and a custom one is text its
 * owner typed — that is the whole of what a person wrote that the recap sends,
 * and it is resolved here rather than left as an id so the line reads.
 */
export function buildRecapContext(
  figures: RecapFigures,
  window: DateWindow,
  currency: string,
  categoryName: (categoryId: string) => string,
): string {
  const delta = figures.spendDelta !== null
    ? `${Math.round(figures.spendDelta * 100)}%`
    : 'n/a';

  const lines: string[] = [
    `Period: ${dayKey(window.start)} to ${dayKey(window.end)}`,
    `Currency: ${currency}`,
    `Total spending: ${figures.spend}`,
    `Total income: ${figures.income}`,
    `Transactions: ${figures.count}`,
    `Previous week spending: ${figures.previousSpend}`,
    `Change vs. the previous week: ${delta}`,
  ];

  for (const category of figures.topCategories) {
    lines.push(
      `Category "${categoryName(category.categoryId)}": ${category.total}`
      + ` (${Math.round(category.share * 100)}% of spending)`);
  }

  return lines.join('\n');
}

/**
 * This device's recap state for one account: the week whose card was
 * dismissed, and the narrative generated for it.
 */
export function weeklyRecapStorageKeys(uid: string): { dismissed: string; narrative: string } {
  return {
    dismissed: `${STORAGE_PREFIX}.dismissed.${uid}`,
    narrative: `${STORAGE_PREFIX}.narrative.${uid}`,
  };
}

/** The last recap week dismissed on this device, or null when there is none. */
export function readDismissedRecapWeek(uid: string): string | null {
  try {
    return localStorage.getItem(weeklyRecapStorageKeys(uid).dismissed) || null;
  } catch {
    // Private-mode Safari throws on the accessor itself. An unreadable store
    // means the card shows again, which is the harmless way to be wrong.
    return null;
  }
}

export function writeDismissedRecapWeek(uid: string, key: string): void {
  try {
    localStorage.setItem(weeklyRecapStorageKeys(uid).dismissed, key);
  } catch {
    // A refused write costs one repeat of the card, never a failed dismissal.
  }
}

/** Drop both keys — what sign-out and an account switch leave behind. */
export function clearWeeklyRecapDeviceState(uid: string): void {
  const keys = weeklyRecapStorageKeys(uid);
  try {
    localStorage.removeItem(keys.dismissed);
    localStorage.removeItem(keys.narrative);
  } catch {
    // Nothing to do — a store that refuses removal refuses reads too.
  }
}
