import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { Transaction, User } from '../../models';
import { createTransaction, createCategory, createUser } from '../../core/services/testing';

describe('DashboardComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getByDateRange: jasmine.Spy;
    getRecentTransactions: jasmine.Spy;
    getPeriodCategoryTotals: jasmine.Spy;
  };
  let budgetService: {
    activeBudgets: ReturnType<typeof signal<unknown[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getBudgets: jasmine.Spy;
  };
  let categoryService: { categories: ReturnType<typeof signal<unknown[]>>; loadCategories: jasmine.Spy };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };
  let currencyService: jasmine.SpyObj<CurrencyService>;

  function build() {
    return TestBed.createComponent(DashboardComponent);
  }

  beforeEach(async () => {
    transactionService = {
      transactions: signal<Transaction[]>([]),
      isLoading: signal(false),
      getByDateRange: jasmine.createSpy('getByDateRange').and.returnValue(of([])),
      getRecentTransactions: jasmine.createSpy('getRecentTransactions').and.returnValue(of([])),
      getPeriodCategoryTotals: jasmine
        .createSpy('getPeriodCategoryTotals')
        .and.returnValue(of({ income: 0, expense: 0, byCategory: [] })),
    };
    budgetService = {
      activeBudgets: signal<unknown[]>([]),
      isLoading: signal(false),
      getBudgets: jasmine.createSpy('getBudgets').and.returnValue(of([])),
    };
    categoryService = {
      categories: signal<unknown[]>([createCategory({ id: 'food' })]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    authService = { currentUser: signal<User | null>(createUser({ displayName: 'Ada Lovelace' })) };
    currencyService = jasmine.createSpyObj('CurrencyService', ['convert']);
    currencyService.convert.and.callFake((amount: number) => amount);

    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: BudgetService, useValue: budgetService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: AuthService, useValue: authService },
        { provide: TranslationService, useValue: translation },
      ],
    })
      .overrideComponent(DashboardComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  it('should create', () => {
    expect(build().componentInstance).toBeTruthy();
  });

  describe('user-derived signals', () => {
    it('uses the first name when a display name exists', () => {
      expect(build().componentInstance.userName()).toBe('Ada');
    });

    it('falls back to "User" when no display name', () => {
      authService.currentUser.set(createUser({ displayName: '' }));
      expect(build().componentInstance.userName()).toBe('User');
    });

    it('reads the base currency from preferences with a USD fallback', () => {
      const component = build().componentInstance;
      expect(component.baseCurrency()).toBe('USD');
      authService.currentUser.set(createUser({ preferences: { baseCurrency: 'JPY' } as User['preferences'] }));
      expect(build().componentInstance.baseCurrency()).toBe('JPY');
    });
  });

  describe('totals', () => {
    beforeEach(() => {
      transactionService.transactions.set([
        createTransaction({ type: 'income', amount: 1000 }),
        createTransaction({ type: 'expense', amount: 300, categoryId: 'food' }),
        createTransaction({ type: 'expense', amount: 200, categoryId: 'food' }),
        createTransaction({ type: 'expense', amount: 100, categoryId: 'travel' }),
      ]);
    });

    it('sums income, expenses and balance with currency conversion', () => {
      const component = build().componentInstance;
      expect(component.totalIncome()).toBe(1000);
      expect(component.totalExpenses()).toBe(600);
      expect(component.balance()).toBe(400);
      expect(currencyService.convert).toHaveBeenCalled();
    });

    it('groups and sorts category totals by amount descending', () => {
      const totals = build().componentInstance.categoryTotals();
      expect(totals[0]).toEqual(jasmine.objectContaining({ categoryId: 'food', total: 500, count: 2 }));
      expect(totals[1]).toEqual(jasmine.objectContaining({ categoryId: 'travel', total: 100, count: 1 }));
    });

    it('builds a categories map', () => {
      expect(build().componentInstance.categoriesMap().get('food')).toBeTruthy();
    });
  });

  describe('custom period label', () => {
    it('is empty when no custom period is set', () => {
      expect(build().componentInstance.customPeriodLabel()).toBe('');
    });

    it('shows the year for a year period', () => {
      const component = build().componentInstance;
      component.customPeriod.set({ type: 'year', year: 2025 });
      expect(component.customPeriodLabel()).toBe('2025');
    });

    it('shows month and year for a month period', () => {
      const component = build().componentInstance;
      component.customPeriod.set({ type: 'month', year: 2025, month: 5 });
      expect(component.customPeriodLabel()).toBe('Jun 2025');
    });
  });

  describe('period selection', () => {
    it('isCustomPeriod tracks the selected period', () => {
      const component = build().componentInstance;
      expect(component.isCustomPeriod()).toBeFalse();
      component.selectedPeriod = 'custom';
      expect(component.isCustomPeriod()).toBeTrue();
    });

    it('onPeriodChange clears the custom period and reloads', () => {
      const component = build().componentInstance;
      component.customPeriod.set({ type: 'year', year: 2020 });
      component.onPeriodChange();
      expect(component.customPeriod()).toBeNull();
      expect(transactionService.getByDateRange).toHaveBeenCalled();
    });

    it('onMonthSelected sets a custom month period and closes the picker', () => {
      const component = build().componentInstance;
      const picker = jasmine.createSpyObj('MatDatepicker', ['close', 'open']);
      component.onMonthSelected(new Date(2025, 2, 10), picker);
      expect(picker.close).toHaveBeenCalled();
      expect(component.customPeriod()).toEqual({ type: 'month', year: 2025, month: 2 });
      expect(component.selectedPeriod).toBe('custom');
    });

    it('onYearSelected sets a custom year period and closes the picker', () => {
      const component = build().componentInstance;
      const picker = jasmine.createSpyObj('MatDatepicker', ['close', 'open']);
      component.onYearSelected(new Date(2024, 0, 1), picker);
      expect(picker.close).toHaveBeenCalled();
      expect(component.customPeriod()).toEqual({ type: 'year', year: 2024 });
    });

    it('clearCustomPeriod resets to this month', () => {
      const component = build().componentInstance;
      component.selectedPeriod = 'custom';
      component.clearCustomPeriod();
      expect(component.selectedPeriod).toBe('thisMonth');
      expect(component.customPeriod()).toBeNull();
    });

    it('openMonthPicker / openYearPicker delegate to the pickers', () => {
      const component = build().componentInstance;
      component.monthPicker = jasmine.createSpyObj('MatDatepicker', ['open']);
      component.yearPicker = jasmine.createSpyObj('MatDatepicker', ['open']);
      component.openMonthPicker();
      component.openYearPicker();
      expect(component.monthPicker.open).toHaveBeenCalled();
      expect(component.yearPicker.open).toHaveBeenCalled();
    });
  });

  describe('loadData / period date ranges', () => {
    function lastRange() {
      const args = transactionService.getByDateRange.calls.mostRecent().args;
      return { start: args[0] as Date, end: args[1] as Date };
    }

    it('ngOnInit triggers data loading and clears loading flags', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getByDateRange).toHaveBeenCalled();
      expect(transactionService.getRecentTransactions).toHaveBeenCalledWith(5);
      expect(budgetService.getBudgets).toHaveBeenCalled();
      expect(categoryService.loadCategories).toHaveBeenCalled();
      expect(fixture.componentInstance.isLoading()).toBeFalse();
    });

    it('handles each preset period and a custom month/year', () => {
      const component = build().componentInstance;
      for (const period of ['thisMonth', 'lastMonth', 'last3Months', 'thisYear'] as const) {
        component.selectedPeriod = period;
        component.onPeriodChange();
        expect(lastRange().start instanceof Date).toBeTrue();
      }

      component.selectedPeriod = 'custom';
      component.customPeriod.set({ type: 'month', year: 2025, month: 3 });
      component.onMonthSelected(new Date(2025, 3, 1), jasmine.createSpyObj('p', ['close']));
      expect(lastRange().start).toEqual(new Date(2025, 3, 1));

      component.customPeriod.set({ type: 'year', year: 2025 });
      component.onYearSelected(new Date(2025, 0, 1), jasmine.createSpyObj('p', ['close']));
      expect(lastRange().start).toEqual(new Date(2025, 0, 1));
    });

    it('stores previous-period comparison data', () => {
      transactionService.getPeriodCategoryTotals.and.returnValue(
        of({ income: 10, expense: 5, byCategory: [{ categoryId: 'food', total: 5 }] }),
      );
      const component = build().componentInstance;
      component.selectedPeriod = 'thisMonth';
      component.onPeriodChange();
      expect(component.previousPeriodData()).toEqual({ income: 10, expense: 5 });
      expect(component.previousPeriodByCategory()?.length).toBe(1);
    });

    it('clears comparison data when there is no previous period', () => {
      const component = build().componentInstance;
      component.selectedPeriod = 'custom';
      component.customPeriod.set(null);
      component.onPeriodChange();
      expect(component.previousPeriodData()).toBeNull();
    });

    it('clears comparison data on error', () => {
      transactionService.getPeriodCategoryTotals.and.returnValue(throwError(() => new Error('x')));
      const component = build().componentInstance;
      component.selectedPeriod = 'thisYear';
      component.onPeriodChange();
      expect(component.previousPeriodData()).toBeNull();
    });
  });
});
