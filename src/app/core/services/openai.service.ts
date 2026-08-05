import { Injectable, inject, signal, computed } from '@angular/core';
import type OpenAI from 'openai';
import { DEFAULT_OPENAI_MODEL } from '../config/ai-models';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Budget, Category, Transaction, MonthlyTotal } from '../../models';
import {
  ParsedReceipt,
  RawTransaction,
  CategorizedTransaction,
  PreviousPeriodData,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  CSVColumnMapping,
} from './gemini.service';
import {
  applyCategorizations,
  buildCategoryPromptCatalog,
  mapCategoryNameToId,
} from '../utils/categorization.utils';
import { readCurrencyCode, readFieldConfidence } from '../utils/receipt-extraction.utils';
import { parseSearchIntent } from '../utils/nl-search.utils';
import { SearchIntent, SearchQueryContext } from '../../models';
import {
  RenderedPrompt,
  languageInstruction,
  renderBudgetSection,
  renderCategoryBreakdown,
  renderLargestExpenses,
  renderPreviousPeriodSection,
  renderPrompt,
} from '../prompts';
import {
  AIRequestOptions,
  CloudLLMProviderAdapter,
  ProviderCapabilities,
} from './llm-provider.interface';
import { trimToLastCompleteSentence } from '../utils/llm-text.utils';
import { dayKey } from '../utils/transaction-date.utils';

@Injectable({ providedIn: 'root' })
export class OpenAIService implements CloudLLMProviderAdapter {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  private client: OpenAI | null = null;
  private currentApiKey: string | null = null;

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  private _isAvailable = signal<boolean>(false);

  // Computed signal for availability
  isAvailableSignal = computed(() => this._isAvailable());

  // Models
  // OpenAI models are multimodal — one selectable model serves both text
  // and vision tasks via the Responses API
  private model = DEFAULT_OPENAI_MODEL;

  constructor() {
    // OpenAI is not initialized by default - requires user API key
  }

  private async initialize(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      console.warn('OpenAI API key not provided');
      this.client = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
      return;
    }

    // Skip if already initialized with the same key
    if (apiKey === this.currentApiKey && this.client) {
      return;
    }

