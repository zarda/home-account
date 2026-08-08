import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { CurrencyService } from '../../../core/services/currency.service';

@Component({
  selector: 'app-amount-display',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      [class]="colorClass()"
      [class.font-semibold]="bold()"
      [class.text-sm]="size() === 'sm'"
      [class.text-base]="size() === 'md'"
      [class.text-lg]="size() === 'lg'"
      [class.text-xl]="size() === 'xl'"
      [class.text-2xl]="size() === '2xl'"
    >
      @if (showSign() && amount() !== 0) {
        <span>{{ amount() > 0 ? '+' : '-' }}</span>
      }
      {{ formattedAmount() }}
    </span>
  `,
})
export class AmountDisplayComponent {
  // Signal inputs: the computeds below track them, so the rendered amount
  // and color update when a bound input changes — with plain @Input fields
  // the computeds captured no dependencies and never recomputed.
  amount = input.required<number>();
  currency = input('USD');
  type = input<'income' | 'expense' | 'neutral'>('neutral');
  showSign = input(false);
  bold = input(false);
  size = input<'sm' | 'md' | 'lg' | 'xl' | '2xl'>('md');

  private currencyService = inject(CurrencyService);

  formattedAmount = computed(() => {
    return this.currencyService.formatCurrency(Math.abs(this.amount()), this.currency());
  });

  // Token-backed utilities (tailwind.config.js maps these to the CSS
  // custom properties), so amounts follow the one income/expense pair
  // app-wide and adapt to the theme without dark: variants.
  colorClass = computed(() => {
    switch (this.type()) {
      case 'income':
        return 'text-income-text';
      case 'expense':
        return 'text-expense-text';
      default:
        return 'text-gray-900 dark:text-gray-100';
    }
  });
}
