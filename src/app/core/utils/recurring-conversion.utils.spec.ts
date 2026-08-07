import {
  frequencyFromCadence,
  isGroupCovered,
  prefillFromGroup
} from './recurring-conversion.utils';
import { StorableRecurringGroup } from '../../models';
import { RecurringFrequency, RecurringTransaction } from '../../models';

describe('recurring-conversion.utils', () => {
  function group(overrides: Partial<StorableRecurringGroup> = {}): StorableRecurringGroup {
    return {
      key: 'rec:detected:entertainment:netflix',
      source: 'detected',
      categoryId: 'entertainment',
      label: 'NETFLIX.COM',
      cadence: 'monthly',
      medianIntervalDays: 30,
      occurrenceCount: 4,
      medianAmount: 15.99,
      monthlyEquivalent: 15.99,
      firstSeen: '2026-03-15',
      lastSeen: '2026-07-15',
      priceIncreased: false,
      userFlaggedCount: 0,
      ...overrides
    };
  }

  function rule(
    name: string,
    frequency: RecurringFrequency,
    isActive = true
  ): RecurringTransaction {
    return { name, frequency, isActive } as RecurringTransaction;
  }

  describe('frequencyFromCadence', () => {
    it('maps weekly onto a one-week interval anchored on the weekday', () => {
      // 2026-08-04 is a Tuesday.
      expect(frequencyFromCadence('weekly', new Date(2026, 7, 4))).toEqual({
        type: 'weekly',
        interval: 1,
        dayOfWeek: 2
      });
    });

    it('maps biweekly onto a two-week interval', () => {
      expect(frequencyFromCadence('biweekly', new Date(2026, 7, 4))).toEqual({
        type: 'weekly',
        interval: 2,
        dayOfWeek: 2
      });
    });

    it('maps monthly onto the anchor day of month', () => {
      expect(frequencyFromCadence('monthly', new Date(2026, 7, 15))).toEqual({
        type: 'monthly',
        interval: 1,
        dayOfMonth: 15
      });
    });

    it('keeps a month-end anchor day for the clamp to resolve downstream', () => {
      expect(frequencyFromCadence('monthly', new Date(2026, 0, 31))).toEqual({
        type: 'monthly',
        interval: 1,
        dayOfMonth: 31
      });
    });

    it('maps quarterly onto a three-month interval', () => {
      expect(frequencyFromCadence('quarterly', new Date(2026, 7, 15))).toEqual({
        type: 'monthly',
        interval: 3,
        dayOfMonth: 15
      });
    });

    it('maps yearly onto the anchor day and month', () => {
      expect(frequencyFromCadence('yearly', new Date(2026, 2, 10))).toEqual({
        type: 'yearly',
        interval: 1,
        dayOfMonth: 10,
        monthOfYear: 3
      });
    });
  });

  describe('prefillFromGroup', () => {
    it('builds a create DTO from the detected group', () => {
      const prefill = prefillFromGroup(group(), 'USD');

      expect(prefill.name).toBe('NETFLIX.COM');
      expect(prefill.type).toBe('expense');
      expect(prefill.amount).toBe(15.99);
      expect(prefill.currency).toBe('USD');
      expect(prefill.categoryId).toBe('entertainment');
      expect(prefill.description).toBe('');
      expect(prefill.frequency).toEqual({ type: 'monthly', interval: 1, dayOfMonth: 15 });
      // Anchored on the last observed charge; the catch-up engine advances it.
      expect(prefill.startDate).toEqual(new Date(2026, 6, 15));
    });

    it('anchors weekly cadences on the last-seen weekday', () => {
      // 2026-07-17 is a Friday.
      const prefill = prefillFromGroup(
        group({ cadence: 'weekly', lastSeen: '2026-07-17' }),
        'EUR'
      );

      expect(prefill.currency).toBe('EUR');
      expect(prefill.frequency).toEqual({ type: 'weekly', interval: 1, dayOfWeek: 5 });
      expect(prefill.startDate).toEqual(new Date(2026, 6, 17));
    });
  });

  describe('isGroupCovered', () => {
    it('covers a group whose label matches an active rule with the same cadence', () => {
      expect(isGroupCovered(group(), [rule('Netflix', { type: 'monthly', interval: 1 })]))
        .toBeTrue();
    });

    it('covers a name variant by similarity', () => {
      expect(
        isGroupCovered(group({ label: 'NETFLIX.COM 4321' }), [
          rule('netflix com', { type: 'monthly', interval: 1 })
        ])
      ).toBeTrue();
    });

    it('covers a biweekly group by a two-week rule', () => {
      expect(
        isGroupCovered(group({ cadence: 'biweekly' }), [
          rule('Netflix', { type: 'weekly', interval: 2 })
        ])
      ).toBeTrue();
    });

    it('does not cover on a cadence mismatch', () => {
      expect(isGroupCovered(group(), [rule('Netflix', { type: 'weekly', interval: 1 })]))
        .toBeFalse();
    });

    it('ignores inactive rules', () => {
      expect(
        isGroupCovered(group(), [rule('Netflix', { type: 'monthly', interval: 1 }, false)])
      ).toBeFalse();
    });

    it('does not cover an unrelated name', () => {
      expect(isGroupCovered(group(), [rule('Gym Membership', { type: 'monthly', interval: 1 })]))
        .toBeFalse();
    });
  });
});
