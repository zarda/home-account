import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

import { Transaction, Category } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { StatCardComponent } from '../../../shared/components/stat-card/stat-card.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ChartThemeService } from '../../../core/services/chart-theme.service';
import { LocaleNumberPipe } from '../../../shared/pipes/locale-number.pipe';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { dayKey, monthKey } from '../../../core/utils/transaction-date.utils';

interface MonthlyData {
  month: string;
  monthKey: string;
  income: number;
  expense: number;
  balance: number;
}

@Component({
  selector: 'app-spending-analysis',
  standalone: true,
  imports: [
    CategoryChipComponent,
    StatCardComponent,
    CommonModule,
    MatCardModule,
    MatIconModule,
    BaseChartDirective,
    EmptyStateComponent,
    CurrencyPipe,
    LocaleNumberPipe,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spending-analysis.component.html',
  styleUrl: './spending-analysis.component.scss',
})
export class SpendingAnalysisComponent {
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private chartTheme = inject(ChartThemeService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set categories(value: Category[]) {
    this._categories.set(value);
  }

  @Input() set dateRange(value: { start: Date; end: Date }) {
    this._dateRange.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _categories = signal<Category[]>([]);
  private _dateRange = signal<{ start: Date; end: Date }>({ start: new Date(), end: new Date() });
  private _currency = signal('USD');

  // Expose currency for template
  get currencyCode(): string {
    return this._currency();
  }

  chartType = 'line' as const;

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
  chartOptions = computed((): ChartConfiguration<'line'>['options'] => {
    const symbol = this.getCurrencySymbol();
    const locale = this.translationService.getIntlLocale();
    const axis = this.chartTheme.axis();
    const palette = this.chartTheme.palette();
    // Percent axis for the savings-rate line, kept separate so it never
    // fights with the currency scale for its range (no beginAtZero: negative
    // rates need to plot below the line).
    const percentAxis = {
      position: 'right' as const,
      grid: { ...axis.grid, drawOnChartArea: false },
      ticks: {
        ...axis.ticks,
        callback: (v: string | number) => `${Number(v).toFixed(0)}%`,
      },
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: this.chartTheme.animation(),
      interaction: {
        intersect: false,
        mode: 'index',
      },
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
              // The savings-rate series shares this callback with the two
              // currency series, so it needs its own percent formatting.
              if (context.dataset.yAxisID === 'y1') {
                return `${context.dataset.label}: ${value.toFixed(1)}%`;
              }
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
        // Declared only when the line is there to use it: Chart.js defaults a
        // scale to display: true rather than 'auto', so an unreferenced y1 is
        // still laid out and drawn — a bare 0%–1% axis down the right edge.
        ...(this.showSavingsSeries() ? { y1: percentAxis } : {}),
      },
    };
  });

  // Computed: Monthly data aggregation
  monthlyData = computed<MonthlyData[]>(() => {
    const transactions = this._transactions();
    const range = this._dateRange();

    const monthlyMap = new Map<string, { income: number; expense: number }>();

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

    // Convert to array and sort
    const locale = this.translationService.getIntlLocale();
    return Array.from(monthlyMap.entries())
      .map(([key, data]) => {
        const [year, month] = key.split('-');
        // Use locale-aware month name
        const monthDate = new Date(parseInt(year), parseInt(month) - 1);
        const monthLabel = monthDate.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
        return {
          month: monthLabel,
          monthKey: key, // Keep sortable key
          income: data.income,
          expense: data.expense,
          balance: data.income - data.expense,
        };
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  });

  // Span of the selected range in whole days — drives chart granularity.
  private daySpan = computed(() => {
    const r = this._dateRange();
    return Math.max(0, Math.round((r.end.getTime() - r.start.getTime()) / 86_400_000));
  });

  // "This Month" (and shorter) charts daily so it reads as a cumulative line
  // instead of two lone monthly dots; 3M/Year keep the monthly series.
  granularity = computed<'day' | 'month'>(() => (this.daySpan() <= 45 ? 'day' : 'month'));

  // Daily cumulative buckets across the range. Running totals mean a sparse
  // month still draws a rising line rather than a scatter of isolated points.
  private dailyData = computed<MonthlyData[]>(() => {
    const transactions = this._transactions();
    const range = this._dateRange();
    const locale = this.translationService.getIntlLocale();

    const dayMap = new Map<string, { income: number; expense: number }>();
    const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
    const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());

    const cursor = new Date(start);
    while (cursor <= end) {
      const key = dayKey(cursor);
      dayMap.set(key, { income: 0, expense: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const t of transactions) {
      const d = t.date.toDate();
      const key = dayKey(d);
      const bucket = dayMap.get(key);
      if (bucket) {
        const amount = this.toBaseCurrency(t);
        if (t.type === 'income') bucket.income += amount;
        else bucket.expense += amount;
      }
    }

    let cumIncome = 0;
    let cumExpense = 0;
    return Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, data]) => {
        cumIncome += data.income;
        cumExpense += data.expense;
        const [year, month, day] = key.split('-');
        const dayDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        const label = dayDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
        return {
          month: label,
          monthKey: key,
          income: cumIncome,
          expense: cumExpense,
          balance: cumIncome - cumExpense,
        };
      });
  });

  // The series actually plotted, resolved from the range's granularity.
  trendData = computed<MonthlyData[]>(() =>
    this.granularity() === 'day' ? this.dailyData() : this.monthlyData()
  );

  // Per-month savings rate as a percentage. Guarded on `income > 0` rather
  // than `!== 0` so pathological negative income also yields null instead of
  // a nonsensical rate; negative rates from expenses exceeding income are
  // kept as real values. Month granularity only — the daily series is
  // cumulative, so a per-day rate would be measuring something else.
  monthlySavingsRates = computed<(number | null)[]>(() =>
    this.monthlyData().map(({ income, expense }) =>
      income > 0 ? ((income - expense) / income) * 100 : null
    )
  );

  /**
   * Whether the savings-rate line is on the chart at all.
   *
   * Shared by chartData() and chartOptions() on purpose — the line is the
   * only thing that plots on the percent axis, so if the two ever disagreed
   * the chart would carry an axis with nothing on it (or, the other way, a
   * series with nowhere to sit).
   */
  showSavingsSeries = computed(
    () =>
      this.granularity() === 'month' &&
      this.monthlySavingsRates().some(rate => rate !== null)
  );

  // Chart data as computed signal to prevent re-renders
  chartData = computed((): ChartData<'line'> => {
    const data = this.trendData();
    // Drop point markers on the dense daily line; keep them on sparse months.
    const pointRadius = this.granularity() === 'day' ? 0 : 3;

    const datasets: ChartData<'line'>['datasets'] = [
      {
        label: this.translationService.t('common.income'),
        data: data.map(d => d.income),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius,
      },
      {
        label: this.translationService.t('common.totalExpenses'),
        data: data.map(d => d.expense),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius,
      },
    ];

    // No line at all beats a legend entry for a series that is entirely
    // gaps (e.g. every month in range has zero income).
    if (this.showSavingsSeries()) {
      datasets.push({
        label: this.translationService.t('reports.savingsRate'),
        data: this.monthlySavingsRates(),
        yAxisID: 'y1',
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: false,
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
        borderDash: [6, 4],
      });
    }

    return {
      labels: data.map(d => d.month),
      datasets,
    };
  });

  /** Ordinary least-squares slope over arbitrary (x, y) points. */
  private leastSquaresSlope(points: { x: number; y: number }[]): number {
    const n = points.length;
    if (n < 2) {
      return 0;
    }
    const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
    const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;

    let covariance = 0;
    let variance = 0;
    for (const p of points) {
      covariance += (p.x - meanX) * (p.y - meanY);
      variance += (p.x - meanX) ** 2;
    }
    return variance === 0 ? 0 : covariance / variance;
  }

  // Improving/declining/steady badge for the savings-rate line. Month
  // granularity only, and needs at least two real (non-null) months —
  // a single point has no slope to speak of.
  savingsTrend = computed<'improving' | 'declining' | 'steady' | null>(() => {
    if (this.granularity() !== 'month') {
      return null;
    }

    const points = this.monthlySavingsRates()
      .map((rate, index) => (rate === null ? null : { x: index, y: rate }))
      .filter((p): p is { x: number; y: number } => p !== null);

    if (points.length < 2) {
      return null;
    }

    const slope = this.leastSquaresSlope(points);
    if (slope > 0.5) return 'improving';
    if (slope < -0.5) return 'declining';
    return 'steady';
  });

  // Computed: Summary statistics (using dynamic conversion)
  totalIncome = computed(() => {
    return this._transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.toBaseCurrency(t), 0);
  });

  totalExpenses = computed(() => {
    return this._transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + this.toBaseCurrency(t), 0);
  });

  netSavings = computed(() => this.totalIncome() - this.totalExpenses());

  savingsRate = computed(() => {
    const income = this.totalIncome();
    if (income === 0) return 0;
    return (this.netSavings() / income) * 100;
  });

  // Top spending categories (using dynamic conversion)
  topCategories = computed(() => {
    const transactions = this._transactions();
    const categories = this._categories();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');

    const totals = new Map<string, number>();
    for (const t of expenseTransactions) {
      const current = totals.get(t.categoryId) || 0;
      totals.set(t.categoryId, current + this.toBaseCurrency(t));
    }

    const totalExpense = this.totalExpenses();

    return Array.from(totals.entries())
      .map(([categoryId, total]) => {
        const category = categories.find(c => c.id === categoryId);
        return {
          categoryId,
          name: category?.name || 'Unknown',
          color: category?.color || '#9E9E9E',
          icon: category?.icon || 'category',
          total,
          percentage: totalExpense > 0 ? (total / totalExpense) * 100 : 0,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  });

  hasData = computed(() => this._transactions().length > 0);
}
