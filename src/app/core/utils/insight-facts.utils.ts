import {
  INSIGHT_DETECTOR_VERSION,
  InsightFacts,
  RecurringTransaction,
  Transaction,
} from '../../models';
import { DetectorWindow } from './spending-pattern.types';
import { CategoryTrendOptions, computeCategoryTrends } from './category-trend.utils';
import { HabitRhythmOptions, computeHabitRhythms } from './habit-rhythm.utils';
import { isGroupCovered } from './recurring-conversion.utils';
import { RecurringOptions, computeRecurringGroups } from './recurring-pattern.utils';
import { SmallDripOptions, computeSmallAmountDrip } from './small-drip.utils';
import { dateOf, dayKey } from './transaction-date.utils';
import {
  ToBase,
  bucketByMonthAndCategory,
  compareIds,
  fnv1a32,
  groupExpensesByCategoryWithCounts,
  percentDelta,
  sumByType,
} from './transaction-aggregation.utils';
import { flattenNumbers, stableStringify } from './firestore-value.utils';

/**
 * Runs every detector over one window and returns a single storable bundle.
 *
 * Both the live Insights tab and the monthly snapshot generator call this, which
 * is what makes #117's "identical when regenerated from unchanged data" a
 * property of the code rather than an aspiration. Nothing here reads the clock.
 *
 * Drill-down id lists come back separately from the facts. Snapshots hold
 * aggregates and detector outputs only — never references to individual
 * transactions — so the ids stay in memory for the live tab and are simply not
 * part of what gets persisted.
 */

export interface InsightDetectorOptions {
  recurring?: Partial<RecurringOptions>;
  trends?: Partial<CategoryTrendOptions>;
  rhythms?: Partial<HabitRhythmOptions>;
  drip?: Partial<SmallDripOptions>;
}

export interface InsightComputeInput {
  /** Both types, spanning the whole trailing window. */
  transactions: Transaction[];
  toBase: ToBase;
  window: DetectorWindow;
  /** Complete calendar months for the trend series, ascending. */
  months: string[];
  baseCurrency: string;
  /** IANA zone the day-of-week and month-end maths runs in. */
  timeZone: string;
  /**
   * Rules in force, for suppressing detected groups one already covers.
   *
   * Optional so a caller with nothing to suppress against still gets a result,
   * but both production callers pass it — omitting it silently double-counts
   * every converted subscription (ADR 0042).
   */
  recurringRules?: RecurringTransaction[];
  options?: InsightDetectorOptions;
}

export interface InsightComputation {
  facts: InsightFacts;
  /**
   * Transaction ids behind each inline drill-down, keyed by a stable slot name.
   * Live only; never written to a snapshot.
   */
  drillDownIds: Record<string, string[]>;
  /** True when the drip id list was capped. */
  dripTruncated: boolean;
}

export interface FactDelta {
  /** Dotted path into the facts, e.g. `drip.total`. */
  path: string;
  previous: number | null;
  current: number | null;
  /** Fractional change, or null when there is no comparable base. */
  changeRatio: number | null;
}

/** Shallow copy without the given keys, for stripping ids before persisting. */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const clone = { ...value } as Record<string, unknown>;
  for (const key of keys) {
    delete clone[key as string];
  }
  return clone as Omit<T, K>;
}

/** Milliseconds of a transaction's last write, for fingerprinting. */
function revisionMillis(transaction: Transaction): number {
  const updated = transaction.updatedAt as unknown;
  const updatedDate = updated instanceof Date
    ? updated
    : (updated as { toDate?: () => Date } | null | undefined)?.toDate?.();
  if (updatedDate instanceof Date && !Number.isNaN(updatedDate.getTime())) {
    return updatedDate.getTime();
  }
  // Rows written before updatedAt was stamped fall back to the transaction date,
  // then to zero, so a legacy row still contributes a stable value.
  return dateOf(transaction).getTime();
}

/**
 * Content fingerprint of a transaction set: id and last-write time of every row,
 * plus the count.
 *
 * The count is appended because a deletion has to be visible — two different
 * sets could otherwise collide on the hash alone. Non-cryptographic on purpose;
 * it only has to change when the data changes.
 */
