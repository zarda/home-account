import { Injectable, signal, computed, inject } from '@angular/core';
import { createWorker, Worker, RecognizeResult, PSM, OEM } from 'tesseract.js';
import { TransformersAIService } from './transformers-ai.service';
import { PaddleOCRService } from './paddle-ocr.service';

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

// OCR engine type for hybrid approach
export type OCREngine = 'tesseract' | 'paddleocr' | 'auto';

@Injectable({ providedIn: 'root' })
export class LocalAIService {
  // Inject TransformersAI for semantic understanding
  private transformersAI = inject(TransformersAIService);
  
  // Inject PaddleOCR for Traditional Chinese (93% accuracy vs 70% Tesseract)
  private paddleOCR = inject(PaddleOCRService);
  
  // Worker instance for Tesseract OCR
  private worker: Worker | null = null;
  private workerInitializing = false;
  
  // OCR engine preference (auto = detect language and choose best engine)
  private _ocrEngine = signal<OCREngine>('auto');
  
  // Shared preferences storage key
  private readonly PREFERENCES_KEY = 'homeaccount_ai_preferences';

  // OCR configuration for different receipt types
  // PSM (Page Segmentation Mode): https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
  // OEM (OCR Engine Mode): 0=Legacy, 1=LSTM only, 2=Legacy+LSTM, 3=Default
  private readonly OCR_CONFIG = {
    // Primary config for receipts - single block of text
    receipt: {
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,  // PSM 6: Assume single uniform block of text
      tessedit_ocr_engine_mode: OEM.LSTM_ONLY,  // OEM 1: LSTM only (better for CJK)
      preserve_interword_spaces: '1',  // Keep spaces for Japanese text
    },
    // Fallback for multi-section receipts
    singleColumn: {
      tessedit_pageseg_mode: PSM.SINGLE_COLUMN,  // PSM 4: Assume single column of variable-size text
      tessedit_ocr_engine_mode: OEM.LSTM_ONLY,
      preserve_interword_spaces: '1',
    },
    // For difficult/sparse layouts
    sparse: {
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,  // PSM 11: Sparse text, find as much as possible
      tessedit_ocr_engine_mode: OEM.LSTM_ONLY,
      preserve_interword_spaces: '1',
    },
    // For orientation detection
    osd: {
      tessedit_pageseg_mode: PSM.OSD_ONLY,  // PSM 0: Orientation and script detection only
    },
  };

  // Confidence thresholds for multi-pass OCR
  private readonly CONFIDENCE_THRESHOLDS = {
    excellent: 85,  // No need for additional passes
    good: 70,       // Acceptable, but try fallback if available
    poor: 50,       // Definitely try additional passes
  };

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
  ocrEngine = computed(() => this._ocrEngine());
  
  // PaddleOCR ready state (for Traditional Chinese)
  paddleOCRReady = computed(() => this.paddleOCR.isReady());
  
  // Combined model size (OCR + Semantic + PaddleOCR)
  totalModelSize = computed(() => {
    const tesseractSize = this._modelSize();
    const semanticSize = this.transformersAI.modelSize();
    const paddleSize = this.paddleOCR.modelSize();
    return tesseractSize + semanticSize + paddleSize;
  });

  constructor() {
    // Load persisted processing mode from localStorage
    this.loadProcessingMode();
  }

  /**
   * Load persisted processing mode and OCR engine from shared preferences.
   */
  private loadProcessingMode(): void {
    try {
      const stored = localStorage.getItem(this.PREFERENCES_KEY);
      if (stored) {
        const prefs = JSON.parse(stored);
        if (prefs.localProcessingMode === 'basic' || prefs.localProcessingMode === 'enhanced') {
          this._processingMode.set(prefs.localProcessingMode);
        }
        // Also load OCR engine preference
        if (prefs.ocrEngine === 'auto' || prefs.ocrEngine === 'tesseract' || prefs.ocrEngine === 'paddleocr') {
          this._ocrEngine.set(prefs.ocrEngine);
        }
      }
    } catch {
      // localStorage may not be available or invalid JSON
    }
  }
  
