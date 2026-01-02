import { Component, inject, Input, Output, EventEmitter } from '@angular/core';
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

  @Input({ required: true }) budget!: Budget;
  @Input() category: Category | undefined;

  @Output() edit = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();

  get percentage(): number {
    if (!this.budget || this.budget.amount === 0) return 0;
    return Math.min((this.budget.spent / this.budget.amount) * 100, 100);
  }

  get remaining(): number {
    return Math.max(this.budget.amount - this.budget.spent, 0);
  }

  get isOverBudget(): boolean {
    return this.budget.spent > this.budget.amount;
  }

  get progressColor(): 'primary' | 'accent' | 'warn' {
    const pct = this.percentage;
    if (pct >= 80) return 'warn';
    if (pct >= 50) return 'accent';
    return 'primary';
  }

  get statusClass(): string {
    const pct = this.percentage;
    if (pct >= 100) return 'text-red-600 font-semibold';
    if (pct >= 80) return 'text-orange-500';
    if (pct >= 50) return 'text-yellow-600';
    return 'text-green-600';
  }

  get showAlert(): boolean {
    return this.percentage >= this.budget.alertThreshold;
  }

  get alertSeverity(): 'exceeded' | 'critical' | 'warning' {
    if (this.percentage >= 100) return 'exceeded';
    if (this.percentage >= 90) return 'critical';
    return 'warning';
  }

  get alertText(): string {
    switch (this.alertSeverity) {
      case 'exceeded':
        return this.translationService.t('budget.budgetExceeded');
      case 'critical':
        return this.translationService.t('budget.almostAtLimit');
      case 'warning':
        return this.translationService.t('budget.approachingLimit');
    }
  }

  get alertChipClass(): string {
    switch (this.alertSeverity) {
      case 'exceeded':
        return 'bg-red-100 text-red-700';
      case 'critical':
        return 'bg-orange-100 text-orange-700';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700';
    }
  }

  get alertTextClass(): string {
    switch (this.alertSeverity) {
      case 'exceeded':
        return 'text-red-600';
      case 'critical':
        return 'text-orange-500';
      case 'warning':
        return 'text-yellow-600';
    }
  }

  getPeriodLabel(period: BudgetPeriod): string {
    switch (period) {
      case 'weekly':
        return this.translationService.t('transactions.weekly');
      case 'monthly':
        return this.translationService.t('transactions.monthly');
      case 'yearly':
        return this.translationService.t('transactions.yearly');
    }
  }

  formatCurrency(amount: number): string {
    const locale = this.translationService.getIntlLocale();
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.budget.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  }

  getRemainingText(): string {
    if (this.isOverBudget) {
      const over = this.budget.spent - this.budget.amount;
      return this.translationService.t('budget.amountOver', { amount: this.formatCurrency(over) });
    }
    return this.translationService.t('budget.amountLeft', { amount: this.formatCurrency(this.remaining) });
  }
}