    try {
      // The SDK is loaded on demand to keep it out of the initial bundle
      const { default: OpenAI } = await this.loadSdk();
      this.client = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true, // Required for browser usage
      });
      this.currentApiKey = apiKey;
      this._isAvailable.set(true);
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
      this.client = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
    }
  }

  // Seam for the on-demand SDK import so the load step can be substituted.
  protected loadSdk(): Promise<typeof import('openai')> {
    return import('openai');
  }

  /**
   * Reinitialize OpenAI with a new API key.
   */
  reinitialize(apiKey?: string): Promise<void> {
    if (apiKey) {
      return this.initialize(apiKey);
    }
    this.client = null;
    this.currentApiKey = null;
    this._isAvailable.set(false);
    return Promise.resolve();
  }


  /** Switch the OpenAI model used for all requests. */
  setModel(modelId: string): void {
    if (modelId && modelId !== this.model) {
      this.model = modelId;
      console.log(`[OpenAIService] Model switched to ${modelId}`);
    }
  }

  // Check if OpenAI is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Every model in the OpenAI catalog is multimodal, so one selectable model
   * serves both text and vision. PDFs are not accepted directly — the pages
   * have to be rasterized first.
   */
  get capabilities(): ProviderCapabilities {
    return { vision: true, nativePdf: false };
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptParse');

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: this.renderedText(rendered) },
              { type: 'input_image', image_url: imageUrl, detail: 'auto' },
            ],
          },
        ],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const parsed = JSON.parse(cleanedJson);

      // Map suggested category to category ID
      const categoryId = this.mapCategoryNameToId(parsed.suggestedCategory);

      return {
        merchant: parsed.merchant || 'Unknown',
        amount: Number(parsed.amount) || 0,
        currency: readCurrencyCode(parsed.currency),
        date: parsed.date ? new Date(parsed.date) : new Date(),
        items: parsed.items || [],
        receiptDetails: parsed.receiptDetails,
        suggestedCategory: categoryId,
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5,
        receiptCount: Number(parsed.receiptCount) || 1,
        fieldConfidence: readFieldConfidence(parsed),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI receipt parsing error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Suggest category for a transaction description
  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categoryList = categories
        .filter((c) => !c.parentId && c.isActive)
        .map((c) => `${c.id}: ${this.translateCategoryName(c.name)}`)
        .join('\n');

      const rendered = renderPrompt('categorySuggestion', {
        description,
        categoryCatalog: categoryList,
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const suggestedId = response.output_text?.trim() || '';

      // Validate the suggested ID exists
      const validCategory = categories.find((c) => c.id === suggestedId);
      return validCategory?.id ?? 'other_expense';
    } catch (error) {
      console.error('OpenAI category suggestion error:', error);
      return 'other_expense';
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Describe an already-computed spending pattern in prose.
   *
   * Takes a pre-built aggregate context rather than transactions: the insights
   * feature sends numbers and category names only, never a description, note or
   * merchant string. Facts in, prose out.
   */
  async generatePatternNarrative(context: string, locale: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    try {
      const rendered = renderPrompt('patternNarrative', {
        context,
        locale,
        languageInstruction: this.getLanguageInstruction(),
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      return trimToLastCompleteSentence((response.output_text ?? '').trim());
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Categorize multiple transactions
  async categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();
      const categoryList = buildCategoryPromptCatalog(
        categories,
        (name) => this.translateCategoryName(name)
      );

      const rendered = renderPrompt('categorizeTransactions', {
        categoryCatalog: categoryList,
        grounding,
        rows: transactions.map((t, i) => ({
          index: i,
          description: t.description,
          amount: t.amount,
        })),
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return applyCategorizations(transactions, categorizations, categories);
    } catch (error) {
      console.error('OpenAI batch categorization error:', error);
      return transactions.map((t) => ({
        ...t,
        suggestedCategoryId: 'other_expense',
        confidence: 0.1,
      }));
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Interpret a natural-language transaction search query. Throws on any
  // failure so the caller can fall back to plain keyword search.
  async interpretSearchQuery(query: string, context: SearchQueryContext): Promise<SearchIntent> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('searchQuery', { query, context });
      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const cleanedJson = this.extractJson(response.output_text || '');
      return parseSearchIntent(JSON.parse(cleanedJson), context);
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Generate spending summary
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency: string,
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    ragContext?: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();

      const toBaseCurrency = (amount: number, currency: string) =>
        this.currencyService.convert(amount, currency, baseCurrency);
      // Prompt amounts: plain digits, no sub-digits for zero-decimal currencies
      const fmt = (value: number) => this.currencyService.formatAmount(value, baseCurrency);

      const byCategory = new Map<string, { name: string; total: number; count: number }>();
      for (const t of transactions) {
        if (t.type !== 'expense') continue;

        const category = categories.find((c) => c.id === t.categoryId);
        const categoryName = this.translateCategoryName(category?.name);

        const existing = byCategory.get(t.categoryId) ?? { name: categoryName, total: 0, count: 0 };
        existing.total += toBaseCurrency(t.amount, t.currency);
        existing.count += 1;
        byCategory.set(t.categoryId, existing);
      }

      const totalIncome = transactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + toBaseCurrency(t.amount, t.currency), 0);

      const totalExpense = transactions
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + toBaseCurrency(t.amount, t.currency), 0);

      const categoryBreakdown = renderCategoryBreakdown(
        Array.from(byCategory.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map((c) => ({ name: c.name, total: fmt(c.total), count: c.count })),
        baseCurrency
      );

      const expenseTransactions = transactions.filter((t) => t.type === 'expense');
      const largestExpenses = renderLargestExpenses(
        [...expenseTransactions]
          .sort(
            (a, b) => toBaseCurrency(b.amount, b.currency) - toBaseCurrency(a.amount, a.currency)
          )
          .slice(0, 5)
          .map((t) => ({
            description: t.description,
            amount: fmt(toBaseCurrency(t.amount, t.currency)),
            categoryName: this.translateCategoryName(
              categories.find((c) => c.id === t.categoryId)?.name
            ),
          })),
        baseCurrency
      );

      let historicalSection = '';
      if (previousPeriodData && (previousPeriodData.income > 0 || previousPeriodData.expense > 0)) {
        historicalSection = renderPreviousPeriodSection({
          baseCurrency,
          previousIncome: fmt(previousPeriodData.income),
          previousExpense: fmt(previousPeriodData.expense),
          incomeChangePercent:
            previousPeriodData.income > 0
              ? (
                  ((totalIncome - previousPeriodData.income) / previousPeriodData.income) *
                  100
                ).toFixed(1)
              : 'N/A',
          expenseChangePercent:
            previousPeriodData.expense > 0
              ? (
                  ((totalExpense - previousPeriodData.expense) / previousPeriodData.expense) *
                  100
                ).toFixed(1)
              : 'N/A',
        });
      }

      let budgetSection = '';
      if (budgets && budgets.length > 0) {
        budgetSection = renderBudgetSection(
          budgets.map((b) => {
            const categorySpent = byCategory.get(b.categoryId)?.total ?? 0;
            const budgetAmountInBaseCurrency = this.currencyService.convert(
              b.amount,
              b.currency,
              baseCurrency
            );
            return {
              name: b.name,
              spent: fmt(categorySpent),
              limit: fmt(budgetAmountInBaseCurrency),
              percentUsed:
                budgetAmountInBaseCurrency > 0
                  ? (categorySpent / budgetAmountInBaseCurrency) * 100
                  : 0,
            };
          }),
          baseCurrency
        );
      }

      const rendered = renderPrompt('spendingSummary', {
        period,
        baseCurrency,
        totalIncome: fmt(totalIncome),
        totalExpense: fmt(totalExpense),
        net: fmt(totalIncome - totalExpense),
        transactionCount: transactions.length,
        categoryBreakdown,
        largestExpenses,
        historicalSection,
        budgetSection,
        grounding: ragContext,
        languageInstruction: this.getLanguageInstruction(),
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      return response.output_text?.trim() || 'Unable to generate spending summary.';
    } catch (error) {
      console.error('OpenAI summary generation error:', error);
      // Let the caller decide how to present the failure (and in which language)
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Get financial advice based on period totals
  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency: string,
    period = 'this month'
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const savingsRate =
        summary.income > 0
          ? ((summary.income - summary.expense) / summary.income) * 100
          : 0;
      const fmt = (value: number) => this.currencyService.formatAmount(value, baseCurrency);

      const rendered = renderPrompt('financialAdvice', {
        period,
        baseCurrency,
        income: fmt(summary.income),
        expense: fmt(summary.expense),
        balance: fmt(summary.balance),
        savingsRate,
        balanceIsNegative: summary.balance < 0,
        languageInstruction: this.getLanguageInstruction(),
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      return (
        response.output_text?.trim() ||
        'Keep tracking your expenses to better understand your spending patterns.'
      );
    } catch (error) {
      console.error('OpenAI financial advice error:', error);
      // Let the caller decide how to present the failure (and in which language)
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Statement extraction. Same call as extractTransactionsFromImage here —
   * this provider has always treated an image as a set of rows — but named for
   * the intent so the import path can ask for it explicitly.
   */
  extractStatementTransactions(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    return this.extractTransactionsFromImage(imageBase64, options);
  }

  // Extract transactions from an image
  async extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('statementTransactions');

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: this.renderedText(rendered) },
              { type: 'input_image', image_url: imageUrl, detail: 'auto' },
            ],
          },
        ],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category,
        merchant: t.merchant,
        details: t.details,
        amountConfidence: t.amountConfidence,
        dateConfidence: t.dateConfidence,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI image extraction error:', error);
      // Rethrow, matching GeminiService: an expired key or a billing cap must
      // reach parseAIError and render as a typed error card, not as "no
      // transactions found" — and the strategy layer can only fall back to
      // another provider on a throw, never on a plausible empty result.
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from multiple images
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    if (imageBase64Array.length === 0) {
      return [];
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('multiImageReceipts', {
        imageCount: imageBase64Array.length,
      });

      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: 'input_text', text: this.renderedText(rendered) },
      ];

      for (const imageBase64 of imageBase64Array) {
        const imageUrl = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        content.push({ type: 'input_image', image_url: imageUrl, detail: 'auto' });
      }

      const response = await this.client.responses.create({
        model: this.model,
        input: [{ role: 'user', content }],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: MultiImageExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category ? this.mapCategoryNameToId(t.category) : undefined,
        merchant: t.merchant,
        details: t.details,
        imageIndex: t.imageIndex ?? 0,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        receiptId: t.receiptId ?? 1,
        receiptDetails: t.receiptDetails,
        wasMerged: t.wasMerged || false,
        mergedFromImages: t.mergedFromImages,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI multi-image extraction error:', error);
      // Rethrow for the same reason as the single-image path above.
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Detect CSV column mapping
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('csvMapping', { headers, sampleRows });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('OpenAI CSV mapping detection error:', error);
      return {
        dateColumn: headers[0] || 'date',
        descriptionColumn: headers[1] || 'description',
        amountColumn: headers[2] || 'amount',
        dateFormat: 'MM/DD/YYYY',
        hasHeader: true,
      };
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Helper: Get language instruction
  private getLanguageInstruction(): string {
    return languageInstruction(this.translationService.currentLocale());
  }

  /**
   * Flatten a registry prompt for the Responses API, which has no separate
   * system field — unlike Claude, which takes one at the top level.
   *
   * No JSON preamble is added: that is a Gemini workaround, and adding it here
   * would spend tokens telling OpenAI not to do something it does not do.
   */
  private renderedText(rendered: RenderedPrompt): string {
    return rendered.system ? `${rendered.system}\n\n${rendered.user}` : rendered.user;
  }

  /**
   * The caller's cancellation, in the shape `responses.create` takes as its
   * second argument. Undefined when there is nothing to cancel with, so a
   * request without a signal is issued exactly as it was before.
   */
  private requestOptions(options?: AIRequestOptions): { signal: AbortSignal } | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }

  // Helper: Extract JSON from response
  private extractJson(text: string): string {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    return cleaned.trim();
  }

  /**
   * Category names of default categories are stored as i18n keys
   * (e.g. categoryNames.groceries) — translate them before they reach a
   * prompt, otherwise the model echoes the raw key into the insights text.
   */
  private translateCategoryName(name?: string): string {
    return name ? this.translationService.t(name) : 'Other';
  }

  // Helper: Map category name to ID
  private mapCategoryNameToId(categoryName: string): string {
    return mapCategoryNameToId(
      categoryName,
      this.categoryService.categories(),
      (name) => this.translateCategoryName(name)
    );
  }
}
