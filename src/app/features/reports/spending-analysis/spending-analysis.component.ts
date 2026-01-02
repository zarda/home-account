import { Component, computed, inject, Input, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

import { Transaction, Category } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

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
    CommonModule,
    MatCardModule,
    MatIconModule,
    BaseChartDirective,
    EmptyStateComponent,
    CurrencyPipe,
    TranslatePipe
  ],
  templateUrl: './spending-analysis.component.html',
  styleUrl: './spending-analysis.component.scss',
})
export class SpendingAnalysisComponent {
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

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

  // Convert transaction amount to current base currency dynamically
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.convert(t.amount, t.currency, this._currency());
  }

  // Chart options as computed signal to prevent re-renders
  chartOptions = computed((): ChartConfiguration<'line'>['options'] => {
    const symbol = this.getCurrencySymbol();
    const locale = this.translationService.getIntlLocale();
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.y ?? 0;
              return `${context.dataset.label}: ${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2 })}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => {
              return `${symbol}${Number(value).toLocaleString(locale)}`;
            },
          },
        },
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
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, { income: 0, expense: 0 });
      current.setMonth(current.getMonth() + 1);
    }

    // Aggregate transactions by month (convert to current base currency dynamically)
    for (const t of transactions) {
      const date = t.date.toDate();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

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

  // Chart data as computed signal to prevent re-renders
  chartData = computed((): ChartData<'line'> => {
    const data = this.monthlyData();

    return {
      labels: data.map(d => d.month),
      datasets: [
        {
          label: this.translationService.t('common.income'),
          data: data.map(d => d.income),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.3,
        },
        {
          label: this.translationService.t('common.totalExpenses'),
          data: data.map(d => d.expense),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.3,
        },
      ],
    };
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
