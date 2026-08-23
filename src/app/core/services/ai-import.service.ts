import { Injectable, inject, signal, computed } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { CategorizedTransaction, RawTransaction, ExtractedTransaction, MultiImageExtractedTransaction } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ExportService } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import { TransactionService, RECEIPT_IMAGE_LIMIT_ERROR } from './transaction.service';
import { BudgetService } from './budget.service';
import { AuthService } from './auth.service';
import { AIStrategyService, ProcessingResult, ReceiptAttemptDiagnostics } from './ai-strategy.service';
import { AnalyticsService } from './analytics.service';
import { IMAGE_FILE_EXTENSIONS } from '../utils/file.utils';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { consolidateReceiptItems } from '../utils/receipt-consolidation';
import { readCurrencyCode } from '../utils/receipt-extraction.utils';
import {
  AIErrorInfo,
  AI_NO_PROVIDER,
  AI_QUEUED_OFFLINE,
  parseAIError,
  ReceiptProcessingError,
} from '../utils/ai-error.utils';
import { nextImportRowId } from '../utils/import-row-id.utils';
import {
  FALLBACK_CATEGORY_ID,
  gradeCategorySuggestion,
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
import {
  ImportResult,
  ImportWarning,
  CategorizedImportTransaction,
  ImportHistory,
  ImportSource,
  ImportFileType,
  DuplicateCheck,
  RecurringTransaction,
  Transaction,
  TransactionLocation,
  isBudgetPeriod,
  CATEGORY_MEMORY_CONFIDENCE,
  baseCurrencyOf
} from '../../models';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';
import { resolveImportCurrency, toCreateTransactionDTO } from '../utils/import-dto.utils';
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

  // Processing state signals
  isProcessing = signal<boolean>(false);
  processingStatus = signal<string>('');
  processingProgress = signal<number>(0);
  
  // New signals for processing
  processingSource = signal<'cloud' | 'native' | null>(null);
  isOfflineMode = computed(() => !this.pwaService.isOnline());

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
   * Import transactions from an image (receipt, screenshot, bank statement)
   * Uses cloud AI or native OCR (iOS)
   */
  async importFromImage(file: File): Promise<ImportResult> {
    const startedAt = performance.now();
    const isOnline = this.pwaService.isOnline();
    const canUseCloud = this.strategyService.canUseCloud();
    const canUseNative = this.strategyService.canUseNative();

    // Check if we can process at all
    if (!canUseCloud && !canUseNative) {
      // Queue for later if offline
      if (!isOnline) {
        await this.offlineQueue.queueImage(file);
        throw new Error(AI_QUEUED_OFFLINE);
      }
      throw new Error(AI_NO_PROVIDER);
    }

    this.isProcessing.set(true);
    this.processingStatus.set('Reading image...');
    this.processingProgress.set(10);
    this.processingSource.set(null);

    try {
      const history = await this.groundingHistory.recent();

      // Try using strategy service
      try {
        this.processingStatus.set('Processing with AI...');
        this.processingProgress.set(30);

        const strategyResult = await this.strategyService.processReceipt(file);
        this.processingSource.set(strategyResult.source);

        if (strategyResult.transactions.length > 0) {
          this.processingStatus.set('Categorizing transactions...');
          this.processingProgress.set(60);

          const categorized = this.convertStrategyResultToCategories(strategyResult);
          const suggested = await this.suggestTagsFor(categorized, history);
          const offered = await this.attachRecurringMatches(suggested);

          this.processingStatus.set('Checking for duplicates...');
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

      this.processingStatus.set('Extracting transactions with cloud AI...');
      this.processingProgress.set(30);
      this.processingSource.set('cloud');

      const extractedTransactions = await this.withTimeout(
        signal => this.cloudLLMProvider.extractTransactionsFromImage(imageBase64, { signal }),
        60000, // 60 second timeout
        'AI extraction timed out. Please try again.'
      );

      this.processingStatus.set('Categorizing transactions...');
      this.processingProgress.set(60);

      const categorized = await this.categorizeTransactions(extractedTransactions);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      const result = this.buildImportResult(file, 'image', 'receipt_image', markedTransactions, duplicates);
      result.diagnostics = this.cloudDiagnostics(startedAt);

      return result;
    } finally {
      this.isProcessing.set(false);
      this.processingSource.set(null);
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

    const startedAt = performance.now();
    this.isProcessing.set(true);
    this.processingStatus.set('Reading statement...');
    this.processingProgress.set(10);
    this.processingSource.set('cloud');

    try {
      const history = await this.groundingHistory.recent();
      const extracted: ExtractedTransaction[] = [];
      for (let i = 0; i < files.length; i++) {
        this.processingProgress.set(10 + Math.round((i / files.length) * 50));
        const imageBase64 = await this.fileToBase64(files[i]);
        extracted.push(
          ...(await this.withTimeout(
            signal => this.cloudLLMProvider.extractStatementTransactions(imageBase64, { signal }),
            60000,
            'AI extraction timed out. Please try again.'
          ))
        );
      }

      this.processingStatus.set('Categorizing transactions...');
      this.processingProgress.set(60);
      const categorized = await this.categorizeTransactions(extracted);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStatus.set('Checking for duplicates...');
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
      result.diagnostics = this.cloudDiagnostics(startedAt);
      return result;
    } catch (error) {
      throw this.asReceiptProcessingError(error, startedAt);
    } finally {
      this.isProcessing.set(false);
      this.processingSource.set(null);
    }
  }

  /**
   * Convert strategy service result to categorized import transactions
   */
  private convertStrategyResultToCategories(result: ProcessingResult): CategorizedImportTransaction[] {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    return result.transactions.map(tx => ({
      id: nextImportRowId('strategy'),
      description: tx.description,
      amount: tx.amount,
      ...resolveImportCurrency(tx.currencyFellBack ? '' : tx.currency, baseCurrency),
      date: tx.date,
      type: tx.type,
      ...gradeCategorySuggestion(tx),
      isDuplicate: false,
      selected: true,
      notes: tx.notes,
      fieldConfidence: tx.fieldConfidence,
      ...(tx.tags?.length ? { tags: tx.tags } : {}),
      ...(tx.location ? { location: tx.location } : {}),
      ...(tx.period ? { period: tx.period } : {}),
      ...(tx.isRecurring !== undefined ? { isRecurring: tx.isRecurring } : {})
    }));
  }

  /**
   * Diagnostics for the paths that call a cloud provider directly rather
   * than through the strategy service. Always cloud, provider as routed,
   * timed from the moment the door was entered.
   */
  private cloudDiagnostics(startedAt: number, error?: unknown): ReceiptAttemptDiagnostics {
    const base: ReceiptAttemptDiagnostics = {
      engine: 'cloud',
      provider: this.strategyService.receiptProvider(),
      durationMs: performance.now() - startedAt,
    };
    if (error === undefined) {
      return base;
    }
    const parsed = parseAIError(error);
    return { ...base, errorType: parsed.type, retryable: parsed.retryable };
  }

  /** Wrap a direct-provider throw so the door can read what was learned. */
  private asReceiptProcessingError(error: unknown, startedAt: number): ReceiptProcessingError {
    return error instanceof ReceiptProcessingError
      ? error
      : new ReceiptProcessingError(this.cloudDiagnostics(startedAt, error), error);
  }

  /**
   * Import transactions from one or more receipt photos.
   * Images should be ordered top-to-bottom as they appear on the receipt.
   * Every count goes through receiptId-aware extraction + consolidation, so
   * a single photo holding several receipts still yields one transaction
   * per receipt (importFromImage has no receipt grouping).
   */
  async importFromMultipleImages(files: File[]): Promise<ImportResult> {
    if (files.length === 0) {
      throw new Error('No image files provided');
    }

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
    this.processingStatus.set('Reading images...');
    this.processingProgress.set(5);

    try {
      const history = await this.groundingHistory.recent();

      // Convert all files to base64
      const imageBase64Array: string[] = [];
      for (let i = 0; i < files.length; i++) {
        this.processingStatus.set(`Reading image ${i + 1} of ${files.length}...`);
        this.processingProgress.set(5 + Math.round((i / files.length) * 20));
        const base64 = await this.fileToBase64(files[i]);
        // Extract just the base64 data part
        imageBase64Array.push(base64);
      }

      this.processingStatus.set('Extracting items from all images with AI...');
      this.processingProgress.set(30);

      // Use multi-image extraction with position-aware deduplication
      const extractedTransactions = await this.withTimeout(
        signal =>
          this.cloudLLMProvider.extractTransactionsFromMultipleImages(imageBase64Array, { signal }),
        90000, // 90 second timeout for multiple images
        'AI extraction timed out. Please try again with fewer images.'
      );

      this.processingStatus.set('Categorizing transactions...');
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

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      const result = this.buildMultiImageImportResult(
        files,
        markedTransactions,
        duplicates,
        extractedTransactions
      );
      result.diagnostics = this.cloudDiagnostics(startedAt);
      return result;
    } catch (error) {
      throw this.asReceiptProcessingError(error, startedAt);
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * The categorization ladder shared by the multi-image and CSV paths:
   * anything the user already corrected is answered from category memory
   * (CATEGORY_MEMORY_CONFIDENCE), the rest goes to the provider in one
   * grounded batch call when one is configured, and whatever no one could
   * answer keeps the seeded floor — other_expense at 0.1, low enough that
   * the review step flags it. One entry per input row, in input order.
   */
  private async categorizeWithLadder(
    rawTransactions: RawTransaction[],
    history: Transaction[]
  ): Promise<CategorizedTransaction[]> {
    // Anything the user has already corrected is settled — only the rest is
    // worth a model call.
    await this.categoryMemory.ensureLoaded();
    const remembered = rawTransactions.map(t => this.categoryMemory.lookup(t.description));

    const categorized: CategorizedTransaction[] = rawTransactions.map((t) => ({
      ...t,
      suggestedCategoryId: FALLBACK_CATEGORY_ID,
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
   */
  private async categorizeMultiImageTransactions(
    transactions: MultiImageExtractedTransaction[],
    history: Transaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (transactions.length === 0) return [];

    // Get user's base currency from settings
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    // Convert to RawTransaction format for categorization
    const rawTransactions: RawTransaction[] = transactions.map(t => ({
      description: t.description,
      amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
      date: parseDateInput(t.date) ?? new Date()
    }));

    const categorizedByAI = await this.categorizeWithLadder(rawTransactions, history);

    // Convert to CategorizedImportTransaction with image metadata
    return categorizedByAI.map((t, index) => {
      const original = transactions[index];
      return {
        id: nextImportRowId('multi_img'),
        description: t.description,
        amount: Math.abs(t.amount),
        ...resolveImportCurrency(original.currency, baseCurrency),
        date: t.date,
        type: original.type,
        suggestedCategoryId: original.category || t.suggestedCategoryId,
        categoryConfidence: t.confidence,
        notes: this.formatItemNotes(original.details),
        fieldConfidence: original.amountConfidence !== undefined
          ? { amount: original.amountConfidence }
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
        ...(original.period ? { period: original.period } : {}),
        ...(original.isRecurring !== undefined ? { isRecurring: original.isRecurring } : {})
      };
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
    extractedTransactions: MultiImageExtractedTransaction[]
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

    // Count merged items
    const mergedCount = extractedTransactions.filter(t => t.wasMerged).length;

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
        itemsMerged: mergedCount,
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
    this.processingStatus.set('Reading PDF...');
    this.processingProgress.set(10);
    this.processingSource.set('cloud');

    try {
      const history = await this.groundingHistory.recent();
      const { pages, totalPages, truncated } = await this.rasterizePdf(await file.arrayBuffer());

      if (pages.length === 0) {
        throw new Error('No pages could be read from this PDF.');
      }

      this.processingStatus.set('Extracting transactions with AI...');
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

      this.processingStatus.set('Categorizing transactions...');
      this.processingProgress.set(60);
      const categorized = await this.categorizeTransactions(extracted);
      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStatus.set('Checking for duplicates...');
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
      this.isProcessing.set(false);
      this.processingSource.set(null);
    }
  }

  /**
   * Import transactions from a CSV file with smart column detection
   */
  async importFromCSV(file: File): Promise<ImportResult> {
    this.isProcessing.set(true);
    this.processingStatus.set('Reading CSV...');
    this.processingProgress.set(10);

    try {
      const history = await this.groundingHistory.recent();

      // Use existing CSV parser from export service
      const importedTransactions = await this.exportService.importFromCSV(file);

      this.processingStatus.set('Converting transactions...');
      this.processingProgress.set(30);

      this.processingStatus.set('Categorizing transactions...');
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

      // The same ladder the image paths climb: category memory first, then a
      // grounded model call when a provider is configured, then the
      // review-flagged floor. A CSV row never carries an extraction category
      // — the Category column deliberately does not round-trip (ADR 0011) —
      // so the overlay cannot fight the mapper's suggestion.
      const rawRows: RawTransaction[] = extractedTransactions.map(t => ({
        description: t.description,
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: parseDateInput(t.date) ?? new Date()
      }));
      const laddered = await this.categorizeWithLadder(rawRows, history);
      laddered.forEach((row, index) => {
        categorized[index].suggestedCategoryId = row.suggestedCategoryId;
        categorized[index].categoryConfidence = row.confidence;
      });

      const suggested = await this.suggestTagsFor(categorized, history);
      const offered = await this.attachRecurringMatches(suggested);

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(offered);
      const markedTransactions = this.duplicateService.markDuplicates(offered, duplicates);

      this.processingProgress.set(100);

      return this.buildImportResult(file, 'csv', 'generic_csv', markedTransactions, duplicates);
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Import transactions from a JSON backup file
   */
  async importFromJSON(file: File): Promise<ImportResult> {
    this.isProcessing.set(true);
    this.processingStatus.set('Reading JSON...');
    this.processingProgress.set(20);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.transactions || !Array.isArray(data.transactions)) {
        throw new Error('Invalid backup format: missing transactions array');
      }

      this.processingStatus.set('Processing transactions...');
      this.processingProgress.set(50);

      const baseCurrency = baseCurrencyOf(this.authService.currentUser());
      const categorized: CategorizedImportTransaction[] = data.transactions.map(
        (t: Record<string, unknown>) => ({
          id: nextImportRowId('json'),
          description: t['description'] as string || 'Unknown',
          amount: Math.abs(t['amount'] as number || 0),
          ...resolveImportCurrency(readCurrencyCode(t['currency']), baseCurrency),
          date: t['date']
            ? new Date((t['date'] as { seconds: number }).seconds * 1000)
            : new Date(),
          type: (t['type'] as 'income' | 'expense') || 'expense',
          suggestedCategoryId: (t['categoryId'] as string) || 'other_expense',
          categoryConfidence: 1.0, // From backup, category is known
          isDuplicate: false,
          selected: true,
          // A backup row carries what its transaction held; anything absent
          // or malformed stays absent rather than being defaulted.
          ...(t['note'] ? { notes: t['note'] as string } : {}),
          ...(Array.isArray(t['tags']) && t['tags'].length ? { tags: t['tags'] as string[] } : {}),
          ...((t['location'] as TransactionLocation | undefined)?.name
            ? { location: t['location'] as TransactionLocation }
            : {}),
          ...(isBudgetPeriod(t['period']) ? { period: t['period'] } : {}),
          ...(typeof t['isRecurring'] === 'boolean' ? { isRecurring: t['isRecurring'] } : {})
        })
      );

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);

      return this.buildImportResult(file, 'json', 'backup_json', markedTransactions, duplicates);
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Categorize extracted transactions
   */
  async categorizeTransactions(
    transactions: ExtractedTransaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (transactions.length === 0) return [];

    // Get user's base currency from settings
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());

    // Convert ExtractedTransaction to CategorizedImportTransaction
    // If transaction already has a category from extraction, use it; otherwise suggest 'other_expense'
    return transactions.map(t => {
      const suggestedCategoryId = t.category || 'other_expense';

      // A date the model wrote in a shape parseDateInput rejects ("31/12/2024",
      // "2024-06-31") defaults to today — but flagged, not silently: zero
      // confidence puts the preview table's needs-verify chip on the row so
      // the user can catch it before it is filed under the wrong day.
      const parsedDate = parseDateInput(t.date);
      const dateConfidence = parsedDate === null ? 0 : t.dateConfidence;

      return {
        id: nextImportRowId('import'),
        description: t.description,
        amount: Math.abs(t.amount),
        ...resolveImportCurrency(t.currency, baseCurrency),
        date: parsedDate ?? new Date(),
        type: t.type || 'expense',
        suggestedCategoryId: suggestedCategoryId,
        // The grade follows the evidence, on the applyCategorizations scale
        // (categorization.utils.ts): 0.8 when extraction actually named a
        // category, the review grade when nothing usable answered — under the
        // 0.5 review band, so a defaulted row is flagged instead of wearing
        // the high chip it never earned. (ADR 0045)
        categoryConfidence: t.category ? 0.8 : UNRESOLVED_CATEGORY_CONFIDENCE,
        originalText: `${t.merchant ? t.merchant + ' - ' : ''}${t.description}${t.details ? ' (' + t.details + ')' : ''}`,
        // A row that carries its own note (a CSV's Note column) keeps it
        // verbatim; formatItemNotes is for receipt item lists and splits
        // plain commas into newlines.
        notes: t.note ?? this.formatItemNotes(t.details),
        fieldConfidence: (t.amountConfidence !== undefined || dateConfidence !== undefined)
          ? { amount: t.amountConfidence, date: dateConfidence }
          : undefined,
        isDuplicate: false,
        selected: true,
        ...(t.merchant ? { merchant: t.merchant } : {}),
        ...(t.tags?.length ? { tags: t.tags } : {}),
        ...(t.location ? { location: t.location } : {}),
        ...(t.period ? { period: t.period } : {}),
        ...(t.isRecurring !== undefined ? { isRecurring: t.isRecurring } : {})
      };
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
    sourceFiles?: File[]
  ): Promise<ImportHistory> {
    this.isProcessing.set(true);
    this.processingStatus.set('Saving transactions...');
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
      fileType
    );

    let successCount = 0;
    let errorCount = 0;
    let receiptsSkipped = 0;
    let totalIncome = 0;
    let totalExpenses = 0;
    const errors: ImportHistory['errors'] = [];

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
        this.processingStatus.set(`Importing ${i + 1} of ${selectedTransactions.length}...`);

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

          try {
            await this.transactionService.addTransaction(dto, { skipBudgetRecalc: true });
          } catch (error) {
            // A quota refusal is about the images, not the row, and it fires
            // before any id, upload or write exists — so the transaction is
            // still worth saving bare, and the skip is reported as its own
            // figure. An upload failure (RECEIPT_ATTACH_FAILED) stays a
            // failed row: retrying photo-less there would silently drop
            // photos on a flaky network.
            const message = error instanceof Error ? error.message : '';
            if (attachedFiles.length && message === RECEIPT_IMAGE_LIMIT_ERROR) {
              await this.transactionService.addTransaction(bareDto, { skipBudgetRecalc: true });
              receiptsSkipped++;
            } else {
              throw error;
            }
          }
          successCount++;

          if (txn.type === 'income') {
            totalIncome += txn.amount;
          } else {
            totalExpenses += txn.amount;
            affectedExpenseCategories.add(dto.categoryId);
          }
        } catch (error) {
          errorCount++;
          errors.push({
            row: i + 1,
            message: error instanceof Error ? error.message : 'Unknown error',
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
        duplicatesSkipped: number;
        errors?: ImportHistory['errors'];
        receiptsSkipped?: number;
      } = {
        transactionCount: selectedTransactions.length,
        successCount,
        skippedCount: transactions.length - selectedTransactions.length,
        errorCount,
        totalIncome,
        totalExpenses,
        duplicatesSkipped: skippedDuplicates
      };

      if (errors.length > 0) {
        completeStats.errors = errors;
      }
      if (receiptsSkipped > 0) {
        completeStats.receiptsSkipped = receiptsSkipped;
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
      this.isProcessing.set(false);
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
