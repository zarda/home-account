import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import {
  BACKUP_SCHEMA_VERSION,
  ExportService,
  ImportedTransaction,
} from '../../../core/services/export.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
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

  isExporting = signal(false);
  isImporting = signal(false);
  importProgress = signal(0);
  importedTransactions = signal<ImportedTransaction[]>([]);
  showImportPreview = signal(false);

  // Export Functions
  async exportFullBackup(): Promise<void> {
    this.isExporting.set(true);
    try {
      // Fetch ALL transactions from database (not just what's loaded in the signal)
      const transactions = await firstValueFrom(this.transactionService.getAllTransactions());
      const categories = this.categoryService.categories();
      // Snapshots are user data, so a backup that omitted them would not be a
      // full one. Read one-shot rather than from the live signal, which only
      // holds whatever a subscription happened to deliver.
      const insightSnapshots = await this.insightSnapshots.exportAll();

      const blob = this.exportService.exportToJSON({
        transactions,
        categories,
        insightSnapshots,
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
        const data = JSON.parse(e.target?.result as string);

        if (!data.transactions || !Array.isArray(data.transactions)) {
          throw new Error('Invalid backup format');
        }

        // Convert to ImportedTransaction format for preview. Everything the
        // backup carries rides along so a restore round-trips the whole
        // record — except the receipt fields: a backup holds no storage
        // objects, so a restored receiptUrl would point at a dead (or
        // another account's) object and inflate the image quota with
        // pictures that don't exist.
        const transactions: ImportedTransaction[] = data.transactions.map((t: Record<string, unknown>) => ({
          description: t['description'] as string,
          amount: t['amount'] as number,
          date: new Date((t['date'] as { seconds: number }).seconds * 1000),
          type: t['type'] as 'income' | 'expense',
          ...(typeof t['currency'] === 'string' ? { currency: t['currency'] } : {}),
          ...(typeof t['categoryId'] === 'string' ? { categoryId: t['categoryId'] } : {}),
          ...(typeof t['note'] === 'string' ? { note: t['note'] } : {}),
          ...(Array.isArray(t['tags']) ? { tags: t['tags'] as string[] } : {}),
          ...(t['location'] && typeof t['location'] === 'object'
            ? { location: t['location'] as ImportedTransaction['location'] }
            : {}),
          ...(typeof t['isRecurring'] === 'boolean' ? { isRecurring: t['isRecurring'] } : {}),
          ...(typeof t['period'] === 'string'
            ? { period: t['period'] as ImportedTransaction['period'] }
            : {})
        }));

        this.importedTransactions.set(transactions);
        this.showImportPreview.set(true);
      } catch {
        const message = this.t('settings.invalidBackupFormat');
        this.notifications.error(message);
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

        const parsed = this.exportService.parseImportedData(transactions);

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

  cancelImport(): void {
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
