import { Transaction } from '../../models';
import { DetectorWindow } from './spending-pattern.types';
import {
  DEFAULT_WEEKEND_DAYS,
  countDaysByKind,
  dateOf,
  isLastDaysOfMonth,
  isWeekend,
} from './transaction-date.utils';
import {
  ToBase,
  compareIds,
  finiteOrNull,
  roundMoney,
  roundRatio,
} from './transaction-aggregation.utils';

/**
 * Habit rhythms: weekday against weekend, month-end spikes, and payday effects.
 *
 * **Everything here compares per-day averages, never totals.** That is the one
 * thing this detector has to get right. A month holds roughly 22 weekdays to 8
 * weekend days, and roughly 25 non-tail days to 5 month-end days. Comparing
 * totals would tell essentially every user on earth that they "spend more on
 * weekdays" and that they have "no month-end spike" — two confidently wrong
 * sentences. So the calendar days of each kind are counted and divided out,
 * which is why those counts are part of the returned shape rather than being
 * derived in a template where they could quietly be forgotten.
 *
 * Day-of-week and day-of-month are read from local date parts, so the output is
 * a function of the runtime's IANA zone. Anything persisting these results has
 * to record the zone alongside them, or a user crossing time zones silently
 * invalidates their own history.
 */

export interface WeekdayWeekendSplit {
  weekdayTotal: number;
  weekendTotal: number;
  weekdayCount: number;
  weekendCount: number;
  /** Calendar days of each kind in the window — the divisors. */
  weekdayDays: number;
  weekendDays: number;
  weekdayDailyAverage: number;
  weekendDailyAverage: number;
  /** weekendDailyAverage / weekdayDailyAverage. Null when the weekday side is zero. */
  ratio: number | null;
  lean: 'weekend' | 'weekday' | 'even';
}

export interface MonthEndSpike {
  tailDays: number;
  tailTotal: number;
  restTotal: number;
  tailCount: number;
  restCount: number;
  tailDailyAverage: number;
  restDailyAverage: number;
  ratio: number | null;
  isSpike: boolean;
  /** Newest first, capped. Drill-down only; dropped before a snapshot is written. */
  transactionIds: string[];
}

export interface PaydayEffect {
  /** How the payday was established, or 'none' when it could not be. */
  basis: 'recurringIncome' | 'incomeDates' | 'none';
  paydayDayOfMonth: number | null;
  /** Days counted as post-payday, inclusive of the payday itself. */
  windowDays: number;
  postPaydayTotal: number;
  otherTotal: number;
  postPaydayCount: number;
  otherCount: number;
  postPaydayDailyAverage: number;
  otherDailyAverage: number;
  ratio: number | null;
  isPresent: boolean;
  transactionIds: string[];
}

export interface HabitRhythms {
  /** False when the window holds too few transactions to say anything. */
  hasEnoughData: boolean;
  transactionCount: number;
  weekdayWeekend: WeekdayWeekendSplit;
  monthEnd: MonthEndSpike;
  payday: PaydayEffect;
}

export interface HabitRhythmOptions {
  minTransactions: number;
  weekendDays: readonly number[];
  /** |ratio - 1| must exceed this before a lean is claimed. */
  leanThreshold: number;
  tailDays: number;
  spikeThreshold: number;
  minTailSamples: number;
  minRestSamples: number;
  paydayWindowDays: number;
  paydayThreshold: number;
  minPaydaySamples: number;
  /** Income occurrences needed to trust a declared payday. */
  minRecurringIncomeSamples: number;
  /** Income transactions needed to infer a payday from dates alone. */
  minInferredIncomeSamples: number;
  /** Fraction of income that must cluster near the inferred payday. */
  paydayAgreementRatio: number;
  /** Days either side of the inferred payday that count as agreement. */
  paydayAgreementDays: number;
  idCap: number;
}

export const DEFAULT_HABIT_RHYTHM_OPTIONS: HabitRhythmOptions = {
  minTransactions: 20,
  weekendDays: DEFAULT_WEEKEND_DAYS,
  leanThreshold: 0.2,
  tailDays: 5,
  spikeThreshold: 1.3,
  minTailSamples: 6,
  minRestSamples: 10,
  paydayWindowDays: 3,
  paydayThreshold: 1.25,
  minPaydaySamples: 5,
  minRecurringIncomeSamples: 2,
  minInferredIncomeSamples: 3,
  paydayAgreementRatio: 0.6,
  paydayAgreementDays: 2,
  idCap: 50,
};

interface Entry {
  transaction: Transaction;
  date: Date;
  value: number;
}

function average(total: number, divisor: number): number {
  return divisor > 0 ? roundMoney(total / divisor) : 0;
}

function ratioOf(numerator: number, denominator: number): number | null {
  return denominator > 0 ? finiteOrNull(roundRatio(numerator / denominator, 3)) : null;
}

