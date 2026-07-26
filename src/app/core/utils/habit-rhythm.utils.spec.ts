import { computeHabitRhythms } from './habit-rhythm.utils';
import { DetectorWindow } from './spending-pattern.types';
import { Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';

/**
 * Dates are built from local parts throughout. `new Date('2026-01-03')` parses
 * as UTC and would shift to Friday the 2nd in a negative-offset zone, making
 * every weekday assertion below depend on where the suite runs.
 */
describe('habit-rhythm.utils', () => {
  const toBase = (t: Transaction) => t.amount;

  /** January 2026: 31 days starting on a Thursday, 22 weekdays and 9 weekend days. */
  const january: DetectorWindow = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 31, 23, 59, 59, 999),
  };

  function expense(day: number, amount: number, month = 0): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      date: createTimestamp(new Date(2026, month, day)),
    });
  }

  function income(day: number, amount: number, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'income',
      amount,
      categoryId: 'employment_salary',
      date: createTimestamp(new Date(2026, 0, day)),
      ...overrides,
    });
  }

  /** One expense on every day of January, at a flat amount. */
  function everyDay(amount: number): Transaction[] {
    return Array.from({ length: 31 }, (_, i) => expense(i + 1, amount));
  }

  describe('the data gate', () => {
    it('reports hasEnoughData false below the minimum', () => {
      const result = computeHabitRhythms(
        Array.from({ length: 19 }, (_, i) => expense(i + 1, 10)), [], toBase, january);
      expect(result.hasEnoughData).toBeFalse();
      expect(result.transactionCount).toBe(19);
      expect(result.weekdayWeekend.lean).toBe('even');
      expect(result.monthEnd.isSpike).toBeFalse();
      expect(result.payday.isPresent).toBeFalse();
    });

    it('reports hasEnoughData true at the minimum', () => {
      const result = computeHabitRhythms(
        Array.from({ length: 20 }, (_, i) => expense(i + 1, 10)), [], toBase, january);
      expect(result.hasEnoughData).toBeTrue();
      expect(result.transactionCount).toBe(20);
    });

    it('ignores transactions outside the window', () => {
      const result = computeHabitRhythms(
        [...everyDay(10), expense(15, 999, 5)], [], toBase, january);
      expect(result.transactionCount).toBe(31);
    });
  });

  describe('weekday against weekend', () => {
    it('does NOT call a higher weekday total a weekday lean', () => {
      // This is the headline case. January has 22 weekdays to 9 weekend days,
      // so a flat spender racks up a far bigger weekday *total* while spending
      // exactly the same per day. Comparing totals would tell essentially every
      // user they spend more on weekdays.
      const result = computeHabitRhythms(everyDay(10), [], toBase, january);

      expect(result.weekdayWeekend.weekdayTotal).toBe(220);
      expect(result.weekdayWeekend.weekendTotal).toBe(90);
      expect(result.weekdayWeekend.weekdayTotal)
        .toBeGreaterThan(result.weekdayWeekend.weekendTotal);

      expect(result.weekdayWeekend.weekdayDailyAverage).toBe(10);
      expect(result.weekdayWeekend.weekendDailyAverage).toBe(10);
      expect(result.weekdayWeekend.ratio).toBe(1);
      expect(result.weekdayWeekend.lean).toBe('even');
    });

    it('carries the day counts that make the averages meaningful', () => {
      const result = computeHabitRhythms(everyDay(10), [], toBase, january);
      expect(result.weekdayWeekend.weekdayDays).toBe(22);
      expect(result.weekdayWeekend.weekendDays).toBe(9);
    });

    it('detects a genuine weekend lean', () => {
      // Same per-day spend on weekdays, triple on weekend days.
      const transactions = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        const dow = new Date(2026, 0, day).getDay();
        return expense(day, dow === 0 || dow === 6 ? 30 : 10);
      });
      const result = computeHabitRhythms(transactions, [], toBase, january);
      expect(result.weekdayWeekend.ratio).toBe(3);
      expect(result.weekdayWeekend.lean).toBe('weekend');
    });

    it('detects a genuine weekday lean', () => {
      const transactions = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        const dow = new Date(2026, 0, day).getDay();
        return expense(day, dow === 0 || dow === 6 ? 5 : 20);
      });
      const result = computeHabitRhythms(transactions, [], toBase, january);
      expect(result.weekdayWeekend.ratio).toBe(0.25);
      expect(result.weekdayWeekend.lean).toBe('weekday');
    });

    it('stays even inside the lean threshold', () => {
      // 11 vs 10 per day is a 10% difference, under the 20% threshold.
      const transactions = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        const dow = new Date(2026, 0, day).getDay();
        return expense(day, dow === 0 || dow === 6 ? 11 : 10);
      });
      expect(computeHabitRhythms(transactions, [], toBase, january).weekdayWeekend.lean)
        .toBe('even');
    });

    it('honours an overridden weekend definition', () => {
      const result = computeHabitRhythms(
        everyDay(10), [], toBase, january, { weekendDays: [1] });
      expect(result.weekdayWeekend.weekendDays).toBe(4);   // four Mondays
      expect(result.weekdayWeekend.weekdayDays).toBe(27);
    });
  });

  describe('month-end spike', () => {
    it('does NOT call a flat spender a month-end spike', () => {
      // 5 tail days against 26 others: the tail total is far smaller while the
      // per-day rate is identical.
      const result = computeHabitRhythms(everyDay(10), [], toBase, january);
      expect(result.monthEnd.tailTotal).toBeLessThan(result.monthEnd.restTotal);
      expect(result.monthEnd.tailDailyAverage).toBe(10);
      expect(result.monthEnd.restDailyAverage).toBe(10);
      expect(result.monthEnd.ratio).toBe(1);
      expect(result.monthEnd.isSpike).toBeFalse();
    });

    it('detects a real spike across several months', () => {
      // Jan-Mar, spending five times as much per day in each month's last five
      // days. Fifteen tail days clears the six-sample floor.
      const quarter: DetectorWindow = {
        start: new Date(2026, 0, 1),
        end: new Date(2026, 2, 31, 23, 59, 59, 999),
      };
      const transactions = [0, 1, 2].flatMap(month => {
        const daysInMonth = new Date(2026, month + 1, 0).getDate();
        return Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          return expense(day, day > daysInMonth - 5 ? 50 : 10, month);
        });
      });
      const result = computeHabitRhythms(transactions, [], toBase, quarter);
      expect(result.monthEnd.tailCount).toBe(15);
      expect(result.monthEnd.ratio).toBe(5);
      expect(result.monthEnd.isSpike).toBeTrue();
    });

    it('will not claim a spike from a single month-end', () => {
      // A month has only five tail days, so one month can never reach the
      // six-sample floor — one month-end is an event, not a pattern.
      const transactions = Array.from({ length: 31 }, (_, i) =>
        expense(i + 1, i + 1 > 26 ? 50 : 10));
      const result = computeHabitRhythms(transactions, [], toBase, january);
      expect(result.monthEnd.tailCount).toBe(5);
      expect(result.monthEnd.ratio).toBe(5);
      expect(result.monthEnd.isSpike).toBeFalse();
    });

    it('needs enough tail samples before claiming a spike', () => {
      // Only two tail days have any activity, so one big weekend cannot pass.
      const transactions = [
        ...Array.from({ length: 26 }, (_, i) => expense(i + 1, 10)),
        expense(30, 500),
        expense(31, 500),
      ];
      const result = computeHabitRhythms(transactions, [], toBase, january);
      expect(result.monthEnd.tailCount).toBe(2);
      expect(result.monthEnd.isSpike).toBeFalse();
    });

    it('shortens the tail with a 28-day February', () => {
      const february: DetectorWindow = {
        start: new Date(2026, 1, 1),
        end: new Date(2026, 1, 28, 23, 59, 59, 999),
      };
      const transactions = Array.from({ length: 28 }, (_, i) => expense(i + 1, 10, 1));
      const result = computeHabitRhythms(transactions, [], toBase, february);
      // 24th-28th is the tail of a 28-day month.
      expect(result.monthEnd.tailCount).toBe(5);
      expect(result.monthEnd.restCount).toBe(23);
    });

    it('collects the tail transaction ids for the inline drill-down', () => {
      const transactions = Array.from({ length: 31 }, (_, i) =>
        expense(i + 1, i + 1 > 26 ? 50 : 10));
      const result = computeHabitRhythms(transactions, [], toBase, january);
      expect(result.monthEnd.transactionIds.length).toBe(5);
    });
  });

  describe('payday effect', () => {
    it('falls back to none without income', () => {
      const result = computeHabitRhythms(everyDay(10), [], toBase, january);
      expect(result.payday.basis).toBe('none');
      expect(result.payday.paydayDayOfMonth).toBeNull();
      expect(result.payday.isPresent).toBeFalse();
    });

    it('prefers a declared recurring income date', () => {
      const incomes = [
        income(25, 3000, { recurringId: 'salary' }),
        income(25, 3000, { recurringId: 'salary' }),
        income(3, 50),
      ];
      const result = computeHabitRhythms(everyDay(10), incomes, toBase, january);
      expect(result.payday.basis).toBe('recurringIncome');
      expect(result.payday.paydayDayOfMonth).toBe(25);
    });

    it('infers a payday from clustered income dates', () => {
      const incomes = [income(15, 3000), income(15, 3000), income(16, 3000)];
      const result = computeHabitRhythms(everyDay(10), incomes, toBase, january);
      expect(result.payday.basis).toBe('incomeDates');
      expect(result.payday.paydayDayOfMonth).toBe(15);
    });

    it('refuses to infer a payday from scattered income', () => {
      const incomes = [income(2, 100), income(11, 100), income(23, 100)];
      const result = computeHabitRhythms(everyDay(10), incomes, toBase, january);
      expect(result.payday.basis).toBe('none');
    });

    it('needs three income transactions before inferring', () => {
      const incomes = [income(15, 3000), income(15, 3000)];
      expect(computeHabitRhythms(everyDay(10), incomes, toBase, january).payday.basis)
        .toBe('none');
    });

    it('detects a post-payday burst', () => {
      const incomes = [
        income(10, 3000, { recurringId: 'salary' }),
        income(10, 3000, { recurringId: 'salary' }),
      ];
      // Days 10-12 are the post-payday window.
      const transactions = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        return expense(day, day >= 10 && day <= 12 ? 100 : 10);
      });
      const result = computeHabitRhythms(transactions, incomes, toBase, january);
      expect(result.payday.postPaydayCount).toBe(3);
      expect(result.payday.ratio).toBe(10);
      expect(result.payday.isPresent).toBeFalse();  // only 3 samples, needs 5
    });

    it('needs enough post-payday samples to claim the effect', () => {
      const incomes = [
        income(10, 3000, { recurringId: 'salary' }),
        income(10, 3000, { recurringId: 'salary' }),
      ];
      const twoMonths: DetectorWindow = {
        start: new Date(2026, 0, 1),
        end: new Date(2026, 1, 28, 23, 59, 59, 999),
      };
      const transactions = [
        ...Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          return expense(day, day >= 10 && day <= 12 ? 100 : 10);
        }),
        ...Array.from({ length: 28 }, (_, i) => {
          const day = i + 1;
          return expense(day, day >= 10 && day <= 12 ? 100 : 10, 1);
        }),
      ];
      const result = computeHabitRhythms(transactions, incomes, toBase, twoMonths);
      expect(result.payday.postPaydayCount).toBe(6);
      expect(result.payday.isPresent).toBeTrue();
    });

    it('does not key the payday on a salary category id', () => {
      // Category ids are user-extensible, so the basis must come from the dates.
      const incomes = [
        income(25, 3000, { categoryId: 'freelance_invoices', recurringId: 'r' }),
        income(25, 3000, { categoryId: 'freelance_invoices', recurringId: 'r' }),
      ];
      const result = computeHabitRhythms(everyDay(10), incomes, toBase, january);
      expect(result.payday.paydayDayOfMonth).toBe(25);
    });
  });

  describe('determinism', () => {
    it('produces identical output for shuffled input', () => {
      const transactions = Array.from({ length: 31 }, (_, i) =>
        expense(i + 1, (i % 5) * 7 + 3));
      const incomes = [
        income(25, 3000, { recurringId: 'salary' }),
        income(25, 3000, { recurringId: 'salary' }),
      ];
      const forward = computeHabitRhythms(transactions, incomes, toBase, january);
      const reversed = computeHabitRhythms(
        [...transactions].reverse(), [...incomes].reverse(), toBase, january);
      expect(reversed).toEqual(forward);
    });

    it('never returns a value Firestore would reject', () => {
      const result = computeHabitRhythms(everyDay(10), [], toBase, january);
      const ratios = [
        result.weekdayWeekend.ratio, result.monthEnd.ratio, result.payday.ratio,
      ];
      for (const ratio of ratios) {
        expect(ratio === null || Number.isFinite(ratio)).toBeTrue();
      }
    });
  });
});
