import { Injectable, inject, signal, computed } from '@angular/core';
import { GeminiService, RawTransaction, MultiImageExtractedTransaction } from './gemini.service';
import { ExportService, ImportedTransaction } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { AIStrategyService, ProcessingResult } from './ai-strategy.service';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import {
  ImportResult,
  ImportWarning,
  CategorizedImportTransaction,
  ImportHistory,
  ImportSource,
  ImportFileType,
  CreateTransactionDTO,
  DuplicateCheck
} from '../../models';

@Injectable({ providedIn: 'root' })
export class AIImportService {
  private geminiService = inject(GeminiService);
  private exportService = inject(ExportService);
  private duplicateService = inject(DuplicateDetectionService);
  private importHistoryService = inject(ImportHistoryService);
  private transactionService = inject(TransactionService);
  private authService = inject(AuthService);
  private strategyService = inject(AIStrategyService);
  private offlineQueue = inject(OfflineQueueService);
  private pwaService = inject(PwaService);

  // Processing state signals
  isProcessing = signal<boolean>(false);
  processingStatus = signal<string>('');
  processingProgress = signal<number>(0);
  
  // New signals for hybrid processing
  processingSource = signal<'local' | 'cloud' | 'hybrid' | null>(null);
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
   * Uses hybrid AI strategy: local processing with cloud fallback
   */
  async importFromImage(file: File): Promise<ImportResult> {
    const prefs = this.strategyService.preferences();
    const isOnline = this.pwaService.isOnline();
    const canUseLocal = this.strategyService.canUseLocal();
    const canUseCloud = this.strategyService.canUseCloud();

    // Check if we can process at all
    if (!canUseLocal && !canUseCloud) {
      // Queue for later if we can't process now
      if (!isOnline) {
        await this.offlineQueue.queueImage(file);
        throw new Error('Offline and local AI not available. Image queued for later processing.');
      }
      throw new Error('AI service is not available. Please configure your Gemini API key in Settings or download local models.');
    }

    this.isProcessing.set(true);
    this.processingStatus.set('Reading image...');
    this.processingProgress.set(10);
    this.processingSource.set(null);

    try {
      // Try using strategy service for hybrid processing
      if (prefs.mode !== 'cloud_only' && (canUseLocal || !isOnline)) {
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
            
            // Add processing source to result
            result.processingSource = strategyResult.source;
            result.usedFallback = strategyResult.usedFallback;
            
            return result;
          }
        } catch (strategyError) {
          console.warn('[AIImport] Strategy processing failed:', strategyError);
          // Fall through to legacy processing
        }
      }

      // Fall back to legacy Gemini-only processing
      if (!this.geminiService.isAvailable()) {
        throw new Error('AI service is not available. Please configure your Gemini API key in Settings.');
      }

      const imageBase64 = await this.fileToBase64(file);

      this.processingStatus.set('Extracting transactions with cloud AI...');
      this.processingProgress.set(30);
      this.processingSource.set('cloud');

