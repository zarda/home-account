import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, NO_ERRORS_SCHEMA, output, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ActivatedRoute,
  NavigationExtras,
  ParamMap,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of, BehaviorSubject, Subject, throwError, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DashboardComponent } from './dashboard.component';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { RuleFocusOutcome, UpcomingBillsComponent } from './upcoming-bills/upcoming-bills.component';
import { WeeklyRecapComponent } from './weekly-recap/weekly-recap.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { GoalService } from '../../core/services/goal.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService, withPreferenceFields } from '../../core/services/auth.service';
import { RecurringService } from '../../core/services/recurring.service';
import { InsightSnapshotService } from '../../core/services/insight-snapshot.service';
import { TranslationService } from '../../core/services/translation.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { WidgetSnapshotService } from '../../core/services/widget-snapshot.service';
import { CloudLLMProviderService } from '../../core/services/cloud-llm-provider.service';
import { WeeklyRecapService } from '../../core/services/weekly-recap.service';
import {
  BudgetAlert,
  Category,
  DashboardCardId,
  RecurringOccurrence,
  Transaction,
  UpcomingSchedule,
  User,
} from '../../models';
import {
  createTransaction,
  createCategory,
  createUser,
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
  provideNoMotion,
} from '../../core/services/testing';
import {
  PeriodSelection,
  PeriodSelectorComponent,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';
import { wholeDaysBetween } from '../../core/utils/transaction-date.utils';
import { APP_BREAKPOINTS } from '../../core/layout/breakpoints';
import { dashboardGridAreas } from './dashboard-layout.utils';
import { DashboardLayoutService } from './dashboard-layout.service';
import { DashboardCardMenuComponent } from './dashboard-card-menu/dashboard-card-menu.component';

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
// is rendered, capturing exactly what the template binds to each input. It
// keeps the real card's menu slot, so the card's menu still renders.
@Component({
  selector: 'app-upcoming-bills',
  standalone: true,
  template: '<ng-content select="[card-actions]" />',
})
class UpcomingBillsStubComponent {
  occurrences = input<RecurringOccurrence[]>([]);
  categories = input<Map<string, Category>>(new Map());
  baseCurrency = input<string>('USD');
  net = input<number>(0);
  olderCount = input<number>(0);
  focusRuleId = input<string | null>(null);
  ruleFocus = output<RuleFocusOutcome>();
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
    getEarliestTransactionDateFromServer: () => Promise<Date | null>;
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
    getUpcomingSchedule: jasmine.Spy;
    getUpcomingScheduleFromServer: jasmine.Spy;
  };
  let insightSnapshotService: { generateClosedMonths: jasmine.Spy };
  let authService: {
    currentUser: ReturnType<typeof signal<User | null>>;
    updatePreferenceFields: jasmine.Spy;
  };
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let widgetSnapshots: jasmine.SpyObj<WidgetSnapshotService>;
  let cloudLLM: { hasAnyCloudProvider: ReturnType<typeof signal<boolean>> };
  let activatedRoute: { queryParamMap: BehaviorSubject<ParamMap> };
  let recap: {
    load: jasmine.Spy<() => Promise<void>>;
    weekKey: ReturnType<typeof signal<string>>;
    visible: ReturnType<typeof signal<boolean>>;
  };

  function build() {
    return TestBed.createComponent(DashboardComponent);
  }

  /**
   * Holds the next layout write until the returned function lands it; it then
   * lands as AuthService's does, merged into the user as it stands by then.
   */
  function holdLayoutWrite(): () => void {
    let land!: () => void;
    authService.updatePreferenceFields.and.callFake(async (key, fields) => {
      await new Promise<void>(resolve => (land = resolve));
      const latest = authService.currentUser()!;
      authService.currentUser.set({
        ...latest,
        preferences: withPreferenceFields(latest.preferences, key, fields),
      });
    });
    return () => land();
  }

  // Each call hands out a fresh never-completing Subject, the shape of the
  // real Firestore wrappers: the only way a listener is released is an
  // explicit unsubscribe, so `observed` tells the truth about leaks.
  function trackSubjects(spy: jasmine.Spy): Subject<unknown>[] {
    const created: Subject<unknown>[] = [];
    spy.and.callFake(() => {
      const subject = new Subject<unknown>();
      created.push(subject);
      return subject;
    });
    return created;
  }

  /** The device build: the widget plugin is present. */
  function withWidget(): void {
    const available = Object.getOwnPropertyDescriptor(widgetSnapshots, 'available')!.get as jasmine.Spy;
    available.and.returnValue(true);
  }

  function setPreferences(preferences: Partial<User['preferences']>): void {
    authService.currentUser.set(createUser({ preferences: preferences as User['preferences'] }));
  }

  function hiding(...hidden: DashboardCardId[]): Partial<User['preferences']> {
    return { dashboardLayout: { hidden } };
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
      getEarliestTransactionDateFromServer: () => Promise.resolve(null),
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
      getUpcomingSchedule: jasmine
        .createSpy('getUpcomingSchedule')
        .and.returnValue(of({ occurrences: [], olderCount: 0 })),
      getUpcomingScheduleFromServer: jasmine
        .createSpy('getUpcomingScheduleFromServer')
        .and.returnValue(Promise.resolve({ occurrences: [], olderCount: 0 })),
    };
    // Root-provided, so without this the real service is constructed and its
    // Firestore injection fails.
    insightSnapshotService = {
      generateClosedMonths: jasmine
        .createSpy('generateClosedMonths')
        .and.returnValue(Promise.resolve([])),
    };
    authService = {
      currentUser: signal<User | null>(createUser({ displayName: 'Ada Lovelace' })),
      updatePreferenceFields: jasmine.createSpy('updatePreferenceFields').and.resolveTo(),
    };
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
    widgetSnapshots = jasmine.createSpyObj('WidgetSnapshotService', ['publish'], { available: false });
    // Root-provided, and the real one constructs every provider's client.
    cloudLLM = { hasAnyCloudProvider: signal(false) };
    // Router is a spy here, so nothing else provides ActivatedRoute; the
    // real-template describe keeps provideRouter's root route instead.
    activatedRoute = { queryParamMap: new BehaviorSubject<ParamMap>(convertToParamMap({})) };
    // Root-provided, and the real one reads AuthService.userId, which this
    // suite's double does not have.
    recap = {
      load: jasmine.createSpy('load').and.resolveTo(),
      weekKey: signal('2026-09-21'),
      visible: signal(false),
    };

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
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: WidgetSnapshotService, useValue: widgetSnapshots },
        { provide: CloudLLMProviderService, useValue: cloudLLM },
        { provide: WeeklyRecapService, useValue: recap },
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

    // #438 P4: the category fold reports uses, so an exact tie ranks by id
    // rather than by whichever row the listener happened to deliver first.
    it('ranks an exact tie between categories by category id', () => {
      transactionService.transactions.set([
        createTransaction({ type: 'expense', amount: 50, categoryId: 'travel' }),
        createTransaction({ type: 'expense', amount: 50, categoryId: 'food' }),
      ]);
      const totals = build().componentInstance.categoryTotals();
      expect(totals.map(row => row.categoryId)).toEqual(['food', 'travel']);
    });

    it('rounds each category total at the fold boundary', () => {
      transactionService.transactions.set([
        createTransaction({ type: 'expense', amount: 0.1, categoryId: 'food' }),
        createTransaction({ type: 'expense', amount: 0.2, categoryId: 'food' }),
      ]);
      expect(build().componentInstance.categoryTotals()).toEqual([
        { categoryId: 'food', total: 0.3, count: 2 },
      ]);
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

    it('drops a card the layout service hides before the write lands', async () => {
      const land = holdLayoutWrite();
      const component = build().componentInstance;
      expect(component.arrangedCards()).toEqual(['recent', 'upcoming', 'chart', 'insights']);

      const saved = TestBed.inject(DashboardLayoutService).hide('chart');

      expect(authService.updatePreferenceFields).toHaveBeenCalledTimes(1);
      expect(component.arrangedCards()).toEqual(['recent', 'upcoming', 'insights']);

      land();
      await saved;

      expect(component.arrangedCards()).withContext('once the write lands').toEqual(['recent', 'upcoming', 'insights']);
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

  // The baseline's rule above, for the recent and upcoming listeners (#442):
  // a hidden card opens no listener that nothing else on the page reads.
  describe('listeners of hidden cards', () => {
    const rent: RecurringOccurrence = {
      recurringId: 'r1',
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'food',
      date: new Date(2026, 8, 1),
    };

    describe('recent', () => {
      it('never opens the recent listener while Recent is hidden, across period changes', () => {
        setPreferences(hiding('recent'));
        const fixture = build();
        fixture.detectChanges();
        fixture.componentInstance.onPeriodSelection(
          selection('custom', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
        fixture.detectChanges();

        expect(transactionService.getRecentTransactions).not.toHaveBeenCalled();
        expect(fixture.componentInstance.recentTransactions()).toEqual([]);
      });

      it('opens the recent listener once while Recent is shown, not again on each period change', () => {
        const fixture = build();
        fixture.detectChanges();
        fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
        fixture.componentInstance.onPeriodSelection(
          selection('custom', new Date(2025, 3, 1), new Date(2025, 3, 30, 23, 59, 59)));
        fixture.detectChanges();

        expect(transactionService.getRecentTransactions).toHaveBeenCalledOnceWith(5);
      });

      it('releases the recent listener when Recent is hidden, and opens a new one when it is shown again', () => {
        const created = trackSubjects(transactionService.getRecentTransactions);
        const fixture = build();
        fixture.detectChanges();
        created[0].next([createTransaction({ id: 't1' })]);
        expect(fixture.componentInstance.recentTransactions().length).toBe(1);

        setPreferences(hiding('recent'));
        fixture.detectChanges();

        expect(created[0].observed).withContext('the first listener once hidden').toBeFalse();
        expect(fixture.componentInstance.recentTransactions()).toEqual([]);

        setPreferences({});
        fixture.detectChanges();

        expect(created.length).withContext('recent listeners opened').toBe(2);
        expect(created[1].observed).toBeTrue();
      });

      it('closes the recent listener on a layout-service hide, before the write lands', async () => {
        const created = trackSubjects(transactionService.getRecentTransactions);
        const land = holdLayoutWrite();
        const fixture = build();
        fixture.detectChanges();
        expect(created[0].observed).toBeTrue();

        const saved = TestBed.inject(DashboardLayoutService).hide('recent');
        fixture.detectChanges();

        expect(authService.updatePreferenceFields).toHaveBeenCalledTimes(1);
        expect(created[0].observed).withContext('before the write lands').toBeFalse();

        land();
        await saved;
        fixture.detectChanges();

        expect(created.length).withContext('once the write lands').toBe(1);
        expect(created[0].observed).toBeFalse();
      });
    });

    describe('upcoming', () => {
      it('never opens the upcoming listener while Upcoming is hidden, the recap is off and there is no widget', () => {
        setPreferences(hiding('upcoming'));
        const fixture = build();
        fixture.detectChanges();

        expect(recurringService.getUpcomingSchedule).not.toHaveBeenCalled();
        expect(fixture.componentInstance.upcomingSchedule()).toEqual({ occurrences: [], olderCount: 0 });
      });

      // A pin: the recap lists the week ahead's bills from the same window.
      it('keeps the upcoming listener for the recap while Upcoming is hidden', () => {
        setPreferences({ ...hiding('upcoming'), enableWeeklyRecap: true });
        const fixture = build();
        fixture.detectChanges();

        expect(recurringService.getUpcomingSchedule).toHaveBeenCalledOnceWith(14);
      });

      // A pin: the widget publishes the next scheduled bill from the same window.
      it('keeps the upcoming listener for the widget while Upcoming is hidden', () => {
        withWidget();
        setPreferences(hiding('upcoming'));
        const fixture = build();
        fixture.detectChanges();

        expect(recurringService.getUpcomingSchedule).toHaveBeenCalledOnceWith(14);
      });

      it('releases the upcoming listener once nothing reads it, and opens a new one when the recap is turned on', () => {
        const created = trackSubjects(recurringService.getUpcomingSchedule);
        const fixture = build();
        fixture.detectChanges();
        created[0].next({ occurrences: [rent], olderCount: 2 });
        expect(fixture.componentInstance.upcomingOccurrences()).toEqual([rent]);

        setPreferences(hiding('upcoming'));
        fixture.detectChanges();

        expect(created[0].observed).withContext('the first listener once hidden').toBeFalse();
        expect(fixture.componentInstance.upcomingSchedule()).toEqual({ occurrences: [], olderCount: 0 });

        setPreferences({ ...hiding('upcoming'), enableWeeklyRecap: true });
        fixture.detectChanges();

        expect(created.length).withContext('upcoming listeners opened').toBe(2);
        expect(created[1].observed).toBeTrue();
      });
    });

    // A pin: each gate is a boolean, so only a change to its own card or reader
    // can reopen the listener behind it.
    it('keeps each listener through a change to another card or preference', () => {
      const fixture = build();
      fixture.detectChanges();

      setPreferences({ ...hiding('chart'), baseCurrency: 'JPY' });
      fixture.detectChanges();
      setPreferences({ ...hiding('chart', 'insights'), enableWeeklyRecap: true });
      fixture.detectChanges();

      expect(transactionService.getRecentTransactions).toHaveBeenCalledTimes(1);
      expect(recurringService.getUpcomingSchedule).toHaveBeenCalledTimes(1);
    });

    // A pin: budgets has a card, but the banner (which cannot be hidden), the
    // recap's alerts, insights, the widget and the reminder sweep all read the
    // list, so it stays ungated.
    it('subscribes to budgets exactly once, whatever is hidden', () => {
      setPreferences(hiding('recent', 'upcoming', 'chart', 'insights', 'budgets'));
      const fixture = build();
      fixture.detectChanges();
      setPreferences({});
      fixture.detectChanges();
      setPreferences(hiding('budgets'));
      fixture.detectChanges();

      expect(budgetService.getBudgets).toHaveBeenCalledTimes(1);
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

  describe('the period pickers\' floor read', () => {
    it('reads the oldest row\'s date once on init, not again on period changes', () => {
      const read = jasmine.createSpy('getEarliestTransactionDateFromServer').and.resolveTo(null);
      transactionService.getEarliestTransactionDateFromServer = read;
      const fixture = build();
      fixture.detectChanges();
      expect(read).toHaveBeenCalledTimes(1);

      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      expect(read).toHaveBeenCalledTimes(1);
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

      expect(recurringService.getUpcomingSchedule).toHaveBeenCalledTimes(1);
      expect(recurringService.getUpcomingSchedule).toHaveBeenCalledWith(14);
    });

    it('stops listening to occurrence emissions once the component is destroyed', () => {
      const occurrences$ = new Subject<UpcomingSchedule>();
      recurringService.getUpcomingSchedule.and.returnValue(occurrences$);
      const fixture = build();
      fixture.detectChanges();
      expect(occurrences$.observed).toBeTrue();

      fixture.destroy();
      expect(occurrences$.observed).toBeFalse();
    });

    it('publishes the occurrences the card renders', () => {
      const rent = occurrence();
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [rent], olderCount: 0 }));
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
      recurringService.getUpcomingSchedule.and.returnValue(of({
        occurrences: [
          occurrence({ recurringId: 'r1', type: 'expense', amount: 1200, currency: 'USD' }),
          occurrence({ recurringId: 'r2', type: 'income', amount: 380000, currency: 'JPY' }),
        ],
        olderCount: 0,
      }));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingNet()).toBe(2600);
      expect(currencyService.convert).toHaveBeenCalledWith(380000, 'JPY', 'USD');
    });

    it('rounds the net at the fold boundary', () => {
      recurringService.getUpcomingSchedule.and.returnValue(of({
        occurrences: [
          occurrence({ recurringId: 'r1', type: 'expense', amount: 0.1 }),
          occurrence({ recurringId: 'r2', type: 'expense', amount: 0.2 }),
        ],
        olderCount: 0,
      }));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingNet()).toBe(-0.3);
    });

    // The occurrences behind the floor are a count, not rows: the card names
    // them, and folding them into the net would make the figure disagree with
    // the days listed above it.
    it('folds only the shown occurrences into the net', () => {
      recurringService.getUpcomingSchedule.and.returnValue(of({
        occurrences: [occurrence({ recurringId: 'r1', type: 'expense', amount: 1200 })],
        olderCount: 5,
      }));

      const fixture = build();
      fixture.detectChanges();

      expect(fixture.componentInstance.upcomingNet()).toBe(-1200);
      expect(fixture.componentInstance.upcomingSchedule().olderCount).toBe(5);
    });
  });

  // #446: a reminder's tap opens /dashboard?bill=<rule> or ?recap=<week>.
  describe('links from a notification', () => {
    const rent: RecurringOccurrence = {
      recurringId: 'r1',
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'food',
      date: new Date(2026, 8, 1),
    };
    const TO_RECURRING = [['/budgets'], { queryParams: { tab: 'recurring' }, replaceUrl: true }] as const;

    /** The navigation that takes both params off the URL; the route double is rebuilt per case. */
    function strip(): [string[], NavigationExtras] {
      return [
        [],
        {
          relativeTo: activatedRoute as unknown as ActivatedRoute,
          queryParams: { bill: null, recap: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        },
      ];
    }

    function open(params: Record<string, string>): void {
      activatedRoute.queryParamMap.next(convertToParamMap(params));
    }

    const settle = () => new Promise(resolve => setTimeout(resolve));

    describe('?bill', () => {
      // The recap keeps the window's listener open while Upcoming is hidden;
      // the redirect does not wait for it to emit.
      it('opens the recurring rules at once while Upcoming is hidden, and says why', () => {
        setPreferences({ ...hiding('upcoming'), enableWeeklyRecap: true });
        recurringService.getUpcomingSchedule.and.returnValue(new Subject<UpcomingSchedule>());
        open({ bill: 'r1' });

        const fixture = build();
        fixture.detectChanges();

        expect(router.navigate).toHaveBeenCalledOnceWith(...TO_RECURRING);
        expect(announcer.announce).toHaveBeenCalledOnceWith('dashboard.billLinkCardHidden');
        expect(fixture.componentInstance.billInFocus()).toBeNull();
      });

      it('asks the card for the rule only once the window has emitted, and strips the link', () => {
        const upcoming$ = new Subject<UpcomingSchedule>();
        recurringService.getUpcomingSchedule.and.returnValue(upcoming$);
        open({ bill: 'r1' });

        const fixture = build();
        fixture.detectChanges();

        expect(router.navigate).toHaveBeenCalledOnceWith(...strip());
        expect(fixture.componentInstance.billInFocus()).withContext('before the first emission').toBeNull();

        upcoming$.next({ occurrences: [rent], olderCount: 0 });

        expect(fixture.componentInstance.billInFocus()).toBe('r1');
      });

      it('asks the card at once for a link that arrives once the window is in', () => {
        recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [rent], olderCount: 0 }));
        const fixture = build();
        fixture.detectChanges();
        expect(fixture.componentInstance.billInFocus()).toBeNull();

        open({ bill: 'r1' });

        expect(fixture.componentInstance.billInFocus()).toBe('r1');
      });

      it('opens the recurring rules when neither the card nor the server has the rule, and says why', async () => {
        open({ bill: 'gone' });
        const fixture = build();
        fixture.detectChanges();
        expect(fixture.componentInstance.billInFocus()).toBe('gone');
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        expect(fixture.componentInstance.billInFocus()).toBeNull();
        expect(router.navigate).withContext('before the server answers').not.toHaveBeenCalled();
        await settle();

        expect(recurringService.getUpcomingScheduleFromServer).toHaveBeenCalledOnceWith(14);
        expect(router.navigate).toHaveBeenCalledOnceWith(...TO_RECURRING);
        expect(announcer.announce).toHaveBeenCalledOnceWith('dashboard.billLinkNotUpcoming');
      });

      // Offline the read rejects; the rules page lists every rule that exists,
      // so it is still the right place, and it is reached at once.
      it('opens the recurring rules when the server cannot be asked', async () => {
        recurringService.getUpcomingScheduleFromServer.and.returnValue(Promise.reject(new Error('offline')));
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        await settle();

        expect(router.navigate).toHaveBeenCalledOnceWith(...TO_RECURRING);
        expect(announcer.announce).toHaveBeenCalledOnceWith('dashboard.billLinkNotUpcoming');
      });

      // A persistent cache answers the listener first, and it can predate the
      // rule or its move into the fortnight. Sending the user away is done
      // once, so the card's "absent" is only acted on once the server agrees.
      // The listener walks its fortnight only when it emits, and a page open
      // since an earlier day gets no emission to walk it again: the stream it
      // holds never brings the rule, so the page asks a re-opened one.
      it('re-opens the listener when the server has the rule the window lacked, and asks the card on its first emission', async () => {
        const stale$ = new Subject<UpcomingSchedule>();
        const fresh$ = new Subject<UpcomingSchedule>();
        recurringService.getUpcomingSchedule.and.returnValues(stale$, fresh$);
        recurringService.getUpcomingScheduleFromServer.and.returnValue(
          Promise.resolve({ occurrences: [rent], olderCount: 0 })
        );
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        stale$.next({ occurrences: [], olderCount: 0 });
        expect(fixture.componentInstance.billInFocus()).toBe('r1');
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        await settle();

        expect(router.navigate).not.toHaveBeenCalled();
        expect(announcer.announce).not.toHaveBeenCalled();
        expect(recurringService.getUpcomingSchedule).withContext('listeners opened').toHaveBeenCalledTimes(2);
        expect(stale$.observed).withContext('the stale listener').toBeFalse();
        expect(fixture.componentInstance.billInFocus()).withContext('before the new listener emits').toBeNull();

        fresh$.next({ occurrences: [rent], olderCount: 0 });

        expect(fixture.componentInstance.billInFocus()).toBe('r1');
      });

      it('opens the recurring rules when the re-opened window still lacks a rule the server listed, asking once', async () => {
        const stale$ = new Subject<UpcomingSchedule>();
        const fresh$ = new Subject<UpcomingSchedule>();
        recurringService.getUpcomingSchedule.and.returnValues(stale$, fresh$);
        recurringService.getUpcomingScheduleFromServer.and.returnValue(
          Promise.resolve({ occurrences: [rent], olderCount: 0 })
        );
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        stale$.next({ occurrences: [], olderCount: 0 });
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        await settle();
        fresh$.next({ occurrences: [], olderCount: 0 });
        expect(fixture.componentInstance.billInFocus()).toBe('r1');
        fixture.componentInstance.onBillFocus('absent');
        await settle();

        expect(recurringService.getUpcomingScheduleFromServer).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenCalledOnceWith(...TO_RECURRING);
        expect(announcer.announce).toHaveBeenCalledOnceWith('dashboard.billLinkNotUpcoming');
      });

      // A pin: the effect closed the listener when the card went, and opens it
      // again if the card comes back; the pending rule is asked of that one.
      it('leaves the listener closed when Upcoming is hidden during the read', async () => {
        let answer!: (schedule: UpcomingSchedule) => void;
        recurringService.getUpcomingScheduleFromServer.and.returnValue(new Promise(resolve => (answer = resolve)));
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();

        fixture.componentInstance.onBillFocus('absent');
        setPreferences(hiding('upcoming'));
        TestBed.tick();
        answer({ occurrences: [rent], olderCount: 0 });
        await settle();

        expect(recurringService.getUpcomingSchedule).toHaveBeenCalledTimes(1);
        expect(router.navigate).not.toHaveBeenCalledWith(...TO_RECURRING);
      });

      it('asks the card again at once when the listener caught up during the read', async () => {
        const upcoming$ = new Subject<UpcomingSchedule>();
        recurringService.getUpcomingSchedule.and.returnValue(upcoming$);
        let answer!: (schedule: UpcomingSchedule) => void;
        recurringService.getUpcomingScheduleFromServer.and.returnValue(new Promise(resolve => (answer = resolve)));
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        upcoming$.next({ occurrences: [], olderCount: 0 });

        fixture.componentInstance.onBillFocus('absent');
        upcoming$.next({ occurrences: [rent], olderCount: 0 });
        expect(fixture.componentInstance.billInFocus()).withContext('while the server is asked').toBeNull();
        answer({ occurrences: [rent], olderCount: 0 });
        await settle();

        expect(fixture.componentInstance.billInFocus()).toBe('r1');
      });

      // The server listed it, so a second "absent" is the card's last word:
      // no second read, and no loop between the two.
      it('opens the recurring rules on a second absent for a rule the server listed, asking once', async () => {
        recurringService.getUpcomingScheduleFromServer.and.returnValue(
          Promise.resolve({ occurrences: [rent], olderCount: 0 })
        );
        recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [rent], olderCount: 0 }));
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        await settle();
        expect(fixture.componentInstance.billInFocus()).toBe('r1');
        fixture.componentInstance.onBillFocus('absent');
        await settle();

        expect(recurringService.getUpcomingScheduleFromServer).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenCalledOnceWith(...TO_RECURRING);
      });

      it('does nothing with the answer once the page has gone', async () => {
        let answer!: (schedule: UpcomingSchedule) => void;
        recurringService.getUpcomingScheduleFromServer.and.returnValue(new Promise(resolve => (answer = resolve)));
        open({ bill: 'gone' });
        const fixture = build();
        fixture.detectChanges();
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('absent');
        fixture.destroy();
        answer({ occurrences: [], olderCount: 0 });
        await settle();

        expect(router.navigate).not.toHaveBeenCalled();
        expect(announcer.announce).not.toHaveBeenCalled();
      });

      // Reminders booked for the same minute are tapped one after another,
      // and the read for the first can still be out when the second lands.
      describe('when a newer link arrives during the read', () => {
        let answer: (schedule: UpcomingSchedule) => void;

        beforeEach(() => {
          recurringService.getUpcomingScheduleFromServer.and.returnValue(new Promise(resolve => (answer = resolve)));
        });

        it('does not send the user away on the earlier link\'s answer', async () => {
          open({ bill: 'r1' });
          const fixture = build();
          fixture.detectChanges();
          fixture.componentInstance.onBillFocus('absent');

          open({ bill: 'r2' });
          expect(fixture.componentInstance.billInFocus()).toBe('r2');
          fixture.componentInstance.onBillFocus('focused');
          router.navigate.calls.reset();
          answer({ occurrences: [], olderCount: 0 });
          await settle();

          expect(router.navigate).not.toHaveBeenCalled();
          expect(announcer.announce).not.toHaveBeenCalled();
        });

        it('does not ask the card for the earlier rule again', async () => {
          const upcoming$ = new Subject<UpcomingSchedule>();
          recurringService.getUpcomingSchedule.and.returnValue(upcoming$);
          open({ bill: 'r1' });
          const fixture = build();
          fixture.detectChanges();
          upcoming$.next({ occurrences: [], olderCount: 0 });
          fixture.componentInstance.onBillFocus('absent');

          open({ bill: 'r2' });
          fixture.componentInstance.onBillFocus('focused');
          upcoming$.next({ occurrences: [rent], olderCount: 0 });
          answer({ occurrences: [rent], olderCount: 0 });
          await settle();
          upcoming$.next({ occurrences: [rent], olderCount: 0 });

          expect(fixture.componentInstance.billInFocus()).toBeNull();
          expect(recurringService.getUpcomingSchedule).withContext('listeners opened').toHaveBeenCalledTimes(1);
        });

        it('does not send the user away from a recap link that came after', async () => {
          open({ bill: 'r1' });
          const fixture = build();
          fixture.detectChanges();
          fixture.componentInstance.onBillFocus('absent');

          open({ recap: '2026-09-21' });
          await settle();
          router.navigate.calls.reset();
          answer({ occurrences: [], olderCount: 0 });
          await settle();

          expect(router.navigate).not.toHaveBeenCalled();
          expect(announcer.announce).not.toHaveBeenCalled();
        });
      });

      it('stays on the dashboard once the card has the row', () => {
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        router.navigate.calls.reset();

        fixture.componentInstance.onBillFocus('focused');

        expect(router.navigate).not.toHaveBeenCalled();
        expect(announcer.announce).not.toHaveBeenCalled();
        expect(fixture.componentInstance.billInFocus()).toBeNull();
      });

      it('asks again for a second link while the page is open, the same rule included', () => {
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();
        fixture.componentInstance.onBillFocus('focused');

        open({ bill: 'r2' });
        expect(fixture.componentInstance.billInFocus()).toBe('r2');
        fixture.componentInstance.onBillFocus('focused');

        open({ bill: 'r2' });
        expect(fixture.componentInstance.billInFocus()).toBe('r2');
        expect(router.navigate.calls.allArgs()).toEqual([strip(), strip(), strip()]);
      });

      // The strip is itself a query-params change, read like any other.
      it('leaves a pending request alone when the stripped URL comes back', () => {
        const upcoming$ = new Subject<UpcomingSchedule>();
        recurringService.getUpcomingSchedule.and.returnValue(upcoming$);
        open({ bill: 'r1' });
        const fixture = build();
        fixture.detectChanges();

        open({});
        upcoming$.next({ occurrences: [rent], olderCount: 0 });

        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.billInFocus()).toBe('r1');
      });

      it('neither navigates nor asks anything without a link', () => {
        const fixture = build();
        fixture.detectChanges();

        expect(router.navigate).not.toHaveBeenCalled();
        expect(recap.load).not.toHaveBeenCalled();
        expect(fixture.componentInstance.billInFocus()).toBeNull();
      });
    });

    describe('?recap', () => {
      let attached: HTMLElement | undefined;
      let region: HTMLElement;

      /**
       * The page, attached so focus can move, with the recap region already
       * where the card renders one unless `withRegion` is false. This suite
       * blanks the page's template, so the region is put there by hand.
       */
      function render(withRegion = true): ComponentFixture<DashboardComponent> {
        const fixture = build();
        attached = fixture.nativeElement as HTMLElement;
        document.body.appendChild(attached);
        region = document.createElement('section');
        region.setAttribute('role', 'region');
        region.tabIndex = -1;
        if (withRegion) showRegion(fixture);
        fixture.detectChanges();
        return fixture;
      }

      function showRegion(fixture: ComponentFixture<DashboardComponent>): void {
        const card = document.createElement('app-weekly-recap');
        card.appendChild(region);
        (fixture.nativeElement as HTMLElement).appendChild(card);
      }

      /**
       * Runs whatever follows the landed load, short of a macrotask, so no
       * render hook can run in between.
       */
      async function drainMicrotasks(): Promise<void> {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }

      /** Lets the awaited load settle, then runs the render hooks it booked. */
      async function settle(fixture: ComponentFixture<DashboardComponent>): Promise<void> {
        await fixture.whenStable();
        fixture.detectChanges();
        TestBed.tick();
      }

      afterEach(() => {
        attached?.remove();
        attached = undefined;
      });

      it('focuses the recap once a load still running at mount settles with something to say', async () => {
        let land!: () => void;
        recap.load.and.returnValue(new Promise<void>(resolve => (land = resolve)));
        open({ recap: '2026-09-21' });

        const fixture = render(false);
        expect(recap.load).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledOnceWith(...strip());

        recap.visible.set(true);
        land();
        await drainMicrotasks();
        // The card renders its region only on the render after the load lands,
        // so a focus that does not wait for that render finds nothing.
        showRegion(fixture);
        await settle(fixture);

        expect(document.activeElement).toBe(region);
      });

      it('focuses nothing when the week turns out to have nothing to say', async () => {
        let land!: () => void;
        recap.load.and.returnValue(new Promise<void>(resolve => (land = resolve)));
        open({ recap: '2026-09-21' });

        const fixture = render();
        land();
        await settle(fixture);

        expect(document.activeElement).not.toBe(region);
        expect(router.navigate).toHaveBeenCalledOnceWith(...strip());
      });

      it('focuses nothing for a link to another week', async () => {
        recap.visible.set(true);
        open({ recap: '2026-09-14' });

        const fixture = render();
        await settle(fixture);

        expect(recap.load).toHaveBeenCalled();
        expect(document.activeElement).not.toBe(region);
        expect(router.navigate).toHaveBeenCalledOnceWith(...strip());
      });
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
    function trackAllStreams() {
      // Standard tier so the anomaly-baseline stream participates too.
      authService.currentUser.set(
        createUser({ preferences: { ragInsightsLevel: 'standard' } as User['preferences'] }));
      return {
        periodScoped: {
          byRange: trackSubjects(transactionService.getByDateRange),
          prevTotals: trackSubjects(transactionService.getPeriodCategoryTotals),
          baseline: trackSubjects(transactionService.getExpensesInRange),
        },
        recent: trackSubjects(transactionService.getRecentTransactions),
      };
    }

    it('holds at most one live listener per stream across ten period changes, and one recent listener throughout', () => {
      const { periodScoped, recent } = trackAllStreams();
      const fixture = build();
      fixture.detectChanges();

      for (let i = 0; i < 10; i++) {
        fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
        fixture.detectChanges();
      }

      for (const created of Object.values(periodScoped)) {
        expect(created.length).toBeGreaterThan(1);
        expect(created.filter(s => s.observed).length).toBe(1);
        expect(created[created.length - 1].observed).toBeTrue();
      }
      // The latest rows, whatever the period: nothing to supersede.
      expect(recent.length).withContext('recent listeners opened').toBe(1);
      expect(recent[0].observed).toBeTrue();
    });

    // A pin: every stream, the recent one included, ends through
    // takeUntilDestroyed, so a gate holds nothing open past destroy.
    it('releases every listener on destroy, the recent one included', () => {
      const { periodScoped, recent } = trackAllStreams();
      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onPeriodSelection(defaultPeriodSelection());
      fixture.detectChanges();

      fixture.destroy();

      for (const created of [...Object.values(periodScoped), recent]) {
        expect(created.length).toBeGreaterThan(0);
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
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: upcoming, olderCount: 0 }));

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
      const occurrences$ = new Subject<UpcomingSchedule>();
      recurringService.getUpcomingSchedule.and.returnValue(occurrences$);
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
      occurrences$.next({ occurrences: [rent], olderCount: 0 });
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

    // A pin: the widget reads the upcoming window too, so hiding the card must
    // not take the widget's next scheduled bill away.
    it('publishes the upcoming window with Recent and Upcoming hidden, when there is a widget', () => {
      withWidget();
      setPreferences(hiding('recent', 'upcoming'));
      const window$ = new Subject<Transaction[]>();
      transactionService.getByDateRange.and.returnValue(window$);
      const upcoming: RecurringOccurrence[] = [{
        recurringId: 'r1',
        name: 'Rent',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        categoryId: 'food',
        date: new Date(2026, 8, 1),
      }];
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: upcoming, olderCount: 0 }));

      const fixture = build();
      fixture.detectChanges();
      window$.next([]);
      TestBed.tick();

      expect(widgetSnapshots.publish).toHaveBeenCalledOnceWith({
        spent: 0,
        net: 0,
        baseCurrency: 'USD',
        budgets: [],
        upcoming,
      });
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
          provideNoMotion(),
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
          { provide: CloudLLMProviderService, useValue: cloudLLM },
          { provide: WeeklyRecapService, useValue: recap },
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
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [rent], olderCount: 0 }));
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

    // Without this binding the service counts what the floor left out and
    // nobody ever renders it.
    it('hands the card the older count', () => {
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [], olderCount: 4 }));

      const fixture = build();
      fixture.detectChanges();

      const stub = fixture.debugElement.query(By.directive(UpcomingBillsStubComponent))
        ?.componentInstance as UpcomingBillsStubComponent;
      expect(stub).withContext('app-upcoming-bills rendered').toBeTruthy();
      expect(stub.olderCount()).toBe(4);
    });

    // #446: the rule a bill link names reaches the card, and the card's answer
    // reaches the page.
    it('hands app-upcoming-bills the rule a link names, and follows its answer', async () => {
      const realRouter = TestBed.inject(Router);
      await realRouter.navigateByUrl('/?bill=r1');
      // Nothing is routed in this suite, so the redirect is caught here.
      const navigate = spyOn(realRouter, 'navigate').and.resolveTo(true);

      const fixture = build();
      fixture.detectChanges();

      const stub = fixture.debugElement.query(By.directive(UpcomingBillsStubComponent))
        ?.componentInstance as UpcomingBillsStubComponent;
      expect(stub).withContext('app-upcoming-bills rendered').toBeTruthy();
      expect(stub.focusRuleId()).toBe('r1');

      navigate.calls.reset();
      stub.ruleFocus.emit('absent');
      fixture.detectChanges();
      // The server is asked before the redirect; the double lists nothing.
      await new Promise(resolve => setTimeout(resolve));

      expect(stub.focusRuleId()).toBeNull();
      expect(navigate).toHaveBeenCalledOnceWith(['/budgets'], { queryParams: { tab: 'recurring' }, replaceUrl: true });
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
      recurringService.getUpcomingSchedule.and.returnValue(of({ occurrences: [rent], olderCount: 0 }));
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

    it('takes away the host of a card the layout service hides before the write lands', async () => {
      const land = holdLayoutWrite();
      const fixture = build();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-spending-chart')).not.toBeNull();

      const saved = TestBed.inject(DashboardLayoutService).hide('chart');
      fixture.detectChanges();

      const tags = () => Array.from(fixture.nativeElement.querySelectorAll('.dashboard-grid > *'))
        .map((el) => (el as Element).tagName.toLowerCase());
      expect(tags()).toEqual(['app-recent-transactions', 'app-upcoming-bills', 'app-ai-summary']);

      land();
      await saved;
      fixture.detectChanges();

      expect(tags()).withContext('once the write lands')
        .toEqual(['app-recent-transactions', 'app-upcoming-bills', 'app-ai-summary']);
    });

    it('binds the computed grid areas as a custom property', () => {
      const fixture = build();
      fixture.detectChanges();

      const grid: HTMLElement = fixture.nativeElement.querySelector('.dashboard-grid');
      expect(grid.style.getPropertyValue('--dashboard-areas')).toBe(fixture.componentInstance.gridAreas());
    });

    it('gives the subtitle the muted-text token class', () => {
      const fixture = build();
      fixture.detectChanges();

      const subtitle = fixture.nativeElement.querySelector('[header-subtitle]');
      expect(subtitle.classList.contains('dashboard-subtitle')).toBe(true);
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

    it('paints the empty line in the muted text token, at AA or better on the page, in both themes', () => {
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

      const line = fixture.nativeElement.querySelector('.dashboard-empty p') as HTMLElement;
      const muted = () => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--text-muted)';
        document.body.appendChild(probe);
        try {
          return getComputedStyle(probe).color;
        } finally {
          probe.remove();
        }
      };
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          expect(ratio(paintedColor(line), paintedBackground(line)))
            .withContext(`${theme} empty line on the page`)
            .toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(line).color).withContext(`${theme} empty line`).toBe(muted());
        });
      }
    });

    // #442: each card carries its own menu in its header's slot, so the
    // grid's children stay the card hosts the area math places.
    describe('card menus', () => {
      const ALL_FIVE: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'insights', 'budgets'];
      let attached: HTMLElement | undefined;

      const hostTags = (fixture: ComponentFixture<DashboardComponent>) =>
        Array.from(fixture.nativeElement.querySelectorAll('.dashboard-grid > *'))
          .map((el) => (el as Element).tagName.toLowerCase());
      const menus = (fixture: ComponentFixture<DashboardComponent>) =>
        fixture.debugElement.queryAll(By.directive(DashboardCardMenuComponent))
          .map((menu) => menu.componentInstance as DashboardCardMenuComponent);
      const triggerIn = (fixture: ComponentFixture<DashboardComponent>, host: string) =>
        fixture.nativeElement.querySelector(`${host} .card-menu-trigger`) as HTMLButtonElement;

      /** Attached to the document, so focus can move. */
      function render(): ComponentFixture<DashboardComponent> {
        const fixture = build();
        attached = fixture.nativeElement as HTMLElement;
        document.body.appendChild(attached);
        fixture.detectChanges();
        return fixture;
      }

      /**
       * Opens a card's menu, which renders in the CDK overlay, and presses an
       * item. Render hooks run on an application tick, not on a fixture's:
       * the open one moves focus into the menu, as a real open does, before
       * the press.
       */
      function press(fixture: ComponentFixture<DashboardComponent>, host: string, action: string): void {
        const trigger = triggerIn(fixture, host);
        trigger.click();
        TestBed.tick();
        // The panel this trigger opened: an earlier press's can still be attached.
        const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
        (panel.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
        TestBed.tick();
      }

      beforeEach(() => {
        // What a menu counts depends on the width. The real observer would
        // answer with the Karma window's, below the desktop breakpoint
        // headless but possibly above it in a visible browser, so every case
        // pins its own.
        TestBed.overrideProvider(BreakpointObserver, {
          useValue: { observe: () => of({ matches: false, breakpoints: {} }) },
        });
        budgetService.activeBudgets.set([{} as never]);
        cloudLLM.hasAnyCloudProvider.set(true);
        // Lands the way AuthService's write does, so the account follows it.
        authService.updatePreferenceFields.and.callFake(async (key, fields) => {
          const latest = authService.currentUser()!;
          authService.currentUser.set({
            ...latest,
            preferences: withPreferenceFields(latest.preferences, key, fields),
          });
        });
      });

      afterEach(() => {
        attached?.remove();
        attached = undefined;
        document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
      });

      it('projects one menu into every card host, and the hosts stay the grid children', () => {
        const fixture = render();

        expect(hostTags(fixture)).toEqual([
          'app-recent-transactions',
          'app-upcoming-bills',
          'app-spending-chart',
          'app-ai-summary',
          'app-budget-progress',
        ]);
        const hosts = Array.from(fixture.nativeElement.querySelectorAll('.dashboard-grid > *')) as HTMLElement[];
        for (const host of hosts) {
          expect(host.querySelectorAll('app-dashboard-card-menu').length).withContext(host.tagName).toBe(1);
        }
        expect(menus(fixture).map((menu) => menu.card())).toEqual(ALL_FIVE);
        for (const menu of menus(fixture)) {
          expect(menu.visible()).withContext(menu.card()).toEqual(ALL_FIVE);
        }
      });

      it('gives the insights card no menu without an AI provider, and leaves it out of the cards every menu counts', () => {
        cloudLLM.hasAnyCloudProvider.set(false);
        const fixture = render();

        expect(hostTags(fixture)).withContext('the insights host').toContain('app-ai-summary');
        expect(fixture.nativeElement.querySelector('app-ai-summary app-dashboard-card-menu')).toBeNull();
        const counted: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'budgets'];
        expect(menus(fixture).map((menu) => menu.card())).toEqual(counted);
        for (const menu of menus(fixture)) {
          expect(menu.visible()).withContext(menu.card()).toEqual(counted);
        }
      });

      it("moves focus to the next card's trigger after a hide", () => {
        const fixture = render();

        press(fixture, 'app-upcoming-bills', 'hide');

        expect(hostTags(fixture)).not.toContain('app-upcoming-bills');
        expect(document.activeElement).toBe(triggerIn(fixture, 'app-spending-chart'));
      });

      it('moves focus to the customize link after hiding the last card', () => {
        const fixture = render();

        press(fixture, 'app-budget-progress', 'hide');

        expect(hostTags(fixture)).not.toContain('app-budget-progress');
        expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.customize-link'));
      });

      it("moves focus to the empty state's customize link after hiding the only card", () => {
        setPreferences(hiding('recent', 'upcoming', 'insights', 'budgets'));
        const fixture = render();
        expect(hostTags(fixture)).toEqual(['app-spending-chart']);

        press(fixture, 'app-spending-chart', 'hide');

        expect(fixture.nativeElement.querySelector('.dashboard-grid')).toBeNull();
        expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.dashboard-empty .customize-link'));
      });

      it("keeps focus on the moved card's trigger", () => {
        const fixture = render();

        press(fixture, 'app-upcoming-bills', 'up');

        expect(hostTags(fixture).slice(0, 2)).toEqual(['app-upcoming-bills', 'app-recent-transactions']);
        expect(document.activeElement).toBe(triggerIn(fixture, 'app-upcoming-bills'));
      });

      // Every change made during one save shares its run, which rejects as a
      // whole when any of its writes fails, after an earlier one may have
      // landed. A correction is said only for what the fallback undid, and
      // counted over the cards back on the page.
      describe('a failed save shared by a move and a hide', () => {
        let writes: { land: () => void; fail: () => void }[];

        const settle = () => new Promise((resolve) => setTimeout(resolve));
        const said = (key: string) =>
          announcer.announce.calls.allArgs().map(([text]) => text).filter((text) => text.startsWith(key));

        beforeEach(() => {
          translation.t.and.callFake((key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key
          );
          writes = [];
          authService.updatePreferenceFields.and.callFake(async (key, fields) => {
            await new Promise<void>((land, fail) =>
              writes.push({ land: () => land(), fail: () => fail(new Error('offline')) })
            );
            const latest = authService.currentUser()!;
            authService.currentUser.set({
              ...latest,
              preferences: withPreferenceFields(latest.preferences, key, fields),
            });
          });
        });

        /** Fails the write `index`, then lets the corrections render. */
        async function fail(index: number): Promise<void> {
          writes[index].fail();
          await settle();
          TestBed.tick();
        }

        it('counts the move correction over the cards back on the page when a hide joined the save', async () => {
          const fixture = render();
          press(fixture, 'app-spending-chart', 'down');
          press(fixture, 'app-recent-transactions', 'hide');

          await fail(0);

          expect(said('settings.dashboardCardMoveReverted')).toEqual([
            'settings.dashboardCardMoveReverted:{"card":"dashboard.spendingByCategory","position":3,"total":5}',
          ]);
          expect(said('dashboard.cardHideReverted')).toEqual([
            'dashboard.cardHideReverted:{"card":"dashboard.recentTransactions"}',
          ]);
        });

        it('says nothing of a hide that landed before a later write failed', async () => {
          const fixture = render();
          press(fixture, 'app-recent-transactions', 'hide');
          press(fixture, 'app-spending-chart', 'down');
          writes[0].land();
          await settle();

          await fail(1);

          expect(said('dashboard.cardHideReverted')).toEqual([]);
          expect(hostTags(fixture)).not.toContain('app-recent-transactions');
          expect(said('settings.dashboardCardMoveReverted')).toEqual([
            'settings.dashboardCardMoveReverted:{"card":"dashboard.spendingByCategory","position":2,"total":4}',
          ]);
        });

        it('says nothing of a move that landed before a later write failed', async () => {
          const fixture = render();
          press(fixture, 'app-spending-chart', 'down');
          press(fixture, 'app-budget-progress', 'hide');
          writes[0].land();
          await settle();

          await fail(1);

          expect(said('settings.dashboardCardMoveReverted')).toEqual([]);
          expect(said('dashboard.cardHideReverted')).toEqual([
            'dashboard.cardHideReverted:{"card":"dashboard.budgetProgress"}',
          ]);
        });
      });

      // From 1024 px the grid draws two columns, chart and insights against
      // the rest (dashboardGridAreas), so a card moves and counts among the
      // cards of the column it is drawn in.
      describe('at the desktop breakpoint', () => {
        const MAIN: DashboardCardId[] = ['chart', 'insights'];
        const RAIL: DashboardCardId[] = ['recent', 'upcoming', 'budgets'];

        beforeEach(() => {
          TestBed.overrideProvider(BreakpointObserver, {
            useValue: {
              observe: (query: string) => of({ matches: query === APP_BREAKPOINTS.desktop, breakpoints: {} }),
            },
          });
        });

        it("hands each card's menu the cards of its own column", () => {
          const fixture = render();

          const lists = Object.fromEntries(menus(fixture).map((menu) => [menu.card(), menu.visible()]));
          expect(lists).toEqual({ recent: RAIL, upcoming: RAIL, chart: MAIN, insights: MAIN, budgets: RAIL });
        });

        it('offers no Move up on the first card of a column, whatever stands before it in the order', () => {
          const fixture = render();

          triggerIn(fixture, 'app-spending-chart').click();
          TestBed.tick();

          const up = document.querySelector('.mat-mdc-menu-panel [data-action="up"]') as HTMLButtonElement;
          expect(up.disabled).toBeTrue();
        });

        it('moves a card one step within its column, which changes what is drawn', () => {
          translation.t.and.callFake((key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key
          );
          const fixture = render();
          const before = fixture.componentInstance.gridAreas();

          press(fixture, 'app-upcoming-bills', 'down');

          expect(fixture.componentInstance.gridAreas()).not.toBe(before);
          expect(fixture.componentInstance.gridAreas()).toBe(
            dashboardGridAreas(['recent', 'chart', 'insights', 'budgets', 'upcoming'])
          );
          expect(announcer.announce).toHaveBeenCalledWith(
            'settings.dashboardCardMoved:{"card":"dashboard.upcomingBills","position":3,"total":3}',
            'polite',
            'replace'
          );
        });

        // A pin: Upcoming Bills is followed in its column by Budget Progress,
        // and in the page, which is the focus order, by Spending by Category.
        // That is also the second trigger left, as Upcoming Bills is second in
        // the rail, so the two cases after it tell an index in the column
        // from the page order.
        it('moves focus after a hide to the next card in page order, whichever column it is drawn in', () => {
          const fixture = render();

          press(fixture, 'app-upcoming-bills', 'hide');

          expect(document.activeElement).toBe(triggerIn(fixture, 'app-spending-chart'));
        });

        // A card's place in its column is not its place in the focus order.
        // Budget Progress is third in the rail, and the third trigger left
        // is Spending by Category's.
        it('moves focus after hiding the last card in page order to the customize link', () => {
          const fixture = render();

          press(fixture, 'app-budget-progress', 'hide');

          expect(hostTags(fixture)).not.toContain('app-budget-progress');
          expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.customize-link'));
        });

        // Spending by Category is the main column's only card with a menu, so
        // its column holds no next card, and the first trigger left is Recent
        // Transactions'. Next in page order are the insights card, which has
        // no menu, then Budget Progress.
        it("moves focus after hiding the main column's only card to the next card with a menu in page order", () => {
          cloudLLM.hasAnyCloudProvider.set(false);
          const fixture = render();

          press(fixture, 'app-spending-chart', 'hide');

          expect(hostTags(fixture)).not.toContain('app-spending-chart');
          expect(document.activeElement).toBe(triggerIn(fixture, 'app-budget-progress'));
        });
      });
    });

    describe('the period pickers\' floor', () => {
      const selectorFloor = async () => {
        const fixture = build();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const selector = fixture.debugElement.query(By.directive(PeriodSelectorComponent))
          .componentInstance as PeriodSelectorComponent;
        return selector.floor();
      };

      it('hands the selector the date of the oldest row', async () => {
        const oldest = new Date(2024, 11, 5, 12);
        transactionService.getEarliestTransactionDateFromServer = () => Promise.resolve(oldest);

        expect(await selectorFloor()).toEqual(oldest);
      });

      it('floors an account with no rows at the current year', async () => {
        transactionService.getEarliestTransactionDateFromServer = () => Promise.resolve(null);

        expect(await selectorFloor()).toEqual(new Date(new Date().getFullYear(), 0, 1));
      });

      it('gives the selector no floor when the read fails', async () => {
        transactionService.getEarliestTransactionDateFromServer =
          () => Promise.reject(new Error('unavailable'));

        expect(await selectorFloor()).toBeNull();
      });
    });

    it('names the refetch bar for a period change once the first load has painted', () => {
      const fixture = build();
      fixture.detectChanges();

      fixture.componentInstance.isLoading.set(true);
      fixture.detectChanges();

      const bar = fixture.nativeElement.querySelector('.refetch-bar');
      expect(bar.getAttribute('aria-label')).toBe('dashboard.refreshing');
    });
  });
});
