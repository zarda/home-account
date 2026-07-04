import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { RecurringService } from '../../../core/services/recurring.service';
import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { RecurringTransaction, Category, CreateRecurringDTO } from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { RecurringFormDialogComponent } from './recurring-form-dialog/recurring-form-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-recurring-transactions',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    AmountDisplayComponent,
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatChipsModule,
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
  private announcer = inject(AnnouncerService);

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
      const message = this.t('settings.recurringPaused');
      this.snackBar.open(message, this.t('common.close'), { duration: 2000 });
      this.announcer.announce(message);
    } else {
      await this.recurringService.resumeRecurring(recurring.id);
      const message = this.t('settings.recurringResumed');
      this.snackBar.open(message, this.t('common.close'), { duration: 2000 });
      this.announcer.announce(message);
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
          const message = this.t('settings.recurringDeleted');
          this.snackBar.open(message, this.t('common.close'), { duration: 2000 });
          this.announcer.announce(message);
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
          const message = this.t('settings.recurringCreated');
          this.snackBar.open(message, this.t('common.close'), { duration: 2000 });
          this.announcer.announce(message);
        }).catch(() => {
          const message = this.t('settings.recurringCreateFailed');
          this.snackBar.open(message, this.t('common.close'), { duration: 3000 });
          this.announcer.announce(message, 'assertive');
        });
      }
    });
  }

  openEditDialog(recurring: RecurringTransaction): void {
    const dialogRef = this.dialog.open(RecurringFormDialogComponent, {
      width: '100%',
      maxWidth: '500px',
      data: { recurring }
    });

    dialogRef.afterClosed().subscribe((result: CreateRecurringDTO | undefined) => {
      if (result) {
        this.recurringService.updateRecurring(recurring.id, result).then(() => {
          const message = this.t('settings.recurringUpdated');
          this.snackBar.open(message, this.t('common.close'), { duration: 2000 });
          this.announcer.announce(message);
        }).catch(() => {
          const message = this.t('settings.recurringUpdateFailed');
          this.snackBar.open(message, this.t('common.close'), { duration: 3000 });
          this.announcer.announce(message, 'assertive');
        });
      }
    });
  }
}
