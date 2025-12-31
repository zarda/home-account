import { Component, EventEmitter, inject, Input, Output } from '@angular/core';

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
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    EmptyStateComponent
  ],
  templateUrl: './transaction-list.component.html',
  styleUrl: './transaction-list.component.scss',
})
export class TransactionListComponent {
  @Input() transactions: Transaction[] = [];
  @Input() categories: Map<string, Category> = new Map<string, Category>();
  @Output() edit = new EventEmitter<Transaction>();
  @Output() delete = new EventEmitter<Transaction>();

  private currencyService = inject(CurrencyService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);
  private dialog = inject(MatDialog);

  displayedColumns = ['date', 'category', 'description', 'amount', 'actions'];

  private sortActive = 'date';
  private sortDirection: 'asc' | 'desc' = 'desc';

  get sortedTransactions(): Transaction[] {
    return [...this.transactions].sort((a, b) => {
      const direction = this.sortDirection === 'asc' ? 1 : -1;

      switch (this.sortActive) {
        case 'date': {
          const dateA = a.date?.toDate?.() || new Date();
          const dateB = b.date?.toDate?.() || new Date();
          return (dateA.getTime() - dateB.getTime()) * direction;
        }

        case 'amount':
          return (a.amount - b.amount) * direction;

        case 'description':
          return a.description.localeCompare(b.description) * direction;

        default:
          return 0;
      }
    });
  }

  onSortChange(sort: Sort): void {
    this.sortActive = sort.active;
    this.sortDirection = sort.direction as 'asc' | 'desc' || 'desc';
  }

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

  confirmDelete(transaction: Transaction): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete Transaction',
        message: `Are you sure you want to delete "${transaction.description}"? This action cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
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
