import { Timestamp } from '@angular/fire/firestore';
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

/**
 * Bump when the stored document's shape changes.
 *
 * Read separately from the detector version: a reader refuses a document whose
 * schema is newer than it understands, whereas a newer detector version is only
 * a note that a regeneration would produce different numbers.
 */
export const INSIGHT_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Named alias rather than a bare literal, so later states can be added without
 * reshaping documents that are already stored — the same reason
 * SecurityEventType is an alias.
 */
export type InsightSnapshotStatus = 'complete';

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

/**
 * What a snapshot was computed from, so a later recomputation can be compared
 * against it honestly.
 *
 * The time zone and base currency are here for the same reason they are in the
 * facts: either one changes every number in the document without changing a
 * single transaction, so a fingerprint that ignored them would call a snapshot
 * current when its own numbers no longer follow from its own data.
 */
export interface InsightSnapshotFingerprint {
  /** Content hash over (id, last write) of the month's transactions. */
  tx: string;
  count: number;
  /** IANA zone the day-of-week and month-end maths ran in. */
  timeZone: string;
  /** The currency every money field in this document is expressed in. */
  baseCurrency: string;
}

/**
 * One month of frozen insights at `users/{uid}/insightSnapshots/{yyyy-MM}`.
 *
 * Point-in-time records. Regenerating one is an explicit user action that bumps
 * `revision`, so history is never silently amended. Unlike the sign-in log these
 * are not an audit trail — the owner is entitled to delete them, which account
 * deletion needs — so they are immutable in practice (closed field set, full
 * rewrite, strictly increasing revision) rather than immutable by rule.
 *
 * `cards` are stored as computed so a past month renders without re-running any
 * detector, which is what keeps old snapshots readable as the detectors evolve.
 * There is deliberately no narrative field: model prose is not deterministic, and
 * storing it would make "identical when regenerated" impossible to assert.
 */
export interface InsightSnapshot {
  /** Equal to `monthKey`; the Firestore document id. */
  id: string;
  userId: string;
  /** `yyyy-MM`. Sorts lexicographically in chronological order. */
  monthKey: string;
  detectorVersion: number;
  schemaVersion: number;
  status: InsightSnapshotStatus;
  fingerprint: InsightSnapshotFingerprint;
  totals: TypeTotals;
  byCategory: CategoryTotalWithCount[];
  facts: InsightFacts;
  cards: InsightCard[];
  generatedAt: Timestamp;
  /** Written explicitly: FirestoreService.setDocument only stamps updatedAt. */
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  /** 1 on create, strictly increasing on every regeneration. */
  revision: number;
}

export type SnapshotStalenessReason =
  | 'transactionsChanged'
  | 'baseCurrencyChanged'
  | 'timeZoneChanged'
  | 'detectorUpdated';

export interface SnapshotStaleness {
  /**
   * True only for reasons that mean the user's own data moved.
   *
   * A detector-version gap is deliberately excluded. "Your data changed since
   * this snapshot" and "our code changed" are different statements, and lighting
   * up every month in the timeline the first time a threshold is tuned would
   * alarm the user about something they did not do.
   */
  isStale: boolean;
  reasons: SnapshotStalenessReason[];
  /** Null when the current data could not be read. */
  currentFingerprint: string | null;
}
