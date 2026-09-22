import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Timestamp } from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';

import { MonthlyComparisonComponent } from './monthly-comparison.component';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { provideAppCharts } from '../../../core/config/chart.config';
import { createTranslationStub, createLocaleFormatStub } from '../../../core/services/testing';

function breakpointState(matches: boolean): BreakpointState {
  return { matches, breakpoints: { [APP_BREAKPOINTS.mobile]: matches } };
}

const mockTransactionSet: Transaction[] = [
  {
    id: 't1',
    userId: 'user1',
    type: 'expense',
    amount: 200,
    amountInBaseCurrency: 200,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'Groceries',
    date: Timestamp.fromDate(new Date(2024, 5, 15)), // June
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  },
  {
    id: 't2',
    userId: 'user1',
    type: 'income',
    amount: 5000,
    amountInBaseCurrency: 5000,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat2',
    description: 'Salary June',
    date: Timestamp.fromDate(new Date(2024, 5, 1)), // June
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  },
  {
    id: 't3',
    userId: 'user1',
    type: 'expense',
    amount: 300,
    amountInBaseCurrency: 300,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'May expenses',
    date: Timestamp.fromDate(new Date(2024, 4, 15)), // May
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  },
  {
    id: 't4',
    userId: 'user1',
    type: 'income',
    amount: 4500,
    amountInBaseCurrency: 4500,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat2',
    description: 'Salary May',
    date: Timestamp.fromDate(new Date(2024, 4, 1)), // May
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  }
];

const mockPriorYearSet: Transaction[] = [
  {
    id: 'p1',
    userId: 'user1',
    type: 'expense',
    amount: 160,
    amountInBaseCurrency: 160,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'Groceries last June',
    date: Timestamp.fromDate(new Date(2023, 5, 15)), // June 2023
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  },
  {
    id: 'p2',
    userId: 'user1',
    type: 'income',
    amount: 4000,
    amountInBaseCurrency: 4000,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat2',
    description: 'Salary last June',
    date: Timestamp.fromDate(new Date(2023, 5, 1)), // June 2023
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  },
  {
    id: 'p3',
    userId: 'user1',
    type: 'income',
    amount: 3000,
    amountInBaseCurrency: 3000,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat2',
    description: 'Salary last May',
    date: Timestamp.fromDate(new Date(2023, 4, 1)), // May 2023
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false
  }
];

