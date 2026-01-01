import { Component, computed, inject, Input, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

import { Transaction } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CurrencyService } from '../../../core/services/currency.service';

interface MonthlyComparison {
  month: string;
  monthKey: string;
  income: number;
  expense: number;
  balance: number;
  incomeChange: number | null;
  expenseChange: number | null;
}

@Component({
  selector: 'app-monthly-comparison',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatTableModule,
    BaseChartDirective,
    EmptyStateComponent,
    CurrencyPipe,
    DecimalPipe
  ],
  templateUrl: './monthly-comparison.component.html',
  styleUrl: './monthly-comparison.component.scss',
})
export class MonthlyComparisonComponent {
  private currencyService = inject(CurrencyService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set dateRange(value: { start: Date; end: Date }) {
    this._dateRange.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _dateRange = signal<{ start: Date; end: Date }>({ start: new Date(), end: new Date() });
  private _currency = signal('USD');

  // Expose currency for template
  get currencyCode(): string {
    return this._currency();
  }

  displayedColumns = ['month', 'income', 'expense', 'balance', 'change'];
  chartType = 'bar' as const;

  // Get currency symbol dynamically
  private getCurrencySymbol(): string {
    const info = this.currencyService.getCurrencyInfo(this._currency());
    return info?.symbol || this._currency();
  }

  // Convert transaction amount to current base currency dynamically
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.convert(t.amount, t.currency, this._currency());
  }

  // Chart options as a getter to use dynamic currency symbol
  get chartOptions(): ChartConfiguration<'bar'>['options'] {
    const symbol = this.getCurrencySymbol();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.y ?? 0;
              return `${context.dataset.label}: ${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `${symbol}${Number(value).toLocaleString()}`,
          },
        },
      },
    };
  }

  // Computed: Monthly data
  monthlyData = computed<MonthlyComparison[]>(() => {
    const transactions = this._transactions();
    const range = this._dateRange();

    const monthlyMap = new Map<string, { income: number; expense: number }>();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

    // Convert to array and calculate changes
    const sortedKeys = Array.from(monthlyMap.keys()).sort();
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

      result.push({
        month: `${monthNames[parseInt(month) - 1]} ${year}`,
        monthKey: key,
        income: data.income,
        expense: data.expense,
        balance: data.income - data.expense,
        incomeChange,
        expenseChange,
      });
    }

    return result;
  });

  // Computed: Chart data
  chartData = computed((): ChartData<'bar'> => {
    const data = this.monthlyData();

    return {
      labels: data.map(d => d.month),
      datasets: [
        {
          label: 'Income',
          data: data.map(d => d.income),
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderColor: '#22c55e',
          borderWidth: 1,
        },
        {
          label: 'Expenses',
          data: data.map(d => d.expense),
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor: '#ef4444',
          borderWidth: 1,
        },
      ],
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
