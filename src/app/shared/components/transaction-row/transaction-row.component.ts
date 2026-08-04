import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category, receiptImageCount, baseCurrencyOf} from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { CategoryChipComponent } from '../category-chip/category-chip.component';
import { FitTextDirective } from '../../directives/fit-text.directive';

/**
 * One transaction-row anatomy (category icon chip, description + category,
 * signed amount with converted secondary line, relative date, trailing
 * actions slot) shared by the dashboard recent-transactions card and the
 * transactions mobile list — previously duplicated and drifting.
 */
@Component({
  selector: 'app-transaction-row',
  standalone: true,
  imports: [MatIconModule, CategoryChipComponent, FitTextDirective],
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

  // At most three tag chips on the category line; the rest fold into "+N".
  // The row is shared with the dashboard card, so tags must not add a line.
  visibleTags(): string[] {
    return this.transaction().tags?.slice(0, 3) ?? [];
  }

  overflowTagCount(): number {
    return Math.max(0, (this.transaction().tags?.length ?? 0) - 3);
  }

  /**
   * Maps link for the row's location — only when coordinates exist. A
   * name-only location stays plain text: linking a typed name would send a
   * typo to a confidently wrong destination. The URL form is the documented
   * cross-platform Maps search, which resolves on web, Android and WKWebView.
   */
  mapsUrl(): string | null {
    const location = this.transaction().location;
    if (location?.lat === undefined || location?.lng === undefined) return null;
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
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
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    if (transaction.currency === baseCurrency) return null;
    const inBase = this.currencyService.amountInBase(transaction, baseCurrency);
    return `≈ ${this.currencyService.formatCurrency(inBase, baseCurrency)}`;
  }

  relativeDate(): string {
    return this.dateFormatService.formatRelativeDate(this.transaction().date as Date | Timestamp);
  }

  /**
   * The whole row opens the transaction, except for one strip of it.
   *
   * `.row-category` scrolls horizontally, and on a platform that draws a
   * classic scrollbar that scrollbar sits inside the row's hit area. Dragging
   * it is a scroll, not a tap, but the click still bubbles here and would open
   * the editor under the reader's cursor. A click below the scroller's content
   * box is a click on its scrollbar, and nothing else.
   *
   * Keyboard activation calls this with no event and is never affected.
   */
  onActivate(event?: Event): void {
    if (event instanceof MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.classList.contains('row-category') && event.offsetY > target.clientHeight) {
        return;
      }
    }
    this.activate.emit(this.transaction());
  }
}