  /**
   * Set the processing mode (basic = Tesseract only, enhanced = Tesseract + Transformers.js)
   */
  setProcessingMode(mode: LocalProcessingMode): void {
    this._processingMode.set(mode);
    
    // Persist to shared preferences
    try {
      const stored = localStorage.getItem(this.PREFERENCES_KEY);
      const prefs = stored ? JSON.parse(stored) : {};
      prefs.localProcessingMode = mode;
      localStorage.setItem(this.PREFERENCES_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage may not be available
    }
  }

  /**
   * Set the OCR engine preference.
   * - 'auto': Automatically select best engine based on detected language
   *   - Traditional Chinese → PaddleOCR (93% accuracy)
   *   - English/Japanese → Tesseract (better for these languages)
   * - 'tesseract': Always use Tesseract.js
   * - 'paddleocr': Always use PaddleOCR (best for TC, good for all)
   */
  setOCREngine(engine: OCREngine): void {
    this._ocrEngine.set(engine);
    
    try {
      const stored = localStorage.getItem(this.PREFERENCES_KEY);
      const prefs = stored ? JSON.parse(stored) : {};
      prefs.ocrEngine = engine;
      localStorage.setItem(this.PREFERENCES_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage may not be available
    }
  }

  /**
   * Pre-load PaddleOCR models for Traditional Chinese.
   * Call this if you expect to process TC receipts.
   */
  async initializePaddleOCR(): Promise<void> {
    if (!this.paddleOCR.isReady()) {
      await this.paddleOCR.initialize();
    }
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
   * Uses hybrid OCR approach:
   * - PaddleOCR for Traditional Chinese (~93% accuracy)
   * - Tesseract for English/Japanese (better for these languages)
   */
  async processReceipt(imageFile: File): Promise<LocalProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);
    this._progress.set(0);
    this._lastError.set(null);

    try {
      // Preprocess image first (needed for both OCR engines)
      this._status.set('Preprocessing image...');
      const processedImage = await this.preprocessImage(imageFile);
      this._progress.set(15);

      // Determine which OCR engine to use
      const engine = this._ocrEngine();
      let ocrResult: LocalOCRResult;

      if (engine === 'paddleocr') {
        // Force PaddleOCR
        ocrResult = await this.runPaddleOCR(imageFile);
      } else if (engine === 'tesseract') {
        // Force Tesseract
        ocrResult = await this.runTesseractOCR(processedImage);
      } else {
        // Auto mode: quick language detection then route
        ocrResult = await this.runHybridOCR(imageFile, processedImage);
      }
      
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
   * Run PaddleOCR (best for Chinese text - Simplified & Traditional).
   * Loads from CDN on first use.
   */
  private async runPaddleOCR(imageFile: File): Promise<LocalOCRResult> {
    this._status.set('Running PaddleOCR (optimized for Chinese)...');
    this._progress.set(25);

    try {
      const result = await this.paddleOCR.recognize(imageFile);

      console.log('[LocalAI] PaddleOCR result:', {
        textLength: result.text.length,
        confidence: result.confidence,
      });

      // Convert to LocalOCRResult format
      const lines: OCRLine[] = [];
      const textLines = result.text.split('\n');

      for (let i = 0; i < textLines.length; i++) {
        const points = result.points?.[i];
        lines.push({
          text: textLines[i],
          confidence: result.confidence * 100,
          bbox: points
            ? {
                x0: points[0]?.[0] || 0,
                y0: points[0]?.[1] || 0,
                x1: points[2]?.[0] || 0,
                y1: points[2]?.[1] || 0,
              }
            : { x0: 0, y0: 0, x1: 0, y1: 0 },
        });
      }

      return {
        text: result.text,
        confidence: result.confidence * 100, // Convert to 0-100 scale
        lines,
      };
    } catch (error) {
      console.warn('[LocalAI] PaddleOCR failed, falling back to Tesseract:', error);
      // Fallback to Tesseract on error
      const processedImage = await this.preprocessImage(imageFile);
      return this.runTesseractOCR(processedImage);
    }
  }

  /**
   * Run Tesseract OCR (best for English/Japanese).
   */
  private async runTesseractOCR(processedImage: string): Promise<LocalOCRResult> {
    this._status.set('Running Tesseract OCR...');
    this._progress.set(25);

    // Initialize OCR if not ready
    if (!this.worker) {
      await this.initialize(['eng', 'jpn', 'chi_tra']);
    }

    // Run multi-pass OCR for better accuracy
    return this.multiPassOCR(processedImage);
  }

  /**
   * Hybrid OCR: detect language and route to best engine.
   * - Chinese (Simplified/Traditional) → PaddleOCR (93% accuracy)
   * - English/Japanese → Tesseract (better for these languages)
   */
  private async runHybridOCR(imageFile: File, processedImage: string): Promise<LocalOCRResult> {
    this._status.set('Detecting language...');
    this._progress.set(20);

    // First, do a quick Tesseract pass to detect language
    if (!this.worker) {
      await this.initialize(['eng', 'jpn', 'chi_tra']);
    }

    // Quick single-pass OCR for language detection
    const quickResult = await this.performOCR(processedImage, 'receipt');
    const sampleText = quickResult.text.substring(0, 500);

    // Check if Chinese is dominant (Simplified or Traditional)
    const isChinese =
      PaddleOCRService.containsChineseCharacters(sampleText) ||
      this.detectTaiwanHKIndicators(sampleText);

    if (isChinese) {
      console.log('[LocalAI] Detected Chinese text - using PaddleOCR');
      this._status.set('Chinese detected - using PaddleOCR...');

      try {
        return await this.runPaddleOCR(imageFile);
      } catch (error) {
        console.warn('[LocalAI] PaddleOCR failed, using Tesseract result:', error);
        // Return the quick result enhanced with multi-pass
        return this.multiPassOCR(processedImage);
      }
    }

    // For English/Japanese, use Tesseract with multi-pass
    console.log('[LocalAI] Using Tesseract for English/Japanese');
    return this.multiPassOCR(processedImage);
  }

  /**
   * Detect Taiwan/Hong Kong specific indicators.
   */
  private detectTaiwanHKIndicators(text: string): boolean {
    const indicators = [
      /民國\d{1,3}年/,  // Taiwan ROC date
      /統一編號/,       // Taiwan invoice number
      /發票/,           // Invoice (common in TW/HK)
      /NT\$/i,          // New Taiwan Dollar
      /HK\$/i,          // Hong Kong Dollar
      /港幣/,           // HK currency
      /台幣/,           // Taiwan currency
      /收據/,           // Receipt (TC)
      /臺灣|臺北/,      // Taiwan/Taipei (Traditional)
      /香港/,           // Hong Kong
    ];
    
    return indicators.some(pattern => pattern.test(text));
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
        const ocrResult = await this.multiPassOCR(processedImage);
        
        combinedText += ocrResult.text + '\n---\n';
        totalConfidence += ocrResult.confidence;

        let receiptData: ExtractedReceiptData;
        
        // Use enhanced mode if enabled
        if (this._processingMode() === 'enhanced') {
          try {
            const semanticResult = await this.transformersAI.parseReceiptText(ocrResult.text);
            const basicData = this.parseReceiptText(ocrResult);
            receiptData = this.mergeResults(basicData, semanticResult, ocrResult.confidence);
          } catch {
            receiptData = this.parseReceiptText(ocrResult);
          }
        } else {
          receiptData = this.parseReceiptText(ocrResult);
        }
        
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
   * Detect image orientation and return rotation angle needed.
   * Uses Tesseract's detect() API for orientation/script detection.
   */
  private async detectOrientation(imageData: string): Promise<number> {
    if (!this.worker) {
      return 0;
    }

    try {
      // Use worker.detect() for orientation detection (lighter than full recognize)
      const result = await this.worker.detect(imageData);
      
      // Tesseract returns orientation in degrees (0, 90, 180, 270)
      const data = result.data as {
        orientation_degrees?: number;
        orientation_confidence?: number;
      };
      
      if (data.orientation_degrees !== undefined && 
          data.orientation_confidence !== undefined &&
          data.orientation_confidence > 0.5) {
        const degrees = data.orientation_degrees;
        console.log('[LocalAI] Detected orientation:', degrees, 'degrees, confidence:', data.orientation_confidence);
        return degrees;
      }
    } catch (error) {
      console.warn('[LocalAI] Orientation detection failed:', error);
    }
    
    return 0;
  }

  /**
   * Rotate an image by the specified degrees.
   * Returns the new context since resizing canvas invalidates the old one.
   */
  private rotateImage(
    canvas: HTMLCanvasElement, 
    ctx: CanvasRenderingContext2D, 
    img: HTMLImageElement,
    degrees: number
  ): CanvasRenderingContext2D {
    if (degrees === 0) return ctx;
    
    const radians = (degrees * Math.PI) / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    
    // Calculate new dimensions to fit rotated image
    const newWidth = Math.round(originalWidth * cos + originalHeight * sin);
    const newHeight = Math.round(originalWidth * sin + originalHeight * cos);
    
    // Create a temporary canvas for the rotated image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = newWidth;
    tempCanvas.height = newHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) return ctx;
    
    // Translate to center, rotate, then draw
    tempCtx.translate(newWidth / 2, newHeight / 2);
    tempCtx.rotate(radians);
    tempCtx.drawImage(img, -originalWidth / 2, -originalHeight / 2, originalWidth, originalHeight);
    
    // Resize canvas - this invalidates the old context
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Get fresh context after resize - must succeed since old ctx is now invalid
    const newCtx = canvas.getContext('2d');
    if (!newCtx) {
      // Cannot return old ctx as it's invalidated by resize
      // Throw error so caller knows rotation failed
      throw new Error('Failed to get canvas context after rotation');
    }
    
    // Copy rotated image to the resized canvas
    newCtx.drawImage(tempCanvas, 0, 0);
    
    console.log('[LocalAI] Rotated image by', degrees, 'degrees');
    return newCtx;
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
          img.onload = async () => {
            // Create canvas for preprocessing
            const canvas = document.createElement('canvas');
            // Use let since rotateImage may return a fresh context after canvas resize
            let ctx = canvas.getContext('2d', { willReadFrequently: true });
            
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

            // Step 0: Detect and correct orientation (for rotated photos)
            try {
              if (this.worker) {
                const quickPreview = canvas.toDataURL('image/jpeg', 0.5);
                const rotationNeeded = await this.detectOrientation(quickPreview);
                if (rotationNeeded !== 0 && Math.abs(rotationNeeded) <= 180) {
                  // rotateImage returns fresh context since canvas resize invalidates the old one
                  ctx = this.rotateImage(canvas, ctx, img, -rotationNeeded);
                  // Update dimensions after rotation
                  width = canvas.width;
                  height = canvas.height;
                }
              }
            } catch (orientationError) {
              console.warn('[LocalAI] Orientation detection skipped:', orientationError);
            }

            // Get image data for processing
            let imageData = ctx.getImageData(0, 0, width, height);
            
            // Step 1: Convert to grayscale with luminance weights
            imageData = this.toGrayscale(imageData);
            
            // Step 2: Apply noise reduction (median filter)
            imageData = this.reduceNoise(imageData, width, height);
            
            // Step 3: Enhance contrast using adaptive histogram equalization
            imageData = this.enhanceContrast(imageData, width, height);
            
            // Step 4: Detect if likely CJK content (affects further processing)
            const isCJK = this.detectCJKContent(imageData, width, height);
            
            // Step 5: Apply unsharp mask for edge enhancement
            // Use gentler sharpening for CJK to preserve fine strokes
            if (!isCJK) {
              imageData = this.sharpen(imageData, width, height);
            }
            
            // Step 6: Apply adaptive thresholding for text binarization
            // Skip for CJK content as it can destroy fine strokes
            // Tesseract's LSTM engine handles grayscale well
            if (!isCJK) {
              imageData = this.adaptiveThreshold(imageData, width, height);
            } else {
              console.log('[LocalAI] CJK content detected - using gentle preprocessing');
            }

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
   * Uses gentler parameters to preserve fine Japanese character strokes.
   */
  private adaptiveThreshold(imageData: ImageData, width: number, height: number): ImageData {
    const data = imageData.data;
    // Reduced block size (11 instead of 15) for finer detail preservation
    // Important for Japanese kanji with thin strokes
    const blockSize = 11;
    // Reduced constant (5 instead of 10) for less aggressive thresholding
    // This helps preserve fine strokes in CJK characters
    const C = 5;
    
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
        
        // Gentler contrast enhancement to preserve fine strokes
        // Instead of hard binarization, use soft contrast adjustment
        if (pixel < threshold) {
          // Dark pixel (likely text) - enhance but preserve gradients
          // Use 0.7 multiplier instead of 0.5 to keep more detail
          const newVal = Math.max(0, pixel * 0.7);
          data[idx] = newVal;
          data[idx + 1] = newVal;
          data[idx + 2] = newVal;
        } else {
          // Light pixel (likely background) - lighten gently
          // Use smaller boost to avoid washing out thin strokes
          const newVal = Math.min(255, 180 + (pixel - threshold) * 0.4);
          data[idx] = newVal;
          data[idx + 1] = newVal;
          data[idx + 2] = newVal;
        }
      }
    }
    
    return imageData;
  }

  /**
   * Detect if image likely contains CJK (Chinese/Japanese/Korean) text.
   * Used to adjust preprocessing intensity.
   */
  private detectCJKContent(imageData: ImageData, width: number, height: number): boolean {
    // Simple heuristic: CJK receipts typically have higher character density
    // and more complex stroke patterns (higher local variance)
    const data = imageData.data;
    let highVarianceRegions = 0;
    const sampleSize = 20;
    const samples = 50;
    
    for (let s = 0; s < samples; s++) {
      const sx = Math.floor(Math.random() * (width - sampleSize));
      const sy = Math.floor(Math.random() * (height - sampleSize));
      
      let sum = 0;
      let sumSq = 0;
      const count = sampleSize * sampleSize;
      
      for (let y = sy; y < sy + sampleSize; y++) {
        for (let x = sx; x < sx + sampleSize; x++) {
          const idx = (y * width + x) * 4;
          const val = data[idx];
          sum += val;
          sumSq += val * val;
        }
      }
      
      const mean = sum / count;
      const variance = (sumSq / count) - (mean * mean);
      
      // High variance suggests complex characters
      if (variance > 2000) {
        highVarianceRegions++;
      }
    }
    
    // If more than 30% of sampled regions have high variance, likely CJK
    return highVarianceRegions / samples > 0.3;
  }

  /**
   * Perform OCR on preprocessed image with optimized parameters for receipts.
   */
  private async performOCR(
    imageData: string, 
    config: 'receipt' | 'singleColumn' | 'sparse' = 'receipt'
  ): Promise<LocalOCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    // Apply optimized parameters for the selected configuration
    const params = this.OCR_CONFIG[config];
    await this.worker.setParameters(params);

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
   * Perform multi-pass OCR with confidence-based fallback.
   * Tries different PSM modes and returns the best result.
   */
  private async multiPassOCR(imageData: string): Promise<LocalOCRResult> {
    // Pass 1: Try receipt configuration (PSM 6 - single block)
    this._status.set('OCR pass 1: analyzing receipt layout...');
    const pass1Result = await this.performOCR(imageData, 'receipt');
    
    if (pass1Result.confidence >= this.CONFIDENCE_THRESHOLDS.excellent) {
      console.log('[LocalAI] Pass 1 excellent confidence:', pass1Result.confidence);
      return pass1Result;
    }

    // Pass 2 & 3: Try alternative configurations when pass 1 is below threshold
    if (pass1Result.confidence < this.CONFIDENCE_THRESHOLDS.good) {
      this._status.set('OCR pass 2: trying column layout...');
      const pass2Result = await this.performOCR(imageData, 'singleColumn');
      console.log('[LocalAI] Pass 2 confidence:', pass2Result.confidence);
      
      // If pass 2 is good enough, return it
      if (pass2Result.confidence >= this.CONFIDENCE_THRESHOLDS.good) {
        return pass2Result;
      }
      
      // Pass 3: Always try sparse text mode when below threshold
      // (regardless of whether pass 2 was better than pass 1)
      this._status.set('OCR pass 3: sparse text analysis...');
      const pass3Result = await this.performOCR(imageData, 'sparse');
      console.log('[LocalAI] Pass 3 confidence:', pass3Result.confidence);
      
      // Return the best result among all passes
      const results = [pass1Result, pass2Result, pass3Result];
      const best = results.reduce((a, b) => a.confidence > b.confidence ? a : b);
      console.log('[LocalAI] Best result from pass:', results.indexOf(best) + 1, 'confidence:', best.confidence);
      return this.mergeOCRResults(results);
    }

    // Pass 1 was good enough
    console.log('[LocalAI] Using pass 1 result, confidence:', pass1Result.confidence);
    return pass1Result;
  }

  /**
   * Merge OCR results from multiple passes.
   * Takes the best confidence result but supplements with unique lines from other passes.
   */
  private mergeOCRResults(results: LocalOCRResult[]): LocalOCRResult {
    // Handle edge cases
    if (results.length === 0) {
      return { text: '', confidence: 0, lines: [] };
    }
    if (results.length === 1) {
      return results[0];
    }

    // Sort by confidence descending
    const sorted = [...results].sort((a, b) => b.confidence - a.confidence);
    const best = sorted[0];
    
    // If the best result is significantly better, just use it
    if (best.confidence > sorted[1].confidence + 10) {
      return best;
    }

    // Otherwise, try to merge unique lines from other results
    const seenLines = new Set<string>();
    const mergedLines: OCRLine[] = [];
    
    // Add lines from best result first
    for (const line of best.lines) {
      const normalized = line.text.toLowerCase().replace(/\s+/g, '');
      if (normalized.length > 2 && !seenLines.has(normalized)) {
        seenLines.add(normalized);
        mergedLines.push(line);
      }
    }
    
    // Add unique high-confidence lines from other results
    for (const result of sorted.slice(1)) {
      for (const line of result.lines) {
        const normalized = line.text.toLowerCase().replace(/\s+/g, '');
        if (normalized.length > 2 && !seenLines.has(normalized) && line.confidence > 60) {
          seenLines.add(normalized);
          mergedLines.push(line);
        }
      }
    }
    
    // Sort lines by their vertical position (y coordinate)
    mergedLines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    
    return {
      text: mergedLines.map(l => l.text).join('\n'),
      confidence: best.confidence,
      lines: mergedLines,
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
   * Clean common OCR errors in text, including Japanese-specific corrections.
   */
  private cleanOCRText(text: string): string {
    let cleaned = text
      // Fix common character substitutions (Latin)
      .replace(/[oO](?=\d)/g, '0')  // O before digit -> 0
      .replace(/(?<=\d)[oO]/g, '0') // O after digit -> 0
      .replace(/[lI](?=\d)/g, '1')  // l/I before digit -> 1
      .replace(/(?<=\d)[lI]/g, '1') // l/I after digit -> 1
      .replace(/[Ss](?=\d{2,})/g, '$') // S before 2+ digits -> $
      .replace(/\s{2,}/g, ' ')     // Multiple spaces -> single
      .trim();
    
    // Apply Japanese OCR corrections
    cleaned = this.correctJapaneseOCRErrors(cleaned);
    
    return cleaned;
  }

  /**
   * Correct common Japanese OCR errors.
   * These are frequent misrecognitions in thermal receipt text.
   */
  private correctJapaneseOCRErrors(text: string): string {
    // Common Japanese OCR error patterns
    const corrections: [RegExp, string][] = [
      // Yen symbol variants
      [/\\$/g, '¥'],           // Backslash often misread as yen
      [/Y(?=\d{2,})/g, '¥'],   // Y before numbers -> yen
      
      // Common kanji misreadings in receipt context
      [/円円/g, '円'],         // Duplicate yen character
      [/合言十/g, '合計'],      // Common 合計 misread
      [/含計/g, '合計'],       // 含 misread as 合
      [/令計/g, '合計'],       // 令 misread as 合
      [/合討/g, '合計'],       // 討 misread as 計
      [/イ言十/g, '合計'],      // Fragmented kanji
      
      // Tax related
      [/税込み/g, '税込'],     // Normalize tax inclusive
      [/税込リ/g, '税込'],     // リ misread
      [/秘込/g, '税込'],       // 秘 misread as 税
      [/税i込/g, '税込'],      // Latin i misread
      
      // Payment related
      [/お支払し/g, 'お支払い'],  // Missing い
      [/おつり/g, 'お釣り'],     // Normalize change
      [/釣り銭/g, 'お釣り'],     // Alternate form
      [/つり/g, 'お釣り'],       // Short form
      
      // Common receipt words
      [/レジ[ー一]/g, 'レジー'],  // Register (ー and 一 often confused)
      [/レシ一ト/g, 'レシート'], // Receipt with ー vs 一 (kanji one vs katakana dash)
      [/領収証/g, '領収書'],    // Alternate receipt word
      [/頒収書/g, '領収書'],    // 頒 misread as 領
      
      // Store types
      [/株式全社/g, '株式会社'],  // Company type
      [/株式合社/g, '株式会社'],  // Common misread
      [/株式公社/g, '株式会社'],  // Another misread
      [/有限全社/g, '有限会社'],  // Limited company
      
      // Date/time patterns
      [/令和(?=\d)/g, '令和 '],  // Add space after era
      [/平成(?=\d)/g, '平成 '],
      
      // Numbers in Japanese context
      [/(?<=\d),(?=\d{3})/g, ','],  // Ensure proper comma in numbers
      [/(?<=¥\s*\d+)[,.。](?=\d{3})/g, ','], // Fix decimal/comma confusion after yen
      
      // Common noise removal
      [/[★☆◎○●◆◇■□▲△▼▽]/g, ''],  // Remove decorative symbols
      [/[─━═┃┄┅┆┇┈┉]/g, '-'],      // Normalize line characters
    ];
    
    let result = text;
    for (const [pattern, replacement] of corrections) {
      result = result.replace(pattern, replacement);
    }
    
    return result;
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
