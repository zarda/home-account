import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
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
  ImportSource,
  ImportFileType,
  DuplicateCheck,
  MultiImageMetadata,
  ReceiptDoor
} from '../../../../models';

import { FileDropzoneComponent } from '../file-dropzone/file-dropzone.component';
import { TransactionPreviewTableComponent } from '../transaction-preview-table/transaction-preview-table.component';
import { DuplicateWarningComponent, DuplicateInfo } from '../duplicate-warning/duplicate-warning.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { NotificationService } from '../../../../core/services/notification.service';
import { ReceiptAttemptService, provenanceOf } from '../../../../core/services/receipt-attempt.service';
import { ReceiptAttemptDiagnostics } from '../../../../core/services/ai-types';
import { ShareIntakeService } from '../../../../core/services/share-intake.service';
import { looksLikeImageFile } from '../../../../core/utils/file.utils';
import { needsDateAnswer } from '../../../../core/utils/import-review.utils';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-wizard.component.html',
  styleUrl: './import-wizard.component.scss'
})
export class ImportWizardComponent implements OnInit, AfterViewInit, OnDestroy {
  private notifications = inject(NotificationService);
  private importService = inject(AIImportService);
  private duplicateService = inject(DuplicateDetectionService);
  private receiptAttempts = inject(ReceiptAttemptService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private shareIntake = inject(ShareIntakeService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('stepper') stepper!: MatStepper;

  acceptedFileTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp';

  // Flag to track if the review data arrived already extracted, via router
  // state, rather than through this wizard's own processFiles.
  fromCamera = false;
  isMultiImage = false;
  private cameraImportResult: ImportResult | null = null;
  // Which door actually ran the extraction the state carries — the camera
  // dialog's own capture by default, since it is the door that predates
  // this field; a producer that is not the camera (the transaction form's
  // own multi-receipt review) names itself explicitly (#151).
  private resultDoor: ReceiptDoor = 'camera';

  /**
   * What each processed result actually was, row-counted.
   *
   * The confirm step used to pass 'csv'/'generic_csv' constants, so every
   * wizard import — photos, PDFs, backups — was recorded in Import History
   * as a generic CSV. This is the evidence the record derives from instead.
   */
  private processedBatches: {
    source: ImportSource;
    fileType: ImportFileType;
    rows: number;
  }[] = [];

  /** How the image batch's engine ran, for the confirm-time record. Null when no image was processed. */
  private imageDiagnostics: ReceiptAttemptDiagnostics | null = null;

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
    // MIME or extension: a shared photo can arrive typed
    // application/octet-stream and must still count as an image.
    this.selectedFiles().some(f => looksLikeImageFile(f))
  );
  extractedTransactions = signal<CategorizedImportTransaction[]>([]);
  selectedTransactionIds = signal<Set<string>>(new Set());
  /**
   * The rows a receipt reader produced, by id: the ones whose date is a
   * question the reviewer answers before Continue and Import enable
   * (needsDateAnswer). Per row, not a batch bit — one dropzone pick can put
   * a photo and a CSV in the same batch, and the CSV's historical rows are
   * never a question. Statement screenshots stay out for the same reason a
   * CSV does: every row of one is dated in the past, and a question on each
   * would train the reviewer to answer without looking. Rebuilt per batch;
   * the partial-import recovery keeps it, because a failed row keeps its id
   * and still owes its answer unless it already gave one.
   */
  receiptRowIds = signal<ReadonlySet<string>>(new Set());
  duplicateChecks = signal<DuplicateCheck[]>([]);
  processingError = signal<string | null>(null);
  /** Set when the app raised the error itself and can say it in the user's language. */
  processingErrorKey = signal<string | null>(null);
  processingErrorType = signal<string>('unknown');
  processingErrorRetryable = signal<boolean>(true);
  /**
   * Set when the reader's answer was cut short and only the rows it had
   * finished were kept. The rows on the review step are real; what is missing
   * is whatever came after the break, which is why this says so rather than
   * letting a short receipt look complete (#331).
   */
  answerIncomplete = signal(false);
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
  /**
   * Selected receipt rows still owing a date answer. "Today" is read at
   * recompute time, so a review left open across midnight is judged
   * against the day it was opened on until a row changes — accepted, since
   * every answer changes a row.
   */
  unansweredDates = computed(() => {
    const ids = this.receiptRowIds();
    return this.extractedTransactions().filter(t => needsDateAnswer(t, ids.has(t.id))).length;
  });
  // The linear stepper refuses next() on an incomplete step. The camera
  // hand-off's stepper is not linear and lets the header jump straight to
  // Confirm, which is why the Import button carries the same guard itself.
  reviewComplete = computed(() =>
    this.selectedTransactionIds().size > 0 && this.unansweredDates() === 0
  );

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

    // Check if we received an already-extracted import result via router
    // state — the camera dialog's capture, or the transaction form's own
    // multi-receipt review.
    const state = history.state as {
      importResult?: ImportResult;
      fromCamera?: boolean;
      multiImage?: boolean;
      door?: ReceiptDoor;
    } | undefined;

    if (state?.importResult && state?.fromCamera) {
      this.fromCamera = true;
      this.resultDoor = state.door ?? 'camera';
      this.isMultiImage = state.multiImage ?? false;
      this.cameraImportResult = state.importResult;
      this.processedBatches = [{
        source: state.importResult.source,
        fileType: state.importResult.fileType,
        rows: state.importResult.transactions.length
      }];

      // A handed-over result carries the same warning a wizard import does;
      // the review step is the same step either way.
      if (state.importResult.warnings?.some(w => w.type === 'parse_error')) {
        this.answerIncomplete.set(true);
      }

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
        // This door only ever carries receipts.
        this.receiptRowIds.set(new Set(result.transactions.map(t => t.id)));

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
        .filter(f => looksLikeImageFile(f))
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
    this.answerIncomplete.set(false);
    this.extractedTransactions.set([]);
    this.receiptRowIds.set(new Set());
    this.processedBatches = [];
    this.imageDiagnostics = null;

    const files = this.selectedFiles();
    const imageFiles = files.filter(f => looksLikeImageFile(f));
    const nonImageFiles = files.filter(f => !looksLikeImageFile(f));

    // Only receipts are receipt attempts. A statement screenshot runs
    // through this same method and used to be counted as one; the handle is
    // opened for the receipt kind alone, and it settles from the image
    // batch's own result — never from the running row total, which a CSV
    // in the same batch could have filled.
    const receiptAttempt = imageFiles.length >= 1 && this.imageKind() === 'receipt'
      ? this.receiptAttempts.begin('wizard', 'receipt_image', imageFiles)
      : null;

    try {
      if (imageFiles.length >= 1) {
        // Receipt and statement images need opposite treatment and look alike
        // to a MIME check, so the user says which they have. Receipts go
        // through the receiptId-aware pipeline, which merges the line items of
        // one purchase; statements skip it, because their rows are unrelated
        // charges that must stay apart.
        const result = this.imageKind() === 'statement'
          ? await this.importService.importFromStatementImages(imageFiles)
          : await this.importService.importFromMultipleImages(imageFiles);
        this.imageDiagnostics = result.diagnostics ?? null;
        if (result.warnings.some(w => w.type === 'parse_error')) {
          this.answerIncomplete.set(true);
        }
        this.extractedTransactions.update(txns => [...txns, ...result.transactions]);
        this.duplicateChecks.update(checks => [...checks, ...result.duplicates]);
        if (this.imageKind() === 'receipt') {
          this.receiptRowIds.set(new Set(result.transactions.map(t => t.id)));
        }
        this.processedBatches.push({
          source: result.source,
          fileType: result.fileType,
          rows: result.transactions.length
        });
        if (receiptAttempt) {
          if (result.transactions.length > 0) {
            receiptAttempt.succeeded(result);
          } else {
            receiptAttempt.failed('nothing_extracted');
          }
        }
      }

      // Process non-image files individually
      for (const file of nonImageFiles) {
        const result: ImportResult = await this.importService.importFromFile(file);
        this.extractedTransactions.update(txns => [...txns, ...result.transactions]);
        this.duplicateChecks.update(checks => [...checks, ...result.duplicates]);
        this.processedBatches.push({
          source: result.source,
          fileType: result.fileType,
          rows: result.transactions.length
        });
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
    } catch (error) {
      const parsed = this.importService.parseAIError(error);
      this.processingError.set(parsed.message);
      this.processingErrorKey.set(parsed.messageKey ?? null);
      this.processingErrorType.set(parsed.type);
      this.processingErrorRetryable.set(parsed.retryable);
      // A throw from the image batch settles the handle here; a throw from a
      // later file finds it already settled and this is a no-op.
      receiptAttempt?.failed(error);
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

  /**
   * What this batch was, for the history record.
   *
   * A mixed batch takes the dominant kind by row count — the record's own
   * numbers are row-denominated, so the label follows the same measure, and
   * a first-file rule would let one stray photo relabel a 200-row CSV. Ties
   * keep the first kind processed. The size covers every file imported, not
   * just the first; the camera flow reports what the capture handed over.
   */
  private batchDescriptor(): {
    source: ImportSource; fileType: ImportFileType; fileName: string; fileSize: number;
  } {
    const fromCamera = this.fromCamera && this.cameraImportResult;
    const fileName = fromCamera
      ? this.cameraImportResult!.fileName
      : this.selectedFiles()[0]?.name || 'import';
    const fileSize = fromCamera
      ? this.cameraImportResult!.fileSize
      : this.selectedFiles().reduce((sum, f) => sum + f.size, 0);

    const dominant = this.processedBatches.reduce(
      (best, b) => (best === null || b.rows > best.rows ? b : best),
      null as { source: ImportSource; fileType: ImportFileType; rows: number } | null
    );

    return dominant
      ? { source: dominant.source, fileType: dominant.fileType, fileName, fileSize }
      : { source: 'csv', fileType: 'generic_csv', fileName, fileSize };
  }

  /**
   * The image files the extraction actually ran over, in that order.
   *
   * A row's imageIndex indexes this subset, not selectedFiles — a mixed
   * batch (CSV plus photos) would otherwise attach the wrong file. The
   * camera flow holds no selected files at all; its photos ride the result
   * it handed over.
   */
  private sourceImageFiles(): File[] {
    if (this.fromCamera && this.cameraImportResult?.sourceFiles?.length) {
      return this.cameraImportResult.sourceFiles;
    }
    return this.selectedFiles().filter(f => looksLikeImageFile(f));
  }

  async confirmImport(): Promise<void> {
    this.isImporting.set(true);
    this.importProgress.set(0);

    try {
      const batch = this.batchDescriptor();
      // The service iterates the selected subset and numbers its per-row
      // errors against it (1-based); snapshot the same subset now so those
      // numbers can be mapped back to rows. Safe to take before the await:
      // the review UI is unreachable while isImporting disables the stepper.
      const submitted = this.extractedTransactions().filter(t => t.selected);
      // The receipt attempt's provenance rides the record for image batches;
      // a CSV-only batch has none, and an absent slot means nobody looked.
      const diagnostics = this.fromCamera
        ? this.cameraImportResult?.diagnostics ?? null
        : this.imageDiagnostics;
      const provenance = this.processedBatches.some(b => b.source === 'image')
        ? provenanceOf(this.fromCamera ? this.resultDoor : 'wizard', diagnostics)
        : undefined;
      const result = await this.importService.confirmImport(
        this.extractedTransactions(),
        batch.fileName,
        batch.fileSize,
        batch.source,
        batch.fileType,
        this.sourceImageFiles(),
        provenance
      );

      if (result.receiptsSkipped) {
        // The rows saved; only their photos hit the image quota. Said
        // distinctly, because "partial" here would invite re-importing rows
        // that already landed.
        this.notifications.info(this.t('import.importPhotosSkipped', {
          count: result.receiptsSkipped
        }));
      }

      if (result.receiptsFailed) {
        // Also saved, also photo-less, but for a reason the user can act on:
        // the photo could not be uploaded at all. Separate from the quota
        // message because the next step differs — one is a plan limit, the
        // other a file to re-attach from the transaction (#334).
        this.notifications.info(this.t('import.importPhotosFailed', {
          count: result.receiptsFailed
        }));
      }

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
      case 'incomplete': return 'content_cut';
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
      case 'incomplete': return this.t('import.errorTitleIncomplete');
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
