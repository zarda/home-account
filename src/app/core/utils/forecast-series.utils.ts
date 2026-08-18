import { TransactionType } from '../../models';
import { addDays, dayKey, startOfDay } from './transaction-date.utils';

/**
 * The cash-flow forecast's chart data (ADR 0022, ADR 0054).
 *
 * The projection baselines at ZERO ON TODAY: the app has no account-balance
 * concept, so an absolute-balance line would be an invented number. What the
 * chart honestly knows is the direction and size of upcoming change, so the
 * projected series is the cumulative net of scheduled occurrences from
 * today, and the actual series is the period's cumulative net up to today
 * for context. The two meet at today's tick.
 *
 * The series is built one whole day at a time and then folded into
 * fixed-width buckets, so a period that opened years ago costs the same
 * number of points as this month's. Every tick spans the same number of
 * days, on both sides of today.
 */

/**
 * Bucket widths in whole days, narrowest first.
 *
 * Fixed day counts, never calendar months: a month runs 28 to 31 days, so
 * month buckets would make one tick span more time than the next — the exact
 * opposite of what this ladder exists for — and would drag in the
 * Jan 31 → Feb 28 clamping problem. Fixed counts step with `addDays`, which
 * is already the DST-safe primitive here.
 */
const BUCKET_DAY_RUNGS = [1, 7, 30, 365] as const;

export type BucketDays = (typeof BUCKET_DAY_RUNGS)[number];

/**
 * Ceiling on plotted points, whatever the period's span (ADR 0054). A period
 * that opened years ago used to draw one point per day all the way to today:
 * picking 2015 with a 90-day horizon was ~4,300 points, of which the
 * projection was the last ninety.
 */
export const MAX_FORECAST_POINTS = 200;

export interface ForecastSeries {
  /**
   * Day key of each plotted point — the LAST day of the bucket it stands
   * for. One entry per day only while `bucketDays` is 1.
   */
  bucketEnds: string[];
  /** Cumulative net of the period's actuals; null after today. */
  actualCumulative: (number | null)[];
  /** Cumulative projected net change; 0 at today, null before it. */
  projectedCumulative: (number | null)[];
  todayIndex: number;
  /** Whole days each point spans (ADR 0054). */
  bucketDays: BucketDays;
}

/**
 * The narrowest rung that keeps the whole span under the point ceiling.
 *
 * Counted from today outwards, because that is how the buckets are laid out:
 * the history side and the projection side each round up on their own, and
 * today's own point is the boundary they share.
 */
function chooseBucketDays(todayIndex: number, lastIndex: number): BucketDays {
  for (const rung of BUCKET_DAY_RUNGS) {
    const history = Math.ceil(todayIndex / rung);
    const projection = Math.ceil((lastIndex - todayIndex) / rung);
    if (history + projection + 1 <= MAX_FORECAST_POINTS) return rung;
  }
  return BUCKET_DAY_RUNGS[BUCKET_DAY_RUNGS.length - 1];
}

/**
 * Which days of the daily walk survive as plotted points, and where today
 * lands among them.
 *
 * Bucketing is pure index selection over the finished daily arrays — never a
 * recomputation and never an average. A mean of a cumulative series would be
 * a number that is in no day's ledger; taking the bucket's last day means
 * every plotted value is one the daily walk actually reached.
 *
 * Boundaries are walked OUTWARD FROM TODAY, so one always lands exactly on
 * today and the two datasets still meet at that tick (ADR 0022). Index 0 and
 * the last index are always emitted, so the series still starts at the period
 * start and still ends at today + horizon — the seam the occurrence query
 * agrees with (ADR 0026). The oldest and newest buckets may be short.
 *
 * At rung 1 this returns every index, so a period inside the ceiling plots
 * exactly as it did before bucketing existed.
 */
function bucketIndices(
  todayIndex: number,
  lastIndex: number,
  bucketDays: number
): { indices: number[]; todayIndex: number } {
  const indices: number[] = [];

  for (let i = todayIndex; i > 0; i -= bucketDays) indices.push(i);
  indices.push(0);
  indices.reverse();
  const foldedTodayIndex = indices.length - 1;

  for (let i = todayIndex + bucketDays; i < lastIndex; i += bucketDays) indices.push(i);
  if (lastIndex > todayIndex) indices.push(lastIndex);

  return { indices, todayIndex: foldedTodayIndex };
}

export interface ForecastEntry {
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
  const dailyActual: (number | null)[] = [];
  const dailyProjected: (number | null)[] = [];

  let cursor = startOfDay(start);
  let actualRunning = 0;
  let projectedRunning = 0;
  let todayIndex = 0;

  for (let step = 0; ; step += 1) {
    const key = dayKey(cursor);
    days.push(key);

    if (key <= todayKey) {
      actualRunning += actualByDay.get(key) ?? 0;
      dailyActual.push(actualRunning);
    } else {
      dailyActual.push(null);
    }

    if (key < todayKey) {
      dailyProjected.push(null);
    } else {
      projectedRunning += projectedByDay.get(key) ?? 0;
      dailyProjected.push(projectedRunning);
    }

    if (key === todayKey) {
      todayIndex = days.length - 1;
    }
    if (key >= todayKey && days.length - 1 - todayIndex >= args.horizonDays) {
      break;
    }

    cursor = addDays(cursor, 1);
  }

  // Fold the daily walk down to a bounded number of fixed-width points. The
  // walk itself stays whole-day and DST-safe above; everything below is
  // selection over what it produced (ADR 0054).
  const lastIndex = days.length - 1;
  const bucketDays = chooseBucketDays(todayIndex, lastIndex);
  const folded = bucketIndices(todayIndex, lastIndex, bucketDays);

  return {
    bucketEnds: folded.indices.map(i => days[i]),
    actualCumulative: folded.indices.map(i => dailyActual[i]),
    projectedCumulative: folded.indices.map(i => dailyProjected[i]),
    todayIndex: folded.todayIndex,
    bucketDays
  };
}
