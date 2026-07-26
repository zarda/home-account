import {
  MonthlyCategorySeries,
  compareIds,
  finiteOrNull,
  roundMoney,
  roundRatio,
} from './transaction-aggregation.utils';

/**
 * Category spending trends across a trailing window of whole months.
 *
 * Windowing lives outside this detector: the caller passes an explicit month
 * list and `bucketByMonthAndCategory` zero-fills it. That has two consequences,
 * both wanted. There is no clock read here, so the output is reproducible. And a
 * category with spending in the first and last month of the window reads as
 * *falling* rather than steady, because the empty months in between are present
 * as zeros instead of being missing points.
 *
 * The caller must also exclude an incomplete final month. A partial current
 * month drags every trend down and produces "your groceries are falling 40%" on
 * the third of the month, which is the most embarrassing possible false insight.
 */

export interface CategoryTrend {
  categoryId: string;
  /** Per-month totals, oldest first, parallel to the series' months. */
  series: number[];
  /** Ordinary least squares slope, base currency per month. */
  slopePerMonth: number;
  meanMonthly: number;
  /** slopePerMonth / meanMonthly. Null when the mean is zero. */
  relativeSlope: number | null;
  firstHalfMean: number;
  secondHalfMean: number;
  /** (second - first) / first. Null when the first half is zero. */
  changeRatio: number | null;
  direction: 'rising' | 'falling' | 'steady';
  /** Months with any spending at all. */
  activeMonths: number;
  /** This category's share of all window spending. */
  windowShare: number;
  transactionCount: number;
}

export interface CategoryTrendOptions {
  /** Below this many months the detector returns nothing at all. */
  minMonths: number;
  /** Months with spending needed before a direction is claimed. */
  minActiveMonths: number;
  /** Share of window spending below which a category is noise. */
  minWindowShare: number;
  /** |relativeSlope| beyond which a direction is claimed. */
  directionThreshold: number;
  cap: number;
}

export const DEFAULT_CATEGORY_TREND_OPTIONS: CategoryTrendOptions = {
  minMonths: 3,
  minActiveMonths: 3,
  minWindowShare: 0.02,
  directionThreshold: 0.08,
  cap: 5,
};

/** Least-squares slope over x = 0..n-1. Zero for fewer than two points. */
function ordinaryLeastSquaresSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;

  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    covariance += (i - meanX) * (values[i] - meanY);
    variance += (i - meanX) ** 2;
  }
  return variance === 0 ? 0 : covariance / variance;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Rising and falling categories over the window, largest relative move first.
 *
 * Two numbers are reported on purpose. `slopePerMonth` is the direction signal,
 * because a least-squares fit is not thrown off by a single spike the way a
 * last-month-vs-first-month comparison would be. `changeRatio` is the sentence
 * number — "18% higher over the last three months than the first three" — since
 * a slope in currency per month is not plain language.
 *
 * The noise gate is a *share* of window spending rather than an absolute amount,
 * which is the only floor that behaves the same for a JPY user and a USD user
 * without hardcoding a currency-specific constant.
 */
export function computeCategoryTrends(
  series: MonthlyCategorySeries,
  options: Partial<CategoryTrendOptions> = {},
): CategoryTrend[] {
  const settings = { ...DEFAULT_CATEGORY_TREND_OPTIONS, ...options };
  if (series.months.length < settings.minMonths || series.windowTotal <= 0) {
    return [];
  }

  const countsById = new Map(
    series.countsByCategory.map(entry => [entry.categoryId, entry.values]));

  const trends: CategoryTrend[] = [];
  for (const entry of series.totalsByCategory) {
    const values = entry.values;
    const total = values.reduce((sum, value) => sum + value, 0);
    const windowShare = roundRatio(total / series.windowTotal);
    if (windowShare < settings.minWindowShare) {
      continue;
    }

    const activeMonths = values.filter(value => value > 0).length;
    const middle = Math.floor(values.length / 2);
    // Odd month counts drop the middle month from both halves rather than
    // letting it weight one side, so the comparison stays symmetric.
    const firstHalf = values.slice(0, middle);
    const secondHalf = values.slice(values.length - middle);

    const meanMonthly = mean(values);
    const slopePerMonth = ordinaryLeastSquaresSlope(values);
    const relativeSlope = meanMonthly > 0
      ? finiteOrNull(roundRatio(slopePerMonth / meanMonthly))
      : null;
    const firstHalfMean = mean(firstHalf);
    const secondHalfMean = mean(secondHalf);

    let direction: CategoryTrend['direction'] = 'steady';
    if (relativeSlope !== null && activeMonths >= settings.minActiveMonths) {
      if (relativeSlope >= settings.directionThreshold) {
        direction = 'rising';
      } else if (relativeSlope <= -settings.directionThreshold) {
        direction = 'falling';
      }
    }

    trends.push({
      categoryId: entry.categoryId,
      series: [...values],
      slopePerMonth: roundMoney(slopePerMonth),
      meanMonthly: roundMoney(meanMonthly),
      relativeSlope,
      firstHalfMean: roundMoney(firstHalfMean),
      secondHalfMean: roundMoney(secondHalfMean),
      changeRatio: firstHalfMean > 0
        ? finiteOrNull(roundRatio((secondHalfMean - firstHalfMean) / firstHalfMean))
        : null,
      direction,
      activeMonths,
      windowShare,
      transactionCount: (countsById.get(entry.categoryId) ?? [])
        .reduce((sum, count) => sum + count, 0),
    });
  }

  // Only categories that actually moved are worth a card.
  return trends
    .filter(trend => trend.direction !== 'steady')
    .sort((a, b) => Math.abs(b.relativeSlope ?? 0) - Math.abs(a.relativeSlope ?? 0)
      || compareIds(a.categoryId, b.categoryId))
    .slice(0, settings.cap);
}