describe('MonthlyComparisonComponent', () => {
  let component: MonthlyComparisonComponent;
  let fixture: ComponentFixture<MonthlyComparisonComponent>;
  let breakpoint$: BehaviorSubject<BreakpointState>;

  const mockTransactions = mockTransactionSet;

  // Same two months, one year earlier. May 2023 carries income only, which is
  // what makes the zero-division guard on the expense side observable.
  const mockPriorYearTransactions = mockPriorYearSet;

  beforeEach(async () => {
    const mockCurrencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      convert: (amount: number) => amount, // 1:1 conversion for tests
    amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) =>
      t.amountInBaseCurrency ?? t.amount
    };

    const mockTranslationService = {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'common.income': 'Income',
          'common.totalExpenses': 'Expenses',
          'reports.incomeLastYear': 'Income (last year)',
          'reports.expensesLastYear': 'Expenses (last year)'
        };
        return translations[key] || key;
      },
      getIntlLocale: () => 'en-US'
    };

    // Desktop by default, matching what the real observer reports in the
    // headless browser; the mobile cases push a match through it.
    breakpoint$ = new BehaviorSubject<BreakpointState>(breakpointState(false));

    await TestBed.configureTestingModule({
      imports: [MonthlyComparisonComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: BreakpointObserver, useValue: { observe: () => breakpoint$.asObservable() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(MonthlyComparisonComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(MonthlyComparisonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('with no data', () => {
    beforeEach(() => {
      component.transactions = [];
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return false for hasData', () => {
      expect(component.hasData()).toBeFalse();
    });

    it('should compute averageIncome as 0', () => {
      expect(component.averageIncome()).toBe(0);
    });

    it('should compute averageExpense as 0', () => {
      expect(component.averageExpense()).toBe(0);
    });
  });

  describe('with transaction data', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return true for hasData', () => {
      expect(component.hasData()).toBeTrue();
    });

    it('should have 2 months of data', () => {
      const monthly = component.monthlyData();
      expect(monthly.length).toBe(2);
    });
  });

  describe('monthlyData computation', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should aggregate income per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.income).toBe(5000);
    });

    it('should aggregate expenses per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.expense).toBe(200);
    });

    it('should calculate balance per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.balance).toBe(4800); // 5000 - 200
    });

    it('should calculate income change percentage', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      // (5000 - 4500) / 4500 * 100 = 11.11%
      expect(june?.incomeChange).toBeCloseTo(11.11, 1);
    });

    it('should calculate expense change percentage', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      // (200 - 300) / 300 * 100 = -33.33%
      expect(june?.expenseChange).toBeCloseTo(-33.33, 1);
    });

    it('should have null change for first month', () => {
      const monthly = component.monthlyData();
      const may = monthly.find(m => m.month.includes('May'));
      expect(may?.incomeChange).toBeNull();
      expect(may?.expenseChange).toBeNull();
    });
  });

  describe('summary statistics', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should calculate average income', () => {
      // (5000 + 4500) / 2 = 4750
      expect(component.averageIncome()).toBe(4750);
    });

    it('should calculate average expense', () => {
      // (200 + 300) / 2 = 250
      expect(component.averageExpense()).toBe(250);
    });

    it('should find best month', () => {
      const best = component.bestMonth();
      expect(best?.month).toContain('Jun'); // June has higher balance
    });

    it('should find worst month', () => {
      const worst = component.worstMonth();
      expect(worst?.month).toContain('May'); // May has lower balance
    });
  });

  describe('chartData', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should have labels for each month', () => {
      const data = component.chartData();
      expect(data.labels?.length).toBe(2);
    });

    it('should have income and expense datasets', () => {
      const data = component.chartData();
      expect(data.datasets.length).toBe(2);
      expect(data.datasets[0].label).toBe('Income');
      expect(data.datasets[1].label).toBe('Expenses');
    });

    it('should have correct data values', () => {
      const data = component.chartData();
      // First month is May
      expect(data.datasets[0].data[0]).toBe(4500); // May income
      expect(data.datasets[1].data[0]).toBe(300); // May expense
    });
  });

  describe('year-over-year comparison', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.priorYearTransactions = mockPriorYearTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should bucket prior-year transactions by their own month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      const may = monthly.find(m => m.month.includes('May'));

      expect(june?.prevYearIncome).toBe(4000);
      expect(june?.prevYearExpense).toBe(160);
      expect(may?.prevYearIncome).toBe(3000);
      expect(may?.prevYearExpense).toBe(0);
    });

    it('should calculate the expense change against the same month last year', () => {
      const june = component.monthlyData().find(m => m.month.includes('Jun'));
      // (200 - 160) / 160 * 100 = 25%
      expect(june?.yoyExpenseChange).toBeCloseTo(25);
    });

    it('should calculate the income change against the same month last year', () => {
      const june = component.monthlyData().find(m => m.month.includes('Jun'));
      // (5000 - 4000) / 4000 * 100 = 25%
      expect(june?.yoyIncomeChange).toBeCloseTo(25);
    });

    it('should leave the change null when last year had nothing of that type', () => {
      // May 2023 holds income only: dividing by a zero expense would be Infinity.
      const may = component.monthlyData().find(m => m.month.includes('May'));
      expect(may?.yoyExpenseChange).toBeNull();
      expect(may?.yoyIncomeChange).toBeCloseTo(50); // (4500 - 3000) / 3000
    });

    it('should leave last year null for a month with no prior-year data at all', () => {
      component.priorYearTransactions = mockPriorYearTransactions.filter(t => t.id !== 'p3');
      fixture.detectChanges();

      const may = component.monthlyData().find(m => m.month.includes('May'));
      expect(may?.prevYearIncome).toBeNull();
      expect(may?.prevYearExpense).toBeNull();
      expect(may?.yoyIncomeChange).toBeNull();
      expect(may?.yoyExpenseChange).toBeNull();
    });

    it('should report prior-year data as available', () => {
      expect(component.hasPriorYearData()).toBeTrue();
    });

    it('should add muted prior-year datasets to the chart', () => {
      const data = component.chartData();
      expect(data.datasets.length).toBe(4);
      expect(data.datasets[2].label).toBe('Income (last year)');
      expect(data.datasets[3].label).toBe('Expenses (last year)');
      // May had no prior-year expense bucket entry, June had 160.
      expect(data.datasets[3].data).toEqual([0, 160]);
      expect(data.datasets[2].data).toEqual([3000, 4000]);
    });

    it('should keep the chart at two datasets without prior-year data', () => {
      component.priorYearTransactions = [];
      fixture.detectChanges();

      // No ghost legend entries for a year the user has no history for.
      expect(component.hasPriorYearData()).toBeFalse();
      expect(component.chartData().datasets.length).toBe(2);
    });
  });

  describe('displayedColumns', () => {
    it('should show the year-over-year column on desktop once there is history', () => {
      component.priorYearTransactions = mockPriorYearTransactions;
      fixture.detectChanges();

      expect(component.displayedColumns()).toContain('yoy');
    });

    it('should drop the year-over-year column on mobile with the trend column', () => {
      component.priorYearTransactions = mockPriorYearTransactions;
      breakpoint$.next(breakpointState(true));
      fixture.detectChanges();

      expect(component.displayedColumns()).not.toContain('yoy');
      expect(component.displayedColumns()).not.toContain('change');
    });

    it('should withhold the year-over-year column without prior-year data', () => {
      component.priorYearTransactions = [];
      fixture.detectChanges();

      // Same rule the chart follows: under a year of history would otherwise
      // buy a permanent column of em-dashes in an already-scrolling table.
      expect(component.displayedColumns()).not.toContain('yoy');
      expect(component.displayedColumns()).toContain('change');
    });
  });
});

