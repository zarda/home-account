import { Timestamp } from '@angular/fire/firestore';
import {
  addDays,
  addMonths,
  budgetPeriodKey,
  budgetPeriodWindow,
  clampToEndOfToday,
  clampWindowToNow,
  countDaysByKind,
  dateAtClampedDay,
  dateOf,
  daysInMonth,
  dayKey,
  defaultBudgetStart,
  endOfDay,
  endOfMonth,
  isLastDaysOfMonth,
  isWeekend,
  isoWeekNumber,
  localDateFromParts,
  monthKey,
  monthKeysBetween,
  monthWindow,
  parseDateInput,
  parseDayKey,
  parseMonthKey,
  periodWindow,
  previousPeriodWindow,
  startOfDay,
  startOfMonth,
  toDate,
  weekWindow,
  wholeDaysBetween,
  yearWindow,
} from './transaction-date.utils';
import { PeriodOption, PeriodSelection, Transaction } from '../../models';

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

  describe('dateAtClampedDay', () => {
    const noon = new Date(2026, 0, 1, 12, 34, 56, 789);

    it('clamps the 31st down to the length of the month it lands in', () => {
      const result = dateAtClampedDay(2027, 1, 31, noon);
      expect(monthKey(result)).toBe('2027-02');
      expect(result.getDate()).toBe(28);
    });

    it('reaches the 29th in a leap year', () => {
      expect(dayKey(dateAtClampedDay(2028, 1, 31, noon))).toBe('2028-02-29');
    });

    it('leaves a day the month can hold alone', () => {
      expect(dayKey(dateAtClampedDay(2027, 2, 31, noon))).toBe('2027-03-31');
    });

    it('normalises a month past December into the next year', () => {
      expect(dayKey(dateAtClampedDay(2027, 12, 15, noon))).toBe('2028-01-15');
    });

    it('carries the clock time of the reference date', () => {
      const result = dateAtClampedDay(2027, 1, 31, noon);
      expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([12, 34, 56]);
      expect(result.getMilliseconds()).toBe(789);
    });
  });

  describe('localDateFromParts', () => {
    it('builds local midnight from 0-11 month parts', () => {
      expect(localDateFromParts(2026, 7, 1)?.getTime()).toBe(new Date(2026, 7, 1).getTime());
    });

    it('rejects a day the month does not have rather than rolling into the next', () => {
      expect(localDateFromParts(2026, 1, 31)).toBeNull();
    });

    it('accepts the 29th of February in a leap year', () => {
      expect(dayKey(localDateFromParts(2028, 1, 29)!)).toBe('2028-02-29');
    });
  });

  /**
   * Every assertion here compares against a locally-constructed Date, never
   * against a UTC constant or an ISO literal. `new Date(2026, 7, 1)` is local
   * midnight in every zone, while the `new Date('2026-08-01')` this replaces is
   * UTC midnight — so these fail under the old behaviour anywhere the runtime
   * is not at offset 0, in both directions. At offset 0 the two are the same
   * instant and no assertion can tell them apart, which is why CI also runs
   * this file under TZ=America/New_York and TZ=Asia/Tokyo.
   */
  describe('parseDayKey', () => {
    it('reads a date-only string as local midnight', () => {
      expect(parseDayKey('2026-08-01')!.getTime()).toBe(new Date(2026, 7, 1).getTime());
    });

    it('trims surrounding whitespace', () => {
      expect(parseDayKey('  2026-08-01  ')!.getTime()).toBe(new Date(2026, 7, 1).getTime());
    });

    it('is the exact inverse of dayKey', () => {
      const date = new Date(2026, 7, 1, 23, 30);
      expect(parseDayKey(dayKey(date))!.getTime()).toBe(new Date(2026, 7, 1).getTime());
    });

    it('rejects a rollover', () => {
      expect(parseDayKey('2026-02-31')).toBeNull();
    });

    it('rejects an impossible month', () => {
      expect(parseDayKey('2026-13-01')).toBeNull();
    });

    it('rejects unpadded parts, an empty string, and a non-string', () => {
      expect(parseDayKey('2026-8-1')).toBeNull();
      expect(parseDayKey('')).toBeNull();
      expect(parseDayKey(null)).toBeNull();
      expect(parseDayKey(new Date(2026, 7, 1))).toBeNull();
    });

    it('does not match a date-only prefix inside a full instant', () => {
      expect(parseDayKey('2026-08-01T10:30:00Z')).toBeNull();
    });
  });

  describe('parseDateInput', () => {
    it('reads a date-only string as local midnight', () => {
      expect(parseDateInput('2026-08-01')!.getTime()).toBe(new Date(2026, 7, 1).getTime());
    });

    it('leaves a full ISO instant meaning the instant it names', () => {
      expect(parseDateInput('2026-08-01T10:30:00Z')!.getTime()).toBe(
        Date.parse('2026-08-01T10:30:00Z'),
      );
    });

    it('leaves a US-style bank CSV date to the platform', () => {
      const result = parseDateInput('08/01/2026')!;
      expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2026, 7, 1]);
    });

    it('passes a Date through', () => {
      const date = new Date(2026, 7, 1);
      expect(parseDateInput(date)).toBe(date);
    });

    it('returns null for junk and a missing value', () => {
      expect(parseDateInput('not a date')).toBeNull();
      expect(parseDateInput(undefined)).toBeNull();
      expect(parseDateInput(new Date('nonsense'))).toBeNull();
    });

    it('rejects a date of the right shape that does not exist', () => {
      // The platform does not: new Date('2026-02-31') is 3 March in V8. Having
      // matched the shape, this must not fall through to that.
      expect(parseDateInput('2026-02-31')).toBeNull();
      expect(new Date('2026-02-31').getMonth()).toBe(2);
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

  describe('startOfDay / endOfDay / addDays', () => {
    it('brackets the day inclusively', () => {
      const afternoon = new Date(2026, 7, 14, 15, 20, 30, 400);
      expect(startOfDay(afternoon).getTime()).toBe(new Date(2026, 7, 14).getTime());
      expect(endOfDay(afternoon).getTime())
        .toBe(new Date(2026, 7, 14, 23, 59, 59, 999).getTime());
    });

    it('walks days by local calendar parts, not by milliseconds', () => {
      // Late March covers the EU/US transitions: a 24h millisecond add lands on
      // the 28th or the 30th here depending on the zone.
      expect(dayKey(addDays(new Date(2026, 2, 29), 1))).toBe('2026-03-30');
      expect(dayKey(addDays(new Date(2026, 9, 25), 1))).toBe('2026-10-26');
    });

    it('crosses month and year boundaries in both directions', () => {
      expect(dayKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
      expect(dayKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
    });

    it('carries the clock time', () => {
      const result = addDays(new Date(2026, 7, 14, 15, 20, 30, 400), 3);
      expect(result.getHours()).toBe(15);
      expect(result.getMilliseconds()).toBe(400);
    });
  });

  describe('daysInMonth', () => {
    it('reads the length of the date\'s own month', () => {
      expect(daysInMonth(new Date(2026, 0, 15))).toBe(31);
      expect(daysInMonth(new Date(2026, 1, 15))).toBe(28);
      expect(daysInMonth(new Date(2028, 1, 15))).toBe(29);
      expect(daysInMonth(new Date(2026, 3, 15))).toBe(30);
    });
  });

  describe('monthWindow', () => {
    it('brackets the month around a date', () => {
      const { start, end } = monthWindow(new Date(2026, 1, 17, 13, 45));
      expect(start.getTime()).toBe(new Date(2026, 1, 1).getTime());
      expect(end.getTime()).toBe(new Date(2026, 1, 28, 23, 59, 59, 999).getTime());
    });

    it('accepts parsed month-key parts', () => {
      const { start, end } = monthWindow({ year: 2026, month: 7 });
      expect(dayKey(start)).toBe('2026-08-01');
      expect(dayKey(end)).toBe('2026-08-31');
    });

    it('normalises a month outside 0-11 the way the Date constructor does', () => {
      expect(dayKey(monthWindow({ year: 2026, month: -1 }).start)).toBe('2025-12-01');
      expect(dayKey(monthWindow({ year: 2026, month: 12 }).start)).toBe('2027-01-01');
    });

    it('ends on the last millisecond so a late-evening row is inside', () => {
      const { end } = monthWindow(new Date(2026, 7, 3));
      expect(end.getTime()).toBe(new Date(2026, 7, 31, 23, 59, 59, 999).getTime());
    });
  });

  describe('yearWindow', () => {
    it('spans January 1st to the last millisecond of December 31st', () => {
      const { start, end } = yearWindow(2026);
      expect(start.getTime()).toBe(new Date(2026, 0, 1).getTime());
      expect(end.getTime()).toBe(new Date(2026, 11, 31, 23, 59, 59, 999).getTime());
    });
  });

  describe('weekWindow', () => {
    it('runs Monday to Sunday', () => {
      // 2026-08-05 is a Wednesday.
      const { start, end } = weekWindow(new Date(2026, 7, 5, 9, 0));
      expect(dayKey(start)).toBe('2026-08-03');
      expect(dayKey(end)).toBe('2026-08-09');
      expect(end.getTime()).toBe(new Date(2026, 7, 9, 23, 59, 59, 999).getTime());
    });

    it('keeps Sunday in the week that opened on the preceding Monday', () => {
      expect(dayKey(weekWindow(new Date(2026, 7, 9)).start)).toBe('2026-08-03');
    });

    it('starts on the Monday itself', () => {
      expect(dayKey(weekWindow(new Date(2026, 7, 3)).start)).toBe('2026-08-03');
    });
  });

  describe('periodWindow', () => {
    const now = new Date(2026, 7, 10, 14, 30);

    it('gives the quick ranges whole calendar bounds', () => {
      expect(periodWindow('thisMonth', now)).toEqual(
        { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999) });
      expect(periodWindow('lastMonth', now)).toEqual(
        { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59, 999) });
      expect(periodWindow('last3Months', now)).toEqual(
        { start: new Date(2026, 5, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999) });
      expect(periodWindow('thisYear', now)).toEqual(
        { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31, 23, 59, 59, 999) });
    });

    it('resolves a custom month and a custom year', () => {
      expect(periodWindow('custom', now, { type: 'month', year: 2025, month: 1 })).toEqual(
        { start: new Date(2025, 1, 1), end: new Date(2025, 1, 28, 23, 59, 59, 999) });
      expect(periodWindow('custom', now, { type: 'year', year: 2024 })).toEqual(
        { start: new Date(2024, 0, 1), end: new Date(2024, 11, 31, 23, 59, 59, 999) });
    });

    it('falls back to the current month when custom has nothing selected', () => {
      expect(periodWindow('custom', now, null)).toEqual(periodWindow('thisMonth', now));
    });

    it('rolls the year back for a quick range that reaches into last year', () => {
      const january = new Date(2026, 0, 15);
      expect(dayKey(periodWindow('lastMonth', january).start)).toBe('2025-12-01');
      expect(dayKey(periodWindow('last3Months', january).start)).toBe('2025-11-01');
    });

    it('never lands outside the named month when today is a month end', () => {
      // The classic overflow: reading "last month" from 31 March.
      const march31 = new Date(2026, 2, 31, 9, 0);
      expect(monthKey(periodWindow('lastMonth', march31).start)).toBe('2026-02');
      expect(monthKey(periodWindow('lastMonth', march31).end)).toBe('2026-02');
    });
  });

  describe('clampWindowToNow', () => {
    it('cuts a running period back to the end of today', () => {
      const now = new Date(2026, 7, 10, 14, 30);
      const clamped = clampWindowToNow(periodWindow('thisMonth', now), now);
      expect(clamped.start.getTime()).toBe(new Date(2026, 7, 1).getTime());
      expect(clamped.end.getTime()).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).getTime());
    });

    it('leaves a window that already closed alone', () => {
      const now = new Date(2026, 7, 10, 14, 30);
      const past = periodWindow('custom', now, { type: 'month', year: 2025, month: 3 });
      expect(clampWindowToNow(past, now)).toEqual(past);
    });
  });

  describe('previousPeriodWindow', () => {
    function selection(option: PeriodOption, start: Date, end: Date): PeriodSelection {
      return { option, start, end, label: '' };
    }

    const now = new Date(2026, 7, 10, 14, 30);

    it('compares a complete past month with the month before it', () => {
      const previous = previousPeriodWindow(
        selection('lastMonth', ...windowArgs(periodWindow('lastMonth', now))), now)!;
      expect(previous.start.getTime()).toBe(new Date(2026, 5, 1).getTime());
      expect(previous.end.getTime()).toBe(new Date(2026, 5, 30, 23, 59, 59, 999).getTime());
    });

    it('compares a custom year with the whole year before it', () => {
      const previous = previousPeriodWindow(
        selection('custom', new Date(2025, 0, 1), new Date(2025, 11, 31, 23, 59, 59, 999)),
        now)!;
      expect(previous.start.getTime()).toBe(new Date(2024, 0, 1).getTime());
      expect(previous.end.getTime()).toBe(new Date(2024, 11, 31, 23, 59, 59, 999).getTime());
    });

    it('compares a custom month with the month before it', () => {
      const previous = previousPeriodWindow(
        selection('custom', new Date(2025, 0, 1), new Date(2025, 0, 31, 23, 59, 59, 999)),
        now)!;
      expect(previous.start.getTime()).toBe(new Date(2024, 11, 1).getTime());
      expect(previous.end.getTime()).toBe(new Date(2024, 11, 31, 23, 59, 59, 999).getTime());
    });

    it('truncates the three-month and year comparisons the same way', () => {
      const threeMonths = previousPeriodWindow(
        selection('last3Months', ...windowArgs(periodWindow('last3Months', now))), now)!;
      expect(threeMonths.start.getTime()).toBe(new Date(2026, 2, 1).getTime());
      expect(threeMonths.end.getTime()).toBe(new Date(2026, 4, 10, 23, 59, 59, 999).getTime());

      const year = previousPeriodWindow(
        selection('thisYear', ...windowArgs(periodWindow('thisYear', now))), now)!;
      expect(year.start.getTime()).toBe(new Date(2025, 0, 1).getTime());
      expect(year.end.getTime()).toBe(new Date(2025, 7, 10, 23, 59, 59, 999).getTime());
    });
  });

  describe('budgetPeriodWindow', () => {
    it('anchors a weekly period on the start date\'s weekday', () => {
      // 2026-08-04 is a Tuesday; "today" is the Friday of that week.
      const { start, end } = budgetPeriodWindow(
        'weekly', new Date(2026, 7, 4), new Date(2026, 7, 7, 11, 0));
      expect(dayKey(start)).toBe('2026-08-04');
      expect(end.getTime()).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).getTime());
    });

    it('anchors a monthly period on the start date\'s day of month', () => {
      const { start, end } = budgetPeriodWindow(
        'monthly', new Date(2026, 0, 15), new Date(2026, 7, 20, 11, 0));
      expect(start.getTime()).toBe(new Date(2026, 7, 15).getTime());
      expect(end.getTime()).toBe(new Date(2026, 8, 14, 23, 59, 59, 999).getTime());
    });

    it('rolls back to the previous month before the anchor day arrives', () => {
      const { start, end } = budgetPeriodWindow(
        'monthly', new Date(2026, 0, 15), new Date(2026, 7, 3, 11, 0));
      expect(start.getTime()).toBe(new Date(2026, 6, 15).getTime());
      expect(end.getTime()).toBe(new Date(2026, 7, 14, 23, 59, 59, 999).getTime());
    });

    it('anchors a yearly period on the start date\'s month and day', () => {
      const { start, end } = budgetPeriodWindow(
        'yearly', new Date(2020, 2, 5), new Date(2026, 7, 20, 11, 0));
      expect(start.getTime()).toBe(new Date(2026, 2, 5).getTime());
      expect(end.getTime()).toBe(new Date(2027, 2, 4, 23, 59, 59, 999).getTime());
    });

    it('rolls a yearly period back before its anchor arrives', () => {
      const { start } = budgetPeriodWindow(
        'yearly', new Date(2020, 8, 5), new Date(2026, 7, 20, 11, 0));
      expect(start.getTime()).toBe(new Date(2025, 8, 5).getTime());
    });

    it('leaves no gap between consecutive periods, whatever the anchor', () => {
      for (const anchorDay of [1, 15, 28, 29, 30, 31]) {
        const anchor = new Date(2026, 0, anchorDay);
        for (let day = 1; day <= 28; day += 1) {
          const today = new Date(2026, 1, day, 12, 0);
          const { start, end } = budgetPeriodWindow('monthly', anchor, today);
          expect(start.getTime()).toBeLessThanOrEqual(today.getTime());
          expect(end.getTime()).toBeGreaterThanOrEqual(today.getTime());
        }
      }
    });
  });

  describe('defaultBudgetStart', () => {
    const now = new Date(2026, 7, 12, 16, 45, 30, 250);

    it('opens a weekly budget on the Sunday of the current week, at midnight', () => {
      // 2026-08-12 is a Wednesday.
      expect(dayKey(defaultBudgetStart('weekly', now))).toBe('2026-08-09');
      expect(defaultBudgetStart('weekly', now).getHours()).toBe(0);
    });

    it('opens monthly and yearly budgets on the first of the month and year', () => {
      expect(defaultBudgetStart('monthly', now).getTime()).toBe(new Date(2026, 7, 1).getTime());
      expect(defaultBudgetStart('yearly', now).getTime()).toBe(new Date(2026, 0, 1).getTime());
    });

    it('does not mutate the clock it was given', () => {
      const clock = new Date(2026, 7, 12, 16, 45, 30, 250);
      const before = clock.getTime();
      defaultBudgetStart('weekly', clock);
      defaultBudgetStart('monthly', clock);
      defaultBudgetStart('yearly', clock);
      expect(clock.getTime()).toBe(before);
    });
  });

  describe('isoWeekNumber / budgetPeriodKey', () => {
    it('numbers the week the ISO 8601 way', () => {
      // 2026-01-01 is a Thursday, so it belongs to week 1 of 2026.
      expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
      // 2027-01-01 is a Friday, so it belongs to the last week of 2026.
      expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
      expect(isoWeekNumber(new Date(2026, 7, 10))).toBe(33);
    });

    it('labels each budget period by its kind', () => {
      const date = new Date(2026, 7, 10);
      expect(budgetPeriodKey(date, 'weekly')).toBe('2026-W33');
      expect(budgetPeriodKey(date, 'monthly')).toBe('2026-08');
      expect(budgetPeriodKey(date, 'yearly')).toBe('2026');
    });

    it('leaves a single-digit week number unpadded', () => {
      // Pinned rather than endorsed: the label is display-only and predates
      // this module, and padding it would silently change what budget
      // summaries render. docs/dates.md lists it under Known gaps.
      expect(budgetPeriodKey(new Date(2026, 0, 26), 'weekly')).toBe('2026-W5');
    });
  });

  /**
   * One spec per bug that was fixed in a private copy of this arithmetic. They
   * belong here rather than beside their callers because the point of the
   * consolidation is that there is now one implementation to regress.
   */
  describe('regressions', () => {
    it('regression #171: a monthly budget anchored on the 31st still owns the last day of a short month', () => {
      const anchor = new Date(2026, 0, 31);

      const shortMonthEnd = budgetPeriodWindow('monthly', anchor, new Date(2026, 1, 28, 12, 0));
      expect(shortMonthEnd.start.getTime()).toBe(new Date(2026, 1, 28).getTime());
      expect(shortMonthEnd.end.getTime()).toBe(new Date(2026, 2, 30, 23, 59, 59, 999).getTime());

      const dayBefore = budgetPeriodWindow('monthly', anchor, new Date(2026, 1, 27, 12, 0));
      expect(dayBefore.start.getTime()).toBe(new Date(2026, 0, 31).getTime());
      expect(dayBefore.end.getTime()).toBe(new Date(2026, 1, 27, 23, 59, 59, 999).getTime());

      // Every day belongs to exactly one period: N+1 opens 1 ms after N closes.
      expect(shortMonthEnd.start.getTime()).toBe(dayBefore.end.getTime() + 1);
    });

    it('regression #173: a running period compares against the same elapsed span of the previous one', () => {
      const now = new Date(2026, 7, 10, 14, 30);
      const running = periodWindow('thisMonth', now);
      const current = clampWindowToNow(running, now);
      const previous = previousPeriodWindow(
        { option: 'thisMonth', start: running.start, end: running.end, label: '' }, now)!;

      expect(wholeDaysBetween(previous.start, previous.end))
        .toBe(wholeDaysBetween(current.start, current.end));
      expect(previous.end.getTime()).toBe(new Date(2026, 6, 10, 23, 59, 59, 999).getTime());
    });

    it('regression #167: shifting a month-end window never rolls past the target month', () => {
      // 31 Jan + 1 month is 28 Feb, not 3 March: the day has to be clamped
      // against the month actually landed in.
      expect(monthKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02');

      // The same overflow reached the previous-period comparison, which shifts
      // the clamped end of a running window back a whole number of months.
      const now = new Date(2026, 2, 31, 14, 30);
      const running = periodWindow('thisMonth', now);
      const previous = previousPeriodWindow(
        { option: 'thisMonth', start: running.start, end: running.end, label: '' }, now)!;
      expect(monthKey(previous.start)).toBe('2026-02');
      expect(monthKey(previous.end)).toBe('2026-02');
      expect(dayKey(previous.end)).toBe('2026-02-28');
    });

    it('regression #174: a month key window opens at local midnight west of utc', () => {
      // `new Date('2026-08-01')` is UTC midnight by language spec, which is
      // 31 July in any negative-offset zone. Every window is built from local
      // parts instead, so the key names the month the user sees.
      const parsed = parseMonthKey('2026-08')!;
      const { start, end } = monthWindow(parsed);

      expect(start.getTime()).toBe(new Date(2026, 7, 1).getTime());
      expect(start.getHours()).toBe(0);
      expect(dayKey(start)).toBe('2026-08-01');
      expect(dayKey(end)).toBe('2026-08-31');
      expect(monthKey(start)).toBe('2026-08');
      expect(monthKey(end)).toBe('2026-08');
    });
  });
});

/** Spreads a window into the (start, end) pair a `PeriodSelection` carries. */
function windowArgs(window: { start: Date; end: Date }): [Date, Date] {
  return [window.start, window.end];
}
