import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { Transaction } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { LocaleNumberPipe } from '../../../shared/pipes/locale-number.pipe';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { groupExpensesByCountry } from '../../../core/utils/transaction-aggregation.utils';
import { countryDisplayName } from '../../../core/utils/currency-suggestion.utils';

/** Rows beyond this are summarised as a remainder line rather than listed. */
const MAX_ROWS = 8;

/**
 * What the period cost, per country.
 *
 * This is the reader `location.country` did not have. 0064 declined to store a
 * country with no printed address partly because "a country alone renders as
 * nothing anywhere"; 0068 stores it and this is where it is read (#155).
 *
 * Sits in the Categories tab beside the recurring split rather than in a tab
 * of its own: a new tab is a REPORT_TABS entry, a `?tab=` value and a
 * deep-link contract, which is a lot of contract for a card that is empty on
 * every account until receipts are scanned after this version.
 */
@Component({
  selector: 'app-country-breakdown',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    EmptyStateComponent,
    CurrencyPipe,
    LocaleNumberPipe,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './country-breakdown.component.html',
  styleUrl: './country-breakdown.component.scss',
})
export class CountryBreakdownComponent {
  private currencyService = inject(CurrencyService);
  private localeFormat = inject(LocaleFormatService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _currency = signal('USD');

  get currencyCode(): string {
    return this._currency();
  }

  // `convert` rather than the stored `amountInBase` snapshot, matching the
  // Categories tab this card sits in.
  private toBaseCurrency = (t: Transaction): number =>
    this.currencyService.convert(t.amount, t.currency, this._currency());

  private breakdown = computed(() =>
    groupExpensesByCountry(this._transactions(), this.toBaseCurrency));

  private placedTotal = computed(() =>
    this.breakdown().countries.reduce((sum, c) => sum + c.total, 0));

  /** The ranked rows, capped, each with its share of the placed spend. */
  rows = computed(() => {
    const total = this.placedTotal();
    return this.breakdown().countries.slice(0, MAX_ROWS).map(c => ({
      country: c.country,
      name: countryDisplayName(c.country, this.localeFormat.locale),
      total: c.total,
      count: c.count,
      share: total > 0 ? (c.total / total) * 100 : 0,
    }));
  });

  /** Countries past the cap, summarised rather than listed. */
  remainderCount = computed(() =>
    Math.max(0, this.breakdown().countries.length - MAX_ROWS));

  placed = computed(() => this.breakdown().placed);
  expenses = computed(() => this.breakdown().expenses);

  /** True once anything in the period carries a country. */
  hasCountries = computed(() => this.breakdown().countries.length > 0);

  /** The card renders at all only when the period has expenses to speak about. */
  hasExpenses = computed(() => this.breakdown().expenses > 0);
}
