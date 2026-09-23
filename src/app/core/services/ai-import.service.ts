import { Injectable, inject, signal, computed } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { CategorizedTransaction, RawTransaction, ExtractedTransaction, MultiImageExtractedTransaction } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ExportService } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import {
  TransactionService,
  RECEIPT_ATTACH_FAILED,
  RECEIPT_IMAGE_LIMIT_ERROR,
} from './transaction.service';
import { BudgetService } from './budget.service';
import { AuthService } from './auth.service';
import { AIStrategyService, ProcessingResult, ReceiptAttemptDiagnostics } from './ai-strategy.service';
import { AnalyticsService } from './analytics.service';
import { IMAGE_FILE_EXTENSIONS } from '../utils/file.utils';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { consolidateReceiptItems } from '../utils/receipt-consolidation';
import { readCurrencyCode } from '../utils/receipt-extraction.utils';
import { localeRegion, suggestCurrency } from '../utils/currency-suggestion.utils';
import { CurrencyChoiceSessionService } from './currency-choice-session.service';
import {
  AIErrorInfo,
  AI_CLOUD_UNAVAILABLE,
  AI_NO_PROVIDER,
  AI_QUEUED_OFFLINE,
  AI_QUEUE_WRITE_FAILED,
  AI_QUEUE_WRITE_PARTIAL,
  parseAIError,
  ReceiptProcessingError,
} from '../utils/ai-error.utils';
import { nextImportRowId } from '../utils/import-row-id.utils';
import { normalizeTags } from '../utils/tag.utils';
import {
  categoryFitsType,
  CategoryRowType,
  fallbackCategoryFor,
  gradeCategorySuggestion,
  resolveCategoryId,
  UNCATEGORIZED_CATEGORY_CONFIDENCE,
  UNRESOLVED_CATEGORY_CONFIDENCE,
} from '../utils/categorization.utils';
import { RasterizedPdf, rasterizePdf } from '../utils/pdf-raster.utils';
import { CategoryMemoryService } from './category-memory.service';
import { RagContextService } from './rag-context.service';
import { GroundingHistoryService } from './grounding-history.service';
import { TagMemoryService } from './tag-memory.service';
import { TagSuggestionService } from './tag-suggestion.service';
import { RecurringService } from './recurring.service';
import { CategoryService } from './category.service';
import {
  ImportResult,
  ImportWarning,
  CategorizedImportTransaction,
  ImportCurrencyTotals,
  ImportHistory,
  ImportProvenance,
  ImportSource,
  ImportFileType,
  DuplicateCheck,
  ProcessingStep,
  RecurringTransaction,
  Transaction,
  TransactionLocation,
  isBudgetPeriod,
  CATEGORY_MEMORY_CONFIDENCE,
  baseCurrencyOf,
  Category,
  CreateTransactionDTO,
  CurrencySuggestion
} from '../../models';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';
import {
  imageMetadataOf,
  importAmount,
  locationSlotFrom,
  readTransactionSnapshot,
  resolveImportCurrency,
  resolveImportDate,
  toCreateTransactionDTO,
  TransactionSnapshot,
} from '../utils/import-dto.utils';
import { sumByCurrency } from '../utils/import-review.utils';
import { matchRecurringRule } from '../utils/recurring-conversion.utils';
import { planReceiptAttachments } from '../utils/receipt-attachment.utils';

/**
 * Thrown when every transaction was written but the completed history record
 * could not be read back. The import itself succeeded — callers must not
 * present this as a failed import, or the user's natural retry duplicates
 * the whole batch.
 */
export const IMPORT_READBACK_FAILED = 'IMPORT_HISTORY_READBACK_FAILED';

/**
 * The read-back follows an acknowledged write, so the snapshot normally
 * arrives from the local cache in milliseconds; this bounds how long the
 * confirm step can hang when the listener errors or never fires.
 */
export const IMPORT_READBACK_TIMEOUT_MS = 5000;

/**
 * The grade for a category the extraction itself named, on the same 0-1
 * scale the categorization ladder grades its own answers on — ADR 0045's
 * evidence rule (`t.category ? 0.8 : 0.3`). Kept at or above 0.5, the
 * `low_confidence` warning threshold, so a merged row naming its own
 * category is never flagged for the review that grade exists to spare it.
 */
const EXTRACTION_CATEGORY_GRADE = 0.8;

/**
 * The grade for a category resolved from the CSV door's own Category cell:
 * not a guess, at any evidence tier — a name the account's own catalog
 * matched exactly, over the row's own type, with no other entry it could
 * mean. Above {@link EXTRACTION_CATEGORY_GRADE}'s reading of a model's
 * extraction for the same reason: nothing was read here, an exact name in
 * the file was checked against the catalog that named it.
 */
const EXACT_CATEGORY_GRADE = 1.0;

/**
 * Re-exported from their new home so the dialogs and specs that import the
 * codes from here keep compiling. The definitions moved to the util because
 * parseAIError needs them and the strategy service needs parseAIError.
 */
export type { AIErrorInfo } from '../utils/ai-error.utils';
export { AI_NO_PROVIDER, AI_QUEUED_OFFLINE } from '../utils/ai-error.utils';

@Injectable({ providedIn: 'root' })
export class AIImportService {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private categoryMemory = inject(CategoryMemoryService);
  private ragContext = inject(RagContextService);
  private groundingHistory = inject(GroundingHistoryService);
  private tagSuggestions = inject(TagSuggestionService);
  private tagMemory = inject(TagMemoryService);
  private recurringService = inject(RecurringService);
  private categoryService = inject(CategoryService);
  private exportService = inject(ExportService);
  private duplicateService = inject(DuplicateDetectionService);
  private importHistoryService = inject(ImportHistoryService);
  private transactionService = inject(TransactionService);
  private budgetService = inject(BudgetService);
  private authService = inject(AuthService);
  private strategyService = inject(AIStrategyService);
  private analytics = inject(AnalyticsService);
  private offlineQueue = inject(OfflineQueueService);
  private pwaService = inject(PwaService);
  private currencySession = inject(CurrencyChoiceSessionService);

  // Processing state signals
  isProcessing = signal<boolean>(false);
  // Named, never narrated: the processing step's line is a surface the user
  // reads, so it lives in the catalogs and the wizard resolves this name
  // through them (ADR 0036).
  processingStep = signal<ProcessingStep | null>(null);
  processingProgress = signal<number>(0);
  // The confirm step renders this translated too, so the write's own progress
  // is a structured fact rather than a sentence the service wrote (ADR 0114).
  processingRow = signal<{ done: number; total: number } | null>(null);

  isOfflineMode = computed(() => !this.pwaService.isOnline());

  /**
   * A run that has ended owns no bar: the flag, the step and the bar are
   * the tail every door shares, cleared together in one synchronous block
   * so nothing can render between the flag going false and the bar going
   * with it (ADR 0118's fourth gap). The head reset stays per-door — each
   * door reaches its own floor through a different first await, so there
   * is no shared moment before that to centralise it into.
   */
  private endRun(): void {
    this.isProcessing.set(false);
    this.processingStep.set(null);
    this.processingProgress.set(0);
  }

  /**
   * Main entry point: detect file type and route to appropriate handler
   */
  async importFromFile(file: File): Promise<ImportResult> {
    const fileType = this.detectFileType(file);
    const source = this.getSourceFromFileType(fileType);

    switch (source) {
      case 'image':
        return this.importFromImage(file);
      case 'pdf':
        return this.importFromPDF(file);
      case 'csv':
        return this.importFromCSV(file);
      case 'json':
        return this.importFromJSON(file);
      default:
        throw new Error(`Unsupported file type: ${file.type}`);
    }
  }

