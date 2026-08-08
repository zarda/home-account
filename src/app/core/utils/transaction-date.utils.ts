import { Timestamp } from '@angular/fire/firestore';
import {
  BudgetPeriod,
  CustomPeriod,
  PeriodOption,
  PeriodSelection,
  Transaction,
} from '../../models';

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
 *
 * The second half of the file builds windows out of those primitives — the
 * selector's named periods, the dashboard's comparison window, the budget
 * anchoring. Every one of those was hand-rolled in its own caller, and each of
 * #167, #171, #173 and #174 was a defect in one of those private copies rather
 * than in anything here. They live together now so there is one implementation
 * to regress rather than four to keep in step.
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

/** Local midnight on this date. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Last millisecond of this local day. Every window in the app closes here, so
 * a transaction posted at 23:59:59.700 is inside the day it was posted on.
 */
export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/**
 * Shift by whole calendar days, keeping the clock time.
 *
 * Adding 86_400_000 ms instead lands an hour out on either side of a DST
 * transition, which is enough to move a date to the neighbouring day and put a
 * row in the wrong window. Rebuilding from local parts cannot.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

/** Length of this date's own month, 28-31. */
export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
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
  const endOfToday = endOfDay(now);
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
  // Advanced in place rather than through addDays: this runs once per day of
  // the window, and setDate is a local-parts step like addDays is.
  const cursor = startOfDay(start);
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
  return date.getDate() > daysInMonth(date) - tailDays;
}

/**
 * An inclusive date range. Every window this module returns closes on the last
 * millisecond of its final day, so a `<=` Firestore comparison against a real
 * Timestamp keeps a row posted at 23:59:59.700 inside its own period.
 */
export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * The whole calendar month around a date, or at parsed `yyyy-MM` parts.
 *
 * Taking parts is what keeps month keys off `new Date('2026-08-01')`, which is
 * UTC midnight by language spec and therefore 31 July in any negative-offset
 * zone. `month` is 0-11 and normalises outside that range the way the Date
 * constructor does, so month -1 is last December.
 */
export function monthWindow(anchor: Date | { year: number; month: number }): DateWindow {
  const start = anchor instanceof Date
    ? startOfMonth(anchor)
    : new Date(anchor.year, anchor.month, 1);
  return { start, end: endOfMonth(start) };
}

/** The whole calendar year. */
export function yearWindow(year: number): DateWindow {
  return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
}

/**
 * The ISO week containing this date: Monday through Sunday.
 *
 * `getDay()` puts Sunday at 0, so the offset back to Monday is 6 there and
 * `day - 1` everywhere else — the arithmetic every quick filter got wrong at
 * least once.
 */
export function weekWindow(date: Date): DateWindow {
  const daysSinceMonday = date.getDay() === 0 ? 6 : date.getDay() - 1;
  const start = addDays(startOfDay(date), -daysSinceMonday);
  return { start, end: endOfDay(addDays(start, 6)) };
}

/**
 * The full calendar window a named period covers, with no regard for whether
 * it has finished — `thisMonth` in the first week of August still runs to
 * 31 August. Consumers with to-date semantics narrow it with
 * `clampWindowToNow`; this is the single origin of every period in the app.
 */
export function periodWindow(
  option: PeriodOption,
  now: Date,
  custom?: CustomPeriod | null,
): DateWindow {
  if (option === 'custom' && custom) {
    return custom.type === 'month'
      ? monthWindow({ year: custom.year, month: custom.month! })
      : yearWindow(custom.year);
  }

  const year = now.getFullYear();
  const month = now.getMonth();

  switch (option) {
    case 'lastMonth':
      return monthWindow({ year, month: month - 1 });
    case 'last3Months':
      return {
        start: monthWindow({ year, month: month - 2 }).start,
        end: monthWindow({ year, month }).end,
      };
    case 'thisYear':
      return yearWindow(year);
    default:
      // 'thisMonth', and 'custom' before anything has been picked.
      return monthWindow({ year, month });
  }
}

/** Narrow a window so it never claims to cover the future. */
export function clampWindowToNow(window: DateWindow, now: Date): DateWindow {
  return { start: window.start, end: clampToEndOfToday(window.end, now) };
}

/**
 * The window a selection is compared against on the dashboard.
 *
 * A period still running is clamped to end-of-today, so its comparison has to
 * be cut to the same elapsed span: part of a month against all of the previous
 * month reads as a large false decline for most of every month, and the
 * generated summary asserts it. Periods that have already closed keep their
 * whole calendar bounds.
 *
 * The shift back is `addMonths`, which clamps the day to the target month, so
 * a window clamped to 31 March compares against 28 February rather than
 * overflowing into March.
 */
