import { Component, inject, input } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-financial-summary',
  standalone: true,
  imports: [MatCardModule, MatIconModule, TranslatePipe],
  templateUrl: './financial-summary.component.html',
  styleUrl: './financial-summary.component.scss',
})
export class FinancialSummaryComponent {
  // Modern Angular 21: signal-based inputs
  income = input<number>(0);
  expenses = input<number>(0);
  balance = input<number>(0);
  currency = input<string>('USD');

  private currencyService = inject(CurrencyService);

  formatAmount(amount: number): string {
    return this.currencyService.formatCurrency(amount, this.currency());
  }
}
