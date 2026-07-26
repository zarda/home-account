import { Transaction } from '../../models';
import { DetectorWindow } from './spending-pattern.types';
import { dateOf, monthKeysBetween } from './transaction-date.utils';
import {
  ToBase,
  compareIds,
  finiteOrNull,
  median,
  percentileNearestRank,
  roundMoney,
  roundRatio,
} from './transaction-aggregation.utils';

/**
 * The small-amount drip: many minor purchases that add up to real money.
 *
 * Two design constraints drive the whole detector.
 *
 * The threshold cannot be an absolute amount. There is no figure that means
 * "small" for both a JPY user and a USD user, so "small" is defined relative to
 * the user's own distribution — the 25th percentile of this window's expenses.
 * That also satisfies the issue's boundary that a user is only ever compared
 * against their own history.
 *
 * The count cannot be the signal. The 25th percentile holds a quarter of the
 * transactions by construction, so gating on count would hand every user the
 * same card. The finding is gated on the bucket's *share of value*: a user whose
 * smallest quarter sums to 1% of spending learns nothing, while one whose
 * smallest quarter sums to 15% has found the actual phenomenon.
 */

export interface DripCategoryTotal {
  categoryId: string;
  count: number;
  total: number;
}

export interface SmallAmountDrip {
  /** Inclusive upper bound for "small": nearest-rank p25 of the window. */
  threshold: number;
  count: number;
  total: number;
  /** `total` divided by the months the window spans. */
  monthlyAverage: number;
  /** `total` as a fraction of all window expenses. */
  shareOfSpending: number;
  medianAmount: number;
  byCategory: DripCategoryTotal[];
  /** Newest first, capped. Drill-down only; dropped before a snapshot is written. */
  transactionIds: string[];
  /** True when `transactionIds` was truncated by the cap. */
  truncated: boolean;
  /**
   * True when every window expense is already in the base currency, so the
   * threshold may be handed to the amount filter on the Transactions page.
   * That filter compares raw native amounts while the threshold is in base
   * currency, so narrowing by amount is only honest when the two agree.
   */
  filterSafe: boolean;
  isNotable: boolean;
}

export interface SmallDripOptions {
  percentile: number;
  /** Transactions needed before the bucket is worth mentioning. */
  minCount: number;
  /** Share of window spending the bucket must reach. */
  minShare: number;
  categoryCap: number;
  idCap: number;
}

export const DEFAULT_SMALL_DRIP_OPTIONS: SmallDripOptions = {
  percentile: 0.25,
  minCount: 20,
  minShare: 0.08,
  categoryCap: 5,
  idCap: 50,
};

const EMPTY_DRIP: SmallAmountDrip = {
  threshold: 0,
  count: 0,
  total: 0,
  monthlyAverage: 0,
  shareOfSpending: 0,
  medianAmount: 0,
  byCategory: [],
  transactionIds: [],
  truncated: false,
  filterSafe: false,
  isNotable: false,
};

export function computeSmallAmountDrip(
  expenses: Transaction[],
  toBase: ToBase,
  window: DetectorWindow,
  baseCurrency: string,
  options: Partial<SmallDripOptions> = {},
): SmallAmountDrip {
  const settings = { ...DEFAULT_SMALL_DRIP_OPTIONS, ...options };

  const inWindow = expenses
    .filter(transaction => transaction.type === 'expense')
    .map(transaction => ({ transaction, date: dateOf(transaction), value: toBase(transaction) }))
    .filter(entry => entry.date >= window.start && entry.date <= window.end);

  if (inWindow.length === 0) {
    return { ...EMPTY_DRIP };
  }

  const windowTotal = inWindow.reduce((sum, entry) => sum + entry.value, 0);
  const threshold = roundMoney(
    percentileNearestRank(inWindow.map(entry => entry.value), settings.percentile));

  const small = inWindow
    .filter(entry => entry.value <= threshold)
    .sort((a, b) => b.date.getTime() - a.date.getTime()
      || compareIds(a.transaction.id, b.transaction.id));

  if (small.length === 0) {
    return { ...EMPTY_DRIP, threshold };
  }

  const total = small.reduce((sum, entry) => sum + entry.value, 0);
  const months = Math.max(1, monthKeysBetween(window.start, window.end).length);
  const shareOfSpending = windowTotal > 0
    ? (finiteOrNull(roundRatio(total / windowTotal)) ?? 0)
    : 0;

  const categoryTotals = new Map<string, { count: number; total: number }>();
  for (const entry of small) {
    const { categoryId } = entry.transaction;
    const current = categoryTotals.get(categoryId) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += entry.value;
    categoryTotals.set(categoryId, current);
  }

  return {
    threshold,
    count: small.length,
    total: roundMoney(total),
    monthlyAverage: roundMoney(total / months),
    shareOfSpending,
    medianAmount: roundMoney(median(small.map(entry => entry.value))),
    byCategory: [...categoryTotals.entries()]
      .map(([categoryId, entry]) => ({
        categoryId,
        count: entry.count,
        total: roundMoney(entry.total),
      }))
      .sort((a, b) => b.total - a.total || compareIds(a.categoryId, b.categoryId))
      .slice(0, settings.categoryCap),
    transactionIds: small.slice(0, settings.idCap).map(entry => entry.transaction.id),
    truncated: small.length > settings.idCap,
    filterSafe: inWindow.every(entry => entry.transaction.currency === baseCurrency),
    isNotable: small.length >= settings.minCount && shareOfSpending >= settings.minShare,
  };
}
