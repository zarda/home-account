import { Timestamp } from '@angular/fire/firestore';
import { BudgetPeriod } from './budget.model';

/**
 * households/{householdId}/budgets/{budgetId}: a budget the household keeps
 * for itself, made and edited by any live member. It counts only rows its
 * members share into the household, as their copies, and never a member's
 * personal budget or private row.
 *
 * Nothing it spends is stored: the page folds the spending from the shared
 * copies each time it reads the budget, so no stored figure can fall behind.
 */
export interface HouseholdBudget {
  /** The document id; never a stored field. */
  id: string;
  /**
   * The household's `createdAt` when the budget was made. Members read only
   * plans of the live generation, so a household formed again under the
   * same id shows none of the dissolved one's.
   */
  gen: Timestamp;
  /** HOUSEHOLD_PLAN_NAME_LENGTH characters. */
  name: string;
  /**
   * The built-in category ids the budget counts, 1 to
   * HOUSEHOLD_PLAN_CATEGORY_MAX of them, each of
   * HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH characters. A copy counts when its `bucket` or
   * `bucketGroup` is one of them, so a group id takes in every subcategory
   * and a member's custom category counts under its built-in ancestor.
   */
  categoryIds: string[];
  /** The limit, in `currency`. */
  amount: number;
  /**
   * Chosen when the budget is made (the maker's base currency unless they
   * pick another) and never changed; the household has no currency of its
   * own. Copies in another currency count at today's rate.
   */
  currency: string;
  period: BudgetPeriod;
  startDate: Timestamp;
  endDate?: Timestamp;
  /** The percentage of `amount` at which the budget warns. */
  alertThreshold?: number;
  isActive: boolean;
  /** The member who made it, fixed; it may delete the budget while a member. */
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * households/{householdId}/goals/{goalId}: a goal the household keeps for
 * itself, made and edited by any live member. Its progress is the shared
 * copies its members link to it plus the contributions they record on it,
 * read from those each time the page shows the goal, never stored here.
 */
export interface HouseholdGoal {
  /** The document id; never a stored field. */
  id: string;
  /** The household's `createdAt` when the goal was made (see HouseholdBudget.gen). */
  gen: Timestamp;
  /** HOUSEHOLD_PLAN_NAME_LENGTH characters. */
  name: string;
  /** In `currency`. */
  targetAmount: number;
  /**
   * Chosen when the goal is made (the maker's base currency unless they pick
   * another) and never changed. Contributions are entered in it; linked
   * copies in another currency count at today's rate.
   */
  currency: string;
  targetDate?: Timestamp;
  isActive: boolean;
  /** The member who made it, fixed; it may delete the goal while a member. */
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * households/{householdId}/goals/{goalId}/contributions/{contributionId}: an
 * amount one member records toward a household goal. Written once by that
 * member and never changed. Its author or the household's owner deletes it,
 * and so does any live member once the goal is gone: deleting a goal does
 * not reach its contributions, so the goal's delete takes them with it.
 */
export interface HouseholdContribution {
  /** The document id; never a stored field. */
  id: string;
  /** The household's `createdAt`, which is also the goal's `gen`. */
  gen: Timestamp;
  /** The contributing member, who alone writes it. */
  memberUid: string;
  /** In the goal's currency. */
  amount: number;
  /** When the member made the contribution. */
  date: Timestamp;
  /** The server's time of the write. */
  createdAt: Timestamp;
}

// The lists below are the only fields each kind may hold. The rules hold
// each kind's document to the same two lists (householdBudgetShapeValid,
// householdGoalShapeValid, householdContributionShapeValid in
// firestore.rules), and the ledger contract check fails when a pair differs.

/** Every field a household budget may hold. */
export const HOUSEHOLD_BUDGET_FIELDS = [
  'gen', 'name', 'categoryIds', 'amount', 'currency', 'period',
  'startDate', 'endDate', 'alertThreshold',
  'isActive', 'createdBy', 'createdAt', 'updatedAt',
] as const satisfies readonly (keyof HouseholdBudget)[];

/** Every field a household budget must hold: all but the end date and the alert threshold. */
export const HOUSEHOLD_BUDGET_REQUIRED = [
  'gen', 'name', 'categoryIds', 'amount', 'currency', 'period',
  'startDate',
  'isActive', 'createdBy', 'createdAt', 'updatedAt',
] as const satisfies readonly (keyof HouseholdBudget)[];

/** Every field a household goal may hold. */
export const HOUSEHOLD_GOAL_FIELDS = [
  'gen', 'name', 'targetAmount', 'currency', 'targetDate',
  'isActive', 'createdBy', 'createdAt', 'updatedAt',
] as const satisfies readonly (keyof HouseholdGoal)[];

/** Every field a household goal must hold: all but the target date. */
export const HOUSEHOLD_GOAL_REQUIRED = [
  'gen', 'name', 'targetAmount', 'currency',
  'isActive', 'createdBy', 'createdAt', 'updatedAt',
] as const satisfies readonly (keyof HouseholdGoal)[];

/** Every field a goal contribution may hold. */
export const HOUSEHOLD_CONTRIBUTION_FIELDS = [
  'gen', 'memberUid', 'amount', 'date', 'createdAt',
] as const satisfies readonly (keyof HouseholdContribution)[];

/** Every field a goal contribution must hold: all of them. */
export const HOUSEHOLD_CONTRIBUTION_REQUIRED = [
  'gen', 'memberUid', 'amount', 'date', 'createdAt',
] as const satisfies readonly (keyof HouseholdContribution)[];

/**
 * The most categories one household budget counts. The rules check each
 * entry by its index, one check per place up to this bound, so the ledger
 * contract check fails when the two disagree, and the rules smoke builds its
 * cases from it.
 */
export const HOUSEHOLD_PLAN_CATEGORY_MAX = 10;

/**
 * A household budget's category id, in characters. Every member's browser
 * shows every budget's categories, so the rules bound each entry, a string
 * of these lengths; every built-in id fits. The ledger contract check fails
 * when the rules' bound differs.
 */
export const HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH = { min: 1, max: 64 } as const;

/**
 * Contribution deletes per commit when a goal is deleted. Once the goal is
 * gone, the rules look up three documents for a live member's delete of
 * another member's contribution (the household, the goal as the commit
 * leaves it and the member's own member document), and a commit may make at
 * most 20 lookups. The goal's own delete, at most two lookups, shares the
 * first commit: 2 + 6 × 3 = 20.
 */
export const HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK = 6;

/**
 * A household budget's or goal's name, in characters. Every member's
 * browser shows every plan, so the rules bound the name, which they do not
 * for a personal budget or goal; the ledger contract check fails when the
 * rules' bounds differ, and the rules smoke builds its cases from these. The rules count characters, and a string's length in JavaScript
 * (UTF-16 code units) is never fewer, so a name the app accepts by its
 * length is one the rules accept.
 */
export const HOUSEHOLD_PLAN_NAME_LENGTH = { min: 1, max: 100 } as const;
