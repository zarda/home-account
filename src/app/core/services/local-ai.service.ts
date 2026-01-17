import { Injectable, signal, computed, inject } from '@angular/core';
import { createWorker, Worker, RecognizeResult } from 'tesseract.js';
import { TransformersAIService } from './transformers-ai.service';

export interface LocalOCRResult {
  text: string;
  confidence: number;
  lines: OCRLine[];
}

export interface OCRLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface ExtractedReceiptData {
  merchant: string;
  date: string;
  total: number;
  currency: string;
  items: ExtractedItem[];
  confidence: number;
}

export interface ExtractedItem {
  description: string;
  amount: number;
  quantity?: number;
}

export interface LocalProcessingResult {
  transactions: LocalTransaction[];
  rawText: string;
  confidence: number;
  processingTimeMs: number;
}

export interface LocalTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  confidence: number;
}

// Currency symbols and patterns (reserved for future use)
const _CURRENCY_PATTERNS: Record<string, RegExp> = {
  USD: /\$[\d,]+\.?\d*/g,
  EUR: /€[\d,]+\.?\d*/g,
  GBP: /£[\d,]+\.?\d*/g,
  JPY: /[¥￥][\d,]+/g,
  CNY: /[¥￥][\d,]+\.?\d*/g,
  THB: /฿[\d,]+\.?\d*/g,
  KRW: /₩[\d,]+/g,
  TWD: /NT\$[\d,]+\.?\d*/g,
  HKD: /HK\$[\d,]+\.?\d*/g,
};
void _CURRENCY_PATTERNS; // Suppress unused warning

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '￥': 'JPY',
  '฿': 'THB',
  '₩': 'KRW',
};

// Processing mode for local AI
export type LocalProcessingMode = 'basic' | 'enhanced';

@Injectable({ providedIn: 'root' })
export class LocalAIService {
  // Inject TransformersAI for semantic understanding
  private transformersAI = inject(TransformersAIService);
  
  // Worker instance for OCR
  private worker: Worker | null = null;
  private workerInitializing = false;
  
  // Processing mode
  private _processingMode = signal<LocalProcessingMode>('basic');

  // Processing state signals
  private _isProcessing = signal<boolean>(false);
  private _progress = signal<number>(0);
  private _status = signal<string>('');
  private _isReady = signal<boolean>(false);
  private _modelSize = signal<number>(0);
  private _lastError = signal<string | null>(null);
  private _semanticModelReady = signal<boolean>(false);

  // Public computed signals
  isProcessing = computed(() => this._isProcessing());
  progress = computed(() => this._progress());
  status = computed(() => this._status());
  isReady = computed(() => this._isReady());
  modelSize = computed(() => this._modelSize());
  lastError = computed(() => this._lastError());
  processingMode = computed(() => this._processingMode());
  semanticModelReady = computed(() => this._semanticModelReady());
  
  // Combined model size (OCR + Semantic)
  totalModelSize = computed(() => {
    const ocrSize = this._modelSize();
    const semanticSize = this.transformersAI.modelSize();
    return ocrSize + semanticSize;
  });

  constructor() {
    // Don't initialize on construction - lazy load when needed
  }
  
  /**
   * Set the processing mode (basic = Tesseract only, enhanced = Tesseract + Transformers.js)
   */
  setProcessingMode(mode: LocalProcessingMode): void {
    this._processingMode.set(mode);
  }

