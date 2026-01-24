import { Injectable, inject, signal, computed } from '@angular/core';
import OpenAI from 'openai';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService, SupportedLocale } from './translation.service';
import { Budget, Category, Transaction, MonthlyTotal } from '../../models';
import {
  ParsedReceipt,
  RawTransaction,
  CategorizedTransaction,
  PreviousPeriodData,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ExtractedTaxInfo,
  CSVColumnMapping,
} from './gemini.service';

@Injectable({ providedIn: 'root' })
export class OpenAIService {
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
  private readonly VISION_MODEL = 'gpt-4o';
  private readonly TEXT_MODEL = 'gpt-4o-mini';

  constructor() {
    // OpenAI is not initialized by default - requires user API key
  }

  private initialize(apiKey: string): void {
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

  /**
   * Reinitialize OpenAI with a new API key.
   */
  reinitialize(apiKey?: string): void {
    if (apiKey) {
      this.initialize(apiKey);
    } else {
      this.client = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
    }
  }

  // Check if OpenAI is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const prompt = `Analyze this receipt image and extract the following information.
Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks):
{
  "merchant": "store/restaurant name",
  "amount": total amount as number,
  "currency": "detected currency code (USD, EUR, THB, etc.)",
  "date": "YYYY-MM-DD format",
  "items": [{"name": "item name", "amount": item price as number}],
  "suggestedCategory": "one of: Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other"
}

If you cannot extract certain fields, use reasonable defaults:
- merchant: "Unknown"
- currency: "USD"
- date: today's date
- items: empty array
- amount: 0 if not readable

Ensure the JSON is valid and parseable.`;

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.chat.completions.create({
        model: this.VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const responseText = response.choices[0]?.message?.content || '';
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
        suggestedCategory: categoryId,
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5,
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
        .map((c) => `${c.id}: ${c.name}`)
        .join('\n');

      const prompt = `Given this transaction description: "${description}"

Available categories:
${categoryList}

Return ONLY the category ID that best matches this transaction. Just the ID, nothing else.`;

      const response = await this.client.chat.completions.create({
        model: this.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
      });

      const suggestedId = response.choices[0]?.message?.content?.trim() || '';

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

  // Categorize multiple transactions
  async categorizeTransactions(transactions: RawTransaction[]): Promise<CategorizedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();
      const categoryList = categories
        .filter((c) => !c.parentId && c.isActive)
        .map((c) => `${c.id}: ${c.name}`)
        .join('\n');

      const transactionList = transactions
        .map((t, i) => `${i}: "${t.description}" (${t.amount})`)
        .join('\n');

      const prompt = `Categorize these transactions into the most appropriate category.

Available categories:
${categoryList}

Transactions:
${transactionList}

Return ONLY a valid JSON array with objects containing "index" and "categoryId":
[{"index": 0, "categoryId": "food"}, {"index": 1, "categoryId": "transport"}]`;

      const response = await this.client.chat.completions.create({
        model: this.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      });

      const responseText = response.choices[0]?.message?.content || '';
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return transactions.map((t, i) => {
        const match = categorizations.find((c: { index: number }) => c.index === i);
        return {
          ...t,
          suggestedCategoryId: match?.categoryId ?? 'other_expense',
          confidence: match ? 0.8 : 0.3,
        };
      });
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

  // Generate spending summary
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency = 'USD',
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[]
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();

      const toBaseCurrency = (amount: number, currency: string) =>
        this.currencyService.convert(amount, currency, baseCurrency);

      const byCategory = new Map<string, { name: string; total: number; count: number }>();
      for (const t of transactions) {
        if (t.type !== 'expense') continue;

        const category = categories.find((c) => c.id === t.categoryId);
        const categoryName = category?.name ?? 'Other';

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

      const categoryBreakdown = Array.from(byCategory.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((c) => `${c.name}: ${c.total.toFixed(2)} ${baseCurrency} (${c.count} transactions)`)
        .join('\n');

      const expenseTransactions = transactions.filter((t) => t.type === 'expense');
      const largestExpenses = [...expenseTransactions]
        .sort(
          (a, b) => toBaseCurrency(b.amount, b.currency) - toBaseCurrency(a.amount, a.currency)
        )
        .slice(0, 5)
        .map((t) => {
          const cat = categories.find((c) => c.id === t.categoryId);
          return `- ${t.description}: ${toBaseCurrency(t.amount, t.currency).toFixed(2)} ${baseCurrency} (${cat?.name ?? 'Other'})`;
        })
        .join('\n');

      let historicalSection = '';
      if (previousPeriodData && (previousPeriodData.income > 0 || previousPeriodData.expense > 0)) {
        const expenseChange =
          previousPeriodData.expense > 0
            ? (
                ((totalExpense - previousPeriodData.expense) / previousPeriodData.expense) *
                100
              ).toFixed(1)
            : 'N/A';
        const incomeChange =
          previousPeriodData.income > 0
            ? (
                ((totalIncome - previousPeriodData.income) / previousPeriodData.income) *
                100
              ).toFixed(1)
            : 'N/A';
        historicalSection = `
Previous period comparison:
- Previous income: ${previousPeriodData.income.toFixed(2)} ${baseCurrency}
- Previous expenses: ${previousPeriodData.expense.toFixed(2)} ${baseCurrency}
- Income change: ${incomeChange}%
- Expense change: ${expenseChange}%
`;
      }

      let budgetSection = '';
      if (budgets && budgets.length > 0) {
        const budgetLines = budgets
          .map((b) => {
            const categorySpent = byCategory.get(b.categoryId)?.total ?? 0;
            const budgetAmountInBaseCurrency = this.currencyService.convert(
              b.amount,
              b.currency,
              baseCurrency
            );
            const percentUsed =
              budgetAmountInBaseCurrency > 0
                ? (categorySpent / budgetAmountInBaseCurrency) * 100
                : 0;
            const status =
              percentUsed >= 100
                ? '⚠️ EXCEEDED'
                : percentUsed >= 80
                  ? '⚠️ Near limit'
                  : '✓';
            return `- ${b.name}: ${categorySpent.toFixed(2)}/${budgetAmountInBaseCurrency.toFixed(2)} ${baseCurrency} (${percentUsed.toFixed(0)}%) ${status}`;
          })
          .join('\n');
        budgetSection = `
Active budgets status:
${budgetLines}
`;
      }

      const prompt = `Generate a brief, helpful spending summary for ${period}.

Financial data (all amounts in ${baseCurrency}):
- Total Income: ${totalIncome.toFixed(2)} ${baseCurrency}
- Total Expenses: ${totalExpense.toFixed(2)} ${baseCurrency}
- Net: ${(totalIncome - totalExpense).toFixed(2)} ${baseCurrency}
- Transaction count: ${transactions.length}

Top spending categories:
${categoryBreakdown}

Largest individual expenses:
${largestExpenses || 'No expenses recorded'}
${historicalSection}${budgetSection}
Write a 2-3 sentence summary that:
1. Highlights the main spending pattern with specific amounts
2. Notes any significant changes from previous period (if data available)
3. Warns about any budgets near or over limit (if applicable)
4. Provides one actionable insight

Keep it concise and encouraging. Use plain language, no bullet points. Use ${baseCurrency} for currency amounts.

${this.getLanguageInstruction()}`;

      const response = await this.client.chat.completions.create({
        model: this.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      return response.choices[0]?.message?.content?.trim() || 'Unable to generate spending summary.';
    } catch (error) {
      console.error('OpenAI summary generation error:', error);
      return 'Unable to generate spending summary at this time.';
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
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const savingsRate =
        summary.income > 0
          ? ((summary.income - summary.expense) / summary.income) * 100
          : 0;

      const prompt = `Provide brief financial advice based on this summary for ${period} (amounts in ${baseCurrency}):

- Income: ${summary.income.toFixed(2)} ${baseCurrency}
- Expenses: ${summary.expense.toFixed(2)} ${baseCurrency}
- Balance: ${summary.balance.toFixed(2)} ${baseCurrency}
- Savings Rate: ${savingsRate.toFixed(1)}%
- Transaction Count: ${summary.transactionCount}

Give 1-2 sentences of personalized, actionable advice. Be encouraging but honest. Use ${baseCurrency} for currency amounts.
Consider:
- If savings rate is <20%, suggest ways to save more
- If balance is negative, acknowledge the situation kindly
- If doing well (>30% savings), congratulate and suggest next steps

${this.getLanguageInstruction()}`;

      const response = await this.client.chat.completions.create({
        model: this.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
      });

      return (
        response.choices[0]?.message?.content?.trim() ||
        'Keep tracking your expenses to better understand your spending patterns.'
      );
    } catch (error) {
      console.error('OpenAI financial advice error:', error);
      return 'Keep tracking your expenses to better understand your spending patterns.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from an image
  async extractTransactionsFromImage(imageBase64: string): Promise<RawTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const prompt = `Analyze this image (bank statement, receipt, or financial document) and extract ALL transactions.

For each transaction found, extract:
- date: in YYYY-MM-DD format
- description: merchant/payee name or transaction description
- amount: as a positive number
- type: "income" for credits/deposits, "expense" for debits/withdrawals
- currency: detected currency code (default to USD if unclear)

Return ONLY a valid JSON array with this structure (no markdown, no explanation):
[
  {
    "date": "2024-01-15",
    "description": "AMAZON.COM",
    "amount": 45.99,
    "type": "expense",
    "currency": "USD"
  }
]

If no transactions can be extracted, return an empty array: []
Only include confirmed transactions, not pending ones.`;

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.chat.completions.create({
        model: this.VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 2000,
      });

      const responseText = response.choices[0]?.message?.content || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        description: t.description || 'Unknown',
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: t.date ? new Date(t.date) : new Date(),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI image extraction error:', error);
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
      throw new Error('OpenAI client not available');
    }

    if (imageBase64Array.length === 0) {
      return [];
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const prompt = `You are analyzing ${imageBase64Array.length} sequential photos of a SINGLE receipt or financial document.
The images are ordered from TOP to BOTTOM of the receipt.

IMPORTANT: These photos likely have OVERLAPPING content at the edges.
- The BOTTOM portion of Image N likely overlaps with the TOP portion of Image N+1
- You MUST identify and DEDUPLICATE overlapping items
- Return each unique item ONLY ONCE, preferring the clearer/more complete instance

For each UNIQUE transaction/line item found, extract:
- date: in YYYY-MM-DD format (use the receipt date if individual items don't have dates)
- description: item name or transaction description
- amount: FINAL amount after any discounts applied (as a positive number)
- type: "income" for credits/refunds, "expense" for purchases/debits
- currency: detected currency code (default to USD if unclear)
- imageIndex: which image this item appears in (0-based)
- positionInImage: "top", "middle", or "bottom" based on vertical position
- confidence: your confidence in the extraction accuracy (0.0 to 1.0)
- wasMerged: true if this item appeared in multiple images and was deduplicated

Return ONLY a valid JSON array (no markdown):
[
  {
    "date": "2024-01-15",
    "description": "Item name",
    "amount": 10.99,
    "type": "expense",
    "currency": "USD",
    "imageIndex": 0,
    "positionInImage": "middle",
    "confidence": 0.95,
    "wasMerged": false
  }
]

If no transactions can be extracted, return an empty array: []`;

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt },
      ];

      for (const imageBase64 of imageBase64Array) {
        const imageUrl = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        content.push({ type: 'image_url', image_url: { url: imageUrl } });
      }

      const response = await this.client.chat.completions.create({
        model: this.VISION_MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: 4000,
      });

      const responseText = response.choices[0]?.message?.content || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: (MultiImageExtractedTransaction & { taxInfo?: ExtractedTaxInfo })[] =
        JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'USD',
        imageIndex: t.imageIndex ?? 0,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        wasMerged: t.wasMerged || false,
        mergedFromImages: t.mergedFromImages,
        taxInfo: t.taxInfo,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI multi-image extraction error:', error);
      return [];
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
      const prompt = `Analyze these CSV headers and sample data to determine the best column mapping for financial transaction data.

Headers: ${JSON.stringify(headers)}
Sample rows (first 3): ${JSON.stringify(sampleRows.slice(0, 3))}

Identify which columns contain:
- dateColumn: column name containing transaction dates
- descriptionColumn: column name containing merchant/payee description
- amountColumn: column name for single amount field (or null if separate debit/credit)
- debitColumn: column name for debit/expense amounts (or null)
- creditColumn: column name for credit/income amounts (or null)
- typeColumn: column name indicating transaction type (or null)
- categoryColumn: column name for category (or null)
- dateFormat: detected date format (e.g., "MM/DD/YYYY", "YYYY-MM-DD")
- hasHeader: true if first row is headers

Return ONLY valid JSON with this structure:
{
  "dateColumn": "Date",
  "descriptionColumn": "Description",
  "amountColumn": "Amount",
  "debitColumn": null,
  "creditColumn": null,
  "typeColumn": null,
  "categoryColumn": null,
  "dateFormat": "MM/DD/YYYY",
  "hasHeader": true
}`;

      const response = await this.client.chat.completions.create({
        model: this.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      const responseText = response.choices[0]?.message?.content || '';
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
    const locale = this.translationService.currentLocale();
    const languageMap: Record<SupportedLocale, string> = {
      en: 'Respond in English.',
      tc: 'Respond in Traditional Chinese (繁體中文).',
      ja: 'Respond in Japanese (日本語).',
    };
    return languageMap[locale] || 'Respond in English.';
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

  // Helper: Map category name to ID
  private mapCategoryNameToId(categoryName: string): string {
    const categories = this.categoryService.categories();
    const normalizedName = categoryName.toLowerCase().trim();

    const exactMatch = categories.find((c) => c.name.toLowerCase() === normalizedName);
    if (exactMatch) return exactMatch.id;

    const partialMatch = categories.find(
      (c) =>
        c.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(c.name.toLowerCase())
    );
    if (partialMatch) return partialMatch.id;

    const keywordMap: Record<string, string> = {
      restaurant: 'food_restaurants',
      grocery: 'food_groceries',
      coffee: 'food_coffee_&_drinks',
      food: 'food',
      transport: 'transport',
      gas: 'transport_fuel_&_gas',
      shopping: 'shopping',
      pharmacy: 'health_pharmacy_&_medicine',
      health: 'health',
    };

    for (const [keyword, categoryId] of Object.entries(keywordMap)) {
      if (normalizedName.includes(keyword)) {
        return categoryId;
      }
    }

    return 'other_expense';
  }
}
