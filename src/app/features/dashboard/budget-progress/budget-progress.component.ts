import { Component, inject, input } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Budget, Category, Transaction } from '../../../models';
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
  templateUrl: './budget-progress.component.html',
  styleUrl: './budget-progress.component.scss',
})
export class BudgetProgressComponent {
  // Modern Angular 21: signal-based inputs
  budgets = input<Budget[]>([]);
  categories = input<Map<string, Category>>(new Map());
  transactions = input<Transaction[]>([]);
  baseCurrency = input<string>('USD');

  private currencyService = inject(CurrencyService);
  private categoryHelperService = inject(CategoryHelperService);

  // Calculate spent for a budget based on transactions in the current period
  // Returns the spent amount in the BUDGET's currency for proper comparison
  getBudgetSpent(budget: Budget): number {
    // Convert each transaction directly to budget's currency
    return this.transactions()
      .filter(t => t.categoryId === budget.categoryId && t.type === 'expense')
      .reduce((sum, t) => sum + this.currencyService.convert(t.amount, t.currency, budget.currency), 0);
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
