import { Component, computed, Input, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { Category } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

interface CategoryTotal {
  categoryId: string;
  total: number;
}

@Component({
  selector: 'app-spending-chart',
  standalone: true,
  imports: [MatCardModule, MatIconModule, BaseChartDirective, EmptyStateComponent],
  templateUrl: './spending-chart.component.html',
  styleUrl: './spending-chart.component.scss',
})
export class SpendingChartComponent {
  @Input() set categoryTotals(value: CategoryTotal[]) {
    this._categoryTotals.set(value);
  }
  get categoryTotals(): CategoryTotal[] {
    return this._categoryTotals();
  }

  @Input() categories: Category[] = [];

  private _categoryTotals = signal<CategoryTotal[]>([]);

  chartType = 'doughnut' as const;

  chartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed;
            const data = context.dataset.data as number[];
            const total = data.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
            return `${context.label}: ${percentage}%`;
          },
        },
      },
    },
    cutout: '60%',
  };

  topCategories = computed(() => {
    return this._categoryTotals().slice(0, 6);
  });

  totalSpending = computed(() => {
    return this._categoryTotals().reduce((sum, ct) => sum + ct.total, 0);
  });

  chartData = computed((): ChartData<'doughnut'> => {
    const top = this.topCategories();
    const labels = top.map(ct => this.getCategoryName(ct.categoryId));
    const data = top.map(ct => ct.total);
    const colors = top.map(ct => this.getCategoryColor(ct.categoryId));

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    };
  });

  getCategoryName(categoryId: string): string {
    const category = this.categories.find(c => c.id === categoryId);
    return category?.name || 'Unknown';
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find(c => c.id === categoryId);
    return category?.color || '#9E9E9E';
  }
}
