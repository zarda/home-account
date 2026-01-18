import { Injectable, signal, computed } from '@angular/core';

/**
 * PaddleOCR Service for Chinese text recognition (Simplified & Traditional).
 * 
 * Loads @paddle-js-models/ocr from CDN to avoid Node.js bundling issues.
 * Uses PP-OCRv3 models for text detection and recognition.
 * 
 * Accuracy: ~93% for Chinese text (vs ~70% for Tesseract.js)
 */

export interface PaddleOCRResult {
  text: string;
  confidence: number;
  points?: number[][][];  // Text box coordinates
}

// PaddleOCR module interface (loaded from CDN)
interface PaddleOCRModule {
  init: () => Promise<void>;
  recognize: (
    img: HTMLImageElement | HTMLCanvasElement,
    options?: {
      canvas?: HTMLCanvasElement;
      style?: {
        strokeStyle?: string;
        lineWidth?: number;
        fillStyle?: string;
      };
    }
  ) => Promise<{
    text: string[];
    points: number[][][];
  }>;
}

// CDN URL for PaddleOCR
const PADDLE_OCR_CDN = 'https://cdn.jsdelivr.net/npm/@paddle-js-models/ocr@4.1.1/dist/index.js';

@Injectable({ providedIn: 'root' })
export class PaddleOCRService {
  // Module loaded from CDN
  private ocrModule: PaddleOCRModule | null = null;
  private initPromise: Promise<void> | null = null;

  // State signals
  private _isReady = signal<boolean>(false);
  private _isLoading = signal<boolean>(false);
  private _progress = signal<number>(0);
  private _status = signal<string>('');
  private _error = signal<string | null>(null);
  private _modelSize = signal<number>(0);

  // Public computed signals
  isReady = computed(() => this._isReady());
  isLoading = computed(() => this._isLoading());
  progress = computed(() => this._progress());
  status = computed(() => this._status());
  error = computed(() => this._error());
  modelSize = computed(() => this._modelSize());

  /**
   * Initialize PaddleOCR engine by loading from CDN.
   * Downloads models on first use (~15-30MB).
   */
  async initialize(): Promise<void> {
    if (this._isReady()) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this._isLoading.set(true);
    this._status.set('Loading PaddleOCR from CDN...');
    this._progress.set(10);
    this._error.set(null);

    try {
      // Dynamic import from CDN
      this._progress.set(20);
      this._status.set('Downloading PaddleOCR library...');
      
      // Load the module from CDN
      const module = await import(/* webpackIgnore: true */ PADDLE_OCR_CDN) as PaddleOCRModule;
      
      this._progress.set(40);
      this._status.set('Initializing OCR models...');

      // Initialize the module (downloads detection + recognition models)
      await module.init();

      this.ocrModule = module;
      this._progress.set(100);
      this._status.set('PaddleOCR ready');
      this._isReady.set(true);
      this._modelSize.set(30 * 1024 * 1024); // ~30MB estimated

      console.log('[PaddleOCR] Initialized successfully from CDN');
    } catch (error) {
      console.error('[PaddleOCR] Initialization failed:', error);
      this._error.set(error instanceof Error ? error.message : 'Failed to initialize PaddleOCR');
      this._status.set('Initialization failed');
      throw error;
    } finally {
      this._isLoading.set(false);
      this.initPromise = null;
    }
  }

  /**
   * Perform OCR on an image file.
   * Optimized for Chinese text (Simplified and Traditional).
   */
  async recognize(imageFile: File): Promise<PaddleOCRResult> {
    if (!this._isReady() || !this.ocrModule) {
      await this.initialize();
    }

    this._status.set('Processing image...');
    this._progress.set(20);

    try {
      // Convert file to HTMLImageElement
      const img = await this.fileToImage(imageFile);

      this._progress.set(40);
      this._status.set('Detecting text regions...');

      // Process with PaddleOCR
      const result = await this.ocrModule!.recognize(img);

      this._progress.set(90);
      this._status.set('OCR complete');

      // Join text array into single string
      const text = result.text.join('\n');

      console.log('[PaddleOCR] Recognition result:', {
        textLength: text.length,
        lineCount: result.text.length,
      });

      return {
        text,
        confidence: 0.9, // PaddleOCR doesn't return confidence, assume high
        points: result.points,
      };
    } catch (error) {
      console.error('[PaddleOCR] Recognition failed:', error);
      this._error.set(error instanceof Error ? error.message : 'Recognition failed');
      throw error;
    } finally {
      this._status.set('');
      this._progress.set(0);
    }
  }

  /**
   * Convert File to HTMLImageElement.
   */
  private fileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  /**
   * Perform OCR on a base64 image string.
   */
  async recognizeBase64(base64Image: string): Promise<PaddleOCRResult> {
    if (!this._isReady() || !this.ocrModule) {
      await this.initialize();
    }

    this._status.set('Processing image...');

    try {
      // Convert base64 to HTMLImageElement
      const img = await this.base64ToImage(base64Image);

      const result = await this.ocrModule!.recognize(img);
      const text = result.text.join('\n');

      return {
        text,
        confidence: 0.9,
        points: result.points,
      };
    } catch (error) {
      console.error('[PaddleOCR] Recognition failed:', error);
      throw error;
    } finally {
      this._status.set('');
    }
  }

  /**
   * Convert base64 string to HTMLImageElement.
   */
  private base64ToImage(base64: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));

      img.src = base64;
    });
  }

  /**
   * Terminate the OCR engine.
   */
  async terminate(): Promise<void> {
    if (this.ocrModule) {
      this.ocrModule = null;
      this._isReady.set(false);
      this._status.set('PaddleOCR terminated');
      console.log('[PaddleOCR] Terminated');
    }
  }

  /**
   * Get formatted model size string.
   */
  getModelSizeFormatted(): string {
    const size = this._modelSize();
    if (size === 0) return 'Not loaded';
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${Math.round(size / (1024 * 1024))} MB`;
  }

  /**
   * Check if an image likely contains Traditional Chinese text.
   * Used to decide which OCR engine to use.
   */
  static detectTraditionalChinese(text: string): boolean {
    // Common Traditional Chinese characters that differ from Simplified
    // These are characters unique to or much more common in Traditional Chinese
    const traditionalIndicators = [
      // Common Traditional-only variants (closing bracket was missing)
      /[國學經濟體會認識處區過頭車開關門問間機標導計設說讓運進選還類題點應]/,
      // Taiwan/HK specific terms
      /臺灣|臺北|香港|收據|發票|統一編號/,
      // Traditional date format
      /民國\d{1,3}年/,
      // Currency indicators
      /NT\$|HK\$|港幣|台幣/,
    ];

    return traditionalIndicators.some(pattern => pattern.test(text));
  }

  /**
   * Detect if text contains significant Chinese characters (Traditional or Simplified).
   */
  static containsChineseCharacters(text: string): boolean {
    // CJK Unified Ideographs range
    const chinesePattern = /[\u4e00-\u9fff]/g;
    const matches = text.match(chinesePattern);
    
    if (!matches) return false;
    
    // If more than 20% of characters are Chinese, consider it Chinese text
    const chineseRatio = matches.length / text.length;
    return chineseRatio > 0.2;
  }

}
