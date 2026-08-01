import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import {
  BACKUP_SCHEMA_VERSION,
  ExportData,
  ExportService,
  ImportedTransaction,
} from '../../../core/services/export.service';
import {
  BackupContents,
  BackupRestoreService,
  UNSUPPORTED_BACKUP_VERSION,
} from '../../../core/services/backup-restore.service';
import { BudgetService } from '../../../core/services/budget.service';
import { RecurringService } from '../../../core/services/recurring.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { CategoryService } from '../../../core/services/category.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { baseCurrencyOf } from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-data-management',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatDialogModule,
    TranslatePipe,
  ],
  templateUrl: './data-management.component.html',
  styleUrl: './data-management.component.scss',
})
export class DataManagementComponent {
  private notifications = inject(NotificationService);
  private exportService = inject(ExportService);
  private insightSnapshots = inject(InsightSnapshotService);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private budgetService = inject(BudgetService);
  private recurringService = inject(RecurringService);
  private backupRestore = inject(BackupRestoreService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);
  receiptQuota = inject(ReceiptQuotaService);

  constructor() {
    // Best-effort usage load for the receipt images section
    this.receiptQuota.refreshCount().catch(() => undefined);
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

  async openReceiptImageManager(): Promise<void> {
    const { ReceiptImageManagerComponent } = await import(
      '../../transactions/receipt-images/receipt-image-manager.component'
    );
    this.dialog.open(ReceiptImageManagerComponent, {
      width: '560px',
      maxWidth: '95vw',
      autoFocus: false,
    });
  }

  /** What an imported row with no currency of its own becomes. */
  baseCurrency = computed(() => baseCurrencyOf(this.authService.currentUser()));

  isExporting = signal(false);
  isImporting = signal(false);
  importProgress = signal(0);
  importedTransactions = signal<ImportedTransaction[]>([]);
  showImportPreview = signal(false);

  /** A parsed backup awaiting confirmation; null for the CSV import path. */
  pendingBackup = signal<ExportData | null>(null);
  backupContents = signal<BackupContents | null>(null);

  // Export Functions
  async exportFullBackup(): Promise<void> {
    this.isExporting.set(true);
    try {
      // Every section is read one-shot from the database, never from a live
      // signal — a signal only holds whatever a subscription happened to
      // deliver, which is not a backup.
      const transactions = await firstValueFrom(this.transactionService.getAllTransactions());
      const categories = await this.categoryService.exportAll();
      const insightSnapshots = await this.insightSnapshots.exportAll();
      const budgets = await this.budgetService.exportAll();
      const recurring = await this.recurringService.exportAll();

      const blob = this.exportService.exportToJSON({
        transactions,
        categories,
        insightSnapshots,
        budgets,
        recurring,
        exportDate: new Date().toISOString(),
        version: BACKUP_SCHEMA_VERSION
      });

      const date = new Date().toISOString().split('T')[0];
      const success = await this.exportService.downloadBlobWithPicker(
        blob,
        `home-account-backup-${date}.json`
      );

      if (success) {
        const message = this.t('settings.backupExported');
        this.notifications.success(message);
      }
    } catch {
      const message = this.t('settings.backupExportFailed');
      this.notifications.error(message);
    } finally {
      this.isExporting.set(false);
    }
  }

  async exportTransactionsCSV(): Promise<void> {
    this.isExporting.set(true);
    try {
      // Fetch ALL transactions from database (not just what's loaded in the signal)
      const transactions = await firstValueFrom(this.transactionService.getAllTransactions());
      const blob = this.exportService.exportToCSV(transactions);

      const date = new Date().toISOString().split('T')[0];
      const success = await this.exportService.downloadBlobWithPicker(
        blob,
        `transactions-${date}.csv`
      );

      if (success) {
        const message = this.t('settings.transactionsExported');
        this.notifications.success(message);
      }
    } catch {
      const message = this.t('settings.transactionsExportFailed');
      this.notifications.error(message);
    } finally {
      this.isExporting.set(false);
    }
  }

  // Import Functions
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const isCSV = file.name.endsWith('.csv');
    const isJSON = file.name.endsWith('.json');

    if (!isCSV && !isJSON) {
      const message = this.t('settings.selectCsvOrJson');
      this.notifications.error(message);
      return;
    }

    if (isCSV) {
      this.importCSV(file);
    } else {
      this.importJSON(file);
    }

    // Reset input
    input.value = '';
  }

  private async importCSV(file: File): Promise<void> {
    this.isImporting.set(true);
    try {
      const transactions = await this.exportService.importFromCSV(file);
      this.importedTransactions.set(transactions);
      this.showImportPreview.set(true);
    } catch {
      const message = this.t('settings.csvParseFailed');
      this.notifications.error(message);
    } finally {
      this.isImporting.set(false);
    }
  }

