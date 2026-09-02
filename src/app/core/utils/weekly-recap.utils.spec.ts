import {
  RECAP_NUDGE_HOUR,
  buildRecapContext,
  clearWeeklyRecapDeviceState,
  composeRecapFigures,
  hasSomethingToSay,
  nextRecapMoment,
  readDismissedRecapWeek,
  recapKey,
  recapKeyAnnouncedBy,
  recapWindow,
  weekBeforeWindow,
  weeklyRecapStorageKeys,
  writeDismissedRecapWeek,
} from './weekly-recap.utils';
import { dayKey } from './transaction-date.utils';
import { Transaction } from '../../models';
import { createTransaction } from '../services/testing/test-data';

/**
 * Dates are constructed from local parts throughout (`new Date(2026, 7, 5)`),
 * never parsed from an ISO string: `new Date('2026-08-05')` is UTC midnight by
 * language spec, so west of UTC every weekday assertion here would land on the
 * previous day. Run at three offsets by `npm run test:dates`.
 *
 * 2026-08-03 is a Monday, so the week of the 3rd runs to Sunday the 9th and
 * the two weeks before it are 27 July - 2 August and 20 - 26 July.
 */
describe('weekly-recap.utils', () => {
  const WEDNESDAY = new Date(2026, 7, 5, 14, 30);

  const toBase = (transaction: Transaction) => transaction.amountInBaseCurrency;

  function expense(
    amount: number,
    categoryId: string,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      amountInBaseCurrency: amount,
      categoryId,
      ...overrides,
    });
  }

  function income(amount: number): Transaction {
    return createTransaction({
      type: 'income',
      amount,
      amountInBaseCurrency: amount,
      categoryId: 'employment_salary',
    });
  }

  describe('recapWindow', () => {
    it('recaps the week that finished, from a mid-week date', () => {
      const { start, end } = recapWindow(WEDNESDAY);

      expect(start.getTime()).toBe(new Date(2026, 6, 27).getTime());
      expect(end.getTime()).toBe(new Date(2026, 7, 2, 23, 59, 59, 999).getTime());
    });

    it('does not count the week a Monday has only just opened', () => {
      expect(dayKey(recapWindow(new Date(2026, 7, 3, 0, 1)).start)).toBe('2026-07-27');
    });

    it('keeps a Sunday inside the week in progress, not the recapped one', () => {
      const { start, end } = recapWindow(new Date(2026, 7, 9, 23, 30));

      expect(dayKey(start)).toBe('2026-07-27');
      expect(dayKey(end)).toBe('2026-08-02');
    });

    // 8 March 2026 is a 23-hour day in the US zones; an hours-based shift
    // would close this window on the 7th.
    it('closes on the last millisecond of a Sunday that lost an hour', () => {
      const { end } = recapWindow(new Date(2026, 2, 11, 9));

      expect(dayKey(end)).toBe('2026-03-08');
      expect(end.getHours()).toBe(23);
    });
  });

  describe('weekBeforeWindow', () => {
    it('abuts the recapped week with no gap and no overlap', () => {
      const before = weekBeforeWindow(WEDNESDAY);

      expect(dayKey(before.start)).toBe('2026-07-20');
      expect(dayKey(before.end)).toBe('2026-07-26');
      expect(before.end.getTime() + 1).toBe(recapWindow(WEDNESDAY).start.getTime());
    });
  });

  describe('recapKey', () => {
    it('names a week by its zero-padded Monday, so keys sort chronologically', () => {
      const january = recapKey(recapWindow(new Date(2026, 0, 15)));
      const october = recapKey(recapWindow(new Date(2026, 9, 15)));

      expect(january).toBe('2026-01-05');
      expect(october).toBe('2026-10-05');
      expect(january < october).toBe(true);
    });
  });

  describe('nextRecapMoment', () => {
    // The hour the reminder sweep schedules against, matching the bills'.
    it('fires at nine', () => {
      expect(RECAP_NUDGE_HOUR).toBe(9);
    });

    it('is this morning when the Monday nine has not passed yet', () => {
      const moment = nextRecapMoment(new Date(2026, 7, 3, 8, 59));

      expect(moment.getTime()).toBe(new Date(2026, 7, 3, 9).getTime());
    });

    it('moves to the next week once the moment itself has arrived', () => {
      const moment = nextRecapMoment(new Date(2026, 7, 3, 9));

      expect(moment.getTime()).toBe(new Date(2026, 7, 10, 9).getTime());
    });

    it('is tomorrow morning when asked on a Sunday', () => {
      const moment = nextRecapMoment(new Date(2026, 7, 9, 20, 15));

      expect(dayKey(moment)).toBe('2026-08-10');
      expect(moment.getHours()).toBe(9);
    });

    // The week 2-8 March 2026 loses an hour in the US zones; adding 7 * 24
    // hours to its Monday would schedule this nudge at 10:00.
    it('still lands at nine across a DST change', () => {
      const moment = nextRecapMoment(new Date(2026, 2, 4, 10));

      expect(dayKey(moment)).toBe('2026-03-09');
      expect(moment.getHours()).toBe(9);
    });
  });

  describe('recapKeyAnnouncedBy', () => {
    it('names the week that closed before the nudge fired', () => {
      expect(recapKeyAnnouncedBy(new Date(2026, 7, 3, 9))).toBe('2026-07-27');
    });

    it('announces the week the nudge was scheduled during', () => {
      expect(recapKeyAnnouncedBy(nextRecapMoment(WEDNESDAY))).toBe('2026-08-03');
    });
  });

  describe('composeRecapFigures', () => {
    it('splits the week by type and counts both sides', () => {
      const figures = composeRecapFigures(
        [expense(30, 'food_groceries'), expense(20, 'transport_fuel'), income(500)],
        [],
        toBase,
      );

      expect(figures.spend).toBe(50);
      expect(figures.income).toBe(500);
      expect(figures.count).toBe(3);
    });

    it('reads amounts through toBase rather than off the transaction', () => {
      const figures = composeRecapFigures(
        [expense(10, 'food_groceries', { currency: 'EUR', amountInBaseCurrency: 11.5 })],
        [],
        toBase,
      );

      expect(figures.spend).toBe(11.5);
    });

    it('ranks the leading categories and stops at three', () => {
      const figures = composeRecapFigures(
        [
          expense(10, 'home_utilities'),
          expense(40, 'food_groceries'),
          expense(30, 'transport_fuel'),
          expense(20, 'fun_games'),
        ],
        [],
        toBase,
      );

      expect(figures.topCategories.map(category => category.categoryId))
        .toEqual(['food_groceries', 'transport_fuel', 'fun_games']);
    });

    it('breaks a tie on the category id, so two runs rank identically', () => {
      const figures = composeRecapFigures(
        [expense(25, 'transport_fuel'), expense(25, 'food_groceries')],
        [],
        toBase,
      );

      expect(figures.topCategories.map(category => category.categoryId))
        .toEqual(['food_groceries', 'transport_fuel']);
    });

    it('carries each category total, row count and share of the spend', () => {
      const figures = composeRecapFigures(
        [expense(200, 'food_groceries'), expense(50, 'fun_games'), expense(50, 'fun_games')],
        [],
        toBase,
      );

      expect(figures.topCategories).toEqual([
        { categoryId: 'food_groceries', total: 200, count: 1, share: 0.6667 },
        { categoryId: 'fun_games', total: 100, count: 2, share: 0.3333 },
      ]);
    });

    it('compares the spend against the week before', () => {
      const figures = composeRecapFigures(
        [expense(120, 'food_groceries')],
        [expense(100, 'food_groceries')],
        toBase,
      );

      expect(figures.previousSpend).toBe(100);
      expect(figures.spendDelta).toBe(0.2);
    });

    it('leaves the delta null when the week before spent nothing', () => {
      const figures = composeRecapFigures([expense(50, 'food_groceries')], [income(500)], toBase);

      expect(figures.previousSpend).toBe(0);
      expect(figures.spendDelta).toBeNull();
    });

    it('reports an empty week without a share of nothing', () => {
      const empty = composeRecapFigures([], [], toBase);
      expect(empty).toEqual({
        spend: 0,
        income: 0,
        count: 0,
        previousSpend: 0,
        spendDelta: null,
        topCategories: [],
      });

      // Firestore refuses NaN and the card would render it; a week of
      // zero-amount rows has categories but nothing to divide by.
      const free = composeRecapFigures([expense(0, 'food_groceries')], [], toBase);
      expect(free.topCategories[0].share).toBe(0);
    });
  });

  describe('hasSomethingToSay', () => {
    it('is silent about two empty weeks in a row', () => {
      expect(hasSomethingToSay(composeRecapFigures([], [], toBase))).toBe(false);
    });

    it('speaks for a week that had any activity at all', () => {
      expect(hasSomethingToSay(composeRecapFigures([income(500)], [], toBase))).toBe(true);
    });

    it('still speaks when a spending week is followed by an empty one', () => {
      const figures = composeRecapFigures([], [expense(80, 'food_groceries')], toBase);

      expect(hasSomethingToSay(figures)).toBe(true);
    });
  });

  describe('buildRecapContext', () => {
    const NAMES: Record<string, string> = {
      food_restaurants: 'Restaurants',
      transport_fuel: 'Fuel',
    };
    const categoryName = (categoryId: string) => NAMES[categoryId] ?? categoryId;
    const recapped = recapWindow(WEDNESDAY);

    const PRIVATE = {
      description: 'Dinner with Sam at Bar Bruno',
      note: 'the anniversary present is hidden in the garage',
    };

    function context(): string {
      const figures = composeRecapFigures(
        [expense(60, 'food_restaurants', PRIVATE), expense(40, 'transport_fuel'), income(500)],
        [expense(80, 'food_restaurants')],
        toBase,
      );
      return buildRecapContext(figures, recapped, 'USD', categoryName);
    }

    it('states the week, the currency and the totals one fact per line', () => {
      const lines = context().split('\n');

      expect(lines[0]).toBe('Period: 2026-07-27 to 2026-08-02');
      expect(lines).toContain('Currency: USD');
      expect(lines).toContain('Total spending: 100');
      expect(lines).toContain('Total income: 500');
      expect(lines).toContain('Transactions: 3');
      expect(lines).toContain('Previous week spending: 80');
      expect(lines).toContain('Change vs. the previous week: 25%');
    });

    it('names each top category by its resolved name and its share', () => {
      const text = context();

      expect(text).toContain('Category "Restaurants": 60 (60% of spending)');
      expect(text).toContain('Category "Fuel": 40 (40% of spending)');
    });

    it('carries nothing a person typed and no raw category id', () => {
      const text = context();

      expect(text).not.toContain(PRIVATE.description);
      expect(text).not.toContain(PRIVATE.note);
      expect(text).not.toContain('food_restaurants');
      expect(text).not.toContain('transport_fuel');
    });

    it('says n/a rather than a percentage of nothing', () => {
      const figures = composeRecapFigures([expense(60, 'food_restaurants')], [], toBase);

      expect(buildRecapContext(figures, recapped, 'JPY', categoryName))
        .toContain('Change vs. the previous week: n/a');
    });
  });

  describe('the device store', () => {
    const UID = 'user-1';

    afterEach(() => {
      clearWeeklyRecapDeviceState(UID);
      clearWeeklyRecapDeviceState('user-2');
    });

    it('scopes both keys to one account', () => {
      expect(weeklyRecapStorageKeys(UID)).toEqual({
        dismissed: 'home-account.recap.dismissed.user-1',
        narrative: 'home-account.recap.narrative.user-1',
      });
    });

    it('round-trips the dismissed week', () => {
      writeDismissedRecapWeek(UID, '2026-07-27');

      expect(readDismissedRecapWeek(UID)).toBe('2026-07-27');
    });

    it('returns null when this device dismissed nothing', () => {
      expect(readDismissedRecapWeek(UID)).toBeNull();
    });

    it('keeps one account dismissal off another', () => {
      writeDismissedRecapWeek(UID, '2026-07-27');

      expect(readDismissedRecapWeek('user-2')).toBeNull();
    });

    it('clears the dismissal and the cached narrative together', () => {
      writeDismissedRecapWeek(UID, '2026-07-27');
      localStorage.setItem(weeklyRecapStorageKeys(UID).narrative, 'Last week you spent less.');

      clearWeeklyRecapDeviceState(UID);

      expect(readDismissedRecapWeek(UID)).toBeNull();
      expect(localStorage.getItem(weeklyRecapStorageKeys(UID).narrative)).toBeNull();
    });

    // Private-mode Safari throws on the accessor itself, not just on writes.
    it('reads null rather than throwing when the store refuses access', () => {
      spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');

      expect(readDismissedRecapWeek(UID)).toBeNull();
    });

    it('swallows a refused write and a refused clear', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
      spyOn(Storage.prototype, 'removeItem').and.throwError('SecurityError');

      expect(() => writeDismissedRecapWeek(UID, '2026-07-27')).not.toThrow();
      expect(() => clearWeeklyRecapDeviceState(UID)).not.toThrow();
    });
  });
});
