import { Component, DestroyRef, inject, signal, computed, OnDestroy, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';

import { AIImportService, IMPORT_READBACK_FAILED } from '../../../../core/services/ai-import.service';
import { DuplicateDetectionService } from '../../../../core/services/duplicate-detection.service';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  CategorizedImportTransaction,
  ImportResult,
  DuplicateCheck,
  MultiImageMetadata
} from '../../../../models';

import { FileDropzoneComponent } from '../file-dropzone/file-dropzone.component';
import { TransactionPreviewTableComponent } from '../transaction-preview-table/transaction-preview-table.component';
import { DuplicateWarningComponent, DuplicateInfo } from '../duplicate-warning/duplicate-warning.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { NotificationService } from '../../../../core/services/notification.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { ShareIntakeService } from '../../../../core/services/share-intake.service';

@Component({
  selector: 'app-import-wizard',
  standalone: true,
  imports: [
    CommonModule,
    MatStepperModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatCardModule,
    MatChipsModule,
    FileDropzoneComponent,
    TransactionPreviewTableComponent,
    DuplicateWarningComponent,
    TranslatePipe
  ],
  templateUrl: './import-wizard.component.html',
  styleUrl: './import-wizard.component.scss'
})
export class ImportWizardComponent implements OnInit, AfterViewInit, OnDestroy {
  private notifications = inject(NotificationService);
  private importService = inject(AIImportService);
  private duplicateService = inject(DuplicateDetectionService);
  private analytics = inject(AnalyticsService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private shareIntake = inject(ShareIntakeService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('stepper') stepper!: MatStepper;

  acceptedFileTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp';

  // Flag to track if we came from camera
  fromCamera = false;
  isMultiImage = false;
  private cameraImportResult: ImportResult | null = null;

  // State signals
  selectedFiles = signal<File[]>([]);
  /**
   * What the selected images are, which decides how they are read.
   *
   * A receipt photo and a statement screenshot are indistinguishable by MIME
   * type but need opposite handling, and guessing wrong is expensive in one
   * direction: a statement read as a receipt collapses a page of unrelated
   * charges into a single transaction. Receipts stay the default.
   */
  imageKind = signal<'receipt' | 'statement'>('receipt');
  readonly hasImageFiles = computed(() =>
    this.selectedFiles().some(f => f.type.startsWith('image/'))
  );
  extractedTransactions = signal<CategorizedImportTransaction[]>([]);
  selectedTransactionIds = signal<Set<string>>(new Set());
  duplicateChecks = signal<DuplicateCheck[]>([]);
  processingError = signal<string | null>(null);
  /** Set when the app raised the error itself and can say it in the user's language. */
  processingErrorKey = signal<string | null>(null);
  processingErrorType = signal<string>('unknown');
  processingErrorRetryable = signal<boolean>(true);
  isImporting = signal(false);
  importProgress = signal(0);
  importStatus = signal('');

  // Multi-image metadata
  multiImageMetadata = signal<MultiImageMetadata | null>(null);

  // Service bindings
  isProcessing = this.importService.isProcessing;
  processingStatus = this.importService.processingStatus;
  processingProgress = this.importService.processingProgress;
  categories = this.categoryService.categories;

  /**
   * Image previews, minted once per selection.
   *
   * This used to be a `computed`, which mints a blob URL as a side effect of
   * being read: every re-pick orphaned the previous batch, and ngOnDestroy —
   * which read the computed again — could mint a fresh set and revoke those
   * instead of the ones the template had rendered. Four 4MB photos re-picked
   * three times pinned about 50MB for the life of the document, which on the
   * iOS WebView is the kind of pressure that gets the app killed mid-scan.
   *
   * A plain signal written by onFilesSelected makes creation and revocation
   * a pair, in one place.
   */
  imagePreviewUrls = signal<{ name: string; url: string }[]>([]);

  // Computed
  uploadComplete = computed(() => this.selectedFiles().length > 0);
  processingComplete = computed(() =>
    !this.isProcessing() && this.extractedTransactions().length > 0
  );
  processingFinishedEmpty = computed(() =>
    !this.isProcessing() &&
    this.extractedTransactions().length === 0 &&
    !this.processingError() &&
    this.selectedFiles().length > 0
  );
  reviewComplete = computed(() => this.selectedTransactionIds().size > 0);

  selectedCount = computed(() => {
    return this.extractedTransactions().filter(t => t.selected).length;
  });

  selectedIncome = computed(() => {
    return this.extractedTransactions()
      .filter(t => t.selected && t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  selectedExpenses = computed(() => {
    return this.extractedTransactions()
      .filter(t => t.selected && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  duplicatesSkipped = computed(() => {
    return this.extractedTransactions().filter(t => t.isDuplicate && !t.selected).length;
  });

  // Multi-image computed properties
  mergedItemsCount = computed(() => {
    return this.extractedTransactions().filter(t => t.imageMetadata?.wasMerged).length;
  });

  hasMultiImageData = computed(() => {
    return this.multiImageMetadata() !== null && (this.multiImageMetadata()?.totalImages ?? 0) > 1;
  });

  // Independent of the photo count: a single photo can hold several receipts
  receiptsDetectedCount = computed(() => {
    const ids = this.extractedTransactions()
      .map(t => t.imageMetadata?.receiptId)
      .filter((id): id is number => id != null);
    return new Set(ids).size;
  });

  sourceImagesCount = computed(() => {
    return this.multiImageMetadata()?.totalImages ?? 0;
  });

  duplicateInfos = computed((): DuplicateInfo[] => {
    const txns = this.extractedTransactions();
    const checks = this.duplicateChecks();

    return checks
      .filter(c => c.isDuplicate)
      .map(check => ({
        transaction: txns.find(t => t.id === check.transactionId)!,
        check
      }))
      .filter(info => info.transaction);
  });

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

  ngOnInit(): void {
    // Load categories for the category selector. A live stream that never
    // completes, so it must not outlive the wizard.
    this.categoryService.loadCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    // Check if we received import result from camera capture via router state
    const state = history.state as {
      importResult?: ImportResult;
      fromCamera?: boolean;
      multiImage?: boolean;
    } | undefined;

    if (state?.importResult && state?.fromCamera) {
      this.fromCamera = true;
      this.isMultiImage = state.multiImage ?? false;
      this.cameraImportResult = state.importResult;

      // Set multi-image metadata if available
      if (state.importResult.multiImageMetadata) {
        this.multiImageMetadata.set(state.importResult.multiImageMetadata);
      }
    }

    // Files shared from another app: both share pipelines stage them (see
    // ShareIntakeService) and arrive here with ?source=share. They enter
    // exactly the flow a dropzone pick would, review step included.
    if (this.route.snapshot.queryParamMap.get('source') === 'share') {
      void this.consumeSharedFiles();
    }
  }

  private async consumeSharedFiles(): Promise<void> {
    const files = await this.shareIntake.consumeAll();
    if (files.length > 0) {
      this.onFilesSelected(files);
    }
  }

  ngAfterViewInit(): void {
    // If we have camera import result, populate the data and skip to review step
    if (this.fromCamera && this.cameraImportResult) {
      // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        const result = this.cameraImportResult!;

        // Populate the transactions
        this.extractedTransactions.set(result.transactions);
        this.duplicateChecks.set(result.duplicates);

        // Auto-select non-duplicates
        const nonDuplicateIds = new Set(
          result.transactions
            .filter(t => !t.isDuplicate)
            .map(t => t.id)
        );
        this.selectedTransactionIds.set(nonDuplicateIds);

        // Skip to review step (index 2)
        if (this.stepper) {
          this.stepper.selectedIndex = 2;
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.revokePreviews();
  }

  onFilesSelected(files: File[]): void {
    this.selectedFiles.set(files);
    // Revoke before minting, so a re-pick releases the previous batch rather
    // than leaving it alive with nothing pointing at it.
    this.revokePreviews();
    this.imagePreviewUrls.set(
      files
        .filter(f => f.type.startsWith('image/'))
        .map(f => ({ name: f.name, url: URL.createObjectURL(f) }))
    );
    // Reset processing state
    this.extractedTransactions.set([]);
    this.processingError.set(null);
  }

  private revokePreviews(): void {
    this.imagePreviewUrls().forEach(p => URL.revokeObjectURL(p.url));
    this.imagePreviewUrls.set([]);
  }

  async processFiles(): Promise<void> {
    this.processingError.set(null);
    this.extractedTransactions.set([]);

    try {
      const files = this.selectedFiles();

      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      const nonImageFiles = files.filter(f => !f.type.startsWith('image/'));

      if (imageFiles.length >= 1) {
        // Receipt and statement images need opposite treatment and look alike
        // to a MIME check, so the user says which they have. Receipts go
        // through the receiptId-aware pipeline, which merges the line items of
        // one purchase; statements skip it, because their rows are unrelated
        // charges that must stay apart.
        const result = this.imageKind() === 'statement'
          ? await this.importService.importFromStatementImages(imageFiles)
          : await this.importService.importFromMultipleImages(imageFiles);
        this.extractedTransactions.update(txns => [...txns, ...result.transactions]);
        this.duplicateChecks.update(checks => [...checks, ...result.duplicates]);
      }

      // Process non-image files individually
      for (const file of nonImageFiles) {
        const result: ImportResult = await this.importService.importFromFile(file);
        this.extractedTransactions.update(txns => [...txns, ...result.transactions]);
        this.duplicateChecks.update(checks => [...checks, ...result.duplicates]);
      }

      // Every file's rows are in one array now, which is the only point a
      // duplicate spanning two files can be seen. Per-file checks compare
      // against stored history and are blind to each other.
      const batchDuplicates = this.duplicateService.findWithinBatchDuplicates(
        this.extractedTransactions(),
        this.duplicateChecks()
      );
      if (batchDuplicates.length > 0) {
        const flagged = new Set(batchDuplicates.map(c => c.transactionId));
        this.duplicateChecks.update(checks => [...checks, ...batchDuplicates]);
        this.extractedTransactions.update(txns =>
          txns.map(t =>
            flagged.has(t.id)
              ? { ...t, isDuplicate: true, duplicateOf: undefined, selected: false }
              : t
          )
        );
      }

      // Auto-select non-duplicates
      const nonDuplicateIds = new Set(
        this.extractedTransactions()
          .filter(t => !t.isDuplicate)
          .map(t => t.id)
      );
      this.selectedTransactionIds.set(nonDuplicateIds);

      // Only images are receipts. This method also handles CSV, PDF and JSON,
      // and counting a bank statement as a receipt import would make the
      // reliability figure this event exists to produce meaningless.
      if (imageFiles.length >= 1) {
        this.analytics.trackReceiptImport({
          outcome: this.extractedTransactions().length > 0 ? 'ok' : 'failed',
        });
      }
    } catch (error) {
      const parsed = this.importService.parseAIError(error);
      this.processingError.set(parsed.message);
      this.processingErrorKey.set(parsed.messageKey ?? null);
      this.processingErrorType.set(parsed.type);
      this.processingErrorRetryable.set(parsed.retryable);

      if (this.selectedFiles().some(f => f.type.startsWith('image/'))) {
        // A later non-image file can throw after the images already produced
        // transactions; the user still has a usable review step, so that is a
        // success with a broken tail, not a failed import.
        this.analytics.trackReceiptImport({
          outcome: this.extractedTransactions().length > 0 ? 'ok' : 'failed',
        });
      }
    }
  }

  onTransactionsUpdated(transactions: CategorizedImportTransaction[]): void {
    this.extractedTransactions.set(transactions);
  }

  onSelectionChanged(selectedIds: Set<string>): void {
    this.selectedTransactionIds.set(selectedIds);
  }

  excludeAllDuplicates(): void {
    this.extractedTransactions.update(txns =>
      txns.map(t => ({
        ...t,
        selected: t.isDuplicate ? false : t.selected
      }))
    );
    this.updateSelectedIds();
  }

  /**
   * Re-select the rows that were auto-deselected for being duplicates.
   *
   * Only the duplicates: this used to select every row, so a user who had
   * worked through the list and unticked a few ordinary rows lost that work the
   * moment they decided to keep the duplicates — and the button says "include
   * duplicates", not "select everything".
   */
  includeAllDuplicates(): void {
    this.extractedTransactions.update(txns =>
      txns.map(t => ({
        ...t,
        selected: t.isDuplicate ? true : t.selected
      }))
    );
    this.updateSelectedIds();
  }

  private updateSelectedIds(): void {
    const selectedIds = new Set(
      this.extractedTransactions()
        .filter(t => t.selected)
        .map(t => t.id)
    );
    this.selectedTransactionIds.set(selectedIds);
  }

  async confirmImport(): Promise<void> {
    this.isImporting.set(true);
    this.importProgress.set(0);

    try {
      const file = this.selectedFiles()[0];
      // The service iterates the selected subset and numbers its per-row
      // errors against it (1-based); snapshot the same subset now so those
      // numbers can be mapped back to rows. Safe to take before the await:
      // the review UI is unreachable while isImporting disables the stepper.
      const submitted = this.extractedTransactions().filter(t => t.selected);
      const result = await this.importService.confirmImport(
        this.extractedTransactions(),
        file?.name || 'import',
        file?.size || 0,
        'csv',
        'generic_csv'
      );

      if (result.errorCount > 0) {
        // Some rows were rejected (a zero-amount summary line, a rules
        // denial). Navigating away would destroy the only copy of them and
        // report success, leaving the user's reconciliation silently short.
        // Keep exactly the failed rows on the review step for correction and
        // a second confirm — the saved ones are removed so confirming again
        // cannot double-import them.
        const failedRows = (result.errors ?? [])
          .map(e => (typeof e.row === 'number' ? submitted[e.row - 1] : undefined))
          .filter((t): t is CategorizedImportTransaction => t !== undefined)
          .map(t => ({ ...t, selected: true, isDuplicate: false }));

        this.extractedTransactions.set(failedRows);
        this.duplicateChecks.set([]);
        this.selectedTransactionIds.set(new Set(failedRows.map(t => t.id)));

        this.notifications.error(this.t('import.importPartial', {
          success: result.successCount,
          failed: result.errorCount,
          total: result.successCount + result.errorCount,
        }));

        if (this.stepper) {
          this.stepper.selectedIndex = 2;
        }
        return;
      }

      const message = this.t('import.importComplete', { count: result.successCount });
      this.notifications.success(message);

      // Navigate back to transactions with showAll to see imported data
      this.router.navigate(['/transactions'], {
        queryParams: { showAll: 'true' }
      });
    } catch (error) {
      if (error instanceof Error && error.message === IMPORT_READBACK_FAILED) {
        // The rows were saved; only the summary read-back failed. Presenting
        // that as a failed import would invite a retry that duplicates the
        // batch — say what happened and continue to the list. The full
        // record, including any per-row errors, is on the Import History page.
        this.notifications.info(this.t('import.importSavedHistoryUnavailable'));
        this.router.navigate(['/transactions'], {
          queryParams: { showAll: 'true' }
        });
        return;
      }
      const message = this.t('import.importFailed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.notifications.error(message);
    } finally {
      this.isImporting.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/transactions']);
  }

  getErrorIcon(): string {
    switch (this.processingErrorType()) {
      case 'rate_limit': return 'schedule';
      case 'auth': return 'vpn_key_off';
      case 'network': return 'wifi_off';
      case 'quota': return 'account_balance_wallet';
      case 'server': return 'cloud_off';
      case 'timeout': return 'hourglass_empty';
      default: return 'error_outline';
    }
  }

  /**
   * What to show as the error body. A provider's own wording cannot be
   * translated, so it is shown as-is; anything the app raised itself has a
   * key and is shown in the user's language.
   */
  getErrorMessage(): string {
    const key = this.processingErrorKey();
    return key ? this.t(key) : (this.processingError() ?? '');
  }

  getErrorTitle(): string {
    switch (this.processingErrorType()) {
      case 'rate_limit': return this.t('import.errorTitleRateLimit');
      case 'auth': return this.t('import.errorTitleAuth');
      case 'network': return this.t('import.errorTitleNetwork');
      case 'quota': return this.t('import.errorTitleQuota');
      case 'server': return this.t('import.errorTitleServer');
      case 'timeout': return this.t('import.errorTitleTimeout');
      default: return this.t('import.errorTitleGeneral');
    }
  }

  retryProcessing(): void {
    this.processingError.set(null);
    this.processingErrorKey.set(null);
    this.processingErrorType.set('unknown');
    this.processingErrorRetryable.set(true);
    this.processFiles();
  }

  goToSettings(): void {
    // /profile was never a registered route, so this silently landed on the
    // dashboard via the catch-all. The API keys live on the AI screen.
    this.router.navigate(['/ai']);
  }
}
