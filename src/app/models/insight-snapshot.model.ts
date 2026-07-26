import type { CategoryTrend } from '../core/utils/category-trend.utils';
import type { HabitRhythms, MonthEndSpike, PaydayEffect } from '../core/utils/habit-rhythm.utils';
import type { RecurringGroup, RecurringSummary } from '../core/utils/recurring-pattern.utils';
import type { SmallAmountDrip } from '../core/utils/small-drip.utils';
import type { CategoryTotalWithCount, TypeTotals } from '../core/utils/transaction-aggregation.utils';

/**
 * The spending-insight card contract and the fact bundle behind it.
 *
 * Everything here is written verbatim into a `users/{uid}/insightSnapshots`
 * document, so the shapes are constrained by Firestore rather than by taste. The
 * detector types are imported type-only, which keeps the runtime module graph
 * one-directional even though the detectors themselves import `Transaction`
 * from this barrel.
 *
 * Bump when any detector's output for identical input can differ. Old snapshots
 * keep their own stamp and stay renderable; the version only tells a reader that
 * a regeneration would produce different numbers.
 */
export const INSIGHT_DETECTOR_VERSION = 1;

export type InsightKind =
  | 'recurringPortfolio'
  | 'recurringItem'
  | 'categoryTrend'
  | 'habitWeekdayWeekend'
  | 'habitMonthEnd'
  | 'habitPayday'
  | 'smallDrip';

/**
 * `TransactionFilters` with dates as ISO strings, so a drill-down survives a
 * Firestore round trip. A written `Date` returns as a `Timestamp`, which would
 * silently change the field's type between a live card and a stored one.
 */
export interface SerializableFilters {
  type?: 'income' | 'expense';
  categoryId?: string;
  /** ISO 8601. */
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
}

/**
 * How a card exposes the transactions behind it.
 *
 * `filters` navigates to the Transactions page with a filter set that genuinely
 * selects the subset. `inline` lists specific ids in place, for subsets no
 * filter expression can reach — a fuzzy merchant cluster's members have
 * different descriptions by construction, and there is no id-list filter. The
 * distinction is a trust matter: a card claiming "based on 47 transactions" that
 * opens a list of 180 discredits every other card on the screen.
 */
export type InsightDrillDown =
  | { mode: 'filters'; filters: SerializableFilters }
  | { mode: 'inline'; transactionIds: string[]; truncated: boolean }
  | { mode: 'none' };

export interface InsightCard {
  /** `{kind}:{discriminator}` — stable across runs over identical data. */
  id: string;
  kind: InsightKind;
  /** Literal i18n key. Once stored, a key may be deprecated but never deleted. */
  titleKey: string;
  bodyKey: string;
  /**
   * Interpolation values for `bodyKey`: counts and whole percentages only.
   *
   * Never a category name and never a formatted amount. Both would freeze a
   * locale — and in the case of money, a base currency — into a document that
   * may be read years later. The renderer injects `category` from `categoryIds`
   * and reads money out of `metrics`.
   */
  params: Record<string, string | number>;
  /** Every money figure and ratio, raw. Rendered by the template, not the string. */
  metrics: Record<string, number | null>;
  /** Category ids, never names: names are locale-dependent and user-editable. */
  categoryIds: string[];
  /** Transactions the finding itself rests on, not the size of the window. */
  transactionCount: number;
  drillDown: InsightDrillDown;
  /** Deterministic ordering key, descending. */
  weight: number;
  /** Optional sparkline. Omitted entirely when absent — never set to undefined. */
  series?: number[];
  seriesMonths?: string[];
}

/**
 * Detector outputs with the drill-down id lists removed.
 *
 * Snapshots hold aggregates and detector outputs, never references to
 * individual transactions. The live tab keeps the ids alongside the facts; only
 * the stripped form is persisted.
 */
export type StorableRecurringGroup = Omit<RecurringGroup, 'transactionIds'>;

export interface StorableRecurringSummary extends Omit<RecurringSummary, 'groups'> {
  groups: StorableRecurringGroup[];
}

export type StorableMonthEndSpike = Omit<MonthEndSpike, 'transactionIds'>;
export type StorablePaydayEffect = Omit<PaydayEffect, 'transactionIds'>;

export interface StorableHabitRhythms extends Omit<HabitRhythms, 'monthEnd' | 'payday'> {
  monthEnd: StorableMonthEndSpike;
  payday: StorablePaydayEffect;
}

export type StorableSmallAmountDrip = Omit<SmallAmountDrip, 'transactionIds' | 'truncated'>;

/** The window a fact bundle was computed over, as `yyyy-MM-dd` / `yyyy-MM`. */
export interface InsightFactsWindow {
  start: string;
  end: string;
  /** Complete calendar months used for the trend series, oldest first. */
  months: string[];
}

/**
 * Everything the detectors found, in a form that can be written as-is.
 *
 * `baseCurrency` and `timeZone` are recorded because every money figure is
 * expressed in the former and every day-of-week and day-of-month result depends
 * on the latter. A snapshot without them could not be honestly compared against
 * a later recomputation.
 */
export interface InsightFacts {
  detectorVersion: number;
  window: InsightFactsWindow;
  baseCurrency: string;
  timeZone: string;
  totals: TypeTotals;
  byCategory: CategoryTotalWithCount[];
  recurring: StorableRecurringSummary;
  trends: CategoryTrend[];
  rhythms: StorableHabitRhythms;
  drip: StorableSmallAmountDrip;
}