export function previousPeriodWindow(
  selection: PeriodSelection,
  now: Date,
): DateWindow | null {
  const stillRunning = selection.end > now;
  const clampedEnd = clampToEndOfToday(selection.end, now);
  const truncated = (wholeEnd: Date, monthSpan: number): Date =>
    stillRunning ? addMonths(clampedEnd, -monthSpan) : wholeEnd;

  const year = now.getFullYear();
  const month = now.getMonth();

  switch (selection.option) {
    case 'thisMonth': {
      const previous = monthWindow({ year, month: month - 1 });
      return { start: previous.start, end: truncated(previous.end, 1) };
    }

    case 'lastMonth':
      // Already a closed period, so its predecessor is a whole month too.
      return monthWindow({ year, month: month - 2 });

    case 'last3Months':
      return {
        start: monthWindow({ year, month: month - 5 }).start,
        end: truncated(monthWindow({ year, month: month - 3 }).end, 3),
      };

    case 'thisYear': {
      const previous = yearWindow(year - 1);
      return { start: previous.start, end: truncated(previous.end, 12) };
    }

    case 'custom': {
      const { start, end } = selection;
      const isFullYear = start.getMonth() === 0 && start.getDate() === 1
        && end.getMonth() === 11 && end.getDate() === 31;
      if (isFullYear) {
        const previous = yearWindow(start.getFullYear() - 1);
        return { start: previous.start, end: truncated(previous.end, 12) };
      }
      const previous = monthWindow(
        { year: start.getFullYear(), month: start.getMonth() - 1 });
      return { start: previous.start, end: truncated(previous.end, 1) };
    }

    default:
      return null;
  }
}

/**
 * The budget period containing `now`, anchored on the budget's start date.
 *
 * Budgets do not run on calendar boundaries: a budget started on the 15th runs
 * the 15th to the 14th. The anchor day is clamped to the length of the month
 * being tested *before* it is compared against today, which is the whole of
 * #171 — comparing against a raw day 31 in February rolled the period back and
 * left the 28th belonging to no period at all, so spending that day counted
 * against nothing.
 *
 * The end is one millisecond before the next period opens rather than a
 * separately computed date, so consecutive periods cannot overlap or gap.
 */
export function budgetPeriodWindow(
  period: BudgetPeriod,
  anchor: Date,
  now: Date,
): DateWindow {
  switch (period) {
    case 'weekly': {
      const daysSinceAnchor = (now.getDay() - anchor.getDay() + 7) % 7;
      const start = addDays(startOfDay(now), -daysSinceAnchor);
      return { start, end: endOfDay(addDays(start, 6)) };
    }

    case 'monthly': {
      const anchorDay = anchor.getDate();
      // `now` here only donates a clock time that startOfDay discards; the
      // day itself comes from dateAtClampedDay, which is what keeps a day-31
      // anchor inside February.
      const beforeAnchor = now.getDate() < Math.min(anchorDay, daysInMonth(now));
      const month = beforeAnchor ? now.getMonth() - 1 : now.getMonth();
      const start = startOfDay(
        dateAtClampedDay(now.getFullYear(), month, anchorDay, now));
      const nextStart = startOfDay(
        dateAtClampedDay(now.getFullYear(), month + 1, anchorDay, now));
      return { start, end: new Date(nextStart.getTime() - 1) };
    }

    case 'yearly': {
      const anchorMonth = anchor.getMonth();
      const anchorDay = anchor.getDate();
      const year = now < new Date(now.getFullYear(), anchorMonth, anchorDay)
        ? now.getFullYear() - 1
        : now.getFullYear();
      const start = new Date(year, anchorMonth, anchorDay);
      return {
        start,
        end: new Date(new Date(year + 1, anchorMonth, anchorDay).getTime() - 1),
      };
    }
  }
}

/**
 * Where a budget's first period opens when the user did not pick a date.
 *
 * `now` is read, never written: the weekly arm used to advance the caller's own
 * Date with `setDate`, which is only harmless because nothing downstream read
 * it again.
 */
export function defaultBudgetStart(period: BudgetPeriod, now: Date): Date {
  switch (period) {
    case 'weekly':
      // Sunday-based, unlike weekWindow — this is the anchor the user can
      // still overwrite, not a reporting boundary.
      return addDays(startOfDay(now), -now.getDay());
    case 'monthly':
      return startOfMonth(now);
    case 'yearly':
      return yearWindow(now.getFullYear()).start;
  }
}

/**
 * ISO 8601 week number: weeks run Monday to Sunday, and week 1 is the one
 * holding the year's first Thursday. Computed in UTC so the shifting the
 * algorithm does cannot cross a DST boundary.
 */
export function isoWeekNumber(date: Date): number {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil((((thursday.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7);
}

/**
 * The label a budget summary carries for the period starting on this date.
 *
 * The weekly label is an ISO week number while the weekly *window* is anchored
 * on the budget's own weekday, so the two only line up for a budget that
 * started on a Monday. Kept as it was rather than corrected here; see the
 * Known gaps in docs/dates.md.
 */
export function budgetPeriodKey(date: Date, period: BudgetPeriod): string {
  switch (period) {
    case 'weekly':
      return `${date.getFullYear()}-W${isoWeekNumber(date)}`;
    case 'monthly':
      return monthKey(date);
    case 'yearly':
      return String(date.getFullYear());
  }
}