  /**
   * Initialize Tesseract worker with specified languages.
   * Call this before processing to pre-load models.
   */
  async initialize(languages: string[] = ['eng']): Promise<void> {
    if (this.worker || this.workerInitializing) {
      return;
    }

    this.workerInitializing = true;
    this._status.set('Initializing OCR engine...');

    try {
      const langString = languages.join('+');
      
      this.worker = await createWorker(langString, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this._progress.set(Math.round(m.progress * 100));
          }
          this._status.set(m.status);
        },
        cacheMethod: 'indexedDB',  // Cache models in IndexedDB for offline use
      });

      this._isReady.set(true);
      this._status.set('OCR engine ready');
      console.log('[LocalAI] Tesseract initialized with languages:', langString);

      // Estimate model size (approximately 15MB per language)
      this._modelSize.set(languages.length * 15 * 1024 * 1024);
    } catch (error) {
      console.error('[LocalAI] Failed to initialize Tesseract:', error);
      this._lastError.set(error instanceof Error ? error.message : 'Failed to initialize OCR');
      throw error;
    } finally {
      this.workerInitializing = false;
    }
  }

  /**
   * Terminate the worker to free resources.
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this._isReady.set(false);
      this._status.set('OCR engine terminated');
      console.log('[LocalAI] Tesseract terminated');
    }
  }

  /**
   * Process a receipt image and extract transactions.
   */
  async processReceipt(imageFile: File): Promise<LocalProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);
    this._progress.set(0);
    this._lastError.set(null);

    try {
      // Initialize OCR if not ready
      if (!this.worker) {
        await this.initialize(['eng', 'jpn', 'chi_tra']);
      }

      // Preprocess image
      this._status.set('Preprocessing image...');
      const processedImage = await this.preprocessImage(imageFile);

      // Run OCR
      this._status.set('Extracting text...');
      this._progress.set(20);
      const ocrResult = await this.performOCR(processedImage);
      this._progress.set(50);

      let receiptData: ExtractedReceiptData;
      
      // Use enhanced mode with TransformersAI if enabled
      if (this._processingMode() === 'enhanced') {
        this._status.set('Applying semantic AI analysis...');
        this._progress.set(60);
        
        try {
          const semanticResult = await this.transformersAI.parseReceiptText(ocrResult.text);
          this._progress.set(85);
          
          // Combine OCR regex parsing with semantic understanding
          const basicData = this.parseReceiptText(ocrResult);
          
          // Use semantic results if they have higher confidence
          receiptData = this.mergeResults(basicData, semanticResult, ocrResult.confidence);
          
          console.log('[LocalAI] Enhanced mode - combined results:', {
            basic: basicData,
            semantic: semanticResult,
            merged: receiptData,
          });
        } catch (semanticError) {
          console.warn('[LocalAI] Semantic analysis failed, falling back to basic:', semanticError);
          receiptData = this.parseReceiptText(ocrResult);
        }
      } else {
        // Basic mode - regex parsing only
        this._status.set('Analyzing receipt...');
        receiptData = this.parseReceiptText(ocrResult);
      }
      
      this._progress.set(90);

      // Convert to transactions
      const transactions = this.convertToTransactions(receiptData);

      const processingTimeMs = performance.now() - startTime;

      return {
        transactions,
        rawText: ocrResult.text,
        confidence: ocrResult.confidence / 100,
        processingTimeMs,
      };
    } catch (error) {
      console.error('[LocalAI] Processing error:', error);
      this._lastError.set(error instanceof Error ? error.message : 'Processing failed');
      throw error;
    } finally {
      this._isProcessing.set(false);
      this._status.set('');
    }
  }

  /**
   * Process multiple images of a single receipt.
   */
  async processMultipleImages(imageFiles: File[]): Promise<LocalProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);
    this._progress.set(0);
    this._lastError.set(null);

    try {
      if (!this.worker) {
        await this.initialize(['eng', 'jpn', 'chi_tra']);
      }

      const allTransactions: LocalTransaction[] = [];
      let combinedText = '';
      let totalConfidence = 0;

      for (let i = 0; i < imageFiles.length; i++) {
        this._status.set(`Processing image ${i + 1} of ${imageFiles.length}...`);
        this._progress.set(Math.round((i / imageFiles.length) * 100));

        const processedImage = await this.preprocessImage(imageFiles[i]);
        const ocrResult = await this.performOCR(processedImage);
        
        combinedText += ocrResult.text + '\n---\n';
        totalConfidence += ocrResult.confidence;

        const receiptData = this.parseReceiptText(ocrResult);
        const transactions = this.convertToTransactions(receiptData);
        allTransactions.push(...transactions);
      }

      // Deduplicate similar transactions
      const deduplicated = this.deduplicateTransactions(allTransactions);

      const processingTimeMs = performance.now() - startTime;

      return {
        transactions: deduplicated,
        rawText: combinedText,
        confidence: (totalConfidence / imageFiles.length) / 100,
        processingTimeMs,
      };
    } catch (error) {
      console.error('[LocalAI] Multi-image processing error:', error);
      this._lastError.set(error instanceof Error ? error.message : 'Processing failed');
      throw error;
    } finally {
      this._isProcessing.set(false);
      this._status.set('');
    }
  }

  /**
   * Preprocess image for better OCR results.
   * Applies multiple enhancement techniques for receipt images.
   */
  private async preprocessImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          
          // Create image element
          const img = new Image();
          img.onload = () => {
            // Create canvas for preprocessing
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            
            if (!ctx) {
              resolve(base64);
              return;
            }

            // Optimal size for OCR (receipts need high resolution)
            const _targetDPI = 300; // Reserved for DPI-based scaling
            void _targetDPI;
            const minSize = 1500;
            const maxSize = 3000;
            let width = img.width;
            let height = img.height;
            
            // Scale up small images for better OCR
            const minDimension = Math.min(width, height);
            if (minDimension < minSize) {
              const scale = minSize / minDimension;
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }
            
            // Scale down very large images for performance
            const maxDimension = Math.max(width, height);
            if (maxDimension > maxSize) {
              const scale = maxSize / maxDimension;
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }

            canvas.width = width;
            canvas.height = height;

            // Draw image with high-quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Get image data for processing
            let imageData = ctx.getImageData(0, 0, width, height);
            
            // Step 1: Convert to grayscale with luminance weights
            imageData = this.toGrayscale(imageData);
            
            // Step 2: Apply noise reduction (median filter)
            imageData = this.reduceNoise(imageData, width, height);
            
            // Step 3: Enhance contrast using adaptive histogram equalization
            imageData = this.enhanceContrast(imageData, width, height);
            
            // Step 4: Apply unsharp mask for edge enhancement
            imageData = this.sharpen(imageData, width, height);
            
            // Step 5: Apply adaptive thresholding for text binarization
            imageData = this.adaptiveThreshold(imageData, width, height);

            ctx.putImageData(imageData, 0, 0);

            // Return as high-quality PNG for OCR
            resolve(canvas.toDataURL('image/png'));
          };

          img.onerror = () => resolve(base64);
          img.src = base64;
        } catch {
          // If preprocessing fails, use original
          resolve(reader.result as string);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Convert to grayscale using luminance weights.
   */
  private toGrayscale(imageData: ImageData): ImageData {
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      // Use luminance weights for better text contrast
      // Human eye is more sensitive to green
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
    
    return imageData;
  }

  /**
   * Reduce noise using a simple box blur for smoother results.
   */
  private reduceNoise(imageData: ImageData, width: number, height: number): ImageData {
    const data = imageData.data;
    const output = new Uint8ClampedArray(data);
    const radius = 1;
    
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        let sum = 0;
        let count = 0;
        
        // Sample surrounding pixels
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            sum += data[idx];
            count++;
          }
        }
        
        const idx = (y * width + x) * 4;
        const avg = sum / count;
        output[idx] = avg;
        output[idx + 1] = avg;
        output[idx + 2] = avg;
      }
    }
    
    imageData.data.set(output);
    return imageData;
  }

  /**
   * Enhance contrast using CLAHE-like approach (simplified).
   */
  private enhanceContrast(imageData: ImageData, width: number, height: number): ImageData {
    const data = imageData.data;
    
    // Calculate histogram
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[Math.round(data[i])]++;
    }
    
    // Calculate cumulative distribution
    const cdf = new Array(256).fill(0);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }
    
    // Find min non-zero CDF value
    let cdfMin = 0;
    for (let i = 0; i < 256; i++) {
      if (cdf[i] > 0) {
        cdfMin = cdf[i];
        break;
      }
    }
    
    // Normalize CDF for histogram equalization
    const totalPixels = width * height;
    const equalized = new Array(256);
    for (let i = 0; i < 256; i++) {
      equalized[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
    }
    
    // Apply equalization
    for (let i = 0; i < data.length; i += 4) {
      const newVal = equalized[Math.round(data[i])];
      data[i] = newVal;
      data[i + 1] = newVal;
      data[i + 2] = newVal;
    }
    
    return imageData;
  }

  /**
   * Sharpen image using unsharp mask.
   */
  private sharpen(imageData: ImageData, width: number, height: number): ImageData {
    const data = imageData.data;
    const original = new Uint8ClampedArray(data);
    const amount = 0.5; // Sharpening strength
    
    // Apply 3x3 Gaussian blur kernel
    const kernel = [
      1/16, 2/16, 1/16,
      2/16, 4/16, 2/16,
      1/16, 2/16, 1/16
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let blurred = 0;
        let ki = 0;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            blurred += original[idx] * kernel[ki++];
          }
        }
        
        const idx = (y * width + x) * 4;
        const orig = original[idx];
        
        // Unsharp mask: original + amount * (original - blurred)
        const sharpened = orig + amount * (orig - blurred);
        const clamped = Math.max(0, Math.min(255, sharpened));
        
        data[idx] = clamped;
        data[idx + 1] = clamped;
        data[idx + 2] = clamped;
      }
    }
    
    return imageData;
  }

  /**
   * Apply adaptive thresholding for text binarization.
   * This helps separate text from background on receipts.
   */
  private adaptiveThreshold(imageData: ImageData, width: number, height: number): ImageData {
    const data = imageData.data;
    const blockSize = 15; // Size of local region
    const C = 10; // Constant subtracted from mean
    
    // Create integral image for fast mean calculation
    const integral = new Float64Array((width + 1) * (height + 1));
    
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rowSum += data[idx];
        integral[(y + 1) * (width + 1) + (x + 1)] = 
          rowSum + integral[y * (width + 1) + (x + 1)];
      }
    }
    
    // Apply adaptive threshold
    const halfBlock = Math.floor(blockSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate bounds for local region
        const x1 = Math.max(0, x - halfBlock);
        const y1 = Math.max(0, y - halfBlock);
        const x2 = Math.min(width - 1, x + halfBlock);
        const y2 = Math.min(height - 1, y + halfBlock);
        
        // Calculate local mean using integral image
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)]
                  - integral[y1 * (width + 1) + (x2 + 1)]
                  - integral[(y2 + 1) * (width + 1) + x1]
                  + integral[y1 * (width + 1) + x1];
        
        const mean = sum / count;
        const threshold = mean - C;
        
        const idx = (y * width + x) * 4;
        const pixel = data[idx];
        
        // Apply threshold: text should be dark on light background
        // We keep grayscale values but enhance contrast near threshold
        if (pixel < threshold) {
          // Dark pixel (likely text) - make darker
          const newVal = Math.max(0, pixel * 0.5);
          data[idx] = newVal;
          data[idx + 1] = newVal;
          data[idx + 2] = newVal;
        } else {
          // Light pixel (likely background) - make lighter
          const newVal = Math.min(255, 200 + (pixel - threshold) * 0.3);
          data[idx] = newVal;
          data[idx + 1] = newVal;
          data[idx + 2] = newVal;
        }
      }
    }
    
    return imageData;
  }

  /**
   * Perform OCR on preprocessed image.
   */
  private async performOCR(imageData: string): Promise<LocalOCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    const result: RecognizeResult = await this.worker.recognize(imageData);
    
    const lines: OCRLine[] = result.data.lines.map((line) => ({
      text: line.text.trim(),
      confidence: line.confidence,
      bbox: line.bbox,
    }));

    return {
      text: result.data.text,
      confidence: result.data.confidence,
      lines,
    };
  }

  /**
   * Parse OCR text to extract receipt data.
   */
  private parseReceiptText(ocr: LocalOCRResult): ExtractedReceiptData {
    const text = ocr.text;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Clean OCR errors from lines
    const cleanedLines = lines.map(l => this.cleanOCRText(l));

    // Detect currency
    const currency = this.detectCurrency(text);

    // Extract date
    const date = this.extractDate(text);

    // Extract merchant (usually first few lines)
    const merchant = this.extractMerchant(cleanedLines);

    // Extract items and amounts
    const items = this.extractItems(cleanedLines, currency);

    // Extract total (try multiple methods)
    const total = this.extractTotal(text, currency) || this.inferTotalFromItems(items);

    // Calculate confidence based on what we found
    let dataConfidence = ocr.confidence / 100;
    if (!merchant || merchant === 'Unknown Merchant') dataConfidence *= 0.8;
    if (!total || total === 0) dataConfidence *= 0.7;
    if (items.length === 0) dataConfidence *= 0.8;

    return {
      merchant,
      date,
      total,
      currency,
      items,
      confidence: dataConfidence,
    };
  }

  /**
   * Clean common OCR errors in text.
   */
  private cleanOCRText(text: string): string {
    return text
      // Fix common character substitutions
      .replace(/[oO](?=\d)/g, '0')  // O before digit -> 0
      .replace(/(?<=\d)[oO]/g, '0') // O after digit -> 0
      .replace(/[lI](?=\d)/g, '1')  // l/I before digit -> 1
      .replace(/(?<=\d)[lI]/g, '1') // l/I after digit -> 1
      .replace(/[Ss](?=\d{2,})/g, '$') // S before 2+ digits -> $
      .replace(/\s{2,}/g, ' ')     // Multiple spaces -> single
      .trim();
  }

  /**
   * Infer total from items if not explicitly found.
   */
  private inferTotalFromItems(items: ExtractedItem[]): number {
    if (items.length === 0) return 0;
    return items.reduce((sum, item) => sum + item.amount, 0);
  }

  /**
   * Detect currency from text.
   */
  private detectCurrency(text: string): string {
    // Currency symbol counts
    const symbolCounts: Record<string, number> = {};
    
    // Check for currency symbols (count occurrences)
    for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOL_MAP)) {
      const count = (text.match(new RegExp(`\\${symbol}`, 'g')) || []).length;
      if (count > 0) {
        symbolCounts[currency] = (symbolCounts[currency] || 0) + count;
      }
    }

    // Return the most common currency symbol found
    if (Object.keys(symbolCounts).length > 0) {
      return Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    // Check for currency codes with word boundaries
    const currencyPatterns: Record<string, RegExp> = {
      'USD': /\bUSD\b|\bUS\$|\bU\.S\./i,
      'EUR': /\bEUR\b|\bEURO\b/i,
      'GBP': /\bGBP\b|\bSTERLING\b/i,
      'JPY': /\bJPY\b|円|日本円/i,
      'CNY': /\bCNY\b|\bRMB\b|人民币/i,
      'THB': /\bTHB\b|\bBAHT\b/i,
      'KRW': /\bKRW\b|\bWON\b|원/i,
      'TWD': /\bTWD\b|\bNT\$/i,
      'HKD': /\bHKD\b|\bHK\$/i,
      'SGD': /\bSGD\b|\bS\$/i,
      'AUD': /\bAUD\b|\bA\$/i,
      'CAD': /\bCAD\b|\bC\$/i,
    };

    for (const [code, pattern] of Object.entries(currencyPatterns)) {
      if (pattern.test(text)) {
        return code;
      }
    }

    // Try to infer from amount format
    // Japanese yen typically has no decimal places and large numbers
    if (/[¥￥]?\s*\d{3,}(?:[,，]\d{3})*(?!\.)/.test(text) && !text.includes('.')) {
      return 'JPY';
    }

    // Default to USD
    return 'USD';
  }

  /**
   * Extract date from text.
   */
  private extractDate(text: string): string {
    // Common date patterns (ordered by specificity)
    const datePatterns = [
      // ISO format: YYYY-MM-DD
      { pattern: /(\d{4})-(\d{2})-(\d{2})/, format: 'ymd' },
      // YYYY/MM/DD
      { pattern: /(\d{4})\/(\d{1,2})\/(\d{1,2})/, format: 'ymd' },
      // DD/MM/YYYY (common in Europe, Asia)
      { pattern: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, format: 'dmy' },
      // MM-DD-YYYY (US format)
      { pattern: /(\d{1,2})-(\d{1,2})-(\d{4})/, format: 'mdy' },
      // Month DD, YYYY
      { pattern: /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.\s]+(\d{1,2})[,\s]+(\d{4})/i, format: 'month' },
      // DD Month YYYY
      { pattern: /(\d{1,2})[.\s]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.\s]+(\d{4})/i, format: 'day_month' },
      // Japanese/Chinese date: YYYY年MM月DD日
      { pattern: /(\d{4})年(\d{1,2})月(\d{1,2})日/, format: 'ymd' },
      // ROC/Minguo calendar (民國): 民國XXX年MM月DD日
      { pattern: /民國\s*(\d{1,3})年(\d{1,2})月(\d{1,2})日/, format: 'minguo' },
      // ROC short format: XXX/MM/DD where XXX is ROC year
      { pattern: /(\d{2,3})\/(\d{1,2})\/(\d{1,2})(?!\d)/, format: 'minguo_short' },
      // Reiwa era (令和)
      { pattern: /令和\s*(\d{1,2})年(\d{1,2})月(\d{1,2})日/, format: 'reiwa' },
      // Short date with time: DD/MM HH:MM
      { pattern: /(\d{1,2})\/(\d{1,2})\s+\d{2}:\d{2}/, format: 'dm' },
    ];

    const monthMap: Record<string, number> = {
      'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
      'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
      'aug': 8, 'august': 8, 'sep': 9, 'september': 9, 'oct': 10, 'october': 10,
      'nov': 11, 'november': 11, 'dec': 12, 'december': 12
    };

    for (const { pattern, format } of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          let year: number, month: number, day: number;
          
          switch (format) {
            case 'ymd':
              year = parseInt(match[1], 10);
              month = parseInt(match[2], 10);
              day = parseInt(match[3], 10);
              break;
            case 'dmy':
              day = parseInt(match[1], 10);
              month = parseInt(match[2], 10);
              year = parseInt(match[3], 10);
              break;
            case 'mdy':
              month = parseInt(match[1], 10);
              day = parseInt(match[2], 10);
              year = parseInt(match[3], 10);
              break;
            case 'month':
              month = monthMap[match[1].toLowerCase().substring(0, 3)];
              day = parseInt(match[2], 10);
              year = parseInt(match[3], 10);
              break;
            case 'day_month':
              day = parseInt(match[1], 10);
              month = monthMap[match[2].toLowerCase().substring(0, 3)];
              year = parseInt(match[3], 10);
              break;
            case 'reiwa':
              // Reiwa era started 2019
              year = 2018 + parseInt(match[1], 10);
              month = parseInt(match[2], 10);
              day = parseInt(match[3], 10);
              break;
            case 'minguo':
              // ROC/Minguo calendar: year 1 = 1912 (e.g., 民國113年 = 2024)
              year = 1911 + parseInt(match[1], 10);
              month = parseInt(match[2], 10);
              day = parseInt(match[3], 10);
              break;
            case 'minguo_short': {
              // ROC short format: e.g., 113/01/15 = 2024/01/15
              const rocYear = parseInt(match[1], 10);
              // If year < 50, it might be a short Gregorian year (like 24 for 2024)
              // If year > 100, it's likely a Minguo year
              if (rocYear > 100) {
                year = 1911 + rocYear;
              } else if (rocYear > 50) {
                year = 1911 + rocYear;
              } else {
                year = 2000 + rocYear; // Assume 2000s for small numbers
              }
              month = parseInt(match[2], 10);
              day = parseInt(match[3], 10);
              break;
            }
            case 'dm':
              // Short date - assume current year
              day = parseInt(match[1], 10);
              month = parseInt(match[2], 10);
              year = new Date().getFullYear();
              break;
            default:
              continue;
          }

          // Validate date components
          if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          }
        } catch {
          // Continue to next pattern
        }
      }
    }

    // Default to today
    return new Date().toISOString().split('T')[0];
  }


  /**
   * Extract merchant name from lines.
   */
  private extractMerchant(lines: string[]): string {
    // Skip patterns for non-merchant lines
    const skipPatterns = [
      /^tel[:\s]/i,
      /^phone[:\s]/i,
      /^fax[:\s]/i,
      /^電話[:\s]/,
      /^傳真[:\s]/,
      /^地址[:\s]/,
      /^\+?\d[\d\s-]{6,}/,  // Phone numbers
      /^www\./i,
      /^http/i,
      /^@/,  // Social media handles
      /register/i,
      /receipt/i,
      /invoice/i,
      /^發票/,
      /^統一編號/,
      /^統編/,
      /^date[:\s]/i,
      /^time[:\s]/i,
      /^日期[:\s]/,
      /^時間[:\s]/,
      /^\d{2}[/-]\d{2}/,  // Dates
      /^\d{2}:\d{2}/,       // Times
      /^order\s*#/i,
      /^ticket\s*#/i,
      /^訂單/,
      /^單號/,
      /^trans(?:action)?/i,
      /^welcome/i,
      /^thank/i,
      /^歡迎/,
      /^謝謝/,
      /^感謝/,
      /^table\s*\d/i,
      /^server/i,
      /^cashier/i,
      /^服務員/,
      /^收銀/,
      /^\*+$/,              // Decorative asterisks
      /^-+$/,               // Decorative dashes
      /^=+$/,               // Decorative equals
    ];

    // Look for the most likely merchant name
    const candidates: { line: string; score: number }[] = [];

    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i];
      
      // Skip if too short, too long, or matches skip patterns
      if (line.length < 3 || line.length > 50) continue;
      if (skipPatterns.some(p => p.test(line))) continue;
      
      // Skip lines that are mostly numbers
      const digitRatio = (line.match(/\d/g) || []).length / line.length;
      if (digitRatio > 0.5) continue;

      // Score the candidate
      let score = 10 - i; // Earlier lines score higher
      
      // Bonus for all caps (common for store names)
      if (line === line.toUpperCase() && /[A-Z]/.test(line)) {
        score += 3;
      }
      
      // Bonus for reasonable length
      if (line.length >= 5 && line.length <= 30) {
        score += 2;
      }
      
      // Bonus for containing common store-name words
      if (/store|shop|market|cafe|restaurant|bar|pub|mart|supermarket|convenience/i.test(line)) {
        score += 3;
      }
      
      // Bonus for Traditional Chinese store-name patterns
      if (/商店|超市|便利|餐廳|咖啡|店|行|公司|百貨|市場|藥局|書店|麵包|飲料/i.test(line)) {
        score += 3;
      }
      
      // Penalty for containing numbers (except at end like "Store 123")
      if (/\d/.test(line) && !/\s+\d+$/.test(line)) {
        score -= 2;
      }

      candidates.push({ line, score });
    }

    // Sort by score and return best candidate
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0) {
      return this.capitalizeWords(candidates[0].line);
    }

    return 'Unknown Merchant';
  }

  /**
   * Extract line items with amounts.
   */
  private extractItems(lines: string[], currency: string): ExtractedItem[] {
    const items: ExtractedItem[] = [];
    
    // Patterns to skip (totals, headers, etc.)
    const skipPatterns = [
      /^total/i, /^subtotal/i, /^sub-total/i,
      // Japanese
      /^合計/, /^小計/, /^税/, /^消費税/,
      // Traditional Chinese
      /^總計/, /^應付/, /^實付/, /^找零/, /^現金/,
      /^信用卡/, /^發票/, /^統一編號/, /^營業稅/,
      /^謝謝/, /^感謝/, /^歡迎/, /^再見/,
      // English
      /^tax/i, /^vat/i, /^gst/i,
      /^cash/i, /^change/i, /^card/i, /^payment/i,
      /^visa/i, /^mastercard/i, /^amex/i,
      /^balance/i, /^amount due/i,
      /^date/i, /^time/i, /^receipt/i, /^invoice/i,
      /^thank/i, /^please/i,
      /^tel/i, /^phone/i, /^fax/i,
      /^\d{2}[/-]\d{2}/, // Date at start
      /^\d{2}:\d{2}/, // Time at start
    ];

    for (const line of lines) {
      // Skip if matches skip patterns
      if (skipPatterns.some(p => p.test(line))) {
        continue;
      }

      // Skip very short or very long lines
      if (line.length < 3 || line.length > 100) {
        continue;
      }

      // Look for amount at end of line
      const amountAtEnd = line.match(/([¥￥$€£฿]?\s*[\d,]+\.?\d{0,2})\s*$/);
      
      if (amountAtEnd) {
        const amount = this.parseAmount(amountAtEnd[1], currency);
        
        // Skip very small or very large amounts
        if (amount < 0.01 || amount > 10000) {
          continue;
        }
        
        // Extract description (text before the amount)
        let description = line.slice(0, amountAtEnd.index).trim();
        
        // Remove trailing punctuation and quantity patterns
        description = description.replace(/[\s\-:.]+$/, '');
        
        // Try to extract quantity
        let quantity: number | undefined;
        const qtyMatch = description.match(/^(\d+)\s*[x×@]\s*/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1], 10);
          description = description.slice(qtyMatch[0].length).trim();
        }
        
        // Skip if description is empty or too short
        if (description.length < 2) {
          continue;
        }
        
        // Skip if description looks like a total line
        if (/total|subtotal|合計|小計|總計|應付|實付|tax|税|營業稅|payment|cash|change|card|找零|現金|信用卡/i.test(description)) {
          continue;
        }

        items.push({
          description: this.capitalizeWords(description),
          amount,
          quantity,
        });
      }
    }

    // Remove duplicate items (same description and amount)
    const uniqueItems = new Map<string, ExtractedItem>();
    for (const item of items) {
      const key = `${item.description.toLowerCase()}_${item.amount.toFixed(2)}`;
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, item);
      }
    }

    return Array.from(uniqueItems.values());
  }

  /**
   * Capitalize first letter of each word.
   */
  private capitalizeWords(text: string): string {
    return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Get amount pattern for currency.
   */
  private getAmountPattern(currency: string): RegExp {
    const patterns: Record<string, RegExp> = {
      USD: /\$?\s*[\d,]+\.?\d{0,2}/,
      EUR: /€?\s*[\d,]+[.,]?\d{0,2}/,
      GBP: /£?\s*[\d,]+\.?\d{0,2}/,
      JPY: /[¥￥]?\s*[\d,]+/,
      THB: /฿?\s*[\d,]+\.?\d{0,2}/,
    };

    return patterns[currency] || /[\d,]+\.?\d{0,2}/;
  }

  /**
   * Parse amount string to number.
   */
  private parseAmount(amountStr: string, currency: string): number {
    // Remove currency symbols and whitespace
    let cleaned = amountStr.replace(/[$€£¥￥฿₩\s]/g, '');
    
    // Handle different decimal separators
    if (currency === 'EUR') {
      // European format: 1.234,56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Standard format: 1,234.56
      cleaned = cleaned.replace(/,/g, '');
    }

    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Extract total amount from text.
   */
  private extractTotal(text: string, currency: string): number {
    // Normalize text for matching (reserved for future case-insensitive matching)
    const _normalizedText = text.toLowerCase();
    void _normalizedText;
    
    // Look for total patterns (ordered by specificity)
    const totalPatterns = [
      // Grand total (highest priority)
      /grand\s*total[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // Total due/payable
      /total\s*(?:due|payable|amount)[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // Balance due
      /balance\s*(?:due)?[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // Amount due
      /amount\s*(?:due)?[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // Traditional Chinese totals (Taiwan/Hong Kong)
      /總計[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      /合計[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      /應付[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      /實付[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      /金額[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      /小計[:\s]*(?:NT\$|HK\$|\$)?[\s]*([¥￥$]?\s*[\d,]+\.?\d*)/,
      // Japanese totals
      /お支払い[:\s]*([¥￥]?\s*[\d,]+)/,
      /ご請求額[:\s]*([¥￥]?\s*[\d,]+)/,
      /計[:\s]*([¥￥]?\s*[\d,]+)/,
      // Taiwan/HK currency patterns
      /NT\s*\$\s*([\d,]+\.?\d*)/i,
      /HK\s*\$\s*([\d,]+\.?\d*)/i,
      // Generic total (exclude subtotal)
      /(?<!sub)total[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // Sum
      /sum[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
      // To pay
      /to\s*pay[:\s]*([¥￥$€£฿]?\s*[\d,]+\.?\d*)/i,
    ];

    let bestTotal = 0;
    let _bestMatch = ''; // Reserved for debugging

    for (const pattern of totalPatterns) {
      const matches = text.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const amount = this.parseAmount(match[1], currency);
        // Keep the largest total found (usually the most complete)
        if (amount > bestTotal) {
          bestTotal = amount;
          _bestMatch = match[0];
        }
      }
    }
    void _bestMatch;

    // If no explicit total found, look for the largest amount on a line by itself
    if (bestTotal === 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        const amountMatch = line.match(/([¥￥$€£฿]?\s*[\d,]+\.?\d{0,2})\s*$/);
        if (amountMatch) {
          const amount = this.parseAmount(amountMatch[1], currency);
          if (amount > bestTotal && amount < 100000) { // Sanity check
            bestTotal = amount;
          }
        }
      }
    }

    return bestTotal;
  }

  /**
   * Merge basic regex results with semantic AI results.
   * Uses the higher-confidence value for each field.
   */
  private mergeResults(
    basic: ExtractedReceiptData,
    semantic: import('./transformers-ai.service').SemanticParseResult,
    ocrConfidence: number
  ): ExtractedReceiptData {
    // Normalize OCR confidence to 0-1 range
    const normalizedOcrConfidence = ocrConfidence / 100;
    
    // For merchant: use semantic if confidence is high enough
    const merchant = semantic.merchantConfidence > 0.5 && semantic.merchant !== 'Unknown Merchant'
      ? semantic.merchant
      : basic.merchant;
    
    // For date: use semantic if it found a valid date with good confidence
    // Note: Same-day receipts are valid - don't reject based on matching today's date
    const date = semantic.dateConfidence > 0.4 && semantic.date
      ? semantic.date
      : basic.date;
    
    // For total: prefer semantic if it found a reasonable value with confidence
    const total = semantic.totalConfidence > 0.5 && semantic.total > 0
      ? semantic.total
      : basic.total || semantic.total;
    
    // For currency: use whichever found a valid currency
    const currency = semantic.currency !== 'USD' || basic.currency === 'USD'
      ? semantic.currency
      : basic.currency;
    
    // For items: merge both lists, preferring semantic items
    const mergedItems: ExtractedItem[] = [];
    const seenItems = new Set<string>();
    
    // Add semantic items first (higher quality names)
    for (const item of semantic.items) {
      const key = `${item.name.toLowerCase().substring(0, 10)}_${item.price.toFixed(2)}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        mergedItems.push({
          description: item.name,
          amount: item.price,
          quantity: item.quantity,
        });
      }
    }
    
    // Add basic items that weren't in semantic results
    for (const item of basic.items) {
      const key = `${item.description.toLowerCase().substring(0, 10)}_${item.amount.toFixed(2)}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        mergedItems.push(item);
      }
    }
    
    // Calculate merged confidence
    const confidence = Math.max(
      basic.confidence,
      semantic.overallConfidence,
      normalizedOcrConfidence * 0.5 + semantic.overallConfidence * 0.5
    );
    
    return {
      merchant,
      date,
      total,
      currency,
      items: mergedItems,
      confidence,
    };
  }

  /**
   * Convert extracted receipt data to transactions.
   */
  private convertToTransactions(data: ExtractedReceiptData): LocalTransaction[] {
    const transactions: LocalTransaction[] = [];
    const baseDate = data.date;

    if (data.items.length > 0) {
      // Create a transaction for each item
      for (const item of data.items) {
        transactions.push({
          date: baseDate,
          description: `${data.merchant}: ${item.description}`,
          amount: item.amount,
          type: 'expense',
          currency: data.currency,
          confidence: data.confidence,
        });
      }
    } else if (data.total > 0) {
      // Create a single transaction for the total
      transactions.push({
        date: baseDate,
        description: data.merchant,
        amount: data.total,
        type: 'expense',
        currency: data.currency,
        confidence: data.confidence,
      });
    }

    return transactions;
  }

  /**
   * Deduplicate similar transactions from multiple images.
   */
  private deduplicateTransactions(transactions: LocalTransaction[]): LocalTransaction[] {
    const seen = new Map<string, LocalTransaction>();

    for (const tx of transactions) {
      // Create a key based on description and amount
      const key = `${tx.description.toLowerCase().substring(0, 20)}_${tx.amount.toFixed(2)}`;
      
      if (!seen.has(key)) {
        seen.set(key, tx);
      } else {
        // Keep the one with higher confidence
        const existing = seen.get(key)!;
        if (tx.confidence > existing.confidence) {
          seen.set(key, tx);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Check if the service can process offline.
   */
  canProcessOffline(): boolean {
    return this._isReady();
  }

  /**
   * Get estimated model download size.
   */
  getEstimatedModelSize(languages: string[]): number {
    // Approximately 15MB per language
    return languages.length * 15 * 1024 * 1024;
  }

  /**
   * Pre-download models for offline use.
   */
  async preloadModels(languages: string[] = ['eng', 'jpn', 'chi_tra'], includeSemanticModel = true): Promise<void> {
    this._status.set('Downloading OCR models for offline use...');
    this._progress.set(0);
    
    try {
      // Load OCR models
      await this.initialize(languages);
      this._progress.set(50);
      
      // Optionally load semantic model for enhanced mode
      if (includeSemanticModel && this._processingMode() === 'enhanced') {
        this._status.set('Downloading semantic AI model...');
        await this.transformersAI.preloadModel();
        this._semanticModelReady.set(true);
      }
      
      this._progress.set(100);
      this._status.set('All models ready for offline use');
    } catch (error) {
      this._lastError.set('Failed to download models');
      throw error;
    }
  }

  /**
   * Initialize enhanced mode with semantic model.
   */
  async initializeEnhancedMode(): Promise<void> {
    this._processingMode.set('enhanced');
    this._status.set('Initializing enhanced AI mode...');
    
    try {
      // Initialize OCR first
      if (!this.worker) {
        await this.initialize(['eng', 'jpn', 'chi_tra']);
      }
      
      // Then initialize semantic model
      await this.transformersAI.initialize();
      this._semanticModelReady.set(true);
      this._status.set('Enhanced AI mode ready');
    } catch (error) {
      this._lastError.set('Failed to initialize enhanced mode');
      throw error;
    }
  }
}
