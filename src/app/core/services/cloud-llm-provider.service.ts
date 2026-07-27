import { Injectable, inject, computed } from '@angular/core';
import { GeminiService, ParsedReceipt, RawTransaction, CategorizedTransaction, PreviousPeriodData, MultiImageExtractedTransaction, CSVColumnMapping } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { AuthService } from './auth.service';
import { ProviderKeyService } from './provider-key.service';
import { LLMProvider, LLMProviderPreferences, DEFAULT_LLM_PROVIDER_PREFERENCES, Category, Transaction, Budget, MonthlyTotal, SearchIntent, SearchQueryContext } from '../../models';
import { CloudLLMProviderAdapter } from './llm-provider.interface';

export type AIFeatureType = 'receiptScanning' | 'categorization' | 'insights' | 'search';

interface ProviderStatus {
  gemini: boolean;
  openai: boolean;
  claude: boolean;
}

@Injectable({ providedIn: 'root' })
export class CloudLLMProviderService {
  private geminiService = inject(GeminiService);
  private openaiService = inject(OpenAIService);
  private claudeService = inject(ClaudeService);
  private authService = inject(AuthService);
  private providerKeys = inject(ProviderKeyService);

  // Provider availability is fully reactive: it flips when a provider's
  // lazily-loaded SDK finishes initializing, instead of relying on
  // imperative refreshes that could go stale
  providerStatus = computed<ProviderStatus>(() => ({
    gemini: this.geminiService.isAvailableSignal(),
    openai: this.openaiService.isAvailableSignal(),
    claude: this.claudeService.isAvailableSignal(),
  }));

  hasAnyCloudProvider = computed(() => {
    const status = this.providerStatus();
    return status.gemini || status.openai || status.claude;
  });

  availableProviders = computed(() => {
    const status = this.providerStatus();
    const providers: LLMProvider[] = [];
    if (status.gemini) providers.push('gemini');
    if (status.openai) providers.push('openai');
    if (status.claude) providers.push('claude');
    return providers;
  });

  /**
   * Initialize all providers with their respective API keys. Pass the model
   * ids selected in AI settings so Gemini does not silently revert to the
   * catalog defaults.
   *
   * Async because the keys are now a separate document rather than part of
   * the already-loaded user preferences; ProviderKeyService reads it once per
   * session, so this costs one read at startup and none afterwards.
   */
  async initializeProviders(textModelId?: string, visionModelId?: string): Promise<void> {
    const { gemini, openai, claude } = await this.providerKeys.resolve();

    if (gemini) {
      await this.geminiService.reinitialize(gemini, textModelId, visionModelId);
      console.log(`[CloudLLMProvider] Gemini initialized with API key${textModelId ? ` (text: ${textModelId}, vision: ${visionModelId})` : ''}`);
    }
    if (openai) {
      await this.openaiService.reinitialize(openai);
      console.log('[CloudLLMProvider] OpenAI initialized with API key');
    }
    if (claude) {
      await this.claudeService.reinitialize(claude);
      console.log('[CloudLLMProvider] Claude initialized with API key');
    }
  }

  /**
   * Update a specific provider's API key.
   */
  async updateProviderApiKey(provider: LLMProvider, apiKey: string | undefined): Promise<void> {
    // Awaiting matters: initialization lazy-loads the provider SDK, and
    // availability checks made before it resolves would read a stale false
    switch (provider) {
      case 'gemini':
        await this.geminiService.reinitialize(apiKey);
        break;
      case 'openai':
        await this.openaiService.reinitialize(apiKey);
        break;
      case 'claude':
        await this.claudeService.reinitialize(apiKey);
        break;
    }
  }

  /** Switch the OpenAI model used for all requests. */
  setOpenAIModel(modelId: string): void {
    this.openaiService.setModel(modelId);
  }

  /** Switch the Claude model used for all requests. */
  setClaudeModel(modelId: string): void {
    this.claudeService.setModel(modelId);
  }

  /**
   * Reinitialize Gemini with new models.
   */
  async reinitializeGemini(textModelId?: string, visionModelId?: string): Promise<void> {
    const apiKey = await this.providerKeys.getKey('gemini');
    await this.geminiService.reinitialize(apiKey, textModelId, visionModelId);
  }


  /**
   * Get the provider preferences for the current user. Stored objects from
   * before a feature existed lack its key, so defaults are merged in.
   */
  private getProviderPreferences(): LLMProviderPreferences {
    const user = this.authService.currentUser();
    return {
      ...DEFAULT_LLM_PROVIDER_PREFERENCES,
      ...user?.preferences?.llmProviderPreferences,
    };
  }

  /**
   * Get the preferred provider for a specific feature.
   */
  getPreferredProvider(feature: AIFeatureType): LLMProvider {
    const prefs = this.getProviderPreferences();
    return prefs[feature];
  }

