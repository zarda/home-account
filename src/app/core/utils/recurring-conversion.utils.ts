import {
  CreateRecurringDTO,
  RecurringFrequency,
  RecurringTransaction,
  StorableRecurringGroup
} from '../../models';
import {
  DEFAULT_RECURRING_OPTIONS,
  RecurringCadence,
  normalizeMerchant
} from './recurring-pattern.utils';
import { merchantKeysMatch } from './merchant-match.utils';
import { compareIds, fnv1a32 } from './transaction-aggregation.utils';
import { parseDayKey } from './transaction-date.utils';

/**
 * From a detected recurring group to a rule the user can save.
 *
 * The detector (recurring-pattern.utils.ts) finds groups; RecurringService
 * owns rules. These helpers bridge the two: a cadence maps onto the
 * frequency shape the rules engine validates (ADR 0014), a group prefills
 * the create dialog, and a group already covered by an active rule is
 * dropped by the detector — conversion never back-writes `recurringId` onto
 * past transactions, so without suppression the detector would rediscover
 * every converted group forever.
 *
 * Suppression is applied inside `computeRecurringGroups`, not at the list, so
 * the portfolio figures and the rows beneath them count the same set (ADR 0042).
 * `recurringCoverageFingerprint` is what lets the cache in front of that
 * computation notice a rule change.
 */

/** What the recurring form dialog accepts as initial values. */
export type RecurringPrefill = Omit<CreateRecurringDTO, 'endDate'>;

/**
 * The rules engine has no biweekly or quarterly type; both express as
 * intervals of the types it has. The anchor supplies the day fields —
 * a month-end day is kept as-is, the engine's clamp resolves short months.
 */
export function frequencyFromCadence(
  cadence: RecurringCadence,
  anchor: Date
): RecurringFrequency {
  switch (cadence) {
    case 'weekly':
      return { type: 'weekly', interval: 1, dayOfWeek: anchor.getDay() };
    case 'biweekly':
      return { type: 'weekly', interval: 2, dayOfWeek: anchor.getDay() };
    case 'monthly':
      return { type: 'monthly', interval: 1, dayOfMonth: anchor.getDate() };
    case 'quarterly':
      return { type: 'monthly', interval: 3, dayOfMonth: anchor.getDate() };
    case 'yearly':
      return {
        type: 'yearly',
        interval: 1,
        dayOfMonth: anchor.getDate(),
        monthOfYear: anchor.getMonth() + 1
      };
  }
}

/**
 * Initial dialog values from a detected group. Anchored on the last observed
 * charge: the catch-up engine advances `nextOccurrence` from the start date
 * (ADR 0014), so an anchor in the recent past yields the next real charge
 * date rather than a run of back-dated postings.
 *
 * The amount is the group's median, which the detector computes in the base
 * currency — hence the rule is prefilled in base. A charge that really bills
 * in a foreign currency can be corrected in the dialog before saving.
 */
export function prefillFromGroup(
  group: StorableRecurringGroup,
  baseCurrency: string
): RecurringPrefill {
  // The detector always writes a valid day key; today is only a defensive
  // fallback and still yields a sensible dialog.
  const anchor = parseDayKey(group.lastSeen) ?? new Date();
  return {
    name: group.label,
    // The detector clusters expenses only.
    type: 'expense',
    amount: group.medianAmount,
    currency: baseCurrency,
    categoryId: group.categoryId,
    description: '',
    frequency: frequencyFromCadence(group.cadence, anchor),
    startDate: anchor
  };
}

/** interval expressed in the rules engine's terms, per cadence. */
const CADENCE_EQUIVALENTS: Record<RecurringCadence, { type: string; interval: number }> = {
  weekly: { type: 'weekly', interval: 1 },
  biweekly: { type: 'weekly', interval: 2 },
  monthly: { type: 'monthly', interval: 1 },
  quarterly: { type: 'monthly', interval: 3 },
  yearly: { type: 'yearly', interval: 1 }
};

/**
 * True when an active rule already accounts for this detected group: same
 * cadence in the engine's terms, and a name that matches the way the
 * detector matches merchants — normalized equality, containment for keys of
 * three characters or more, then bigram similarity at the detector's own
 * threshold.
 */
export function isGroupCovered(
  group: StorableRecurringGroup,
  rules: RecurringTransaction[]
): boolean {
  const equivalent = CADENCE_EQUIVALENTS[group.cadence];
  const groupKey = normalizeMerchant(group.label);

  return rules.some(rule => {
    if (!rule.isActive) return false;
    if (rule.frequency.type !== equivalent.type) return false;
    if (rule.frequency.interval !== equivalent.interval) return false;
    return merchantKeysMatch(groupKey, normalizeMerchant(rule.name));
  });
}

/**
 * Content fingerprint of a rule set, over exactly the fields coverage reads.
 *
 * `InsightsService` caches its computation by content and has no TTL, so every
 * input to that computation has to be in the key or a stale answer is served
 * forever. Deliberately not the whole rule: `nextOccurrence` advances every time
 * the engine posts a catch-up occurrence, and folding it in would evict the
 * cached facts daily for a change that cannot move a single figure.
 *
 * Change this and `isGroupCovered` together. A field one reads and the other
 * ignores is a coverage decision the cache cannot see changing.
 */
export function recurringCoverageFingerprint(rules: RecurringTransaction[]): string {
  const parts = rules
    .filter(rule => rule.isActive)
    .map(rule =>
      `${normalizeMerchant(rule.name)}:${rule.frequency.type}:${rule.frequency.interval}`)
    .sort(compareIds);
  return `${fnv1a32(parts.join(';'))}:${parts.length}`;
}

/** What an import row offers the matcher: the merchant a reader named, else the description. */
export interface RecurringMatchCandidate {
  description: string;
  merchant?: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  /** True when `currency` is the account's base standing in for one nobody read; the printed figure is then compared as-is. */
  currencyFellBack?: boolean;
}

/**
 * The active rule an import row looks like, or null.
 *
 * The name goes through the same ladder `isGroupCovered` uses, so the answer
 * agrees with the insights surface. A single row has no cadence to check, so
 * the amount stands in for it — within the detector's own tolerance of the
 * rule's amount when the currencies agree, unchecked when they differ, since
 * a figure in another currency is not comparable without a rate. A row whose
 * currency fell back is the exception: nobody read a currency for it, so the
 * printed figure is the only evidence it carries and it is compared as-is
 * whatever currency the rule is in. The type must agree. The first match
 * wins; the link is offered unchecked, so a wrong candidate costs a glance,
 * not a write. (#320)
 */
export function matchRecurringRule(
  row: RecurringMatchCandidate,
  rules: readonly RecurringTransaction[]
): RecurringTransaction | null {
  const key = normalizeMerchant(row.merchant || row.description);
  if (!key) return null;
  return (
    rules.find(rule => {
      const comparable = rule.currency === row.currency || row.currencyFellBack === true;
      return (
        rule.isActive &&
        rule.type === row.type &&
        merchantKeysMatch(key, normalizeMerchant(rule.name)) &&
        (!comparable || amountsAgree(row.amount, rule.amount))
      );
    }) ?? null
  );
}

function amountsAgree(a: number, b: number): boolean {
  const { amountTolerance, minAmountTolerance } = DEFAULT_RECURRING_OPTIONS;
  const tolerance = Math.max(minAmountTolerance, amountTolerance * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tolerance;
}
