import { Injectable, inject, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ParsedReceipt } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { LLMProvider } from '../../models';
import VisionOCR, { VisionOCRResult } from '../plugins/vision-ocr.plugin';

export interface AIPreferences {
  autoSync: boolean;
}

export interface ProcessingResult {
  transactions: ProcessedTransaction[];
  source: 'cloud' | 'native';
  confidence: number;
  processingTimeMs: number;
}

export interface ProcessedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  confidence: number;
  source: 'cloud' | 'native';
}

const DEFAULT_PREFERENCES: AIPreferences = {
  autoSync: true,
};

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

@Injectable({ providedIn: 'root' })
export class AIStrategyService {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private pwaService = inject(PwaService);

  // State signals
  private _preferences = signal<AIPreferences>(this.loadPreferences());
  private _isProcessing = signal<boolean>(false);
  private _lastProcessingTime = signal<number>(0);

  // Public computed signals
  preferences = computed(() => this._preferences());
  isProcessing = computed(() => this._isProcessing());
  lastProcessingTime = computed(() => this._lastProcessingTime());

  // Platform detection
  isNativePlatform = computed(() => Capacitor.isNativePlatform());
  platform = computed(() => Capacitor.getPlatform());

  // Computed: Can use cloud AI (any provider)
  canUseCloud = computed(() => 
    this.pwaService.isOnline() && this.cloudLLMProvider.hasAnyCloudProvider()
  );

  // Computed: Can use native AI (iOS only)
  canUseNative = computed(() => this.platform() === 'ios');

  // Computed: Available cloud providers
  availableCloudProviders = computed(() => this.cloudLLMProvider.availableProviders());

  constructor() {
    // Initialize cloud providers from user preferences
    this.cloudLLMProvider.initializeFromUserPreferences();
  }

  /**
   * Update AI preferences.
   */
  updatePreferences(updates: Partial<AIPreferences>): void {
    const current = this._preferences();
    const updated = { ...current, ...updates };
    this._preferences.set(updated);
    this.savePreferences(updated);
  }

  /**
   * Reset preferences to defaults.
   */
  resetPreferences(): void {
    this._preferences.set(DEFAULT_PREFERENCES);
    this.savePreferences(DEFAULT_PREFERENCES);
  }

  /**
   * Process a receipt image using the appropriate AI strategy.
   * - On iOS: Uses native Vision OCR
   * - On Web: Uses cloud AI (Gemini/OpenAI/Claude)
   */
  async processReceipt(imageFile: File): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      let result: ProcessingResult;

      if (this.canUseNative()) {
        // iOS: Use native Vision OCR
        result = await this.processWithNative(imageFile);
      } else {
        // Web: Use cloud AI
        result = await this.processWithCloud(imageFile);
      }

      const processingTimeMs = performance.now() - startTime;
      this._lastProcessingTime.set(processingTimeMs);

