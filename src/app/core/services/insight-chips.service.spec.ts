import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InsightChipsService } from './insight-chips.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { CategoryTotal, Transaction, User } from '../../models';
import { createCategory, createTimestamp, createTransaction, createUser } from './testing/test-data';

describe('InsightChipsService', () => {
  let service: InsightChipsService;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let categoryService: jasmine.SpyObj<CategoryService>;
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let translationService: jasmine.SpyObj<TranslationService>;

  const now = new Date();
  const currentDate = new Date(now.getFullYear(), now.getMonth(), 15);
  const pastDate = (monthsAgo: number) =>
    new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5);

  function expense(
    amount: number,
    categoryId: string,
    date: Date,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      categoryId,
      amountInBaseCurrency: amount,
      date: createTimestamp(date),
      ...overrides,
    });
  }

  /**
   * Varied past baseline for one category: alternating 10/20 across the
   * trailing window, enough samples that a 100 outlier lands above
   * mean + 2*stddev even with itself included in the baseline.
   */
  function baselineFor(categoryId: string): Transaction[] {
    return [10, 20, 10, 20, 10, 20].map((amount, i) =>
      expense(amount, categoryId, pastDate((i % 3) + 1)));
  }

  function setup(
    expenses: Transaction[],
    previousByCategory: CategoryTotal[] = [],
  ): void {
    transactionService.getExpensesInRange.and.returnValue(of(expenses));
    transactionService.getPeriodCategoryTotals.and.returnValue(
      of({ income: 0, expense: 0, byCategory: previousByCategory })
    );
    service.load();
  }

  beforeEach(() => {
    transactionService = jasmine.createSpyObj('TransactionService', [
      'getExpensesInRange',
      'getPeriodCategoryTotals',
    ]);
    categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food', type: 'expense' }),
      createCategory({ id: 'pets', name: 'Pets', type: 'expense' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    ]);
    currencyService = jasmine.createSpyObj('CurrencyService', ['amountInBase']);
    currencyService.amountInBase.and.callFake(
      (t: Transaction) => t.amountInBaseCurrency ?? t.amount);
    translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    const authService = {
      currentUser: () => createUser({
        preferences: { baseCurrency: 'USD' } as User['preferences'],
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        InsightChipsService,
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: AuthService, useValue: authService },
      ],
    });

    service = TestBed.inject(InsightChipsService);
  });

  it('builds an anomaly chip scoped to the category and current month', () => {
    const outlier = expense(100, 'food', currentDate);
    setup([...baselineFor('food'), outlier]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    const chip = chips[0];
    expect(chip.kind).toBe('anomaly');
    expect(chip.id).toBe('anomaly:food');
    expect(chip.labelKey).toBe('transactions.chipUnusual');
    expect(chip.labelParams['category']).toBe('Food');
    expect(chip.filters.type).toBe('expense');
    expect(chip.filters.categoryId).toBe('food');
    expect(chip.filters.startDate?.getDate()).toBe(1);
    expect(chip.filters.endDate?.getMonth()).toBe(now.getMonth());
  });

  it('narrows the anomaly chip by amount when the category is single-currency', () => {
    const outlier = expense(100, 'food', currentDate);
    setup([...baselineFor('food'), outlier]);

    const chip = service.chips()[0];
    expect(chip.filters.minAmount).toBeDefined();
    expect(chip.filters.minAmount!).toBeLessThan(100);
    expect(chip.filters.minAmount!).toBeGreaterThan(20);
  });

  it('omits minAmount when the category mixes currencies this month', () => {
    const outlier = expense(100, 'food', currentDate);
    const foreignRow = expense(1000, 'food', currentDate, {
      currency: 'JPY',
      amountInBaseCurrency: 7,
    });
    setup([...baselineFor('food'), outlier, foreignRow]);

    const chip = service.chips().find(c => c.kind === 'anomaly');
    expect(chip).toBeDefined();
    expect(chip!.filters.minAmount).toBeUndefined();
  });

  it('builds a chip for a category that is new this month', () => {
    setup(
      [expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );

    const chip = service.chips().find(c => c.kind === 'newCategory');
    expect(chip).toBeDefined();
    expect(chip!.id).toBe('new:pets');
    expect(chip!.labelParams['category']).toBe('Pets');
    expect(chip!.filters.categoryId).toBe('pets');
  });

  it('builds a top-category chip only with at least 3 transactions', () => {
    setup([
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
      expense(50, 'transport', currentDate),
    ]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    expect(chips[0].kind).toBe('topCategory');
    expect(chips[0].filters.categoryId).toBe('food');
  });

  it('skips the top-category chip below 3 transactions', () => {
    setup([expense(30, 'food', currentDate), expense(20, 'food', currentDate)]);
    expect(service.chips().length).toBe(0);
  });

  it('orders anomaly chips before the others', () => {
    const outlier = expense(100, 'food', currentDate);
    setup(
      [...baselineFor('food'), outlier, expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );

    const kinds = service.chips().map(c => c.kind);
    expect(kinds[0]).toBe('anomaly');
    expect(kinds).toContain('newCategory');
  });

  it('returns no chips when the current month has no expenses', () => {
    setup(baselineFor('food'));
    expect(service.chips()).toEqual([]);
  });

  it('returns no chips when loading fails', () => {
    transactionService.getExpensesInRange.and.returnValue(
      throwError(() => new Error('offline')));
    transactionService.getPeriodCategoryTotals.and.returnValue(
      of({ income: 0, expense: 0, byCategory: [] }));
    service.load();
    expect(service.chips()).toEqual([]);
    expect(service.isLoading()).toBeFalse();
  });
});
