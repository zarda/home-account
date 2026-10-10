import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ImportHistoryService } from '../../../../core/services/import-history.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ImportError, ImportHistory, ImportFileType, ImportStatus, LLMProvider, ReceiptEngine, ReceiptFailureClass, baseCurrencyOf } from '../../../../models';
import { importFailureKey } from '../../../../core/utils/import-review.utils';
import {
  AI_CLOUD_UNAVAILABLE,
  AI_NO_PROVIDER,
  AI_QUEUE_WRITE_FAILED,
  AI_QUEUE_WRITE_PARTIAL,
  parseAIError,
} from '../../../../core/utils/ai-error.utils';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { NotificationService } from '../../../../core/services/notification.service';

/**
 * A failed receipt attempt's error line, a sentence per failure class.
 *
 * The record stores the attempt's English (`classifyReceiptFailure`) next to
 * its class. Where that English is one of the app's own sentences, the line
 * reads it back to its own key (`OWN_SENTENCE_KEYS`); otherwise the class is
 * what is read. Most classes already had a sentence in the catalog; server
 * and timeout had only the short label the failure line above the list uses,
 * and got one of their own.
 */
const FAILURE_SENTENCE_KEYS: Record<ReceiptFailureClass, string> = {
  rate_limit: 'import.errorHintRateLimit',
  auth: 'import.errorInvalidKey',
  network: 'errors.network',
  quota: 'import.errorHintQuota',
  server: 'import.errorServer',
  timeout: 'import.errorTimeout',
  incomplete: 'import.errorAnswerIncomplete',
  no_provider: 'import.errorNoProvider',
  nothing_extracted: 'import.noTransactionsFoundDescription',
  queue_write: 'import.errorQueueWrite',
  unknown: 'import.errorProcessingFailed',
};

/**
 * The classifier's sentence for each failure the app raises itself, mapped
 * back to the key it hands the screen.
 *
 * A class is too coarse for these: a drain that failed online with no
 * provider is class network, and its class's sentence would tell the reader
 * to check a connection that works, where the wizard and the camera said to
 * add a key. Built from `parseAIError`'s own answers, so a reworded sentence
 * moves both sides at once.
 */
const OWN_SENTENCE_KEYS = new Map(
  [AI_NO_PROVIDER, AI_CLOUD_UNAVAILABLE, AI_QUEUE_WRITE_FAILED, AI_QUEUE_WRITE_PARTIAL]
    .map(code => parseAIError(new Error(code)))
    .map(parsed => [parsed.message, parsed.messageKey] as const)
);

/**
 * The catalog key one stored error line reads as, or null when nothing on
 * the line says what it is.
 *
 * Two shapes are recognised: a failed receipt attempt, by its own sentence
 * where the app wrote one and by the class on its record otherwise, and a
 * row the confirm loop refused, by what names the row — its id since rows
 * were matched by id, its description on every record the loop ever wrote —
 * read through the wizard's own `importFailureKey`. Neither covers
 * `failImport`'s whole-import error, or a record restored or written outside
 * the app in some other shape, such as a row's with no message: a row's
 * reason would misdescribe those, so the caller falls back to the stored
 * message rather than guess.
 */
function errorLineKey(item: ImportHistory, error: ImportError): string | null {
  if (item.status === 'failed') {
    const own = OWN_SENTENCE_KEYS.get(error.message);
    if (own) return own;
    if (item.errorType) return FAILURE_SENTENCE_KEYS[item.errorType];
  }
  if (
    (error.transactionId !== undefined || error.originalValue !== undefined) &&
    typeof error.message === 'string'
  ) {
    return importFailureKey(error);
  }
  return null;
}

@Component({
  selector: 'app-import-history',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatMenuModule,
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
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
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
      incomplete: 'import.failureIncomplete',
      no_provider: 'import.failureNoProvider',
      nothing_extracted: 'import.failureNothingExtracted',
      queue_write: 'import.failureQueueWrite',
      unknown: 'import.failureUnknown',
    };
    return this.t(keys[errorType]);
  }

  /** One line of a record's error list, in the reader's language where its shape allows (ADR 0036). */
  errorLine(item: ImportHistory, error: ImportError): string {
    const key = errorLineKey(item, error);
    return key ? this.t(key) : (error.message ?? '');
  }

  formatDate(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    // The active language, not the browser's: these two used to disagree on
    // the same screen whenever the UI language was not the device's.
    return `${this.localeFormat.formatDate(date, 'short')} ${this.localeFormat.formatTime(date)}`;
  }

  /**
   * One side of a record's money, a line per currency it is in.
   *
   * A record written before `totalsByCurrency` holds one raw sum across
   * whatever currencies the batch carried, so the account's base is the least
   * wrong symbol for it — and the right one for the one-currency imports that
   * are nearly all of them. Either way the figure is formatted rather than
   * handed to the bare `currency` pipe, which defaulted every record to
   * dollars.
   */
  totalLines(item: ImportHistory, kind: 'income' | 'expenses'): string[] {
    const base = baseCurrencyOf(this.authService.currentUser());
    const perCurrency = (item.totalsByCurrency ?? [])
      .filter(total => total[kind] > 0)
      .map(total => this.currencyService.formatCurrency(total[kind], total.currency));
    if (perCurrency.length) return perCurrency;
    // Required by the type, but not by `firestore.rules` — its create and
    // update validators require only userId, importedAt, source, fileType,
    // fileName and status. A record from before either total existed, a
    // restore, or a write from outside the app can reach here with neither;
    // every in-app writer seeds both, so this guards what the rules let
    // through, not a shape this app produces.
    const legacy = (kind === 'income' ? item.totalIncome : item.totalExpenses) ?? 0;
    return [this.currencyService.formatCurrency(item.totalsByCurrency ? 0 : legacy, base)];
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

  // The menu's entries are positional — the record stores no per-row data —
  // so every id, however it arrives, opens the same way.
  openTransaction(id: string): void {
    this.router.navigate(['/transactions'], { queryParams: { tx: id } });
  }
}
