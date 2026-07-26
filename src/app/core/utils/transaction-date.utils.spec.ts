import { Timestamp } from '@angular/fire/firestore';
import {
  addMonths,
  clampToEndOfToday,
  countDaysByKind,
  dateOf,
  dayKey,
  endOfMonth,
  isLastDaysOfMonth,
  isWeekend,
  monthKey,
  monthKeysBetween,
  parseMonthKey,
  startOfMonth,
  toDate,
  wholeDaysBetween,
} from './transaction-date.utils';
import { Transaction } from '../../models';

/**
 * Dates are constructed from local parts throughout (`new Date(2026, 0, 15)`),
 * never parsed from an ISO string. `new Date('2026-01-15')` is parsed as UTC, so
 * in a negative-offset zone it lands on the 14th and every weekday assertion
 * below would flake depending on where the suite runs.
 */
describe('transaction-date.utils', () => {
  describe('toDate', () => {
    it('passes a valid Date through', () => {
      const date = new Date(2026, 0, 15);
      expect(toDate(date)).toBe(date);
    });

    it('converts a Firestore Timestamp', () => {
      const date = new Date(2026, 0, 15);
      expect(toDate(Timestamp.fromDate(date))?.getTime()).toBe(date.getTime());
    });

    it('returns null for null, undefined and an invalid Date', () => {
      expect(toDate(null)).toBeNull();
      expect(toDate(undefined)).toBeNull();
      expect(toDate(new Date('nonsense'))).toBeNull();
    });
  });

  describe('dateOf', () => {
    it('reads a Timestamp date', () => {
      const date = new Date(2026, 5, 2);
      const transaction = { date: Timestamp.fromDate(date) } as Pick<Transaction, 'date'>;
      expect(dateOf(transaction).getTime()).toBe(date.getTime());
    });

    it('tolerates a plain Date, which is what specs and DTOs pass', () => {
      const date = new Date(2026, 5, 2);
      const transaction = { date } as unknown as Pick<Transaction, 'date'>;
      expect(dateOf(transaction)).toBe(date);
    });

    it('falls back to the epoch rather than throwing on junk', () => {
      const transaction = { date: 'not a date' } as unknown as Pick<Transaction, 'date'>;
      expect(dateOf(transaction).getTime()).toBe(0);
    });
  });

  describe('monthKey / dayKey', () => {
    it('zero-pads single-digit months and days', () => {
      expect(monthKey(new Date(2026, 0, 5))).toBe('2026-01');
      expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('handles December without rolling the year', () => {
      expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12');
      expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('sorts lexicographically in chronological order', () => {
      const keys = [
        monthKey(new Date(2026, 9, 1)),
        monthKey(new Date(2025, 11, 1)),
        monthKey(new Date(2026, 0, 1)),
      ].sort();
      expect(keys).toEqual(['2025-12', '2026-01', '2026-10']);
    });
  });

  describe('parseMonthKey', () => {
    it('returns a zero-based month', () => {
      expect(parseMonthKey('2026-01')).toEqual({ year: 2026, month: 0 });
      expect(parseMonthKey('2026-12')).toEqual({ year: 2026, month: 11 });
    });

    it('rejects out-of-range and malformed keys', () => {
      expect(parseMonthKey('2026-13')).toBeNull();
      expect(parseMonthKey('2026-00')).toBeNull();
      expect(parseMonthKey('2026-1')).toBeNull();
      expect(parseMonthKey('march')).toBeNull();
      expect(parseMonthKey('2026-01-01')).toBeNull();
      expect(parseMonthKey('')).toBeNull();
    });
  });

  describe('startOfMonth / endOfMonth', () => {
    it('brackets the month inclusively', () => {
      expect(startOfMonth(new Date(2026, 1, 17, 13, 45)).getTime())
        .toBe(new Date(2026, 1, 1).getTime());
      expect(endOfMonth(new Date(2026, 1, 17)).getTime())
        .toBe(new Date(2026, 1, 28, 23, 59, 59, 999).getTime());
    });

    it('handles a leap February', () => {
      expect(endOfMonth(new Date(2028, 1, 1)).getDate()).toBe(29);
    });
  });

  describe('addMonths', () => {
    it('clamps the day to the target month rather than rolling over', () => {
      const result = addMonths(new Date(2026, 0, 31), 1);
      expect(monthKey(result)).toBe('2026-02');
      expect(result.getDate()).toBe(28);
    });

    it('walks backwards across a year boundary', () => {
      expect(monthKey(addMonths(new Date(2026, 2, 15), -6))).toBe('2025-09');
    });
  });

  describe('clampToEndOfToday', () => {
    const now = new Date(2026, 6, 15, 10, 30);

    it('caps a window that runs past today', () => {
      const clamped = clampToEndOfToday(new Date(2026, 6, 31, 23, 59, 59, 999), now);
      expect(clamped.getTime()).toBe(new Date(2026, 6, 15, 23, 59, 59, 999).getTime());
    });

    it('leaves a window that already ended alone', () => {
      const past = new Date(2026, 5, 30, 23, 59, 59, 999);
      expect(clampToEndOfToday(past, now).getTime()).toBe(past.getTime());
    });
  });

  describe('monthKeysBetween', () => {
    it('is inclusive at both ends and ascending', () => {
      expect(monthKeysBetween(new Date(2026, 0, 20), new Date(2026, 3, 2)))
        .toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    });

    it('returns a single key when both dates share a month', () => {
      expect(monthKeysBetween(new Date(2026, 4, 1), new Date(2026, 4, 31)))
        .toEqual(['2026-05']);
    });

    it('crosses a year boundary', () => {
      expect(monthKeysBetween(new Date(2025, 10, 5), new Date(2026, 1, 5)))
        .toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('returns nothing when the end precedes the start', () => {
      expect(monthKeysBetween(new Date(2026, 5, 1), new Date(2026, 3, 1))).toEqual([]);
    });
  });

  describe('wholeDaysBetween', () => {
    it('counts whole days and is signed', () => {
      expect(wholeDaysBetween(new Date(2026, 0, 1), new Date(2026, 0, 31))).toBe(30);
      expect(wholeDaysBetween(new Date(2026, 0, 31), new Date(2026, 0, 1))).toBe(-30);
      expect(wholeDaysBetween(new Date(2026, 0, 1), new Date(2026, 0, 1))).toBe(0);
    });

    it('ignores the time of day', () => {
      expect(wholeDaysBetween(
        new Date(2026, 0, 1, 23, 59), new Date(2026, 0, 2, 0, 1))).toBe(1);
    });

    it('returns an exact integer across a spring DST transition', () => {
      // Late March covers the EU/US transitions; a local millisecond diff here
      // yields 30.958..., which would misclassify a monthly cadence.
      const days = wholeDaysBetween(new Date(2026, 2, 1), new Date(2026, 3, 1));
      expect(days).toBe(31);
      expect(Number.isInteger(days)).toBeTrue();
    });

    it('returns exact integers across every month boundary of a year', () => {
      for (let month = 0; month < 12; month += 1) {
        const days = wholeDaysBetween(new Date(2026, month, 1), new Date(2026, month + 1, 1));
        expect(Number.isInteger(days)).toBeTrue();
        expect(days).toBe(new Date(2026, month + 1, 0).getDate());
      }
    });
  });

  describe('isWeekend', () => {
    it('treats Saturday and Sunday as the weekend by default', () => {
      expect(isWeekend(new Date(2026, 0, 3))).toBeTrue();  // Saturday
      expect(isWeekend(new Date(2026, 0, 4))).toBeTrue();  // Sunday
      expect(isWeekend(new Date(2026, 0, 5))).toBeFalse(); // Monday
    });

    it('honours an overridden weekend', () => {
      expect(isWeekend(new Date(2026, 0, 5), [1])).toBeTrue();
      expect(isWeekend(new Date(2026, 0, 3), [1])).toBeFalse();
    });
  });

  describe('countDaysByKind', () => {
    it('counts both kinds across a full month', () => {
      // January 2026 starts on a Thursday: 31 days, 9 weekend days.
      const result = countDaysByKind(new Date(2026, 0, 1), new Date(2026, 0, 31, 23, 59));
      expect(result.totalDays).toBe(31);
      expect(result.weekendDays).toBe(9);
      expect(result.weekdayDays).toBe(22);
    });

    it('is inclusive of a single-day window', () => {
      const monday = new Date(2026, 0, 5);
      expect(countDaysByKind(monday, monday))
        .toEqual({ weekdayDays: 1, weekendDays: 0, totalDays: 1 });
    });

    it('returns zeros when the end precedes the start', () => {
      expect(countDaysByKind(new Date(2026, 0, 10), new Date(2026, 0, 1)))
        .toEqual({ weekdayDays: 0, weekendDays: 0, totalDays: 0 });
    });

    it('shows the imbalance the detectors have to divide out', () => {
      const { weekdayDays, weekendDays } =
        countDaysByKind(new Date(2026, 0, 1), new Date(2026, 5, 30));
      expect(weekdayDays).toBeGreaterThan(weekendDays * 2);
    });
  });

  describe('isLastDaysOfMonth', () => {
    it('flags the final days of a 31-day month', () => {
      expect(isLastDaysOfMonth(new Date(2026, 0, 27), 5)).toBeTrue();
      expect(isLastDaysOfMonth(new Date(2026, 0, 31), 5)).toBeTrue();
      expect(isLastDaysOfMonth(new Date(2026, 0, 26), 5)).toBeFalse();
    });

    it('shortens with a 28-day February', () => {
      expect(isLastDaysOfMonth(new Date(2026, 1, 24), 5)).toBeTrue();
      expect(isLastDaysOfMonth(new Date(2026, 1, 23), 5)).toBeFalse();
    });

    it('never flags anything for a zero-length tail', () => {
      expect(isLastDaysOfMonth(new Date(2026, 0, 31), 0)).toBeFalse();
    });
  });
});
