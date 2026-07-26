import {
  InsightCard,
  InsightDrillDown,
  InsightFacts,
  SerializableFilters,
  StorableRecurringGroup,
} from '../../models';
import { RecurringCadence } from './recurring-pattern.utils';
import { compareIds } from './transaction-aggregation.utils';

/**
 * Turns a fact bundle into the cards the Insights tab renders.
 *
 * Kept separate from the detectors so wording and presentation can change
 * without touching a number, and separate from the components so the whole card
 * set is unit-testable without a TestBed.
 *
 * Two rules run through everything here:
 *
 * Money never enters `params`. A formatted amount freezes both a locale and a
 * base currency into a card that may be read years later from a snapshot, so
 * every amount goes into `metrics` as a raw number and the template renders it.
 * Category names never enter `params` either — only ids, which the renderer
 * resolves.
 *
 * Drill-down honesty. A card only advertises a filter when that filter genuinely
 * selects the transactions the number came from. Where no filter expression can
 * reach the subset, the card lists ids inline instead of pretending.
 */

/** Base weights per kind, so ordering across kinds is intentional. */
const WEIGHTS = {
  recurringPortfolio: 100,
  recurringItem: 90,
  categoryTrend: 60,
  smallDrip: 45,
  habit: 30,
} as const;

/**
 * Every i18n key any card can carry.
 *
 * The check-i18n script only sees literal keys in source, and these are consumed
 * through a dynamic `card.titleKey | translate`, so nothing would catch a typo.
 * The spec asserts each of these resolves in every locale — that assertion is
 * the only guard, because a missing key renders as its own text with no English
 * fallback.
 */
export const INSIGHT_CARD_KEYS: readonly string[] = [
  'insights.cadenceWeekly',
  'insights.cadenceBiweekly',
  'insights.cadenceMonthly',
  'insights.cadenceQuarterly',
  'insights.cadenceYearly',
  'insights.recurringPortfolioTitle',
  'insights.recurringPortfolioBody',
  'insights.recurringIncreasedTitle',
  'insights.recurringIncreasedBody',
  'insights.recurringNewTitle',
  'insights.recurringNewBody',
  'insights.trendRisingTitle',
  'insights.trendRisingBody',
  'insights.trendFallingTitle',
  'insights.trendFallingBody',
  'insights.weekendLeanTitle',
  'insights.weekendLeanBody',
  'insights.weekdayLeanTitle',
  'insights.weekdayLeanBody',
  'insights.monthEndTitle',
  'insights.monthEndBody',
  'insights.paydayTitle',
  'insights.paydayBody',
  'insights.smallDripTitle',
  'insights.smallDripBody',
];

/**
 * i18n key for a cadence.
 *
 * The card stores the enum value in `params.cadence`; the renderer swaps in the
 * localised word. Storing the English word would leave "monthly" sitting inside
 * a Japanese sentence, and storing a translated word would freeze the locale into
 * the snapshot.
 */
export function cadenceKey(cadence: RecurringCadence): string {
  const suffix = cadence.charAt(0).toUpperCase() + cadence.slice(1);
  return `insights.cadence${suffix}`;
}

export interface InsightCardOptions {
  /** Notable recurring items to call out individually. */
  recurringItemCap: number;
  /** Trend cards to emit, independent of the detector's own cap. */
  trendCap: number;
}

export const DEFAULT_INSIGHT_CARD_OPTIONS: InsightCardOptions = {
  recurringItemCap: 3,
  trendCap: 3,
};

/** Whole percent from a fraction, for a readable sentence. */
function percentOf(ratio: number): number {
  return Math.round(ratio * 100);
}

/** Percent difference from parity, e.g. a ratio of 1.4 reads as 40. */
function percentAboveParity(ratio: number): number {
  return Math.round(Math.abs(ratio - 1) * 100);
}

/**
 * Build a filters drill-down, omitting absent keys entirely.
 *
 * Conditional spreads rather than assigning undefined: Firestore rejects an
 * undefined field value and would fail the whole snapshot write.
 */
function filtersDrillDown(filters: SerializableFilters): InsightDrillDown {
  const cleaned: SerializableFilters = {};
  if (filters.type !== undefined) cleaned.type = filters.type;
  if (filters.categoryId !== undefined) cleaned.categoryId = filters.categoryId;
  if (filters.startDate !== undefined) cleaned.startDate = filters.startDate;
  if (filters.endDate !== undefined) cleaned.endDate = filters.endDate;
  if (filters.minAmount !== undefined) cleaned.minAmount = filters.minAmount;
  if (filters.maxAmount !== undefined) cleaned.maxAmount = filters.maxAmount;
  if (filters.currency !== undefined) cleaned.currency = filters.currency;
  return { mode: 'filters', filters: cleaned };
}

function inlineDrillDown(ids: string[] | undefined, truncated: boolean): InsightDrillDown {
  return ids && ids.length > 0
    ? { mode: 'inline', transactionIds: [...ids], truncated }
    : { mode: 'none' };
}

