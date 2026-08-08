import { Goal, GoalItem } from '../../models';

/**
 * Progress math for goals. One rule (ADR 0021): `targetAmount` is
 * authoritative for both kinds; `items` is a checklist whose sum the form
 * can copy into the target, never a second source of truth. Since ADR 0027
 * progress has two sources — the manual counter and the linked-transaction
 * counter — and every display reads their sum through goalProgressAmount,
 * never a raw counter.
 */

/**
 * What has been put toward the goal: manual contributions plus linked
 * transactions. `linkedAmount` is absent on documents written before links
 * existed and reads as 0.
 */
export function goalProgressAmount(
  goal: Pick<Goal, 'contributedAmount' | 'linkedAmount'>
): number {
  return goal.contributedAmount + (goal.linkedAmount ?? 0);
}

/** Uncapped percentage, like budget percentages; a zero target reads as 0. */
export function goalPercentage(
  goal: Pick<Goal, 'contributedAmount' | 'linkedAmount' | 'targetAmount'>
): number {
  if (goal.targetAmount <= 0) return 0;
  return Math.max(0, (goalProgressAmount(goal) / goal.targetAmount) * 100);
}

/** Sum of every item, done or not — what "set target from items" copies. */
export function itemsTotal(items: GoalItem[] | undefined): number {
  return (items ?? []).reduce((total, item) => total + item.amount, 0);
}
