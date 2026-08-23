import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ImportHistoryService } from '../../../../core/services/import-history.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ImportHistory, ImportFileType, ImportStatus, LLMProvider, ReceiptEngine, ReceiptFailureClass } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-import-history',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    CommonModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-history.component.html',
  styleUrl: './import-history.component.scss'
})
export class ImportHistoryComponent implements OnInit, OnDestroy {
  private notifications = inject(NotificationService);
  private importHistoryService = inject(ImportHistoryService);
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);
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

  // fileType, not source: receipts and statement screenshots share
  // source 'image' and are exactly the two kinds worth telling apart.
  getFileTypeLabel(fileType: ImportFileType): string {
    switch (fileType) {
      case 'receipt_image':
        return this.t('import.kindReceipt');
      case 'screenshot':
        return this.t('import.kindStatement');
      case 'bank_pdf':
        return this.t('import.kindPdf');
      case 'backup_json':
        return this.t('import.kindBackup');
      default:
        // bank_csv, generic_csv, credit_card, spreadsheet — all CSV shapes.
        return this.t('import.kindCsv');
    }
  }

  getFileTypeIcon(fileType: ImportFileType): string {
    switch (fileType) {
      case 'receipt_image':
        return 'receipt_long';
      case 'screenshot':
        return 'photo_library';
      case 'bank_pdf':
        return 'picture_as_pdf';
      case 'backup_json':
        return 'settings_backup_restore';
      default:
        return 'table_view';
    }
  }

  /** The engine, and the pair when the preferred one lost. */
  getEngineLabel(item: { engine?: ReceiptEngine; fellBackFrom?: ReceiptEngine }): string {
    if (item.fellBackFrom === 'native') return this.t('import.engineCloudAfterNative');
    if (item.fellBackFrom === 'cloud') return this.t('import.engineNativeAfterCloud');
    return this.t(item.engine === 'native' ? 'import.engineNative' : 'import.engineCloud');
  }

  getEngineIcon(engine: ReceiptEngine): string {
    return engine === 'native' ? 'phone_iphone' : 'cloud';
  }

  /** Brand names are not translated. */
  getProviderLabel(provider: LLMProvider): string {
    const labels: Record<LLMProvider, string> = { gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude' };
    return labels[provider];
  }

  formatDuration(durationMs: number): string {
    // A native pass often finishes in a few hundred milliseconds; floor
    // alone renders every one of those as "0 s", which reads as instant
    // rather than fast.
    if (durationMs < 1000) {
      return this.t('import.durationUnderOneSecond');
    }
    return this.t('import.durationSeconds', { seconds: Math.floor(durationMs / 1000) });
  }

  getFailureLabel(errorType: ReceiptFailureClass): string {
    const keys: Record<ReceiptFailureClass, string> = {
      rate_limit: 'import.failureRateLimit',
      auth: 'import.failureAuth',
      network: 'import.failureNetwork',
      quota: 'import.failureQuota',
      server: 'import.failureServer',
      timeout: 'import.failureTimeout',
      no_provider: 'import.failureNoProvider',
      nothing_extracted: 'import.failureNothingExtracted',
      queue_write: 'import.failureQueueWrite',
      unknown: 'import.failureUnknown',
    };
    return this.t(keys[errorType]);
  }

  formatDate(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    // The active language, not the browser's: these two used to disagree on
    // the same screen whenever the UI language was not the device's.
    const time = date.toLocaleTimeString(this.localeFormat.locale, {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${this.localeFormat.formatDate(date, 'short')} ${time}`;
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
          const message = this.t('import.historyDeleted');
          this.notifications.success(message);
        } catch {
          const message = this.t('import.deleteHistoryFailed');
          this.notifications.error(message);
        }
      }
    });
  }

  clearHistory(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('import.clearHistory'),
        message: this.t('import.clearHistoryConfirm'),
        confirmLabel: this.t('common.delete'),
        confirmColor: 'warn'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        try {
          await this.importHistoryService.clearImportHistory();
          this.notifications.success(this.t('import.historyCleared'));
        } catch {
          this.notifications.error(this.t('import.clearHistoryFailed'));
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