function recurringItemCard(
  group: StorableRecurringGroup,
  ids: Record<string, string[]>,
): InsightCard {
  const increased = group.priceIncreased;
  return {
    id: `recurringItem:${group.key}`,
    kind: 'recurringItem',
    titleKey: increased ? 'insights.recurringIncreasedTitle' : 'insights.recurringNewTitle',
    bodyKey: increased ? 'insights.recurringIncreasedBody' : 'insights.recurringNewBody',
    params: { cadence: group.cadence, occurrences: group.occurrenceCount },
    metrics: {
      medianAmount: group.medianAmount,
      monthlyEquivalent: group.monthlyEquivalent,
    },
    categoryIds: [group.categoryId],
    transactionCount: group.occurrenceCount,
    drillDown: inlineDrillDown(ids[`recurring:${group.key}`], false),
    weight: WEIGHTS.recurringItem + (increased ? 5 : 0),
  };
}

export function buildInsightCards(
  facts: InsightFacts,
  drillDownIds: Record<string, string[]> = {},
  dripTruncated = false,
  options: Partial<InsightCardOptions> = {},
): InsightCard[] {
  const settings = { ...DEFAULT_INSIGHT_CARD_OPTIONS, ...options };
  const cards: InsightCard[] = [];
  const windowFilters: SerializableFilters = {
    type: 'expense',
    startDate: facts.window.start,
    endDate: facts.window.end,
  };

  // Recurring portfolio: the headline. No drill-down at card level — the group
  // list below it drills per row, since each cluster is a different subset.
  const { recurring } = facts;
  if (recurring.groupCount > 0) {
    cards.push({
      id: 'recurringPortfolio',
      kind: 'recurringPortfolio',
      titleKey: 'insights.recurringPortfolioTitle',
      bodyKey: 'insights.recurringPortfolioBody',
      params: {
        count: recurring.groupCount,
        declared: recurring.declaredGroupCount,
        detected: recurring.detectedGroupCount,
      },
      metrics: {
        totalMonthlyEquivalent: recurring.totalMonthlyEquivalent,
        declaredMonthlyEquivalent: recurring.declaredMonthlyEquivalent,
        detectedMonthlyEquivalent: recurring.detectedMonthlyEquivalent,
      },
      categoryIds: [...new Set(recurring.groups.map(group => group.categoryId))].sort(compareIds),
      transactionCount: recurring.groups.reduce(
        (sum, group) => sum + group.occurrenceCount, 0),
      drillDown: { mode: 'none' },
      weight: WEIGHTS.recurringPortfolio,
    });
  }

  // Individually notable recurring items: a price rise, or one that just started.
  const newSince = recurring.newGroupCount > 0;
  const notable = recurring.groups
    .filter(group => group.priceIncreased || (newSince && group.firstSeen >= facts.window.start))
    .sort((a, b) => Number(b.priceIncreased) - Number(a.priceIncreased)
      || b.monthlyEquivalent - a.monthlyEquivalent
      || compareIds(a.key, b.key))
    .slice(0, settings.recurringItemCap);
  for (const group of notable) {
    cards.push(recurringItemCard(group, drillDownIds));
  }

  // Category trends. Exactly expressible as a filter, and the user wants the
  // whole category, so this navigates away to the Transactions page.
  for (const trend of facts.trends.slice(0, settings.trendCap)) {
    const rising = trend.direction === 'rising';
    cards.push({
      id: `categoryTrend:${trend.categoryId}`,
      kind: 'categoryTrend',
      titleKey: rising ? 'insights.trendRisingTitle' : 'insights.trendFallingTitle',
      bodyKey: rising ? 'insights.trendRisingBody' : 'insights.trendFallingBody',
      params: {
        months: facts.window.months.length,
        percent: trend.changeRatio !== null ? Math.abs(percentOf(trend.changeRatio)) : 0,
        share: percentOf(trend.windowShare),
      },
      metrics: {
        firstHalfMean: trend.firstHalfMean,
        secondHalfMean: trend.secondHalfMean,
        meanMonthly: trend.meanMonthly,
        slopePerMonth: trend.slopePerMonth,
        changeRatio: trend.changeRatio,
      },
      categoryIds: [trend.categoryId],
      transactionCount: trend.transactionCount,
      drillDown: filtersDrillDown({ ...windowFilters, categoryId: trend.categoryId }),
      weight: WEIGHTS.categoryTrend
        + Math.min(30, Math.round(Math.abs(trend.relativeSlope ?? 0) * 100)),
      series: [...trend.series],
      seriesMonths: [...facts.window.months],
    });
  }

  // Habit rhythms.
  const { rhythms } = facts;
  if (rhythms.hasEnoughData) {
    const split = rhythms.weekdayWeekend;
    if (split.lean !== 'even' && split.ratio !== null) {
      const weekendLean = split.lean === 'weekend';
      cards.push({
        id: 'habitWeekdayWeekend',
        kind: 'habitWeekdayWeekend',
        titleKey: weekendLean ? 'insights.weekendLeanTitle' : 'insights.weekdayLeanTitle',
        bodyKey: weekendLean ? 'insights.weekendLeanBody' : 'insights.weekdayLeanBody',
        params: {
          percent: percentAboveParity(split.ratio),
          counted: weekendLean ? split.weekendCount : split.weekdayCount,
          total: split.weekdayCount + split.weekendCount,
        },
        metrics: {
          weekdayDailyAverage: split.weekdayDailyAverage,
          weekendDailyAverage: split.weekendDailyAverage,
          ratio: split.ratio,
        },
        categoryIds: [],
        transactionCount: weekendLean ? split.weekendCount : split.weekdayCount,
        // The subset is half the window and there is no day-of-week filter, so
        // this opens the window and the card states the count honestly.
        drillDown: filtersDrillDown(windowFilters),
        weight: WEIGHTS.habit + Math.min(15, percentAboveParity(split.ratio) / 10),
      });
    }

    if (rhythms.monthEnd.isSpike && rhythms.monthEnd.ratio !== null) {
      cards.push({
        id: 'habitMonthEnd',
        kind: 'habitMonthEnd',
        titleKey: 'insights.monthEndTitle',
        bodyKey: 'insights.monthEndBody',
        params: {
          days: rhythms.monthEnd.tailDays,
          percent: percentAboveParity(rhythms.monthEnd.ratio),
          counted: rhythms.monthEnd.tailCount,
        },
        metrics: {
          tailDailyAverage: rhythms.monthEnd.tailDailyAverage,
          restDailyAverage: rhythms.monthEnd.restDailyAverage,
          ratio: rhythms.monthEnd.ratio,
        },
        categoryIds: [],
        transactionCount: rhythms.monthEnd.tailCount,
        drillDown: inlineDrillDown(drillDownIds['habitMonthEnd'], false),
        weight: WEIGHTS.habit + 10,
      });
    }

    if (rhythms.payday.isPresent && rhythms.payday.ratio !== null) {
      cards.push({
        id: 'habitPayday',
        kind: 'habitPayday',
        titleKey: 'insights.paydayTitle',
        bodyKey: 'insights.paydayBody',
        params: {
          days: rhythms.payday.windowDays,
          percent: percentAboveParity(rhythms.payday.ratio),
          counted: rhythms.payday.postPaydayCount,
        },
        metrics: {
          postPaydayDailyAverage: rhythms.payday.postPaydayDailyAverage,
          otherDailyAverage: rhythms.payday.otherDailyAverage,
          ratio: rhythms.payday.ratio,
        },
        categoryIds: [],
        transactionCount: rhythms.payday.postPaydayCount,
        drillDown: inlineDrillDown(drillDownIds['habitPayday'], false),
        weight: WEIGHTS.habit + 12,
      });
    }
  }

  // Small-amount drip. Narrowing by amount is only honest when every window
  // expense already shares the base currency, because the amount filter compares
  // raw native amounts while the threshold is in base currency.
  const { drip } = facts;
  if (drip.isNotable) {
    cards.push({
      id: 'smallDrip',
      kind: 'smallDrip',
      titleKey: 'insights.smallDripTitle',
      bodyKey: 'insights.smallDripBody',
      params: {
        count: drip.count,
        percent: percentOf(drip.shareOfSpending),
        months: facts.window.months.length,
      },
      metrics: {
        threshold: drip.threshold,
        total: drip.total,
        monthlyAverage: drip.monthlyAverage,
        medianAmount: drip.medianAmount,
        shareOfSpending: drip.shareOfSpending,
      },
      categoryIds: drip.byCategory.map(entry => entry.categoryId),
      transactionCount: drip.count,
      drillDown: drip.filterSafe
        ? filtersDrillDown({ ...windowFilters, maxAmount: drip.threshold })
        : inlineDrillDown(drillDownIds['drip'], dripTruncated),
      weight: WEIGHTS.smallDrip + Math.min(20, percentOf(drip.shareOfSpending)),
    });
  }

  return cards.sort(
    (a, b) => b.weight - a.weight || compareIds(a.id, b.id));
}

/**
 * Cards as they are stored on a snapshot.
 *
 * Inline drill-downs become `none`: their id lists are references to individual
 * transactions, which snapshots deliberately do not keep, and those rows may not
 * exist by the time an old snapshot is opened. Filter drill-downs survive
 * unchanged — they are date-bounded expressions that stay meaningful.
 */
export function toStorableCards(cards: InsightCard[]): InsightCard[] {
  return cards.map(card => card.drillDown.mode === 'inline'
    ? { ...card, drillDown: { mode: 'none' as const } }
    : card);
}

/** Weight is presentation, so ordering is recomputed rather than trusted. */
export function sortInsightCards(cards: InsightCard[]): InsightCard[] {
  return [...cards].sort((a, b) => b.weight - a.weight || compareIds(a.id, b.id));
}
