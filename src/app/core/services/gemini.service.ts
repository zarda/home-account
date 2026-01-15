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

export interface ExtractedTaxInfo {
  taxRate?: number;               // Tax rate as percentage (e.g., 7 for 7%)
  taxAmount?: number;             // Calculated tax amount for this item
  taxCategory?: string;           // Tax category (e.g., 'VAT', 'GST', 'Sales Tax')
  preTaxAmount?: number;          // Original amount before tax
  discountApplied?: number;       // Discount amount that was applied to this item
  originalAmount?: number;        // Amount before discount was applied
}

export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  taxInfo?: ExtractedTaxInfo;     // Tax and discount information
}

export interface MultiImageExtractedTransaction extends ExtractedTransaction {
  imageIndex: number;             // Which image this item came from (0-based)
  positionInImage: 'top' | 'middle' | 'bottom';  // Vertical position
  confidence: number;             // OCR/extraction confidence (0-1)
  wasMerged?: boolean;            // True if deduplicated from multiple images
  mergedFromImages?: number[];    // Indices of images where this appeared
  taxInfo?: ExtractedTaxInfo;     // Tax and discount information (inherited but redeclared for clarity)
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

  /**
   * Extract transactions from multiple images of a single receipt with position-aware deduplication.
   * Images should be ordered top-to-bottom as they appear on the receipt.
   */
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[]
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    if (imageBase64Array.length === 0) {
      return [];
    }

