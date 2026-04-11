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
  category?: string;               // Transaction category (e.g., Groceries, Gas, etc.)
  merchant?: string;               // Specific merchant/business name
  details?: string;                // Additional details (card last 4 digits, reference number, etc.)
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
  private currentTextModelId = 'gemini-3.1-flash-lite';  // Track current model for filtering

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  private _isAvailable = signal<boolean>(false);

  // Computed signal for availability
  isAvailableSignal = computed(() => this._isAvailable());

  constructor() {
    this.initializeGemini();
  }

  private initializeGemini(customApiKey?: string, textModelId?: string, visionModelId?: string): void {
    // Priority: custom key > environment key (if available)
    const apiKey = customApiKey || (environment as { geminiApiKey?: string }).geminiApiKey;

    if (!apiKey || apiKey.startsWith('${')) {
      console.warn('[GeminiService] No valid API key found. Custom:', !!customApiKey, 'Environment:', !!(environment as { geminiApiKey?: string }).geminiApiKey);
      this.genAI = null;
      this.textModel = null;
      this.visionModel = null;
      this.currentApiKey = null;
      this._isAvailable.set(false);
      return;
    }

    // Skip if already initialized with the same key
    if (apiKey === this.currentApiKey && this.genAI) {
      console.log('[GeminiService] Already initialized with this API key, skipping reinitialization');
      return;
    }

    try {
      console.log('[GeminiService] Initializing with new API key (length:', apiKey.length, ')');
      this.genAI = new GoogleGenerativeAI(apiKey);
      const finalTextModel = textModelId || 'gemini-2.5-flash';
      const finalVisionModel = visionModelId || 'gemini-3.1-flash-lite-preview';

      this.textModel = this.genAI.getGenerativeModel({ model: finalTextModel });
      this.visionModel = this.genAI.getGenerativeModel({ model: finalVisionModel });
      this.currentApiKey = apiKey;
      this.currentTextModelId = finalTextModel;  // Track the current model for filtering
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
  reinitialize(apiKey?: string, textModelId?: string, visionModelId?: string): void {
    this.initializeGemini(apiKey, textModelId, visionModelId);
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
      const prompt = `Do NOT include any thinking, reasoning, or analysis in your response. Output ONLY valid JSON.

Analyze this receipt image and extract information into this JSON structure (no markdown, no code blocks):
{
  "merchant": "store/restaurant name",
  "amount": total amount as number,
  "currency": "detected currency code (USD, EUR, THB, etc.)",
  "date": "YYYY-MM-DD format",
  "items": [{"name": "item name", "amount": item price as number}],
  "suggestedCategory": "one of: Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other"
}

If fields cannot be extracted, use defaults: merchant="Unknown", currency="USD", date=today, items=[], amount=0.
Return ONLY the JSON, nothing else.`;

      const result = await this.visionModel.generateContent({
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
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.05,
          topP: 0.6,
        }
      });

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

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 50,
          temperature: 0.05,
          topP: 0.5,
        }
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

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.05,
          topP: 0.6,
        }
      });
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

      const prompt = `Generate structured AI Insights for ${period}.

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
Return AI Insights in this exact format (use markdown):

## Spending Pattern
[1-2 sentences about main spending categories with specific amounts and percentages]

## Changes & Trends
[1-2 sentences about significant changes from previous period with impact assessment]

## Budget Status
[1-2 sentences about budget limits - warnings if any are near limit, or confirmation if all good]

## Actionable Insights
- [Specific, practical insight #1]
- [Specific, practical insight #2]
- [Specific, practical insight #3]

Be detailed, encouraging, and practical. Include specific numbers and examples. Use ${baseCurrency} for amounts.

${this.getLanguageInstruction()}`;

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1200,
          temperature: 0.3,
          topP: 0.7,
        }
      });
      const responseText = result.response.text().trim();
      console.log('[GeminiService] ✓ Spending summary generated successfully (length:', responseText.length, ')');
      return responseText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GeminiService] ✗ Summary generation error:', errorMsg);

      if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
        return 'AI Insights unavailable: Invalid API key. Please check Settings → AI Settings.';
      }

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
      console.error('[GeminiService] ✗ Text model not available for financial advice');
      throw new Error('Gemini text model not available');
    }

    console.log(`[GeminiService] Generating financial advice for period: ${period}`);
    this.isProcessing.set(true);

    try {
      const savingsRate = summary.income > 0
        ? ((summary.income - summary.expense) / summary.income * 100)
        : 0;

      const prompt = `You are a financial advisor giving brief, specific financial advice.

FACTS:
- Income: ${summary.income.toFixed(2)} ${baseCurrency}
- Expenses: ${summary.expense.toFixed(2)} ${baseCurrency}
- Balance: ${summary.balance.toFixed(2)} ${baseCurrency}
- Period: ${period}

INSTRUCTION: Write ONLY 2-3 sentences of financial advice. No introduction, no reasoning, no metadata.

${savingsRate < 20 ? '- Address the low savings rate with concrete, actionable steps.' : '- Acknowledge positive progress and suggest next steps.'}
${summary.balance < 0 ? '- Prioritize: stop deficit spending and find income.' : '- Prioritize: maintain momentum and increase savings.'}

TONE: Practical, specific, supportive. Use exact numbers from above.
OUTPUT: Only the financial advice (2-3 sentences).`;

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.2,
          topP: 0.7,
        }
      });
      const responseText = result.response.text().trim();
      console.log('[GeminiService] ✓ Financial advice generated successfully (length:', responseText.length, ')');
      return responseText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GeminiService] ✗ Financial advice error:', errorMsg);

      if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
        return 'Financial advice unavailable: Invalid API key. Please check Settings → AI Settings.';
      }

      return 'Keep tracking your expenses to better understand your spending patterns.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from an image (receipt, bank statement screenshot)
  async extractTransactionsFromImage(imageBase64: string): Promise<ExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      // Simple direct extraction - just ask for all items as JSON
      const prompt = `Extract all product line items from this receipt image.

Output ONLY a JSON array (one object per product):
[
  {"date":"YYYY-MM-DD","description":"product name","amount":123.45,"type":"expense","currency":"JPY"},
  {"date":"YYYY-MM-DD","description":"product name 2","amount":67.89,"type":"expense","currency":"JPY"}
]

Rules:
- Each product is ONE separate object
- Extract EVERY product item
- Exclude: total, subtotal, tax, service charge
- Use receipt date if visible, else today
- Amount is individual item price (NOT total)`;

      console.log('[GeminiService] Extracting all items from receipt');
      const extractResult = await this.visionModel.generateContent({
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
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.2,
          topP: 0.9,
        }
      });

      const responseText = extractResult.response.text();
      console.log('[GeminiService] Raw API response:', responseText.substring(0, 1500));

      // Extract JSON from response
      const cleanedJson = this.extractJsonStrict(responseText);
      console.log('[GeminiService] Cleaned JSON length:', cleanedJson.length);

      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      console.log(`[GeminiService] ✓ Extracted ${extracted.length} line items from receipt image`);
      extracted.forEach((item, i) => {
        console.log(`  [${i+1}] ${item.description} - ¥${item.amount} ${item.currency}`);
      });

      // Return full ExtractedTransaction objects with all details
      return extracted.map(t => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'JPY',
        category: t.category,
        merchant: t.merchant,
        details: t.details,
        taxInfo: t.taxInfo
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('[GeminiService] ✗ Image extraction error:', error);
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
      const prompt = `Do NOT include any thinking, reasoning, or analysis. Output ONLY valid JSON.

Extract ALL transactions from this PDF bank statement.

For each transaction: date (YYYY-MM-DD), description, amount (positive number), type (income/expense), currency.

Return ONLY valid JSON array (no markdown, no explanation, no thinking):
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

Empty array [] if no transactions found. Only posted/confirmed transactions.`;

      const result = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64.replace(/^data:application\/pdf;base64,/, '')
              }
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.05,
          topP: 0.65,
        }
      });

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
      const prompt = `CRITICAL: You are analyzing ${imageBase64Array.length} photos of ONE RECEIPT (ordered TOP to BOTTOM).
Photos overlap - extract EACH UNIQUE ITEM ONLY ONCE (no duplicates).
Extract EVERY line item visible, NOT just the total.

Output ONLY valid JSON array. NO explanation, NO thinking.

FIELD MAPPING:
- date: YYYY-MM-DD (receipt date)
- description: Product name ONLY (not merchant name)
- amount: Individual item price (not subtotal/total)
- type: 'expense' or 'income'
- currency: JPY, USD, TWD, etc
- imageIndex: Which photo (0 = first, 1 = second, etc)
- positionInImage: 'top', 'middle', 'bottom'
- confidence: 0.0-1.0
- category: Food, Beverage, etc (optional)
- merchant: Store name (optional)
- details: Size, flavor, quantity (optional)
- wasMerged: true if deduplicated across images (optional)
- mergedFromImages: [0,1] if from multiple images (optional)
- taxInfo: Tax details (optional)

REQUIREMENT: If receipt has 8 items across 2 photos, return 8 unique items total (deduplicated).

Return ONLY valid JSON array (no markdown, no thinking, no explanation):
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

      const result = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: contentParts.map(part => typeof part === 'string' ? { text: part } : part)
        }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.05,
          topP: 0.7,
        }
      });
      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted: (MultiImageExtractedTransaction & { taxInfo?: ExtractedTaxInfo })[] = JSON.parse(cleanedJson);

      console.log(`[GeminiService] ✓ Extracted ${extracted.length} unique items from ${imageBase64Array.length} receipt images (deduplicated)`);
      extracted.forEach((item, i) => {
        console.log(`  [${i+1}] ${item.description} - ${item.amount} ${item.currency} (image ${item.imageIndex}, ${item.positionInImage})`);
      });

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
      const prompt = `RECEIPT LINE ITEM EXTRACTION TASK

