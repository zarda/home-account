import { Injectable, inject, signal, computed } from '@angular/core';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService, SupportedLocale } from './translation.service';
import { Budget, Category, Transaction, MonthlyTotal } from '../../models';
import { environment } from '../../../environments/environment';

export interface ParsedReceipt {
  merchant: string;
  amount: number;
  currency: string;
  date: Date;
  items?: ReceiptItem[];
  suggestedCategory: string;
  confidence: number;
}

export interface ReceiptItem {
  name: string;
  amount: number;
}

export interface RawTransaction {
  description: string;
  amount: number;
  date: Date;
}

export interface CategorizedTransaction extends RawTransaction {
  suggestedCategoryId: string;
  confidence: number;
}

export interface PreviousPeriodData {
  income: number;
  expense: number;
}

export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
}

export interface CSVColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  debitColumn?: string;
  creditColumn?: string;
  typeColumn?: string;
  categoryColumn?: string;
  dateFormat: string;
  hasHeader: boolean;
}

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  private genAI: GoogleGenerativeAI | null = null;
  private textModel: GenerativeModel | null = null;
  private visionModel: GenerativeModel | null = null;
  private currentApiKey: string | null = null;

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  private _isAvailable = signal<boolean>(false);

  // Computed signal for availability
  isAvailableSignal = computed(() => this._isAvailable());

  constructor() {
    this.initializeGemini();
  }

  private initializeGemini(customApiKey?: string): void {
    // Priority: custom key > environment key (if available)
    const apiKey = customApiKey || (environment as { geminiApiKey?: string }).geminiApiKey;

    if (!apiKey || apiKey.startsWith('${')) {
      console.warn('Gemini API key not configured');
      this.genAI = null;
      this.textModel = null;
      this.visionModel = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
      return;
    }

    // Skip if already initialized with the same key
    if (apiKey === this.currentApiKey && this.genAI) {
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.textModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      this.currentApiKey = apiKey;
      this._isAvailable.set(true);
    } catch (error) {
      console.error('Failed to initialize Gemini:', error);
      this.genAI = null;
      this.textModel = null;
      this.visionModel = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
    }
  }

  /**
   * Reinitialize Gemini with a new API key.
   * Used when user provides their own API key in settings.
   */
  reinitialize(apiKey?: string): void {
    this.initializeGemini(apiKey);
  }

  // Check if Gemini is available
  isAvailable(): boolean {
    return this.genAI !== null && this.textModel !== null;
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
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

      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
          }
        }
      ]);

      const responseText = result.response.text();
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
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Receipt parsing error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
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
        .map(c => `${c.id}: ${c.name}`)
        .join('\n');

      const prompt = `Given this transaction description: "${description}"

Available categories:
${categoryList}

Return ONLY the category ID that best matches this transaction. Just the ID, nothing else.`;

      const result = await this.textModel.generateContent(prompt);
      const suggestedId = result.response.text().trim();

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
    transactions: RawTransaction[]
  ): Promise<CategorizedTransaction[]> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();
      const categoryList = categories
        .filter(c => !c.parentId && c.isActive)
        .map(c => `${c.id}: ${c.name}`)
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

      const result = await this.textModel.generateContent(prompt);
      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return transactions.map((t, i) => {
        const match = categorizations.find((c: { index: number }) => c.index === i);
        return {
          ...t,
          suggestedCategoryId: match?.categoryId ?? 'other_expense',
          confidence: match ? 0.8 : 0.3
        };
      });
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

  // Generate spending summary
  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency = 'USD',
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[]
  ): Promise<string> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();

      // Helper to convert amount to base currency (real-time conversion)
      const toBaseCurrency = (amount: number, currency: string) =>
        this.currencyService.convert(amount, currency, baseCurrency);

      // Group transactions by category
      const byCategory = new Map<string, { name: string; total: number; count: number }>();
      for (const t of transactions) {
        if (t.type !== 'expense') continue;

        const category = categories.find(c => c.id === t.categoryId);
        const categoryName = category?.name ?? 'Other';

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

      const categoryBreakdown = Array.from(byCategory.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map(c => `${c.name}: ${c.total.toFixed(2)} ${baseCurrency} (${c.count} transactions)`)
        .join('\n');

      // Build individual transactions list (recent + largest)
      const expenseTransactions = transactions.filter(t => t.type === 'expense');
      const largestExpenses = [...expenseTransactions]
        .sort((a, b) => toBaseCurrency(b.amount, b.currency) - toBaseCurrency(a.amount, a.currency))
        .slice(0, 5)
        .map(t => {
          const cat = categories.find(c => c.id === t.categoryId);
          return `- ${t.description}: ${toBaseCurrency(t.amount, t.currency).toFixed(2)} ${baseCurrency} (${cat?.name ?? 'Other'})`;
        })
        .join('\n');

      // Build historical comparison section
      let historicalSection = '';
      if (previousPeriodData && (previousPeriodData.income > 0 || previousPeriodData.expense > 0)) {
        const expenseChange = previousPeriodData.expense > 0
          ? ((totalExpense - previousPeriodData.expense) / previousPeriodData.expense * 100).toFixed(1)
          : 'N/A';
        const incomeChange = previousPeriodData.income > 0
          ? ((totalIncome - previousPeriodData.income) / previousPeriodData.income * 100).toFixed(1)
          : 'N/A';
        historicalSection = `
Previous period comparison:
- Previous income: ${previousPeriodData.income.toFixed(2)} ${baseCurrency}
- Previous expenses: ${previousPeriodData.expense.toFixed(2)} ${baseCurrency}
- Income change: ${incomeChange}%
- Expense change: ${expenseChange}%
`;
      }

      // Build budget section
      let budgetSection = '';
      if (budgets && budgets.length > 0) {
        const budgetLines = budgets.map(b => {
          const categorySpent = byCategory.get(b.categoryId)?.total ?? 0;
          // Convert budget amount to base currency for comparison
          const budgetAmountInBaseCurrency = this.currencyService.convert(b.amount, b.currency, baseCurrency);
          const percentUsed = budgetAmountInBaseCurrency > 0 ? (categorySpent / budgetAmountInBaseCurrency * 100) : 0;
          const status = percentUsed >= 100 ? '⚠️ EXCEEDED' : percentUsed >= 80 ? '⚠️ Near limit' : '✓';
          return `- ${b.name}: ${categorySpent.toFixed(2)}/${budgetAmountInBaseCurrency.toFixed(2)} ${baseCurrency} (${percentUsed.toFixed(0)}%) ${status}`;
        }).join('\n');
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

      const result = await this.textModel.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      console.error('Summary generation error:', error);
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
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const savingsRate = summary.income > 0
        ? ((summary.income - summary.expense) / summary.income * 100)
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

      const result = await this.textModel.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      console.error('Financial advice error:', error);
      return 'Keep tracking your expenses to better understand your spending patterns.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from an image (receipt, bank statement screenshot)
  async extractTransactionsFromImage(imageBase64: string): Promise<RawTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
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

      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
          }
        }
      ]);

      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      // Convert to RawTransaction format
      return extracted.map(t => ({
        description: t.description || 'Unknown',
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: t.date ? new Date(t.date) : new Date()
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Image extraction error:', error);
      return [];
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
      const prompt = `Analyze this PDF bank statement and extract ALL transactions.

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
    "description": "DIRECT DEPOSIT - EMPLOYER",
    "amount": 3500.00,
    "type": "income",
    "currency": "USD"
  },
  {
    "date": "2024-01-16",
    "description": "WALMART",
    "amount": 125.43,
    "type": "expense",
    "currency": "USD"
  }
]

If no transactions can be extracted, return an empty array: []
Only include posted/confirmed transactions.`;

      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64.replace(/^data:application\/pdf;base64,/, '')
          }
        }
      ]);

      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      // Convert to RawTransaction format
      return extracted.map(t => ({
        description: t.description || 'Unknown',
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: t.date ? new Date(t.date) : new Date()
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('PDF extraction error:', error);
      return [];
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

      const result = await this.textModel.generateContent(prompt);
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
    const locale = this.translationService.currentLocale();
    const languageMap: Record<SupportedLocale, string> = {
      'en': 'Respond in English.',
      'tc': 'Respond in Traditional Chinese (繁體中文).',
      'ja': 'Respond in Japanese (日本語).'
    };
    return languageMap[locale] || 'Respond in English.';
  }

  // Helper: Extract JSON from response that might have markdown formatting
  private extractJson(text: string): string {
    // Remove markdown code blocks if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Find JSON array or object
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

    // Try exact match first
    const exactMatch = categories.find(
      c => c.name.toLowerCase() === normalizedName
    );
    if (exactMatch) return exactMatch.id;

    // Try partial match
    const partialMatch = categories.find(
      c => c.name.toLowerCase().includes(normalizedName) ||
           normalizedName.includes(c.name.toLowerCase())
    );
    if (partialMatch) return partialMatch.id;

    // Default based on common keywords
    const keywordMap: Record<string, string> = {
      restaurant: 'food_restaurants',
      grocery: 'food_groceries',
      coffee: 'food_coffee_&_drinks',
      food: 'food',
      transport: 'transport',
      gas: 'transport_fuel_&_gas',
      shopping: 'shopping',
      pharmacy: 'health_pharmacy_&_medicine',
      health: 'health'
    };

    for (const [keyword, categoryId] of Object.entries(keywordMap)) {
      if (normalizedName.includes(keyword)) {
        return categoryId;
      }
    }

    return 'other_expense';
  }
}
