import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ParsedReceipt } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { LLMProvider } from '../../models';
import VisionOCR, { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import AppleIntelligence from '../plugins/apple-intelligence.plugin';

export interface AIPreferences {
  autoSync: boolean;
  textModel?: string;      // Model ID for text tasks
  visionModel?: string;    // Model ID for vision tasks
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
  notes?: string;
  suggestedCategoryId?: string;
}

const DEFAULT_PREFERENCES: AIPreferences = {
  autoSync: true,
  textModel: 'gemini-2.5-flash',
  visionModel: 'gemini-3.1-flash-lite-preview',
};

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

@Injectable({ providedIn: 'root' })
export class AIStrategyService {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private pwaService = inject(PwaService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);

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

  // True when the iOS build is running on macOS (Apple Silicon / Mac Catalyst).
  // Seeded from a user-agent heuristic, refined by the native plugin on startup.
  private _isMacEnvironment = signal<boolean>(this.detectMacEnvironmentFromUserAgent());
  isMacEnvironment = computed(() => this._isMacEnvironment());

  // True when Apple's on-device foundation model (Apple Intelligence) is
  // usable — iOS 26 / macOS 26 with Apple Intelligence enabled.
  private _appleIntelligenceAvailable = signal<boolean>(false);
  canUseAppleIntelligence = computed(() => this._appleIntelligenceAvailable());

  // Computed: Can use cloud AI (any provider)
  canUseCloud = computed(() =>
    this.pwaService.isOnline() && this.cloudLLMProvider.hasAnyCloudProvider()
  );

  // Computed: Can use native AI (iOS and macOS via the Vision framework)
  canUseNative = computed(() => this.platform() === 'ios');

  // Computed: Route receipts to the native pipeline. With Apple Intelligence
  // the native pipeline (Vision OCR + on-device model) is preferred wherever
  // it is available. Without it, Macs prefer the newer cloud models
  // (Gemini 3.1 / Gemma 4) over the regex-based OCR parser.
  useNativeOCR = computed(() =>
    this.canUseNative() &&
    (this.canUseAppleIntelligence() || !(this.isMacEnvironment() && this.canUseCloud()))
  );

  // Computed: Available cloud providers
  availableCloudProviders = computed(() => this.cloudLLMProvider.availableProviders());

  constructor() {
    // Initialize cloud providers from user preferences
    console.log('[AIStrategy] Initializing from user preferences on app start');
    this.cloudLLMProvider.initializeFromUserPreferences();

    // Refine Mac detection with the native API (the UA check is a heuristic)
    // and probe for Apple's on-device foundation model
    if (Capacitor.getPlatform() === 'ios') {
      VisionOCR.isAvailable()
        .then(({ isMacEnvironment }) => {
          if (typeof isMacEnvironment === 'boolean') {
            this._isMacEnvironment.set(isMacEnvironment);
          }
        })
        .catch(() => console.warn('[AIStrategy] Unable to query Mac environment from native plugin'));

      AppleIntelligence.isAvailable()
        .then(({ available, reason }) => {
          this._appleIntelligenceAvailable.set(available === true);
          console.log(`[AIStrategy] Apple Intelligence available: ${available}${reason ? ` (${reason})` : ''}`);
        })
        .catch(() => console.log('[AIStrategy] Apple Intelligence plugin not present in this binary'));
    }

    // Reinitialize cloud providers when user data changes (e.g., API key updated)
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        console.log('[AIStrategy] User loaded, checking for API keys');
        if (user.preferences?.geminiApiKey) {
          console.log('[AIStrategy] Found Gemini API key, reinitializing');
          this.cloudLLMProvider.initializeFromUserPreferences();
        }
        if (user.preferences?.openaiApiKey) {
          console.log('[AIStrategy] Found OpenAI API key, reinitializing');
          this.cloudLLMProvider.initializeFromUserPreferences();
        }
        if (user.preferences?.claudeApiKey) {
          console.log('[AIStrategy] Found Claude API key, reinitializing');
          this.cloudLLMProvider.initializeFromUserPreferences();
        }
      } else {
        console.log('[AIStrategy] No user loaded yet');
      }
    });
  }

  /**
   * Update AI preferences.
   */
  updatePreferences(updates: Partial<AIPreferences>): void {
    const current = this._preferences();
    const updated = { ...current, ...updates };
    this._preferences.set(updated);
    this.savePreferences(updated);

    // If models changed, reinitialize Gemini service with error handling
    if (updates.textModel || updates.visionModel) {
      try {
        this.cloudLLMProvider.reinitializeGemini(updated.textModel, updated.visionModel);
        console.log('[AIStrategy] Models updated successfully:', {
          textModel: updated.textModel,
          visionModel: updated.visionModel
        });
      } catch (error) {
        console.error('[AIStrategy] Failed to reinitialize Gemini with new models:', error);
        // Revert to previous preferences on error
        this._preferences.set(current);
        this.savePreferences(current);
        throw new Error('Failed to switch AI models. Please try again.');
      }
    }
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
   * - On iPhone/iPad: Uses native Vision OCR
   * - On Web: Uses cloud AI (Gemini/OpenAI/Claude)
   * - On macOS (iOS app on Mac): Prefers cloud AI, falls back to native OCR
   */
  async processReceipt(imageFile: File): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      let result: ProcessingResult;

      if (this.useNativeOCR()) {
        result = await this.processWithNative(imageFile);
      } else {
        try {
          result = await this.processWithCloud(imageFile);
        } catch (error) {
          // On Macs native OCR remains available as a fallback when cloud fails
          if (!this.canUseNative()) {
            throw error;
          }
          console.warn('[AIStrategy] Cloud AI failed, falling back to native OCR:', error);
          result = await this.processWithNative(imageFile);
        }
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

      if (this.useNativeOCR()) {
        // iPhone/iPad: Process each image with native OCR and combine
        result = await this.processMultipleWithNative(imageFiles);
      } else {
        try {
          result = await this.processMultipleWithCloud(imageFiles);
        } catch (error) {
          // On Macs native OCR remains available as a fallback when cloud fails
          if (!this.canUseNative()) {
            throw error;
          }
          console.warn('[AIStrategy] Cloud AI failed, falling back to native OCR:', error);
          result = await this.processMultipleWithNative(imageFiles);
        }
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

      // Structure the OCR result into a transaction
      const transaction = await this.structureOCRResult(ocrResult);

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

        const transaction = await this.structureOCRResult(ocrResult);
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
   * Structure an OCR result into a transaction. Uses Apple's on-device
   * foundation model when available; falls back to the regex-based parser.
   */
  private async structureOCRResult(ocrResult: VisionOCRResult): Promise<ProcessedTransaction> {
    if (this.canUseAppleIntelligence()) {
      try {
        return await this.parseOCRWithAppleIntelligence(ocrResult);
      } catch (error) {
        console.warn('[AIStrategy] Apple Intelligence parsing failed, using basic parser:', error);
      }
    }
    return this.parseOCRResult(ocrResult);
  }

  /**
   * Structure OCR text into a transaction with Apple's on-device foundation
   * model (Apple Intelligence). Runs entirely on device.
   */
  private async parseOCRWithAppleIntelligence(ocrResult: VisionOCRResult): Promise<ProcessedTransaction> {
    const categories = this.categoryService.categories();
    const extraction = await AppleIntelligence.parseReceiptText({
      text: ocrResult.text,
      categories: categories.map(c => c.name),
    });

    const parsedDate = extraction.date ? new Date(extraction.date) : new Date();
    const matchedCategory = extraction.category
      ? categories.find(c => c.name.toLowerCase() === extraction.category.toLowerCase())
      : undefined;

    return {
      date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
      description: extraction.merchant || 'Unknown Merchant',
      amount: Math.abs(extraction.amount) || 0,
      type: 'expense',
      currency: extraction.currency || 'USD',
      confidence: ocrResult.confidence,
      source: 'native',
      notes: extraction.details || undefined,
      suggestedCategoryId: matchedCategory?.id,
    };
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
      notes: t.details,
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
      notes: receipt.receiptDetails
        || receipt.items?.map(item => `${item.name} — ${receipt.currency} ${item.amount.toLocaleString('en', { minimumFractionDigits: receipt.currency === 'JPY' ? 0 : 2 })}`).join('\n')
        || '',
      suggestedCategoryId: receipt.suggestedCategory,
    };
  }

  /**
   * Detect "iOS app running on macOS" from the user agent.
   * On a Mac the WKWebView reports a Macintosh UA without touch support,
   * while iPhones/iPads report touch points even with a desktop UA.
   */
  private detectMacEnvironmentFromUserAgent(): boolean {
    if (Capacitor.getPlatform() !== 'ios') {
      return false;
    }
    return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints === 0;
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
    appleIntelligenceAvailable: boolean;
    isMacEnvironment: boolean;
    isOnline: boolean;
    platform: string;
    availableProviders: LLMProvider[];
    providerStatus: { gemini: boolean; openai: boolean; claude: boolean };
  } {
    return {
      cloudAvailable: this.cloudLLMProvider.hasAnyCloudProvider(),
      nativeAvailable: this.canUseNative(),
      appleIntelligenceAvailable: this.canUseAppleIntelligence(),
      isMacEnvironment: this.isMacEnvironment(),
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
