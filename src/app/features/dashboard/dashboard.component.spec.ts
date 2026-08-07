import { TestBed } from '@angular/core/testing';
import { Component, input, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
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
import { GoalService } from '../../core/services/goal.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { RecurringService } from '../../core/services/recurring.service';
import { InsightSnapshotService } from '../../core/services/insight-snapshot.service';
import { TranslationService } from '../../core/services/translation.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { BudgetAlert, Transaction, User } from '../../models';
import { createTransaction, createCategory, createUser } from '../../core/services/testing';
import {
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';
import { wholeDaysBetween } from '../../core/utils/transaction-date.utils';

function selection(option: PeriodSelection['option'], start: Date, end: Date): PeriodSelection {
  return { option, start, end, label: '' };
}

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
  let goalService: { activeGoals: ReturnType<typeof signal<unknown[]>>; getGoals: jasmine.Spy };
  let categoryService: { categories: ReturnType<typeof signal<unknown[]>>; loadCategories: jasmine.Spy };
  let recurringService: { catchUpRecurringTransactions: jasmine.Spy };
  let insightSnapshotService: { generateClosedMonths: jasmine.Spy };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;

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
    goalService = {
      activeGoals: signal<unknown[]>([]),
      getGoals: jasmine.createSpy('getGoals').and.returnValue(of([])),
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
    // Root-provided, so without this the real service is constructed and its
    // Firestore injection fails.
    insightSnapshotService = {
      generateClosedMonths: jasmine
        .createSpy('generateClosedMonths')
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
    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply', 'consume']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: BudgetService, useValue: budgetService },
        { provide: GoalService, useValue: goalService },
        { provide: CategoryService, useValue: categoryService },
        { provide: RecurringService, useValue: recurringService },
        { provide: InsightSnapshotService, useValue: insightSnapshotService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: AuthService, useValue: authService },
        { provide: TranslationService, useValue: translation },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
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

    it('keeps the initial spinner up until the first window snapshot lands', () => {
      const window$ = new Subject<unknown[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.showInitialSpinner()).toBeTrue();

      window$.next([]);
      expect(fixture.componentInstance.isLoading()).toBeFalse();
      expect(fixture.componentInstance.showInitialSpinner()).toBeFalse();
    });

    it('a foreign publish to the shared signal cannot clear the spinner', () => {
      // The old constructor effect keyed on the signal's contents and cleared
      // the spinner before this component's own window had ever loaded.
      const window$ = new Subject<unknown[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();

      transactionService.transactions.set([{ id: 'foreign' } as never]);
      fixture.detectChanges();

      expect(fixture.componentInstance.showInitialSpinner()).toBeTrue();
    });

    it('reloads with the emitted range on a period selection', () => {
      const component = build().componentInstance;
      component.onPeriodSelection(selection('custom', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
      expect(lastRange().start).toEqual(new Date(2025, 3, 1));
      expect(lastRange().end).toEqual(new Date(2025, 3, 30, 23, 59, 59));
    });

    it('clamps periods extending into the future to end-of-today', () => {
      const component = build().componentInstance;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      component.onPeriodSelection(selection('thisMonth', monthStart, monthEnd));

      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      expect(lastRange().start).toEqual(monthStart);
      expect(lastRange().end.getTime()).toBeLessThanOrEqual(endOfToday.getTime());
      expect(lastRange().end.getDate()).toBe(now.getDate());
    });

    it('stores previous-period comparison data', () => {
      transactionService.getPeriodCategoryTotals.and.returnValue(
        of({ income: 10, expense: 5, byCategory: [{ categoryId: 'food', total: 5 }] }),
      );
      const component = build().componentInstance;
      component.onPeriodSelection(defaultPeriodSelection());
      expect(component.previousPeriodData()).toEqual({ income: 10, expense: 5 });
      expect(component.previousPeriodByCategory()?.length).toBe(1);
    });

    it('compares a custom month with the month before it', () => {
      const component = build().componentInstance;
      component.onPeriodSelection(selection('custom', new Date(2025, 0, 1), new Date(2025, 0, 31, 23, 59, 59)));

      const prevArgs = transactionService.getPeriodCategoryTotals.calls.mostRecent().args;
      expect(prevArgs[0]).toEqual(new Date(2024, 11, 1));
      expect((prevArgs[1] as Date).getMonth()).toBe(11);
    });

    it('compares a custom year with the year before it', () => {
      const component = build().componentInstance;
      component.onPeriodSelection(selection('custom', new Date(2025, 0, 1), new Date(2025, 11, 31, 23, 59, 59)));

      const prevArgs = transactionService.getPeriodCategoryTotals.calls.mostRecent().args;
      expect(prevArgs[0]).toEqual(new Date(2024, 0, 1));
      expect((prevArgs[1] as Date).getFullYear()).toBe(2024);
    });

    it('clears comparison data on error', () => {
      transactionService.getPeriodCategoryTotals.and.returnValue(throwError(() => new Error('x')));
      const component = build().componentInstance;
      component.onPeriodSelection(defaultPeriodSelection());
      expect(component.previousPeriodData()).toBeNull();
    });

    // The current window is clamped to end-of-today, so its comparison
    // window must stop at the same elapsed offset — part of a month against
    // all of the previous one reads as a large false decline.
    describe('previous window truncation mid-period', () => {
      beforeEach(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(2026, 7, 10, 12, 0));
      });

      afterEach(() => {
        jasmine.clock().uninstall();
      });

      function previousRange() {
        const args = transactionService.getPeriodCategoryTotals.calls.mostRecent().args;
        return { start: args[0] as Date, end: args[1] as Date };
      }

      it('compares this month so far with the same days of last month', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'thisMonth', new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59)));

        expect(previousRange().start).toEqual(new Date(2026, 6, 1));
        expect(previousRange().end).toEqual(new Date(2026, 6, 10, 23, 59, 59));
      });

      it('gives both windows the same number of elapsed days', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'thisMonth', new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59)));

        const current = lastRange();
        const previous = previousRange();
        expect(wholeDaysBetween(previous.start, previous.end))
          .toBe(wholeDaysBetween(current.start, current.end));
      });

      it('compares this year so far with the same span of last year', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'thisYear', new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59, 59)));

        expect(previousRange().start).toEqual(new Date(2025, 0, 1));
        expect(previousRange().end).toEqual(new Date(2025, 7, 10, 23, 59, 59));
      });

      it('truncates the three-month comparison the same way', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'last3Months', new Date(2026, 5, 1), new Date(2026, 7, 31, 23, 59, 59)));

        expect(previousRange().end).toEqual(new Date(2026, 4, 10, 23, 59, 59));
      });

      it('keeps whole-month semantics for a complete past window', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'custom', new Date(2025, 0, 1), new Date(2025, 0, 31, 23, 59, 59)));

        expect(previousRange().start).toEqual(new Date(2024, 11, 1));
        expect(previousRange().end).toEqual(new Date(2024, 11, 31, 23, 59, 59));
      });
    });
  });

  describe('historical baseline window', () => {
    function baselineRange() {
      const args = transactionService.getExpensesInRange.calls.mostRecent().args;
      return { start: args[0] as Date, end: args[1] as Date };
    }

    function setLevel(preferences: Partial<User['preferences']>) {
      authService.currentUser.set(createUser({ preferences: preferences as User['preferences'] }));
    }

    it('skips the query entirely at level off', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();
      expect(fixture.componentInstance.historicalExpenses()).toBeNull();
    });

    it('skips the query at level light, which has no anomaly section', () => {
      setLevel({ ragInsightsLevel: 'light' });
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();
    });

    it('queries a 6-month window at standard, including for the legacy boolean', () => {
      setLevel({ enableRagInsights: true });
      const fixture = build();
      fixture.detectChanges();
      const now = new Date();
      expect(baselineRange().start).toEqual(new Date(now.getFullYear(), now.getMonth() - 6, 1));
    });

    it('queries a 12-month window at deep', () => {
      setLevel({ ragInsightsLevel: 'deep' });
      const fixture = build();
      fixture.detectChanges();
      const now = new Date();
      expect(baselineRange().start).toEqual(new Date(now.getFullYear(), now.getMonth() - 12, 1));
    });

    it('refetches with the new window when the tier changes mid-session', () => {
      setLevel({ ragInsightsLevel: 'light' });
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();

      setLevel({ ragInsightsLevel: 'deep' });
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).toHaveBeenCalled();
      const now = new Date();
      expect(baselineRange().start).toEqual(new Date(now.getFullYear(), now.getMonth() - 12, 1));
    });

    it('reloads the baseline when the period changes', () => {
      setLevel({ ragInsightsLevel: 'standard' });
      const fixture = build();
      fixture.detectChanges();
      transactionService.getExpensesInRange.calls.reset();

      fixture.componentInstance.onPeriodSelection(
        selection('custom', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
      fixture.detectChanges();
      expect(baselineRange().end).toEqual(new Date(2025, 3, 30, 23, 59, 59));
    });

    it('clears the baseline when the query fails', () => {
      setLevel({ ragInsightsLevel: 'standard' });
      transactionService.getExpensesInRange.and.returnValue(throwError(() => new Error('x')));
      const fixture = build();
      fixture.detectChanges();
      expect(fixture.componentInstance.historicalExpenses()).toBeNull();
    });
  });

  describe('recurring catch-up', () => {
    it('triggers the catch-up once on init, not again on period changes', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(recurringService.catchUpRecurringTransactions).toHaveBeenCalledTimes(1);

      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      expect(recurringService.catchUpRecurringTransactions).toHaveBeenCalledTimes(1);
    });

    it('triggers snapshot generation once on init, not again on period changes', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(insightSnapshotService.generateClosedMonths).toHaveBeenCalledTimes(1);

      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      expect(insightSnapshotService.generateClosedMonths).toHaveBeenCalledTimes(1);
    });

    it('still loads the dashboard when snapshot generation fails', async () => {
      insightSnapshotService.generateClosedMonths.and.returnValue(
        Promise.reject(new Error('offline')),
      );
      const fixture = build();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance).toBeTruthy();
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
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
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

  describe('period-scoped listener lifecycle', () => {
    // Each spy hands out a fresh never-completing Subject per call, the shape
    // of the real Firestore wrappers: the only way a listener is released is
    // an explicit unsubscribe, so `observed` tells the truth about leaks.
    function trackSubjects(spy: jasmine.Spy): Subject<unknown>[] {
      const created: Subject<unknown>[] = [];
      spy.and.callFake(() => {
        const subject = new Subject<unknown>();
        created.push(subject);
        return subject;
      });
      return created;
    }

    function trackAllStreams() {
      // Standard tier so the anomaly-baseline stream participates too.
      authService.currentUser.set(
        createUser({ preferences: { ragInsightsLevel: 'standard' } as User['preferences'] }));
      return {
        byRange: trackSubjects(transactionService.getByDateRange),
        recent: trackSubjects(transactionService.getRecentTransactions),
        prevTotals: trackSubjects(transactionService.getPeriodCategoryTotals),
        baseline: trackSubjects(transactionService.getExpensesInRange),
      };
    }

    it('holds at most one live listener per stream across ten period changes', () => {
      const streams = trackAllStreams();
      const fixture = build();
      fixture.detectChanges();

      for (let i = 0; i < 10; i++) {
        fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
        fixture.detectChanges();
      }

      for (const created of Object.values(streams)) {
        expect(created.length).toBeGreaterThan(1);
        expect(created.filter(s => s.observed).length).toBe(1);
        expect(created[created.length - 1].observed).toBeTrue();
      }
    });

    it('releases every period-scoped listener on destroy', () => {
      const streams = trackAllStreams();
      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      fixture.detectChanges();

      fixture.destroy();

      for (const created of Object.values(streams)) {
        expect(created.some(s => s.observed)).toBeFalse();
      }
    });

    it('subscribes to categories once, not again on each period change', () => {
      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      expect(categoryService.loadCategories).toHaveBeenCalledTimes(1);
    });
  });

  describe('spending-chart drill-down', () => {
    it('hands the category and the shown period to the transactions page', () => {
      const component = build().componentInstance;
      component.onPeriodSelection(
        selection('custom', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));

      component.onCategoryActivated('cat1');

      expect(pendingFilters.apply).toHaveBeenCalledWith({
        categoryId: 'cat1',
        type: 'expense',
        startDate: new Date(2025, 3, 1),
        endDate: new Date(2025, 3, 30, 23, 59, 59),
      });
      expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
    });

    it('clamps a future-running period the same way the chart data does', () => {
      const component = build().componentInstance;
      const now = new Date();
      component.onPeriodSelection(
        selection(
          'thisMonth',
          new Date(now.getFullYear(), now.getMonth(), 1),
          new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)));

      component.onCategoryActivated('cat1');

      // A filter running past today would show a wider window than the slice
      // that was clicked was computed from.
      const filters = pendingFilters.apply.calls.mostRecent().args[0];
      expect(filters.endDate?.getDate()).toBe(now.getDate());
      expect(filters.startDate).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
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
          { provide: GoalService, useValue: goalService },
        { provide: GoalService, useValue: goalService },
          { provide: CategoryService, useValue: categoryService },
          { provide: RecurringService, useValue: recurringService },
          { provide: InsightSnapshotService, useValue: insightSnapshotService },
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
