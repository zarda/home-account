import {
  CreateRecurringDTO,
  RecurringFrequency,
  RecurringTransaction,
  StorableRecurringGroup
} from '../../models';
import {
  DEFAULT_RECURRING_OPTIONS,
  RecurringCadence,
  bigramSimilarity,
  normalizeMerchant
} from './recurring-pattern.utils';
import { parseDayKey } from './transaction-date.utils';

/**
 * From a detected recurring group to a rule the user can save.
 *
 * The detector (recurring-pattern.utils.ts) finds groups; RecurringService
 * owns rules. These helpers bridge the two: a cadence maps onto the
 * frequency shape the rules engine validates (ADR 0014), a group prefills
 * the create dialog, and a group already covered by an active rule is
 * suppressed from the detected list — conversion never back-writes
 * `recurringId` onto past transactions, so without suppression the detector
 * would rediscover every converted group forever.
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
    return merchantNamesMatch(groupKey, normalizeMerchant(rule.name));
  });
}

function merchantNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return bigramSimilarity(a, b) >= DEFAULT_RECURRING_OPTIONS.similarityThreshold;
}
