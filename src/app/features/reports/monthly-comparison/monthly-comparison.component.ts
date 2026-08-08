import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs/operators';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';

import { Transaction } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { StatCardComponent } from '../../../shared/components/stat-card/stat-card.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { ChartThemeService } from '../../../core/services/chart-theme.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { addMonths, monthKey, parseMonthKey } from '../../../core/utils/transaction-date.utils';

interface MonthlyComparison {
  month: string;
  monthKey: string;
  income: number;
  expense: number;
  balance: number;
  incomeChange: number | null;
  expenseChange: number | null;
  /** Same month one year earlier; null when that month has no rows at all. */
  prevYearIncome: number | null;
  prevYearExpense: number | null;
  yoyIncomeChange: number | null;
  yoyExpenseChange: number | null;
}

@Component({
  selector: 'app-monthly-comparison',
  standalone: true,
  imports: [
    StatCardComponent,
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatTableModule,
    BaseChartDirective,
    EmptyStateComponent,
    CurrencyPipe,
    DecimalPipe,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './monthly-comparison.component.html',
  styleUrl: './monthly-comparison.component.scss',
})
export class MonthlyComparisonComponent {
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private chartTheme = inject(ChartThemeService);
  private breakpointObserver = inject(BreakpointObserver);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  /**
   * The same window one year earlier, fetched separately by the page. Arrives
   * after the current window, so every prior-year figure has to tolerate being
   * empty.
   */
  @Input() set priorYearTransactions(value: Transaction[]) {
    this._priorYearTransactions.set(value);
  }

  @Input() set dateRange(value: { start: Date; end: Date }) {
    this._dateRange.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _priorYearTransactions = signal<Transaction[]>([]);
  private _dateRange = signal<{ start: Date; end: Date }>({ start: new Date(), end: new Date() });
  private _currency = signal('USD');

  // Expose currency for template
  get currencyCode(): string {
    return this._currency();
  }

  chartType = 'bar' as const;

  // Mobile drops the Trend column so the table fits without a 500px scroll.
  private isMobile = toSignal(
    this.breakpointObserver
      .observe(APP_BREAKPOINTS.mobile)
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );

  // The year-over-year column follows the rule the chart already follows for
  // its prior-year bars: with no history behind it, it is a permanent column
  // of em-dashes in a table that is already 500px wide and scrolling.
  displayedColumns = computed(() => {
    if (this.isMobile()) {
      return ['month', 'income', 'expense', 'balance'];
    }
    const columns = ['month', 'income', 'expense', 'balance', 'change'];
    return this.hasPriorYearData() ? [...columns, 'yoy'] : columns;
  });

  // Get currency symbol dynamically
  private getCurrencySymbol(): string {
    const info = this.currencyService.getCurrencyInfo(this._currency());
    return info?.symbol || this._currency();
  }

  // Base-currency value: write-time snapshot first (deterministic), live
  // conversion only as a legacy fallback.
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.amountInBase(t, this._currency());
  }

  // Chart options as computed signal to prevent re-renders
  chartOptions = computed((): ChartConfiguration<'bar'>['options'] => {
    const symbol = this.getCurrencySymbol();
    const locale = this.translationService.getIntlLocale();
    const axis = this.chartTheme.axis();
    const palette = this.chartTheme.palette();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: this.chartTheme.animation(),
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: this.chartTheme.legendLabels(),
        },
        tooltip: {
          titleFont: { family: palette.fontFamily },
          bodyFont: { family: palette.fontFamily },
          callbacks: {
            label: (context) => {
              const value = context.parsed.y ?? 0;
              return `${context.dataset.label}: ${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2 })}`;
            },
          },
        },
      },
      scales: {
        x: axis,
        y: {
          beginAtZero: true,
          grid: axis.grid,
          ticks: {
            ...axis.ticks,
            callback: (value) => {
              return `${symbol}${Number(value).toLocaleString(locale)}`;
            },
          },
        },
      },
    };
  });

  // Prior-year rows bucketed by their OWN month, so a month with no history
  // is a missing key rather than a zero — the two read very differently in a
  // year-over-year column.
  private priorYearBuckets = computed<Map<string, { income: number; expense: number }>>(() => {
    const buckets = new Map<string, { income: number; expense: number }>();

    for (const t of this._priorYearTransactions()) {
      const key = monthKey(t.date.toDate());
      const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
      const amount = this.toBaseCurrency(t);
      if (t.type === 'income') {
        bucket.income += amount;
      } else {
        bucket.expense += amount;
      }
      buckets.set(key, bucket);
    }

    return buckets;
  });

  hasPriorYearData = computed(() => this._priorYearTransactions().length > 0);

  /** The `yyyy-MM` twelve months before `key`. */
  private priorYearKey(key: string): string | null {
    const parsed = parseMonthKey(key);
    if (!parsed) {
      return null;
    }
    return monthKey(addMonths(new Date(parsed.year, parsed.month, 1), -12));
  }

  // Computed: Monthly data
  monthlyData = computed<MonthlyComparison[]>(() => {
    const transactions = this._transactions();
    const range = this._dateRange();

    const monthlyMap = new Map<string, { income: number; expense: number }>();
    const locale = this.translationService.getIntlLocale();

    // Initialize all months in range
    const start = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    const end = new Date(range.end.getFullYear(), range.end.getMonth(), 1);

    const current = new Date(start);
    while (current <= end) {
      const key = monthKey(current);
      monthlyMap.set(key, { income: 0, expense: 0 });
      current.setMonth(current.getMonth() + 1);
    }

    // Aggregate transactions by month (convert to current base currency dynamically)
    for (const t of transactions) {
      const date = t.date.toDate();
      const key = monthKey(date);

      const existing = monthlyMap.get(key);
      if (existing) {
        const amount = this.toBaseCurrency(t);
        if (t.type === 'income') {
          existing.income += amount;
        } else {
          existing.expense += amount;
        }
      }
    }

    // Convert to array and calculate changes
    const sortedKeys = Array.from(monthlyMap.keys()).sort();
    const priorYear = this.priorYearBuckets();
    const result: MonthlyComparison[] = [];

    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i];
      const data = monthlyMap.get(key)!;
      const [year, month] = key.split('-');

      let incomeChange: number | null = null;
      let expenseChange: number | null = null;

      if (i > 0) {
        const prevKey = sortedKeys[i - 1];
        const prevData = monthlyMap.get(prevKey)!;

        if (prevData.income > 0) {
          incomeChange = ((data.income - prevData.income) / prevData.income) * 100;
        }
        if (prevData.expense > 0) {
          expenseChange = ((data.expense - prevData.expense) / prevData.expense) * 100;
        }
      }

      // Same month, one year back
      const lastYearKey = this.priorYearKey(key);
      const lastYear = lastYearKey ? priorYear.get(lastYearKey) : undefined;

      let yoyIncomeChange: number | null = null;
      let yoyExpenseChange: number | null = null;

      if (lastYear) {
        if (lastYear.income > 0) {
          yoyIncomeChange = ((data.income - lastYear.income) / lastYear.income) * 100;
        }
        if (lastYear.expense > 0) {
          yoyExpenseChange = ((data.expense - lastYear.expense) / lastYear.expense) * 100;
        }
      }

      // Use locale-aware month name
      const monthDate = new Date(parseInt(year), parseInt(month) - 1);
      const monthLabel = monthDate.toLocaleDateString(locale, { month: 'short', year: 'numeric' });

      result.push({
        month: monthLabel,
        monthKey: key,
        income: data.income,
        expense: data.expense,
        balance: data.income - data.expense,
        incomeChange,
        expenseChange,
        prevYearIncome: lastYear ? lastYear.income : null,
        prevYearExpense: lastYear ? lastYear.expense : null,
        yoyIncomeChange,
        yoyExpenseChange,
      });
    }

    return result;
  });

  // Chart data as computed signal to prevent re-renders
  chartData = computed((): ChartData<'bar'> => {
    const data = this.monthlyData();

    const datasets: ChartData<'bar'>['datasets'] = [
      {
        label: this.translationService.t('common.income'),
        data: data.map(d => d.income),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: '#22c55e',
        borderWidth: 1,
        maxBarThickness: 32,
      },
      {
        label: this.translationService.t('common.totalExpenses'),
        data: data.map(d => d.expense),
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: '#ef4444',
        borderWidth: 1,
        maxBarThickness: 32,
      },
    ];

    // Only when there is history to show: empty prior-year bars would add two
    // legend entries standing for nothing.
    if (this.hasPriorYearData()) {
      datasets.push(
        {
          label: this.translationService.t('reports.incomeLastYear'),
          data: data.map(d => d.prevYearIncome ?? 0),
          backgroundColor: 'rgba(34, 197, 94, 0.35)',
          borderColor: 'rgba(34, 197, 94, 0.5)',
          borderWidth: 1,
          maxBarThickness: 32,
        },
        {
          label: this.translationService.t('reports.expensesLastYear'),
          data: data.map(d => d.prevYearExpense ?? 0),
          backgroundColor: 'rgba(239, 68, 68, 0.35)',
          borderColor: 'rgba(239, 68, 68, 0.5)',
          borderWidth: 1,
          maxBarThickness: 32,
        }
      );
    }

    return {
      labels: data.map(d => d.month),
      datasets,
    };
  });

  // Summary stats
  averageIncome = computed(() => {
    const data = this.monthlyData();
    if (data.length === 0) return 0;
    return data.reduce((sum, d) => sum + d.income, 0) / data.length;
  });

  averageExpense = computed(() => {
    const data = this.monthlyData();
    if (data.length === 0) return 0;
    return data.reduce((sum, d) => sum + d.expense, 0) / data.length;
  });

  bestMonth = computed(() => {
    const data = this.monthlyData();
    if (data.length === 0) return null;
    return data.reduce((best, current) =>
      current.balance > best.balance ? current : best
    );
  });

  worstMonth = computed(() => {
    const data = this.monthlyData();
    if (data.length === 0) return null;
    return data.reduce((worst, current) =>
      current.balance < worst.balance ? current : worst
    );
  });

  hasData = computed(() => this._transactions().length > 0);
}
