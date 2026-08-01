import { Timestamp } from '@angular/fire/firestore';
import { Transaction } from '../../models';

/**
 * How this app reads and writes a local date.
 *
 * Four things here are load-bearing rather than conveniences:
 *
 * 1. `dateOf` is the single coercion for a transaction's date. Persisted rows
 *    carry a Firestore Timestamp, while specs and DTOs pass a plain Date, and
 *    before this file that duck-typing was copy-pasted in seven places.
 *
 * 2. `wholeDaysBetween` normalises to UTC midnight before subtracting. A local
 *    millisecond diff spans 23 or 25 hours across a DST transition, which turns
 *    a monthly subscription cadence into 29.96 days and breaks the detectors'
 *    interval classification.
 *
 * 3. `parseDayKey` is the inverse of `dayKey`, and the reason it exists is that
 *    `new Date('2026-08-01')` is UTC midnight by language spec. West of UTC that
 *    is the previous day, so a receipt dated the 1st filed into the previous
 *    month's budget, comparison and snapshot. Every date-only string arriving
 *    from a model, a CSV or a queued row goes through `parseDateInput`.
 *
 * 4. `dateAtClampedDay` clamps the day to the target month's length. Shifting a
 *    Date's month first and clamping after cannot work: 31 Jan + 1 month
 *    overflows to 3 Mar before anything reads February's length.
 *
 * Everything reads *local* date parts, so day-of-week and day-of-month results
 * are a function of the runtime's IANA zone. Callers that persist those results
 * must record the zone alongside them.
 */

/** Milliseconds in a day. Safe as a constant only for UTC-normalised diffs. */
const MS_PER_DAY = 86_400_000;

/** Saturday and Sunday, the weekend in all three shipped locales (en/ja/tc). */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [0, 6];

/** Coerce a Firestore Timestamp, a Date, or junk into a Date. */
export function toDate(value: Timestamp | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const converted = (value as Timestamp | null | undefined)?.toDate?.();
  return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
}

/**
 * A transaction's date. Returns the epoch on unreadable input rather than
 * throwing, so one corrupt row cannot take down a whole detector pass.
 */
export function dateOf(transaction: Pick<Transaction, 'date'>): Date {
  return toDate(transaction.date) ?? new Date(0);
}

/** `yyyy-MM` from local parts. Sorts lexicographically == chronologically. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `yyyy-MM-dd` from local parts. */
export function dayKey(date: Date): string {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse `yyyy-MM`. `month` is 0-11 to match Date. Null on anything else. */
export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

/**
 * Local midnight at these parts, or null when they are not a real calendar
 * date. `month` is 0-11 to match Date and `parseMonthKey`.
 *
 * The round-trip check is the point: `new Date(2026, 1, 31)` silently becomes
 * 3 March, so callers reading day and month off untrusted input need to be told
 * that 31 February was never a date rather than handed one in the wrong month.
 */
export function localDateFromParts(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * The anchors are load-bearing. An unanchored pattern also matches inside
 * `2026-08-01T10:30:00Z`, which would truncate a full instant to a date.
 */
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strict `yyyy-MM-dd` to local midnight — the exact inverse of `dayKey`. Null on
 * anything else, including a rollover like `2026-02-31`.
 */
export function parseDayKey(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = DAY_KEY_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  return localDateFromParts(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * A Date from untrusted input: a model's JSON, a bank CSV cell, a queued row, a
 * restored backup.
 *
 * A date-only `yyyy-MM-dd` is read as LOCAL midnight, because that is what the
 * receipt meant. Every other shape keeps the platform's own parsing, so a full
 * ISO instant still means the instant it names and `06/15/2024` still reads the
 * way the browser has always read it. Null when unreadable.
 *
 * A string of the right shape but the wrong value — `2026-02-31` — is null
 * rather than falling through, because the platform does not reject it either:
 * `new Date('2026-02-31')` is 3 March in V8. Having recognised the format, a
 * date that does not exist is better reported than quietly moved to a month the
 * receipt never named.
 */
export function parseDateInput(value: unknown): Date | null {
  if (typeof value === 'string' && DAY_KEY_PATTERN.test(value.trim())) {
    return parseDayKey(value);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Local midnight on the first of the month. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Last millisecond of the month, matching the range queries in TransactionService. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Local date at these parts with `day` clamped down to the target month's
 * length, carrying `time`'s clock time. `month` is 0-11 and normalises outside
 * that range the way the Date constructor does, so month 12 is next January.
 *
 * Clamping has to happen against the month actually landed in. Mutating a Date
 * — `setMonth` then `setDate` — reads the length of whatever month the overflow
 * spilled into, which is how a rule on the 31st came to skip every short month.
 */
export function dateAtClampedDay(year: number, month: number, day: number, time: Date): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(
    year,
    month,
    Math.min(day, lastDay),
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
    time.getMilliseconds(),
  );
}

/**
 * Shift by whole months, clamping the day to the target month's length so
 * addMonths(Jan 31, 1) is Feb 28/29 rather than rolling into March.
 */
export function addMonths(date: Date, months: number): Date {
  return dateAtClampedDay(date.getFullYear(), date.getMonth() + months, date.getDate(), date);
}

/**
 * Never let a window claim to cover the future: a period selection running to
 * the end of the current month would otherwise report a partial month as whole.
 */
export function clampToEndOfToday(end: Date, now: Date): Date {
  const endOfToday = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return end < endOfToday ? end : endOfToday;
}

/** Every `yyyy-MM` from `start` to `end`, inclusive at both ends, ascending. */
export function monthKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const last = startOfMonth(end).getTime();
  let cursor = startOfMonth(start);
  while (cursor.getTime() <= last) {
    keys.push(monthKey(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return keys;
}

/**
 * Whole days from `a` to `b`, signed. Both are normalised to UTC midnight from
 * their *local* parts first, so the result is an exact integer regardless of
 * DST transitions between them.
 */
export function wholeDaysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / MS_PER_DAY);
}

export function isWeekend(
  date: Date,
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
): boolean {
  return weekendDays.includes(date.getDay());
}

/**
 * Calendar days of each kind in an inclusive window.
 *
 * Detectors need this because a month holds roughly 22 weekdays to 8 weekend
 * days: comparing weekday and weekend *totals* would report "you spend more on
 * weekdays" for essentially every user. Dividing by these counts is what makes
 * the comparison mean anything.
 */
export function countDaysByKind(
  start: Date,
  end: Date,
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
): { weekdayDays: number; weekendDays: number; totalDays: number } {
  const totalDays = wholeDaysBetween(start, end) + 1;
  if (totalDays <= 0) {
    return { weekdayDays: 0, weekendDays: 0, totalDays: 0 };
  }

  let weekend = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < totalDays; i += 1) {
    if (isWeekend(cursor, weekendDays)) {
      weekend += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { weekdayDays: totalDays - weekend, weekendDays: weekend, totalDays };
}

/** True when the date falls in the final `tailDays` days of its own month. */
export function isLastDaysOfMonth(date: Date, tailDays: number): boolean {
  if (tailDays <= 0) {
    return false;
  }
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() > daysInMonth - tailDays;
}
