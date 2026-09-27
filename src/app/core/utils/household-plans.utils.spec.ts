import { Timestamp } from '@angular/fire/firestore';
import {
  HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH,
  HouseholdBudget,
  HouseholdContribution,
  HouseholdGoal,
  LedgerCopy,
  Transaction,
  normalizeShares,
  shareKey
} from '../../models';
import { defaultCategories } from './category-merge.utils';
import { projectRow } from './ledger-projection.utils';
import {
  ConvertAtTodaysRate,
  budgetSpent,
  goalProgress,
  householdBudgetWindow,
  isHouseholdBudgetCategory,
  planWindow
} from './household-plans.utils';

/**
 * Every date here is built from local parts, so each window is the viewer's
 * own: this file runs in test:dates under America/New_York and Asia/Tokyo as
 * well as UTC, and a bound computed in any one zone's terms fails the others.
 */
describe('household plan figures', () => {
  const GEN = new Timestamp(1_767_605_400, 123_456_000);
  const HOME = 'h1';
  const at = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0) =>
    new Date(year, month, day, hours, minutes, seconds, ms);
  const stamp = (date: Date) => Timestamp.fromDate(date);
  const before = (date: Date) => new Date(date.getTime() - 1);
  const after = (date: Date) => new Date(date.getTime() + 1);

  // Unlike the compiled-in rates, so an amount that skipped conversion, or
  // was converted at a constant, shows.
  const RATES: Readonly<Record<string, number>> = { USD: 1, EUR: 0.8, JPY: 150 };
  let convert: jasmine.Spy<ConvertAtTodaysRate>;

  beforeEach(() => {
    convert = jasmine.createSpy<ConvertAtTodaysRate>('convert')
      .and.callFake((amount, from, to) => amount * RATES[to] / RATES[from]);
  });

  function budget(overrides: Partial<HouseholdBudget> = {}): HouseholdBudget {
    return {
      id: 'b1',
      gen: GEN,
      name: 'Food',
      categoryIds: ['food'],
      amount: 400,
      currency: 'USD',
      period: 'monthly',
      startDate: stamp(at(2026, 0, 1)),
      isActive: true,
      createdBy: 'me',
      createdAt: GEN,
      updatedAt: GEN,
      ...overrides
    };
  }

  /** A copy of one dollar of groceries on 15 March 2026 unless told otherwise. */
  function copy(overrides: Partial<LedgerCopy> = {}): LedgerCopy {
    return {
      memberUid: 'me',
      sourceId: 'row',
      gen: GEN,
      pv: 1,
      type: 'expense',
      amount: 1,
      currency: 'USD',
      date: stamp(at(2026, 2, 15, 12)),
      description: 'groceries',
      categoryId: 'food_groceries',
      category: { name: 'categoryNames.groceries', icon: 'shopping_cart', color: '#FF5722' },
      bucket: 'food_groceries',
      bucketGroup: 'food',
      updatedAt: GEN,
      ...overrides
    };
  }

  const dated = (date: Date, amount = 1) => copy({ date: stamp(date), amount, description: date.toString() });

  describe('householdBudgetWindow', () => {
    it('is the calendar month around now for a budget anchored on the 1st, from its first local millisecond to its last', () => {
      const window = householdBudgetWindow(budget(), at(2026, 2, 15, 9));

      expect(window).toEqual({ start: at(2026, 2, 1), end: at(2026, 2, 31, 23, 59, 59, 999) });
    });

    it('keeps an anchor on the 31st inside February, and moves on on the 28th', () => {
      const anchored = budget({ startDate: stamp(at(2026, 0, 31)) });

      expect(householdBudgetWindow(anchored, at(2026, 1, 27, 20)))
        .toEqual({ start: at(2026, 0, 31), end: at(2026, 1, 27, 23, 59, 59, 999) });
      expect(householdBudgetWindow(anchored, at(2026, 1, 28, 1)))
        .toEqual({ start: at(2026, 1, 28), end: at(2026, 2, 30, 23, 59, 59, 999) });
    });

    it("runs a weekly budget from its anchor's weekday for seven local days", () => {
      // Wednesday 2 September 2026; now is Monday the 28th.
      const weekly = budget({ period: 'weekly', startDate: stamp(at(2026, 8, 2)) });

      expect(householdBudgetWindow(weekly, at(2026, 8, 28, 7)))
        .toEqual({ start: at(2026, 8, 23), end: at(2026, 8, 29, 23, 59, 59, 999) });
    });

    it('runs a yearly budget from its anchor day to the day before it a year on', () => {
      const yearly = budget({ period: 'yearly', startDate: stamp(at(2025, 3, 1)) });

      expect(householdBudgetWindow(yearly, at(2026, 2, 15)))
        .toEqual({ start: at(2025, 3, 1), end: at(2026, 2, 31, 23, 59, 59, 999) });
    });

    it('is cut short by an end date inside it, through the last millisecond of that day', () => {
      const ending = budget({ endDate: stamp(at(2026, 2, 10)) });

      expect(householdBudgetWindow(ending, at(2026, 2, 15)))
        .toEqual({ start: at(2026, 2, 1), end: at(2026, 2, 10, 23, 59, 59, 999) });
    });

    it('is left whole by an end date after it', () => {
      const ending = budget({ endDate: stamp(at(2026, 5, 30)) });

      expect(householdBudgetWindow(ending, at(2026, 2, 15)))
        .toEqual({ start: at(2026, 2, 1), end: at(2026, 2, 31, 23, 59, 59, 999) });
    });

    it('is none once the budget ended before its current period began, or when its dates cannot be read', () => {
      expect(householdBudgetWindow(budget({ endDate: stamp(at(2026, 1, 20)) }), at(2026, 2, 15))).toBeNull();
      expect(householdBudgetWindow(budget({ endDate: stamp(at(2026, 1, 28, 23, 59)) }), at(2026, 2, 15)))
        .withContext('the day before the period').toBeNull();
      expect(householdBudgetWindow(budget({ startDate: null as unknown as Timestamp }), at(2026, 2, 15))).toBeNull();
      expect(householdBudgetWindow(budget({ endDate: 'soon' as unknown as Timestamp }), at(2026, 2, 15))).toBeNull();
      expect(householdBudgetWindow(budget({ period: 'daily' as HouseholdBudget['period'] }), at(2026, 2, 15))).toBeNull();
    });
  });

  describe('budgetSpent', () => {
    const NOW = at(2026, 2, 15, 9);

    it("counts the expense copies inside the window's first and last millisecond, and none a millisecond outside", () => {
      const window = householdBudgetWindow(budget(), NOW)!;
      const copies = [
        dated(window.start, 1),
        dated(window.end, 2),
        dated(before(window.start), 100),
        dated(after(window.end), 1000)
      ];

      const figure = budgetSpent(budget(), copies, NOW, convert);

      expect(figure).toEqual({ spent: 3, atTodaysRate: false, window });
    });

    it('counts through the whole end day of an end date, and nothing after it', () => {
      const ending = budget({ endDate: stamp(at(2026, 2, 10)) });

      const figure = budgetSpent(ending, [
        dated(at(2026, 2, 10, 23, 59, 59, 999), 5),
        dated(at(2026, 2, 11), 50)
      ], NOW, convert);

      expect(figure.spent).toBe(5);
      expect(figure.window).toEqual({ start: at(2026, 2, 1), end: at(2026, 2, 10, 23, 59, 59, 999) });
    });

    it('counts nothing for a budget whose period has no window', () => {
      const ended = budget({ endDate: stamp(at(2026, 1, 1)) });

      expect(budgetSpent(ended, [copy({ amount: 9 })], NOW, convert))
        .toEqual({ spent: 0, atTodaysRate: false, window: null });
    });

    it("counts a copy whose bucket or whose bucket's group is one of the budget's categories, once", () => {
      const copies = [
        copy({ amount: 1, bucket: 'food_groceries', bucketGroup: 'food' }),
        copy({ amount: 2, bucket: 'food', bucketGroup: 'food' }),
        copy({ amount: 4, bucket: 'food_restaurants', bucketGroup: 'food' }),
        copy({ amount: 8, bucket: 'transport_parking', bucketGroup: 'transport' }),
        copy({ amount: 16, bucket: 'other_expense', bucketGroup: 'other_expense' })
      ];

      expect(budgetSpent(budget({ categoryIds: ['food'] }), copies, NOW, convert).spent)
        .withContext('a group takes in every subcategory').toBe(7);
      expect(budgetSpent(budget({ categoryIds: ['food_restaurants', 'transport'] }), copies, NOW, convert).spent)
        .withContext('a subcategory alone, beside a group').toBe(12);
      expect(budgetSpent(budget({ categoryIds: ['food', 'food_groceries', 'food_restaurants'] }), copies, NOW, convert).spent)
        .withContext('matched by both, counted once').toBe(7);
      expect(budgetSpent(budget({ categoryIds: ['entertainment'] }), copies, NOW, convert).spent).toBe(0);
    });

    it('never counts an income copy, whatever its bucket', () => {
      const copies = [copy({ type: 'income', amount: 500 }), copy({ amount: 3 })];

      expect(budgetSpent(budget(), copies, NOW, convert).spent).toBe(3);
    });

    it("counts a copy in the budget's currency exactly, and any other at today's rate, and says so", () => {
      const copies = [
        copy({ amount: 10, currency: 'USD' }),
        copy({ amount: 8, currency: 'EUR' }),
        copy({ amount: 1500, currency: 'JPY' })
      ];

      const figure = budgetSpent(budget({ currency: 'USD' }), copies, NOW, convert);

      // 10 + 8 / 0.8 + 1500 / 150
      expect([figure.spent, figure.atTodaysRate]).toEqual([30, true]);
      expect(convert.calls.allArgs()).toEqual([[8, 'EUR', 'USD'], [1500, 'JPY', 'USD']]);
    });

    it("converts into the budget's own currency, not the viewer's", () => {
      const figure = budgetSpent(budget({ currency: 'EUR' }), [copy({ amount: 10, currency: 'USD' }), copy({ amount: 2, currency: 'EUR' })], NOW, convert);

      expect([figure.spent, figure.atTodaysRate]).toEqual([10, true]);
    });

    it('stays exact, and asks for no rate, while every copy is in its currency', () => {
      const figure = budgetSpent(budget(), [copy({ amount: 0.1 }), copy({ amount: 0.2 })], NOW, convert);

      expect(figure).toEqual(jasmine.objectContaining({ spent: 0.3, atTodaysRate: false }));
      expect(convert).not.toHaveBeenCalled();
    });

    it('passes over a copy whose amount or date cannot be read', () => {
      const copies = [
        copy({ amount: Number.NaN }),
        copy({ amount: 'ten' as unknown as number }),
        copy({ date: null as unknown as Timestamp }),
        copy({ amount: 4 })
      ];

      expect(budgetSpent(budget(), copies, NOW, convert).spent).toBe(4);
    });

    it('never counts a private row: only a shared row has a copy, and the budget folds copies alone', () => {
      const row = (id: string, amount: number, sharedWith?: string[]) => ({
        id,
        userId: 'me',
        type: 'expense',
        amount,
        currency: 'USD',
        date: stamp(at(2026, 2, 12, 12)),
        description: id,
        categoryId: 'food_groceries',
        ...(sharedWith ? { sharedWith } : {})
      }) as Transaction;
      const rows = [
        row('shared', 12, [shareKey(HOME)]),
        row('private', 500),
        row('elsewhere', 40, [shareKey('h2')])
      ];
      // What the household holds: a copy of each row that names it, as
      // LedgerShareService writes them.
      const copies = rows
        .filter(source => normalizeShares(source.sharedWith).includes(HOME))
        .map(source => projectRow(source, defaultCategories(), GEN));

      expect(copies.map(held => held.sourceId)).toEqual(['shared']);
      expect(budgetSpent(budget(), copies, NOW, convert).spent).toBe(12);
      // Every one of the rows sits in the window and the category: folded
      // from the rows, the private one would count.
      const everyRow = rows.map(source => projectRow(source, defaultCategories(), GEN));
      expect(budgetSpent(budget(), everyRow, NOW, convert).spent).toBe(552);
    });
  });

  describe('goalProgress', () => {
    function goal(overrides: Partial<HouseholdGoal> = {}): HouseholdGoal {
      return {
        id: 'g1',
        gen: GEN,
        name: 'Holiday',
        targetAmount: 200,
        currency: 'EUR',
        isActive: true,
        createdBy: 'me',
        createdAt: GEN,
        updatedAt: GEN,
        ...overrides
      };
    }

    const contribution = (amount: number, memberUid = 'me'): HouseholdContribution => ({
      id: `c-${amount}`,
      gen: GEN,
      memberUid,
      amount,
      date: stamp(at(2026, 2, 1)),
      createdAt: GEN
    });

    it("adds the copies linked to the goal, at today's rate into its currency, to the members' contributions", () => {
      const linked = [
        copy({ goalId: 'g1', amount: 50, currency: 'USD' }),
        copy({ goalId: 'g1', amount: 30, currency: 'EUR' }),
        // A linked row counts whichever way it went, as a personal goal link does.
        copy({ goalId: 'g1', type: 'income', amount: 20, currency: 'EUR' }),
        copy({ goalId: 'g2', amount: 999, currency: 'EUR' }),
        copy({ amount: 999, currency: 'EUR' })
      ];

      const progress = goalProgress(goal(), linked, [contribution(100), contribution(10, 'kai')], convert);

      // 50 × 0.8 + 30 + 20, and 110 contributed
      expect(progress).toEqual({ saved: 200, linked: 90, contributed: 110, fraction: 1, atTodaysRate: true });
      expect(convert.calls.allArgs()).toEqual([[50, 'USD', 'EUR']]);
    });

    it("stays exact while every linked copy is in the goal's currency", () => {
      const progress = goalProgress(goal({ targetAmount: 100 }), [copy({ goalId: 'g1', amount: 0.1, currency: 'EUR' })], [contribution(0.2)], convert);

      expect(progress).toEqual({ saved: 0.3, linked: 0.1, contributed: 0.2, fraction: 0.003, atTodaysRate: false });
      expect(convert).not.toHaveBeenCalled();
    });

    it('counts contributions alone when nothing is linked, and runs past the target uncapped', () => {
      expect(goalProgress(goal({ targetAmount: 50 }), [], [contribution(60), contribution(15)], convert))
        .toEqual({ saved: 75, linked: 0, contributed: 75, fraction: 1.5, atTodaysRate: false });
    });

    it('reads a target of nothing as no progress, and passes over an amount it cannot read', () => {
      const unreadable = { ...contribution(5), amount: Number.POSITIVE_INFINITY };

      expect(goalProgress(goal({ targetAmount: 0 }), [copy({ goalId: 'g1', amount: Number.NaN, currency: 'EUR' })], [unreadable, contribution(5)], convert))
        .toEqual({ saved: 5, linked: 0, contributed: 5, fraction: 0, atTodaysRate: false });
    });
  });

  describe('planWindow', () => {
    it('spans every active budget window: the earliest start and the latest end', () => {
      // Tuesday 3 March 2026.
      const now = at(2026, 2, 3, 10);
      const monthly = budget();
      // A Friday anchor: its week began on Friday 27 February.
      const weekly = budget({ id: 'b2', period: 'weekly', startDate: stamp(at(2026, 0, 2)) });

      expect(planWindow([monthly, weekly], now))
        .toEqual({ start: at(2026, 1, 27), end: at(2026, 2, 31, 23, 59, 59, 999) });

      const yearly = budget({ id: 'b3', period: 'yearly', startDate: stamp(at(2025, 3, 1)) });
      expect(planWindow([monthly, weekly, yearly], now))
        .toEqual({ start: at(2025, 3, 1), end: at(2026, 2, 31, 23, 59, 59, 999) });
    });

    it('leaves out an inactive budget and one with no window', () => {
      const now = at(2026, 2, 15);
      const inactive = budget({ id: 'b2', isActive: false, period: 'yearly', startDate: stamp(at(2025, 3, 1)) });
      // Ended in March 2025, before its current year began on 1 April.
      const ended = budget({ id: 'b3', period: 'yearly', startDate: stamp(at(2024, 3, 1)), endDate: stamp(at(2025, 2, 1)) });

      expect(planWindow([budget(), inactive, ended], now))
        .toEqual({ start: at(2026, 2, 1), end: at(2026, 2, 31, 23, 59, 59, 999) });
      expect(planWindow([inactive, ended], now)).toBeNull();
      expect(planWindow([], now)).toBeNull();
    });
  });

  describe('isHouseholdBudgetCategory', () => {
    it('accepts every expense built-in, group or subcategory, as a copy names its bucket and group', () => {
      for (const id of ['food', 'food_restaurants', 'transport_fuelAndGas', 'other_expense']) {
        expect(isHouseholdBudgetCategory(id)).withContext(id).toBeTrue();
      }
    });

    it('refuses a custom category, a misspelled one and any income built-in, which a budget could never count', () => {
      for (const id of ['kai-climbing-gym', 'fod', 'Food', 'employment', 'employment_salary', 'other_income', '', 7, null]) {
        expect(isHouseholdBudgetCategory(id)).withContext(String(id)).toBeFalse();
      }
    });

    it('names only ids the rules store', () => {
      const { min, max } = HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH;
      const expenseIds = defaultCategories().filter(category => category.type === 'expense').map(category => category.id);

      expect(expenseIds.length).toBeGreaterThan(0);
      for (const id of expenseIds) {
        expect(isHouseholdBudgetCategory(id)).withContext(id).toBeTrue();
        expect(id.length >= min && id.length <= max).withContext(id).toBeTrue();
      }
    });
  });
});
