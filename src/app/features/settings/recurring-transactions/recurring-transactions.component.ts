import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { RecurringService } from '../../../core/services/recurring.service';
import { CategoryService } from '../../../core/services/category.service';
import { RecurringTransaction, Category, CreateRecurringDTO } from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { RecurringFormDialogComponent } from './recurring-form-dialog/recurring-form-dialog.component';

@Component({
  selector: 'app-recurring-transactions',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
    EmptyStateComponent,
    CurrencyPipe,
    DatePipe,
  ],
  templateUrl: './recurring-transactions.component.html',
  styleUrl: './recurring-transactions.component.scss',
})
export class RecurringTransactionsComponent implements OnInit {
  private recurringService = inject(RecurringService);
  private categoryService = inject(CategoryService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  recurringTransactions = signal<RecurringTransaction[]>([]);
  categories = signal<Category[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.recurringService.getRecurring().subscribe({
      next: (recurring) => {
        this.recurringTransactions.set(recurring);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });

    this.categoryService.loadCategories().subscribe({
      next: (categories) => this.categories.set(categories)
    });
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.name || 'Unknown';
  }

  getCategoryIcon(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.icon || 'category';
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories().find(c => c.id === categoryId);
    return category?.color || '#9E9E9E';
  }

  getFrequencyText(recurring: RecurringTransaction): string {
    return this.recurringService.getFrequencyText(recurring.frequency);
  }

  async toggleActive(recurring: RecurringTransaction): Promise<void> {
    if (recurring.isActive) {
      await this.recurringService.pauseRecurring(recurring.id);
      this.snackBar.open('Recurring transaction paused', 'Close', { duration: 2000 });
    } else {
      await this.recurringService.resumeRecurring(recurring.id);
      this.snackBar.open('Recurring transaction resumed', 'Close', { duration: 2000 });
    }
  }

  deleteRecurring(recurring: RecurringTransaction): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Recurring Transaction',
        message: `Are you sure you want to delete "${recurring.name}"? This will not affect existing transactions.`,
        confirmText: 'Delete',
        confirmColor: 'warn',
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.recurringService.deleteRecurring(recurring.id).then(() => {
          this.snackBar.open('Recurring transaction deleted', 'Close', { duration: 2000 });
        });
      }
    });
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(RecurringFormDialogComponent, {
      width: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe((result: CreateRecurringDTO | undefined) => {
      if (result) {
        this.recurringService.createRecurring(result).then(() => {
          this.snackBar.open('Recurring transaction created', 'Close', { duration: 2000 });
        }).catch(() => {
          this.snackBar.open('Failed to create recurring transaction', 'Close', { duration: 3000 });
        });
      }
    });
  }
}
