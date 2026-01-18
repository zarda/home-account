import { Injectable, inject, signal, computed } from '@angular/core';
import { GeminiService, ParsedReceipt } from './gemini.service';
import { LocalAIService, LocalTransaction, LocalProcessingMode } from './local-ai.service';
import { MLModelType } from './ml-worker.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';

export type AIProcessingMode = 'auto' | 'local_only' | 'cloud_only';
export type AIProcessingStrategy = 'speed' | 'accuracy' | 'privacy';

// Re-export types for convenience
export type { LocalProcessingMode } from './local-ai.service';
export type { MLModelType } from './ml-worker.service';

export interface AIPreferences {
  mode: AIProcessingMode;
  strategy: AIProcessingStrategy;
  privacyMode: boolean;
  autoSync: boolean;
  preferredLanguages: string[];
  confidenceThreshold: number;
  // Local AI processing mode (basic OCR vs enhanced with Transformers)
  localProcessingMode: LocalProcessingMode;
  // ML model preferences
  mlModelType: MLModelType;
  mlModelDownloaded: boolean;
}

export interface ProcessingResult {
  transactions: ProcessedTransaction[];
  source: 'local' | 'cloud' | 'hybrid';
  confidence: number;
  processingTimeMs: number;
  usedFallback: boolean;
  rawText?: string;
}

export interface ProcessedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  confidence: number;
  source: 'local' | 'cloud';
}

const DEFAULT_PREFERENCES: AIPreferences = {
  mode: 'auto',
  strategy: 'accuracy',
  privacyMode: false,
  autoSync: true,
  preferredLanguages: ['eng', 'jpn'],
  confidenceThreshold: 0.7,
  localProcessingMode: 'basic',
  mlModelType: 'embeddings',
  mlModelDownloaded: false,
};

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

@Injectable({ providedIn: 'root' })
export class AIStrategyService {
  private geminiService = inject(GeminiService);
  private localAIService = inject(LocalAIService);
  private pwaService = inject(PwaService);
  private authService = inject(AuthService);

  // State signals
  private _preferences = signal<AIPreferences>(this.loadPreferences());
  private _isProcessing = signal<boolean>(false);
  private _currentSource = signal<'local' | 'cloud' | null>(null);
  private _lastProcessingTime = signal<number>(0);

  // Public computed signals
  preferences = computed(() => this._preferences());
  isProcessing = computed(() => this._isProcessing());
  currentSource = computed(() => this._currentSource());
  lastProcessingTime = computed(() => this._lastProcessingTime());

  // Computed: Can use cloud AI
  canUseCloud = computed(() => 
    this.pwaService.isOnline() && this.geminiService.isAvailable()
  );

  // Computed: Can use local AI
  canUseLocal = computed(() => this.localAIService.isReady());

  // Computed: Recommended mode based on conditions
  recommendedMode = computed((): 'local' | 'cloud' => {
    const prefs = this._preferences();
    const isOnline = this.pwaService.isOnline();
    const geminiAvailable = this.geminiService.isAvailable();
    const localReady = this.localAIService.isReady();

    // Privacy mode forces local
    if (prefs.privacyMode) {
      return 'local';
    }

    // Offline forces local
    if (!isOnline) {
      return 'local';
    }

    // Strategy-based decision
    switch (prefs.strategy) {
      case 'privacy':
        return 'local';
      case 'speed':
        return localReady ? 'local' : 'cloud';
      case 'accuracy':
        return geminiAvailable ? 'cloud' : 'local';
      default:
        return geminiAvailable ? 'cloud' : 'local';
    }
  });

  constructor() {
    // Initialize local AI in background if models should be preloaded
    this.initializeLocalAI();
  }

  private async initializeLocalAI(): Promise<void> {
    const prefs = this._preferences();
    
    // Preload models if privacy mode or local-only mode
    if (prefs.mode === 'local_only' || prefs.privacyMode) {
      try {
        await this.localAIService.initialize(prefs.preferredLanguages);
      } catch (error) {
        console.warn('[AIStrategy] Failed to preload local AI:', error);
      }
    }
  }

  /**
   * Update AI preferences.
   */
  updatePreferences(updates: Partial<AIPreferences>): void {
    const current = this._preferences();
    const updated = { ...current, ...updates };
    this._preferences.set(updated);
    this.savePreferences(updated);

    // Reinitialize local AI if languages changed
    if (updates.preferredLanguages) {
      this.localAIService.terminate().then(() => {
        this.localAIService.initialize(updated.preferredLanguages);
      });
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
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      const prefs = this._preferences();
      const mode = this.determineProcessingMode(prefs);

      let result: ProcessingResult;

      switch (mode) {
        case 'local':
          result = await this.processWithLocal(imageFile);
          break;
        case 'cloud':
          result = await this.processWithCloud(imageFile);
          break;
        case 'hybrid':
          result = await this.processWithHybrid(imageFile, prefs);
          break;
        default:
          result = await this.processWithHybrid(imageFile, prefs);
      }

      const processingTimeMs = performance.now() - startTime;
      this._lastProcessingTime.set(processingTimeMs);

      return {
        ...result,
        processingTimeMs,
      };
    } finally {
      this._isProcessing.set(false);
      this._currentSource.set(null);
    }
  }

