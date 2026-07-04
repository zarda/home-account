import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [
    CategoryChipComponent,
    TransactionRowComponent,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    EmptyStateComponent,
    TranslatePipe
  ],
  templateUrl: './transaction-list.component.html',
  styleUrl: './transaction-list.component.scss',
})
export class TransactionListComponent {
  // Modern Angular 21: signal-based inputs/outputs
  transactions = input<Transaction[]>([]);
  categories = input<Map<string, Category>>(new Map());
  edit = output<Transaction>();
  delete = output<Transaction>();

  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);
  private announcer = inject(AnnouncerService);

  displayedColumns = ['date', 'category', 'description', 'amount', 'actions'];

  private previousCount: number | null = null;

  constructor() {
    // Announce result-count changes (e.g. after filtering) to assistive technology.
    effect(() => {
      const count = this.transactions().length;
      if (this.previousCount !== null && this.previousCount !== count) {
        this.announcer.announce(
          this.translationService.t('transactions.resultCountAnnouncement', { count })
        );
      }
      this.previousCount = count;
    });
  }

  // Use signals for sort state
  private sortActive = signal<string>('date');
  private sortDirection = signal<'asc' | 'desc'>('desc');

  // Convert getter to computed signal for better performance
  sortedTransactions = computed(() => {
    const transactions = this.transactions();
    const active = this.sortActive();
    const direction = this.sortDirection();
    const dir = direction === 'asc' ? 1 : -1;

    return [...transactions].sort((a, b) => {
      switch (active) {
        case 'date': {
          const dateA = a.date?.toDate?.() || new Date();
          const dateB = b.date?.toDate?.() || new Date();
          return (dateA.getTime() - dateB.getTime()) * dir;
        }
        case 'amount':
          return (a.amount - b.amount) * dir;
        case 'description':
          return a.description.localeCompare(b.description) * dir;
        default:
          return 0;
      }
    });
  });

  onSortChange(sort: Sort): void {
    this.sortActive.set(sort.active);
    this.sortDirection.set((sort.direction as 'asc' | 'desc') || 'desc');
  }

  // Helper methods - these are called from template, so they're fine as methods
  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories());
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories());
  }

  formatAmount(amount: number, currency: string): string {
    return this.currencyService.formatCurrency(amount, currency);
  }

  // Secondary line for foreign-currency rows: what the row counts as in the
  // user's base currency (write-time snapshot; live conversion for legacy
  // rows). Null for rows already in the base currency.
  convertedAmount(transaction: Transaction): string | null {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
    if (transaction.currency === baseCurrency) return null;
    const inBase = this.currencyService.amountInBase(transaction, baseCurrency);
    return `≈ ${this.currencyService.formatCurrency(inBase, baseCurrency)}`;
  }

  formatDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatDate(date);
  }

  formatRelativeDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatRelativeDate(date);
  }

  confirmDelete(transaction: Transaction): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translationService.t('transactions.deleteTransaction'),
        message: this.translationService.t('transactions.deleteConfirmMessage', { description: transaction.description }),
        confirmLabel: this.translationService.t('common.delete'),
        cancelLabel: this.translationService.t('common.cancel'),
        confirmColor: 'warn',
        icon: 'delete',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.delete.emit(transaction);
      }
    });
  }
}
