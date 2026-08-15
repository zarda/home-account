import { Transaction } from '../../models';
import { DetectorWindow } from './spending-pattern.types';
import { addMonths, dateOf, dayKey, wholeDaysBetween } from './transaction-date.utils';
import {
  ToBase,
  compareIds,
  median,
  roundMoney,
} from './transaction-aggregation.utils';

/**
 * Recurring-spend detection: the subscription-creep insight.
 *
 * Two populations are handled separately and never merged:
 *
 * - **declared** — occurrences carrying a `recurringId`, which only
 *   RecurringService sets when it materialises a rule the user configured. The
 *   user already told us these recur, so no clustering or similarity test is
 *   applied; the detector only *measures* the cadence from the actual dates, so
 *   the figure stays honest if occurrences were edited.
 * - **detected** — everything else, clustered by merchant similarity.
 *
 * Keeping them apart stops a single *transaction* being counted twice: clustering
 * declared occurrences would "discover" what the user already configured.
 * `isRecurring` is deliberately *not* the discriminator — it is a plain boolean a
 * user can tick on a one-off, so it only contributes `userFlaggedCount`.
 *
 * Separating the populations is necessary but not sufficient, which is what
 * `isCovered` is for. Converting a detected group into a rule never relabels the
 * history behind it, so those charges keep clustering as a detected group while
 * the new rule builds a declared one — one subscription, two groups. The caller
 * passes a predicate saying which detected groups a rule already accounts for,
 * and it is applied before any figure is taken.
 *
 * Determinism: no clock reads, a total-order sort before the greedy clustering
 * pass, and every money figure rounded at the boundary.
 */

export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringSource = 'declared' | 'detected';

/** Average days per month over a 400-year Gregorian cycle. */
const DAYS_PER_MONTH = 30.436875;

interface CadenceRange {
  cadence: RecurringCadence;
  minDays: number;
  maxDays: number;
  /** Occurrences per calendar month, used for the monthly equivalent. */
  perMonth: number;
}

/**
 * Accepted interval bands. A median gap outside every band means the charges
 * are not on a schedule, and the cluster is discarded rather than guessed at.
 */
const CADENCE_RANGES: readonly CadenceRange[] = [
  { cadence: 'weekly', minDays: 6, maxDays: 8, perMonth: DAYS_PER_MONTH / 7 },
  { cadence: 'biweekly', minDays: 13, maxDays: 16, perMonth: DAYS_PER_MONTH / 14 },
  { cadence: 'monthly', minDays: 26, maxDays: 35, perMonth: 1 },
  { cadence: 'quarterly', minDays: 85, maxDays: 96, perMonth: 1 / 3 },
  { cadence: 'yearly', minDays: 350, maxDays: 380, perMonth: 1 / 12 },
];

export interface RecurringGroup {
  /** `rec:{source}:{categoryId}:{slug}` — stable across runs over identical data. */
  key: string;
  source: RecurringSource;
  categoryId: string;
  /** Most recent member's raw description. Display only, never a grouping input. */
  label: string;
  cadence: RecurringCadence;
  medianIntervalDays: number;
  occurrenceCount: number;
  /** Median per-occurrence amount in base currency. */
  medianAmount: number;
  /** `medianAmount` normalised to one calendar month. */
  monthlyEquivalent: number;
  /** `yyyy-MM-dd`. A string rather than a Date so the shape is storable as-is. */
  firstSeen: string;
  lastSeen: string;
  /** Recent-half median exceeds the earlier-half median beyond the threshold. */
  priceIncreased: boolean;
  /** Members the user ticked as recurring without a rule behind them. */
  userFlaggedCount: number;
  /** Oldest first. Drill-down source; dropped before a snapshot is written. */
  transactionIds: string[];
}

export interface RecurringSummary {
  /** Capped display list, largest monthly equivalent first. */
  groups: RecurringGroup[];
  /** Every group found, including those beyond the cap. */
  groupCount: number;
  declaredGroupCount: number;
  detectedGroupCount: number;
  /** Portfolio totals over ALL groups, not just the capped list. */
  totalMonthlyEquivalent: number;
  declaredMonthlyEquivalent: number;
  detectedMonthlyEquivalent: number;
  /** Groups first seen inside the last `newWithinMonths` of the window. */
  newGroupCount: number;
  increasedGroupCount: number;
}