  /**
   * Process multiple images of a receipt.
   */
  async processMultipleImages(imageFiles: File[]): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    try {
      const prefs = this._preferences();
      const mode = this.determineProcessingMode(prefs);

      let result: ProcessingResult;

      switch (mode) {
        case 'local':
          result = await this.processMultipleWithLocal(imageFiles);
          break;
        case 'cloud':
          result = await this.processMultipleWithCloud(imageFiles);
          break;
        case 'hybrid':
          result = await this.processMultipleWithHybrid(imageFiles, prefs);
          break;
        default:
          result = await this.processMultipleWithHybrid(imageFiles, prefs);
      }

      const processingTimeMs = performance.now() - startTime;
      this._lastProcessingTime.set(processingTimeMs);

      return {
        ...result,
        processingTimeMs,
      };
    } finally {
      this._isProcessing.set(false);
      this._currentSource.set(null);
    }
  }

  /**
   * Determine which processing mode to use.
   */
  private determineProcessingMode(prefs: AIPreferences): 'local' | 'cloud' | 'hybrid' {
    const isOnline = this.pwaService.isOnline();
    const geminiAvailable = this.geminiService.isAvailable();

    // Forced modes
    if (prefs.mode === 'local_only' || prefs.privacyMode) {
      return 'local';
    }

    if (prefs.mode === 'cloud_only') {
      if (!isOnline || !geminiAvailable) {
        throw new Error('Cloud AI is not available. Please check your internet connection or enable local processing.');
      }
      return 'cloud';
    }

    // Auto mode
    if (!isOnline) {
      return 'local';
    }

    if (prefs.strategy === 'privacy') {
      return 'local';
    }

    if (prefs.strategy === 'accuracy' && geminiAvailable) {
      return 'cloud';
    }

    // Default: use hybrid (try local, fallback to cloud)
    return 'hybrid';
  }

  /**
   * Process with local AI only.
   */
  private async processWithLocal(imageFile: File): Promise<ProcessingResult> {
    this._currentSource.set('local');

    // Initialize if needed
    if (!this.localAIService.isReady()) {
      const prefs = this._preferences();
      await this.localAIService.initialize(prefs.preferredLanguages);
    }

    const localResult = await this.localAIService.processReceipt(imageFile);

    return {
      transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
      source: 'local',
      confidence: localResult.confidence,
      processingTimeMs: localResult.processingTimeMs,
      usedFallback: false,
      rawText: localResult.rawText,
    };
  }

  /**
   * Process with cloud AI only.
   */
  private async processWithCloud(imageFile: File): Promise<ProcessingResult> {
    this._currentSource.set('cloud');

    const imageBase64 = await this.fileToBase64(imageFile);
    const receipt = await this.geminiService.parseReceipt(imageBase64);

    return {
      transactions: [this.convertParsedReceipt(receipt)],
      source: 'cloud',
      confidence: receipt.confidence,
      processingTimeMs: 0, // Will be filled by caller
      usedFallback: false,
    };
  }

  /**
   * Process with hybrid strategy: try local first, fallback to cloud if needed.
   */
  private async processWithHybrid(imageFile: File, prefs: AIPreferences): Promise<ProcessingResult> {
    // Try local first
    this._currentSource.set('local');
    
    try {
      if (!this.localAIService.isReady()) {
        await this.localAIService.initialize(prefs.preferredLanguages);
      }

      const localResult = await this.localAIService.processReceipt(imageFile);

      // Check if confidence is good enough
      if (localResult.confidence >= prefs.confidenceThreshold) {
        return {
          transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
          source: 'local',
          confidence: localResult.confidence,
          processingTimeMs: localResult.processingTimeMs,
          usedFallback: false,
          rawText: localResult.rawText,
        };
      }

      // Low confidence, try cloud if available
      if (this.canUseCloud()) {
        console.log('[AIStrategy] Low local confidence, falling back to cloud');
        this._currentSource.set('cloud');

        const imageBase64 = await this.fileToBase64(imageFile);
        const receipt = await this.geminiService.parseReceipt(imageBase64);

        return {
          transactions: [this.convertParsedReceipt(receipt)],
          source: 'hybrid',
          confidence: receipt.confidence,
          processingTimeMs: localResult.processingTimeMs,
          usedFallback: true,
        };
      }

      // Can't use cloud, return local result even with low confidence
      return {
        transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
        source: 'local',
        confidence: localResult.confidence,
        processingTimeMs: localResult.processingTimeMs,
        usedFallback: false,
        rawText: localResult.rawText,
      };
    } catch (localError) {
      console.warn('[AIStrategy] Local processing failed:', localError);

      // Try cloud as fallback
      if (this.canUseCloud()) {
        this._currentSource.set('cloud');
        const imageBase64 = await this.fileToBase64(imageFile);
        const receipt = await this.geminiService.parseReceipt(imageBase64);

        return {
          transactions: [this.convertParsedReceipt(receipt)],
          source: 'cloud',
          confidence: receipt.confidence,
          processingTimeMs: 0,
          usedFallback: true,
        };
      }

      throw localError;
    }
  }

  /**
   * Process multiple images with local AI.
   */
  private async processMultipleWithLocal(imageFiles: File[]): Promise<ProcessingResult> {
    this._currentSource.set('local');

    if (!this.localAIService.isReady()) {
      const prefs = this._preferences();
      await this.localAIService.initialize(prefs.preferredLanguages);
    }

    const localResult = await this.localAIService.processMultipleImages(imageFiles);

    return {
      transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
      source: 'local',
      confidence: localResult.confidence,
      processingTimeMs: localResult.processingTimeMs,
      usedFallback: false,
      rawText: localResult.rawText,
    };
  }

  /**
   * Process multiple images with cloud AI.
   */
  private async processMultipleWithCloud(imageFiles: File[]): Promise<ProcessingResult> {
    this._currentSource.set('cloud');

    const imageBase64Array: string[] = [];
    for (const file of imageFiles) {
      const base64 = await this.fileToBase64(file);
      imageBase64Array.push(base64);
    }

    const extracted = await this.geminiService.extractTransactionsFromMultipleImages(imageBase64Array);

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
      usedFallback: false,
    };
  }

  /**
   * Process multiple images with hybrid strategy.
   */
  private async processMultipleWithHybrid(imageFiles: File[], prefs: AIPreferences): Promise<ProcessingResult> {
    // Try local first
    this._currentSource.set('local');

    try {
      if (!this.localAIService.isReady()) {
        await this.localAIService.initialize(prefs.preferredLanguages);
      }

      const localResult = await this.localAIService.processMultipleImages(imageFiles);

      if (localResult.confidence >= prefs.confidenceThreshold) {
        return {
          transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
          source: 'local',
          confidence: localResult.confidence,
          processingTimeMs: localResult.processingTimeMs,
          usedFallback: false,
          rawText: localResult.rawText,
        };
      }

      // Low confidence, try cloud as fallback
      if (this.canUseCloud()) {
        const cloudResult = await this.processMultipleWithCloud(imageFiles);
        // Mark as hybrid fallback (consistent with single-image behavior)
        return {
          ...cloudResult,
          source: 'hybrid',
          usedFallback: true,
        };
      }

      return {
        transactions: localResult.transactions.map(t => this.convertLocalTransaction(t)),
        source: 'local',
        confidence: localResult.confidence,
        processingTimeMs: localResult.processingTimeMs,
        usedFallback: false,
        rawText: localResult.rawText,
      };
    } catch (localError) {
      if (this.canUseCloud()) {
        const cloudResult = await this.processMultipleWithCloud(imageFiles);
        // Mark as hybrid fallback due to local error
        return {
          ...cloudResult,
          source: 'hybrid',
          usedFallback: true,
        };
      }
      throw localError;
    }
  }

  /**
   * Convert local transaction to processed transaction.
   */
  private convertLocalTransaction(tx: LocalTransaction): ProcessedTransaction {
    return {
      date: new Date(tx.date),
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      currency: tx.currency,
      confidence: tx.confidence,
      source: 'local',
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
    localReady: boolean;
    cloudAvailable: boolean;
    isOnline: boolean;
    currentMode: string;
    modelSize: number;
  } {
    return {
      localReady: this.localAIService.isReady(),
      cloudAvailable: this.geminiService.isAvailable(),
      isOnline: this.pwaService.isOnline(),
      currentMode: this.recommendedMode(),
      modelSize: this.localAIService.modelSize(),
    };
  }

  /**
   * Preload local AI models for offline use.
   */
  async preloadLocalModels(): Promise<void> {
    const prefs = this._preferences();
    await this.localAIService.preloadModels(prefs.preferredLanguages);
  }

  /**
   * Clear local AI models.
   */
  async clearLocalModels(): Promise<void> {
    await this.localAIService.terminate();
    await this.pwaService.clearModelCache();
  }
}
