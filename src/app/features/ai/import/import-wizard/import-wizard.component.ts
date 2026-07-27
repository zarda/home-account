import { Component, inject, signal, computed, OnDestroy, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';

import { AIImportService } from '../../../../core/services/ai-import.service';
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

  // Image preview URLs
  imagePreviewUrls = computed(() => {
    return this.selectedFiles()
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        name: f.name,
        url: URL.createObjectURL(f)
      }));
  });

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
    // Load categories for the category selector
    this.categoryService.loadCategories().subscribe();

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
    // Cleanup object URLs
    this.imagePreviewUrls().forEach(p => URL.revokeObjectURL(p.url));
  }

  onFilesSelected(files: File[]): void {
    this.selectedFiles.set(files);
    // Reset processing state
    this.extractedTransactions.set([]);
    this.processingError.set(null);
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
      const result = await this.importService.confirmImport(
        this.extractedTransactions(),
        file?.name || 'import',
        file?.size || 0,
        'csv',
        'generic_csv'
      );

      const message = this.t('import.importComplete', { count: result.successCount });
      this.notifications.success(message);

      // Navigate back to transactions with showAll to see imported data
      this.router.navigate(['/transactions'], {
        queryParams: { showAll: 'true' }
      });
    } catch (error) {
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
    this.processingErrorType.set('unknown');
    this.processingErrorRetryable.set(true);
    this.processFiles();
  }

  goToSettings(): void {
    this.router.navigate(['/profile']);
  }
}
