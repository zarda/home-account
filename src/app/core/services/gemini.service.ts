import { Injectable, inject, signal, computed } from '@angular/core';
import type {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerateContentResult,
  SingleRequestOptions,
} from '@google/generative-ai';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Budget, Category, Goal, Transaction, MonthlyTotal } from '../../models';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';
import {
  readCurrencyCode,
  readFieldConfidence,
  readReceiptTotal,
} from '../utils/receipt-extraction.utils';
import {
  trimToLastCompleteSentence,
  dropIncompleteTrailingLine,
  dropNonCjkSentences,
  protectDecimalPoints,
  restoreDecimalPoints,
} from '../utils/llm-text.utils';
import {
  applyCategorizations,
  buildCategoryPromptCatalog,
  mapCategoryNameToId,
} from '../utils/categorization.utils';
import { parseSearchIntent } from '../utils/nl-search.utils';
import { SearchIntent, SearchQueryContext } from '../../models';
import {
  JSON_ONLY_PREAMBLE,
  RenderedPrompt,
  languageInstruction,
  renderBudgetSection,
  renderGoalSection,
  renderCategoryBreakdown,
  renderLargestExpenses,
  renderPreviousPeriodSection,
  renderPrompt,
} from '../prompts';
import {
  AIRequestOptions,
  CSVColumnMapping,
  CategorizedTransaction,
  CloudLLMProviderAdapter,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ParsedReceipt,
  PreviousPeriodData,
  ProviderCapabilities,
  RawTransaction,
  isRateLimitMessage,
} from './llm-provider.interface';
import { environment } from '../../../environments/environment';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';

/**
 * The extraction result types now live with the provider contract. They are
 * re-exported here because a dozen callers import them from this path, and
 * churning those imports would bury the move in unrelated diff.
 */
export type {
  CSVColumnMapping,
  CategorizedTransaction,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ParsedReceipt,
  PreviousPeriodData,
  RawTransaction,
  ReceiptItem,
} from './llm-provider.interface';

@Injectable({ providedIn: 'root' })
export class GeminiService implements CloudLLMProviderAdapter {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  private genAI: GoogleGenerativeAI | null = null;
  private textModel: GenerativeModel | null = null;
  private visionModel: GenerativeModel | null = null;
  private currentApiKey: string | null = null;
  private currentTextModelId = DEFAULT_TEXT_MODEL;
  private currentVisionModelId = DEFAULT_VISION_MODEL;

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  private _isAvailable = signal<boolean>(false);

  // Computed signal for availability
  isAvailableSignal = computed(() => this._isAvailable());

  constructor() {
    void this.initializeGemini();
  }

  private async initializeGemini(customApiKey?: string, textModelId?: string, visionModelId?: string): Promise<void> {
    // Priority: custom key > environment key (if available)
    const apiKey = customApiKey || (environment as { geminiApiKey?: string }).geminiApiKey;

    if (!apiKey || apiKey.startsWith('${')) {
      console.warn('[GeminiService] No valid API key found. Custom:', !!customApiKey, 'Environment:', !!(environment as { geminiApiKey?: string }).geminiApiKey);
      this.clear();
      return;
    }

    // Fall back to the CURRENT models, not the catalog defaults — a
    // reinitialization without explicit model ids (e.g. when the API key is
    // saved) must not silently revert the user's model selection
    const finalTextModel = textModelId || this.currentTextModelId;
    const finalVisionModel = visionModelId || this.currentVisionModelId;

    // Same key — only update models if they changed
    if (apiKey === this.currentApiKey && this.genAI) {
      if (finalTextModel !== this.currentTextModelId || finalVisionModel !== this.currentVisionModelId) {
        console.log(`[GeminiService] Same API key, switching models: text=${finalTextModel}, vision=${finalVisionModel}`);
        this.textModel = this.genAI.getGenerativeModel({ model: finalTextModel });
        this.visionModel = this.genAI.getGenerativeModel({ model: finalVisionModel });
        this.currentTextModelId = finalTextModel;
        this.currentVisionModelId = finalVisionModel;
      }
      return;
    }

    try {
      console.log('[GeminiService] Initializing with new API key (length:', apiKey.length, ')');
      // The SDK is loaded on demand to keep it out of the initial bundle
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(apiKey);

      this.textModel = this.genAI.getGenerativeModel({ model: finalTextModel });
      this.visionModel = this.genAI.getGenerativeModel({ model: finalVisionModel });
      this.currentApiKey = apiKey;
      this.currentTextModelId = finalTextModel;
      this.currentVisionModelId = finalVisionModel;
      this._isAvailable.set(true);

      console.log(`[GeminiService] ✓ Initialized successfully with text model: ${finalTextModel}, vision model: ${finalVisionModel}`);
    } catch (error) {
      console.error('[GeminiService] ✗ Failed to initialize:', error);
      this.genAI = null;
      this.textModel = null;
      this.visionModel = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
    }
  }

