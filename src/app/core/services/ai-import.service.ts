import { Injectable, inject, signal, computed } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { RawTransaction, ExtractedTransaction, MultiImageExtractedTransaction } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ExportService } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import { TransactionService } from './transaction.service';
import { BudgetService } from './budget.service';
import { AuthService } from './auth.service';
import { AIStrategyService, AI_CLOUD_UNAVAILABLE, ProcessingResult } from './ai-strategy.service';
import { AnalyticsService } from './analytics.service';
import { IMAGE_FILE_EXTENSIONS } from '../utils/file.utils';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { consolidateReceiptItems } from '../utils/receipt-consolidation';
import { readCurrencyCode } from '../utils/receipt-extraction.utils';
import { nextImportRowId } from '../utils/import-row-id.utils';
import { RasterizedPdf, rasterizePdf } from '../utils/pdf-raster.utils';
import { CategoryMemoryService } from './category-memory.service';
import { RagContextService } from './rag-context.service';
import {
  ImportResult,
  ImportWarning,
  CategorizedImportTransaction,
  ImportHistory,
  ImportSource,
  ImportFileType,
  CreateTransactionDTO,
  DuplicateCheck,
  CATEGORY_MEMORY_CONFIDENCE,
  effectiveRagLevel,
  baseCurrencyOf
} from '../../models';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';

/**
 * How far back the categorization grounding looks. Habits change, so a recent
 * window describes how the user files things now rather than how they once did.
 */
const CATEGORIZATION_HISTORY_MONTHS = 6;

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

export interface AIErrorInfo {
  /** English, for logs and for the cases only a provider can describe. */
  message: string;
  /** Present when the app raised this itself and the screen can translate it. */
  messageKey?: string;
  type: 'rate_limit' | 'auth' | 'network' | 'quota' | 'server' | 'timeout' | 'unknown';
  retryable: boolean;
}

/**
 * Thrown when no AI provider is configured at all.
 *
 * A code rather than a sentence, so the screen can say it in the user's
 * language. parseAIError used to recognize these throws by substring-matching
 * English prose, which meant rewording one silently reclassified it as an
 * unknown failure.
 */
export const AI_NO_PROVIDER = 'AI_NO_PROVIDER';

/** Thrown when an image was queued instead of processed, having no connection. */
export const AI_QUEUED_OFFLINE = 'AI_QUEUED_OFFLINE';

@Injectable({ providedIn: 'root' })
export class AIImportService {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private categoryMemory = inject(CategoryMemoryService);
  private ragContext = inject(RagContextService);
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

          this.processingStatus.set('Checking for duplicates...');
          this.processingProgress.set(80);

          const duplicates = await this.duplicateService.checkDuplicates(categorized);
          const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

          this.processingProgress.set(100);

