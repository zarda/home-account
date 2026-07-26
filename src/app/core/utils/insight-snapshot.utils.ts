import {
  INSIGHT_DETECTOR_VERSION,
  INSIGHT_SNAPSHOT_SCHEMA_VERSION,
  InsightSnapshot,
  SnapshotStaleness,
  SnapshotStalenessReason,
} from '../../models';
import { compareIds, percentDelta, roundMoney } from './transaction-aggregation.utils';

/**
 * Reading, comparing and staleness-checking stored insight snapshots.
 *
 * Pure functions so the reason matrix and the month-over-month comparison are
 * testable without Firestore, and so the same logic serves both the timeline and
 * the narrative diff.
 */

/** What the current month's data looks like right now, for comparison. */
export interface CurrentSnapshotInputs {
  tx: string;
  count: number;
  timeZone: string;
  baseCurrency: string;
}

/**
 * Accept a stored document, or refuse it.
 *
 * A schema newer than this build understands is refused rather than
 * half-rendered: the fields it relies on may not mean what they used to. A newer
 * *detector* version is fine, because cards are stored as computed.
 */
export function readSnapshot(raw: InsightSnapshot | null | undefined): InsightSnapshot | null {
  if (!raw) {
    return null;
  }
  if (typeof raw.schemaVersion !== 'number'
    || raw.schemaVersion > INSIGHT_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }
  return raw;
}

/** True when the document came from a build newer than this one. */
export function isFromNewerApp(raw: InsightSnapshot | null | undefined): boolean {
  return !!raw
    && typeof raw.schemaVersion === 'number'
    && raw.schemaVersion > INSIGHT_SNAPSHOT_SCHEMA_VERSION;
}

/**
 * Why a snapshot no longer matches its own month.
 *
 * `current` is null when the month's transactions could not be read — offline
 * with a cold cache, say — in which case nothing is claimed rather than
 * guessing that the data changed.
 */
export function compareSnapshotFingerprint(
  snapshot: InsightSnapshot,
  current: CurrentSnapshotInputs | null,
  currentDetectorVersion = INSIGHT_DETECTOR_VERSION,
): SnapshotStaleness {
  const reasons: SnapshotStalenessReason[] = [];

  if (snapshot.detectorVersion !== currentDetectorVersion) {
    reasons.push('detectorUpdated');
  }

  if (!current) {
    return {
      isStale: false,
      reasons,
      currentFingerprint: null,
    };
  }

  if (snapshot.fingerprint.tx !== current.tx || snapshot.fingerprint.count !== current.count) {
    reasons.push('transactionsChanged');
  }
  if (snapshot.fingerprint.baseCurrency !== current.baseCurrency) {
    reasons.push('baseCurrencyChanged');
  }
  if (snapshot.fingerprint.timeZone !== current.timeZone) {
    reasons.push('timeZoneChanged');
  }

  // Only the user's own data moving counts as stale; a code change does not.
  const dataChanged: SnapshotStalenessReason[] = [
    'transactionsChanged', 'baseCurrencyChanged', 'timeZoneChanged',
  ];
  return {
    isStale: reasons.some(reason => dataChanged.includes(reason)),
    reasons,
    currentFingerprint: current.tx,
  };
}

export interface SnapshotCategoryChange {
  categoryId: string;
  previous: number;
  current: number;
  change: number;
  changeRatio: number | null;
  /** True when the move is too small to be worth reporting as a change. */
  unchanged: boolean;
}

export interface SnapshotComparison {
  fromMonth: string;
  toMonth: string;
  baseCurrency: string;
  expenseChange: number;
  expenseChangeRatio: number | null;
  incomeChange: number;
  incomeChangeRatio: number | null;
  recurringMonthlyChange: number;
  recurringGroupChange: number;
  categories: SnapshotCategoryChange[];
}

export interface SnapshotComparisonRefusal {
  reason: 'baseCurrencyMismatch' | 'sameMonth';
}

export interface SnapshotComparisonOptions {
  /** Relative move below which a category counts as unchanged. */
  unchangedThreshold: number;
  categoryCap: number;
}

export const DEFAULT_SNAPSHOT_COMPARISON_OPTIONS: SnapshotComparisonOptions = {
  unchangedThreshold: 0.02,
  categoryCap: 10,
};

/**
 * Compare two months, oldest first.
 *
 * Refuses when the two were computed against different base currencies. Their
 * money fields are in different units, so subtracting them would produce a
 * confident number that means nothing — and there is no honest way to convert,
 * because the historical rates that produced each figure are not stored.
 */
export function compareSnapshots(
  from: InsightSnapshot,
  to: InsightSnapshot,
  options: Partial<SnapshotComparisonOptions> = {},
): SnapshotComparison | SnapshotComparisonRefusal {
  if (from.fingerprint.baseCurrency !== to.fingerprint.baseCurrency) {
    return { reason: 'baseCurrencyMismatch' };
  }
  if (from.monthKey === to.monthKey) {
    return { reason: 'sameMonth' };
  }

  const settings = { ...DEFAULT_SNAPSHOT_COMPARISON_OPTIONS, ...options };
  const previousByCategory = new Map(
    from.byCategory.map(entry => [entry.categoryId, entry.total]));
  const currentByCategory = new Map(
    to.byCategory.map(entry => [entry.categoryId, entry.total]));

  const categoryIds = [...new Set([...previousByCategory.keys(), ...currentByCategory.keys()])];
  const categories: SnapshotCategoryChange[] = categoryIds
    .map(categoryId => {
      const previous = previousByCategory.get(categoryId) ?? 0;
      const current = currentByCategory.get(categoryId) ?? 0;
      const changeRatio = percentDelta(current, previous);
      return {
        categoryId,
        previous,
        current,
        change: roundMoney(current - previous),
        changeRatio,
        // Reported rather than dropped, so "subscriptions unchanged" can be
        // said out loud instead of being an absence the user has to notice.
        unchanged: changeRatio !== null
          && Math.abs(changeRatio) < settings.unchangedThreshold,
      };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)
      || compareIds(a.categoryId, b.categoryId))
    .slice(0, settings.categoryCap);

  return {
    fromMonth: from.monthKey,
    toMonth: to.monthKey,
    baseCurrency: to.fingerprint.baseCurrency,
    expenseChange: roundMoney(to.totals.expense - from.totals.expense),
    expenseChangeRatio: percentDelta(to.totals.expense, from.totals.expense),
    incomeChange: roundMoney(to.totals.income - from.totals.income),
    incomeChangeRatio: percentDelta(to.totals.income, from.totals.income),
    recurringMonthlyChange: roundMoney(
      to.facts.recurring.totalMonthlyEquivalent
      - from.facts.recurring.totalMonthlyEquivalent),
    recurringGroupChange: to.facts.recurring.groupCount - from.facts.recurring.groupCount,
    categories,
  };
}

/** Narrow a comparison result to the success case. */
export function isComparison(
  result: SnapshotComparison | SnapshotComparisonRefusal,
): result is SnapshotComparison {
  return !('reason' in result);
}

/** Snapshots newest first, by month key. */
export function sortSnapshotsDescending(snapshots: InsightSnapshot[]): InsightSnapshot[] {
  return [...snapshots].sort((a, b) => compareIds(b.monthKey, a.monthKey));
}
