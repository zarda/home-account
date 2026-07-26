import {
  bigramSimilarity,
  computeRecurringGroups,
  normalizeMerchant,
} from './recurring-pattern.utils';
import { DetectorWindow } from './spending-pattern.types';
import { Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';

/**
 * Dates are built from local parts throughout. `new Date('2026-01-15')` parses
 * as UTC and lands on the previous day in negative-offset zones, which would
 * make the interval assertions machine-dependent.
 */
describe('recurring-pattern.utils', () => {
  const toBase = (t: Transaction) => t.amount;
  const window: DetectorWindow = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
  };

  function charge(
    date: Date,
    amount: number,
    description: string,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      description,
      categoryId: 'subscriptions_streaming_services',
      date: createTimestamp(date),
      ...overrides,
    });
  }

  /** `count` charges spaced `intervalDays` apart, starting at `start`. */
  function series(
    start: Date,
    count: number,
    intervalDays: number,
    amount: number,
    description: string,
    overrides: Partial<Transaction> = {},
  ): Transaction[] {
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * intervalDays);
      return charge(date, amount, description, overrides);
    });
  }

  describe('normalizeMerchant', () => {
    it('lowercases and collapses punctuation to single spaces', () => {
      expect(normalizeMerchant('NETFLIX.COM  -  Monthly')).toBe('netflix com monthly');
    });

    it('keeps CJK characters instead of erasing them', () => {
      // The duplicate-detection service strips everything outside [a-z0-9],
      // which reduces this to an empty string and collapses every Japanese
      // merchant into one cluster. This is the regression guard.
      expect(normalizeMerchant('ネットフリックス')).toBe('ネットフリックス');
      expect(normalizeMerchant('全聯福利中心 #123')).toBe('全聯福利中心');
    });

    it('drops a trailing store or order number', () => {
      expect(normalizeMerchant('Starbucks 4821')).toBe('starbucks');
      expect(normalizeMerchant('Store #77')).toBe('store');
    });

    it('keeps digits that are part of the name', () => {
      expect(normalizeMerchant('7-Eleven Taipei')).toBe('7 eleven taipei');
    });

    it('normalises full-width characters via NFKC', () => {
      expect(normalizeMerchant('ＮＥＴＦＬＩＸ')).toBe('netflix');
    });

    it('returns an empty string for punctuation-only input', () => {
      expect(normalizeMerchant('---')).toBe('');
      expect(normalizeMerchant('')).toBe('');
    });
  });

  describe('bigramSimilarity', () => {
    it('is 1 for identical non-empty strings and 0 for empty ones', () => {
      expect(bigramSimilarity('netflix', 'netflix')).toBe(1);
      expect(bigramSimilarity('', '')).toBe(0);
    });

    it('is symmetric', () => {
      expect(bigramSimilarity('netflix', 'netflx')).toBe(bigramSimilarity('netflx', 'netflix'));
    });

    it('scores a near-miss high and unrelated strings low', () => {
      expect(bigramSimilarity('netflix', 'netflix uk')).toBeGreaterThan(0.7);
      expect(bigramSimilarity('netflix', 'groceries')).toBeLessThan(0.3);
    });

    it('works on CJK, where whitespace tokenisation would not', () => {
      expect(bigramSimilarity('ネットフリックス', 'ネットフリックス')).toBe(1);
      expect(bigramSimilarity('全聯福利中心', '全聯福利')).toBeGreaterThan(0.7);
    });
  });

  describe('computeRecurringGroups — detected clusters', () => {
    it('finds a monthly subscription', () => {
      const result = computeRecurringGroups(
        series(new Date(2026, 0, 5), 6, 30, 15.99, 'Netflix'), toBase, window);

      expect(result.groupCount).toBe(1);
      const [group] = result.groups;
      expect(group.source).toBe('detected');
      expect(group.cadence).toBe('monthly');
      expect(group.occurrenceCount).toBe(6);
      expect(group.medianAmount).toBe(15.99);
      expect(group.monthlyEquivalent).toBe(15.99);
      expect(group.firstSeen).toBe('2026-01-05');
      expect(group.transactionIds.length).toBe(6);
    });

    it('clusters CJK descriptions that differ only by a store number', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 500, '全聯福利中心 101'),
        charge(new Date(2026, 1, 4), 500, '全聯福利中心 233'),
        charge(new Date(2026, 2, 6), 500, '全聯福利中心 4'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groupCount).toBe(1);
      expect(result.groups[0].occurrenceCount).toBe(3);
    });

    it('accepts a monthly cadence at 28, 30 and 31 day gaps', () => {
      const charges = [
        charge(new Date(2026, 0, 31), 9.99, 'Spotify'),
        charge(new Date(2026, 1, 28), 9.99, 'Spotify'),
        charge(new Date(2026, 2, 30), 9.99, 'Spotify'),
        charge(new Date(2026, 3, 30), 9.99, 'Spotify'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups[0].cadence).toBe('monthly');
    });

    it('classifies weekly and biweekly cadences with the right monthly equivalent', () => {
      const weekly = computeRecurringGroups(
        series(new Date(2026, 0, 5), 8, 7, 10, 'Gym'), toBase, window);
      expect(weekly.groups[0].cadence).toBe('weekly');
      // 10 * 30.436875/7
      expect(weekly.groups[0].monthlyEquivalent).toBe(43.48);

      const biweekly = computeRecurringGroups(
        series(new Date(2026, 0, 5), 8, 14, 10, 'Cleaner'), toBase, window);
      expect(biweekly.groups[0].cadence).toBe('biweekly');
      expect(biweekly.groups[0].monthlyEquivalent).toBe(21.74);
    });

    it('rejects three charges at irregular intervals', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 20, 'Random Shop'),
        charge(new Date(2026, 0, 12), 20, 'Random Shop'),
        charge(new Date(2026, 3, 20), 20, 'Random Shop'),
      ];
      // Gaps of 7 and 98 days: the median of 52.5 matches no cadence band.
      expect(computeRecurringGroups(charges, toBase, window).groupCount).toBe(0);
    });

    it('requires three occurrences for a detected cluster', () => {
      const charges = series(new Date(2026, 0, 5), 2, 30, 15.99, 'Netflix');
      expect(computeRecurringGroups(charges, toBase, window).groupCount).toBe(0);
    });

    it('excludes an amount outside the tolerance band', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 3, 30, 100, 'Insurance'),
        charge(new Date(2026, 3, 5), 900, 'Insurance'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups[0].occurrenceCount).toBe(3);
      expect(result.groups[0].medianAmount).toBe(100);
    });

    it('flags a price increase across the window', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 10, 'Cloud Drive'),
        charge(new Date(2026, 1, 5), 10, 'Cloud Drive'),
        charge(new Date(2026, 2, 5), 11, 'Cloud Drive'),
        charge(new Date(2026, 3, 5), 11, 'Cloud Drive'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups[0].priceIncreased).toBeTrue();
      expect(result.increasedGroupCount).toBe(1);
    });

    it('does not flag a stable price as increased', () => {
      const result = computeRecurringGroups(
        series(new Date(2026, 0, 5), 6, 30, 15.99, 'Netflix'), toBase, window);
      expect(result.groups[0].priceIncreased).toBeFalse();
    });

    it('ignores transactions outside the window', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 3, 30, 15.99, 'Netflix'),
        charge(new Date(2025, 5, 5), 15.99, 'Netflix'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups[0].occurrenceCount).toBe(3);
    });

    it('ignores income', () => {
      const income = createTransaction({
        type: 'income', amount: 100, date: createTimestamp(new Date(2026, 0, 5)),
      });
      expect(computeRecurringGroups([income], toBase, window).groupCount).toBe(0);
    });

    it('skips descriptions that normalise to nothing', () => {
      const charges = series(new Date(2026, 0, 5), 4, 30, 10, '---');
      expect(computeRecurringGroups(charges, toBase, window).groupCount).toBe(0);
    });
  });

  describe('computeRecurringGroups — declared rules', () => {
    it('keys a declared group by its rule, not by description similarity', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 30, 'Rent Jan', { recurringId: 'rule-1' }),
        charge(new Date(2026, 1, 5), 30, 'Rent Feb', { recurringId: 'rule-1' }),
        charge(new Date(2026, 2, 5), 30, 'Rent Mar', { recurringId: 'rule-1' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.declaredGroupCount).toBe(1);
      expect(result.detectedGroupCount).toBe(0);
      expect(result.groups[0].key).toContain(':declared:');
      expect(result.groups[0].key).toContain('rule-1');
    });

    it('accepts a declared group with only two occurrences', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 300, 'Quarterly tax', { recurringId: 'rule-q' }),
        charge(new Date(2026, 3, 5), 300, 'Quarterly tax', { recurringId: 'rule-q' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.declaredGroupCount).toBe(1);
      expect(result.groups[0].cadence).toBe('quarterly');
      expect(result.groups[0].monthlyEquivalent).toBe(100);
    });

    it('keeps declared amounts even when one was edited', () => {
      const charges = [
        charge(new Date(2026, 0, 5), 100, 'Rent', { recurringId: 'rule-1' }),
        charge(new Date(2026, 1, 5), 100, 'Rent', { recurringId: 'rule-1' }),
        charge(new Date(2026, 2, 5), 900, 'Rent', { recurringId: 'rule-1' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups[0].occurrenceCount).toBe(3);
    });

    it('never clusters a declared occurrence into a detected group', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 3, 30, 15.99, 'Netflix', { recurringId: 'rule-n' }),
        ...series(new Date(2026, 0, 9), 3, 30, 15.99, 'Netflix'),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.declaredGroupCount).toBe(1);
      expect(result.detectedGroupCount).toBe(1);
      expect(result.groupCount).toBe(2);
      // Both counted once each — the portfolio does not double-count.
      expect(result.totalMonthlyEquivalent).toBe(31.98);
    });

    it('counts an isRecurring tick without a rule as user-flagged, not declared', () => {
      const charges = series(
        new Date(2026, 0, 5), 4, 30, 15.99, 'Netflix', { isRecurring: true });
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.declaredGroupCount).toBe(0);
      expect(result.detectedGroupCount).toBe(1);
      expect(result.groups[0].userFlaggedCount).toBe(4);
    });
  });

  describe('computeRecurringGroups — summary and ordering', () => {
    it('sums the portfolio across both populations', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 4, 30, 20, 'Netflix'),
        ...series(new Date(2026, 0, 7), 4, 30, 5, 'News', { categoryId: 'other_expense' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groupCount).toBe(2);
      expect(result.totalMonthlyEquivalent).toBe(25);
      expect(result.detectedMonthlyEquivalent).toBe(25);
      expect(result.declaredMonthlyEquivalent).toBe(0);
    });

    it('orders by monthly equivalent, largest first', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 4, 30, 5, 'Small', { categoryId: 'a' }),
        ...series(new Date(2026, 0, 6), 4, 30, 50, 'Large', { categoryId: 'b' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groups.map(g => g.monthlyEquivalent)).toEqual([50, 5]);
    });

    it('caps the display list while the totals still cover every group', () => {
      const charges = Array.from({ length: 4 }, (_, i) =>
        series(new Date(2026, 0, 5), 4, 30, 10, `Service ${String.fromCharCode(97 + i)}`,
          { categoryId: `cat-${i}` })).flat();
      const result = computeRecurringGroups(charges, toBase, window, { cap: 2 });
      expect(result.groups.length).toBe(2);
      expect(result.groupCount).toBe(4);
      expect(result.totalMonthlyEquivalent).toBe(40);
    });

    it('counts groups that first appeared late in the window as new', () => {
      // Window ends 30 Jun; newWithinMonths 2 puts the cutoff at 30 Apr. The
      // weekly cadence is what lets the late group reach three occurrences
      // inside the remaining two months.
      const charges = [
        ...series(new Date(2026, 0, 5), 6, 30, 10, 'Old', { categoryId: 'a' }),
        ...series(new Date(2026, 4, 5), 6, 7, 10, 'New', { categoryId: 'b' }),
      ];
      const result = computeRecurringGroups(charges, toBase, window);
      expect(result.groupCount).toBe(2);
      expect(result.groups.find(g => g.categoryId === 'b')?.firstSeen).toBe('2026-05-05');
      expect(result.newGroupCount).toBe(1);
    });

    it('does not count a group that started before the cutoff as new', () => {
      const charges = series(new Date(2026, 0, 5), 6, 30, 10, 'Old');
      expect(computeRecurringGroups(charges, toBase, window).newGroupCount).toBe(0);
    });

    it('produces identical output for shuffled input', () => {
      const charges = [
        ...series(new Date(2026, 0, 5), 5, 30, 15.99, 'Netflix'),
        ...series(new Date(2026, 0, 9), 5, 7, 4.5, 'Coffee Club', { categoryId: 'food' }),
        ...series(new Date(2026, 0, 3), 4, 30, 60, 'Rent', { recurringId: 'rule-r' }),
      ];
      const forward = computeRecurringGroups(charges, toBase, window);
      const reversed = computeRecurringGroups([...charges].reverse(), toBase, window);
      const rotated = computeRecurringGroups(
        [...charges.slice(7), ...charges.slice(0, 7)], toBase, window);

      expect(reversed).toEqual(forward);
      expect(rotated).toEqual(forward);
    });

    it('returns an empty summary for no transactions', () => {
      const result = computeRecurringGroups([], toBase, window);
      expect(result.groups).toEqual([]);
      expect(result.groupCount).toBe(0);
      expect(result.totalMonthlyEquivalent).toBe(0);
    });
  });
});
