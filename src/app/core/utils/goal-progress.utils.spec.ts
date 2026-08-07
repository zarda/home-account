import { goalPercentage, itemsTotal } from './goal-progress.utils';
import { GoalItem, isGoalKind } from '../../models';

describe('goal-progress.utils', () => {
  describe('goalPercentage', () => {
    it('is the contributed share of the target', () => {
      expect(goalPercentage({ contributedAmount: 50, targetAmount: 200 })).toBe(25);
    });

    it('guards a zero target', () => {
      expect(goalPercentage({ contributedAmount: 50, targetAmount: 0 })).toBe(0);
    });

    it('is uncapped past the target, like budget percentages', () => {
      expect(goalPercentage({ contributedAmount: 300, targetAmount: 200 })).toBe(150);
    });

    it('never goes below zero', () => {
      expect(goalPercentage({ contributedAmount: -10, targetAmount: 200 })).toBe(0);
    });
  });

  describe('itemsTotal', () => {
    const items: GoalItem[] = [
      { name: 'Flights', amount: 400, done: true },
      { name: 'Hotel', amount: 600, done: false }
    ];

    it('sums every item regardless of done state', () => {
      expect(itemsTotal(items)).toBe(1000);
    });

    it('is zero for a missing or empty list', () => {
      expect(itemsTotal(undefined)).toBe(0);
      expect(itemsTotal([])).toBe(0);
    });
  });

  describe('isGoalKind', () => {
    it('accepts the two kinds and nothing else', () => {
      expect(isGoalKind('saving')).toBeTrue();
      expect(isGoalKind('project')).toBeTrue();
      expect(isGoalKind('budget')).toBeFalse();
      expect(isGoalKind(3)).toBeFalse();
    });
  });
});
