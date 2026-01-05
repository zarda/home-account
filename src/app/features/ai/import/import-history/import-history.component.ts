import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ImportHistoryService } from '../../../../core/services/import-history.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ImportHistory, ImportStatus } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-import-history',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    TranslatePipe
  ],
  templateUrl: './import-history.component.html',
  styleUrl: './import-history.component.scss'
})
export class ImportHistoryComponent implements OnInit, OnDestroy {
  private importHistoryService = inject(ImportHistoryService);
  private translationService = inject(TranslationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  importHistory = signal<ImportHistory[]>([]);
  isLoading = signal(true);

  private subscription?: Subscription;

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private loadHistory(): void {
    this.isLoading.set(true);
    this.subscription = this.importHistoryService.getImportHistory().subscribe({
      next: (history) => {
        this.importHistory.set(history);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  getStatusIcon(status: ImportStatus): string {
    switch (status) {
      case 'completed':
        return 'check_circle';
      case 'partial':
        return 'warning';
      case 'failed':
        return 'error';
      case 'processing':
        return 'hourglass_empty';
      default:
        return 'help';
    }
  }

  getStatusClass(status: ImportStatus): string {
    return status;
  }

  getStatusLabel(status: ImportStatus): string {
    switch (status) {
      case 'completed':
        return this.t('import.statusCompleted');
      case 'partial':
        return this.t('import.statusPartial');
      case 'failed':
        return this.t('import.statusFailed');
      case 'processing':
        return this.t('import.statusProcessing');
      default:
        return status;
    }
  }

  getSourceLabel(source: string): string {
    switch (source) {
      case 'csv':
        return 'CSV';
      case 'pdf':
        return 'PDF';
      case 'image':
        return 'Image';
      case 'json':
        return 'Backup';
      default:
        return source;
    }
  }

  formatDate(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  deleteHistory(item: ImportHistory): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('import.deleteHistory'),
        message: this.t('import.deleteHistoryConfirm'),
        confirmLabel: this.t('common.delete'),
        confirmColor: 'warn'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        try {
          await this.importHistoryService.deleteImportHistory(item.id);
          this.snackBar.open(
            this.t('import.historyDeleted'),
            this.t('common.close'),
            { duration: 3000 }
          );
        } catch {
          this.snackBar.open(
            this.t('import.deleteHistoryFailed'),
            this.t('common.close'),
            { duration: 3000 }
          );
        }
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/settings']);
  }

  goToImport(): void {
    this.router.navigate(['/settings/import']);
  }
}