function newestIds(entries: Entry[], cap: number): string[] {
  return [...entries]
    .sort((a, b) => b.date.getTime() - a.date.getTime()
      || compareIds(a.transaction.id, b.transaction.id))
    .slice(0, cap)
    .map(entry => entry.transaction.id);
}

/**
 * The most common day-of-month among the given dates, with the count that
 * agreed. Ties resolve to the earlier day so the result is deterministic.
 */
function modeDayOfMonth(dates: Date[]): { day: number; count: number } | null {
  if (dates.length === 0) {
    return null;
  }
  const counts = new Map<number, number>();
  for (const date of dates) {
    const day = date.getDate();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: { day: number; count: number } | null = null;
  for (const [day, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (!best || count > best.count) {
      best = { day, count };
    }
  }
  return best;
}

/**
 * Establish the payday, preferring the strongest evidence available.
 *
 * Deliberately not keyed on an `employment_salary` category id: categories are
 * user-extensible and that default is not guaranteed to exist in every account.
 */
function resolvePayday(
  incomes: Entry[],
  options: HabitRhythmOptions,
): { basis: PaydayEffect['basis']; day: number | null } {
  const declared = incomes.filter(entry => entry.transaction.recurringId);
  const declaredMode = modeDayOfMonth(declared.map(entry => entry.date));
  if (declaredMode && declaredMode.count >= options.minRecurringIncomeSamples) {
    return { basis: 'recurringIncome', day: declaredMode.day };
  }

  const inferredMode = modeDayOfMonth(incomes.map(entry => entry.date));
  if (inferredMode && incomes.length >= options.minInferredIncomeSamples) {
    // One mode among scattered income dates means nothing; most of the income
    // has to land near it before it can be called a payday.
    const nearby = incomes.filter(
      entry => Math.abs(entry.date.getDate() - inferredMode.day)
        <= options.paydayAgreementDays).length;
    if (nearby / incomes.length >= options.paydayAgreementRatio) {
      return { basis: 'incomeDates', day: inferredMode.day };
    }
  }

  return { basis: 'none', day: null };
}

function emptyRhythms(
  transactionCount: number,
  options: HabitRhythmOptions,
): HabitRhythms {
  return {
    hasEnoughData: false,
    transactionCount,
    weekdayWeekend: {
      weekdayTotal: 0, weekendTotal: 0, weekdayCount: 0, weekendCount: 0,
      weekdayDays: 0, weekendDays: 0,
      weekdayDailyAverage: 0, weekendDailyAverage: 0,
      ratio: null, lean: 'even',
    },
    monthEnd: {
      tailDays: options.tailDays,
      tailTotal: 0, restTotal: 0, tailCount: 0, restCount: 0,
      tailDailyAverage: 0, restDailyAverage: 0,
      ratio: null, isSpike: false, transactionIds: [],
    },
    payday: {
      basis: 'none', paydayDayOfMonth: null, windowDays: options.paydayWindowDays,
      postPaydayTotal: 0, otherTotal: 0, postPaydayCount: 0, otherCount: 0,
      postPaydayDailyAverage: 0, otherDailyAverage: 0,
      ratio: null, isPresent: false, transactionIds: [],
    },
  };
}

export function computeHabitRhythms(
  expenses: Transaction[],
  incomes: Transaction[],
  toBase: ToBase,
  window: DetectorWindow,
  options: Partial<HabitRhythmOptions> = {},
): HabitRhythms {
  const settings = { ...DEFAULT_HABIT_RHYTHM_OPTIONS, ...options };
  const inWindow = (list: Transaction[], type: Transaction['type']): Entry[] => list
    .filter(transaction => transaction.type === type)
    .map(transaction => ({ transaction, date: dateOf(transaction), value: toBase(transaction) }))
    .filter(entry => entry.date >= window.start && entry.date <= window.end);

  const expenseEntries = inWindow(expenses, 'expense');
  const incomeEntries = inWindow(incomes, 'income');

  // The gate lives here rather than in a template so it is unit-tested.
  if (expenseEntries.length < settings.minTransactions) {
    return emptyRhythms(expenseEntries.length, settings);
  }

  const days = countDaysByKind(window.start, window.end, settings.weekendDays);

  // Weekday against weekend, normalised by the count of each kind of day.
  const weekendEntries = expenseEntries.filter(
    entry => isWeekend(entry.date, settings.weekendDays));
  const weekdayEntries = expenseEntries.filter(
    entry => !isWeekend(entry.date, settings.weekendDays));
  const weekdayTotal = weekdayEntries.reduce((sum, entry) => sum + entry.value, 0);
  const weekendTotal = weekendEntries.reduce((sum, entry) => sum + entry.value, 0);
  const weekdayDailyAverage = average(weekdayTotal, days.weekdayDays);
  const weekendDailyAverage = average(weekendTotal, days.weekendDays);
  const weekendRatio = ratioOf(weekendDailyAverage, weekdayDailyAverage);

  let lean: WeekdayWeekendSplit['lean'] = 'even';
  if (weekendRatio !== null && Math.abs(weekendRatio - 1) > settings.leanThreshold) {
    lean = weekendRatio > 1 ? 'weekend' : 'weekday';
  }

  // Month-end tail. The divisors are the tail days actually present in the
  // window, summed per month, since February's tail is as long as January's but
  // the window may not cover whole months at either edge.
  const tailEntries = expenseEntries.filter(
    entry => isLastDaysOfMonth(entry.date, settings.tailDays));
  const restEntries = expenseEntries.filter(
    entry => !isLastDaysOfMonth(entry.date, settings.tailDays));
  let tailDayCount = 0;
  const cursor = new Date(
    window.start.getFullYear(), window.start.getMonth(), window.start.getDate());
  for (let i = 0; i < days.totalDays; i += 1) {
    if (isLastDaysOfMonth(cursor, settings.tailDays)) {
      tailDayCount += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  const restDayCount = days.totalDays - tailDayCount;
  const tailTotal = tailEntries.reduce((sum, entry) => sum + entry.value, 0);
  const restTotal = restEntries.reduce((sum, entry) => sum + entry.value, 0);
  const tailDailyAverage = average(tailTotal, tailDayCount);
  const restDailyAverage = average(restTotal, restDayCount);
  const tailRatio = ratioOf(tailDailyAverage, restDailyAverage);

  // Payday effect over the payday and the following days.
  const payday = resolvePayday(incomeEntries, settings);
  const isPostPayday = (date: Date): boolean => {
    if (payday.day === null) {
      return false;
    }
    const offset = date.getDate() - payday.day;
    return offset >= 0 && offset < settings.paydayWindowDays;
  };
  const postPaydayEntries = payday.day === null
    ? []
    : expenseEntries.filter(entry => isPostPayday(entry.date));
  const otherPaydayEntries = payday.day === null
    ? []
    : expenseEntries.filter(entry => !isPostPayday(entry.date));

  let postPaydayDayCount = 0;
  if (payday.day !== null) {
    const paydayCursor = new Date(
      window.start.getFullYear(), window.start.getMonth(), window.start.getDate());
    for (let i = 0; i < days.totalDays; i += 1) {
      if (isPostPayday(paydayCursor)) {
        postPaydayDayCount += 1;
      }
      paydayCursor.setDate(paydayCursor.getDate() + 1);
    }
  }
  const otherDayCount = payday.day === null ? 0 : days.totalDays - postPaydayDayCount;
  const postPaydayTotal = postPaydayEntries.reduce((sum, entry) => sum + entry.value, 0);
  const otherPaydayTotal = otherPaydayEntries.reduce((sum, entry) => sum + entry.value, 0);
  const postPaydayDailyAverage = average(postPaydayTotal, postPaydayDayCount);
  const otherDailyAverage = average(otherPaydayTotal, otherDayCount);
  const paydayRatio = ratioOf(postPaydayDailyAverage, otherDailyAverage);

  return {
    hasEnoughData: true,
    transactionCount: expenseEntries.length,
    weekdayWeekend: {
      weekdayTotal: roundMoney(weekdayTotal),
      weekendTotal: roundMoney(weekendTotal),
      weekdayCount: weekdayEntries.length,
      weekendCount: weekendEntries.length,
      weekdayDays: days.weekdayDays,
      weekendDays: days.weekendDays,
      weekdayDailyAverage,
      weekendDailyAverage,
      ratio: weekendRatio,
      lean,
    },
    monthEnd: {
      tailDays: settings.tailDays,
      tailTotal: roundMoney(tailTotal),
      restTotal: roundMoney(restTotal),
      tailCount: tailEntries.length,
      restCount: restEntries.length,
      tailDailyAverage,
      restDailyAverage,
      ratio: tailRatio,
      isSpike: tailRatio !== null
        && tailRatio >= settings.spikeThreshold
        && tailEntries.length >= settings.minTailSamples
        && restEntries.length >= settings.minRestSamples,
      transactionIds: newestIds(tailEntries, settings.idCap),
    },
    payday: {
      basis: payday.basis,
      paydayDayOfMonth: payday.day,
      windowDays: settings.paydayWindowDays,
      postPaydayTotal: roundMoney(postPaydayTotal),
      otherTotal: roundMoney(otherPaydayTotal),
      postPaydayCount: postPaydayEntries.length,
      otherCount: otherPaydayEntries.length,
      postPaydayDailyAverage,
      otherDailyAverage,
      ratio: paydayRatio,
      isPresent: paydayRatio !== null
        && paydayRatio >= settings.paydayThreshold
        && postPaydayEntries.length >= settings.minPaydaySamples,
      transactionIds: newestIds(postPaydayEntries, settings.idCap),
    },
  };
}
