import { TransactionType } from '../../models';
import { addDays, dayKey, startOfDay } from './transaction-date.utils';

/**
 * The cash-flow forecast's chart data (ADR 0022).
 *
 * The projection baselines at ZERO ON TODAY: the app has no account-balance
 * concept, so an absolute-balance line would be an invented number. What the
 * chart honestly knows is the direction and size of upcoming change, so the
 * projected series is the cumulative net of scheduled occurrences from
 * today, and the actual series is the period's cumulative net up to today
 * for context. The two meet at today's tick.
 */
export interface ForecastSeries {
  /** Day keys from the period start (or today, if later) to today+horizon. */
  days: string[];
  /** Cumulative net of the period's actuals; null after today. */
  actualCumulative: (number | null)[];
  /** Cumulative projected net change; 0 at today, null before it. */
  projectedCumulative: (number | null)[];
  todayIndex: number;
}

interface ForecastEntry {
  date: Date;
  /** Always positive; `type` carries the sign. */
  amount: number;
  type: TransactionType;
}

export function buildForecastSeries(args: {
  today: Date;
  horizonDays: number;
  periodStart: Date;
  /** The selected period's transactions, in the base currency. */
  actuals: ForecastEntry[];
  /** Scheduled occurrences, in the base currency. */
  occurrences: ForecastEntry[];
}): ForecastSeries {
  const todayKey = dayKey(args.today);

  // Net change per day, keyed by day. Occurrences on or before today are
  // dropped: the catch-up engine materializes them as real transactions,
  // and counting them here as well would double them at the seam.
  const projectedByDay = new Map<string, number>();
  for (const occurrence of args.occurrences) {
    const key = dayKey(occurrence.date);
    if (key <= todayKey) continue;
    const signed = occurrence.type === 'income' ? occurrence.amount : -occurrence.amount;
    projectedByDay.set(key, (projectedByDay.get(key) ?? 0) + signed);
  }

  const actualByDay = new Map<string, number>();
  for (const actual of args.actuals) {
    const key = dayKey(actual.date);
    if (key > todayKey) continue;
    const signed = actual.type === 'income' ? actual.amount : -actual.amount;
    actualByDay.set(key, (actualByDay.get(key) ?? 0) + signed);
  }

  // Walk whole local calendar days with a date cursor — never raw
  // millisecond adds, which drift across DST (issue #201's lesson).
  const start =
    args.periodStart.getTime() <= args.today.getTime() ? args.periodStart : args.today;
  const days: string[] = [];
  const actualCumulative: (number | null)[] = [];
  const projectedCumulative: (number | null)[] = [];

  let cursor = startOfDay(start);
  let actualRunning = 0;
  let projectedRunning = 0;
  let todayIndex = 0;

  for (let step = 0; ; step += 1) {
    const key = dayKey(cursor);
    days.push(key);

    if (key <= todayKey) {
      actualRunning += actualByDay.get(key) ?? 0;
      actualCumulative.push(actualRunning);
    } else {
      actualCumulative.push(null);
    }

    if (key < todayKey) {
      projectedCumulative.push(null);
    } else {
      projectedRunning += projectedByDay.get(key) ?? 0;
      projectedCumulative.push(projectedRunning);
    }

    if (key === todayKey) {
      todayIndex = days.length - 1;
    }
    if (key >= todayKey && days.length - 1 - todayIndex >= args.horizonDays) {
      break;
    }

    cursor = addDays(cursor, 1);
  }

  return { days, actualCumulative, projectedCumulative, todayIndex };
}