          const result = this.buildImportResult(file, 'image', 'receipt_image', markedTransactions, duplicates);
          result.processingSource = strategyResult.source;
          
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

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);

      const result = this.buildImportResult(file, 'image', 'receipt_image', markedTransactions, duplicates);
      result.processingSource = 'cloud';
      
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

    this.isProcessing.set(true);
    this.processingStatus.set('Reading statement...');
    this.processingProgress.set(10);
    this.processingSource.set('cloud');

    try {
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

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);
      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const marked = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);
      this.analytics.trackAiAssistUsed({ feature: 'receipt_scan' });

      const result = this.buildImportResult(
        files[0], 'image', 'receipt_image', marked, duplicates
      );
      result.processingSource = 'cloud';
      return result;
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
      currency: tx.currency || baseCurrency,
      date: tx.date,
      type: tx.type,
      suggestedCategoryId: tx.suggestedCategoryId || 'other_expense',
      categoryConfidence: tx.confidence,
      isDuplicate: false,
      selected: true,
      processingSource: tx.source,
      notes: tx.notes,
      fieldConfidence: tx.fieldConfidence,
    }));
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

    // After the availability guard, so a request that was never issued is not
    // counted. Tagged here rather than in AIStrategyService because the import
    // wizard reaches this method directly, and because the strategy service is
    // also driven by the offline queue replaying work nobody just asked for.
    this.analytics.trackAiAssistUsed({ feature: 'receipt_scan' });

    this.isProcessing.set(true);
    this.processingStatus.set('Reading images...');
    this.processingProgress.set(5);

    try {
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
      const categorized = await this.categorizeMultiImageTransactions(consolidated);

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);

      // Build result with multi-image metadata
      return this.buildMultiImageImportResult(
        files,
        markedTransactions,
        duplicates,
        extractedTransactions
      );
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Categorize multi-image extracted transactions, preserving image metadata.
   */
  private async categorizeMultiImageTransactions(
    transactions: MultiImageExtractedTransaction[]
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

    // Anything the user has already corrected is settled — only the rest is
    // worth a model call.
    await this.categoryMemory.ensureLoaded();
    const remembered = rawTransactions.map(t => this.categoryMemory.lookup(t.description));

    let categorizedByAI = rawTransactions.map((t) => ({
      ...t,
      suggestedCategoryId: 'other_expense',
      confidence: 0.1
    }));

    const unknownIndexes = remembered
      .map((categoryId, index) => (categoryId ? -1 : index))
      .filter(index => index >= 0);

    if (unknownIndexes.length > 0 && this.cloudLLMProvider.hasAnyCloudProvider()) {
      try {
        const asked = await this.cloudLLMProvider.categorizeTransactions(
          unknownIndexes.map(index => rawTransactions[index]),
          await this.buildCategorizationGrounding()
        );
        // The provider indexes its answers against what it was sent, so map
        // them back onto the original positions.
        asked.forEach((result, position) => {
          categorizedByAI[unknownIndexes[position]] = result;
        });
      } catch (error) {
        console.warn('AI categorization failed, using defaults:', error);
      }
    }

    categorizedByAI = categorizedByAI.map((t, index) =>
      remembered[index]
        ? { ...t, suggestedCategoryId: remembered[index], confidence: CATEGORY_MEMORY_CONFIDENCE }
        : t
    );

    // Convert to CategorizedImportTransaction with image metadata
    return categorizedByAI.map((t, index) => {
      const original = transactions[index];
      return {
        id: nextImportRowId('multi_img'),
        description: t.description,
        amount: Math.abs(t.amount),
        currency: original.currency || baseCurrency,
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
        }
      };
    });
  }

  /**
   * How this user has categorized things before, for grounding the model's
   * suggestions in their habits rather than in what a merchant generally sells.
   *
   * Gated on the same `ragInsightsLevel` preference as the insights grounding:
   * off means the prompt is byte-identical to its ungrounded form, and no
   * transaction history leaves the device. Failing to build it is not worth
   * failing an import over — the model just answers unaided, as it did before.
   */
  private async buildCategorizationGrounding(): Promise<string | undefined> {
    const level = effectiveRagLevel(this.authService.currentUser()?.preferences);
    if (level === 'off') {
      return undefined;
    }

    try {
      // A recent window rather than everything: habits change, and the point
      // is to describe how this user files things now.
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - CATEGORIZATION_HISTORY_MONTHS);

      const history = await firstValueFrom(
        this.transactionService.getTransactions({ startDate })
      );
      const grounding = this.ragContext.buildCategorizationGrounding({ transactions: history });
      return grounding || undefined;
    } catch (error) {
      console.warn('[AIImport] Could not build categorization grounding:', error);
      return undefined;
    }
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

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

      this.processingProgress.set(100);

      const result = this.buildImportResult(file, 'pdf', 'bank_pdf', markedTransactions, duplicates);
      if (truncated) {
        result.warnings.push({
          type: 'info',
          message: `Only the first ${pages.length} of ${totalPages} pages were read.`,
        });
      }
      result.processingSource = 'cloud';
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
      // Use existing CSV parser from export service
      const importedTransactions = await this.exportService.importFromCSV(file);

      this.processingStatus.set('Converting transactions...');
      this.processingProgress.set(30);

      this.processingStatus.set('Categorizing with AI...');
      this.processingProgress.set(50);

      // Convert to ExtractedTransaction format. Mapped straight off the parsed
      // rows rather than through RawTransaction, which has no currency field —
      // routing through it meant the row's own currency was dropped and
      // replaced with a hardcoded one, pre-empting the base-currency fallback
      // that categorizeTransactions already applies.
      const extractedTransactions: ExtractedTransaction[] = importedTransactions.map(t => ({
        date: dayKey(t.date ?? new Date()),
        description: t.description,
        amount: Math.abs(t.amount),
        type: t.amount >= 0 ? 'income' : 'expense',
        currency: readCurrencyCode(t.currency)
      }));

      const categorized = await this.categorizeTransactions(extractedTransactions);

      this.processingStatus.set('Checking for duplicates...');
      this.processingProgress.set(80);

      const duplicates = await this.duplicateService.checkDuplicates(categorized);
      const markedTransactions = this.duplicateService.markDuplicates(categorized, duplicates);

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
          currency: readCurrencyCode(t['currency']) || baseCurrency,
          date: t['date']
            ? new Date((t['date'] as { seconds: number }).seconds * 1000)
            : new Date(),
          type: (t['type'] as 'income' | 'expense') || 'expense',
          suggestedCategoryId: (t['categoryId'] as string) || 'other_expense',
          categoryConfidence: 1.0, // From backup, category is known
          isDuplicate: false,
          selected: true
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
        currency: t.currency || baseCurrency,
        date: parsedDate ?? new Date(),
        type: t.type || 'expense',
        suggestedCategoryId: suggestedCategoryId,
        // The grade follows the evidence, on the applyCategorizations scale
        // (categorization.utils.ts): 0.8 when extraction actually named a
        // category, 0.3 when nothing usable answered — under the 0.5 review
        // band, so a defaulted row is flagged instead of wearing the high
        // chip it never earned. (ADR 0045)
        categoryConfidence: t.category ? 0.8 : 0.3,
        originalText: `${t.merchant ? t.merchant + ' - ' : ''}${t.description}${t.details ? ' (' + t.details + ')' : ''}`,
        notes: this.formatItemNotes(t.details),
        fieldConfidence: (t.amountConfidence !== undefined || dateConfidence !== undefined)
          ? { amount: t.amountConfidence, date: dateConfidence }
          : undefined,
        isDuplicate: false,
        selected: true
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
    fileType: ImportFileType
  ): Promise<ImportHistory> {
    this.isProcessing.set(true);
    this.processingStatus.set('Saving transactions...');
    this.processingProgress.set(0);

    const selectedTransactions = transactions.filter(t => t.selected);
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

          const dto: CreateTransactionDTO = {
            type: txn.type,
            amount: txn.amount,
            currency: txn.currency || baseCurrency,
            categoryId: txn.suggestedCategoryId || 'other_expense',
            description: txn.description || 'Imported transaction',
            date: transactionDate,
            note: txn.notes
          };

          await this.transactionService.addTransaction(dto, { skipBudgetRecalc: true });
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
   * Parse raw AI API errors into user-friendly messages with error type classification.
   */
  parseAIError(error: unknown): AIErrorInfo {
    const raw = error instanceof Error ? error.message : String(error);
    const lower = raw.toLowerCase();

    // Rate limit (429)
    if (lower.includes('429') || lower.includes('rate limit') || lower.includes('resource_exhausted') || lower.includes('too many requests') || lower.includes('quota exceeded')) {
      return {
        message: 'AI rate limit reached. Please wait a moment and try again.',
        type: 'rate_limit',
        retryable: true
      };
    }

    // Authentication / invalid API key (401, 403)
    if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid api key') || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
      return {
        message: 'AI API key is invalid or expired.',
        messageKey: 'import.errorInvalidKey',
        type: 'auth',
        retryable: false
      };
    }

    // Network / connection errors
    if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('net::') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('cors') || lower.includes('dns')) {
      return {
        message: 'Network error. Please check your internet connection and try again.',
        type: 'network',
        retryable: true
      };
    }

    // Quota / billing (402)
    if (lower.includes('402') || lower.includes('billing') || lower.includes('insufficient_quota') || lower.includes('payment required') || lower.includes('credit')) {
      return {
        message: 'AI service quota exceeded or billing issue. Please check your API account.',
        type: 'quota',
        retryable: false
      };
    }

    // Server errors (500, 502, 503)
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal server error') || lower.includes('service unavailable') || lower.includes('bad gateway') || lower.includes('overloaded')) {
      return {
        message: 'AI service is temporarily unavailable. Please try again shortly.',
        type: 'server',
        retryable: true
      };
    }

    // Timeout, including the cancellation our own timeout fires. Every SDK
    // surfaces that as an abort ('Request was aborted', 'Request aborted when
    // fetching …') rather than as anything time-shaped, so it used to reach
    // the user as 'AI processing failed: Request was aborted' — the one
    // wording that says nothing about the ninety seconds they just waited.
    const aborted = error instanceof Error && error.name === 'AbortError';
    if (aborted || lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort') || lower.includes('deadline_exceeded')) {
      return {
        message: 'AI processing timed out. Try with a clearer image or fewer files.',
        type: 'timeout',
        retryable: true
      };
    }

    // Our own throws carry a code, not prose, so they are matched exactly and
    // handed to the screen as a key rather than as English.
    if (raw === AI_NO_PROVIDER) {
      return {
        message: 'No AI provider is configured.',
        messageKey: 'import.errorNoProvider',
        type: 'auth',
        retryable: false
      };
    }
    if (raw === AI_CLOUD_UNAVAILABLE) {
      return {
        message: 'Cloud AI is not reachable.',
        messageKey: 'import.errorCloudUnavailable',
        type: 'network',
        retryable: true
      };
    }
    if (raw === AI_QUEUED_OFFLINE) {
      return {
        message: 'Image queued for processing when back online.',
        messageKey: 'import.errorQueuedOffline',
        type: 'network',
        retryable: false
      };
    }

    // Unknown
    return {
      message: `AI processing failed: ${raw}`,
      type: 'unknown',
      retryable: true
    };
  }
}
