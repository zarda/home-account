import { TestBed } from '@angular/core/testing';
import { Component, input, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of, Subject, throwError, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DashboardComponent } from './dashboard.component';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { UpcomingBillsComponent } from './upcoming-bills/upcoming-bills.component';
import { WeeklyRecapComponent } from './weekly-recap/weekly-recap.component';
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
import { WidgetSnapshotService } from '../../core/services/widget-snapshot.service';
import { BudgetAlert, Category, RecurringOccurrence, Transaction, User } from '../../models';
import { createTransaction, createCategory, createUser } from '../../core/services/testing';
import {
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';
import { wholeDaysBetween } from '../../core/utils/transaction-date.utils';
import { dashboardGridAreas } from './dashboard-layout.utils';

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

// Stands in for the real upcoming-bills card when the real dashboard template
// is rendered, capturing exactly what the template binds to each input.
@Component({ selector: 'app-upcoming-bills', standalone: true, template: '' })
class UpcomingBillsStubComponent {
  occurrences = input<RecurringOccurrence[]>([]);
  categories = input<Map<string, Category>>(new Map());
  baseCurrency = input<string>('USD');
  net = input<number>(0);
}

// Same for the weekly recap card. The real one injects WeeklyRecapService,
// which reaches Firestore, so it is swapped out here rather than provided for.
@Component({ selector: 'app-weekly-recap', standalone: true, template: '' })
class WeeklyRecapStubComponent {
  alerts = input<BudgetAlert[]>([]);
  upcoming = input<RecurringOccurrence[]>([]);
  baseCurrency = input<string>('USD');
  categories = input<Map<string, Category>>(new Map());
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
  let recurringService: {
    catchUpRecurringTransactions: jasmine.Spy;
    getNextOccurrences: jasmine.Spy;
  };
  let insightSnapshotService: { generateClosedMonths: jasmine.Spy };
  let authService: { currentUser: ReturnType<typeof signal<User | null>> };
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let widgetSnapshots: jasmine.SpyObj<WidgetSnapshotService>;

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
      getNextOccurrences: jasmine.createSpy('getNextOccurrences').and.returnValue(of([])),
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
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    router.navigate.and.returnValue(Promise.resolve(true));
    // Root-provided and reaches AppLockService, which throws on this suite's
    // userId-less AuthService double — doubled here rather than left real.
    widgetSnapshots = jasmine.createSpyObj('WidgetSnapshotService', ['publish']);

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
        { provide: WidgetSnapshotService, useValue: widgetSnapshots },
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

    it('rounds totals at the fold boundary through the shared sumByType', () => {
      // 0.1 + 0.2 must come out exactly 0.3 — roundMoney at the fold
      // boundary, not float dust left for Intl to format away.
      transactionService.transactions.set([
        createTransaction({ type: 'expense', amount: 0.1, amountInBaseCurrency: 0.1 }),
        createTransaction({ type: 'expense', amount: 0.2, amountInBaseCurrency: 0.2 }),
      ]);
      expect(build().componentInstance.totalExpenses()).toBe(0.3);
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

    // #259: the AI summary keys its request on this label and describes the rows
    // it is handed, so the two must flip together or it summarises one period
    // using another's data — and caches the answer under the wrong key.
    it('publishes the period only when the rows for it arrive', () => {
      const window$ = new Subject<unknown[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);

      const component = fixture.componentInstance;
      expect(component.publishedPeriodOption()).toBe(defaultPeriodSelection().option);

      const next$ = new Subject<unknown[]>();
      transactionService.getByDateRange.and.returnValue(next$);
      component.onPeriodSelection(selection(
        'lastMonth', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));

      // The selector has moved; the rows have not.
      expect(component.publishedPeriodOption()).toBe(defaultPeriodSelection().option);

      next$.next([]);
      expect(component.publishedPeriodOption()).toBe('lastMonth');
    });

    it('leaves the published period alone when the load fails', () => {
      const fixture = build();
      fixture.detectChanges();
      const component = fixture.componentInstance;

      transactionService.getByDateRange.and.returnValue(throwError(() => new Error('offline')));
      component.onPeriodSelection(selection(
        'lastMonth', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));

      // The previous period's rows are still on screen, so the summary should
      // keep describing them rather than relabelling them.
      expect(component.publishedPeriodOption()).toBe(defaultPeriodSelection().option);
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
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      component.onPeriodSelection(selection('thisMonth', monthStart, monthEnd));

      const endOfToday =
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
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
          'thisMonth', new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59, 999)));

        expect(previousRange().start).toEqual(new Date(2026, 6, 1));
        expect(previousRange().end).toEqual(new Date(2026, 6, 10, 23, 59, 59, 999));
      });

      it('gives both windows the same number of elapsed days', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'thisMonth', new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59, 999)));

        const current = lastRange();
        const previous = previousRange();
        expect(wholeDaysBetween(previous.start, previous.end))
          .toBe(wholeDaysBetween(current.start, current.end));
      });

      it('compares this year so far with the same span of last year', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'thisYear', new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59, 59, 999)));

        expect(previousRange().start).toEqual(new Date(2025, 0, 1));
        expect(previousRange().end).toEqual(new Date(2025, 7, 10, 23, 59, 59, 999));
      });

      it('truncates the three-month comparison the same way', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'last3Months', new Date(2026, 5, 1), new Date(2026, 7, 31, 23, 59, 59, 999)));

        expect(previousRange().end).toEqual(new Date(2026, 4, 10, 23, 59, 59, 999));
      });

      it('keeps whole-month semantics for a complete past window', () => {
        const component = build().componentInstance;
        component.onPeriodSelection(selection(
          'custom', new Date(2025, 0, 1), new Date(2025, 0, 31, 23, 59, 59, 999)));

        expect(previousRange().start).toEqual(new Date(2024, 11, 1));
        expect(previousRange().end).toEqual(new Date(2024, 11, 31, 23, 59, 59, 999));
      });
    });
  });

  describe('card arrangement', () => {
    it('defaults to the four cards before budgets, with no active budget', () => {
      expect(build().componentInstance.arrangedCards())
        .toEqual(['recent', 'upcoming', 'chart', 'insights']);
    });

    it('adds budgets once there is an active budget', () => {
      budgetService.activeBudgets.set([{} as never]);
      expect(build().componentInstance.arrangedCards())
        .toEqual(['recent', 'upcoming', 'chart', 'insights', 'budgets']);
    });

    it('follows a stored layout, dropping the hidden card', () => {
      budgetService.activeBudgets.set([{} as never]);
      authService.currentUser.set(createUser({
        preferences: {
          dashboardLayout: {
            order: ['budgets', 'chart', 'recent', 'upcoming', 'insights'],
            hidden: ['insights'],
          },
        } as User['preferences'],
      }));

      expect(build().componentInstance.arrangedCards())
        .toEqual(['budgets', 'chart', 'recent', 'upcoming']);
    });

    it('computes grid areas from the arranged cards', () => {
      const component = build().componentInstance;
      expect(component.gridAreas()).toBe(dashboardGridAreas(component.arrangedCards()));
    });

    it('is empty when only budgets is arranged and there is no active budget', () => {
      authService.currentUser.set(createUser({
        preferences: {
          dashboardLayout: {
            order: ['budgets'],
            hidden: ['recent', 'upcoming', 'chart', 'insights'],
          },
        } as User['preferences'],
      }));

      expect(build().componentInstance.arrangedCards()).toEqual([]);
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

    // Hidden means composing nothing, not just an unrendered card (#87): a
    // level that would otherwise ground insights must still skip the query
    // and drop any listener it already opened.
    it('never queries the baseline while insights is hidden', () => {
      setLevel({ ragInsightsLevel: 'standard', dashboardLayout: { order: [], hidden: ['insights'] } });
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();
      expect(fixture.componentInstance.historicalExpenses()).toBeNull();
    });

    it('releases an open baseline listener when insights is hidden', () => {
      setLevel({ ragInsightsLevel: 'standard' });
      const baseline$ = new Subject<Transaction[]>();
      transactionService.getExpensesInRange.and.returnValue(baseline$);
      const fixture = build();
      fixture.detectChanges();
      expect(baseline$.observed).toBeTrue();

      setLevel({ ragInsightsLevel: 'standard', dashboardLayout: { order: [], hidden: ['insights'] } });
      fixture.detectChanges();

      expect(baseline$.observed).toBeFalse();
      expect(fixture.componentInstance.historicalExpenses()).toBeNull();
    });

    it('queries the baseline again once insights is shown again', () => {
      setLevel({ ragInsightsLevel: 'standard', dashboardLayout: { order: [], hidden: ['insights'] } });
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();

      setLevel({ ragInsightsLevel: 'standard' });
      fixture.detectChanges();

      expect(transactionService.getExpensesInRange).toHaveBeenCalled();
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

  describe('upcoming bills', () => {
    function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
      return {
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
        ...overrides,
      };
    }

    it('opens the occurrence window once, not again on each period change', () => {
      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());

      expect(recurringService.getNextOccurrences).toHaveBeenCalledTimes(1);
      expect(recurringService.getNextOccurrences).toHaveBeenCalledWith(14);
    });

    it('stops listening to occurrence emissions once the component is destroyed', () => {
      const occurrences$ = new Subject<RecurringOccurrence[]>();
      recurringService.getNextOccurrences.and.returnValue(occurrences$);
      const fixture = build();
      fixture.detectChanges();
      expect(occurrences$.observed).toBeTrue();

      fixture.destroy();
      expect(occurrences$.observed).toBeFalse();
    });

    it('publishes the occurrences the card renders', () => {
      const rent = occurrence();
      recurringService.getNextOccurrences.and.returnValue(of([rent]));
      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingOccurrences()).toEqual([rent]);
    });

    // A scheduled occurrence has no write-time base-currency snapshot, so the
    // net is the one figure on this card that must be converted live — and it
    // has to add unlike currencies with income on the positive side.
    it('converts each occurrence to base currency and signs income positive', () => {
      currencyService.convert.and.callFake(
        (amount: number, from: string) => (from === 'JPY' ? amount / 100 : amount));
      recurringService.getNextOccurrences.and.returnValue(of([
        occurrence({ recurringId: 'r1', type: 'expense', amount: 1200, currency: 'USD' }),
        occurrence({ recurringId: 'r2', type: 'income', amount: 380000, currency: 'JPY' }),
      ]));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingNet()).toBe(2600);
      expect(currencyService.convert).toHaveBeenCalledWith(380000, 'JPY', 'USD');
    });

    it('rounds the net at the fold boundary', () => {
      recurringService.getNextOccurrences.and.returnValue(of([
        occurrence({ recurringId: 'r1', type: 'expense', amount: 0.1 }),
        occurrence({ recurringId: 'r2', type: 'expense', amount: 0.2 }),
      ]));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingNet()).toBe(-0.3);
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

  describe('widget snapshot publishing', () => {
    // Every case flushes the constructor effect with TestBed.tick(): the
    // signal writes below happen outside a template binding, so nothing else
    // schedules it.
    it('publishes the figures once the this-month window loads', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      transactionService.transactions.set([
        createTransaction({ type: 'income', amount: 1000 }),
        createTransaction({ type: 'expense', amount: 400 }),
      ]);
      const budgets = [{ id: 'b1' } as never];
      budgetService.activeBudgets.set(budgets);
      const rent: RecurringOccurrence = {
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
      };
      const upcoming = [rent];
      recurringService.getNextOccurrences.and.returnValue(of(upcoming));

      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();

      // Literal figures, not the component's own signals: income 1000 minus
      // expense 400 seeded above.
      expect(widgetSnapshots.publish).toHaveBeenCalledOnceWith({
        spent: 400,
        net: 600,
        baseCurrency: 'USD',
        budgets,
        upcoming,
      });
    });

    it('does not publish again when the rows that arrive belong to another period', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();
      widgetSnapshots.publish.calls.reset();

      const next$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(next$);
      fixture.componentInstance.onPeriodSelection(selection(
        'lastMonth', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
      next$.next([]);
      TestBed.tick();

      expect(widgetSnapshots.publish).not.toHaveBeenCalled();
    });

    // The `publishedPeriodOption() !== 'thisMonth'` guard is what
    // stops a budget or occurrence change from republishing while parked on
    // another period. Switching periods alone touches none of the effect's
    // tracked signals, so the case above never runs the effect again to
    // exercise it — this one changes activeBudgets and upcomingOccurrences
    // directly, after the switch, to force that.
    it('does not republish when tracked signals change while parked on another period', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const occurrences$ = new Subject<RecurringOccurrence[]>();
      recurringService.getNextOccurrences.and.returnValue(occurrences$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();
      expect(widgetSnapshots.publish).toHaveBeenCalledTimes(1);

      const next$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(next$);
      fixture.componentInstance.onPeriodSelection(selection(
        'lastMonth', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
      next$.next([]);
      TestBed.tick();
      expect(fixture.componentInstance.publishedPeriodOption()).toBe('lastMonth');

      budgetService.activeBudgets.set([{ id: 'b1' } as never]);
      TestBed.tick();

      const rent: RecurringOccurrence = {
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
      };
      occurrences$.next([rent]);
      TestBed.tick();

      expect(widgetSnapshots.publish).toHaveBeenCalledTimes(1);
    });

    it('publishes nothing when the first load errors', () => {
      transactionService.getByDateRange.and.returnValue(throwError(() => new Error('offline')));
      const fixture = build();
      fixture.detectChanges();
      TestBed.tick();

      expect(widgetSnapshots.publish).not.toHaveBeenCalled();
    });

    // The publishing effect's own rule: a write to the shared signal must not be
    // mistaken for a paint of this component's own window.
    it('a foreign write to the shared transactions signal does not republish', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();
      widgetSnapshots.publish.calls.reset();

      transactionService.transactions.set([{ id: 'foreign' } as never]);
      fixture.detectChanges();
      TestBed.tick();

      expect(widgetSnapshots.publish).not.toHaveBeenCalled();
    });

    it('republishes when the active budgets change while on this month', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();
      widgetSnapshots.publish.calls.reset();

      budgetService.activeBudgets.set([{ id: 'b1' } as never]);
      TestBed.tick();

      expect(widgetSnapshots.publish).toHaveBeenCalledTimes(1);
    });

    it('republishes on a second successful emission of the period stream', () => {
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();
      widgetSnapshots.publish.calls.reset();

      window$.next([]);
      TestBed.tick();

      expect(widgetSnapshots.publish).toHaveBeenCalledTimes(1);
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

  describe('child bindings (real template)', () => {
    beforeEach(async () => {
      // The shared TestBed above blanks the template, so it cannot catch the
      // [previousIncome]/[previousExpenses] or upcoming-bills bindings being
      // swapped or dropped. Re-configure to render the REAL dashboard
      // template, with those two components swapped for input-capturing stubs
      // and the remaining heavy children left to NO_ERRORS_SCHEMA.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DashboardComponent],
        providers: [
          provideNoopAnimations(),
          provideRouter([]),
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
          { provide: WidgetSnapshotService, useValue: widgetSnapshots },
        ],
      })
        .overrideComponent(DashboardComponent, {
          remove: {
            imports: [
              FinancialSummaryComponent,
              SpendingChartComponent,
              RecentTransactionsComponent,
              UpcomingBillsComponent,
              BudgetProgressComponent,
              AiSummaryComponent,
              LoadingSpinnerComponent,
              BudgetAlertBannerComponent,
              WeeklyRecapComponent,
            ],
          },
          add: {
            imports: [
              FinancialSummaryStubComponent,
              UpcomingBillsStubComponent,
              WeeklyRecapStubComponent,
            ],
            schemas: [NO_ERRORS_SCHEMA],
          },
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

    it('binds the window occurrences, categories, base currency and net to app-upcoming-bills', () => {
      const rent: RecurringOccurrence = {
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
      };
      recurringService.getNextOccurrences.and.returnValue(of([rent]));
      authService.currentUser.set(
        createUser({ preferences: { baseCurrency: 'JPY' } as User['preferences'] }));

      const fixture = build();
      fixture.detectChanges();

      const stub = fixture.debugElement.query(By.directive(UpcomingBillsStubComponent))
        ?.componentInstance as UpcomingBillsStubComponent;
      expect(stub).withContext('app-upcoming-bills rendered').toBeTruthy();
      expect(stub.occurrences()).toEqual([rent]);
      expect(stub.categories().get('food')).toBeTruthy();
      // A currency other than the USD fallback, and a net distinct from every
      // other money computed on the page, catch a binding pointed elsewhere.
      expect(stub.baseCurrency()).toBe('JPY');
      expect(stub.net()).toBe(-1200);
    });

    it('binds the alerts, the upcoming window, base currency and categories to app-weekly-recap', () => {
      const rent: RecurringOccurrence = {
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
      };
      const alert: BudgetAlert = {
        budgetId: 'b1',
        budgetName: 'Groceries',
        percentUsed: 120,
        remaining: 0,
        severity: 'exceeded',
      };
      recurringService.getNextOccurrences.and.returnValue(of([rent]));
      budgetService.budgetAlerts.set([alert]);
      authService.currentUser.set(
        createUser({ preferences: { baseCurrency: 'JPY' } as User['preferences'] }));

      const fixture = build();
      fixture.detectChanges();

      const stub = fixture.debugElement.query(By.directive(WeeklyRecapStubComponent))
        ?.componentInstance as WeeklyRecapStubComponent;
      expect(stub).withContext('app-weekly-recap rendered').toBeTruthy();
      expect(stub.alerts()).toEqual([alert]);
      expect(stub.upcoming()).toEqual([rent]);
      expect(stub.baseCurrency()).toBe('JPY');
      expect(stub.categories().get('food')).toBeTruthy();
    });

    it('renders the grid children in the account default order', () => {
      const fixture = build();
      fixture.detectChanges();

      const tags = Array.from(fixture.nativeElement.querySelectorAll('.dashboard-grid > *'))
        .map((el) => (el as Element).tagName.toLowerCase());
      // No active budget in this suite's default fixture, so the fifth card
      // never joins the arrangement — see the "card arrangement" describe.
      expect(tags).toEqual([
        'app-recent-transactions',
        'app-upcoming-bills',
        'app-spending-chart',
        'app-ai-summary',
      ]);
    });

    it('omits app-ai-summary entirely when insights is hidden', () => {
      // A contextually-typed local, not an inline `as` cast: an empty array
      // literal inside an assertion widens to never[] and no longer overlaps
      // DashboardCardId[].
      const preferences: Partial<User['preferences']> = { dashboardLayout: { order: [], hidden: ['insights'] } };
      authService.currentUser.set(createUser({ preferences: preferences as User['preferences'] }));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-ai-summary')).toBeNull();
    });

    it('binds the computed grid areas as a custom property', () => {
      const fixture = build();
      fixture.detectChanges();

      const grid: HTMLElement = fixture.nativeElement.querySelector('.dashboard-grid');
      expect(grid.style.getPropertyValue('--dashboard-areas')).toBe(fixture.componentInstance.gridAreas());
    });

    it('links the customize anchor to the dashboard panel in settings', () => {
      const fixture = build();
      fixture.detectChanges();

      const link = fixture.nativeElement.querySelector('.customize-link');
      expect(link.getAttribute('href')).toBe('/settings?panel=dashboard');
      expect(link.textContent).toContain('dashboard.customize');
    });

    it('shows the empty state instead of the grid when nothing is arranged', () => {
      authService.currentUser.set(createUser({
        preferences: {
          dashboardLayout: {
            order: ['budgets'],
            hidden: ['recent', 'upcoming', 'chart', 'insights'],
          },
        } as User['preferences'],
      }));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.dashboard-grid')).toBeNull();
      const empty = fixture.nativeElement.querySelector('.dashboard-empty');
      expect(empty).toBeTruthy();
      expect(empty.textContent).toContain('dashboard.noCardsShown');
      const link = empty.querySelector('.customize-link');
      expect(link.getAttribute('href')).toBe('/settings?panel=dashboard');
    });
  });
});
