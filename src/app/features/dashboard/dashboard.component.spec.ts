import { TestBed } from '@angular/core/testing';
import { Component, input, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DashboardComponent } from './dashboard.component';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { RecurringService } from '../../core/services/recurring.service';
import { TranslationService } from '../../core/services/translation.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { BudgetAlert, Transaction, User } from '../../models';
import { createTransaction, createCategory, createUser } from '../../core/services/testing';

// Stands in for the real summary component when the real dashboard template
// is rendered, capturing exactly what the template binds to each input.
@Component({ selector: 'app-financial-summary', standalone: true, template: '' })
class FinancialSummaryStubComponent {
  income = input<number>(0);
  expenses = input<number>(0);
  balance = input<number>(0);
  currency = input<string>('USD');
  previousIncome = input<number | null>(null);
  previousExpenses = input<number | null>(null);
}

describe('DashboardComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getByDateRange: jasmine.Spy;
    getRecentTransactions: jasmine.Spy;
    getPeriodCategoryTotals: jasmine.Spy;
    getExpensesInRange: jasmine.Spy;
  };
  let budgetService: {
    activeBudgets: ReturnType<typeof signal<unknown[]>>;
    budgetAlerts: ReturnType<typeof signal<BudgetAlert[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getBudgets: jasmine.Spy;
  };
  let categoryService: { categories: ReturnType<typeof signal<unknown[]>>; loadCategories: jasmine.Spy };
  let recurringService: { catchUpRecurringTransactions: jasmine.Spy };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;

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
      getExpensesInRange: jasmine.createSpy('getExpensesInRange').and.returnValue(of([])),
    };
    budgetService = {
      activeBudgets: signal<unknown[]>([]),
      budgetAlerts: signal<BudgetAlert[]>([]),
      isLoading: signal(false),
      getBudgets: jasmine.createSpy('getBudgets').and.returnValue(of([])),
    };
    categoryService = {
      categories: signal<unknown[]>([createCategory({ id: 'food' })]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    recurringService = {
      catchUpRecurringTransactions: jasmine
        .createSpy('catchUpRecurringTransactions')
        .and.returnValue(Promise.resolve([])),
    };
    authService = { currentUser: signal<User | null>(createUser({ displayName: 'Ada Lovelace' })) };
    currencyService = jasmine.createSpyObj('CurrencyService', ['convert', 'amountInBase']);
    currencyService.convert.and.callFake((amount: number) => amount);
    currencyService.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );

    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: BudgetService, useValue: budgetService },
        { provide: CategoryService, useValue: categoryService },
        { provide: RecurringService, useValue: recurringService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: AuthService, useValue: authService },
        { provide: TranslationService, useValue: translation },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
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

    it('sums income, expenses and balance in base currency', () => {
      const component = build().componentInstance;
      expect(component.totalIncome()).toBe(1000);
      expect(component.totalExpenses()).toBe(600);
      expect(component.balance()).toBe(400);
      expect(currencyService.amountInBase).toHaveBeenCalled();
    });

    it('uses the stored base-currency snapshot rather than live conversion', () => {
      transactionService.transactions.set([
        createTransaction({
          type: 'income',
          amount: 3800,
          currency: 'JPY',
          amountInBaseCurrency: 25.42,
        }),
      ]);
      // A live conversion would misreport the raw foreign amount when rates
      // have not loaded yet — the stored snapshot must win.
      currencyService.convert.and.returnValue(3800);
      expect(build().componentInstance.totalIncome()).toBeCloseTo(25.42, 2);
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

  describe('recurring catch-up', () => {
    it('triggers the catch-up once on init, not again on period changes', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(recurringService.catchUpRecurringTransactions).toHaveBeenCalledTimes(1);

      fixture.componentInstance.onPeriodChange();
      expect(recurringService.catchUpRecurringTransactions).toHaveBeenCalledTimes(1);
    });

    it('still loads the dashboard when the catch-up fails', async () => {
      recurringService.catchUpRecurringTransactions.and.returnValue(
        Promise.reject(new Error('offline')),
      );
      const fixture = build();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.isLoading()).toBeFalse();
      expect(transactionService.getByDateRange).toHaveBeenCalled();
    });
  });

  describe('budget alerts', () => {
    const warningAlert: BudgetAlert = {
      budgetId: 'b1',
      budgetName: 'Food',
      percentUsed: 85,
      remaining: 75,
      severity: 'warning',
    };
    const exceededAlert: BudgetAlert = {
      budgetId: 'b2',
      budgetName: 'Travel',
      percentUsed: 110,
      remaining: 0,
      severity: 'exceeded',
    };

    it('subscribes to budgets once, not again on each period change', () => {
      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onPeriodChange();
      fixture.componentInstance.onPeriodChange();
      expect(budgetService.getBudgets).toHaveBeenCalledTimes(1);
    });

    it('stops listening to budget emissions once the component is destroyed', () => {
      const budgets$ = new Subject<unknown[]>();
      const seen: unknown[] = [];
      budgetService.getBudgets.and.returnValue(budgets$);
      const fixture = build();
      fixture.detectChanges();
      expect(budgets$.observed).toBeTrue();

      fixture.destroy();
      budgets$.next(seen);
      expect(budgets$.observed).toBeFalse();
    });

    // Alert presentation itself (message, severity, dismissal, announce)
    // lives in BudgetAlertBannerComponent and is covered by its own spec.
    it('exposes the alerts signal the banner consumes', () => {
      budgetService.budgetAlerts.set([warningAlert, exceededAlert]);
      build().detectChanges();
      expect(budgetService.budgetAlerts()).toEqual([warningAlert, exceededAlert]);
    });
  });

  describe('financial summary bindings (real template)', () => {
    beforeEach(async () => {
      // The shared TestBed above blanks the template, so it cannot catch the
      // [previousIncome]/[previousExpenses] bindings being swapped or
      // dropped. Re-configure to render the REAL dashboard template, with
      // the summary component swapped for an input-capturing stub and the
      // remaining heavy children left to NO_ERRORS_SCHEMA.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DashboardComponent],
        providers: [
          provideNoopAnimations(),
          { provide: TransactionService, useValue: transactionService },
          { provide: BudgetService, useValue: budgetService },
          { provide: CategoryService, useValue: categoryService },
          { provide: RecurringService, useValue: recurringService },
          { provide: CurrencyService, useValue: currencyService },
          { provide: AuthService, useValue: authService },
          { provide: TranslationService, useValue: translation },
          { provide: MatSnackBar, useValue: snackBar },
          { provide: AnnouncerService, useValue: announcer },
        ],
      })
        .overrideComponent(DashboardComponent, {
          remove: {
            imports: [
              FinancialSummaryComponent,
              SpendingChartComponent,
              RecentTransactionsComponent,
              BudgetProgressComponent,
              AiSummaryComponent,
              LoadingSpinnerComponent,
              BudgetAlertBannerComponent,
            ],
          },
          add: { imports: [FinancialSummaryStubComponent], schemas: [NO_ERRORS_SCHEMA] },
        })
        .compileComponents();
    });

    it('binds current and previous period totals to app-financial-summary', () => {
      transactionService.getPeriodCategoryTotals.and.returnValue(
        of({ income: 1234, expense: 567, byCategory: [] }),
      );
      transactionService.transactions.set([
        createTransaction({ type: 'income', amount: 1000 }),
        createTransaction({ type: 'expense', amount: 600 }),
      ]);

      const fixture = build();
      fixture.detectChanges();

      const stub = fixture.debugElement.query(By.directive(FinancialSummaryStubComponent))
        ?.componentInstance as FinancialSummaryStubComponent;
      expect(stub).withContext('app-financial-summary rendered').toBeTruthy();
      expect(stub.income()).toBe(1000);
      expect(stub.expenses()).toBe(600);
      expect(stub.balance()).toBe(400);
      expect(stub.currency()).toBe('USD');
      // Distinct values catch both a swap and a drop of the two previous-
      // period bindings that drive the delta chips.
      expect(stub.previousIncome()).toBe(1234);
      expect(stub.previousExpenses()).toBe(567);
    });
  });
});
