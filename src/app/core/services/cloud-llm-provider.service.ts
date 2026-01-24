import { Injectable, inject, signal, computed } from '@angular/core';
import { GeminiService, ParsedReceipt, RawTransaction, CategorizedTransaction, PreviousPeriodData, MultiImageExtractedTransaction, CSVColumnMapping } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { AuthService } from './auth.service';
import { LLMProvider, LLMProviderPreferences, DEFAULT_LLM_PROVIDER_PREFERENCES, Category, Transaction, Budget, MonthlyTotal } from '../../models';

export type AIFeatureType = 'receiptScanning' | 'categorization' | 'insights';

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

  // Signals for provider availability
  private _providerStatus = signal<ProviderStatus>({
    gemini: false,
    openai: false,
    claude: false,
  });

  // Computed signals
  providerStatus = computed(() => this._providerStatus());
  
  hasAnyCloudProvider = computed(() => {
    const status = this._providerStatus();
    return status.gemini || status.openai || status.claude;
  });

  availableProviders = computed(() => {
    const status = this._providerStatus();
    const providers: LLMProvider[] = [];
    if (status.gemini) providers.push('gemini');
    if (status.openai) providers.push('openai');
    if (status.claude) providers.push('claude');
    return providers;
  });

  constructor() {
    this.updateProviderStatus();
  }

  /**
   * Initialize all providers with their respective API keys from user preferences.
   */
  initializeFromUserPreferences(): void {
    const user = this.authService.currentUser();
    if (user?.preferences) {
      const { geminiApiKey, openaiApiKey, claudeApiKey } = user.preferences;
      
      if (geminiApiKey) {
        this.geminiService.reinitialize(geminiApiKey);
      }
      if (openaiApiKey) {
        this.openaiService.reinitialize(openaiApiKey);
      }
      if (claudeApiKey) {
        this.claudeService.reinitialize(claudeApiKey);
      }
    }
    
    this.updateProviderStatus();
  }

  /**
   * Update a specific provider's API key.
   */
  updateProviderApiKey(provider: LLMProvider, apiKey: string | undefined): void {
    switch (provider) {
      case 'gemini':
        this.geminiService.reinitialize(apiKey);
        break;
      case 'openai':
        this.openaiService.reinitialize(apiKey);
        break;
      case 'claude':
        this.claudeService.reinitialize(apiKey);
        break;
    }
    this.updateProviderStatus();
  }

  /**
   * Update provider status based on current availability.
   */
  private updateProviderStatus(): void {
    this._providerStatus.set({
      gemini: this.geminiService.isAvailable(),
      openai: this.openaiService.isAvailable(),
      claude: this.claudeService.isAvailable(),
    });
  }

  /**
   * Get the provider preferences for the current user.
   */
  private getProviderPreferences(): LLMProviderPreferences {
    const user = this.authService.currentUser();
    return user?.preferences?.llmProviderPreferences ?? DEFAULT_LLM_PROVIDER_PREFERENCES;
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
    const status = this._providerStatus();

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
    return this._providerStatus()[provider];
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
  // Receipt Scanning Features
  // ============================================================

  /**
   * Parse a receipt image using the configured provider.
   */
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    const provider = this.getBestAvailableProvider('receiptScanning');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for receipt scanning');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.parseReceipt(imageBase64);
      case 'openai':
        return this.openaiService.parseReceipt(imageBase64);
      case 'claude':
        return this.claudeService.parseReceipt(imageBase64);
    }
  }

  /**
   * Extract transactions from an image.
   */
  async extractTransactionsFromImage(imageBase64: string): Promise<RawTransaction[]> {
    const provider = this.getBestAvailableProvider('receiptScanning');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for image extraction');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.extractTransactionsFromImage(imageBase64);
      case 'openai':
        return this.openaiService.extractTransactionsFromImage(imageBase64);
      case 'claude':
        return this.claudeService.extractTransactionsFromImage(imageBase64);
    }
  }

  /**
   * Extract transactions from multiple images.
   */
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[]
  ): Promise<MultiImageExtractedTransaction[]> {
    const provider = this.getBestAvailableProvider('receiptScanning');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for multi-image extraction');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.extractTransactionsFromMultipleImages(imageBase64Array);
      case 'openai':
        return this.openaiService.extractTransactionsFromMultipleImages(imageBase64Array);
      case 'claude':
        return this.claudeService.extractTransactionsFromMultipleImages(imageBase64Array);
    }
  }

  /**
   * Extract transactions from a PDF.
   */
  async extractTransactionsFromPDF(pdfBase64: string): Promise<RawTransaction[]> {
    const provider = this.getBestAvailableProvider('receiptScanning');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for PDF extraction');
    }

    // Only Gemini supports PDF extraction currently
    if (provider === 'gemini') {
      return this.geminiService.extractTransactionsFromPDF(pdfBase64);
    }

    // For other providers, we'd need to convert PDF to images first
    // For now, fall back to Gemini if available, otherwise throw
    if (this.isProviderAvailable('gemini')) {
      return this.geminiService.extractTransactionsFromPDF(pdfBase64);
    }

    throw new Error('PDF extraction is only supported with Gemini');
  }

  // ============================================================
  // Categorization Features
  // ============================================================

  /**
   * Suggest a category for a transaction description.
   */
  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    const provider = this.getBestAvailableProvider('categorization');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for categorization');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.suggestCategory(description, categories);
      case 'openai':
        return this.openaiService.suggestCategory(description, categories);
      case 'claude':
        return this.claudeService.suggestCategory(description, categories);
    }
  }

  /**
   * Categorize multiple transactions.
   */
  async categorizeTransactions(transactions: RawTransaction[]): Promise<CategorizedTransaction[]> {
    const provider = this.getBestAvailableProvider('categorization');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for categorization');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.categorizeTransactions(transactions);
      case 'openai':
        return this.openaiService.categorizeTransactions(transactions);
      case 'claude':
        return this.claudeService.categorizeTransactions(transactions);
    }
  }

  /**
   * Detect CSV column mapping.
   */
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    const provider = this.getBestAvailableProvider('categorization');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for CSV mapping');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.detectCSVMapping(headers, sampleRows);
      case 'openai':
        return this.openaiService.detectCSVMapping(headers, sampleRows);
      case 'claude':
        return this.claudeService.detectCSVMapping(headers, sampleRows);
    }
  }

  // ============================================================
  // Insights Features
  // ============================================================

  /**
   * Generate a spending summary.
   */
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency?: string,
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[]
  ): Promise<string> {
    const provider = this.getBestAvailableProvider('insights');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for insights');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.generateSpendingSummary(
          transactions, period, baseCurrency, previousPeriodData, budgets
        );
      case 'openai':
        return this.openaiService.generateSpendingSummary(
          transactions, period, baseCurrency, previousPeriodData, budgets
        );
      case 'claude':
        return this.claudeService.generateSpendingSummary(
          transactions, period, baseCurrency, previousPeriodData, budgets
        );
    }
  }

  /**
   * Get financial advice.
   */
  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency?: string,
    period?: string
  ): Promise<string> {
    const provider = this.getBestAvailableProvider('insights');
    
    if (!provider) {
      throw new Error('No cloud AI provider available for insights');
    }

    switch (provider) {
      case 'gemini':
        return this.geminiService.getFinancialAdvice(summary, baseCurrency, period);
      case 'openai':
        return this.openaiService.getFinancialAdvice(summary, baseCurrency, period);
      case 'claude':
        return this.claudeService.getFinancialAdvice(summary, baseCurrency, period);
    }
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