  private importJSON(file: File): void {
    this.isImporting.set(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        // A backup keeps its own shape all the way through the restore. It
        // used to be flattened into the CSV importer's row type here, which is
        // why categories, snapshots, budgets and recurring rules were dropped
        // and why document ids could not survive.
        const backup = this.backupRestore.parse(JSON.parse(e.target?.result as string));

        this.pendingBackup.set(backup);
        this.backupContents.set(this.backupRestore.describe(backup));
        this.showImportPreview.set(true);
      } catch (error) {
        const key = error instanceof Error && error.message === UNSUPPORTED_BACKUP_VERSION
          ? 'settings.unsupportedBackupVersion'
          : 'settings.invalidBackupFormat';
        this.notifications.error(this.t(key));
      } finally {
        this.isImporting.set(false);
      }
    };

    reader.onerror = () => {
      const message = this.t('settings.fileReadFailed');
      this.notifications.error(message);
      this.isImporting.set(false);
    };

    reader.readAsText(file);
  }

  async confirmImport(): Promise<void> {
    const backup = this.pendingBackup();
    if (backup) {
      this.confirmRestore(backup);
      return;
    }

    const transactions = this.importedTransactions();
    if (transactions.length === 0) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('settings.confirmImport'),
        message: this.t('settings.confirmImportMessage', { count: transactions.length }),
        confirmLabel: this.t('common.import'),
        confirmColor: 'primary'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        this.isImporting.set(true);
        this.importProgress.set(0);

        const parsed = this.exportService.parseImportedData(transactions, this.baseCurrency());

        // One unusable row (a zero amount from a stray CSV column, say) must
        // not abandon the rest of the file half-imported.
        let imported = 0;
        let skipped = 0;
        for (let i = 0; i < parsed.length; i++) {
          try {
            await this.transactionService.addTransaction(parsed[i]);
            imported++;
          } catch (error) {
            skipped++;
            console.error('Failed to import transaction', parsed[i], error);
          }
          this.importProgress.set(Math.round(((i + 1) / parsed.length) * 100));
        }

        if (skipped > 0) {
          this.notifications.info(
            this.t('settings.transactionsImportedPartial', { count: imported, skipped })
          );
        } else {
          this.notifications.success(
            this.t('settings.transactionsImported', { count: imported })
          );
        }
        this.cancelImport();
        this.isImporting.set(false);
      }
    });
  }

  /** Restore every section of a parsed backup, after confirmation. */
  private confirmRestore(backup: ExportData): void {
    const contents = this.backupContents();
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('settings.confirmRestore'),
        message: this.t('settings.confirmRestoreMessage', {
          transactions: contents?.transactions ?? 0,
          categories: contents?.categories ?? 0,
          budgets: contents?.budgets ?? 0,
          recurring: contents?.recurring ?? 0,
          insightSnapshots: contents?.insightSnapshots ?? 0,
        }),
        confirmLabel: this.t('common.import'),
        confirmColor: 'primary'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) return;

      this.isImporting.set(true);
      this.importProgress.set(0);
      try {
        const summary = await this.backupRestore.restore(backup);
        const restored = summary.transactions + summary.categories + summary.budgets
          + summary.recurring + summary.insightSnapshots;

        if (summary.skipped.length > 0) {
          console.error('Backup restore skipped rows', summary.skipped);
          this.notifications.info(this.t('settings.backupRestoredPartial', {
            count: restored, skipped: summary.skipped.length,
          }));
        } else {
          this.notifications.success(
            this.t('settings.backupRestored', { count: restored })
          );
        }
      } catch {
        this.notifications.error(this.t('settings.backupRestoreFailed'));
      } finally {
        this.cancelImport();
        this.isImporting.set(false);
      }
    });
  }

  cancelImport(): void {
    this.pendingBackup.set(null);
    this.backupContents.set(null);
    this.importedTransactions.set([]);
    this.showImportPreview.set(false);
    this.importProgress.set(0);
  }

  // Danger Zone
  deleteAllTransactions(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('settings.deleteAllTransactions'),
        message: this.t('settings.deleteAllConfirmMessage'),
        confirmLabel: this.t('settings.deleteAll'),
        confirmColor: 'warn'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        // Second confirmation
        const secondConfirm = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: this.t('settings.finalConfirmation'),
            message: this.t('settings.typeDeleteConfirm'),
            confirmLabel: this.t('settings.confirmDelete'),
            confirmColor: 'warn'
          }
        });

        secondConfirm.afterClosed().subscribe(async (finalConfirm) => {
          if (finalConfirm) {
            try {
              const deleted = await this.transactionService.deleteAllTransactions();
              const message = this.t('settings.allTransactionsDeleted', { count: deleted });
              this.notifications.success(message);
            } catch {
              const message = this.t('settings.deleteTransactionsFailed');
              this.notifications.error(message);
            }
          }
        });
      }
    });
  }
}
