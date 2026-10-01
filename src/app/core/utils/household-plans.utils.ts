import { HouseholdBudget, HouseholdContribution, HouseholdGoal, LedgerCopy, isBudgetPeriod } from '../../models';
import { defaultCategories } from './category-merge.utils';
import { roundMoney } from './transaction-aggregation.utils';
import { DateWindow, budgetPeriodWindow, endOfDay, toDate } from './transaction-date.utils';

/**
 * The figures a household's own budgets and goals show, folded each time the
 * page reads them from what the household holds: the copies its members
 * shared and the contributions they recorded. Nothing a plan counts is
 * stored, so no figure can fall behind the copies it was taken from.
 *
 * A private row has no copy, so no figure here can count one: the plans
 * read copies alone.
 *
 * Windows are judged in the viewer's own time zone, from the budget's start
 * date as budgetPeriodWindow reads it for a personal budget.
 */

/**
 * Converts an amount between two currencies at today's rate, as
 * CurrencyService.convert does. Asked only for an amount in a currency other
 * than the plan's.
 */
export type ConvertAtTodaysRate = (amount: number, from: string, to: string) => number;

/** What a plan reads of a shared copy. */
export type PlanCopy = Pick<LedgerCopy, 'type' | 'amount' | 'currency' | 'date' | 'bucket' | 'bucketGroup' | 'goalId'>;

/** A household budget's spending in its current window. */
export interface BudgetSpent {
  /** In the budget's currency, to the cent. */
  spent: number;
  /** Some copy counted was in another currency, converted at today's rate. */
  atTodaysRate: boolean;
  /** The window counted, or null when the budget has none now (householdBudgetWindow). */
  window: DateWindow | null;
}

/** How far a household goal has come. */
export interface GoalProgress {
  /** `linked` and `contributed` together, in the goal's currency, to the cent. */
  saved: number;
  /** The copies members linked to the goal, whichever their type, in the goal's currency. */
  linked: number;
  /** The members' contributions, entered in the goal's currency. */
  contributed: number;
  /** `saved` over the target, uncapped as a personal goal's percentage is; 0 for a target of nothing. */
  fraction: number;
  /** Some linked copy was in another currency, converted at today's rate. */
  atTodaysRate: boolean;
}

/** A finite number: an amount a figure can add. */
export const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

let budgetCategories: ReadonlySet<string> | null = null;

/**
 * Whether a household budget can count this category: an expense built-in,
 * a group or one of its subcategories, as a copy's bucket and bucketGroup
 * name them (bucketOf). A custom category counts under its nearest built-in,
 * so a budget never names one; an income copy never counts, so neither does
 * an income built-in.
 */
export function isHouseholdBudgetCategory(id: unknown): boolean {
  budgetCategories ??= new Set(
    defaultCategories().filter(category => category.type === 'expense').map(category => category.id)
  );
  return typeof id === 'string' && budgetCategories.has(id);
}

/**
 * An amount in `currency`: itself when already in it, otherwise converted at
 * today's rate, and said to be.
 */
function inCurrency(
  copy: Pick<PlanCopy, 'amount' | 'currency'>,
  currency: string,
  convert: ConvertAtTodaysRate
): { amount: number; converted: boolean } {
  return copy.currency === currency
    ? { amount: copy.amount, converted: false }
    : { amount: convert(copy.amount, copy.currency, currency), converted: true };
}

/**
 * The window a household budget counts now: the budget period containing
 * `now`, anchored on its start date as a personal budget's is, and cut short
 * by an end date inside it. The window closes on the last millisecond of its
 * final local day, so a copy posted that evening counts, whatever time of day
 * the end date carries.
 *
 * Null when the budget has no window now: it ended before its current period
 * began, or its dates cannot be read (stored data).
 */
