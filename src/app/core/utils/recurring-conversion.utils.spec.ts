import {
  RecurringMatchCandidate,
  frequencyFromCadence,
  isGroupCovered,
  matchRecurringRule,
  prefillFromGroup,
  recurringCoverageFingerprint
} from './recurring-conversion.utils';
import { StorableRecurringGroup } from '../../models';
import { RecurringFrequency, RecurringTransaction } from '../../models';
import { createRecurring, createTimestamp } from '../services/testing/test-data';

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

  // The fingerprint decides whether InsightsService's content-keyed cache
  // notices a rule change. It has to move for everything isGroupCovered reads,
  // and for nothing else.
  describe('recurringCoverageFingerprint', () => {
    const netflix = () => createRecurring({ name: 'Netflix' });

    it('moves when a rule is renamed', () => {
      expect(recurringCoverageFingerprint([createRecurring({ name: 'Spotify' })]))
        .not.toBe(recurringCoverageFingerprint([netflix()]));
    });

    it('moves when a cadence changes', () => {
      const weekly = createRecurring({
        name: 'Netflix', frequency: { type: 'weekly', interval: 1 }
      });
      expect(recurringCoverageFingerprint([weekly]))
        .not.toBe(recurringCoverageFingerprint([netflix()]));
    });

    it('moves when a rule is paused', () => {
      expect(recurringCoverageFingerprint([createRecurring({ isActive: false })]))
        .not.toBe(recurringCoverageFingerprint([netflix()]));
    });

    it('holds when only the next occurrence advances', () => {
      // The engine advances nextOccurrence every time it posts a catch-up
      // occurrence. Folding it in would evict the cached facts daily for a
      // change that cannot move a single figure.
      const rule = netflix();
      const posted = {
        ...rule,
        nextOccurrence: createTimestamp(new Date(2026, 9, 1)),
        lastProcessed: createTimestamp(new Date(2026, 8, 1)),
      };
      expect(recurringCoverageFingerprint([posted]))
        .toBe(recurringCoverageFingerprint([rule]));
    });

    it('holds when an amount or category changes', () => {
      const repriced = { ...netflix(), amount: 19.99, categoryId: 'other_expense' };
      expect(recurringCoverageFingerprint([repriced]))
        .toBe(recurringCoverageFingerprint([netflix()]));
    });

    it('does not depend on the order rules arrive in', () => {
      const a = createRecurring({ name: 'Netflix' });
      const b = createRecurring({ name: 'Spotify' });
      expect(recurringCoverageFingerprint([a, b]))
        .toBe(recurringCoverageFingerprint([b, a]));
    });
  });

  // Complete fixtures on purpose: the matcher reads `type`, `amount` and
  // `currency` as well as the name, and the partial `rule()` cast above would
  // report "no match" for a missing field instead of failing.
  describe('matchRecurringRule', () => {
    const row = (overrides: Partial<RecurringMatchCandidate> = {}): RecurringMatchCandidate => ({
      description: 'NETFLIX.COM', type: 'expense', amount: 15.99, currency: 'USD', ...overrides,
    });

    it('offers an active rule whose name matches by the detector\'s ladder', () => {
      const netflix = createRecurring({ name: 'Netflix' });
      expect(matchRecurringRule(row(), [netflix])?.id).toBe(netflix.id);
    });

    it('never offers an inactive rule', () => {
      expect(matchRecurringRule(row(), [createRecurring({ name: 'Netflix', isActive: false })])).toBeNull();
    });

    it('prefers the merchant a reader named over the description', () => {
      const spotify = createRecurring({ name: 'Spotify', amount: 9.99 });
      expect(matchRecurringRule(row({ description: 'Card payment', merchant: 'Spotify AB', amount: 9.99 }), [spotify])?.id)
        .toBe(spotify.id);
    });

    it('requires the same type', () => {
      expect(matchRecurringRule(row({ type: 'income' }), [createRecurring({ name: 'Netflix' })])).toBeNull();
    });

    it('requires the amount within the detector\'s tolerance when the currencies agree', () => {
      const netflix = createRecurring({ name: 'Netflix', amount: 15.99, currency: 'USD' });
      expect(matchRecurringRule(row({ amount: 17.5 }), [netflix])?.id).toBe(netflix.id);   // +9%
      expect(matchRecurringRule(row({ amount: 45 }), [netflix])).toBeNull();
    });

    it('skips the amount check when the currencies differ', () => {
      // A figure in another currency is not comparable without a rate, and a
      // rate is not something a match should need.
      const netflix = createRecurring({ name: 'Netflix', amount: 15.99, currency: 'USD' });
      expect(matchRecurringRule(row({ amount: 2400, currency: 'JPY' }), [netflix])?.id).toBe(netflix.id);
    });

    it('offers nothing for a merchant no rule names', () => {
      expect(matchRecurringRule(row({ description: 'Corner bakery' }), [createRecurring({ name: 'Netflix' })])).toBeNull();
    });
  });
});