      return {
        ...result,
        processingTimeMs,
      };
    } finally {
      this._isProcessing.set(false);
    }
  }

  /**
   * Process multiple images of a receipt.
   */
  async processMultipleImages(imageFiles: File[]): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      let result: ProcessingResult;

      if (this.canUseNative()) {
        // iOS: Process each image with native OCR and combine
        result = await this.processMultipleWithNative(imageFiles);
      } else {
        // Web: Use cloud AI
        result = await this.processMultipleWithCloud(imageFiles);
      }

      const processingTimeMs = performance.now() - startTime;
      this._lastProcessingTime.set(processingTimeMs);

      return {
        ...result,
        processingTimeMs,
      };
    } finally {
      this._isProcessing.set(false);
    }
  }

  /**
   * Process with native iOS Vision OCR.
   */
  private async processWithNative(imageFile: File): Promise<ProcessingResult> {
    console.log('[AIStrategy] Processing with native Vision OCR');
    
    try {
      // Check if Vision OCR is available
      const { available } = await VisionOCR.isAvailable();
      if (!available) {
        console.warn('[AIStrategy] Vision OCR not available, falling back to cloud');
        if (this.canUseCloud()) {
          return this.processWithCloud(imageFile);
        }
        throw new Error('Vision OCR is not available on this device.');
      }

      // Convert file to base64
      const imageBase64 = await this.fileToBase64(imageFile);
      
      // Perform OCR
      const ocrResult = await VisionOCR.recognizeText({
        image: imageBase64,
        languages: ['en-US', 'ja-JP', 'zh-Hant'],
      });

      // Parse the OCR result into a transaction
      const transaction = this.parseOCRResult(ocrResult);

      return {
        transactions: [transaction],
        source: 'native',
        confidence: ocrResult.confidence,
        processingTimeMs: 0,
      };
    } catch (error) {
      console.error('[AIStrategy] Native OCR failed:', error);
      
      // Fall back to cloud if available
      if (this.canUseCloud()) {
        console.log('[AIStrategy] Falling back to cloud AI');
        return this.processWithCloud(imageFile);
      }
      
      throw error;
    }
  }

  /**
   * Process multiple images with native iOS Vision OCR.
   */
  private async processMultipleWithNative(imageFiles: File[]): Promise<ProcessingResult> {
    console.log('[AIStrategy] Processing multiple images with native Vision OCR');
    
    try {
      const { available } = await VisionOCR.isAvailable();
      if (!available) {
        console.warn('[AIStrategy] Vision OCR not available, falling back to cloud');
        if (this.canUseCloud()) {
          return this.processMultipleWithCloud(imageFiles);
        }
        throw new Error('Vision OCR is not available on this device.');
      }

      const transactions: ProcessedTransaction[] = [];
      let totalConfidence = 0;

      for (const file of imageFiles) {
        const imageBase64 = await this.fileToBase64(file);
        
        const ocrResult = await VisionOCR.recognizeText({
          image: imageBase64,
          languages: ['en-US', 'ja-JP', 'zh-Hant'],
        });

        const transaction = this.parseOCRResult(ocrResult);
        transactions.push(transaction);
        totalConfidence += ocrResult.confidence;
      }

      const avgConfidence = transactions.length > 0 
        ? totalConfidence / transactions.length 
        : 0;

      return {
        transactions,
        source: 'native',
        confidence: avgConfidence,
        processingTimeMs: 0,
      };
    } catch (error) {
      console.error('[AIStrategy] Native OCR failed for multiple images:', error);
      
      if (this.canUseCloud()) {
        console.log('[AIStrategy] Falling back to cloud AI');
        return this.processMultipleWithCloud(imageFiles);
      }
      
      throw error;
    }
  }

  /**
   * Parse OCR result text to extract transaction data.
   * This is a basic parser that extracts date, amount, and merchant from OCR text.
   */
  private parseOCRResult(ocrResult: VisionOCRResult): ProcessedTransaction {
    const text = ocrResult.text;
    const lines = text.split('\n').filter(line => line.trim());
    
    // Try to extract date
    const datePatterns = [
      /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,  // MM/DD/YYYY or DD/MM/YYYY
      /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/,     // YYYY/MM/DD
      /(\w{3,})\s+(\d{1,2}),?\s+(\d{4})/i,     // Month DD, YYYY
    ];
    
    let extractedDate = new Date();
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = new Date(match[0]);
        if (!isNaN(parsed.getTime())) {
          extractedDate = parsed;
          break;
        }
      }
    }

    // Try to extract amount (look for currency patterns)
    const amountPatterns = [
      /(?:total|amount|due|pay|sum|charge)[:\s]*[¥$€£]?\s*([\d,]+\.?\d*)/i,
      /[¥$€£]\s*([\d,]+\.?\d*)/,
      /([\d,]+\.?\d*)\s*(?:円|yen|usd|thb)/i,
    ];
    
    let extractedAmount = 0;
    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) {
          extractedAmount = amount;
          break;
        }
      }
    }

    // Try to extract currency
    let extractedCurrency = 'USD';
    if (text.includes('¥') || text.includes('円') || /yen/i.test(text)) {
      extractedCurrency = 'JPY';
    } else if (text.includes('€')) {
      extractedCurrency = 'EUR';
    } else if (text.includes('£')) {
      extractedCurrency = 'GBP';
    } else if (/THB|฿|baht/i.test(text)) {
      extractedCurrency = 'THB';
    }

    // Use first non-empty line as merchant name (typically at top of receipt)
    const merchant = lines[0] || 'Unknown Merchant';

    return {
      date: extractedDate,
      description: merchant,
      amount: extractedAmount,
      type: 'expense',
      currency: extractedCurrency,
      confidence: ocrResult.confidence,
      source: 'native',
    };
  }

  /**
   * Process with cloud AI.
   */
  private async processWithCloud(imageFile: File): Promise<ProcessingResult> {
    if (!this.canUseCloud()) {
      throw new Error('Cloud AI is not available. Please check your internet connection and configure an API key in Profile Settings.');
    }

    const imageBase64 = await this.fileToBase64(imageFile);
    const receipt = await this.cloudLLMProvider.parseReceipt(imageBase64);

    return {
      transactions: [this.convertParsedReceipt(receipt)],
      source: 'cloud',
      confidence: receipt.confidence,
      processingTimeMs: 0,
    };
  }

  /**
   * Process multiple images with cloud AI.
   */
  private async processMultipleWithCloud(imageFiles: File[]): Promise<ProcessingResult> {
    if (!this.canUseCloud()) {
      throw new Error('Cloud AI is not available. Please check your internet connection and configure an API key in Profile Settings.');
    }

    const imageBase64Array: string[] = [];
    for (const file of imageFiles) {
      const base64 = await this.fileToBase64(file);
      imageBase64Array.push(base64);
    }

    const extracted = await this.cloudLLMProvider.extractTransactionsFromMultipleImages(imageBase64Array);

    const transactions: ProcessedTransaction[] = extracted.map(t => ({
      date: new Date(t.date),
      description: t.description,
      amount: t.amount,
      type: t.type,
      currency: t.currency,
      confidence: t.confidence,
      source: 'cloud' as const,
    }));

    const avgConfidence = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + t.confidence, 0) / transactions.length
      : 0;

    return {
      transactions,
      source: 'cloud',
      confidence: avgConfidence,
      processingTimeMs: 0,
    };
  }

  /**
   * Convert parsed receipt to processed transaction.
   */
  private convertParsedReceipt(receipt: ParsedReceipt): ProcessedTransaction {
    return {
      date: receipt.date,
      description: receipt.merchant,
      amount: receipt.amount,
      type: 'expense',
      currency: receipt.currency,
      confidence: receipt.confidence,
      source: 'cloud',
    };
  }

  /**
   * Convert file to base64.
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
   * Load preferences from localStorage.
   */
  private loadPreferences(): AIPreferences {
    try {
      const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch {
      console.warn('[AIStrategy] Failed to load preferences');
    }
    return DEFAULT_PREFERENCES;
  }

  /**
   * Save preferences to localStorage.
   */
  private savePreferences(prefs: AIPreferences): void {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      console.warn('[AIStrategy] Failed to save preferences');
    }
  }

  /**
   * Get status information for UI.
   */
  getStatusInfo(): {
    cloudAvailable: boolean;
    nativeAvailable: boolean;
    isOnline: boolean;
    platform: string;
    availableProviders: LLMProvider[];
    providerStatus: { gemini: boolean; openai: boolean; claude: boolean };
  } {
    return {
      cloudAvailable: this.cloudLLMProvider.hasAnyCloudProvider(),
      nativeAvailable: this.canUseNative(),
      isOnline: this.pwaService.isOnline(),
      platform: this.platform(),
      availableProviders: this.cloudLLMProvider.availableProviders(),
      providerStatus: this.cloudLLMProvider.providerStatus(),
    };
  }

  /**
   * Update a cloud provider's API key.
   */
  updateCloudProviderApiKey(provider: LLMProvider, apiKey: string | undefined): void {
    this.cloudLLMProvider.updateProviderApiKey(provider, apiKey);
  }

  /**
   * Get the cloud LLM provider service for advanced configuration.
   */
  getCloudLLMProvider(): CloudLLMProviderService {
    return this.cloudLLMProvider;
  }
}