  /**
   * The gate every image door opens with: return when a reader this door can
   * actually reach is available, otherwise keep the capture or say why it
   * cannot be read.
   *
   * `nativeReads` is the door's own answer, not the device's. `canUseNative`
   * is a platform check, so crediting a cloud-only door with the on-device
   * reader would walk an offline iPhone straight into a request that has
   * nowhere to go — only the door that runs through the strategy service
   * reads locally.
   *
   * `queues` asks the same question of the queue. The drain runs every stored
   * image through the receipt pipeline, so a door whose images are not
   * receipts, or whose caller already holds the rows this photo produced,
   * refuses instead of promising work the drain cannot deliver.
   *
   * Queuing answers before any provider guard, because a photo the user
   * cannot take again is worth more than an error that names the right cause:
   * a configured key says nothing about a connection reaching it, and the
   * capture is unrepeatable either way. Online, nothing is kept — the queue
   * exists for work that has no way out, not for a device that simply has no
   * reader configured.
   */
  private async holdOrRefuse(
    files: File[],
    door: { nativeReads: boolean; queues: boolean }
  ): Promise<void> {
    if (
      this.strategyService.canUseCloud() ||
      (door.nativeReads && this.strategyService.canUseNative())
    ) {
      return;
    }
    if (this.pwaService.isOnline()) {
      throw new Error(AI_NO_PROVIDER);
    }
    if (!door.queues) {
      throw new Error(AI_CLOUD_UNAVAILABLE);
    }

    // Every page is attempted before anything is thrown: stopping at the
    // first rejection would leave the rest of a capture neither stored nor
    // mentioned. Each page is its own queue row and the drain reads each on
    // its own, so a receipt photographed across several pages comes back as
    // several transactions — the count the caller shows is what tells the
    // user how many were kept.
    let stored = 0;
    for (const file of files) {
      try {
        await this.offlineQueue.queueImage(file);
        stored++;
      } catch (error) {
        console.warn('[AIImport] Could not queue an image for later:', error);
      }
    }
    // Two outcomes, not one: a caller told "some pages were kept" must not
    // offer the retry that would store them again, and a caller told that
    // when nothing was kept would be reporting a capture as safe that is
    // gone. Only the second leaves a second attempt worth making.
    if (stored === 0) {
      throw new Error(AI_QUEUE_WRITE_FAILED);
    }
    if (stored < files.length) {
      throw new Error(AI_QUEUE_WRITE_PARTIAL);
    }
    throw new Error(AI_QUEUED_OFFLINE);
  }

  /**
   * Import transactions from an image (receipt, screenshot, bank statement)
   * Uses cloud AI or native OCR (iOS)
   */
  async importFromImage(file: File): Promise<ImportResult> {
    const startedAt = performance.now();
    await this.holdOrRefuse([file], { nativeReads: true, queues: true });

    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(10);

    try {
      const history = await this.groundingHistory.recent();

      // Try using strategy service
      try {
        this.processingStep.set({ name: 'extracting' });
        this.processingProgress.set(30);

        const strategyResult = await this.strategyService.processReceipt(file);

        if (strategyResult.transactions.length > 0) {
          this.processingStep.set({ name: 'categorizing' });
          this.processingProgress.set(60);

          const categorized = this.convertStrategyResultToCategories(strategyResult);
          const suggested = await this.suggestTagsFor(categorized, history);
          const offered = await this.attachRecurringMatches(suggested);

          this.processingStep.set({ name: 'duplicates' });
          this.processingProgress.set(80);

          const duplicates = await this.duplicateService.checkDuplicates(offered);
          const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

          this.processingProgress.set(100);

          const result = this.buildImportResult(file, 'image', 'receipt_image', markedTransactions, duplicates);
          if (strategyResult.diagnostics) {
            result.diagnostics = strategyResult.diagnostics;
          }

          return result;
        }
      } catch (strategyError) {
        const parsed = this.parseAIError(strategyError);
        console.warn('[AIImport] Strategy processing failed:', parsed.type, strategyError);
        // If not retryable (auth/quota), throw immediately — don't try fallback
        if (!parsed.retryable) {
          throw new Error(parsed.message);
        }
        // Otherwise fall through to legacy processing
      }

      // Fall back to single-shot extraction through the configured provider
      if (!this.cloudLLMProvider.hasAnyCloudProvider()) {
        throw new Error(AI_NO_PROVIDER);
      }

      const imageBase64 = await this.fileToBase64(file);

      this.processingStep.set({ name: 'extracting' });
      this.processingProgress.set(30);

      const extractedTransactions = await this.withTimeout(
        signal => this.cloudLLMProvider.extractTransactionsFromImage(imageBase64, { signal }),
        60000, // 60 second timeout
        'AI extraction timed out. Please try again.'
      );

      this.processingStep.set({ name: 'categorizing' });
      this.processingProgress.set(60);

      // The one categorizeTransactions call site that is a real receipt
      // photo, so the ladder is layered on here rather than inside the
      // shared mapper — the CSV, PDF and statement doors that mapper also
      // serves have no receipt to read a country off (ADR 0064).
      const categorized = (await this.categorizeTransactions(extractedTransactions))
        .map(row => ({ ...row, ...this.currencySuggestionSlot(row) }));
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      const result = this.buildImportResult(file, 'image', 'receipt_image', markedTransactions, duplicates);
      // The call above already succeeded, so resolving the provider here
      // reports exactly what answered.
      result.diagnostics = this.cloudDiagnostics(startedAt, this.strategyService.receiptProvider());

      return result;
    } finally {
      this.endRun();
    }
  }

  /**
   * Seam for the on-demand pdfjs import, so specs can render without a canvas.
   * Mirrors the loadSdk seam each provider service uses for its own SDK.
   */
  protected rasterizePdf(data: ArrayBuffer): Promise<RasterizedPdf> {
    return rasterizePdf(data);
  }

  /**
   * Import statement screenshots as one transaction per line item.
   *
   * Deliberately not the multi-image receipt path. That path exists to merge
   * the line items of a receipt into the single purchase they add up to, and
   * running a statement through it produced one lumped transaction for a whole
   * page of unrelated charges — every row folded into `receiptId` 1, because
   * items the model did not group default to the same group.
   *
   * A statement has no total to collapse to, so there is no consolidation here
   * and each row survives as its own transaction.
   */
  async importFromStatementImages(files: File[]): Promise<ImportResult> {
    if (files.length === 0) {
      throw new Error('No image files provided');
    }

    // Cloud-only, and never queued: a statement page stored in the queue
    // would come back through the receipt pipeline this door exists to avoid,
    // and land a page of unrelated charges in the ledger as one lumped
    // transaction with nothing to review it against.
    await this.holdOrRefuse(files, { nativeReads: false, queues: false });

    const startedAt = performance.now();
    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(10);
    // Stays null until a request is actually issued, the same discipline
    // AIStrategyService.runProcessing keeps: a failure in groundingHistory
    // or a page's own fileToBase64 is not the provider's doing, and must not
    // report one.
    let provider: ReceiptAttemptDiagnostics['provider'] = null;

    try {
      const history = await this.groundingHistory.recent();
      const extracted: ExtractedTransaction[] = [];
      for (let i = 0; i < files.length; i++) {
        this.processingProgress.set(10 + Math.round((i / files.length) * 50));
        const imageBase64 = await this.fileToBase64(files[i]);
        provider = this.strategyService.receiptProvider();
        extracted.push(
          ...(await this.withTimeout(
            signal => this.cloudLLMProvider.extractStatementTransactions(imageBase64, { signal }),
            60000,
            'AI extraction timed out. Please try again.'
          ))
        );
      }

      this.processingStep.set({ name: 'categorizing' });
      this.processingProgress.set(60);
      const categorized = await this.categorizeTransactions(extracted);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);
      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const marked = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);
      this.analytics.trackAiAssistUsed({ feature: 'receipt_scan' });

