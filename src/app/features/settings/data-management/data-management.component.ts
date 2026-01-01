import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ExportService, ImportedTransaction } from '../../../core/services/export.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { CategoryService } from '../../../core/services/category.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-data-management',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './data-management.component.html',
  styleUrl: './data-management.component.scss',
})
export class DataManagementComponent {
  private exportService = inject(ExportService);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private authService = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  isExporting = signal(false);
  isImporting = signal(false);
  importProgress = signal(0);
  importedTransactions = signal<ImportedTransaction[]>([]);
  showImportPreview = signal(false);

  // Export Functions
  async exportFullBackup(): Promise<void> {
    this.isExporting.set(true);
    try {
      const transactions = this.transactionService.transactions();
      const categories = this.categoryService.categories();

      const blob = this.exportService.exportToJSON({
        transactions,
        categories,
        exportDate: new Date().toISOString(),
        version: '1.0'
      });

      const date = new Date().toISOString().split('T')[0];
      this.exportService.downloadBlob(blob, `home-account-backup-${date}.json`);
      this.snackBar.open('Backup exported successfully', 'Close', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to export backup', 'Close', { duration: 3000 });
    } finally {
      this.isExporting.set(false);
    }
  }

  async exportTransactionsCSV(): Promise<void> {
    this.isExporting.set(true);
    try {
      const transactions = this.transactionService.transactions();
      const blob = this.exportService.exportToCSV(transactions);

      const date = new Date().toISOString().split('T')[0];
      this.exportService.downloadBlob(blob, `transactions-${date}.csv`);
      this.snackBar.open('Transactions exported successfully', 'Close', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to export transactions', 'Close', { duration: 3000 });
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
      this.snackBar.open('Please select a CSV or JSON file', 'Close', { duration: 3000 });
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
      this.snackBar.open('Failed to parse CSV file', 'Close', { duration: 3000 });
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

        // Convert to ImportedTransaction format for preview
        const transactions: ImportedTransaction[] = data.transactions.map((t: Record<string, unknown>) => ({
          description: t['description'] as string,
          amount: t['amount'] as number,
          date: new Date((t['date'] as { seconds: number }).seconds * 1000),
          type: t['type'] as 'income' | 'expense'
        }));

        this.importedTransactions.set(transactions);
        this.showImportPreview.set(true);
      } catch {
        this.snackBar.open('Invalid backup file format', 'Close', { duration: 3000 });
      } finally {
        this.isImporting.set(false);
      }
    };

    reader.onerror = () => {
      this.snackBar.open('Failed to read file', 'Close', { duration: 3000 });
      this.isImporting.set(false);
    };

    reader.readAsText(file);
  }

  async confirmImport(): Promise<void> {
    const transactions = this.importedTransactions();
    if (transactions.length === 0) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Confirm Import',
        message: `Import ${transactions.length} transactions? This will add new transactions to your account.`,
        confirmText: 'Import',
        confirmColor: 'primary'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        this.isImporting.set(true);
        this.importProgress.set(0);

        const parsed = this.exportService.parseImportedData(transactions);

        for (let i = 0; i < parsed.length; i++) {
          await this.transactionService.addTransaction(parsed[i]);
          this.importProgress.set(Math.round(((i + 1) / parsed.length) * 100));
        }

        this.snackBar.open(`${transactions.length} transactions imported`, 'Close', { duration: 3000 });
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
        title: 'Delete All Transactions',
        message: 'This will permanently delete ALL transactions. This action cannot be undone. Are you absolutely sure?',
        confirmText: 'Delete All',
        confirmColor: 'warn'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        // Second confirmation
        const secondConfirm = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Final Confirmation',
            message: 'Type "DELETE" to confirm deletion of all transactions.',
            confirmText: 'Confirm Delete',
            confirmColor: 'warn'
          }
        });

        secondConfirm.afterClosed().subscribe(async (finalConfirm) => {
          if (finalConfirm) {
            try {
              await this.transactionService.deleteAllTransactions();
              this.snackBar.open('All transactions deleted', 'Close', { duration: 3000 });
            } catch {
              this.snackBar.open('Failed to delete transactions', 'Close', { duration: 3000 });
            }
          }
        });
      }
    });
  }

  signOut(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Sign Out',
        message: 'Are you sure you want to sign out?',
        confirmText: 'Sign Out',
        confirmColor: 'primary'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.authService.signOut();
      }
    });
  }
}
