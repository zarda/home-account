import { Component, computed, inject, Input } from '@angular/core';

import { CurrencyService } from '../../../core/services/currency.service';

@Component({
  selector: 'app-amount-display',
  standalone: true,
  imports: [],
  template: `
    <span
      [class]="colorClass()"
      [class.font-semibold]="bold"
      [class.text-sm]="size === 'sm'"
      [class.text-base]="size === 'md'"
      [class.text-lg]="size === 'lg'"
      [class.text-xl]="size === 'xl'"
      [class.text-2xl]="size === '2xl'"
    >
      @if (showSign && amount > 0) {
        <span>+</span>
      }
      {{ formattedAmount() }}
    </span>
  `,
})
export class AmountDisplayComponent {
  @Input({ required: true }) amount!: number;
  @Input() currency = 'USD';
  @Input() type: 'income' | 'expense' | 'neutral' = 'neutral';
  @Input() showSign = false;
  @Input() bold = false;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' | '2xl' = 'md';

  private currencyService = inject(CurrencyService);

  formattedAmount = computed(() => {
    return this.currencyService.formatCurrency(Math.abs(this.amount), this.currency);
  });

  colorClass = computed(() => {
    switch (this.type) {
      case 'income':
        return 'text-green-600 dark:text-green-400';
      case 'expense':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-900 dark:text-gray-100';
    }
  });
}
