import { Component, computed, inject, input } from '@angular/core';

import { CurrencyService } from '../../../core/services/currency.service';
import { StatCardComponent } from '../../../shared/components/stat-card/stat-card.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-financial-summary',
  standalone: true,
  imports: [StatCardComponent, TranslatePipe],
  templateUrl: './financial-summary.component.html',
  styleUrl: './financial-summary.component.scss',
})
export class FinancialSummaryComponent {
  // Modern Angular 21: signal-based inputs
  income = input<number>(0);
  expenses = input<number>(0);
  balance = input<number>(0);
  currency = input<string>('USD');
  previousIncome = input<number | null>(null);
  previousExpenses = input<number | null>(null);

  incomeChange = computed(() => this.percentChange(this.income(), this.previousIncome()));
  expensesChange = computed(() => this.percentChange(this.expenses(), this.previousExpenses()));
  balanceChange = computed(() => {
    const prevIncome = this.previousIncome();
    const prevExpenses = this.previousExpenses();
    if (prevIncome === null || prevExpenses === null) return null;
    const prevBalance = prevIncome - prevExpenses;
    if (prevBalance === 0) return null;
    return ((this.balance() - prevBalance) / Math.abs(prevBalance)) * 100;
  });

  private currencyService = inject(CurrencyService);

  formatAmount(amount: number): string {
    return this.currencyService.formatCurrency(amount, this.currency());
  }

  private percentChange(current: number, previous: number | null): number | null {
    if (previous === null || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
  }
}