export interface RecurringOptions {
  /** Occurrences needed to accept a *detected* cluster. */
  minOccurrences: number;
  /**
   * Occurrences needed to accept a *declared* group. Lower, because the user
   * already asserted the recurrence — we only need enough dates to measure one
   * interval.
   */
  minDeclaredOccurrences: number;
  /** Sørensen-Dice over character bigrams, 0..1. */
  similarityThreshold: number;
  /** Fraction of the cluster median an amount may deviate by. */
  amountTolerance: number;
  /** Absolute floor for the amount band, for very small recurring charges. */
  minAmountTolerance: number;
  /** Fraction of gaps that must sit near the median for a schedule to hold. */
  regularityRatio: number;
  /** Relative gap tolerance when testing regularity. */
  gapTolerance: number;
  /** Absolute floor, in days, for the gap tolerance. */
  minGapToleranceDays: number;
  newWithinMonths: number;
  priceIncreaseThreshold: number;
  cap: number;
}

/**
 * Says whether an active rule already accounts for a detected group.
 *
 * Injected rather than computed here: coverage is a rules concept and lives in
 * `recurring-conversion.utils.ts`, which already imports this module for the
 * thresholds it matches merchants at. Importing it back would close the cycle.
 */
export type CoveragePredicate = (group: RecurringGroup) => boolean;

export const DEFAULT_RECURRING_OPTIONS: RecurringOptions = {
  minOccurrences: 3,
  minDeclaredOccurrences: 2,
  similarityThreshold: 0.7,
  amountTolerance: 0.15,
  minAmountTolerance: 1,
  regularityRatio: 0.7,
  gapTolerance: 0.25,
  minGapToleranceDays: 3,
  newWithinMonths: 2,
  priceIncreaseThreshold: 0.05,
  cap: 12,
};

/**
 * Merchant key for clustering. Keeps every letter and digit in any script.
 *
 * Deliberately not the `[^a-z0-9]` strip used by the duplicate-detection
 * service, which erases CJK descriptions entirely and would collapse every
 * Japanese merchant into the same empty key.
 *
 * A trailing standalone digit run is dropped so per-visit store or order
 * numbers do not split one merchant into many clusters.
 */
export function normalizeMerchant(description: string): string {
  const cleaned = description
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return cleaned.replace(/\s+\d+$/, '').trim();
}

/**
 * Sørensen-Dice coefficient over character bigrams, 0..1, symmetric.
 *
 * Character bigrams rather than word tokens because CJK text has no whitespace
 * to tokenise on, and length-normalised so a long description cannot dominate
 * a short one.
 */
export function bigramSimilarity(a: string, b: string): number {
  if (a === b) {
    return a.length > 0 ? 1 : 0;
  }
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  if (charsA.length < 2 || charsB.length < 2) {
    return 0;
  }

  const countBigrams = (chars: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < chars.length - 1; i += 1) {
      const gram = chars[i] + chars[i + 1];
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };

  const bigramsA = countBigrams(charsA);
  const bigramsB = countBigrams(charsB);
  let shared = 0;
  for (const [gram, count] of bigramsA) {
    const other = bigramsB.get(gram);
    if (other) {
      shared += Math.min(count, other);
    }
  }

  return (2 * shared) / (charsA.length - 1 + charsB.length - 1);
}

interface Candidate {
  transaction: Transaction;
  normalized: string;
  date: Date;
  value: number;
}

interface Cluster {
  representative: string;
  members: Candidate[];
}

/** Two merchant keys describe the same payee. */
function merchantsMatch(a: string, b: string, threshold: number): boolean {
  if (a === b) {
    return true;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return true;
  }
  return bigramSimilarity(a, b) >= threshold;
}

