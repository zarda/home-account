import { Component, inject, Input } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-recent-transactions',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    EmptyStateComponent,
    TranslatePipe
  ],
  templateUrl: './recent-transactions.component.html',
  styleUrl: './recent-transactions.component.scss',
})
export class RecentTransactionsComponent {
  @Input() transactions: Transaction[] = [];
  @Input() categories: Map<string, Category> = new Map<string, Category>();

  private currencyService = inject(CurrencyService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);

  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories);
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories);
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories);
  }

  formatAmount(amount: number, currency: string): string {
    return this.currencyService.formatCurrency(amount, currency);
  }

  formatDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatDate(date);
  }

  formatRelativeDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatRelativeDate(date);
  }

  onAddTransaction(): void {
    // Navigate to transactions page with add mode
    window.location.href = '/transactions?action=add';
  }
}
