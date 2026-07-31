import { Component, computed, inject, Input, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { Transaction } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-recurring-breakdown',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    EmptyStateComponent,
    CurrencyPipe,
    TranslatePipe,
  ],
  templateUrl: './recurring-breakdown.component.html',
  styleUrl: './recurring-breakdown.component.scss',
})
export class RecurringBreakdownComponent {
  private currencyService = inject(CurrencyService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _currency = signal('USD');

  // Expose currency for template
  get currencyCode(): string {
    return this._currency();
  }

  // Convert transaction amount to current base currency dynamically. Matches
  // the Category Breakdown tab this card sits beside (which also uses
  // `convert` rather than the stored `amountInBase` snapshot other tabs use).
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.convert(t.amount, t.currency, this._currency());
  }

  /**
   * A transaction counts as recurring when it carries a `recurringId` (the
   * recurring engine materialised it) OR the user manually ticked
   * `isRecurring` on a one-off entry.
   *
   * recurring-pattern.utils.ts deliberately keeps those two populations apart
   * for CLUSTERING, where merging them would double-count declared
   * occurrences against the ones it detects by similarity. That concern does
   * not apply here: this is a binary committed-vs-discretionary split where
   * every transaction is counted exactly once, and a transaction the user
   * flagged as recurring is committed spending regardless of whether the
   * recurring engine created it. Do not "fix" this to `recurringId` only.
   */
  private isRecurring(t: Transaction): boolean {
    return !!t.recurringId || t.isRecurring;
  }

  expenses = computed(() => this._transactions().filter(t => t.type === 'expense'));

  private recurringExpenses = computed(() =>
    this.expenses().filter(t => this.isRecurring(t)));

  private oneOffExpenses = computed(() =>
    this.expenses().filter(t => !this.isRecurring(t)));

  recurringCount = computed(() => this.recurringExpenses().length);
  oneOffCount = computed(() => this.oneOffExpenses().length);

  recurringTotal = computed(() =>
    this.recurringExpenses().reduce((sum, t) => sum + this.toBaseCurrency(t), 0));

  oneOffTotal = computed(() =>
    this.oneOffExpenses().reduce((sum, t) => sum + this.toBaseCurrency(t), 0));

  private totalExpenses = computed(() => this.recurringTotal() + this.oneOffTotal());

  // Recurring as a percentage of total expenses, guarded against a zero total.
  recurringShare = computed(() => {
    const total = this.totalExpenses();
    return total > 0 ? (this.recurringTotal() / total) * 100 : 0;
  });

  oneOffShare = computed(() => {
    const total = this.totalExpenses();
    return total > 0 ? (this.oneOffTotal() / total) * 100 : 0;
  });

  hasExpenses = computed(() => this.expenses().length > 0);
  hasRecurring = computed(() => this.recurringCount() > 0);
}
