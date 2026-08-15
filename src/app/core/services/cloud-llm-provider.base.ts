import { computed, inject, signal } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import {
  Budget,
  Category,
  Goal,
  MonthlyTotal,
  SearchIntent,
  SearchQueryContext,
  Transaction,
} from '../../models';
import {
  PromptId,
  RenderedPrompt,
  languageInstruction,
  renderBudgetSection,
  renderCategoryBreakdown,
  renderGoalSection,
  renderLargestExpenses,
  renderPreviousPeriodSection,
  renderPrompt,
} from '../prompts';
import {
  applyCategorizations,
  buildCategoryPromptCatalog,
  mapCategoryNameToId,
  matchCategoryName,
} from '../utils/categorization.utils';
import { goalProgressAmount } from '../utils/goal-progress.utils';
import { trimToLastCompleteSentence } from '../utils/llm-text.utils';
import { parseSearchIntent } from '../utils/nl-search.utils';
import {
  readCurrencyCode,
  readFieldConfidence,
  readReceiptTotal,
} from '../utils/receipt-extraction.utils';
import { dayKey, parseDateInput } from '../utils/transaction-date.utils';
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
} from './llm-provider.interface';

/**
 * Rows per categorizeTransactions request. The binding constraint is the
 * answer, not the question: the prompt declares maxOutputTokens 800
 * (categorization.prompts.ts), and one answer entry —
 * {"index": 24, "categoryId": "entertainment_streaming", "confidence": 0.85}
 * — costs roughly 25-30 tokens with a long catalog id. 25 rows is ~750
 * tokens at the pessimistic end, inside the cap with headroom for fences
 * and whitespace. Past the cap the array truncates, the parse throws, and
 * every row in the request lands on the 0.1 fallback at once — which is
 * exactly what a whole-batch request did to a long CSV import.
 */
export const CATEGORIZE_CHUNK_SIZE = 25;

/** One model answer, as much of it as the shared operations need. */
export interface ProviderResponse {
  /** The answer text; empty when the provider returned none. */
  text: string;
  /**
   * True when generation stopped at the output-token ceiling rather than
   * because the model had finished. Only Gemini acts on it, to tell a
   * trailing list item from half of one, but every transport can answer it.
   */
  truncated: boolean;
}

/**
 * What every cloud provider service shares once the transport is set aside.
 *
 * Gemini, OpenAI and Claude implemented the same twenty-one operations three
 * times over. Only four things actually differed: the sentence a provider
 * throws when it has no client, the shape of the SDK call, how the answer is
 * dug out of the response, and the console prefix. Everything else — the
 * two-hundred-line spending-summary prologue, the category catalog, the
 * normalization of every extracted row — was copied, and copies drift. They
 * already had: see docs/prompts.md for the six ways the prompts diverged
 * before the registry, all of which were invisible until something compared
 * them.
 *
 * The inject() calls run in field initializers, which is valid because every
 * subclass is providedIn: 'root' and therefore constructed inside an
 * injection context. cloud-llm-provider.smoke.spec.ts proves that against the
 * real root injector rather than a TestBed.
 */
export abstract class CloudLLMProviderBase implements CloudLLMProviderAdapter {
  protected categoryService = inject(CategoryService);
  protected currencyService = inject(CurrencyService);
  protected translationService = inject(TranslationService);