Extract EVERY individual product/item from this receipt image.

CRITICAL:
- Return each item as a SEPARATE JSON object
- Do NOT include total, subtotal, tax, or service charge
- If receipt has 10 items, return 10 objects (not 1)
- If receipt has 1 item, return 1 object
- Return NOTHING except valid JSON array

REQUIRED FIELDS PER ITEM:
- date: YYYY-MM-DD
- description: product name
- amount: individual item price
- type: "expense"
- currency: JPY, USD, etc
- positionInImage: "top", "middle", "bottom"
- confidence: 0.0-1.0

CORRECT EXAMPLE (3-item receipt):
[
  {"date":"2024-04-11","description":"Himekui-ichi","amount":680,"type":"expense","currency":"JPY","positionInImage":"middle","confidence":0.95},
  {"date":"2024-04-11","description":"Shimbayashi juice","amount":498,"type":"expense","currency":"JPY","positionInImage":"middle","confidence":0.92},
  {"date":"2024-04-11","description":"Kumamo Tomaki baggi","amount":228,"type":"expense","currency":"JPY","positionInImage":"middle","confidence":0.90}
]

WRONG (do not do):
[{"date":"2024-04-11","description":"Total","amount":1406,"type":"expense","currency":"JPY","positionInImage":"bottom","confidence":0.99}]

