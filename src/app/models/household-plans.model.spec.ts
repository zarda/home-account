import { Timestamp } from '@angular/fire/firestore';
import { defaultCategories } from '../core/utils/category-merge.utils';
import { LEDGER_QUERY_SHAPES } from './household-ledger.model';
import {
  HOUSEHOLD_BUDGET_FIELDS,
  HOUSEHOLD_BUDGET_REQUIRED,
  HOUSEHOLD_CONTRIBUTION_FIELDS,
  HOUSEHOLD_CONTRIBUTION_REQUIRED,
  HOUSEHOLD_GOAL_FIELDS,
  HOUSEHOLD_GOAL_REQUIRED,
  HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH,
  HOUSEHOLD_PLAN_CATEGORY_MAX,
  HOUSEHOLD_PLAN_NAME_LENGTH,
  HouseholdBudget,
  HouseholdContribution,
  HouseholdGoal,
} from './household-plans.model';

const stamp = (millis: number) => Timestamp.fromMillis(millis);

/**
 * Each plan kind with one document holding every stored field, the optional
 * ones included. Typed as every key but the document id, so the compiler
 * refuses a key missing from the literal and one the interface lacks, and
 * comparing its keys with the list ties the list to the interface both ways.
 */
const budget: Required<Omit<HouseholdBudget, 'id'>> = {
  gen: stamp(1_790_000_000_000),
  name: 'Food',
  categoryIds: ['food', 'transport_fuel'],
  amount: 600,
  currency: 'EUR',
  period: 'monthly',
  startDate: stamp(1_790_000_000_000),
  endDate: stamp(1_800_000_000_000),
  alertThreshold: 80,
  isActive: true,
  createdBy: 'u1',
  createdAt: stamp(1_790_100_000_000),
  updatedAt: stamp(1_790_200_000_000),
};

const goal: Required<Omit<HouseholdGoal, 'id'>> = {
  gen: stamp(1_790_000_000_000),
  name: 'Holiday',
  targetAmount: 2400,
  currency: 'JPY',
  targetDate: stamp(1_800_000_000_000),
  isActive: true,
  createdBy: 'u1',
  createdAt: stamp(1_790_100_000_000),
  updatedAt: stamp(1_790_200_000_000),
};

const contribution: Required<Omit<HouseholdContribution, 'id'>> = {
  gen: stamp(1_790_000_000_000),
  memberUid: 'u2',
  amount: 50,
  date: stamp(1_790_300_000_000),
  createdAt: stamp(1_790_300_000_000),
};

const KINDS = [
  {
    kind: 'budget',
    collectionGroup: 'budgets',
    fields: HOUSEHOLD_BUDGET_FIELDS as readonly string[],
    required: HOUSEHOLD_BUDGET_REQUIRED as readonly string[],
    optional: ['endDate', 'alertThreshold'],
    stored: Object.keys(budget),
  },
  {
    kind: 'goal',
    collectionGroup: 'goals',
    fields: HOUSEHOLD_GOAL_FIELDS as readonly string[],
    required: HOUSEHOLD_GOAL_REQUIRED as readonly string[],
    optional: ['targetDate'],
    stored: Object.keys(goal),
  },
  {
    kind: 'contribution',
    collectionGroup: 'contributions',
    fields: HOUSEHOLD_CONTRIBUTION_FIELDS as readonly string[],
    required: HOUSEHOLD_CONTRIBUTION_REQUIRED as readonly string[],
    optional: [],
    stored: Object.keys(contribution),
  },
] as const;

describe('household-plans.model', () => {
  for (const { kind, collectionGroup, fields, required, optional, stored } of KINDS) {
    describe(`a ${kind}'s fields`, () => {
      it('lists exactly the stored keys of the document', () => {
        expect([...fields].sort()).toEqual([...stored].sort());
      });

      it('names each field once', () => {
        expect(new Set(fields).size).toBe(fields.length);
      });

      it('requires every field but the optional ones, in the same order', () => {
        expect([...required]).toEqual(fields.filter(field => !(optional as readonly string[]).includes(field)));
      });

      // The document id is the path, never a field, and the generation is
      // what every list filters on and every rule compares.
      it('stores the generation and never the document id', () => {
        expect(required).toContain('gen');
        expect(fields).not.toContain('id');
      });

      it('never names the account a personal record is stamped with', () => {
        expect(fields).not.toContain('userId');
      });

      it('is listed by its query shape only on fields it holds', () => {
        const shapes = Object.values(LEDGER_QUERY_SHAPES).filter(shape => shape.collectionGroup === collectionGroup);
        expect(shapes.length).withContext(`a query shape on ${collectionGroup}`).toBeGreaterThan(0);
        for (const shape of shapes) {
          for (const [field] of shape.fields) {
            expect(fields).toContain(field);
          }
        }
      });
    });
  }

  describe("what a plan leaves to the page's reading", () => {
    // A household budget's spending is folded from the shared copies each
    // time the page reads it, so no stored figure can go stale; a goal's
    // progress likewise comes from its linked copies and contributions.
    for (const field of ['spent', 'spentPeriod']) {
      it(`stores no ${field} on a budget`, () => {
        expect(HOUSEHOLD_BUDGET_FIELDS as readonly string[]).not.toContain(field);
      });
    }

    for (const field of ['contributedAmount', 'linkedAmount']) {
      it(`stores no ${field} on a goal`, () => {
        expect(HOUSEHOLD_GOAL_FIELDS as readonly string[]).not.toContain(field);
      });
    }
  });

  describe('who a plan names', () => {
    it('names its maker on a budget and a goal, and the contributing member on a contribution', () => {
      expect(HOUSEHOLD_BUDGET_REQUIRED as readonly string[]).toContain('createdBy');
      expect(HOUSEHOLD_GOAL_REQUIRED as readonly string[]).toContain('createdBy');
      expect(HOUSEHOLD_CONTRIBUTION_REQUIRED as readonly string[]).toContain('memberUid');
    });

    it('carries its own currency on a budget and a goal, the household having none', () => {
      expect(HOUSEHOLD_BUDGET_REQUIRED as readonly string[]).toContain('currency');
      expect(HOUSEHOLD_GOAL_REQUIRED as readonly string[]).toContain('currency');
      expect(HOUSEHOLD_CONTRIBUTION_FIELDS as readonly string[]).not.toContain('currency');
    });
  });

  describe('the limits', () => {
    it('are the ones the rules are written against', () => {
      expect(HOUSEHOLD_PLAN_CATEGORY_MAX).toBe(10);
      expect(HOUSEHOLD_PLAN_NAME_LENGTH).toEqual({ min: 1, max: 100 });
      expect(HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH).toEqual({ min: 1, max: 64 });
    });

    // A budget counts copies by built-in id, so a bound that cut one off
    // would make that category impossible to budget for.
    it('admit every built-in category id', () => {
      for (const { id } of defaultCategories()) {
        expect(id.length).withContext(id).toBeGreaterThanOrEqual(HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH.min);
        expect(id.length).withContext(id).toBeLessThanOrEqual(HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH.max);
      }
    });

    it('lets a budget name at least one category', () => {
      expect(HOUSEHOLD_PLAN_CATEGORY_MAX).toBeGreaterThanOrEqual(1);
    });
  });
});