  /**
   * Reinitialize Gemini with a new API key and/or models.
   * Used when user provides their own API key or changes model selection in settings.
   */
  reinitialize(apiKey?: string, textModelId?: string, visionModelId?: string): Promise<void> {
    return this.initializeGemini(apiKey, textModelId, visionModelId);
  }

  /**
   * Tear the client down and report unavailable.
   *
   * Distinct from `reinitialize()` with no key, which falls back to the build's
   * environment key — right at start-up, wrong at sign-out. On a build that
   * ships one, clearing via reinitialize would re-arm Gemini under the
   * departing account's key and leave it available to the next account.
   */
  clear(): void {
    this.genAI = null;
    this.textModel = null;
    this.visionModel = null;
    this.currentApiKey = null;
    this._isAvailable.set(false);
  }

  // Check if Gemini is available
  isAvailable(): boolean {
    return this.genAI !== null && this.textModel !== null;
  }

  /**
   * Gemini is the only provider with separate text and vision handles, so it is
   * the only one that can be available for text while unable to see an image —
   * every vision method here used to fail at the point of use with 'Gemini
   * Vision model not available' rather than being routed around.
   *
   * It is also the only provider that accepts a PDF directly.
   */
  get capabilities(): ProviderCapabilities {
    return { vision: this.visionModel !== null, nativePdf: this.visionModel !== null };
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt> {
    // Try textModel first (more capable), fall back to visionModel on rate limit
    const models = [this.textModel, this.visionModel].filter(Boolean);
    if (models.length === 0) {
      throw new Error('Gemini model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    const rendered = renderPrompt('receiptParse');
    const prompt = this.renderedText(rendered);

    let lastError: unknown;

    for (const model of models) {
      try {
        const result = await model!.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
                }
              }
            ]
          }],
          generationConfig: this.generationConfig(rendered)
        }, this.requestOptions(options));

        const responseText = result.response.text();
        const cleanedJson = this.extractJson(responseText);
        const parsed = JSON.parse(cleanedJson);

        const categoryId = this.mapCategoryNameToId(parsed.suggestedCategory);

        this.isProcessing.set(false);
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
          fieldConfidence: readFieldConfidence(parsed)
        };
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        // Only fall back to next model on rate limit / quota errors
        if (this.isRateLimitError(msg) && models.indexOf(model!) < models.length - 1) {
          console.warn(`[GeminiService] Model rate-limited, trying fallback model`);
          continue;
        }
        break;
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error';
    this.lastError.set(errorMessage);
    console.error('Receipt parsing error:', lastError);
    this.isProcessing.set(false);
    throw lastError;
  }

  // Suggest category for a transaction description
  async suggestCategory(
    description: string,
    categories: Category[]
  ): Promise<string> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const categoryList = categories
        .filter(c => !c.parentId && c.isActive)
        .map(c => `${c.id}: ${this.translateCategoryName(c.name)}`)
        .join('\n');

      const rendered = renderPrompt('categorySuggestion', {
        description,
        categoryCatalog: categoryList,
      });

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const responseText = result.response.text().trim();
      const suggestedId = this.filterReasoningContext(responseText);

      // Validate the suggested ID exists
      const validCategory = categories.find(c => c.id === suggestedId);
      return validCategory?.id ?? 'other_expense';
    } catch (error) {
      console.error('Category suggestion error:', error);
      return 'other_expense';
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Categorize multiple transactions
  async categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();
      const categoryList = buildCategoryPromptCatalog(
        categories,
        name => this.translateCategoryName(name)
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

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return applyCategorizations(transactions, categorizations, categories);
    } catch (error) {
      console.error('Batch categorization error:', error);
      // Return with default category if AI fails
      return transactions.map(t => ({
        ...t,
        suggestedCategoryId: 'other_expense',
        confidence: 0.1
      }));
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Interpret a natural-language transaction search query. Throws on any
  // failure so the caller can fall back to plain keyword search.
  async interpretSearchQuery(query: string, context: SearchQueryContext): Promise<SearchIntent> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('searchQuery', { query, context });
      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const cleanedJson = this.extractJson(result.response.text());
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
    goals?: Goal[],
    ragContext?: string
  ): Promise<string> {
    if (!this.textModel) {
      console.error('[GeminiService] ✗ Text model not available for spending summary');
      throw new Error('Gemini text model not available');
    }

    console.log(`[GeminiService] Generating spending summary for ${transactions.length} transactions in period: ${period}`);
    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();

      // Helper to convert amount to base currency (real-time conversion)
      const toBaseCurrency = (amount: number, currency: string) =>
        this.currencyService.convert(amount, currency, baseCurrency);
      // Prompt amounts: plain digits, no sub-digits for zero-decimal currencies
      const fmt = (value: number) => this.currencyService.formatAmount(value, baseCurrency);

      // Group transactions by category
      const byCategory = new Map<string, { name: string; total: number; count: number }>();
      for (const t of transactions) {
        if (t.type !== 'expense') continue;

        const category = categories.find(c => c.id === t.categoryId);
        const categoryName = this.translateCategoryName(category?.name);

        const existing = byCategory.get(t.categoryId) ?? { name: categoryName, total: 0, count: 0 };
        existing.total += toBaseCurrency(t.amount, t.currency);
        existing.count += 1;
        byCategory.set(t.categoryId, existing);
      }

      const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + toBaseCurrency(t.amount, t.currency), 0);

      const totalExpense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + toBaseCurrency(t.amount, t.currency), 0);

      const categoryBreakdown = renderCategoryBreakdown(
        Array.from(byCategory.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map(c => ({ name: c.name, total: fmt(c.total), count: c.count })),
        baseCurrency
      );

      // Build individual transactions list (recent + largest)
      const expenseTransactions = transactions.filter(t => t.type === 'expense');
      const largestExpenses = renderLargestExpenses(
        [...expenseTransactions]
          .sort((a, b) => toBaseCurrency(b.amount, b.currency) - toBaseCurrency(a.amount, a.currency))
          .slice(0, 5)
          .map(t => ({
            description: t.description,
            amount: fmt(toBaseCurrency(t.amount, t.currency)),
            categoryName: this.translateCategoryName(
              categories.find(c => c.id === t.categoryId)?.name
            ),
          })),
        baseCurrency
      );

      // Build historical comparison section
      let historicalSection = '';
      if (previousPeriodData && (previousPeriodData.income > 0 || previousPeriodData.expense > 0)) {
        historicalSection = renderPreviousPeriodSection({
          baseCurrency,
          previousIncome: fmt(previousPeriodData.income),
          previousExpense: fmt(previousPeriodData.expense),
          incomeChangePercent: previousPeriodData.income > 0
            ? ((totalIncome - previousPeriodData.income) / previousPeriodData.income * 100).toFixed(1)
            : 'N/A',
          expenseChangePercent: previousPeriodData.expense > 0
            ? ((totalExpense - previousPeriodData.expense) / previousPeriodData.expense * 100).toFixed(1)
            : 'N/A',
        });
      }

      // Build budget section
      let budgetSection = '';
      if (budgets && budgets.length > 0) {
        budgetSection = renderBudgetSection(
          budgets.map(b => {
            const categorySpent = byCategory.get(b.categoryId)?.total ?? 0;
            // Convert budget amount to base currency for comparison
            const budgetAmountInBaseCurrency = this.currencyService.convert(b.amount, b.currency, baseCurrency);
            return {
              name: b.name,
              spent: fmt(categorySpent),
              limit: fmt(budgetAmountInBaseCurrency),
              percentUsed: budgetAmountInBaseCurrency > 0
                ? (categorySpent / budgetAmountInBaseCurrency * 100)
                : 0,
            };
          }),
          baseCurrency
        );
      }

      let goalSection = '';
      if (goals && goals.length > 0) {
        goalSection = renderGoalSection(
          goals.map(g => {
            // Goals convert like budgets: compare in the base currency.
            const targetInBase = this.currencyService.convert(g.targetAmount, g.currency, baseCurrency);
            const savedInBase = this.currencyService.convert(g.contributedAmount, g.currency, baseCurrency);
            return {
              name: g.name,
              saved: fmt(savedInBase),
              target: fmt(targetInBase),
              percentSaved: targetInBase > 0 ? (savedInBase / targetInBase * 100) : 0,
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
        goalSection,
        grounding: ragContext,
        languageInstruction: this.getLanguageInstruction(),
      });

      const result = await this.generateTextWithRetry({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const rawText = result.response.text().trim();
      const filteredText = this.currentTextModelId.includes('gemma-4')
        ? this.filterReasoningContext(rawText)
        : rawText;
      // Never end on a line that was cut off mid-sentence; when the token
      // limit was hit, even a trailing list item is known to be truncated
      const responseText = dropIncompleteTrailingLine(filteredText, {
        dropListItems: this.hitTokenLimit(result),
      });
      console.log(`[GeminiService] ✓ Spending summary generated by ${this.currentTextModelId} (length: ${rawText.length} → ${responseText.length})`);
      return responseText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GeminiService] ✗ Summary generation error:', errorMsg);
      // Let the caller decide how to present the failure (and in which language)
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Get financial advice based on period totals
  /**
   * Describe an already-computed spending pattern in prose.
   *
   * Takes a pre-built aggregate context rather than transactions: the insights
   * feature sends numbers and category names only, never a description, note or
   * merchant string. Facts in, prose out.
   */
  async generatePatternNarrative(context: string, locale: string): Promise<string> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);
    try {
      const rendered = renderPrompt('patternNarrative', {
        context,
        locale,
        languageInstruction: this.getLanguageInstruction(),
      });

      const result = await this.generateTextWithRetry({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });

      let text = result.response.text().trim();
      if (locale === 'tc' || locale === 'ja') {
        text = dropNonCjkSentences(text);
      }
      return trimToLastCompleteSentence(text);
    } finally {
      this.isProcessing.set(false);
    }
  }

  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency: string,
    period = 'this month'
  ): Promise<string> {
    if (!this.textModel) {
      console.error('[GeminiService] ✗ Text model not available for financial advice');
      throw new Error('Gemini text model not available');
    }

    console.log(`[GeminiService] Generating financial advice for period: ${period}`);
    this.isProcessing.set(true);

    try {
      const savingsRate = summary.income > 0
        ? ((summary.income - summary.expense) / summary.income * 100)
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

      const result = await this.generateTextWithRetry({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const rawText = result.response.text().trim();
      let filteredText = this.currentTextModelId.includes('gemma-4')
        ? this.filterReasoningContextForAdvice(rawText)
        : rawText;
      // In CJK locales, English-only sentences are leftover draft commentary
      const locale = this.translationService.currentLocale();
      if (locale === 'tc' || locale === 'ja') {
        filteredText = dropNonCjkSentences(filteredText);
      }
      // Never show advice that was cut off mid-sentence
      const responseText = trimToLastCompleteSentence(filteredText);
      console.log(`[GeminiService] ✓ Financial advice generated by ${this.currentTextModelId} (length: ${rawText.length} → ${responseText.length})`);
      return responseText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GeminiService] ✗ Financial advice error:', errorMsg);
      // Let the caller decide how to present the failure (and in which language)
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Read a statement screenshot into one row per line item.
   *
   * Separate from extractTransactionsFromImage, which asks for a single
   * receipt summary — running that over a statement returned one lumped
   * transaction for the whole page, which is what made statement import
   * unusable on Gemini.
   */
  async extractStatementTransactions(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('statementTransactions');

      const result = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: this.renderedText(rendered) },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
              }
            }
          ]
        }],
        generationConfig: this.generationConfig(rendered)
      }, this.requestOptions(options));

      const extracted: ExtractedTransaction[] = JSON.parse(
        this.extractJson(result.response.text())
      );

      return extracted.map(t => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category ? this.mapCategoryNameToId(t.category) : undefined,
        merchant: t.merchant,
        details: t.details,
        amountConfidence: t.amountConfidence,
        dateConfidence: t.dateConfidence,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('[GeminiService] ✗ Statement extraction error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from an image (receipt, bank statement screenshot)
  async extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptSummary');

      console.log('[GeminiService] Extracting receipt summary');
      const extractResult = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: this.renderedText(rendered) },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
              }
            }
          ]
        }],
        generationConfig: this.generationConfig(rendered)
      }, this.requestOptions(options));

      const responseText = extractResult.response.text();
      const cleanedJson = this.extractJsonStrict(responseText);
      const receiptData = JSON.parse(cleanedJson);

      // Map category name to ID
      const categoryId = receiptData.suggestedCategory
        ? this.mapCategoryNameToId(receiptData.suggestedCategory)
        : undefined;

      const extracted: ExtractedTransaction[] = [{
        date: receiptData.date || dayKey(new Date()),
        description: receiptData.merchant || 'Receipt',
        amount: Math.abs(receiptData.totalAmount || 0),
        type: 'expense',
        currency: readCurrencyCode(receiptData.currency),
        merchant: receiptData.merchant,
        category: categoryId,
        details: receiptData.receiptDetails || receiptData.itemsSummary || receiptData.items || receiptData.description || ''
      }];

      // Return full ExtractedTransaction objects with all details
      return extracted.map(t => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category,
        merchant: t.merchant,
        details: t.details,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('[GeminiService] ✗ Image extraction error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from a PDF document (bank statement)
  async extractTransactionsFromPDF(pdfBase64: string): Promise<RawTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('pdfStatement');

      const result = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: this.renderedText(rendered) },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64.replace(/^data:application\/pdf;base64,/, '')
              }
            }
          ]
        }],
        generationConfig: this.generationConfig(rendered)
      });

      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      // Convert to RawTransaction format
      return extracted.map(t => ({
        description: t.description || 'Unknown',
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: parseDateInput(t.date) ?? new Date()
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('PDF extraction error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Extract transactions from multiple images of a single receipt with position-aware deduplication.
   * Images should be ordered top-to-bottom as they appear on the receipt.
   */
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    const models = [this.textModel, this.visionModel].filter(Boolean);
    if (models.length === 0) {
      throw new Error('Gemini model not available');
    }

    if (imageBase64Array.length === 0) {
      return [];
    }

    // For single image, use simpler extraction with position metadata
    if (imageBase64Array.length === 1) {
      return this.extractWithPositionMetadata(imageBase64Array[0], 0, options);
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    const rendered = renderPrompt('multiImageReceipts', {
      imageCount: imageBase64Array.length,
    });

    // Build the content parts with all images
    const imageParts = imageBase64Array.map(imageBase64 => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
      }
    }));

    let lastError: unknown;

    for (const model of models) {
      try {
        const result = await model!.generateContent({
          contents: [{
            role: 'user',
            parts: [{ text: this.renderedText(rendered) }, ...imageParts]
          }],
          generationConfig: this.generationConfig(rendered)
        }, this.requestOptions(options));
        const responseText = result.response.text();
        const cleanedJson = this.extractJson(responseText);
        const extracted: MultiImageExtractedTransaction[] = JSON.parse(cleanedJson);

        console.log(`[GeminiService] ✓ Extracted ${extracted.length} unique items from ${imageBase64Array.length} receipt images`);

        // Validate and normalize the extracted data
        return extracted.map(t => ({
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
          receiptTotal: readReceiptTotal(t.receiptTotal),
          wasMerged: t.wasMerged || false,
          mergedFromImages: t.mergedFromImages,
        }));
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (this.isRateLimitError(msg) && models.indexOf(model!) < models.length - 1) {
          console.warn(`[GeminiService] Model rate-limited for multi-image, trying fallback`);
          continue;
        }
        break;
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error';
    this.lastError.set(errorMessage);
    console.error('Multi-image extraction error:', lastError);
    this.isProcessing.set(false);
    throw lastError;
  }

  /**
   * Extract transactions from a single image with position metadata.
   * Used internally for single-image multi-image flow.
   */
  private async extractWithPositionMetadata(
    imageBase64: string,
    imageIndex: number,
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptItems');

      const result = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: this.renderedText(rendered) },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
              }
            }
          ]
        }],
        generationConfig: this.generationConfig(rendered)
      }, this.requestOptions(options));

      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted = JSON.parse(cleanedJson);

      // Add imageIndex and normalize data
      return extracted.map((t: Partial<MultiImageExtractedTransaction>) => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category ? this.mapCategoryNameToId(t.category) : undefined,
        merchant: t.merchant,
        details: t.details,
        imageIndex: imageIndex,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        receiptId: t.receiptId ?? 1,
        receiptDetails: t.receiptDetails,
        receiptTotal: readReceiptTotal(t.receiptTotal),
        wasMerged: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Single image position extraction error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Detect CSV column mapping using AI
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('csvMapping', { headers, sampleRows });

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
        generationConfig: this.generationConfig(rendered)
      });
      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('CSV mapping detection error:', error);
      // Return default mapping
      return {
        dateColumn: headers[0] || 'date',
        descriptionColumn: headers[1] || 'description',
        amountColumn: headers[2] || 'amount',
        dateFormat: 'MM/DD/YYYY',
        hasHeader: true
      };
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Helper: Get language instruction for AI prompts based on user's locale
  private getLanguageInstruction(): string {
    return languageInstruction(this.translationService.currentLocale());
  }

  /**
   * Render a registry prompt into the text Gemini should receive.
   *
   * The JSON-only preamble is added here rather than written into the prompts
   * because it is a Gemini quirk: its models otherwise narrate their reasoning
   * ahead of the JSON and the parse fails. OpenAI and Claude need no such
   * warning, and when the preamble lived in the prompt text it was one of the
   * reasons the three copies of each prompt drifted apart.
   */
  private renderedText(rendered: RenderedPrompt): string {
    const preamble = rendered.expects === 'json' ? `${JSON_ONLY_PREAMBLE}\n\n` : '';
    const system = rendered.system ? `${rendered.system}\n\n` : '';
    return `${preamble}${system}${rendered.user}`;
  }

  /**
   * Gemma drafts verbosely before its final answer, so every prose reply gets
   * double the room or the visible text arrives truncated. That is a property of
   * the model rather than of the task, which is why it is applied here and not
   * in the registry. JSON replies are unaffected — they do not get drafted.
   */
  private generationConfig(rendered: RenderedPrompt) {
    const draftsVerbosely =
      this.currentTextModelId.includes('gemma') && rendered.expects !== 'json';
    return {
      maxOutputTokens: draftsVerbosely ? rendered.maxOutputTokens * 2 : rendered.maxOutputTokens,
      temperature: rendered.temperature,
      ...(rendered.topP !== undefined ? { topP: rendered.topP } : {}),
    };
  }

  /**
   * The caller's cancellation, in the shape `generateContent` takes as its
   * second argument.
   *
   * Undefined when there is nothing to cancel with, so a request without a
   * signal reaches fetch exactly as it did before — the SDK wires up an
   * AbortController of its own for any options object it is handed.
   */
  private requestOptions(options?: AIRequestOptions): SingleRequestOptions | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }

  // Helper: Extract JSON from response that might have markdown formatting or reasoning
  private extractJsonStrict(text: string): string {
    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Remove any thinking tags or tokens
    cleaned = cleaned
      .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, '')
      .replace(/<\|channel[\s\S]*?channel\|>/g, '')
      .replace(/<thought>[\s\S]*?<\/thought>/g, '');

    // Find opening bracket (array or object)
    const startIdx = cleaned.search(/[[{]/);
    if (startIdx === -1) {
      console.error('[GeminiService] No JSON found in response:', cleaned.substring(0, 200));
      throw new Error('No JSON found in response');
    }

    // Use proper bracket matching (same as extractJson)
    let curlyDepth = 0;
    let squareDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') curlyDepth++;
      else if (ch === '}') curlyDepth--;
      else if (ch === '[') squareDepth++;
      else if (ch === ']') squareDepth--;

      if (curlyDepth === 0 && squareDepth === 0) {
        return cleaned.substring(startIdx, i + 1);
      }
    }

    console.error('[GeminiService] Malformed JSON - unclosed brackets');
    throw new Error('Malformed JSON - no closing bracket found');
  }

  private extractJson(text: string): string {
    // Only apply aggressive reasoning filtering for Gemma 4 models
    let cleaned: string;
    if (this.currentTextModelId.includes('gemma-4')) {
      cleaned = this.filterReasoningContext(text);
    } else {
      // For Gemini models, just strip thinking tokens
      cleaned = text
        .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, '')
        .replace(/<\|channel[\s\S]*?channel\|>/g, '')
        .replace(/<thought>[\s\S]*?<\/thought>/g, '');
    }

    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Find JSON object or array using proper bracket matching
    const startIdx = cleaned.search(/[[{]/);
    if (startIdx === -1) {
      return cleaned.trim();
    }

    // Track both bracket types to handle nested structures like {"items": [{...}]}
    let curlyDepth = 0;
    let squareDepth = 0;
    let inString = false;
    let escape = false;
    const startChar = cleaned[startIdx];

    for (let i = startIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') curlyDepth++;
      else if (ch === '}') curlyDepth--;
      else if (ch === '[') squareDepth++;
      else if (ch === ']') squareDepth--;

      // Done when we're back to zero depth for the outer bracket type
      if (startChar === '{' && curlyDepth === 0 && squareDepth === 0) {
        return cleaned.substring(startIdx, i + 1);
      }
      if (startChar === '[' && squareDepth === 0 && curlyDepth === 0) {
        return cleaned.substring(startIdx, i + 1);
      }
    }

    // Fallback: greedy regex match
    const jsonMatch = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    return cleaned.trim();
  }

  // Helper: Filter reasoning context specifically for financial advice
  // Aggressively removes all metadata, drafts, and reasoning to extract ONLY final advice
  private filterReasoningContextForAdvice(text: string): string {
    let cleaned = text
      // Remove thinking tokens
      .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, '')
      .replace(/<\|channel[\s\S]*?channel\|>/g, '')
      .replace(/<thought>[\s\S]*?<\/thought>/g, '');

    // Check if we're using Gemma 4 (verbose model that needs heavy filtering)
    const isGemma4 = this.currentTextModelId.includes('gemma-4');

    if (isGemma4) {
      // AGGRESSIVE filtering for Gemma 4 (verbose model with multiple drafts)
      // Strategy: Find the FINAL/LAST occurrence of advice that starts with key markers
      const adviceMarkers = ['Immediately halt', 'To address', 'To cover', 'To resolve', 'To bridge', 'Since you', 'You can', 'Focus on', 'Prioritize', 'Your priority', 'Halt all'];
      let lastAdviceIndex = -1;
      let adviceMarkerFound = '';

      // Find the LAST occurrence of any advice marker (most likely to be final advice)
      for (const marker of adviceMarkers) {
        const index = cleaned.lastIndexOf(marker);
        if (index >= 0 && index > lastAdviceIndex) {
          lastAdviceIndex = index;
          adviceMarkerFound = marker;
        }
      }

      // If we found an advice marker, extract from there to the end
      if (lastAdviceIndex >= 0) {
        cleaned = cleaned.substring(lastAdviceIndex);
        console.log(`[GeminiService] Gemma 4 detected - extracted advice from marker: "${adviceMarkerFound}"`);
      }

      // Remove draft markers and metadata patterns
      cleaned = cleaned
        .replace(/^[\s\S]*?(Draft\s+\d+:|Wait,|Let's|Actually,|One\s+more|Final\s+check|Final\s+selection|One\s+detail)/i, '')
        .replace(/^[\s\S]*?(FACTS:|INSTRUCTION:|TONE:|OUTPUT:|Current\s+state:|Problem:|Action\s+\d+:)/i, '');

      // Remove common draft/reasoning prefixes
      cleaned = cleaned.replace(/^(Draft\s+\d+:|Wait,|Let's|Actually,|One\s+more|Final\s+check|Final\s+selection|Action\s+\d+:|\d+\.\s+)/gm, '');
    } else {
      // LIGHT filtering for Gemini models (cleaner output naturally)
      console.log(`[GeminiService] Gemini model detected (${this.currentTextModelId}) - using light filtering`);
    }

    // Remove asterisks and formatting (all models)
    cleaned = cleaned.replace(/\*\*?/g, '');

    // Normalize whitespace
    cleaned = cleaned.replace(/\n{2,}/g, ' ');  // Replace double newlines with space
    cleaned = cleaned.replace(/\s{2,}/g, ' ');  // Collapse multiple spaces

    // Deduplicate: if the text repeats itself, keep only first occurrence.
    // Decimal points are protected so amounts like 16,875.00 are not split
    // into separate "sentences" ("...16,875." + "00 TWD...").
    const trimmed = protectDecimalPoints(cleaned.trim());
    // Match sentences including their punctuation (Latin and CJK)
    const sentenceMatches = trimmed.match(/[^.!?。！？]*[.!?。！？]+/g) || [];
    const sentences = sentenceMatches.map(s => s.trim()).filter(s => s.length > 0);

    if (sentences.length === 0) {
      const restored = restoreDecimalPoints(trimmed);
      return restored.length > 20 ? restored : text.trim();
    }

    // If we have repeated sentences, keep unique ones
    // Use fuzzy matching: if a sentence is 80%+ similar to a previous one, skip it
    const uniqueSentences: string[] = [];
    const seen = new Map<string, string>();  // Map of normalized -> original

    for (const sent of sentences) {
      // For comparison, remove punctuation and normalize
      const normalized = sent.trim().replace(/[.!?。！？]+$/, '').toLowerCase();

      // Check for exact match or near-duplicate
      let isDuplicate = false;
      for (const prevNormalized of seen.keys()) {
        // Exact match
        if (normalized === prevNormalized) {
          isDuplicate = true;
          break;
        }

        // Fuzzy match: check if sentences share 80%+ of words
        const currentWords = new Set(normalized.split(/\s+/));
        const prevWords = new Set(prevNormalized.split(/\s+/));
        const intersection = [...currentWords].filter(w => prevWords.has(w)).length;
        const similarity = intersection / Math.max(currentWords.size, prevWords.size);

        if (similarity > 0.8) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seen.set(normalized, sent.trim());
        uniqueSentences.push(sent.trim());
      }
    }

    let result = restoreDecimalPoints(uniqueSentences.join(' ').trim());

    // Ensure 2-3 sentences max (typical financial advice length)
    // Sentences already have punctuation, so we can count them directly
    if (uniqueSentences.length > 3) {
      result = restoreDecimalPoints(uniqueSentences.slice(0, 3).join(' ').trim());
    }

    // Log deduplication results
    console.log(`[GeminiService] Deduplication: ${sentences.length} sentences → ${uniqueSentences.length} unique → ${Math.min(uniqueSentences.length, 3)} final`);

    return result.length > 20 ? result : text.trim();
  }

  // Helper: Filter out reasoning context and thinking tokens from model responses
  // Gemma 4 includes thinking/reasoning blocks that should be stripped
  private filterReasoningContext(text: string): string {
    // Remove Gemma 4 thinking/channel tokens
    let cleaned = text
      .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, '')  // Remove think tokens
      .replace(/<\|channel[\s\S]*?channel\|>/g, '')       // Remove channel tokens
      .replace(/<thought>[\s\S]*?<\/thought>/g, '');      // Remove thought tags

    // Check if this looks like AI Insights (has markdown headers like ## Spending Pattern)
    const firstHeaderIndex = cleaned.search(/^##\s+/m);

    if (firstHeaderIndex > 0) {
      // Strip everything before the first markdown header — that's Gemma 4 reasoning/drafting
      console.log(`[GeminiService] Stripping ${firstHeaderIndex} chars of reasoning before first ## header`);
      cleaned = cleaned.substring(firstHeaderIndex);
    }

    if (firstHeaderIndex < 0) {
      // No markdown headers found — apply aggressive filtering for plain text reasoning/drafts
      cleaned = cleaned
        .replace(/^[\s\n]*\d+\.\s+(?:Sentence|Pattern|Input|Constraint|Check|Final|Analysis|Wait|Let's|Actually)[\s\S]*?(?=\n\d+\.|^[A-Z][a-z]|\n\n[A-Z]|$)/gim, '')
        .replace(/^[\s\n]*(?:\*+\s*)?(?:Reasoning|Analysis|Thought process|Thinking|Drafting|Self-Correction|Wait,|Let's|Actually|Final|Done):[\s\S]*?(?=\n\*{2,}|^[A-Z][a-z]|\n\n[A-Z]|$)/gim, '')
        .replace(/\n\*?(?:Draft|Attempt|Step|Option|Version|Sentence)\s+\d+[\s\S]*?(?=\n(?:Draft|Attempt|Step|Option|Version|Sentence|\*|\d+\.)|$)/gi, '')
        .replace(/\n[•\-*—]\s+(?:Sentence|Input|Constraint|Reason|Why|How|Check|Note|Wait|Actually|Let|This|One|Content|Tone|Format|Hints|Examples|Final|Polish|refinement)\s*.*?:?[\s\S]*?(?=\n[•\-*—]|\n\n|$)/gi, '')
        .replace(/\*+(?:Draft|Wait|Actually|One|Check|Final|Self-Correction|This|Let|OK|Final Polish|Self-Check|FinalCorrection|Hold on|Hmm|Hmm wait|Check|But|Actually let me|Let me try|Now let me)\s*[^*]*\*+[\s\S]*?(?=\n\n|$)/gi, '')
        .replace(/(?:Constraint|Requirement|Rule|Note|Important|Tip|Reminder)\s+\d+[\s\S]*?(?=\n(?:Constraint|Requirement|Rule|Note|Important|Tip|Reminder)|\n\n|$)/gi, '')
        .replace(/(?:Let me check|Let's try|Actually|Wait,|Hmm|OK so|OK, so)\s+[\s\S]*?(?=\n\n[A-Z]|$)/gi, '')
        .replace(/\n*(?:\*Sentence count\*|Total:)\s*.*?(?=\n\n|$)/gi, '')
        .replace(/\n*(?:Sentence \d+:)[\s\S]*?(?=\n(?:Sentence|Total:|\*|$))/gi, '')
        .replace(/^\*\s+(?:Expenses|Income|Balance|Savings Rate|Requirements|Length|Content|Tone|Format|Hints|Input|Constraint|Check|Role)[\s\S]*?(?=\n\*|\n\n|$)/gim, '')
        .replace(/^\*\s+(?:Sentence \d+|Check|Wait|Actually|Let's|Finally|Here|Now)[\s\S]*?(?=\n\*|\n\n|$)/gim, '')
        .replace(/\n\n+(?:\*|—|-).*?$(?:\n.*?)*$/gm, '')
        .replace(/\*\s+(?:Expenses|Income|Balance|Savings Rate|Requirements|Length|Content|Tone|Input|Constraint|Sentence \d+|Role):[\s\S]*?(?=\*\s+|$)/gi, '')
        .replace(/^\*\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?:\s*[\s\S]*?(?=\n\*|^[A-Z](?!\s*:)|$)/gim, '');
    }

    let result = cleaned.trim();

    // Strip trailing reasoning/checks after the main content (e.g., "Check:*", "Financial Tip")
    result = result.replace(/\n+(?:Check:\*|Financial Tip\b)[\s\S]*$/i, '');

    // Final cleanup: remove excess whitespace
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result.length > 5 ? result : text.trim();
  }

  // Helper: Check if an error is a rate limit / quota exhaustion error
  private isRateLimitError(message: string): boolean {
    return isRateLimitMessage(message);
  }

  /**
   * Category names of default categories are stored as i18n keys
   * (e.g. categoryNames.groceries) — translate them before they reach a
   * prompt, otherwise the model echoes the raw key into the insights text.
   */
  private translateCategoryName(name?: string): string {
    return name ? this.translationService.t(name) : 'Other';
  }

  /** True when generation stopped because the output token limit was reached. */
  private hitTokenLimit(result: GenerateContentResult): boolean {
    return String(result.response.candidates?.[0]?.finishReason) === 'MAX_TOKENS';
  }

  /**
   * Generate text, retrying once after a short delay on rate-limit errors.
   * The dashboard requests summary and advice close together, which can
   * trip free-tier per-minute limits.
   */
  private async generateTextWithRetry(
    request: Parameters<GenerativeModel['generateContent']>[0]
  ): Promise<GenerateContentResult> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }
    try {
      return await this.textModel.generateContent(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isRateLimitError(message)) {
        throw error;
      }
      console.warn('[GeminiService] Rate limited, retrying once in 2.5s');
      await new Promise(resolve => setTimeout(resolve, 2500));
      return await this.textModel.generateContent(request);
    }
  }

  private mapCategoryNameToId(categoryName: string): string {
    return mapCategoryNameToId(
      categoryName,
      this.categoryService.categories(),
      name => this.translateCategoryName(name)
    );
  }
}