/**
 * The cases above override the template to `<div></div>`, so nothing in them
 * renders the empty state, either of the two conditional stat cards, the
 * chart canvas, or a single table row. Two of the sign decisions on this page
 * live in the template alone — `worstMonth`'s `[detailTone]` and the
 * expense column's inverted `.positive`/`.negative`, where a *fall* is good —
 * and no spec has ever evaluated them.
 *
 * Full render: `provideAppCharts()` is mandatory (docs/performance.md:47-49)
 * and `app.smoke.spec.ts:337-340` already proves Chart.js draws a real
 * `<canvas>` headless, so nothing here needs a partial template.
 */
describe('MonthlyComparisonComponent, through its own template', () => {
  let fixture: ComponentFixture<MonthlyComparisonComponent>;
  let breakpoint$: BehaviorSubject<BreakpointState>;

  function render(
    transactions: Transaction[],
    priorYear: Transaction[] = [],
    range = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) },
  ): void {
    fixture.componentInstance.transactions = transactions;
    fixture.componentInstance.priorYearTransactions = priorYear;
    fixture.componentInstance.currency = 'USD';
    // The table's rows come from the window, not from the transactions: a
    // month with no activity is still a row.
    fixture.componentInstance.dateRange = range;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const statCards = () => Array.from(el().querySelectorAll('app-stat-card')) as HTMLElement[];
  const statLabels = () =>
    statCards().map(c => c.querySelector('.stat-label')?.textContent?.trim());
  const cardByLabel = (label: string) =>
    statCards().find(c => c.querySelector('.stat-label')?.textContent?.trim().startsWith(label));
  const headers = () =>
    Array.from(el().querySelectorAll('th[mat-header-cell]')).map(h => h.textContent?.trim());
  const bodyRows = () => Array.from(el().querySelectorAll('tr[mat-row]')) as HTMLElement[];

  beforeEach(async () => {
    breakpoint$ = new BehaviorSubject<BreakpointState>(breakpointState(false));

    await TestBed.configureTestingModule({
      imports: [MonthlyComparisonComponent, NoopAnimationsModule],
      providers: [
        provideAppCharts(),
        {
          provide: CurrencyService,
          useValue: {
            currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
            getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
            convert: (amount: number) => amount,
            amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) =>
              t.amountInBaseCurrency ?? t.amount,
          },
        },
        {
          provide: TranslationService,
          useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' },
        },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: BreakpointObserver, useValue: { observe: () => breakpoint$.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthlyComparisonComponent);
  });

  it('shows the empty state instead of an empty chart with no rows', () => {
    render([]);

    const empty = el().querySelector('app-empty-state') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('reports.noDataAvailable');
    expect(empty.textContent).toContain('reports.addTransactionsToSee');
    expect(el().querySelector('.monthly-comparison')).toBeNull();
    expect(el().querySelector('canvas')).toBeNull();
  });

  it('always shows the two averages, formatted in the page currency', () => {
    render(mockTransactionSet);

    expect(statLabels()[0]).toContain('reports.avgMonthlyIncome');
    expect(statLabels()[1]).toContain('reports.avgMonthlyExpenses');
    expect(cardByLabel('reports.avgMonthlyIncome')?.querySelector('.stat-value')?.textContent)
      .toContain('$4,750.00');
    expect(cardByLabel('reports.avgMonthlyExpenses')?.querySelector('.stat-value')?.textContent)
      .toContain('$250.00');
  });

  it('marks a profitable worst month positive, not negative', () => {
    // Both months are in surplus here, so `worst` is still a positive
    // balance — the one case where `[detailTone]` and the '+' prefix
    // disagree with the card's name. Pure template logic, evaluated nowhere
    // else in the suite.
    render(mockTransactionSet);

    const worst = cardByLabel('reports.worstMonth') as HTMLElement;
    const detail = worst.querySelector('.stat-detail') as HTMLElement;
    expect(detail.textContent?.trim().startsWith('+')).toBeTrue();
    expect(detail.classList).toContain('detail-positive');
    expect(detail.classList).not.toContain('detail-negative');
  });

  it('marks a loss-making worst month negative', () => {
    render(
      [
        ...mockTransactionSet,
        {
          ...mockTransactionSet[0],
          id: 't9',
          amount: 9000,
          amountInBaseCurrency: 9000,
          date: Timestamp.fromDate(new Date(2024, 3, 10)),
        },
      ],
      [],
      { start: new Date(2024, 3, 1), end: new Date(2024, 5, 30) },
    );

    const detail = (cardByLabel('reports.worstMonth') as HTMLElement)
      .querySelector('.stat-detail') as HTMLElement;
    expect(detail.textContent?.trim().startsWith('-')).toBeTrue();
    expect(detail.classList).toContain('detail-negative');
  });

  it('draws the bar chart on a real canvas', () => {
    render(mockTransactionSet);

    const canvas = el().querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('ng-reflect-type') ?? fixture.componentInstance.chartType).toBe('bar');
    expect(fixture.componentInstance.chartData().datasets.length).toBeGreaterThan(0);
    expect(el().querySelectorAll('mat-card-title')[0].textContent?.trim())
      .toBe('reports.monthlyIncomeVsExpenses');
  });

  it('renders one table row per month', () => {
    render(mockTransactionSet);

    expect(bodyRows().length).toBe(2);
    expect(headers()).toEqual([
      'transactions.month', 'common.income', 'common.totalExpenses', 'common.balance', 'reports.trend',
    ]);
  });

  it('adds the year-over-year column only when there is a year behind it', () => {
    render(mockTransactionSet);
    expect(headers()).not.toContain('reports.yoyChange');

    render(mockTransactionSet, mockPriorYearSet);
    expect(headers()).toContain('reports.yoyChange');
  });

  it('drops the trend and year-over-year columns on a phone', () => {
    render(mockTransactionSet, mockPriorYearSet);
    breakpoint$.next(breakpointState(true));
    fixture.detectChanges();

    expect(headers()).toEqual([
      'transactions.month', 'common.income', 'common.totalExpenses', 'common.balance',
    ]);
  });

  it('reads a rise in expenses as negative while the same rise in income is positive', () => {
    // The two columns invert each other: spending more is bad, earning more
    // is good, so the same arrow carries opposite classes in the two cells.
    // Both are template expressions and this is the only place either is
    // evaluated. June here rises on both sides.
    render([
      ...mockTransactionSet,
      {
        ...mockTransactionSet[0],
        id: 't5',
        amount: 400,
        amountInBaseCurrency: 400,
        date: Timestamp.fromDate(new Date(2024, 5, 20)),
      },
    ]);

    const june = bodyRows()[1];
    const income = june.querySelector('.income-cell .change-indicator') as HTMLElement;
    const expense = june.querySelector('.expense-cell .change-indicator') as HTMLElement;

    expect(income.querySelector('mat-icon')?.textContent?.trim()).toBe('arrow_upward');
    expect(income.classList).toContain('positive');
    expect(expense.querySelector('mat-icon')?.textContent?.trim()).toBe('arrow_upward');
    expect(expense.classList).toContain('negative');
    expect(june.querySelector('.trend-icon')?.textContent?.trim()).toBe('trending_up');
  });

  it('reads a fall in expenses as positive, the same arrow the other way', () => {
    render(mockTransactionSet);

    const june = bodyRows()[1];
    const expense = june.querySelector('.expense-cell .change-indicator') as HTMLElement;

    expect(expense.querySelector('mat-icon')?.textContent?.trim()).toBe('arrow_downward');
    expect(expense.classList).toContain('positive');
    expect(june.querySelector('.trend-icon')?.textContent?.trim()).toBe('trending_down');
  });

  it('shows an em-dash rather than a change on the first month', () => {
    render(mockTransactionSet);

    const first = bodyRows()[0];
    expect(first.querySelector('.change-indicator')).toBeNull();
    expect(first.querySelector('.no-data')?.textContent?.trim()).toBe('—');
  });

  it('signs a surplus balance and classes it positive', () => {
    render(mockTransactionSet);

    const balance = bodyRows()[0].querySelectorAll('td[mat-cell]')[3] as HTMLElement;
    expect(balance.textContent?.trim().startsWith('+')).toBeTrue();
    expect(balance.classList).toContain('positive');
  });
});
