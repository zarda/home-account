import { Component, computed, inject, input, output } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { Category } from '../../../models';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { ChartThemeService } from '../../../core/services/chart-theme.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

interface CategoryTotal {
  categoryId: string;
  total: number;
  count: number;
}

@Component({
  selector: 'app-spending-chart',
  standalone: true,
  imports: [MatCardModule, MatIconModule, BaseChartDirective, EmptyStateComponent, TranslatePipe],
  templateUrl: './spending-chart.component.html',
  styleUrl: './spending-chart.component.scss',
})
export class SpendingChartComponent {
  private translationService = inject(TranslationService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private chartTheme = inject(ChartThemeService);

  // Modern Angular 21: signal-based inputs
  categoryTotals = input<CategoryTotal[]>([]);
  categories = input<Category[]>([]);

  /** A category the user picked, from either the doughnut or the legend. */
  categoryActivated = output<string>();

  chartType = 'doughnut' as const;

  chartOptions = computed((): ChartConfiguration<'doughnut'>['options'] => {
    const palette = this.chartTheme.palette();
    return {
      responsive: true,
      maintainAspectRatio: true,
      animation: this.chartTheme.animation(),
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          titleFont: { family: palette.fontFamily },
          bodyFont: { family: palette.fontFamily },
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
  });

  topCategories = computed(() => {
    return this.categoryTotals().slice(0, 6);
  });

  totalSpending = computed(() => {
    return this.categoryTotals().reduce((sum, ct) => sum + ct.total, 0);
  });

  chartData = computed((): ChartData<'doughnut'> => {
    const top = this.topCategories();
    const categories = this.categories();

    const getCategoryName = (categoryId: string): string => {
      const category = categories.find(c => c.id === categoryId);
      return category?.name ? this.translationService.t(category.name) : 'Unknown';
    };

    const getCategoryColor = (categoryId: string): string => {
      const category = categories.find(c => c.id === categoryId);
      return category?.color || '#9E9E9E';
    };

    const labels = top.map(ct => getCategoryName(ct.categoryId));
    const data = top.map(ct => ct.total);
    const colors = top.map(ct => getCategoryColor(ct.categoryId));

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

  /** A slice click; ng2-charts hands over the Chart.js hit-test result. */
  onChartClick(event: { active?: object[] }): void {
    const active = event.active?.[0] as { index?: number } | undefined;
    if (active?.index === undefined) return;
    // chartData() is built from this same topCategories() computed, so the
    // positional index is the category — keep them derived from one source.
    const categoryId = this.topCategories()[active.index]?.categoryId;
    if (categoryId) this.categoryActivated.emit(categoryId);
  }

  onLegendActivate(categoryId: string): void {
    this.categoryActivated.emit(categoryId);
  }

  /**
   * The legend row is a button, so it needs to say what activating it does.
   * An aria-label wins the accessible-name computation outright, hiding the
   * amount and share rendered inside the button — so they are composed into
   * the label here and the row still reads completely.
   */
  legendAriaLabel(item: CategoryTotal): string {
    const action = this.translationService.t('dashboard.viewCategoryTransactions', {
      category: this.getCategoryName(item.categoryId),
    });
    // Same rounding as the visible percentage, so the two never disagree.
    const share = this.getPercentage(item.total).toFixed(0);
    return `${action}, ${this.formatAmount(item.total)}, ${share}%`;
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Unknown';
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.color || '#9E9E9E';
  }

  getCategoryIcon(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.icon || 'category';
  }

  getPercentage(total: number): number {
    const totalSpending = this.totalSpending();
    return totalSpending > 0 ? (total / totalSpending) * 100 : 0;
  }

  formatAmount(amount: number): string {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
    return this.currencyService.formatCurrency(amount, baseCurrency);
  }
}