  readonly isProcessing = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);

  /**
   * Set by each provider's own initialization. Kept separate from
   * `isAvailable()`, which answers from the live client handle: the signal is
   * what the façade's computed status watches, so it has to change on a write
   * rather than on a read.
   */
  protected readonly available = signal<boolean>(false);
  readonly isAvailableSignal = computed(() => this.available());

  /** Console prefix and the noun in this provider's error sentences. */
  protected abstract readonly providerLabel: string;

  /** What this provider can do right now, as opposed to what it is asked to do. */
  abstract get capabilities(): ProviderCapabilities;

  abstract isAvailable(): boolean;

  /** Model ids are Gemini's alone: it is the only one with two model handles. */
  abstract reinitialize(
    apiKey?: string,
    textModelId?: string,
    visionModelId?: string
  ): Promise<void>;

  /**
   * Throw this provider's own 'not available' error when no text request can
   * be issued. The sentence is the provider's because it is what the user is
   * shown, and it names the thing they have to go and configure.
   */
  protected abstract assertTextTransport(): void;

  /**
   * The same, for a request carrying images. Separate because Gemini can be
   * configured for text and not for vision, and answers differently depending
   * on which prompt is asking.
   */
  protected abstract assertVisionTransport(promptId: PromptId): void;

  /**
   * Send a rendered prompt and hand back what came out.
   *
   * This — and its vision twin — is the seam the whole class exists to isolate:
   * the SDK call shape, the `renderedText` strategy each provider needs
   * (ADR 0005), and digging the answer out of that SDK's response. Nothing
   * above this line knows which provider it is talking to.
   *
   * The prompt id is passed because transport can legitimately depend on the
   * task: Gemini retries the insights prompts and no others, and routes the
   * image prompts to different model handles.
   */
  protected abstract sendText(
    promptId: PromptId,
    rendered: RenderedPrompt
  ): Promise<ProviderResponse>;

  /**
   * Send a rendered prompt with images attached.
   *
   * The images arrive as this app carries them — a data URL or a bare base64
   * string — because every SDK wants them differently: OpenAI takes a data
   * URL, Claude takes the payload and the media type apart, Gemini takes the
   * payload with a MIME type beside it. Stripping and re-adding a prefix in
   * the shared code would just be a fourth format nobody wants.
   */
  protected abstract sendVision(
    promptId: PromptId,
    rendered: RenderedPrompt,
    imagesBase64: string[],
    options?: AIRequestOptions
  ): Promise<ProviderResponse>;

  /**
   * The prose a caller should be shown, given what the model said.
   *
   * Identity apart from the trim. Gemini overrides it, because its models
   * draft before they answer and what has to come off depends on the task.
   */
  protected postProcessProse(promptId: PromptId, response: ProviderResponse): string {
    return response.text.trim();
  }

  // ---------------------------------------------- running an operation

  /**
   * Run one operation: mark the service busy, and on failure record the
   * message, say so once, and rethrow.
   *
   * Rethrowing rather than answering with an empty result is the convention
   * settled in #183: an expired key or a billing cap has to reach parseAIError
   * and render as a typed error card, not as "no transactions found" — and the
   * strategy layer can only fall back to another provider on a throw, never on
   * a plausible empty result. This was three copied catch blocks, which is
   * exactly how the convention drifted in the first place.
   */
  protected async run<T>(operation: string, body: () => Promise<T>): Promise<T> {
    this.isProcessing.set(true);
    this.lastError.set(null);
    try {
      return await body();
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : 'Unknown error');
      console.error(`[${this.providerLabel}] ${operation} failed:`, error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Run an operation that has a usable answer of its own for failure.
   *
   * Three operations answer with a default instead of throwing: a category
   * suggestion, a batch categorization and a CSV mapping all have somewhere
   * sensible to land, and the import flow carries on. Nothing reaches
   * `lastError` on those paths — the user is never shown the failure, so a
   * message left behind would surface later against an unrelated request.
   */
  protected async runOrDefault<T>(
    operation: string,
    body: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    this.isProcessing.set(true);
    try {
      return await body();
    } catch (error) {
      console.error(`[${this.providerLabel}] ${operation} failed:`, error);
      return fallback();
    } finally {
      this.isProcessing.set(false);
    }
  }

  // ---------------------------------------------- receipt scanning

  async parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt> {
    this.assertVisionTransport('receiptParse');

    return this.run('receipt parsing', async () => {
      const rendered = renderPrompt('receiptParse');
      const response = await this.sendVision('receiptParse', rendered, [imageBase64], options);
      const parsed = JSON.parse(this.extractJson(response.text));

      return {
        merchant: parsed.merchant || 'Unknown',
        amount: Number(parsed.amount) || 0,
        currency: readCurrencyCode(parsed.currency),
        date: parseDateInput(parsed.date) ?? new Date(),
        items: parsed.items || [],
        receiptDetails: parsed.receiptDetails,
        suggestedCategory: this.mapCategoryNameToId(parsed.suggestedCategory),
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5,
        receiptCount: Number(parsed.receiptCount) || 1,
        fieldConfidence: readFieldConfidence(parsed),
      };
    });
  }

  /**
   * Read a statement or other multi-row document image into one row per line
   * item.
   *
   * The category a row names is resolved against the catalog here. It used to
   * be passed through raw on OpenAI and Claude, and the import flow reads that
   * field as a category id — so a statement row the model labelled "Groceries"
   * arrived as a category that does not exist.
   */
  async extractStatementTransactions(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    this.assertVisionTransport('statementTransactions');

    return this.run('statement extraction', async () => {
      const rendered = renderPrompt('statementTransactions');
      const response = await this.sendVision(
        'statementTransactions',
        rendered,
        [imageBase64],
        options
      );
      const extracted: ExtractedTransaction[] = JSON.parse(this.extractJson(response.text));

      return extracted.map(t => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: this.matchedCategoryId(t.category),
        merchant: t.merchant,
        details: t.details,
        amountConfidence: t.amountConfidence,
        dateConfidence: t.dateConfidence,
      }));
    });
  }

  /**
   * Read one image into transaction rows.
   *
   * The statement reader by default: a photo of one receipt is a statement
   * with one row, which is how OpenAI and Claude have always answered this.
   * Gemini overrides it with a prompt that folds the whole receipt body into a
   * single row's notes instead.
   */
  extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    return this.extractStatementTransactions(imageBase64, options);
  }

  /**
   * Read several photos of the same receipt at once, grouped by receiptId and
   * deduplicated across the overlapping edges.
   */
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    this.assertVisionTransport('multiImageReceipts');

    if (imageBase64Array.length === 0) {
      return [];
    }

    return this.run('multi-image extraction', async () => {
      const rendered = renderPrompt('multiImageReceipts', {
        imageCount: imageBase64Array.length,
      });
      const response = await this.sendVision(
        'multiImageReceipts',
        rendered,
        imageBase64Array,
        options
      );
      const extracted: MultiImageExtractedTransaction[] = JSON.parse(
        this.extractJson(response.text)
      );

      return extracted.map(t => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: this.matchedCategoryId(t.category),
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
    });
  }

  // ---------------------------------------------- categorization

  async suggestCategory(description: string, categories: Category[]): Promise<string> {
    this.assertTextTransport();

    return this.runOrDefault(
      'category suggestion',
      async () => {
        const categoryCatalog = categories
          .filter(c => !c.parentId && c.isActive)
          .map(c => `${c.id}: ${this.translateCategoryName(c.name)}`)
          .join('\n');

        const rendered = renderPrompt('categorySuggestion', { description, categoryCatalog });
        const suggestedId = this.postProcessProse(
          'categorySuggestion',
          await this.sendText('categorySuggestion', rendered)
        );

        // Validate the suggested ID exists
        const validCategory = categories.find(c => c.id === suggestedId);
        return validCategory?.id ?? 'other_expense';
      },
      () => 'other_expense'
    );
  }

  /** `grounding` is the user's own categorization history; omitted when RAG is off. */
  async categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]> {
    this.assertTextTransport();

    const categories = this.categoryService.categories();
    const categoryCatalog = buildCategoryPromptCatalog(categories, name =>
      this.translateCategoryName(name)
    );

    // One request per chunk, sequentially: applyCategorizations matches
    // answers by position within its chunk, so each request re-bases its
    // indices from zero, and a failed chunk degrades only its own rows.
    const results: CategorizedTransaction[] = [];
    for (let start = 0; start < transactions.length; start += CATEGORIZE_CHUNK_SIZE) {
      const chunk = transactions.slice(start, start + CATEGORIZE_CHUNK_SIZE);
      const answered = await this.runOrDefault(
        'batch categorization',
        async () => {
          const rendered = renderPrompt('categorizeTransactions', {
            categoryCatalog,
            grounding,
            rows: chunk.map((t, i) => ({
              index: i,
              description: t.description,
              amount: t.amount,
            })),
          });

          const response = await this.sendText('categorizeTransactions', rendered);
          const categorizations = JSON.parse(this.extractJson(response.text));

          return applyCategorizations(chunk, categorizations, categories);
        },
        // Every row of the failed chunk lands on the fallback category at a
        // confidence low enough that the review step flags all of them; the
        // other chunks keep their real answers.
        () =>
          chunk.map(t => ({
            ...t,
            suggestedCategoryId: 'other_expense',
            confidence: 0.1,
          }))
      );
      results.push(...answered);
    }

    return results;
  }

  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    this.assertTextTransport();

    return this.runOrDefault(
      'CSV mapping detection',
      async () => {
        const rendered = renderPrompt('csvMapping', { headers, sampleRows });
        const response = await this.sendText('csvMapping', rendered);
        return JSON.parse(this.extractJson(response.text)) as CSVColumnMapping;
      },
      // The conventional column order, which the user can correct in the
      // mapping step either way.
      () => ({
        dateColumn: headers[0] || 'date',
        descriptionColumn: headers[1] || 'description',
        amountColumn: headers[2] || 'amount',
        dateFormat: 'MM/DD/YYYY',
        hasHeader: true,
      })
    );
  }

  // ---------------------------------------------- search

  /**
   * Interpret a natural-language search query.
   *
   * Deliberately the one operation that neither records nor logs a failure:
   * search degrades to keyword matching by catching this, so the user sees
   * results rather than an error, and recording one would leave a message to
   * be reported later against something else.
   */
  async interpretSearchQuery(query: string, context: SearchQueryContext): Promise<SearchIntent> {
    this.assertTextTransport();

    this.isProcessing.set(true);
    try {
      const rendered = renderPrompt('searchQuery', { query, context });
      const response = await this.sendText('searchQuery', rendered);
      return parseSearchIntent(JSON.parse(this.extractJson(response.text)), context);
    } finally {
      this.isProcessing.set(false);
    }
  }

  // ---------------------------------------------- insights

  /**
   * Describe an already-computed spending pattern in prose.
   *
   * Takes a pre-built aggregate context rather than transactions: the insights
   * feature sends numbers and category names only, never a description, note or
   * merchant string. Facts in, prose out.
   */
  async generatePatternNarrative(context: string, locale: string): Promise<string> {
    this.assertTextTransport();

    this.isProcessing.set(true);
    try {
      const rendered = renderPrompt('patternNarrative', {
        context,
        locale,
        languageInstruction: this.getLanguageInstruction(),
      });
      const response = await this.sendText('patternNarrative', rendered);
      return trimToLastCompleteSentence(this.postProcessProse('patternNarrative', response));
    } finally {
      this.isProcessing.set(false);
    }
  }

  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency: string,
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    goals?: Goal[],
    ragContext?: string
  ): Promise<string> {
    this.assertTextTransport();

    return this.run('summary generation', async () => {
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
            const budgetAmountInBaseCurrency = this.currencyService.convert(
              b.amount,
              b.currency,
              baseCurrency
            );
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
            // "Saved" is the full progress — manual contributions plus
            // linked transactions — matching what the card shows.
            const targetInBase = this.currencyService.convert(g.targetAmount, g.currency, baseCurrency);
            const savedInBase = this.currencyService.convert(
              goalProgressAmount(g),
              g.currency,
              baseCurrency
            );
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

      const response = await this.sendText('spendingSummary', rendered);
      return (
        this.postProcessProse('spendingSummary', response) ||
        'Unable to generate spending summary.'
      );
    });
  }

  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency: string,
    period = 'this month'
  ): Promise<string> {
    this.assertTextTransport();

    return this.run('financial advice', async () => {
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

      const response = await this.sendText('financialAdvice', rendered);
      return (
        this.postProcessProse('financialAdvice', response) ||
        'Keep tracking your expenses to better understand your spending patterns.'
      );
    });
  }

  /**
   * The JSON payload inside a model's answer.
   *
   * The greedy bracket match is enough wherever the model was asked for JSON
   * and answered with it, possibly fenced. Gemini overrides this: its models
   * narrate before the JSON, so it counts brackets instead.
   */
  protected extractJson(text: string): string {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    return cleaned.trim();
  }

  /** The locale sentence appended to any prompt whose answer the user reads. */
  protected getLanguageInstruction(): string {
    return languageInstruction(this.translationService.currentLocale());
  }

  /**
   * Category names of default categories are stored as i18n keys
   * (e.g. categoryNames.groceries) — translate them before they reach a
   * prompt, otherwise the model echoes the raw key into the insights text.
   */
  protected translateCategoryName(name?: string): string {
    return name ? this.translationService.t(name) : 'Other';
  }

  /** Resolve whatever the model called a category onto a catalog id. */
  protected mapCategoryNameToId(categoryName: unknown): string {
    return mapCategoryNameToId(
      categoryName,
      this.categoryService.categories(),
      name => this.translateCategoryName(name)
    );
  }

  /**
   * The catalog id when the model's answer resolves — by id, by a shipped
   * locale's display name, or by keyword — and undefined when it does not.
   * The extraction rows use this rather than mapCategoryNameToId because an
   * unrecognized answer must stay distinguishable from a deliberate "Other":
   * a truthy other_expense wears the extraction-named confidence grade
   * downstream and overrides the categorization ladder's real answer on the
   * multi-image path. (ADR 0046)
   */
  protected matchedCategoryId(categoryName: unknown): string | undefined {
    const match = matchCategoryName(
      categoryName,
      this.categoryService.categories(),
      name => this.translateCategoryName(name)
    );
    return match.matched ? match.id : undefined;
  }
}
