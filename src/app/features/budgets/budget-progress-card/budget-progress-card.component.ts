import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';

import { Budget, BudgetPeriod } from '../../../models';
import { Category } from '../../../models';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-budget-progress-card',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressBarModule,
    MatIconModule,
    MatMenuModule,
    MatChipsModule,
    MatButtonModule,
    TranslatePipe
  ],
  templateUrl: './budget-progress-card.component.html',
  styleUrls: ['./budget-progress-card.component.scss']
})
export class BudgetProgressCardComponent {
  private translationService = inject(TranslationService);

  // Modern Angular 21: signal-based inputs/outputs
  budget = input.required<Budget>();
  category = input<Category | undefined>();

  edit = output<void>();
  delete = output<void>();

  // Convert getters to computed signals for better performance
  percentage = computed(() => {
    const budget = this.budget();
    if (!budget || budget.amount === 0) return 0;
    return Math.min((budget.spent / budget.amount) * 100, 100);
  });

  remaining = computed(() => {
    const budget = this.budget();
    return Math.max(budget.amount - budget.spent, 0);
  });

  isOverBudget = computed(() => {
    const budget = this.budget();
    return budget.spent > budget.amount;
  });

  progressColor = computed((): 'primary' | 'accent' | 'warn' => {
    const pct = this.percentage();
    if (pct >= 80) return 'warn';
    if (pct >= 50) return 'accent';
    return 'primary';
  });

  statusClass = computed(() => {
    const pct = this.percentage();
    if (pct >= 100) return 'text-red-600 font-semibold';
    if (pct >= 80) return 'text-orange-500';
    if (pct >= 50) return 'text-yellow-600';
    return 'text-green-600';
  });

  showAlert = computed(() => {
    return this.percentage() >= this.budget().alertThreshold;
  });

  alertSeverity = computed((): 'exceeded' | 'critical' | 'warning' => {
    const pct = this.percentage();
    if (pct >= 100) return 'exceeded';
    if (pct >= 90) return 'critical';
    return 'warning';
  });

  alertText = computed(() => {
    switch (this.alertSeverity()) {
      case 'exceeded':
        return this.translationService.t('budget.budgetExceeded');
      case 'critical':
        return this.translationService.t('budget.almostAtLimit');
      case 'warning':
        return this.translationService.t('budget.approachingLimit');
      default:
        return this.translationService.t('budget.approachingLimit');
    }
  });

  alertChipClass = computed(() => {
    switch (this.alertSeverity()) {
      case 'exceeded':
        return 'bg-red-100 text-red-700';
      case 'critical':
        return 'bg-orange-100 text-orange-700';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-yellow-100 text-yellow-700';
    }
  });

  alertTextClass = computed(() => {
    switch (this.alertSeverity()) {
      case 'exceeded':
        return 'text-red-600';
      case 'critical':
        return 'text-orange-500';
      case 'warning':
        return 'text-yellow-600';
      default:
        return 'text-yellow-600';
    }
  });

  getPeriodLabel(period: BudgetPeriod): string {
    switch (period) {
      case 'weekly':
        return this.translationService.t('transactions.weekly');
      case 'monthly':
        return this.translationService.t('transactions.monthly');
      case 'yearly':
        return this.translationService.t('transactions.yearly');
      default:
        return this.translationService.t('transactions.monthly');
    }
  }

  formatCurrency(amount: number): string {
    const locale = this.translationService.getIntlLocale();
    const budget = this.budget();
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: budget.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  }

  getRemainingText(): string {
    const budget = this.budget();
    if (this.isOverBudget()) {
      const over = budget.spent - budget.amount;
      return this.translationService.t('budget.amountOver', { amount: this.formatCurrency(over) });
    }
    return this.translationService.t('budget.amountLeft', { amount: this.formatCurrency(this.remaining()) });
  }
}
