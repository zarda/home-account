import { Goal, GoalItem } from '../../models';

/**
 * Progress math for goals. One rule (ADR 0021): `targetAmount` is
 * authoritative for both kinds; `items` is a checklist whose sum the form
 * can copy into the target, never a second source of truth.
 */

/** Uncapped percentage, like budget percentages; a zero target reads as 0. */
export function goalPercentage(goal: Pick<Goal, 'contributedAmount' | 'targetAmount'>): number {
  if (goal.targetAmount <= 0) return 0;
  return Math.max(0, (goal.contributedAmount / goal.targetAmount) * 100);
}

/** Sum of every item, done or not — what "set target from items" copies. */
export function itemsTotal(items: GoalItem[] | undefined): number {
  return (items ?? []).reduce((total, item) => total + item.amount, 0);
}
