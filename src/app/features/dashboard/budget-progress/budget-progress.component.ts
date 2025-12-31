import { Component, inject, Input } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Budget, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';

@Component({
  selector: 'app-budget-progress',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule
  ],
  templateUrl: './budget-progress.component.html',
  styleUrl: './budget-progress.component.scss',
})
export class BudgetProgressComponent {
  @Input() budgets: Budget[] = [];
  @Input() categories: Map<string, Category> = new Map<string, Category>();

  private currencyService = inject(CurrencyService);
  private categoryHelperService = inject(CategoryHelperService);

  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories);
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories);
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories);
  }

  formatAmount(amount: number, currency: string): string {
    return this.currencyService.formatCurrency(amount, currency);
  }

  getPercentage(budget: Budget): number {
    if (budget.amount === 0) return 0;
    return Math.min((budget.spent / budget.amount) * 100, 100);
  }

  getProgressColor(budget: Budget): 'primary' | 'accent' | 'warn' {
    const percentage = this.getPercentage(budget);
    if (percentage >= 100) return 'warn';
    if (percentage >= 80) return 'accent';
    return 'primary';
  }

  getRemainingText(budget: Budget): string {
    const remaining = budget.amount - budget.spent;
    if (remaining <= 0) {
      const over = budget.spent - budget.amount;
      return `${this.formatAmount(over, budget.currency)} over`;
    }
    return `${this.formatAmount(remaining, budget.currency)} left`;
  }

  getPercentageClass(budget: Budget): string {
    const percentage = this.getPercentage(budget);
    if (percentage >= 100) return 'text-red-600';
    if (percentage >= 80) return 'text-yellow-600';
    return 'text-green-600';
  }
}
