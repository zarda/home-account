import { Injectable, inject, signal, computed } from '@angular/core';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL } from '../config/ai-models';
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
import { CloudLLMProviderAdapter, ProviderCapabilities } from './llm-provider.interface';
import { trimToLastCompleteSentence } from '../utils/llm-text.utils';

@Injectable({ providedIn: 'root' })
export class ClaudeService implements CloudLLMProviderAdapter {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  private client: Anthropic | null = null;
  private currentApiKey: string | null = null;

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  private _isAvailable = signal<boolean>(false);

  // Computed signal for availability
  isAvailableSignal = computed(() => this._isAvailable());

  // Selectable Claude model (all catalog entries are vision-capable)
  private model = DEFAULT_CLAUDE_MODEL;

  constructor() {
    // Claude is not initialized by default - requires user API key
  }

  private async initialize(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      console.warn('Claude API key not provided');
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
      const { default: Anthropic } = await this.loadSdk();
      this.client = new Anthropic({
        apiKey: apiKey,
        // Same bring-your-own-key trust model as the OpenAI provider: the
        // user's own key, stored in their own account. Without this flag the
        // SDK throws at construction in browsers, so Claude could never
        // become available and its settings card stayed 'Not configured'.
        dangerouslyAllowBrowser: true,
      });
      this.currentApiKey = apiKey;
      this._isAvailable.set(true);
    } catch (error) {
      console.error('Failed to initialize Claude:', error);
      this.client = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
    }
  }

  // Seam for the on-demand SDK import so the load step can be substituted.
  protected loadSdk(): Promise<typeof import('@anthropic-ai/sdk')> {
    return import('@anthropic-ai/sdk');
  }

  /**
   * Reinitialize Claude with a new API key.
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


  /** Switch the Claude model used for all requests. */
  setModel(modelId: string): void {
    if (modelId && modelId !== this.model) {
      this.model = modelId;
      console.log(`[ClaudeService] Model switched to ${modelId}`);
    }
  }

  // Check if Claude is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Every entry in the Claude catalog is vision-capable. PDFs are not accepted
   * directly — the pages have to be rasterized first.
   */
  get capabilities(): ProviderCapabilities {
    return { vision: true, nativePdf: false };
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    if (!this.client) {
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptParse');

      // Extract base64 data without the data URL prefix
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const mediaType = this.getMediaType(imageBase64);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              { type: 'text', text: this.renderedText(rendered) },
            ],
          },
        ],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      const parsed = JSON.parse(cleanedJson);

      // Map suggested category to category ID
      const categoryId = this.mapCategoryNameToId(parsed.suggestedCategory);

      return {
        merchant: parsed.merchant || 'Unknown',
        amount: Number(parsed.amount) || 0,
        currency: parsed.currency || 'USD',
        date: parsed.date ? new Date(parsed.date) : new Date(),
        items: parsed.items || [],
        receiptDetails: parsed.receiptDetails,
        suggestedCategory: categoryId,
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5,
        receiptCount: Number(parsed.receiptCount) || 1,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Claude receipt parsing error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Suggest category for a transaction description
  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    if (!this.client) {
      throw new Error('Claude client not available');
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const suggestedId = this.extractTextFromResponse(response).trim();

      // Validate the suggested ID exists
      const validCategory = categories.find((c) => c.id === suggestedId);
      return validCategory?.id ?? 'other_expense';
    } catch (error) {
      console.error('Claude category suggestion error:', error);
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
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);
    try {
      const rendered = renderPrompt('patternNarrative', {
        context,
        locale,
        languageInstruction: this.getLanguageInstruction(),
      });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      return trimToLastCompleteSentence(this.extractTextFromResponse(response).trim());
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
      throw new Error('Claude client not available');
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return applyCategorizations(transactions, categorizations, categories);
    } catch (error) {
      console.error('Claude batch categorization error:', error);
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
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('searchQuery', { query, context });
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const cleanedJson = this.extractJson(this.extractTextFromResponse(response));
      return parseSearchIntent(JSON.parse(cleanedJson), context);
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Generate spending summary
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency = 'USD',
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    ragContext?: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Claude client not available');
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      return this.extractTextFromResponse(response) || 'Unable to generate spending summary.';
    } catch (error) {
      console.error('Claude summary generation error:', error);
      // Let the caller decide how to present the failure (and in which language)
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Get financial advice based on period totals
  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency = 'USD',
    period = 'this month'
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Claude client not available');
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      return (
        this.extractTextFromResponse(response) ||
        'Keep tracking your expenses to better understand your spending patterns.'
      );
    } catch (error) {
      console.error('Claude financial advice error:', error);
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
  extractStatementTransactions(imageBase64: string): Promise<ExtractedTransaction[]> {
    return this.extractTransactionsFromImage(imageBase64);
  }

  // Extract transactions from an image
  async extractTransactionsFromImage(imageBase64: string): Promise<ExtractedTransaction[]> {
    if (!this.client) {
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('statementTransactions');

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const mediaType = this.getMediaType(imageBase64);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              { type: 'text', text: this.renderedText(rendered) },
            ],
          },
        ],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'USD',
        category: t.category,
        merchant: t.merchant,
        details: t.details,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Claude image extraction error:', error);
      return [];
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from multiple images
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[]
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.client) {
      throw new Error('Claude client not available');
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

      const content: Anthropic.Messages.ContentBlockParam[] = [];

      // Add all images first
      for (const imageBase64 of imageBase64Array) {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const mediaType = this.getMediaType(imageBase64);
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        });
      }

      // Add the prompt text
      content.push({ type: 'text', text: this.renderedText(rendered) });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content }],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      const extracted: MultiImageExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'USD',
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
      console.error('Claude multi-image extraction error:', error);
      return [];
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Detect CSV column mapping
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    if (!this.client) {
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('csvMapping', { headers, sampleRows });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('Claude CSV mapping detection error:', error);
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

  // Helper: Extract text from Claude response
  private extractTextFromResponse(response: Anthropic.Messages.Message): string {
    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }

  // Helper: Get media type from base64 image
  private getMediaType(
    imageBase64: string
  ): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    if (imageBase64.startsWith('data:image/png')) return 'image/png';
    if (imageBase64.startsWith('data:image/gif')) return 'image/gif';
    if (imageBase64.startsWith('data:image/webp')) return 'image/webp';
    return 'image/jpeg';
  }

  // Helper: Get language instruction
  private getLanguageInstruction(): string {
    return languageInstruction(this.translationService.currentLocale());
  }

  /**
   * The user turn of a registry prompt.
   *
   * Claude is the one provider with a real top-level `system` parameter, so a
   * prompt that sets `system` must not have it folded into the user turn here —
   * `systemParam` below carries it instead.
   */
  private renderedText(rendered: RenderedPrompt): string {
    return rendered.user;
  }

  /** Spread into `messages.create` so `system` is only sent when a prompt sets one. */
  private systemParam(rendered: RenderedPrompt): { system?: string } {
    return rendered.system ? { system: rendered.system } : {};
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