  /**
   * Get the best available provider for a feature, falling back if preferred is unavailable.
   */
  private getBestAvailableProvider(feature: AIFeatureType): LLMProvider | null {
    const preferred = this.getPreferredProvider(feature);
    const status = this.providerStatus();

    // Try preferred provider first
    if (status[preferred]) {
      return preferred;
    }

    // Fallback order: gemini -> openai -> claude
    const fallbackOrder: LLMProvider[] = ['gemini', 'openai', 'claude'];
    for (const provider of fallbackOrder) {
      if (status[provider]) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Check if a specific provider is available.
   */
  isProviderAvailable(provider: LLMProvider): boolean {
    return this.providerStatus()[provider];
  }

  /**
   * Test a provider's API key.
   */
  async testProviderApiKey(provider: LLMProvider): Promise<boolean> {
    switch (provider) {
      case 'gemini':
        return this.geminiService.isAvailable();
      case 'openai':
        return this.openaiService.isAvailable();
      case 'claude':
        return this.claudeService.isAvailable();
      default:
        return false;
    }
  }

  // ============================================================
  // Provider Features
  //
  // Every method resolves an adapter and calls it. There is no per-method
  // switch any more: the adapter interface guarantees each provider offers
  // the same surface, so adding a capability means adding it in one place
  // rather than in eleven three-armed switches that nothing kept in step.
  // ============================================================

  /**
   * The provider that should serve this feature, or a thrown error naming the
   * feature that has none.
   */
  private resolve(feature: AIFeatureType): CloudLLMProviderAdapter {
    const provider = this.getBestAvailableProvider(feature);
    if (!provider) {
      throw new Error(`No cloud AI provider available for ${feature}`);
    }
    return this.adapters()[provider];
  }

  private adapters(): Record<LLMProvider, CloudLLMProviderAdapter> {
    return {
      gemini: this.geminiService,
      openai: this.openaiService,
      claude: this.claudeService,
    };
  }

  // ---------------------------------------------- receipt scanning

  /** Parse a receipt image using the configured provider. */
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    return this.resolve('receiptScanning').parseReceipt(imageBase64);
  }

  /** Extract transactions from multiple images. */
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[]
  ): Promise<MultiImageExtractedTransaction[]> {
    return this.resolve('receiptScanning').extractTransactionsFromMultipleImages(imageBase64Array);
  }

  /**
   * Extract transactions from a PDF.
   *
   * Only Gemini accepts a PDF directly, so a provider is chosen by capability
   * rather than by preference here. Until the pages can be rasterized client
   * side (#55), a user with only OpenAI or Claude configured gets a clear
   * refusal instead of an SDK error.
   */
  async extractTransactionsFromPDF(pdfBase64: string): Promise<RawTransaction[]> {
    const adapters = this.adapters();
    const status = this.providerStatus();
    const capable = (Object.keys(adapters) as LLMProvider[]).find(
      name => status[name] && adapters[name].capabilities.nativePdf
    );

    if (!capable) {
      throw new Error('PDF extraction needs a provider that accepts PDFs directly');
    }

    // Guaranteed present: nativePdf is only true where the method exists.
    return adapters[capable].extractTransactionsFromPDF!(pdfBase64);
  }

  // ---------------------------------------------- categorization

  /** Suggest a category for a transaction description. */
  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    return this.resolve('categorization').suggestCategory(description, categories);
  }

  /** Categorize multiple transactions. */
  async categorizeTransactions(transactions: RawTransaction[]): Promise<CategorizedTransaction[]> {
    return this.resolve('categorization').categorizeTransactions(transactions);
  }

  /** Detect CSV column mapping. */
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    return this.resolve('categorization').detectCSVMapping(headers, sampleRows);
  }

  // ---------------------------------------------- search

  /**
   * Interpret a natural-language transaction search query into a structured
   * intent.
   *
   * Failures are deliberately not caught: callers fall back to keyword search,
   * and swallowing the error here would leave the user with no results and no
   * explanation.
   */
  async interpretSearchQuery(query: string, context: SearchQueryContext): Promise<SearchIntent> {
    return this.resolve('search').interpretSearchQuery(query, context);
  }

  // ---------------------------------------------- insights

  /** Generate a spending summary. */
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency?: string,
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    ragContext?: string
  ): Promise<string> {
    return this.resolve('insights').generateSpendingSummary(
      transactions, period, baseCurrency, previousPeriodData, budgets, ragContext
    );
  }

  /**
   * Describe an already-computed spending pattern in prose.
   *
   * A separate entry point from generateSpendingSummary on purpose. That method
   * takes `Transaction[]`, so reusing it for the insights narrative would mean
   * either sending raw transactions — which the insights feature explicitly does
   * not do — or passing an empty array and relying on three provider
   * implementations to tolerate it. Taking a pre-built aggregate context makes
   * the privacy boundary structural rather than a matter of discipline: there is
   * no parameter here that could carry a description, a note or a merchant name.
   */
  async generatePatternNarrative(context: string, locale: string): Promise<string> {
    return this.resolve('insights').generatePatternNarrative(context, locale);
  }

  /** Get financial advice. */
  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency?: string,
    period?: string
  ): Promise<string> {
    return this.resolve('insights').getFinancialAdvice(summary, baseCurrency, period);
  }


  // ============================================================
  // Status and Info
  // ============================================================

  /**
   * Get processing status across all providers.
   */
  isProcessing(): boolean {
    return (
      this.geminiService.isProcessing() ||
      this.openaiService.isProcessing() ||
      this.claudeService.isProcessing()
    );
  }

  /**
   * Get the last error from any provider.
   */
  getLastError(): string | null {
    return (
      this.geminiService.lastError() ||
      this.openaiService.lastError() ||
      this.claudeService.lastError()
    );
  }

  /**
   * Get provider display name.
   */
  getProviderDisplayName(provider: LLMProvider): string {
    switch (provider) {
      case 'gemini':
        return 'Google Gemini';
      case 'openai':
        return 'OpenAI (ChatGPT)';
      case 'claude':
        return 'Anthropic Claude';
    }
  }

  /**
   * Get provider API key URL.
   */
  getProviderApiKeyUrl(provider: LLMProvider): string {
    switch (provider) {
      case 'gemini':
        return 'https://aistudio.google.com/app/apikey';
      case 'openai':
        return 'https://platform.openai.com/api-keys';
      case 'claude':
        return 'https://console.anthropic.com/settings/keys';
    }
  }
}