function classifyCadence(medianGap: number): CadenceRange | null {
  return CADENCE_RANGES.find(
    range => medianGap >= range.minDays && medianGap <= range.maxDays) ?? null;
}

/**
 * Median of the recent half against the earlier half. Split by index rather
 * than by date so an uneven distribution across the window cannot leave one
 * side empty.
 */
function detectPriceIncrease(values: number[], threshold: number): boolean {
  if (values.length < 4) {
    return false;
  }
  const middle = Math.floor(values.length / 2);
  const earlier = median(values.slice(0, middle));
  const recent = median(values.slice(middle));
  return earlier > 0 && recent > earlier * (1 + threshold);
}

/**
 * Build a group from a coherent set of occurrences, or null when the set is not
 * on a recognisable schedule.
 */
function buildGroup(
  members: Candidate[],
  source: RecurringSource,
  slug: string,
  options: RecurringOptions,
): RecurringGroup | null {
  const ordered = [...members].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
      || compareIds(a.transaction.id, b.transaction.id));

  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    gaps.push(wholeDaysBetween(ordered[i - 1].date, ordered[i].date));
  }
  if (gaps.length === 0) {
    return null;
  }

  const medianGap = median(gaps);
  const range = classifyCadence(medianGap);
  if (!range) {
    return null;
  }

  // Regularity: a handful of charges that merely average out to a monthly gap
  // is not a subscription, so most gaps have to sit near the median.
  const tolerance = Math.max(
    options.gapTolerance * medianGap, options.minGapToleranceDays);
  const regular = gaps.filter(gap => Math.abs(gap - medianGap) <= tolerance).length;
  if (regular / gaps.length < options.regularityRatio) {
    return null;
  }

  const values = ordered.map(member => member.value);
  const medianAmount = roundMoney(median(values));

  return {
    key: `rec:${source}:${ordered[0].transaction.categoryId}:${slug}`,
    source,
    categoryId: ordered[0].transaction.categoryId,
    label: ordered[ordered.length - 1].transaction.description,
    cadence: range.cadence,
    medianIntervalDays: medianGap,
    occurrenceCount: ordered.length,
    medianAmount,
    monthlyEquivalent: roundMoney(medianAmount * range.perMonth),
    firstSeen: dayKey(ordered[0].date),
    lastSeen: dayKey(ordered[ordered.length - 1].date),
    priceIncreased: detectPriceIncrease(values, options.priceIncreaseThreshold),
    userFlaggedCount: ordered.filter(
      member => member.transaction.isRecurring && !member.transaction.recurringId).length,
    transactionIds: ordered.map(member => member.transaction.id),
  };
}

/**
 * Group a window's expenses into recurring payments.
 *
 * Known limitation, accepted rather than worked around: a six-month window
 * cannot see a yearly cadence and only just reaches quarterly with two
 * occurrences. User-declared rules cover the long cadences, and widening the
 * window would double the read cost of opening the tab for a rare finding.
 *
 * `isCovered` drops detected groups an active rule already accounts for. It
 * defaults to covering nothing, so a caller with no rules to hand — a spec, or a
 * snapshot regenerated from stored facts — gets the raw populations.
 */