      // 'screenshot', not 'receipt_image': fileType exists to tell these
      // apart, and Import History renders it.
      const result = this.buildImportResult(
        files[0], 'image', 'screenshot', marked, duplicates
      );
      result.diagnostics = this.cloudDiagnostics(startedAt, provider);
      return result;
    } catch (error) {
      throw this.asReceiptProcessingError(error, startedAt, provider);
    } finally {
      this.endRun();
    }
  }

  /**
   * Convert a strategy result to review rows.
   *
   * Public because the camera dialog converts its result here too, beside
   * `importFromImage` — the image branch of `importFromFile`, which the
   * wizard, that method's only caller, never takes, since it sends every
   * image to `importFromMultipleImages` or `importFromStatementImages`. One
   * converter carries currencyFellBack, the location and the photo mapping
   * to the review card the same way for both. The photo-mapping block is
   * stamped only on a row that carries an `imageIndex` or a `receiptId`, and
   * `processReceipt` sets neither, so a single-receipt scan gets no block.
   */
  convertStrategyResultToCategories(result: ProcessingResult): CategorizedImportTransaction[] {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    const categories = this.categoryService.categories();

    return result.transactions.map(tx => {
      const resolved = resolveImportDate(tx.date, tx.fieldConfidence?.date);
      const money = resolveImportCurrency(tx.currencyFellBack ? '' : tx.currency, baseCurrency);
      const imageMetadata = imageMetadataOf(tx);
      const row: CategorizedImportTransaction = {
        id: nextImportRowId('strategy'),
        description: tx.description,
        // A reader that reports an expense as a negative loses the sign here
        // rather than at the write, which flipped it anyway: the card is
        // meant to show the figure the ledger will hold.
        amount: importAmount(tx.amount, money.currency),
        ...money,
        date: resolved.date,
        type: tx.type,
        // Every strategy row carries a real type, so the category is held to
        // that side of the ledger the way every other door holds it.
        ...gradeCategorySuggestion(tx, tx.type, categories),
        isDuplicate: false,
        selected: true,
        notes: tx.notes,
        fieldConfidence: tx.fieldConfidence,
        ...(imageMetadata ? { imageMetadata } : {}),
        ...(tx.tags?.length ? { tags: tx.tags } : {}),
        ...(tx.location ? { location: tx.location } : {}),
        ...(tx.receiptCountry ? { receiptCountry: tx.receiptCountry } : {}),
        ...(tx.period ? { period: tx.period } : {}),
        ...(tx.isRecurring !== undefined ? { isRecurring: tx.isRecurring } : {}),
        ...(resolved.dateAssumed ? { dateAssumed: true } : {}),
        ...(resolved.dateImplausible ? { dateImplausible: true } : {}),
      };
      return { ...row, ...this.currencySuggestionSlot(row) };
    });
  }

  /**
   * The ladder's offer for a row whose currency fell back, as a mark on the
   * row. No position rung here: a batch is reviewed wherever the user happens
   * to be, and ADR 0062 keeps a position-derived currency off the bulk path.
   */
  private currencySuggestionSlot(
    row: Pick<CategorizedImportTransaction, 'currency' | 'currencyFellBack' | 'receiptCountry'>
  ): { currencySuggestion?: CurrencySuggestion } {
    if (!row.currencyFellBack) {
      return {};
    }
    const suggestion = suggestCurrency({
      receiptCountry: row.receiptCountry,
      datedToday: false,
      sessionCurrency: this.currencySession.current() ?? undefined,
      localeRegion: localeRegion(),
      currentCurrency: row.currency,
    });
    return suggestion ? { currencySuggestion: suggestion } : {};
  }

  /**
   * Diagnostics for the paths that call a cloud provider directly rather
   * than through the strategy service. Always cloud, timed from the moment
   * the door was entered. `provider` is the caller's own — resolved only
   * once a request was actually issued, the same discipline
   * AIStrategyService.runProcessing keeps, so a failure before any request
   * left the process (a grounding read, a file that would not decode)
   * reports no provider rather than blaming whichever one happens to be
   * configured.
   */
  private cloudDiagnostics(
    startedAt: number,
    provider: ReceiptAttemptDiagnostics['provider'],
    error?: unknown
  ): ReceiptAttemptDiagnostics {
    const base: ReceiptAttemptDiagnostics = {
      engine: 'cloud',
      provider,
      durationMs: performance.now() - startedAt,
    };
    if (error === undefined) {
      return base;
    }
    const parsed = parseAIError(error);
    return { ...base, errorType: parsed.type, retryable: parsed.retryable };
  }

  /** Wrap a direct-provider throw so the door can read what was learned. */
  private asReceiptProcessingError(
    error: unknown,
    startedAt: number,
    provider: ReceiptAttemptDiagnostics['provider']
  ): ReceiptProcessingError {
    return error instanceof ReceiptProcessingError
      ? error
      : new ReceiptProcessingError(this.cloudDiagnostics(startedAt, provider, error), error);
  }

  /**
   * Import transactions from one or more receipt photos.
   * Images should be ordered top-to-bottom as they appear on the receipt.
   * Every count goes through receiptId-aware extraction + consolidation, so
   * a single photo holding several receipts still yields one transaction
   * per receipt (importFromImage has no receipt grouping).
   *
   * `queueWhenOffline` is for the callers that already hold what this photo
   * produced — the transaction form re-reads a photo its own scan has
   * already patched into the open form, and storing it would have the drain
   * write those rows a second time once the connection returns.
   */
  async importFromMultipleImages(
    files: File[],
    options: { queueWhenOffline?: boolean } = {}
  ): Promise<ImportResult> {
    if (files.length === 0) {
      throw new Error('No image files provided');
    }

    // Ahead of the key check below, which is about configuration and not
    // about connectivity: an offline device with a key configured still has
    // nowhere to send the photos, and they are kept rather than lost.
    await this.holdOrRefuse(files, {
      nativeReads: false,
      queues: options.queueWhenOffline ?? true,
    });

    if (!this.cloudLLMProvider.hasAnyCloudProvider()) {
      throw new Error(AI_NO_PROVIDER);
    }

    const startedAt = performance.now();

    // After the availability guard, so a request that was never issued is not
    // counted. Tagged here rather than in AIStrategyService because the import
    // wizard reaches this method directly, and because the strategy service is
    // also driven by the offline queue replaying work nobody just asked for.
    this.analytics.trackAiAssistUsed({ feature: 'receipt_scan' });

    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(5);
    // Stays null until the extraction request is actually issued, the same
    // discipline AIStrategyService.runProcessing keeps: a failure in the
    // grounding read or in decoding one of the files above is not the
    // provider's doing, and must not report one.
    let provider: ReceiptAttemptDiagnostics['provider'] = null;

    try {
      const history = await this.groundingHistory.recent();

      // Convert all files to base64
      const imageBase64Array: string[] = [];
      for (let i = 0; i < files.length; i++) {
        this.processingStep.set({ name: 'readingImage', done: i + 1, total: files.length });
        this.processingProgress.set(5 + Math.round((i / files.length) * 20));
        const base64 = await this.fileToBase64(files[i]);
        // Extract just the base64 data part
        imageBase64Array.push(base64);
      }

      this.processingStep.set({ name: 'extracting' });
      this.processingProgress.set(30);
      provider = this.strategyService.receiptProvider();

      // Use multi-image extraction with position-aware deduplication
      const extractedTransactions = await this.withTimeout(
        signal =>
          this.cloudLLMProvider.extractTransactionsFromMultipleImages(imageBase64Array, { signal }),
        90000, // 90 second timeout for multiple images
        'AI extraction timed out. Please try again with fewer images.'
      );
      // Read before anything else can issue a request: the flag describes the
      // call just awaited, and every later provider call clears it (#331).
      const answerIncomplete = this.cloudLLMProvider.answerWasIncomplete();

      this.processingStep.set({ name: 'categorizing' });
      this.processingProgress.set(60);

      // Consolidate line items into a single receipt transaction. The base
      // currency only labels the itemized note; the merged row's own currency
      // stays empty so the fallback in categorizeMultiImageTransactions runs.
      const consolidated = consolidateReceiptItems(
        extractedTransactions,
        baseCurrencyOf(this.authService.currentUser())
      );

      // Convert to CategorizedImportTransaction format with image metadata
      const categorized = await this.categorizeMultiImageTransactions(consolidated, history);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      const result = this.buildMultiImageImportResult(
        files,
        markedTransactions,
        duplicates,
        answerIncomplete
      );
      result.diagnostics = this.cloudDiagnostics(startedAt, provider);
      return result;
    } catch (error) {
      throw this.asReceiptProcessingError(error, startedAt, provider);
    } finally {
      this.endRun();
    }
  }

  /**
   * The categorization ladder shared by the multi-image and CSV paths:
   * anything the user already corrected is answered from category memory
   * (CATEGORY_MEMORY_CONFIDENCE), the rest goes to the provider in one
   * grounded batch call when one is configured, and whatever no one could
   * answer keeps the seeded floor — the row's own type's catch-all
   * (`fallbackCategoryFor`) at UNCATEGORIZED_CATEGORY_CONFIDENCE, low enough
   * that the review step flags it. One entry per input row, in input order.
   *
   * Memory is keyed by merchant alone, and one merchant can sit on both
   * sides of the ledger — a shop's purchases and its refunds. A remembered
   * category on the other side of a typed row's ledger is therefore no
   * answer for that row, which climbs on to the provider like a merchant
   * memory does not know.
   */
  private async categorizeWithLadder(
    rawTransactions: RawTransaction[],
    history: Transaction[]
  ): Promise<CategorizedTransaction[]> {
    // Anything the user has already corrected is settled — only the rest is
    // worth a model call.
    await this.categoryMemory.ensureLoaded();
    const categories = this.categoryService.categories();
    const remembered = rawTransactions.map(t => {
      const categoryId = this.categoryMemory.lookup(t.description);
      return categoryId && t.type && !this.onRowSide(categoryId, t.type, categories) ? null : categoryId;
    });

    const categorized: CategorizedTransaction[] = rawTransactions.map((t) => ({
      ...t,
      suggestedCategoryId: fallbackCategoryFor(t.type),
      confidence: UNCATEGORIZED_CATEGORY_CONFIDENCE
    }));

    const unknownIndexes = remembered
      .map((categoryId, index) => (categoryId ? -1 : index))
      .filter(index => index >= 0);

    if (unknownIndexes.length > 0 && this.cloudLLMProvider.hasAnyCloudProvider()) {
      try {
        const asked = await this.cloudLLMProvider.categorizeTransactions(
          unknownIndexes.map(index => rawTransactions[index]),
          this.buildCategorizationGrounding(history)
        );
        // The provider indexes its answers against what it was sent, so map
        // them back onto the original positions.
        asked.forEach((result, position) => {
          categorized[unknownIndexes[position]] = result;
        });
      } catch (error) {
        console.warn('AI categorization failed, using defaults:', error);
      }
    }

    return categorized.map((t, index) =>
      remembered[index]
        ? { ...t, suggestedCategoryId: remembered[index], confidence: CATEGORY_MEMORY_CONFIDENCE }
        : t
    );
  }

  /**
   * Categorize multi-image extracted transactions, preserving image metadata.
   *
   * The multi-image prompts now grade every row's date, not only the missing
   * case — a missing date still gets the fabricated `dateConfidence: 0`, but a
   * date that was read carries whatever grade the model gave it. So
   * resolveImportDate below can catch a merely doubtful but parseable date on
   * this lane too, not just that fabricated zero or a date nothing can parse.
   */
  private async categorizeMultiImageTransactions(
    transactions: MultiImageExtractedTransaction[],
    history: Transaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (transactions.length === 0) return [];

    // Get user's base currency from settings
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    const resolutions = transactions.map(t => resolveImportDate(t.date, t.dateConfidence));

    // Convert to RawTransaction format for categorization
    const rawTransactions: RawTransaction[] = transactions.map((t, i) => ({
      description: t.description,
      amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
      date: resolutions[i].date,
      type: t.type
    }));

    // A row the extraction already named a category for has no ladder
    // opinion to blend with: sending it through anyway would pair the
    // extraction's own id with a grade that answers a different question.
    // Only the rows still uncategorised are worth the call — an
    // all-categorised batch skips categorizeWithLadder entirely rather than
    // pay for one with nothing to ask.
    //
    // A name on the other side of a typed row's ledger is no answer for it:
    // the prompt asks for income on a refund line yet gives only expense
    // categories as its examples, so such a row goes to the ladder, which is
    // typed, like one the extraction left unnamed.
    const categories = this.categoryService.categories();
    const named = transactions.map(t =>
      t.category && (!t.type || this.onRowSide(t.category, t.type, categories)) ? t.category : undefined
    );
    const uncategorizedIndexes = named
      .map((categoryId, index) => (categoryId ? -1 : index))
      .filter(index => index >= 0);

    const ladderResults = uncategorizedIndexes.length > 0
      ? await this.categorizeWithLadder(uncategorizedIndexes.map(index => rawTransactions[index]), history)
      : [];

    let ladderPosition = 0;
    const categorizedByAI: CategorizedTransaction[] = rawTransactions.map((raw, index) => {
      const categoryId = named[index];
      return categoryId
        ? { ...raw, suggestedCategoryId: categoryId, confidence: EXTRACTION_CATEGORY_GRADE }
        : ladderResults[ladderPosition++];
    });

    // Convert to CategorizedImportTransaction with image metadata
    return categorizedByAI.map((t, index) => {
      const original = transactions[index];
      const resolved = resolutions[index];
      const money = resolveImportCurrency(original.currency, baseCurrency);
      const row: CategorizedImportTransaction = {
        id: nextImportRowId('multi_img'),
        description: t.description,
        // Consolidation sums items and prefers a printed total without
        // rounding either; a receipt's own currency decides what survives.
        amount: importAmount(t.amount, money.currency),
        ...money,
        date: resolved.date,
        type: original.type,
        suggestedCategoryId: t.suggestedCategoryId,
        categoryConfidence: t.confidence,
        notes: this.formatItemNotes(original.details),
        fieldConfidence: (original.amountConfidence !== undefined || resolved.dateConfidence !== undefined)
          ? {
              ...(original.amountConfidence !== undefined ? { amount: original.amountConfidence } : {}),
              ...(resolved.dateConfidence !== undefined ? { date: resolved.dateConfidence } : {})
            }
          : undefined,
        isDuplicate: false,
        selected: true,
        imageMetadata: {
          imageIndex: original.imageIndex,
          imageId: `image_${original.imageIndex}`,
          positionInImage: original.positionInImage,
          confidenceScore: original.confidence,
          wasMerged: original.wasMerged,
          mergedFromImages: original.mergedFromImages,
          receiptId: original.receiptId,
        },
        ...(original.merchant ? { merchant: original.merchant } : {}),
        ...(original.tags?.length ? { tags: original.tags } : {}),
        ...(original.location ? { location: original.location } : {}),
        ...(original.receiptCountry ? { receiptCountry: original.receiptCountry } : {}),
        ...(original.period ? { period: original.period } : {}),
        ...(original.isRecurring !== undefined ? { isRecurring: original.isRecurring } : {}),
        ...(resolved.dateAssumed ? { dateAssumed: true } : {}),
        ...(resolved.dateImplausible ? { dateImplausible: true } : {})
      };
      return { ...row, ...this.currencySuggestionSlot(row) };
    });
  }

  /**
   * How this user has categorized things before, for grounding the model's
   * suggestions in their habits rather than in what a merchant generally sells.
   *
   * The history is read once per import by GroundingHistoryService, which owns
   * the `ragInsightsLevel` gate: an empty window is either RAG off or an
   * account with nothing to say, and both mean the prompt renders exactly as
   * it did before grounding existed. Failing to build the block is not worth
   * failing an import over — the model just answers unaided.
   */
  private buildCategorizationGrounding(history: Transaction[]): string | undefined {
    if (!history.length) {
      return undefined;
    }

    try {
      return this.ragContext.buildCategorizationGrounding({ transactions: history }) || undefined;
    } catch (error) {
      console.warn('[AIImport] Could not build categorization grounding:', error);
      return undefined;
    }
  }

  /**
   * Offer tags for the rows no source tagged. Stamped on `tags` so the card
   * shows them, and kept on `suggestedTags` so the confirm step can tell a
   * removal from a row that never had any.
   */
  private async suggestTagsFor(
    rows: CategorizedImportTransaction[],
    history: Transaction[]
  ): Promise<CategorizedImportTransaction[]> {
    const pending = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.tags?.length);
    if (pending.length === 0) return rows;

    const suggested = await this.tagSuggestions.suggest(
      pending.map(({ row }) => ({
        description: row.description,
        ...(row.merchant ? { merchant: row.merchant } : {}),
        ...(row.notes ? { details: row.notes } : {}),
      })),
      history
    );

    const out = [...rows];
    pending.forEach(({ index }, position) => {
      const tags = suggested[position] ?? [];
      if (tags.length) out[index] = { ...out[index], tags, suggestedTags: tags };
    });
    return out;
  }

  /**
   * What this account files in, for a row no door produced: the review card
   * denominates a hand-added row in it when there is no row above to copy a
   * currency from, so the row the reviewer types cannot land in a currency
   * the batch beside it never used. The doors here take the same reading
   * inline, mid-map; this exists because the card is outside this service
   * and must not reach past it into the auth session for it.
   */
  baseCurrency(): string {
    return baseCurrencyOf(this.authService.currentUser());
  }

  /**
   * Every tag this account already files by, for the card's own add control:
   * what the memory remembers, what the recent window carries, and what the
   * batch itself arrived with.
   *
   * `ensureLoaded` first, because the memory can still be cold here — the
   * JSON door and a CSV that carried its own tags never run `suggest`, which
   * is what usually warms it, and a vocabulary read mid-load is short of
   * exactly the tags this user decided on.
   *
   * Never rejects, the same contract `suggest` holds. The list is an offer
   * and the field takes a hand-typed tag either way, so a door that failed
   * costs the reviewer suggestions and nothing else — what could be gathered
   * is still answered.
   */
  async tagVocabulary(rows: readonly CategorizedImportTransaction[]): Promise<string[]> {
    const own = rows.flatMap(row => row.tags ?? []);
    try {
      await this.tagMemory.ensureLoaded();
      const history = await this.groundingHistory.recent();
      return normalizeTags([...this.tagSuggestions.vocabularyFrom(history), ...own]);
    } catch (error) {
      console.warn('[AIImport] Could not read the tag vocabulary:', error);
      return normalizeTags(own);
    }
  }

  /**
   * Offer each row the active rule it looks like. One enumeration per batch
   * through listAll(): the rules signal is only warm on pages that subscribed
   * (ADR 0034), and a link is a write decision. A row already linked by its
   * source is left alone.
   */
  private async attachRecurringMatches(
    rows: CategorizedImportTransaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (rows.length === 0) return rows;
    let rules: RecurringTransaction[];
    try {
      rules = (await this.recurringService.listAll()).filter(rule => rule.isActive);
    } catch (error) {
      console.warn('[AIImport] Could not read recurring rules, offering no links:', error);
      return rows;
    }
    if (rules.length === 0) return rows;

    return rows.map(row => {
      if (row.recurringId) return row;
      const rule = matchRecurringRule(
        {
          description: row.description,
          merchant: row.merchant,
          type: row.type,
          amount: row.amount,
          currency: row.currency,
          ...(row.currencyFellBack ? { currencyFellBack: true } : {}),
        },
        rules
      );
      if (!rule) return row;
      return {
        ...row,
        recurringMatch: {
          id: rule.id,
          name: rule.name,
          ...(row.isRecurring !== undefined ? { sourceIsRecurring: row.isRecurring } : {}),
        },
      };
    });
  }

  /**
   * Build import result for multi-image imports with additional metadata.
   */
  private buildMultiImageImportResult(
    files: File[],
    transactions: CategorizedImportTransaction[],
    duplicates: DuplicateCheck[],
    answerIncomplete = false
  ): ImportResult {
    const warnings: ImportWarning[] = [];

    // The reader's answer stopped mid-row and only its complete rows were
    // kept, so items further down the receipt are missing from the rows
    // below. The affected group also lost its printed total — that field is
    // asked for on the group's last item — so consolidateReceiptItems falls
    // back to the item sum at REVIEW_AMOUNT_CONFIDENCE and the review table
    // already flags the amount. This says why (#331).
    if (answerIncomplete) {
      warnings.push({
        type: 'parse_error',
        message: 'The reader ran out of room mid-answer; some items may be missing.'
      });
    }

    // Add warnings for duplicates
    const duplicateCount = duplicates.filter(d => d.isDuplicate).length;
    if (duplicateCount > 0) {
      warnings.push({
        type: 'duplicate',
        message: `${duplicateCount} potential duplicate transaction(s) detected`
      });
    }

    // Add warnings for low confidence categorizations
    const lowConfidenceCount = transactions.filter(t => t.categoryConfidence < 0.5).length;
    if (lowConfidenceCount > 0) {
      warnings.push({
        type: 'low_confidence',
        message: `${lowConfidenceCount} transaction(s) have low categorization confidence`
      });
    }

    // Calculate overall confidence
    const avgConfidence = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + t.categoryConfidence, 0) / transactions.length
      : 0;

    // Calculate total file size
    const totalFileSize = files.reduce((sum, f) => sum + f.size, 0);

    // Generate combined filename
    const combinedFileName = files.length === 1
      ? files[0].name
      : `${files.length} images (${files[0].name}, ...)`;

    return {
      source: 'image',
      fileType: 'receipt_image',
      fileName: combinedFileName,
      fileSize: totalFileSize,
      transactions,
      confidence: avgConfidence,
      warnings,
      duplicates,
      sourceFiles: files,
      multiImageMetadata: {
        totalImages: files.length,
        deduplicationMethod: 'ai',
        imageIds: files.map((_, i) => `image_${i}`)
      }
    };
  }

  /**
   * Import transactions from a PDF (bank statement)
   */
  /**
   * Import a PDF bank statement.
   *
   * Gemini is the only provider that takes a PDF directly, so this used to
   * refuse outright for anyone configured with OpenAI or Claude — "PDF
   * extraction is only supported with Gemini", naming a provider they had not
   * chosen. The pages are rasterized here instead, which turns the problem
   * into one every vision-capable provider already solves.
   *
   * Long documents are truncated rather than attempted: each page is a
   * full-size canvas and another image in the request, and on iOS an
   * over-long document kills the WebView rather than throwing.
   */
  async importFromPDF(file: File): Promise<ImportResult> {
    this.analytics.trackAiAssistUsed({ feature: 'pdf_import' });

    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(10);

    try {
      const history = await this.groundingHistory.recent();
      const { pages, totalPages, truncated } = await this.rasterizePdf(await file.arrayBuffer());

      if (pages.length === 0) {
        throw new Error('No pages could be read from this PDF.');
      }

      this.processingStep.set({ name: 'extracting' });
      this.processingProgress.set(30);

      // The provider method, not the sibling image import: that one tags its
      // own analytics event, and one PDF import would report two.
      const extracted: ExtractedTransaction[] = [];
      for (let i = 0; i < pages.length; i++) {
        this.processingProgress.set(30 + Math.round((i / pages.length) * 30));
        extracted.push(
          ...(await this.withTimeout(
            signal => this.cloudLLMProvider.extractStatementTransactions(pages[i], { signal }),
            60000,
            'AI extraction timed out. Please try again.'
          ))
        );
      }

      this.processingStep.set({ name: 'categorizing' });
      this.processingProgress.set(60);
      const categorized = await this.categorizeTransactions(extracted);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      const result = this.buildImportResult(file, 'pdf', 'bank_pdf', markedTransactions, duplicates);
      if (truncated) {
        result.warnings.push({
          type: 'info',
          message: `Only the first ${pages.length} of ${totalPages} pages were read.`,
        });
      }
      return result;
    } finally {
      this.endRun();
    }
  }

  /**
   * Import transactions from a CSV file with smart column detection
   */
  async importFromCSV(file: File): Promise<ImportResult> {
    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(10);

    try {
      const history = await this.groundingHistory.recent();

      // Use existing CSV parser from export service
      const importedTransactions = await this.exportService.importFromCSV(file);

      this.processingStep.set({ name: 'categorizing' });
      this.processingProgress.set(50);

      // Convert to ExtractedTransaction format. Mapped straight off the parsed
      // rows rather than through RawTransaction, which has no currency field —
      // routing through it meant the row's own currency was dropped and
      // replaced with a hardcoded one, pre-empting the base-currency fallback
      // that categorizeTransactions already applies. The parser's own type
      // must win over the sign: parseCSV emits absolute amounts, so a
      // sign-derived type here read every real CSV row as income.
      const extractedTransactions: ExtractedTransaction[] = importedTransactions.map(t => ({
        date: dayKey(t.date ?? new Date()),
        description: t.description,
        amount: Math.abs(t.amount),
        type: t.type ?? (t.amount >= 0 ? 'income' : 'expense'),
        currency: readCurrencyCode(t.currency),
        ...(t.note ? { note: t.note } : {}),
        ...(t.tags?.length ? { tags: t.tags } : {}),
        ...(t.location ? { location: t.location } : {}),
        ...(t.period ? { period: t.period } : {}),
        ...(t.isRecurring !== undefined ? { isRecurring: t.isRecurring } : {})
      }));

      const categorized = await this.categorizeTransactions(extractedTransactions);

      // The file's own Category cell: parseCSV (closed by ADR 0150) already
      // resolved each cell against the live catalog, exactly and over the
      // row's own type, so the id it left on the row is reused as-is — never
      // re-resolved here, and never sent to the fuzzy ladder below, which is
      // for a name the parser could not answer, not one it might answer
      // wrong. A row the parser could not resolve carries no `categoryId`.
      const resolvedCategoryIds = importedTransactions.map(t => t.categoryId);
      resolvedCategoryIds.forEach((categoryId, index) => {
        if (categoryId) {
          categorized[index].suggestedCategoryId = categoryId;
          categorized[index].categoryConfidence = EXACT_CATEGORY_GRADE;
        }
      });

      // The same ladder the image paths climb: category memory first, then a
      // grounded model call when a provider is configured, then the
      // review-flagged floor. Only for what the file's own column left
      // unresolved — a row already matched has no ladder opinion worth
      // blending with an answer that came straight from the account's catalog.
      const rawRows: RawTransaction[] = extractedTransactions.map(t => ({
        description: t.description,
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: parseDateInput(t.date) ?? new Date(),
        type: t.type
      }));
      const unresolvedIndexes = resolvedCategoryIds
        .map((categoryId, index) => (categoryId ? -1 : index))
        .filter(index => index >= 0);
      const laddered = unresolvedIndexes.length > 0
        ? await this.categorizeWithLadder(unresolvedIndexes.map(index => rawRows[index]), history)
        : [];
      laddered.forEach((row, position) => {
        const index = unresolvedIndexes[position];
        categorized[index].suggestedCategoryId = row.suggestedCategoryId;
        categorized[index].categoryConfidence = row.confidence;
      });

      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      return this.buildImportResult(file, 'csv', 'generic_csv', markedTransactions, duplicates);
    } finally {
      this.endRun();
    }
  }

  /**
   * Import transactions from a JSON backup file
   */
  async importFromJSON(file: File): Promise<ImportResult> {
    this.isProcessing.set(true);
    this.processingStep.set({ name: 'reading' });
    this.processingProgress.set(20);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.transactions || !Array.isArray(data.transactions)) {
        throw new Error('Invalid backup format: missing transactions array');
      }

      const baseCurrency = baseCurrencyOf(this.authService.currentUser());
      const categories = this.categoryService.categories();
      const ruleIds = await this.backupRuleIds(data.transactions);
      const categorized: CategorizedImportTransaction[] = data.transactions.map(
        (t: Record<string, unknown>) => {
          // The same resolver every other door runs its date through, and with
          // no confidence because nobody graded these: a backup's dates are
          // facts it recorded, not readings off paper. Ungraded means the
          // plausibility window is skipped, so a years-old file re-imports as
          // itself, while an absent or unreadable value still lands on today
          // carrying the mark the review card asks its question from. Reading
          // `.seconds` here by hand was what left that row silently dated
          // today, and a `date` of any other shape an Invalid Date.
          const resolved = resolveImportDate(t['date']);
          const type = (t['type'] as 'income' | 'expense') || 'expense';
          const categoryId = typeof t['categoryId'] === 'string' && t['categoryId'] ? t['categoryId'] : undefined;
          const recurringId = typeof t['recurringId'] === 'string' && ruleIds.has(t['recurringId'])
            ? t['recurringId']
            : undefined;
          const read = readCurrencyCode(t['currency']);
          const money = resolveImportCurrency(read, baseCurrency);
          // The rate alone, and only when the file named the currency it
          // converts from: a row that fell back to the base currency has
          // nothing a foreign rate could apply to. readTransactionSnapshot
          // already refuses a rate that is zero, negative or non-finite.
          const snapshot = readTransactionSnapshot(t);
          const fileRate = read && snapshot
            ? { exchangeRate: snapshot.exchangeRate, baseCurrency: snapshot.baseCurrency, currency: read }
            : undefined;
          return {
            id: nextImportRowId('json'),
            description: t['description'] as string || 'Unknown',
            amount: importAmount((t['amount'] as number) || 0, money.currency),
            ...money,
            date: resolved.date,
            type,
            ...this.gradeBackupCategory(categoryId, type, categories),
            isDuplicate: false,
            selected: true,
            // A backup row carries what its transaction held; anything absent
            // or malformed stays absent rather than being defaulted.
            ...(t['note'] ? { notes: t['note'] as string } : {}),
            ...(Array.isArray(t['tags']) && t['tags'].length ? { tags: t['tags'] as string[] } : {}),
            // Gated on a name until 0068, which silently dropped a location
            // that carried only a country -- exactly what a backup taken after
            // that change holds for a receipt that printed no address.
            ...locationSlotFrom(t['location'] as TransactionLocation | undefined),
            ...(isBudgetPeriod(t['period']) ? { period: t['period'] } : {}),
            ...(typeof t['isRecurring'] === 'boolean' ? { isRecurring: t['isRecurring'] } : {}),
            ...(recurringId ? { recurringId } : {}),
            ...(fileRate ? { fileRate } : {}),
            ...(resolved.dateAssumed ? { dateAssumed: true } : {})
          };
        }
      );

      this.processingStep.set({ name: 'duplicates' });
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);

      return this.buildImportResult(file, 'json', 'backup_json', markedTransactions, duplicates);
    } finally {
      this.endRun();
    }
  }

  /**
   * The category a backup row is filed under, and what that is worth.
   *
   * The file's id earns the full grade only when this account still holds
   * it, active, on the row's own side: a backup outlives the categories it
   * names, and a file from another account names ones this account never
   * had. Anything else lands on the row's own catch-all at the review grade,
   * the way every door files an answer the catalog did not understand. An
   * empty catalog has not loaded, so it can neither vouch for the id nor
   * show that it is wrong — the id stays, graded for review.
   */
  private gradeBackupCategory(
    categoryId: string | undefined,
    type: CategoryRowType,
    categories: Category[]
  ): Pick<CategorizedImportTransaction, 'suggestedCategoryId' | 'categoryConfidence'> {
    const catchAll = { suggestedCategoryId: fallbackCategoryFor(type), categoryConfidence: UNRESOLVED_CATEGORY_CONFIDENCE };
    if (!categoryId) return catchAll;
    if (categories.length === 0) {
      return { suggestedCategoryId: categoryId, categoryConfidence: UNRESOLVED_CATEGORY_CONFIDENCE };
    }
    // An empty fallback turns the resolver into a plain lookup of an active id.
    const held = resolveCategoryId(categoryId, categories, '');
    const category = held ? categories.find(c => c.id === held) : undefined;
    return category && categoryFitsType(category, type)
      ? { suggestedCategoryId: category.id, categoryConfidence: 1.0 }
      : catchAll;
  }

  /**
   * Whether a category id can be filed under a row of this type: false only
   * when the catalogue holds it on the other side of the ledger. An id the
   * catalogue does not hold, or a catalogue that has not loaded, cannot show
   * the id is wrong, so it passes — the backup door's rule for an empty
   * catalogue, which rewrites nothing it cannot check.
   */
  private onRowSide(categoryId: string, type: CategoryRowType, categories: Category[]): boolean {
    const category = categories.find(c => c.id === categoryId);
    return !category || categoryFitsType(category, type);
  }

  /**
   * The rule ids a backup's links may keep: every rule this account holds,
   * paused ones included, since a paused rule still owns the rows it posted.
   * One read for the file, and none when no row carries a link. A link that
   * could not be checked is dropped with the rest — a dangling one is worse
   * than none: the recurring detector files a linked row under its rule and
   * never clusters it again, so a link to nothing hides the charge under a
   * rule that does not exist.
   */
  private async backupRuleIds(rows: Record<string, unknown>[]): Promise<Set<string>> {
    if (!rows.some(t => typeof t?.['recurringId'] === 'string' && t['recurringId'])) {
      return new Set();
    }
    try {
      return new Set((await this.recurringService.listAll()).map(rule => rule.id));
    } catch (error) {
      console.warn('[AIImport] Could not read recurring rules, keeping no backup links:', error);
      return new Set();
    }
  }

  /**
   * Categorize extracted transactions.
   *
   * Shared by every import path that is not itself a receipt photo — a CSV
   * row, a rasterized PDF page and a statement screenshot all describe the
   * account holder's own paper, not a purchase made somewhere the phone
   * could place. It carries `receiptCountry` through when a row's own
   * extraction happened to read one (the statement and PDF prompts ask for
   * it too), but never layers the currency ladder on top of it: the offer
   * stays a receipt affordance (ADR 0064), applied instead only where the
   * extraction actually came off a receipt photo — this method's own
   * caller for the single-image legacy fallback, `convertStrategyResultToCategories`
   * and `categorizeMultiImageTransactions`.
   */
  async categorizeTransactions(
    transactions: ExtractedTransaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (transactions.length === 0) return [];

    // Get user's base currency from settings
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    // Convert ExtractedTransaction to CategorizedImportTransaction
    // If transaction already has a category from extraction on its own side
    // of the ledger, use it; otherwise its own type's catch-all — every row
    // here carries a real type, never the sign-derived guess
    // toCreateTransactionDTO falls back to. A statement's "Other" resolves to
    // other_expense whichever side the row is on, so an income row answered
    // that way lands on other_income, as an answer nobody could place.
    const categories = this.categoryService.categories();
    return transactions.map(t => {
      const type = t.type || 'expense';
      const named = t.category && this.onRowSide(t.category, type, categories) ? t.category : undefined;
      const resolved = resolveImportDate(t.date, t.dateConfidence);
      const money = resolveImportCurrency(t.currency, baseCurrency);

      const row: CategorizedImportTransaction = {
        id: nextImportRowId('import'),
        description: t.description,
        amount: importAmount(t.amount, money.currency),
        ...money,
        date: resolved.date,
        type,
        suggestedCategoryId: named ?? fallbackCategoryFor(type),
        // The grade follows the evidence, on the applyCategorizations scale
        // (categorization.utils.ts): EXTRACTION_CATEGORY_GRADE when extraction
        // actually named a category the row can take, the review grade when
        // nothing usable answered — under the 0.5 review band, so a defaulted
        // row is flagged instead of wearing the high chip it never earned.
        // (ADR 0045)
        categoryConfidence: named ? EXTRACTION_CATEGORY_GRADE : UNRESOLVED_CATEGORY_CONFIDENCE,
        originalText: `${t.merchant ? t.merchant + ' - ' : ''}${t.description}${t.details ? ' (' + t.details + ')' : ''}`,
        // A row that carries its own note (a CSV's Note column) keeps it
        // verbatim; formatItemNotes is for receipt item lists and splits
        // plain commas into newlines.
        notes: t.note ?? this.formatItemNotes(t.details),
        fieldConfidence: (t.amountConfidence !== undefined || resolved.dateConfidence !== undefined)
          ? {
              ...(t.amountConfidence !== undefined ? { amount: t.amountConfidence } : {}),
              ...(resolved.dateConfidence !== undefined ? { date: resolved.dateConfidence } : {})
            }
          : undefined,
        isDuplicate: false,
        selected: true,
        ...(t.merchant ? { merchant: t.merchant } : {}),
        ...(t.tags?.length ? { tags: t.tags } : {}),
        ...(t.location ? { location: t.location } : {}),
        ...(t.receiptCountry ? { receiptCountry: t.receiptCountry } : {}),
        ...(t.period ? { period: t.period } : {}),
        ...(t.isRecurring !== undefined ? { isRecurring: t.isRecurring } : {}),
        ...(resolved.dateAssumed ? { dateAssumed: true } : {}),
        ...(resolved.dateImplausible ? { dateImplausible: true } : {})
      };
      return row;
    });
  }

  /**
   * Confirm and save selected transactions to Firestore
   */
  async confirmImport(
    transactions: CategorizedImportTransaction[],
    fileName: string,
    fileSize: number,
    source: ImportSource,
    fileType: ImportFileType,
    sourceFiles?: File[],
    provenance?: ImportProvenance
  ): Promise<ImportHistory> {
    this.processingProgress.set(0);

    const selectedTransactions = transactions.filter(t => t.selected);
    // Which of the source photos each row keeps, resolved over the final
    // selected rows so deduplication's rewrites are already applied and a
    // deselected first row hands its group's photos to the first selected
    // one. Rows without image metadata (CSV, PDF, JSON) attach nothing.
    const attachmentPlans = sourceFiles?.length
      ? planReceiptAttachments(selectedTransactions, sourceFiles.length)
      : null;
    const skippedDuplicates = transactions.filter(t => t.isDuplicate && !t.selected).length;
    const userId = this.authService.userId();

    if (!userId) throw new Error('User not authenticated');

    // Create pending import history
    const historyId = await this.importHistoryService.createPendingImport(
      fileName,
      fileSize,
      source,
      fileType,
      provenance
    );

    let successCount = 0;
    let errorCount = 0;
    let receiptsSkipped = 0;
    let receiptsFailed = 0;
    let totalIncome = 0;
    let totalExpenses = 0;
    const errors: ImportHistory['errors'] = [];
    const transactionIds: string[] = [];
    // The rows the write actually took, kept so the record's per-currency
    // totals cover exactly what landed — the scalar pair beside them is
    // accumulated the same way, past the write and never before it.
    const written: CategorizedImportTransaction[] = [];

    // Get user's base currency for fallback
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    // Budgets are recalculated once per distinct category after the loop —
    // recalculating inside addTransaction would re-read and rewrite the same
    // budgets for every row of the import.
    const affectedExpenseCategories = new Set<string>();

    try {
      for (let i = 0; i < selectedTransactions.length; i++) {
        const txn = selectedTransactions[i];
        this.processingProgress.set(Math.round(((i + 1) / selectedTransactions.length) * 100));
        this.processingRow.set({ done: i + 1, total: selectedTransactions.length });

        try {
          // A Date, a date-only string the model produced, or nothing at all.
          // parseDateInput covers all three and rejects an unreadable value,
          // so the separate NaN guard this used to carry is now the ?? branch.
          const transactionDate = parseDateInput(txn.date) ?? new Date();

          // The same mapper the data hub's CSV path writes through. Only the
          // row's renames appear here — every optional the row carries
          // travels without this call site knowing its name, which is what
          // keeps a field added upstream from dying at the confirm step.
          const attachedFiles = attachmentPlans?.[i]?.length
            ? attachmentPlans[i].map(index => sourceFiles![index])
            : [];
          const bareDto = toCreateTransactionDTO({
            ...txn,
            categoryId: txn.suggestedCategoryId,
            note: txn.notes,
            date: transactionDate
          }, baseCurrency);
          const dto = attachedFiles.length
            ? { ...bareDto, receiptFiles: attachedFiles }
            : bareDto;
          const snapshot = this.fileRateSnapshot(txn.fileRate, bareDto, baseCurrency);
          const writeOptions = { skipBudgetRecalc: true, ...(snapshot ? { snapshot } : {}) };

          let savedId: string;
          try {
            savedId = await this.transactionService.addTransaction(dto, writeOptions);
          } catch (error) {
            // Both of these are about the images, not the row, and both leave
            // the batch rolled back with no id, upload or write behind them —
            // so the transaction is still worth saving bare, and each is
            // reported as its own figure.
            //
            // The attach failure used to fail the whole row, on the grounds
            // that retrying photo-less would silently drop photos on a flaky
            // network. It is not silent: the count is reported and recorded
            // per import. Losing a receipt's amount, date and category to
            // protect its photograph is the wrong way round — the transaction
            // is the record, the photo is evidence attached to it (#334).
            const message = error instanceof Error ? error.message : '';
            const imagesOnly =
              message === RECEIPT_IMAGE_LIMIT_ERROR || message === RECEIPT_ATTACH_FAILED;
            if (attachedFiles.length && imagesOnly) {
              savedId = await this.transactionService.addTransaction(bareDto, writeOptions);
              if (message === RECEIPT_IMAGE_LIMIT_ERROR) {
                receiptsSkipped++;
              } else {
                receiptsFailed++;
              }
            } else {
              throw error;
            }
          }
          successCount++;
          transactionIds.push(savedId);
          written.push(txn);

          if (txn.type === 'income') {
            totalIncome += txn.amount;
          } else {
            totalExpenses += txn.amount;
            affectedExpenseCategories.add(dto.categoryId);
          }
        } catch (error) {
          errorCount++;
          // Firestore rejects an undefined field, so code is only ever added
          // when the caught value actually carried one — a FirebaseError's
          // string code, not whatever shape a thrown plain object happens to
          // have.
          const code = typeof (error as { code?: unknown })?.code === 'string'
            ? (error as { code: string }).code
            : undefined;
          errors.push({
            row: i + 1,
            transactionId: txn.id,
            message: error instanceof Error ? error.message : 'Unknown error',
            ...(code ? { code } : {}),
            originalValue: txn.description
          });
        }
      }

      // One recalculation per distinct category the loop actually posted to,
      // the same shape the recurring catch-up uses after its claims commit.
      // A failure here must not fail the import: the rows are saved, and a
      // spent counter that lagged is recovered by the next recalculation.
      for (const categoryId of affectedExpenseCategories) {
        try {
          await this.budgetService.recalculateBudgetsForCategory(categoryId);
        } catch (error) {
          console.warn('[AIImport] Budget recalculation failed for', categoryId, error);
        }
      }

      // Update import history with final stats
      // Note: Only include errors if there are any (Firestore rejects undefined values)
      const completeStats: {
        transactionCount: number;
        successCount: number;
        skippedCount: number;
        errorCount: number;
        totalIncome: number;
        totalExpenses: number;
        totalsByCurrency?: ImportCurrencyTotals[];
        duplicatesSkipped: number;
        errors?: ImportHistory['errors'];
        receiptsSkipped?: number;
        receiptsFailed?: number;
        transactionIds?: string[];
      } = {
        transactionCount: selectedTransactions.length,
        successCount,
        skippedCount: transactions.length - selectedTransactions.length,
        errorCount,
        totalIncome,
        totalExpenses,
        totalsByCurrency: sumByCurrency(written, baseCurrency),
        duplicatesSkipped: skippedDuplicates
      };

      if (errors.length > 0) {
        completeStats.errors = errors;
      }
      if (transactionIds.length > 0) {
        completeStats.transactionIds = transactionIds;
      }
      if (receiptsSkipped > 0) {
        completeStats.receiptsSkipped = receiptsSkipped;
      }
      if (receiptsFailed > 0) {
        completeStats.receiptsFailed = receiptsFailed;
      }

      await this.importHistoryService.completeImport(historyId, completeStats);

      // Everything the user confirmed is a decision about that merchant, so
      // the next import can reuse it instead of re-asking the model. Rows the
      // memory already answered are written back too — that is what advances
      // the confirmation count.
      await this.categoryMemory.rememberAll(
        selectedTransactions.map(t => ({
          description: t.description,
          categoryId: t.suggestedCategoryId,
        }))
      );

      // Which tags the user left on each merchant's rows, and which offered
      // ones they took off — so the next import answers from memory first.
      await this.tagMemory.rememberAll(
        selectedTransactions
          .filter(t => t.tags?.length || t.suggestedTags?.length)
          .map(t => {
            const kept = t.tags ?? [];
            return {
              description: t.description,
              kept,
              removed: (t.suggestedTags ?? []).filter(tag => !kept.includes(tag)),
            };
          })
      );

    } catch (error) {
      await this.importHistoryService.failImport(historyId, [{
        message: error instanceof Error ? error.message : 'Import failed'
      }]);
      throw error;
    } finally {
      // The row is a fact about a write in progress and outlives none. The
      // bar is zeroed where the write begins, in the same synchronous block
      // as the wizard's seal, so a second write in one session never paints
      // the previous one's full bar — and the bar is never seen emptying
      // while it is still on screen.
      this.processingRow.set(null);
    }

    // Read back the completed record. Deliberately outside the try above:
    // the rows are saved and the history says so, so a failing read must not
    // route through failImport and stamp a completed import as failed. The
    // old hand-rolled promise here had no reject and no teardown — a
    // permission-denied left the wizard spinning forever over a finished
    // import, and even success leaked the document listener for the session.
    try {
      return await firstValueFrom(
        this.importHistoryService.getImportById(historyId).pipe(
          filter((h): h is ImportHistory => h !== null),
          timeout(IMPORT_READBACK_TIMEOUT_MS)
        )
      );
    } catch (error) {
      console.error('[AIImport] Import saved; history read-back failed:', error);
      throw new Error(IMPORT_READBACK_FAILED);
    }
  }

  /**
   * The conversion a backup row is written with: the file's rate over the
   * amount being written now, never a figure computed when the file was
   * read, since the card can have edited, split or merged the row since and
   * `addTransaction` writes a snapshot verbatim. The product is the one
   * `addTransaction` stamps a live row with — the amount times the rate,
   * unrounded — so the stored figure differs from a live row's only in whose
   * rate it used.
   *
   * Nothing when the rate no longer describes this write: the card changed
   * the currency it converts from, or the file was stamped in a base currency
   * this account does not keep. The row then converts at today's rate, like
   * any row without a snapshot.
   */
  private fileRateSnapshot(
    fileRate: CategorizedImportTransaction['fileRate'],
    dto: Pick<CreateTransactionDTO, 'amount' | 'currency'>,
    baseCurrency: string
  ): TransactionSnapshot | undefined {
    if (!fileRate || dto.currency !== fileRate.currency || fileRate.baseCurrency !== baseCurrency) {
      return undefined;
    }
    return {
      exchangeRate: fileRate.exchangeRate,
      baseCurrency,
      amountInBaseCurrency: dto.amount * fileRate.exchangeRate,
    };
  }

  /**
   * Detect file type from file object
   */
  private detectFileType(file: File): ImportFileType {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type.toLowerCase();

    if (mimeType.startsWith('image/') || IMAGE_FILE_EXTENSIONS.includes(extension || '')) {
      return 'receipt_image';
    }

    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return 'bank_pdf';
    }

    if (mimeType === 'text/csv' || extension === 'csv') {
      return 'generic_csv';
    }

    if (mimeType === 'application/json' || extension === 'json') {
      return 'backup_json';
    }

    if (['xlsx', 'xls'].includes(extension || '')) {
      return 'spreadsheet';
    }

    return 'generic_csv'; // Default fallback
  }

  /**
   * Get import source from file type
   */
  private getSourceFromFileType(fileType: ImportFileType): ImportSource {
    switch (fileType) {
      case 'receipt_image':
      case 'screenshot':
        return 'image';
      case 'bank_pdf':
      case 'credit_card':
        return 'pdf';
      case 'backup_json':
        return 'json';
      default:
        return 'csv';
    }
  }

  /**
   * Convert file to base64 string
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Build import result object
   */
  private buildImportResult(
    file: File,
    source: ImportSource,
    fileType: ImportFileType,
    transactions: CategorizedImportTransaction[],
    duplicates: ReturnType<typeof this.duplicateService.checkDuplicates> extends Promise<infer T> ? T : never
  ): ImportResult {
    const warnings: ImportWarning[] = [];

    // Add warnings for duplicates
    const duplicateCount = duplicates.filter(d => d.isDuplicate).length;
    if (duplicateCount > 0) {
      warnings.push({
        type: 'duplicate',
        message: `${duplicateCount} potential duplicate transaction(s) detected`
      });
    }

    // Add warnings for low confidence categorizations
    const lowConfidenceCount = transactions.filter(t => t.categoryConfidence < 0.5).length;
    if (lowConfidenceCount > 0) {
      warnings.push({
        type: 'low_confidence',
        message: `${lowConfidenceCount} transaction(s) have low categorization confidence`
      });
    }

    // Calculate overall confidence
    const avgConfidence = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + t.categoryConfidence, 0) / transactions.length
      : 0;

    return {
      source,
      fileType,
      fileName: file.name,
      fileSize: file.size,
      transactions,
      confidence: avgConfidence,
      warnings,
      duplicates
    };
  }

  /**
   * Format item details into readable notes with one item per line, each showing its amount.
   */
  private formatItemNotes(details?: string): string | undefined {
    if (!details) return undefined;

    // Already has newlines — return as-is
    if (details.includes('\n')) return details;

    // Split comma-separated items and put each on its own line
    // Items may be "item name — amount" or just "item name amount" or "item name"
    return details.split(/,\s*/).join('\n');
  }

  /**
   * Give up on a request after `ms`, and cancel it.
   *
   * This used to race a promise against a timer with nothing on the losing
   * side: the UI reported a timeout while the upload and the download carried
   * on to completion in the background. On a metered or roaming connection
   * that is the user's money spent on a result nobody is waiting for any more,
   * which is why the work is handed a signal rather than a bare promise.
   */
  private async withTimeout<T>(
    work: (signal: AbortSignal) => Promise<T>,
    ms: number,
    timeoutMessage: string
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        work(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(timeoutMessage));
          }, ms);
        }),
      ]);
    } finally {
      // A page that imports several statement pages in a row would otherwise
      // hold one live timer per settled page.
      clearTimeout(timer);
    }
  }

  /**
   * Classify a raw AI failure. Kept as a method because the wizard calls it
   * through the injected service; the work is the pure util's.
   */
  parseAIError(error: unknown): AIErrorInfo {
    return parseAIError(error);
  }
}