export function householdBudgetWindow(
  budget: Pick<HouseholdBudget, 'period' | 'startDate' | 'endDate'>,
  now: Date
): DateWindow | null {
  const anchor = toDate(budget.startDate);
  if (!anchor || !isBudgetPeriod(budget.period)) return null;
  const period = budgetPeriodWindow(budget.period, anchor, now);
  const endDate = budget.endDate == null ? null : toDate(budget.endDate);
  if (budget.endDate != null && !endDate) return null;
  const end = endOfDay(endDate && endDate < period.end ? endDate : period.end);
  return end < period.start ? null : { start: period.start, end };
}

/**
 * What a household budget has spent in its current window: the expense
 * copies dated inside it whose bucket, or the bucket's group, is one of the
 * budget's categories, each once, in the budget's own currency. A copy in
 * that currency counts exactly; any other at today's rate. A copy whose
 * amount or date cannot be read is passed over.
 */
export function budgetSpent(
  budget: Pick<HouseholdBudget, 'categoryIds' | 'currency' | 'period' | 'startDate' | 'endDate'>,
  copies: readonly PlanCopy[],
  now: Date,
  convert: ConvertAtTodaysRate
): BudgetSpent {
  const window = householdBudgetWindow(budget, now);
  if (!window) return { spent: 0, atTodaysRate: false, window: null };
  const counted = new Set(Array.isArray(budget.categoryIds) ? budget.categoryIds : []);
  const from = window.start.getTime();
  const to = window.end.getTime();
  let spent = 0;
  let atTodaysRate = false;
  for (const copy of copies) {
    if (copy.type !== 'expense' || !isAmount(copy.amount)) continue;
    if (!counted.has(copy.bucket) && !counted.has(copy.bucketGroup)) continue;
    const when = toDate(copy.date)?.getTime();
    if (when === undefined || when < from || when > to) continue;
    const { amount, converted } = inCurrency(copy, budget.currency, convert);
    spent += amount;
    atTodaysRate ||= converted;
  }
  return { spent: roundMoney(spent), atTodaysRate, window };
}

/**
 * A household goal's progress: the copies linked to it, of either type as a
 * personal goal's links are, each in the goal's currency (exactly when
 * already in it, otherwise at today's rate), and the contributions members
 * recorded, which are entered in that currency. `linked` may hold copies
 * linked to other goals; only this goal's count. An amount that cannot be
 * read is passed over.
 */
export function goalProgress(
  goal: Pick<HouseholdGoal, 'id' | 'currency' | 'targetAmount'>,
  linked: readonly PlanCopy[],
  contributions: readonly Pick<HouseholdContribution, 'amount'>[],
  convert: ConvertAtTodaysRate
): GoalProgress {
  let fromCopies = 0;
  let atTodaysRate = false;
  for (const copy of linked) {
    if (copy.goalId !== goal.id || !isAmount(copy.amount)) continue;
    const { amount, converted } = inCurrency(copy, goal.currency, convert);
    fromCopies += amount;
    atTodaysRate ||= converted;
  }
  let contributed = 0;
  for (const contribution of contributions) {
    if (isAmount(contribution.amount)) contributed += contribution.amount;
  }
  const saved = roundMoney(fromCopies + contributed);
  return {
    saved,
    linked: roundMoney(fromCopies),
    contributed: roundMoney(contributed),
    fraction: isAmount(goal.targetAmount) && goal.targetAmount > 0 ? Math.max(0, saved / goal.targetAmount) : 0,
    atTodaysRate
  };
}

/**
 * The dates the household's active budgets count now, as one span: the
 * earliest window start and the latest window end. The household view reads
 * its copies over this span as well as its own period, so each budget folds
 * from copies already read. Null when no active budget has a window.
 */
export function planWindow(
  budgets: readonly Pick<HouseholdBudget, 'isActive' | 'period' | 'startDate' | 'endDate'>[],
  now: Date
): DateWindow | null {
  const windows = budgets
    .filter(budget => budget.isActive === true)
    .map(budget => householdBudgetWindow(budget, now))
    .filter((window): window is DateWindow => window !== null);
  if (windows.length === 0) return null;
  return {
    start: new Date(Math.min(...windows.map(window => window.start.getTime()))),
    end: new Date(Math.max(...windows.map(window => window.end.getTime())))
  };
}