export function computeRecurringGroups(
  expenses: Transaction[],
  toBase: ToBase,
  window: DetectorWindow,
  options: Partial<RecurringOptions> = {},
  isCovered: CoveragePredicate = () => false,
): RecurringSummary {
  const settings = { ...DEFAULT_RECURRING_OPTIONS, ...options };

  const inWindow = expenses
    .filter(transaction => transaction.type === 'expense')
    .map(transaction => ({
      transaction,
      normalized: normalizeMerchant(transaction.description ?? ''),
      date: dateOf(transaction),
      value: toBase(transaction),
    }))
    .filter(candidate => candidate.date >= window.start && candidate.date <= window.end);

  const groups: RecurringGroup[] = [];

  // Declared: grouped by the rule that produced them. No similarity test, and
  // no amount band either — occurrences of one rule belong together even if the
  // user edited an amount.
  const byRule = new Map<string, Candidate[]>();
  for (const candidate of inWindow) {
    const ruleId = candidate.transaction.recurringId;
    if (!ruleId) {
      continue;
    }
    byRule.set(ruleId, [...(byRule.get(ruleId) ?? []), candidate]);
  }
  for (const ruleId of [...byRule.keys()].sort(compareIds)) {
    const members = byRule.get(ruleId)!;
    if (members.length < settings.minDeclaredOccurrences) {
      continue;
    }
    const group = buildGroup(members, 'declared', ruleId, settings);
    if (group) {
      groups.push(group);
    }
  }

  // Detected: cluster the rest by merchant within a category. Category is a
  // cheap, hard blocking key — a subscription does not change category.
  const byCategory = new Map<string, Candidate[]>();
  for (const candidate of inWindow) {
    if (candidate.transaction.recurringId || candidate.normalized.length === 0) {
      continue;
    }
    const { categoryId } = candidate.transaction;
    byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), candidate]);
  }

  for (const categoryId of [...byCategory.keys()].sort(compareIds)) {
    // The sort is load-bearing, not cosmetic: it puts the candidates in a total
    // order, which is what makes the single greedy pass below deterministic.
    const candidates = [...byCategory.get(categoryId)!].sort(
      (a, b) => compareIds(a.normalized, b.normalized)
        || a.date.getTime() - b.date.getTime()
        || compareIds(a.transaction.id, b.transaction.id));

    const clusters: Cluster[] = [];
    for (const candidate of candidates) {
      const existing = clusters.find(
        cluster => merchantsMatch(
          cluster.representative, candidate.normalized, settings.similarityThreshold));
      if (existing) {
        existing.members.push(candidate);
      } else {
        clusters.push({ representative: candidate.normalized, members: [candidate] });
      }
    }

    for (const cluster of clusters) {
      // Amount coherence: subscriptions hold a stable price, and the band is
      // wide enough to tolerate a rise without splitting the group.
      const clusterMedian = median(cluster.members.map(member => member.value));
      const band = Math.max(
        settings.amountTolerance * clusterMedian, settings.minAmountTolerance);
      const coherent = cluster.members.filter(
        member => Math.abs(member.value - clusterMedian) <= band);

      if (coherent.length < settings.minOccurrences) {
        continue;
      }
      const group = buildGroup(coherent, 'detected', cluster.representative, settings);
      if (group) {
        groups.push(group);
      }
    }
  }

  // Coverage is applied here — before ranking, before the cap, and before every
  // count and total — so the portfolio figures describe exactly the rows the
  // list renders. Filtering further downstream is what let one subscription be
  // counted twice: once as its rule's declared occurrences, once as the
  // unlabelled history the conversion left behind.
  //
  // Declared groups are never covered. `isGroupCovered` matches on cadence and
  // merchant name, which a rule matches against its own occurrences, so passing
  // one here would suppress the very group it created.
  const kept = groups.filter(
    group => group.source !== 'detected' || !isCovered(group));

  const declared = kept.filter(group => group.source === 'declared');
  const detected = kept.filter(group => group.source === 'detected');
  const newSince = dayKey(addMonths(window.end, -settings.newWithinMonths));
  const sumMonthly = (list: RecurringGroup[]): number =>
    roundMoney(list.reduce((total, group) => total + group.monthlyEquivalent, 0));

  const ranked = [...kept].sort(
    (a, b) => b.monthlyEquivalent - a.monthlyEquivalent
      || compareIds(a.categoryId, b.categoryId)
      || compareIds(a.key, b.key));

  return {
    groups: ranked.slice(0, settings.cap),
    groupCount: kept.length,
    declaredGroupCount: declared.length,
    detectedGroupCount: detected.length,
    totalMonthlyEquivalent: sumMonthly(kept),
    declaredMonthlyEquivalent: sumMonthly(declared),
    detectedMonthlyEquivalent: sumMonthly(detected),
    newGroupCount: kept.filter(group => group.firstSeen >= newSince).length,
    increasedGroupCount: kept.filter(group => group.priceIncreased).length,
  };
}
