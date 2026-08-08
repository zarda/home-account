import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Budget, Category } from '../../../models';
import { getBudgetAlertSeverity } from '../../../core/utils/budget-alert.utils';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-budget-progress',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budget-progress.component.html',
  styleUrl: './budget-progress.component.scss',
})
export class BudgetProgressComponent {
  // Modern Angular 21: signal-based inputs
  budgets = input<Budget[]>([]);
  categories = input<Map<string, Category>>(new Map());

  private currencyService = inject(CurrencyService);
  private categoryHelperService = inject(CategoryHelperService);

  // The card reads the same persisted, budget-period-anchored `spent` figure
  // that budget alerts are computed from (BudgetService.recalculateBudgetSpent,
  // already in the budget's currency) — previously it recomputed spend from
  // the dashboard's selected calendar period, so the alert snackbar could say
  // "117% used" while this card showed 30% for the same budget.
  getBudgetSpent(budget: Budget): number {
    return budget.spent;
  }

  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories());
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories());
  }

  formatAmount(amount: number, currency: string): string {
    return this.currencyService.formatCurrency(amount, currency);
  }

  // True utilization — uncapped so overspend reads honestly; the progress
  // bar clamps separately via getBarValue.
  getPercentage(budget: Budget): number {
    if (budget.amount === 0) return 0;
    const spent = this.getBudgetSpent(budget);
    return (spent / budget.amount) * 100;
  }

  getBarValue(budget: Budget): number {
    return Math.min(this.getPercentage(budget), 100);
  }

  // Bar and percentage text derive from one severity so the row can never
  // send mixed signals for a single state.
  private getSeverity(budget: Budget) {
    return getBudgetAlertSeverity(this.getPercentage(budget), budget.alertThreshold);
  }

  getProgressColor(budget: Budget): 'primary' | 'accent' | 'warn' {
    switch (this.getSeverity(budget)) {
      case 'exceeded':
        return 'warn';
      case 'critical':
      case 'warning':
        return 'accent';
      default:
        return 'primary';
    }
  }

  getRemainingText(budget: Budget): string {
    const spent = this.getBudgetSpent(budget);
    const remaining = budget.amount - spent;
    if (remaining <= 0) {
      const over = spent - budget.amount;
      return `${this.formatAmount(over, budget.currency)} over`;
    }
    return `${this.formatAmount(remaining, budget.currency)} left`;
  }

  getPercentageClass(budget: Budget): string {
    switch (this.getSeverity(budget)) {
      case 'exceeded':
        return 'text-red-600';
      case 'critical':
        return 'text-orange-500';
      case 'warning':
        return 'text-yellow-600';
      default:
        return 'text-green-600';
    }
  }
}