      const extractedTransactions = await this.withTimeout(
        this.geminiService.extractTransactionsFromImage(imageBase64),
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
   * Convert strategy service result to categorized import transactions
   */
  private convertStrategyResultToCategories(result: ProcessingResult): CategorizedImportTransaction[] {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';

    return result.transactions.map((tx, index) => ({
      id: `strategy_${index}_${Date.now()}`,
      description: tx.description,
      amount: tx.amount,
      currency: tx.currency || baseCurrency,
      date: tx.date,
      type: tx.type,
      suggestedCategoryId: 'other_expense', // Will be categorized by Gemini if needed
      categoryConfidence: tx.confidence,
      isDuplicate: false,
      selected: true,
      processingSource: tx.source,
    }));
  }

  /**
   * Import transactions from multiple images of a single receipt.
   * Images should be ordered top-to-bottom as they appear on the receipt.
   * Uses AI-powered position-aware deduplication to handle overlapping photos.
   */
  async importFromMultipleImages(files: File[]): Promise<ImportResult> {
    if (files.length === 0) {
      throw new Error('No image files provided');
    }

    // If only one file, use regular single-image import
    if (files.length === 1) {
      return this.importFromImage(files[0]);
    }

    if (!this.geminiService.isAvailable()) {
      throw new Error('AI service is not available. Please configure your Gemini API key in Settings.');
    }

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
        this.geminiService.extractTransactionsFromMultipleImages(imageBase64Array),
        90000, // 90 second timeout for multiple images
        'AI extraction timed out. Please try again with fewer images.'
      );

      this.processingStatus.set('Categorizing transactions...');
      this.processingProgress.set(60);

      // Convert to CategorizedImportTransaction format with image metadata
      const categorized = await this.categorizeMultiImageTransactions(extractedTransactions);

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
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';

    // Convert to RawTransaction format for categorization
    const rawTransactions: RawTransaction[] = transactions.map(t => ({
      description: t.description,
      amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
      date: new Date(t.date)
    }));

    // Use Gemini for categorization if available
    let categorizedByAI = rawTransactions.map((t) => ({
      ...t,
      suggestedCategoryId: 'other_expense',
      confidence: 0.1
    }));

    if (this.geminiService.isAvailable()) {
      try {
        categorizedByAI = await this.geminiService.categorizeTransactions(rawTransactions);
      } catch (error) {
        console.warn('AI categorization failed, using defaults:', error);
      }
    }

    // Convert to CategorizedImportTransaction with image metadata
    return categorizedByAI.map((t, index) => {
      const original = transactions[index];
      return {
        id: `multi_img_${index}_${Date.now()}`,
        description: t.description,
        amount: Math.abs(t.amount),
        currency: original.currency || baseCurrency,
        date: t.date,
        type: original.type,
        suggestedCategoryId: t.suggestedCategoryId,
        categoryConfidence: t.confidence,
        isDuplicate: false,
        selected: true,
        imageMetadata: {
          imageIndex: original.imageIndex,
          imageId: `image_${original.imageIndex}`,
          positionInImage: original.positionInImage,
          confidenceScore: original.confidence,
          wasMerged: original.wasMerged,
          mergedFromImages: original.mergedFromImages
        },
        taxMetadata: original.taxInfo ? {
          taxRate: original.taxInfo.taxRate,
          taxAmount: original.taxInfo.taxAmount,
          taxCategory: original.taxInfo.taxCategory,
          preTaxAmount: original.taxInfo.preTaxAmount,
          discountApplied: original.taxInfo.discountApplied,
          originalAmount: original.taxInfo.originalAmount
        } : undefined
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
  async importFromPDF(file: File): Promise<ImportResult> {
    if (!this.geminiService.isAvailable()) {
      throw new Error('AI service is not available. Please configure your Gemini API key in Settings.');
    }

    this.isProcessing.set(true);
    this.processingStatus.set('Reading PDF...');
    this.processingProgress.set(10);

    try {
      const pdfBase64 = await this.fileToBase64(file);

      this.processingStatus.set('Extracting transactions with AI...');
      this.processingProgress.set(30);

      const extractedTransactions = await this.withTimeout(
        this.geminiService.extractTransactionsFromPDF(pdfBase64),
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

      return this.buildImportResult(file, 'pdf', 'bank_pdf', markedTransactions, duplicates);
    } finally {
      this.isProcessing.set(false);
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

      const rawTransactions: RawTransaction[] = importedTransactions.map(t => ({
        description: t.description,
        amount: t.amount,
        date: t.date
      }));

      this.processingStatus.set('Categorizing with AI...');
      this.processingProgress.set(50);

      const categorized = await this.categorizeTransactions(rawTransactions, importedTransactions);

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

      const categorized: CategorizedImportTransaction[] = data.transactions.map(
        (t: Record<string, unknown>, index: number) => ({
          id: `json_${index}_${Date.now()}`,
          description: t['description'] as string || 'Unknown',
          amount: Math.abs(t['amount'] as number || 0),
          currency: (t['currency'] as string) || 'USD',
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
   * Categorize raw transactions using AI
   */
  async categorizeTransactions(
    transactions: RawTransaction[],
    originalData?: ImportedTransaction[]
  ): Promise<CategorizedImportTransaction[]> {
    if (transactions.length === 0) return [];

    // Use Gemini for categorization
    let categorizedByAI = transactions.map((t) => ({
      ...t,
      suggestedCategoryId: 'other_expense',
      confidence: 0.1
    }));

    if (this.geminiService.isAvailable()) {
      try {
        categorizedByAI = await this.geminiService.categorizeTransactions(transactions);
      } catch (error) {
        console.warn('AI categorization failed, using defaults:', error);
      }
    }

    // Get user's base currency from settings
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';

    // Convert to CategorizedImportTransaction format
    return categorizedByAI.map((t, index) => {
      const original = originalData?.[index];
      return {
        id: `import_${index}_${Date.now()}`,
        description: t.description,
        amount: Math.abs(t.amount),
        currency: baseCurrency, // Use user's base currency as default
        date: t.date,
        type: original?.type || (t.amount >= 0 ? 'income' : 'expense'),
        suggestedCategoryId: t.suggestedCategoryId,
        categoryConfidence: t.confidence,
        originalText: original?.description,
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
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';

    try {
      for (let i = 0; i < selectedTransactions.length; i++) {
        const txn = selectedTransactions[i];
        this.processingProgress.set(Math.round(((i + 1) / selectedTransactions.length) * 100));
        this.processingStatus.set(`Importing ${i + 1} of ${selectedTransactions.length}...`);

        try {
          // Ensure date is a valid Date object
          let transactionDate: Date;
          if (txn.date instanceof Date) {
            transactionDate = txn.date;
          } else if (typeof txn.date === 'string') {
            transactionDate = new Date(txn.date);
          } else {
            transactionDate = new Date();
          }

          // Validate date is not NaN
          if (isNaN(transactionDate.getTime())) {
            transactionDate = new Date();
          }

          const dto: CreateTransactionDTO = {
            type: txn.type,
            amount: txn.amount,
            currency: txn.currency || baseCurrency,
            categoryId: txn.suggestedCategoryId || 'other_expense',
            description: txn.description || 'Imported transaction',
            date: transactionDate
          };

          await this.transactionService.addTransaction(dto);
          successCount++;

          if (txn.type === 'income') {
            totalIncome += txn.amount;
          } else {
            totalExpenses += txn.amount;
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

      // Get the completed history record
      const history = await new Promise<ImportHistory>((resolve) => {
        this.importHistoryService.getImportById(historyId).subscribe(h => {
          if (h) resolve(h);
        });
      });

      return history;
    } catch (error) {
      await this.importHistoryService.failImport(historyId, [{
        message: error instanceof Error ? error.message : 'Import failed'
      }]);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Detect file type from file object
   */
  private detectFileType(file: File): ImportFileType {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type.toLowerCase();

    if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')) {
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
   * Wrap a promise with a timeout
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), ms);
    });
    return Promise.race([promise, timeout]);
  }
}