export function transactionFingerprint(transactions: Transaction[]): string {
  const parts = [...transactions]
    .sort((a, b) => compareIds(a.id, b.id))
    .map(transaction => `${transaction.id}:${revisionMillis(transaction)}`);
  return `${fnv1a32(parts.join(';'))}:${transactions.length}`;
}

/** Content fingerprint of a computed fact bundle, over key-sorted JSON. */
export function insightFactsFingerprint(facts: InsightFacts): string {
  return fnv1a32(stableStringify(facts));
}

export function computeInsightFacts(input: InsightComputeInput): InsightComputation {
  const { transactions, toBase, window, months, baseCurrency, timeZone } = input;
  const options = input.options ?? {};

  const inWindow = transactions.filter(transaction => {
    const date = dateOf(transaction);
    return date >= window.start && date <= window.end;
  });
  const expenses = inWindow.filter(transaction => transaction.type === 'expense');
  const incomes = inWindow.filter(transaction => transaction.type === 'income');

  const rules = input.recurringRules ?? [];
  const recurring = computeRecurringGroups(
    expenses, toBase, window, options.recurring, group => isGroupCovered(group, rules));
  const trends = computeCategoryTrends(
    bucketByMonthAndCategory(expenses, toBase, months), options.trends);
  const rhythms = computeHabitRhythms(expenses, incomes, toBase, window, options.rhythms);
  const drip = computeSmallAmountDrip(
    expenses, toBase, window, baseCurrency, options.drip);

  const drillDownIds: Record<string, string[]> = {
    drip: drip.transactionIds,
    habitMonthEnd: rhythms.monthEnd.transactionIds,
    habitPayday: rhythms.payday.transactionIds,
  };
  for (const group of recurring.groups) {
    drillDownIds[`recurring:${group.key}`] = group.transactionIds;
  }

  const facts: InsightFacts = {
    detectorVersion: INSIGHT_DETECTOR_VERSION,
    window: {
      start: dayKey(window.start),
      end: dayKey(window.end),
      months: [...months],
    },
    baseCurrency,
    timeZone,
    totals: sumByType(inWindow, toBase),
    byCategory: groupExpensesByCategoryWithCounts(expenses, toBase),
    recurring: {
      ...recurring,
      groups: recurring.groups.map(group => omit(group, 'transactionIds')),
    },
    trends,
    rhythms: {
      ...rhythms,
      monthEnd: omit(rhythms.monthEnd, 'transactionIds'),
      payday: omit(rhythms.payday, 'transactionIds'),
    },
    drip: omit(drip, 'transactionIds', 'truncated'),
  };

  return { facts, drillDownIds, dripTruncated: drip.truncated };
}

/**
 * Numeric differences between two fact bundles, largest relative move first.
 *
 * Used two ways: to decide whether a written narrative is worth regenerating,
 * and to build the month-over-month comparison. Paths present in only one side
 * are reported with a null on the missing side rather than being skipped, so a
 * detector that stopped finding something is still visible as a change.
 */
export function diffInsightFacts(
  previous: InsightFacts,
  current: InsightFacts,
): FactDelta[] {
  const before = flattenNumbers(previous);
  const after = flattenNumbers(current);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareIds);

  const deltas: FactDelta[] = [];
  for (const path of paths) {
    const previousValue = before.get(path) ?? null;
    const currentValue = after.get(path) ?? null;
    if (previousValue === currentValue) {
      continue;
    }
    deltas.push({
      path,
      previous: previousValue,
      current: currentValue,
      changeRatio: previousValue !== null && currentValue !== null
        ? percentDelta(currentValue, previousValue)
        : null,
    });
  }

  return deltas.sort(
    (a, b) => Math.abs(b.changeRatio ?? 0) - Math.abs(a.changeRatio ?? 0)
      || compareIds(a.path, b.path));
}

/**
 * Whether any number moved enough to be worth re-describing.
 *
 * A path that appeared or disappeared always counts, since a finding starting or
 * stopping is material regardless of magnitude.
 */
export function hasMaterialChange(deltas: FactDelta[], threshold = 0.05): boolean {
  return deltas.some(
    delta => delta.changeRatio === null || Math.abs(delta.changeRatio) >= threshold);
}
