import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category, receiptImageCount } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { CategoryChipComponent } from '../category-chip/category-chip.component';

/**
 * One transaction-row anatomy (category icon chip, description + category,
 * signed amount with converted secondary line, relative date, trailing
 * actions slot) shared by the dashboard recent-transactions card and the
 * transactions mobile list — previously duplicated and drifting.
 */
@Component({
  selector: 'app-transaction-row',
  standalone: true,
  imports: [MatIconModule, CategoryChipComponent],
  templateUrl: './transaction-row.component.html',
  styleUrl: './transaction-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionRowComponent {
  transaction = input.required<Transaction>();
  categories = input<Map<string, Category>>(new Map());

  /** Emitted on click / Enter / Space anywhere on the row. */
  activate = output<Transaction>();

  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);

  categoryName(): string {
    return this.categoryHelperService.getCategoryName(
      this.transaction().categoryId,
      this.categories()
    );
  }

  categoryIcon(): string {
    return this.categoryHelperService.getCategoryIcon(
      this.transaction().categoryId,
      this.categories()
    );
  }

  categoryColor(): string {
    return this.categoryHelperService.getCategoryColor(
      this.transaction().categoryId,
      this.categories()
    );
  }

  // Templates cannot call module functions, so the model helper is exposed
  // through the component.
  receiptCount(): number {
    return receiptImageCount(this.transaction());
  }

  formatAmount(): string {
    const transaction = this.transaction();
    return this.currencyService.formatCurrency(transaction.amount, transaction.currency);
  }

  // Secondary line for foreign-currency rows: what the row counts as in the
  // user's base currency (write-time snapshot; live conversion for legacy
  // rows). Null for rows already in the base currency.
  convertedAmount(): string | null {
    const transaction = this.transaction();
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
    if (transaction.currency === baseCurrency) return null;
    const inBase = this.currencyService.amountInBase(transaction, baseCurrency);
    return `≈ ${this.currencyService.formatCurrency(inBase, baseCurrency)}`;
  }

  relativeDate(): string {
    return this.dateFormatService.formatRelativeDate(this.transaction().date as Date | Timestamp);
  }

  onActivate(): void {
    this.activate.emit(this.transaction());
  }
}
