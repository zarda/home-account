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
import { TranslationService } from '../../../core/services/translation.service';
import { RecurringTransaction, Category, CreateRecurringDTO } from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { RecurringFormDialogComponent } from './recurring-form-dialog/recurring-form-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

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
    TranslatePipe,
  ],
  templateUrl: './recurring-transactions.component.html',
  styleUrl: './recurring-transactions.component.scss',
})
export class RecurringTransactionsComponent implements OnInit {
  private recurringService = inject(RecurringService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

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
    return category?.name ? this.translationService.t(category.name) : 'Unknown';
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
      this.snackBar.open(this.t('settings.recurringPaused'), this.t('common.close'), { duration: 2000 });
    } else {
      await this.recurringService.resumeRecurring(recurring.id);
      this.snackBar.open(this.t('settings.recurringResumed'), this.t('common.close'), { duration: 2000 });
    }
  }

  deleteRecurring(recurring: RecurringTransaction): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('settings.deleteRecurringTitle'),
        message: this.t('settings.deleteRecurringMessage', { name: recurring.name }),
        confirmLabel: this.t('common.delete'),
        confirmColor: 'warn',
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.recurringService.deleteRecurring(recurring.id).then(() => {
          this.snackBar.open(this.t('settings.recurringDeleted'), this.t('common.close'), { duration: 2000 });
        });
      }
    });
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(RecurringFormDialogComponent, {
      width: '100%',
      maxWidth: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe((result: CreateRecurringDTO | undefined) => {
      if (result) {
        this.recurringService.createRecurring(result).then(() => {
          this.snackBar.open(this.t('settings.recurringCreated'), this.t('common.close'), { duration: 2000 });
        }).catch(() => {
          this.snackBar.open(this.t('settings.recurringCreateFailed'), this.t('common.close'), { duration: 3000 });
        });
      }
    });
  }
}
