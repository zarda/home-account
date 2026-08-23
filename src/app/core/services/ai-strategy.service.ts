import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ParsedReceipt } from './gemini.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { NativeReceiptService } from './native-receipt.service';
import { ProcessedTransaction, ProcessingResult, ReceiptAttemptDiagnostics } from './ai-types';
import { fileToBase64 } from '../utils/file.utils';
import { consolidateReceiptItems, formatReceiptItemLines } from '../utils/receipt-consolidation';
import { printedLocationSlot } from '../utils/receipt-extraction.utils';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_CLAUDE_MODEL } from '../config/ai-models';
import { AI_PREFERENCES_SCHEMA_VERSION, migrateModelPreferences } from '../config/ai-model-migrations';
import { Category, LLMProvider, baseCurrencyOf} from '../../models';
import { parseDateInput } from '../utils/transaction-date.utils';
import { AI_CLOUD_UNAVAILABLE, ReceiptProcessingError, parseAIError } from '../utils/ai-error.utils';

export type { ProcessedTransaction, ProcessingResult, ReceiptAttemptDiagnostics } from './ai-types';

export interface AIPreferences {
  autoSync: boolean;
  textModel?: string;      // Gemini model ID for text tasks
  visionModel?: string;    // Gemini model ID for vision tasks
  openaiModel?: string;    // OpenAI model ID (multimodal)
  claudeModel?: string;    // Claude model ID (multimodal)
  schemaVersion?: number;  // Shape of the stored blob; absent means pre-migration
}

const DEFAULT_PREFERENCES: AIPreferences = {
  autoSync: true,
  textModel: DEFAULT_TEXT_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
  openaiModel: DEFAULT_OPENAI_MODEL,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  // A fresh install is born current, so it never runs the migration pass.
  schemaVersion: AI_PREFERENCES_SCHEMA_VERSION,
};

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

/**
 * Confidence below which a result counts as "did not read the receipt".
 *
 * Set beneath the review threshold rather than at it: a row worth a second
 * look is still worth keeping, and only a result that read almost nothing is
 * worth spending a second engine on.
 */
const USABLE_CONFIDENCE = 0.4;

