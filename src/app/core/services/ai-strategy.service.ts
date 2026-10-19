import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ParsedReceipt } from './gemini.service';
import { BringUpOutcome, CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { NativeReceiptService } from './native-receipt.service';
import { ProviderKeyService } from './provider-key.service';
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

/** The outcome of a bring-up that never reached a key read of its own. */
const NOT_READ: BringUpOutcome = { keyReadFailed: false };

/** What a key save's hold on a wait ends on (AIStrategyService.saveHold). */
function newSaveHold(): { released: Promise<void>; release: () => void } {
  let release!: () => void;
  const released = new Promise<void>(resolve => (release = resolve));
  return { released, release };
}

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
  private providerKeys = inject(ProviderKeyService);

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

  /** The latest bring-up, which a caller waiting on the providers joins. */
  private initialization: Promise<BringUpOutcome>;

  /**
   * A key save whose write or bring-up is still out, and the account it is
   * for. A new attempt for that account comes up behind it.
   */
  private pendingKeySave: { userId: string; done: Promise<BringUpOutcome> } | null = null;

  /**
   * Bumped on every run of the effect's signed-out branch: a sign-out, and
   * also the start-up run before auth resolves and a connectivity change
   * while no one is signed in. A key save, and an attempt queued behind one,
   * brings nothing up once the count it took has moved, so nothing after a
   * sign-out, even when the same account has signed back in.
   */
  private session = 0;

  /**
   * What a key save's hold on a wait ends on, besides the save itself. The
   * effect releases it, and starts the next, on every signed-out run and on a
   * run that finds another account signed in than the one the latest save is
   * tagged with (pendingKeySave); each save takes the one current when it
   * starts. A switch that reaches the effect as one change, after the next
   * account has made a save of its own, is not seen this way (ADR 0180, Known
   * gaps). The Firestore SDK
   * keeps a departed account's write until that account is current again, so
   * a wait on the write alone would sit until then.
   */
  private saveHold = newSaveHold();

  constructor() {
    // Apply the stored model selection at startup so the first request honors
    // the user's choice from AI settings. Keys, if any, arrive with the effect
    // below once the account resolves.
    this.initialization = this.initializeCloudProviders();

    // Probe native capabilities (Mac environment, Apple Intelligence)
    if (this.canUseNative()) {
      this.visionOcr.detectEnvironment();
      this.appleIntelligence.detectAvailability();
    }

    // Bring the cloud providers up once per signed-in account. The keys are
    // no longer part of the user document, so there is nothing else on `user`
    // worth watching — a key the user saves in settings goes through
    // applyProviderKey(), which is a bring-up of its own.
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
        // resolves, when there is nothing to tear down. The build's
        // environment-key Gemini does not outlive start-up either way: the
        // constructor's bring-up runs signed out and clears Gemini, and that
        // clear supersedes the environment arm still loading its SDK.
        //
        // Driven from here rather than AuthService.signOut() because
        // ProviderKeyService injects AuthService — calling back the other way
        // would close a dependency cycle. The cost is that the reset lands a
        // microtask after sign-out resolves; sign-out navigates away, so
        // nothing can reach a provider in that window. A bring-up already in
        // flight for the departing account is superseded by the counters (ADR
        // 0179): once the reset lands, it arms nothing more.
        if (this.providersInitializedFor() !== null) {
          void this.cloudLLMProvider.resetProviders();
        }
        this.providersInitializedFor.set(null);
        // A save still out for the departing account holds up no one's
        // bring-up, and it brings nothing up once its write lands, even for
        // the same account signed back in: that session's own bring-up reads
        // the keys, and a second one would supersede it unseen by the wait.
        // Nor does it hold a wait any longer, its write still out or not: a
        // wait on it goes on now, and answers false or follows the next
        // account's bring-up.
        this.pendingKeySave = null;
        this.session++;
        this.releaseSaves();
        return;
      }

      // A switch to another account that reaches the effect as one change,
      // with no signed-out run between, ends the departed save's hold too,
      // while the latest save is still the departed account's.
      if (this.pendingKeySave && this.pendingKeySave.userId !== userId) this.releaseSaves();
      void this.bringUpFor(`${userId}:${online}`);
    });
  }

  /**
   * Start the bring-up for an account and connectivity state, unless it is
   * already the one started last, and return the bring-up for it.
   *
   * The effect and cloudProvidersReady() both come through here, so whichever
   * arrives first starts it and the other joins it. A write from outside the
   * effect re-runs the effect once, and it stops here on the same attempt.
   *
   * A new attempt for the account a key save is still out for (a reconnect
   * during the save, or the account's first attempt when the save came
   * first) comes up behind that save, so it cannot answer ahead of the
   * write. Another account's attempt never waits on it, and one queued
   * behind the save brings nothing up once a sign-out has ended its session
   * or another account is signed in.
   */
  private bringUpFor(attempt: string): Promise<BringUpOutcome> {
    if (this.providersInitializedFor() !== attempt) {
      this.providersInitializedFor.set(attempt);
      const save = this.pendingKeySave;
      const account = attempt.slice(0, attempt.lastIndexOf(':'));
      const session = this.session;
      const stillOwn = () => this.session === session && this.authService.userId() === account;
      this.initialization = save?.userId === account
        ? save.done.then(() => (stillOwn() ? this.initializeCloudProviders() : NOT_READ))
        : this.initializeCloudProviders();
    }
    return this.initialization;
  }

  /** End every key save's hold on a wait, and start the next saves' hold. */
  private releaseSaves(): void {
    this.saveHold.release();
    this.saveHold = newSaveHold();
  }

  /**
   * Resolves once the cloud providers are up for the signed-in account: the
   * key read and the provider SDK's import after it, not the key read alone.
   *
   * A caller that arrives before the effect starts the bring-up itself, before
   * its first await; one that arrives later joins the bring-up in flight. When
   * the account or connectivity changes during the wait, it waits for the
   * newer bring-up instead.
   *
   * A key save still out for the account is part of the wait: the write's
   * acknowledgement, then the bring-up after it. A wait that joined a save
   * whose write is not yet acknowledged does not answer false when the device
   * goes offline, until the write is acknowledged: the offline bring-up comes
   * up behind the save. A sign-out, or another account signing in, ends the
   * save's hold at once, its write still out or not, so the wait answers false
   * or follows the next account's bring-up.
   *
   * A bring-up whose own key read failed while online is read once more, once
   * per call: the wait starts one fresh bring-up for the same attempt and
   * answers on it, whatever that read finds. Waits on the same bring-up share
   * the one fresh read. A wait that moved on to a newer bring-up counts that
   * one as its fresh read, whether or not it read the keys itself: a save
   * whose write was refused reads nothing, and a bring-up started while the
   * account's read is still out joins that read (ADR 0180, Known gaps). It
   * goes by the bring-up's own outcome, never by
   * ProviderKeyService.loadFailed(): opening Settings → AI reads the keys for
   * the page and clears that flag, and arms nothing. Offline nothing is read
   * again; the reconnect's bring-up reads the keys.
   *
   * A bring-up that fails still answers, with whatever came up. Answers false
   * when no one is signed in or the device is offline, so the caller can leave
   * its work for later.
   */
  async cloudProvidersReady(): Promise<boolean> {
    let freshRead = false;
    let outcome: BringUpOutcome = NOT_READ;
    for (let waited: Promise<BringUpOutcome> | null = null; ;) {
      const userId = this.authService.userId();
      const online = this.pwaService.isOnline();
      if (!userId) return false;

      // Still the latest since the last wait, so that bring-up was the current
      // one. Compared by identity, not by state: a state that changes and
      // changes back during the wait has started a newer bring-up for it.
      const bringUp = this.bringUpFor(`${userId}:${online}`);
      if (bringUp === waited) {
        if (!online || freshRead || !outcome.keyReadFailed) return online;
        // Same attempt, read again. Installed as the latest bring-up, so a
        // wait still on the failed one joins this read rather than its own.
        this.initialization = this.initializeCloudProviders();
        continue;
      }

      // Anything newer than the bring-up this call last waited on counts as
      // its fresh read, even one that read nothing new: a refused save, or a
      // bring-up that joined the read still out (see the docblock).
      if (waited !== null) freshRead = true;
      waited = bringUp;
      outcome = await bringUp.catch(() => NOT_READ);
    }
  }

  /**
   * (Re)initialize cloud providers with the persisted model selection.
   */
  private async initializeCloudProviders(): Promise<BringUpOutcome> {
    const prefs = this._preferences();
    this.cloudLLMProvider.setOpenAIModel(prefs.openaiModel ?? DEFAULT_OPENAI_MODEL);
    this.cloudLLMProvider.setClaudeModel(prefs.claudeModel ?? DEFAULT_CLAUDE_MODEL);
    return this.cloudLLMProvider.initializeProviders(prefs.textModel, prefs.visionModel);
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

    // A cut-off answer arrives here as the rows that survived it, not as a
    // throw (#331). Nothing is said about it on this path: the in-form scan
    // has no review table to say it on, and the group that lost its tail also
    // lost the printed total asked for on its last item, so
    // consolidateReceiptItems already grades the amount for verification.
    const extracted = await this.cloudLLMProvider.extractTransactionsFromMultipleImages(imageBase64Array);

    // Merge line items belonging to the same receipt into one transaction so
    // the itemized list is recorded in the note instead of scattering items
    // across separate transactions
    const fallbackCurrency = this.fallbackCurrency();
    const consolidated = consolidateReceiptItems(extracted, fallbackCurrency);

    const transactions: ProcessedTransaction[] = consolidated.map(t => {
      const parsedDate = parseDateInput(t.date);
      // A date string that turns out unparseable is `now` above, whatever
      // upstream claimed about it — but a parseable one can still be a
      // fabricated fallback (a missing date patched with a parseable
      // today-string), which only the producer's own grade can tell apart
      // from a real reading. Either way collapses to 0; only a date nobody
      // graded at all stays undefined.
      const dateGrade = parsedDate === null ? 0 : t.dateConfidence;
      return {
        date: parsedDate ?? new Date(),
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
          t.amountConfidence !== undefined || dateGrade !== undefined
            ? {
                ...(t.amountConfidence !== undefined ? { amount: t.amountConfidence } : {}),
                ...(dateGrade !== undefined ? { date: dateGrade } : {}),
              }
            : undefined,
        // Which photos the row came from. Consolidation hardcodes imageIndex 0
        // on merged rows, so mergedFromImages is the honest list there; both
        // used to die on this hop, leaving the confirm step unable to attach
        // the right photo.
        imageIndex: t.imageIndex,
        ...(t.mergedFromImages?.length ? { mergedFromImages: t.mergedFromImages } : {}),
        ...(t.location ? { location: t.location } : {}),
        ...(t.receiptCountry ? { receiptCountry: t.receiptCountry } : {}),
      };
    });

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
   * Save one provider's key, or clear it with undefined, and bring the
   * providers up on it.
   *
   * Before this method's first await, the save becomes the bring-up a waiting
   * caller joins. Pressing Sync Now is what blurs the key field, so the
   * drain's wait starts while the write is still out, and it has to follow the
   * save rather than answer off the bring-up before it. The save waits for its
   * write and for the bring-up already in flight, then runs a full one, so
   * saves come up one after another. A refused write rejects, with nothing
   * brought up for it, but only once that earlier bring-up is up, so no wait
   * it took over answers early; the save then answers with that bring-up's
   * outcome, so a wait that joined it still reads the keys again after a
   * failed read. An account that signed out before the write landed has
   * nothing brought up for it, even once it has signed back in, and a wait on
   * the save goes on at the sign-out, not at the write, which the Firestore
   * SDK keeps until that account is current again. A switch that reaches the
   * effect as one change does the same only while this save is still the
   * latest (ADR 0180, Known gaps).
   */
  applyProviderKey(provider: LLMProvider, apiKey: string | undefined): Promise<void> {
    const userId = this.authService.userId();
    const session = this.session;
    const hold = this.saveHold.released;
    // Started now: setKey reads the account before its first await.
    const saved = this.providerKeys.setKey(provider, apiKey);
    const previous = this.initialization;
    const run = (async () => {
      const [write] = await Promise.allSettled([saved, previous]);
      if (write.status === 'rejected') throw write.reason;
      if (!userId || this.session !== session || this.authService.userId() !== userId) return NOT_READ;
      return this.initializeCloudProviders().catch(() => NOT_READ);
    })();
    // The page's answer is run's; a wait's is done, which the account's
    // leaving also ends.
    const done = Promise.race([
      run.then(o => o, () => previous.then(o => o, () => NOT_READ)),
      hold.then(() => NOT_READ),
    ]);
    this.initialization = done;
    this.pendingKeySave = userId ? { userId, done } : null;
    void done.then(() => {
      if (this.pendingKeySave?.done === done) this.pendingKeySave = null;
    });
    return run.then(() => undefined);
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
