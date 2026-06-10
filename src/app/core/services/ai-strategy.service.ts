import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ParsedReceipt } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { NativeReceiptService } from './native-receipt.service';
import { ProcessedTransaction, ProcessingResult } from './ai-types';
import { fileToBase64 } from '../utils/file.utils';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';
import { LLMProvider } from '../../models';

export type { ProcessedTransaction, ProcessingResult } from './ai-types';

export interface AIPreferences {
  autoSync: boolean;
  textModel?: string;      // Model ID for text tasks
  visionModel?: string;    // Model ID for vision tasks
}

const DEFAULT_PREFERENCES: AIPreferences = {
  autoSync: true,
  textModel: DEFAULT_TEXT_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
};

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

/**
 * Routes receipt processing to the best available engine:
 * - On-device pipeline (Vision OCR + Apple Intelligence) on iPhone/iPad,
 *   and on Macs when Apple's foundation model is available
 * - Cloud AI (Gemini/OpenAI/Claude) on the web, and on Macs without
 *   Apple Intelligence
 * Each side falls back to the other when processing fails.
 */
@Injectable({ providedIn: 'root' })
export class AIStrategyService {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private pwaService = inject(PwaService);
  private authService = inject(AuthService);
  private visionOcr = inject(VisionOcrService);
  private appleIntelligence = inject(AppleIntelligenceService);
  private nativeReceipt = inject(NativeReceiptService);

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

  // True when the iOS build is running on macOS (Apple Silicon / Mac Catalyst)
  isMacEnvironment = computed(() => this.visionOcr.isMacEnvironment());

  // True when Apple's on-device foundation model (Apple Intelligence) is
  // usable — iOS 26 / macOS 26 with Apple Intelligence enabled
  canUseAppleIntelligence = computed(() => this.appleIntelligence.isModelAvailable());

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

    // Probe native capabilities (Mac environment, Apple Intelligence)
    if (this.canUseNative()) {
      this.visionOcr.detectEnvironment();
      this.appleIntelligence.detectAvailability();
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
   */
  async processReceipt(imageFile: File): Promise<ProcessingResult> {
    return this.runProcessing(
      () => this.nativeReceipt.processImage(imageFile),
      () => this.processWithCloud(imageFile),
    );
  }

  /**
   * Process multiple images of a receipt.
   */
  async processMultipleImages(imageFiles: File[]): Promise<ProcessingResult> {
    return this.runProcessing(
      () => this.nativeReceipt.processImages(imageFiles),
      () => this.processMultipleWithCloud(imageFiles),
    );
  }

  /**
   * Run native or cloud processing per the routing strategy, falling back
   * to the other engine when the preferred one fails.
   */
  private async runProcessing(
    native: () => Promise<ProcessingResult>,
    cloud: () => Promise<ProcessingResult>,
  ): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      let result: ProcessingResult;

      if (this.useNativeOCR()) {
        try {
          result = await native();
        } catch (error) {
          if (!this.canUseCloud()) {
            throw error;
          }
          console.warn('[AIStrategy] Native processing failed, falling back to cloud AI:', error);
          result = await cloud();
        }
      } else {
        try {
          result = await cloud();
        } catch (error) {
          if (!this.canUseNative()) {
            throw error;
          }
          console.warn('[AIStrategy] Cloud AI failed, falling back to native OCR:', error);
          result = await native();
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
   * Process with cloud AI.
   */
  private async processWithCloud(imageFile: File): Promise<ProcessingResult> {
    this.ensureCloudAvailable();

    const imageBase64 = await fileToBase64(imageFile);
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
    this.ensureCloudAvailable();

    const imageBase64Array: string[] = [];
    for (const file of imageFiles) {
      imageBase64Array.push(await fileToBase64(file));
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

  private ensureCloudAvailable(): void {
    if (!this.canUseCloud()) {
      throw new Error('Cloud AI is not available. Please check your internet connection and configure an API key in Profile Settings.');
    }
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
