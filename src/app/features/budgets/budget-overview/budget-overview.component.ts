import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Budget, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { BudgetProgressCardComponent } from '../budget-progress-card/budget-progress-card.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-budget-overview',
  standalone: true,
  imports: [CommonModule, BudgetProgressCardComponent, TranslatePipe],
  templateUrl: './budget-overview.component.html',
  styleUrl: './budget-overview.component.scss'
})
export class BudgetOverviewComponent {
  private currencyService = inject(CurrencyService);

  // Modern Angular 21: signal-based inputs/outputs
  budgets = input.required<Budget[]>();
  categories = input.required<Map<string, Category>>();

  edit = output<Budget>();
  delete = output<Budget>();

  // Summary strip totals. Budgets in a period share a currency in practice,
  // so the strip formats with the first budget's currency.
  private displayCurrency = computed(() => this.budgets()[0]?.currency ?? 'USD');

  totalBudgeted = computed(() =>
    this.budgets().reduce((sum, b) => sum + b.amount, 0)
  );

  totalSpent = computed(() =>
    this.budgets().reduce((sum, b) => sum + b.spent, 0)
  );

  overallPercent = computed(() => {
    const budgeted = this.totalBudgeted();
    return budgeted > 0 ? Math.round((this.totalSpent() / budgeted) * 100) : 0;
  });

  /** 'over' at ≥100%, 'warning' from 80%, else 'ok' — matches card severity. */
  overallState = computed<'ok' | 'warning' | 'over'>(() => {
    const pct = this.overallPercent();
    if (pct >= 100) return 'over';
    if (pct >= 80) return 'warning';
    return 'ok';
  });

  getCategory(categoryId: string): Category | undefined {
    return this.categories().get(categoryId);
  }

  format(amount: number): string {
    return this.currencyService.formatCurrency(amount, this.displayCurrency());
  }
}