    // For single image, use simpler extraction with position metadata
    if (imageBase64Array.length === 1) {
      return this.extractWithPositionMetadata(imageBase64Array[0], 0);
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

DISCOUNT HANDLING:
- If a discount applies to a SINGLE item (e.g., "-¥100 off", "10% off this item"), apply it to that item
- If a discount applies to MULTIPLE items bought together (bundle/set discount, "まとめ買い割引"), 
  distribute the discount proportionally across those items based on their original prices
- Return the discounted final amount as "amount", and include the original amount and discount in "taxInfo"
- Do NOT create separate line items for discounts

TAX HANDLING (especially for Japanese receipts):
- Japan uses 8% reduced tax (軽減税率) for takeout food and 10% standard tax (標準税率) for dine-in
- Look for markers like "軽", "*", or "外" indicating reduced tax rate (takeout) items
- "外" means takeout (外 from 持ち帰り), these items have 8% tax
- Use taxCategory to indicate: "takeout_8%" or "dine_in_10%" for Japanese receipts
- For other countries, use appropriate tax categories (VAT, GST, Sales Tax, etc.)
- Do NOT include separate tax total lines - attach tax to individual items
- Do NOT include subtotals or grand totals as line items

For each UNIQUE transaction/line item found, extract:
- date: in YYYY-MM-DD format (use the receipt date if individual items don't have dates)
- description: item name or transaction description
- amount: FINAL amount after any discounts applied (as a positive number)
- type: "income" for credits/refunds, "expense" for purchases/debits
- currency: detected currency code (default to USD if unclear)
- imageIndex: which image this item appears in (0-based, use the BEST image if it appears in multiple)
- positionInImage: "top", "middle", or "bottom" based on vertical position in that image
- confidence: your confidence in the extraction accuracy (0.0 to 1.0)
- wasMerged: true if this item appeared in multiple images and was deduplicated
- mergedFromImages: array of image indices where this item appeared (only if wasMerged is true)
- taxInfo: (optional) object with tax/discount details:
  - taxRate: tax percentage applied to this item (e.g., 8 or 10 for Japan)
  - taxAmount: tax amount for this item
  - taxCategory: type of tax (e.g., "takeout_8%", "dine_in_10%", "VAT", "GST")
  - preTaxAmount: amount before tax (税抜価格)
  - discountApplied: discount amount applied to this item (if any)
  - originalAmount: price before discount (if discount was applied)

Return ONLY a valid JSON array with this structure (no markdown, no explanation):
[
  {
    "date": "2024-01-15",
    "description": "おにぎり",
    "amount": 151,
    "type": "expense",
    "currency": "JPY",
    "imageIndex": 0,
    "positionInImage": "middle",
    "confidence": 0.95,
    "wasMerged": false,
    "taxInfo": {
      "taxRate": 8,
      "taxAmount": 11,
      "taxCategory": "takeout_8%",
      "preTaxAmount": 140
    }
  },
  {
    "date": "2024-01-15",
    "description": "コーヒー (店内)",
    "amount": 330,
    "type": "expense",
    "currency": "JPY",
    "imageIndex": 0,
    "positionInImage": "middle",
    "confidence": 0.90,
    "wasMerged": false,
    "taxInfo": {
      "taxRate": 10,
      "taxAmount": 30,
      "taxCategory": "dine_in_10%",
      "preTaxAmount": 300
    }
  },
  {
    "date": "2024-01-15",
    "description": "パン (セット割引)",
    "amount": 180,
    "type": "expense",
    "currency": "JPY",
    "imageIndex": 1,
    "positionInImage": "top",
    "confidence": 0.90,
    "wasMerged": false,
    "taxInfo": {
      "taxRate": 8,
      "taxAmount": 13,
      "taxCategory": "takeout_8%",
      "preTaxAmount": 167,
      "discountApplied": 20,
      "originalAmount": 200
    }
  }
]

If no transactions can be extracted, return an empty array: []`;

      // Build the content array with all images
      const contentParts: (string | { inlineData: { mimeType: string; data: string } })[] = [prompt];

      for (const imageBase64 of imageBase64Array) {
        contentParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
          }
        });
      }

      const result = await this.visionModel.generateContent(contentParts);
      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted: (MultiImageExtractedTransaction & { taxInfo?: ExtractedTaxInfo })[] = JSON.parse(cleanedJson);

      // Validate and normalize the extracted data
      return extracted.map(t => ({
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
        taxInfo: t.taxInfo
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Multi-image extraction error:', error);
      return [];
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Extract transactions from a single image with position metadata.
   * Used internally for single-image multi-image flow.
   */
  private async extractWithPositionMetadata(
    imageBase64: string,
    imageIndex: number
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const prompt = `Analyze this receipt or financial document image and extract ALL line items/transactions.

DISCOUNT HANDLING:
- If a discount applies to a SINGLE item (e.g., "-¥100 off", "10% off this item"), apply it to that item
- If a discount applies to MULTIPLE items bought together (bundle/set discount, "まとめ買い割引"), 
  distribute the discount proportionally across those items based on their original prices
- Return the discounted final amount as "amount", and include the original amount and discount in "taxInfo"
- Do NOT create separate line items for discounts

TAX HANDLING (especially for Japanese receipts):
- Japan uses 8% reduced tax (軽減税率) for takeout food and 10% standard tax (標準税率) for dine-in
- Look for markers like "軽", "*", or "外" indicating reduced tax rate (takeout) items
- "外" means takeout (外 from 持ち帰り), these items have 8% tax
- Use taxCategory to indicate: "takeout_8%" or "dine_in_10%" for Japanese receipts
- For other countries, use appropriate tax categories (VAT, GST, Sales Tax, etc.)
- Do NOT include separate tax total lines - attach tax to individual items
- Do NOT include subtotals or grand totals as line items

For each transaction/line item found, extract:
- date: in YYYY-MM-DD format (use the receipt date if individual items don't have dates)
- description: item name or transaction description
- amount: FINAL amount after any discounts applied (as a positive number)
- type: "income" for credits/refunds, "expense" for purchases/debits
- currency: detected currency code (default to USD if unclear)
- positionInImage: "top", "middle", or "bottom" based on vertical position
- confidence: your confidence in the extraction accuracy (0.0 to 1.0)
- taxInfo: (optional) object with tax/discount details:
  - taxRate: tax percentage applied to this item (e.g., 8 or 10 for Japan)
  - taxAmount: tax amount for this item
  - taxCategory: type of tax (e.g., "takeout_8%", "dine_in_10%", "VAT", "GST")
  - preTaxAmount: amount before tax (税抜価格)
  - discountApplied: discount amount applied to this item (if any)
  - originalAmount: price before discount (if discount was applied)

Return ONLY a valid JSON array with this structure (no markdown, no explanation):
[
  {
    "date": "2024-01-15",
    "description": "おにぎり",
    "amount": 151,
    "type": "expense",
    "currency": "JPY",
    "positionInImage": "top",
    "confidence": 0.95,
    "taxInfo": {
      "taxRate": 8,
      "taxAmount": 11,
      "taxCategory": "takeout_8%",
      "preTaxAmount": 140
    }
  },
  {
    "date": "2024-01-15",
    "description": "コーヒー (店内)",
    "amount": 330,
    "type": "expense",
    "currency": "JPY",
    "positionInImage": "middle",
    "confidence": 0.90,
    "taxInfo": {
      "taxRate": 10,
      "taxAmount": 30,
      "taxCategory": "dine_in_10%",
      "preTaxAmount": 300
    }
  },
  {
    "date": "2024-01-15",
    "description": "パン (セット割引)",
    "amount": 180,
    "type": "expense",
    "currency": "JPY",
    "positionInImage": "bottom",
    "confidence": 0.90,
    "taxInfo": {
      "taxRate": 8,
      "taxAmount": 13,
      "taxCategory": "takeout_8%",
      "preTaxAmount": 167,
      "discountApplied": 20,
      "originalAmount": 200
    }
  }
]

If no transactions can be extracted, return an empty array: []`;

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
      const extracted = JSON.parse(cleanedJson);

      // Add imageIndex and normalize data
      return extracted.map((t: Partial<MultiImageExtractedTransaction> & { taxInfo?: ExtractedTaxInfo }) => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'USD',
        imageIndex: imageIndex,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        wasMerged: false,
        taxInfo: t.taxInfo
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('Single image position extraction error:', error);
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