/** Re-exported so callers that import the code from here keep compiling. */
export { AI_CLOUD_UNAVAILABLE } from '../utils/ai-error.utils';

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

  /**
   * Some engine is configured, whatever the connectivity.
   *
   * This is what gates the receipt UI, not `canUseCloud()`. Attaching and
   * previewing receipt images has to keep working with no signal, and
   * `canUseCloud()` folds connectivity in — gating the UI on it would make the
   * whole receipt block vanish the moment the connection drops.
   */
  hasAnyEngine = computed(() =>
    this.cloudLLMProvider.hasAnyCloudProvider() || this.canUseNative()
  );

  /** An engine can actually run a scan right now. Gates issuing one. */
  canProcessNow = computed(() => this.canUseCloud() || this.useNativeOCR());

  // Computed: Available cloud providers
  availableCloudProviders = computed(() => this.cloudLLMProvider.availableProviders());

  /** The provider a receipt scan would actually go to, or null when none can. */
  receiptProvider = computed(() => this.cloudLLMProvider.resolveProvider('receiptScanning'));

  /** Account and connectivity state the cloud providers were last brought up for. */
  private providersInitializedFor = signal<string | null>(null);

  constructor() {
    // Apply the stored model selection at startup so the first request honors
    // the user's choice from AI settings. Keys, if any, arrive with the effect
    // below once the account resolves.
    console.log('[AIStrategy] Applying stored model selection on app start');
    void this.initializeCloudProviders();

    // Probe native capabilities (Mac environment, Apple Intelligence)
    if (this.canUseNative()) {
      this.visionOcr.detectEnvironment();
      this.appleIntelligence.detectAvailability();
    }

    // Bring the cloud providers up once per signed-in account. The keys are
    // no longer part of the user document, so there is nothing else on `user`
    // worth watching — a key the user edits in settings is applied directly by
    // the settings page.
    effect(() => {
      const userId = this.authService.userId();
      // Connectivity is a dependency on purpose: the keys are a separate
      // document now, so a load that fails offline would otherwise leave the
      // providers un-keyed for the rest of the session with nothing to retry
      // it. Re-running on reconnect is cheap — the key read is cached and
      // reinitialize() is a no-op when the key has not changed.
      const online = this.pwaService.isOnline();
      if (!userId) {
        // Sign-out. The providers are root singletons and a router navigation
        // does not touch them, so they have to be told. Guarded on having
        // actually been up: the effect also runs once at start-up before auth
        // resolves, and resetting there would clear the environment-key Gemini
        // the constructor just brought up.
        //
        // Driven from here rather than AuthService.signOut() because
        // ProviderKeyService injects AuthService — calling back the other way
        // would close a dependency cycle. The cost is that the reset lands a
        // microtask after sign-out resolves; sign-out navigates away, so
        // nothing can reach a provider in that window.
        if (this.providersInitializedFor() !== null) {
          void this.cloudLLMProvider.resetProviders();
        }
        this.providersInitializedFor.set(null);
        return;
      }

      const attempt = `${userId}:${online}`;
      if (this.providersInitializedFor() === attempt) return;

      this.providersInitializedFor.set(attempt);
      void this.initializeCloudProviders();
    });
  }

  /**
   * (Re)initialize cloud providers with the persisted model selection.
   */
  private async initializeCloudProviders(): Promise<void> {
    const prefs = this._preferences();
    this.cloudLLMProvider.setOpenAIModel(prefs.openaiModel ?? DEFAULT_OPENAI_MODEL);
    this.cloudLLMProvider.setClaudeModel(prefs.claudeModel ?? DEFAULT_CLAUDE_MODEL);
    await this.cloudLLMProvider.initializeProviders(prefs.textModel, prefs.visionModel);
  }

  /**
   * Update AI preferences.
   */
  updatePreferences(updates: Partial<AIPreferences>): void {
    const current = this._preferences();
    const updated = { ...current, ...updates };
    this._preferences.set(updated);
    this.savePreferences(updated);

    if (updates.openaiModel) {
      this.cloudLLMProvider.setOpenAIModel(updates.openaiModel);
    }
    if (updates.claudeModel) {
      this.cloudLLMProvider.setClaudeModel(updates.claudeModel);
    }

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
      diagnostics => this.processWithCloud(imageFile, diagnostics),
    );
  }

  /**
   * Process one or more receipt photos.
   * Splitting several receipts found in one photo happens only on the cloud
   * path (receiptId grouping); native OCR reads one receipt per photo, so a
   * cloud→native fallback loses the split rather than failing.
   */
  async processMultipleImages(imageFiles: File[]): Promise<ProcessingResult> {
    return this.runProcessing(
      () => this.nativeReceipt.processImages(imageFiles),
      diagnostics => this.processMultipleWithCloud(imageFiles, diagnostics),
    );
  }

  /**
   * Whether a result is worth keeping when another engine could still try.
   *
   * An engine handed a script it cannot read does not throw. Vision returns
   * whatever few characters it managed and the parser reports how little that
   * was, so a fallback that fires only on an exception never fires for the
   * case that needs it most: a confidently-shaped transaction assembled out of
   * noise. Anything below this is treated as "did not read it".
   */
  private isUsableResult(result: ProcessingResult): boolean {
    return (
      result.transactions.length > 0 &&
      result.confidence >= USABLE_CONFIDENCE &&
      result.transactions.some(t => t.amount > 0)
    );
  }

  /**
   * Try the other engine, keeping whichever result is actually usable.
   *
   * Never returns something worse than what it was given: if the alternative
   * throws or reads the receipt no better, the original stands.
   */
  private async preferUsable(
    current: ProcessingResult,
    alternative: () => Promise<ProcessingResult>,
  ): Promise<ProcessingResult> {
    try {
      const other = await alternative();
      return this.isUsableResult(other) ? other : current;
    } catch (error) {
      console.warn('[AIStrategy] Fallback engine also failed, keeping the first result:', error);
      return current;
    }
  }

  /**
   * Run native or cloud processing per the routing strategy, falling back to
   * the other engine when the preferred one fails — or when it succeeds
   * without having read anything.
   *
   * One diagnostics object is built up front and shared by the result and
   * the error: the duration is filled in the finally block, after whichever
   * of the two has already been handed out, so a throw records how long it
   * took just as a success does. The cross-engine fallbacks used to be four
   * console.warns; they are the `fellBackFrom` field now.
   */
  private async runProcessing(
    native: () => Promise<ProcessingResult>,
    cloud: (diagnostics: ReceiptAttemptDiagnostics) => Promise<ProcessingResult>,
  ): Promise<ProcessingResult> {
    const startTime = performance.now();
    this._isProcessing.set(true);

    const preferNative = this.useNativeOCR();
    const diagnostics: ReceiptAttemptDiagnostics = {
      engine: preferNative ? 'native' : 'cloud',
      provider: null,
      durationMs: 0,
    };
    // The provider is resolved once the cloud path clears
    // ensureCloudAvailable(), inside processWithCloud/processMultipleWithCloud
    // themselves — not here — so an offline device with a configured key
    // reports no provider for a request that was never issued.
    const runCloud = (): Promise<ProcessingResult> => cloud(diagnostics);
    let returned: ProcessingResult | undefined;

    try {
      let result: ProcessingResult;

      if (preferNative) {
        try {
          result = await native();
          if (!this.isUsableResult(result) && this.canUseCloud()) {
            const other = await this.preferUsable(result, runCloud);
            if (other !== result) {
              diagnostics.engine = 'cloud';
              diagnostics.fellBackFrom = 'native';
              result = other;
            }
          }
        } catch (error) {
          if (!this.canUseCloud()) {
            throw error;
          }
          diagnostics.engine = 'cloud';
          diagnostics.fellBackFrom = 'native';
          result = await runCloud();
        }
      } else {
        try {
          result = await runCloud();
          if (!this.isUsableResult(result) && this.canUseNative()) {
            const other = await this.preferUsable(result, native);
            if (other !== result) {
              diagnostics.engine = 'native';
              diagnostics.fellBackFrom = 'cloud';
              result = other;
            }
          }
        } catch (error) {
          if (!this.canUseNative()) {
            throw error;
          }
          diagnostics.engine = 'native';
          diagnostics.fellBackFrom = 'cloud';
          result = await native();
        }
      }

      returned = this.withFallbackCurrency({
        ...result,
        processingTimeMs: 0,
        diagnostics,
      });
      return returned;
    } catch (error) {
      const parsed = parseAIError(error);
      diagnostics.errorType = parsed.type;
      diagnostics.retryable = parsed.retryable;
      throw new ReceiptProcessingError(diagnostics, error);
    } finally {
      // Measured here so a throw is timed too. `returned` is the very object
      // the caller receives; finally runs before the promise settles, so the
      // caller never sees the zero placeholder.
      const elapsed = performance.now() - startTime;
      diagnostics.durationMs = elapsed;
      if (returned) {
        returned.processingTimeMs = elapsed;
      }
      this._lastProcessingTime.set(elapsed);
      this._isProcessing.set(false);
    }
  }

  /**
   * Process with cloud AI.
   */
  private async processWithCloud(
    imageFile: File,
    diagnostics: ReceiptAttemptDiagnostics,
  ): Promise<ProcessingResult> {
    this.ensureCloudAvailable();
    // Resolved only once a request is actually going to be sent, so a key
    // edited mid-session is reported as what actually answered.
    diagnostics.provider = this.receiptProvider();

    const imageBase64 = await fileToBase64(imageFile);
    const receipt = await this.cloudLLMProvider.parseReceipt(imageBase64);

    return {
      transactions: [this.convertParsedReceipt(receipt)],
      source: 'cloud',
      confidence: receipt.confidence,
      processingTimeMs: 0,
      receiptCount: receipt.receiptCount ?? 1,
    };
  }

  /**
   * Process multiple images with cloud AI.
   */
  private async processMultipleWithCloud(
    imageFiles: File[],
    diagnostics: ReceiptAttemptDiagnostics,
  ): Promise<ProcessingResult> {
    this.ensureCloudAvailable();
    // Resolved only once a request is actually going to be sent, so a key
    // edited mid-session is reported as what actually answered.
    diagnostics.provider = this.receiptProvider();

    const imageBase64Array: string[] = [];
    for (const file of imageFiles) {
      imageBase64Array.push(await fileToBase64(file));
    }

    const extracted = await this.cloudLLMProvider.extractTransactionsFromMultipleImages(imageBase64Array);

    // Merge line items belonging to the same receipt into one transaction so
    // the itemized list is recorded in the note instead of scattering items
    // across separate transactions
    const fallbackCurrency = this.fallbackCurrency();
    const consolidated = consolidateReceiptItems(extracted, fallbackCurrency);

    const transactions: ProcessedTransaction[] = consolidated.map(t => ({
      date: parseDateInput(t.date) ?? new Date(),
      description: t.description,
      amount: t.amount,
      type: t.type,
      currency: t.currency || fallbackCurrency,
      currencyFellBack: !t.currency,
      confidence: t.confidence,
      source: 'cloud' as const,
      notes: t.details,
      suggestedCategoryId: t.category,
      receiptId: t.receiptId,
      fieldConfidence:
        t.amountConfidence !== undefined ? { amount: t.amountConfidence } : undefined,
      // Which photos the row came from. Consolidation hardcodes imageIndex 0
      // on merged rows, so mergedFromImages is the honest list there; both
      // used to die on this hop, leaving the confirm step unable to attach
      // the right photo.
      imageIndex: t.imageIndex,
      ...(t.mergedFromImages?.length ? { mergedFromImages: t.mergedFromImages } : {}),
      ...(t.location ? { location: t.location } : {}),
      ...(t.receiptCountry ? { receiptCountry: t.receiptCountry } : {}),
    }));

    const avgConfidence = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + t.confidence, 0) / transactions.length
      : 0;

    // Consolidation collapses each receipt to one row, so the distinct ids are
    // how many receipts the model found across the photos. Rows the model left
    // ungrouped count as one receipt each rather than collapsing together.
    const receiptCount = new Set(consolidated.map((t, index) => t.receiptId ?? `ungrouped-${index}`)).size;

    return {
      transactions,
      source: 'cloud',
      confidence: avgConfidence,
      processingTimeMs: 0,
      receiptCount,
    };
  }

  private ensureCloudAvailable(): void {
    if (!this.canUseCloud()) {
      throw new Error(AI_CLOUD_UNAVAILABLE);
    }
  }

  /**
   * What to record when the model could not read a currency off the receipt.
   *
   * The account's own base currency, because the caller knows something the
   * model does not. The provider services used to invent one instead, and did
   * not even agree with each other about which — a receipt whose currency was
   * unreadable landed as CNY, JPY or USD depending purely on which extraction
   * path had read it.
   */
  private fallbackCurrency(): string {
    return baseCurrencyOf(this.authService.currentUser());
  }

  /**
   * Substitute the account's base currency into any row whose currency the
   * engine could not read, and flag it so the form can offer a better guess.
   *
   * Applied at the single exit of runProcessing, which every engine and every
   * cross-engine fallback passes through. The cloud paths resolve their own
   * currency before returning, so this is a no-op for them; the native paths
   * report an empty string because on-device extraction has no idea what the
   * account's base currency is.
   */
  private withFallbackCurrency(result: ProcessingResult): ProcessingResult {
    if (!result.transactions?.some(t => !t.currency)) {
      return result;
    }

    const fallback = this.fallbackCurrency();
    return {
      ...result,
      transactions: result.transactions.map(t => t.currency
        ? t
        : { ...t, currency: fallback, currencyFellBack: true }),
    };
  }

  /**
   * Convert parsed receipt to processed transaction.
   */
  private convertParsedReceipt(receipt: ParsedReceipt): ProcessedTransaction {
    const currency = receipt.currency || this.fallbackCurrency();
    return {
      date: receipt.date,
      description: receipt.merchant,
      amount: receipt.amount,
      type: 'expense',
      currency,
      confidence: receipt.confidence,
      source: 'cloud',
      notes: receipt.receiptDetails
        || (receipt.items?.length ? formatReceiptItemLines(receipt.items, currency) : '')
        || '',
      suggestedCategoryId: receipt.suggestedCategory,
      fieldConfidence: receipt.fieldConfidence,
      currencyFellBack: !receipt.currency,
      ...printedLocationSlot(receipt.location, receipt.receiptCountry),
      ...(receipt.receiptCountry ? { receiptCountry: receipt.receiptCountry } : {}),
    };
  }

  /**
   * Load preferences from localStorage, moving a superseded model id forward
   * on the way through.
   *
   * The order is load-bearing: migrate the parsed blob, then merge it over the
   * defaults. DEFAULT_PREFERENCES carries the current schema version, so
   * merging first would hand a legacy blob a stamp it never had, the migration
   * would decline to run, and the retired id would survive with nothing
   * anywhere reporting a problem.
   */
  private loadPreferences(): AIPreferences {
    try {
      const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (stored) {
        const { prefs, changed } = migrateModelPreferences(JSON.parse(stored) as AIPreferences);
        const merged = { ...DEFAULT_PREFERENCES, ...prefs };
        if (changed) {
          this.savePreferences(merged);
        }
        return merged;
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
   * Suggest a category for a description, using whichever provider is
   * configured for categorization.
   *
   * Here so a caller that already depends on the strategy service for scanning
   * does not have to reach for a second AI service to label the result.
   */
  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    return this.cloudLLMProvider.suggestCategory(description, categories);
  }

  /**
   * Get the cloud LLM provider service for advanced configuration.
   */
  getCloudLLMProvider(): CloudLLMProviderService {
    return this.cloudLLMProvider;
  }
}