Output ONLY JSON array. Nothing else.`;

      const result = await this.visionModel.generateContent({
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
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.05,
          topP: 0.65,
        }
      });

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
      const prompt = `Do NOT include any thinking, reasoning, or analysis. Output ONLY valid JSON.

Analyze CSV headers and sample data to map columns for financial transaction data.

Headers: ${JSON.stringify(headers)}
Sample (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}

Identify columns for: dateColumn, descriptionColumn, amountColumn, debitColumn, creditColumn, typeColumn, categoryColumn, dateFormat, hasHeader.

Return ONLY valid JSON (no thinking, no explanation):
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

      const result = await this.textModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.05,
          topP: 0.6,
        }
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
    const locale = this.translationService.currentLocale();
    const languageMap: Record<SupportedLocale, string> = {
      'en': 'Respond in English.',
      'tc': 'Respond in Traditional Chinese (繁體中文).',
      'ja': 'Respond in Japanese (日本語).'
    };
    return languageMap[locale] || 'Respond in English.';
  }

  // Helper: Extract JSON from response that might have markdown formatting or reasoning
  private extractJsonStrict(text: string): string {
    // For receipt extraction, we need to extract a complete JSON array

    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Remove any thinking tags or tokens
    cleaned = cleaned
      .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, '')
      .replace(/<\|channel[\s\S]*?channel\|>/g, '')
      .replace(/<thought>[\s\S]*?<\/thought>/g, '');

    // Find the opening bracket
    const startIdx = cleaned.indexOf('[');
    if (startIdx === -1) {
      console.error('[GeminiService] No JSON array found in response:', cleaned.substring(0, 200));
      throw new Error('No JSON array found in response');
    }

    // Find the matching closing bracket by counting brackets
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === '[') {
        bracketCount++;
      } else if (cleaned[i] === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx === -1) {
      console.error('[GeminiService] Malformed JSON - bracket count:', bracketCount);
      throw new Error('Malformed JSON array - no closing bracket found');
    }

    const result = cleaned.substring(startIdx, endIdx + 1);
    console.log('[GeminiService] Extracted JSON length:', result.length, 'First 200 chars:', result.substring(0, 200));
    return result;
  }

  private extractJson(text: string): string {
    // First, filter out any reasoning context
    let cleaned = this.filterReasoningContext(text);

    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Find JSON array or object
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

    // Deduplicate: if the text repeats itself, keep only first occurrence
    const trimmed = cleaned.trim();
    // Match sentences including their punctuation
    const sentenceMatches = trimmed.match(/[^.!?]*[.!?]+/g) || [];
    const sentences = sentenceMatches.map(s => s.trim()).filter(s => s.length > 0);

    if (sentences.length === 0) {
      return trimmed.length > 20 ? trimmed : text.trim();
    }

    // If we have repeated sentences, keep unique ones
    // Use fuzzy matching: if a sentence is 80%+ similar to a previous one, skip it
    const uniqueSentences: string[] = [];
    const seen = new Map<string, string>();  // Map of normalized -> original

    for (const sent of sentences) {
      // For comparison, remove punctuation and normalize
      const normalized = sent.trim().replace(/[.!?]+$/, '').toLowerCase();

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

    let result = uniqueSentences.join(' ').trim();

    // Ensure 2-3 sentences max (typical financial advice length)
    // Sentences already have punctuation, so we can count them directly
    if (uniqueSentences.length > 3) {
      result = uniqueSentences.slice(0, 3).join(' ').trim();
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
    const hasMarkdownHeaders = /^##\s+/m.test(cleaned);

    if (!hasMarkdownHeaders) {
      // Only apply aggressive filtering for non-markdown content (reasoning/drafts)
      // This prevents removing valid markdown headers
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

    // For markdown content, just clean up excess whitespace
    let result = cleaned.trim();

    // Remove duplicate/repeated content (but preserve markdown structure)
    const allText = result.replace(/\n/g, ' ');
    const midpoint = Math.floor(allText.length / 2);
    const firstHalf = allText.substring(0, midpoint);
    const secondHalf = allText.substring(midpoint);

    // Check if content repeats (similar substrings at start of both halves)
    if (firstHalf.length > 20 && secondHalf.length > 20) {
      const firstStart = firstHalf.substring(0, 50);
      if (secondHalf.includes(firstStart.substring(0, 30))) {
        // Content is duplicated, return only first half
        return firstHalf.trim();
      }
    }

    // Final cleanup: remove excess whitespace
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result.length > 5 ? result : text.trim();
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
