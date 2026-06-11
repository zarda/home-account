import { Injectable, inject, signal, computed } from '@angular/core';
import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult } from '@google/generative-ai';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService, SupportedLocale } from './translation.service';
import { Budget, Category, Transaction, MonthlyTotal } from '../../models';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';
import {
  trimToLastCompleteSentence,
  dropIncompleteTrailingLine,
  protectDecimalPoints,
  restoreDecimalPoints,
} from '../utils/llm-text.utils';
import { environment } from '../../../environments/environment';

export interface ParsedReceipt {
  merchant: string;
  amount: number;
  currency: string;
  date: Date;
  items?: ReceiptItem[];
  receiptDetails?: string;          // Full receipt content reproduced line by line
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
  category?: string;               // Transaction category (e.g., Groceries, Gas, etc.)
  merchant?: string;               // Specific merchant/business name
  details?: string;                // Additional details (card last 4 digits, reference number, etc.)
}

export interface MultiImageExtractedTransaction extends ExtractedTransaction {
  imageIndex: number;             // Which image this item came from (0-based)
  positionInImage: 'top' | 'middle' | 'bottom';  // Vertical position
  confidence: number;             // OCR/extraction confidence (0-1)
  receiptId?: number;             // AI-assigned receipt group (items from same receipt share same ID)
  receiptDetails?: string;        // Full receipt content reproduced line by line
  wasMerged?: boolean;            // True if deduplicated from multiple images
  mergedFromImages?: number[];    // Indices of images where this appeared
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

/** True when an error message indicates a rate limit / quota exhaustion. */
export function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('429') || lower.includes('resource_exhausted') ||
    lower.includes('rate limit') || lower.includes('quota exceeded') ||
    lower.includes('too many requests');
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
  private currentTextModelId = DEFAULT_TEXT_MODEL;
  private currentVisionModelId = DEFAULT_VISION_MODEL;

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

    const finalTextModel = textModelId || DEFAULT_TEXT_MODEL;
    const finalVisionModel = visionModelId || DEFAULT_VISION_MODEL;

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
  reinitialize(apiKey?: string, textModelId?: string, visionModelId?: string): void {
    this.initializeGemini(apiKey, textModelId, visionModelId);
  }

  // Check if Gemini is available
  isAvailable(): boolean {
    return this.genAI !== null && this.textModel !== null;
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string): Promise<ParsedReceipt> {
    // Try textModel first (more capable), fall back to visionModel on rate limit
    const models = [this.textModel, this.visionModel].filter(Boolean);
    if (models.length === 0) {
      throw new Error('Gemini model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    const prompt = `Do NOT include any thinking, reasoning, or analysis in your response. Output ONLY valid JSON.

Analyze this receipt image and extract into this JSON structure (no markdown, no code blocks):
{
  "merchant": "store/restaurant name",
  "amount": total amount as number,
  "currency": "detected currency code (USD, EUR, JPY, CNY, TWD, THB, etc.)",
  "date": "YYYY-MM-DD format",
  "items": [{"name": "item name", "amount": item price as number}],
  "receiptDetails": "full receipt content line by line",
  "suggestedCategory": "one of: Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other"
}

IMPORTANT:
- "amount" is the TOTAL amount paid (bottom of receipt).
- "items" array: each purchased item with its individual price.
- "receiptDetails": Reproduce the FULL receipt content line by line. Include ALL items with prices, quantities, discounts, tax lines, subtotals, service charges, payment method, change, etc. Use newline to separate lines. Keep original language.
- If fields cannot be extracted, use defaults: merchant="Unknown", currency="USD", date=today, items=[], amount=0.
Return ONLY the JSON, nothing else.`;

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
          generationConfig: {
            maxOutputTokens: 2000,
            temperature: 0.05,
            topP: 0.6,
          }
        });

        const responseText = result.response.text();
        const cleanedJson = this.extractJson(responseText);
        const parsed = JSON.parse(cleanedJson);

        const categoryId = this.mapCategoryNameToId(parsed.suggestedCategory);

        return {
          merchant: parsed.merchant || 'Unknown',
          amount: Number(parsed.amount) || 0,
          currency: parsed.currency || 'USD',
          date: parsed.date ? new Date(parsed.date) : new Date(),
          items: parsed.items || [],
          receiptDetails: parsed.receiptDetails,
          suggestedCategory: categoryId,
          confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5
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
        .map(c => `${c.id}: ${this.translateCategoryName(c.name)}`)
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
          return `- ${t.description}: ${toBaseCurrency(t.amount, t.currency).toFixed(2)} ${baseCurrency} (${this.translateCategoryName(cat?.name)})`;
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
Output ONLY the final insights in the exact format above — no reasoning, no drafts, no commentary.
Begin your response directly with "## Spending Pattern".

${this.getLanguageInstruction()}`;

      const result = await this.generateTextWithRetry({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // Gemma 4 drafts verbosely before its final answer and needs more
          // room, or the visible sections arrive truncated
          maxOutputTokens: this.currentTextModelId.includes('gemma') ? 4096 : 2048,
          temperature: 0.3,
          topP: 0.7,
        }
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
      console.log('[GeminiService] ✓ Spending summary generated successfully (length:', rawText.length, '→', responseText.length, ')');
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
OUTPUT: Only the financial advice (2-3 sentences).
${this.getLanguageInstruction()}`;

      const result = await this.generateTextWithRetry({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: this.currentTextModelId.includes('gemma') ? 2048 : 1024,
          temperature: 0.2,
          topP: 0.7,
        }
      });
      const rawText = result.response.text().trim();
      const filteredText = this.currentTextModelId.includes('gemma-4')
        ? this.filterReasoningContextForAdvice(rawText)
        : rawText;
      // Never show advice that was cut off mid-sentence
      const responseText = trimToLastCompleteSentence(filteredText);
      console.log('[GeminiService] ✓ Financial advice generated successfully (length:', rawText.length, '→', responseText.length, ')');
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

  // Extract transactions from an image (receipt, bank statement screenshot)
  async extractTransactionsFromImage(imageBase64: string): Promise<ExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      // Extract receipt summary with full receipt content as notes
      const extractPrompt = `Extract key information from this receipt:

Return ONLY a JSON object (not an array):
{
  "date": "YYYY-MM-DD",
  "merchant": "Store/Restaurant Name",
  "totalAmount": 123.45,
  "currency": "CNY",
  "receiptDetails": "Full receipt content reproduced line by line",
  "suggestedCategory": "category name"
}

Rules:
- date: Receipt date (YYYY-MM-DD), use today if not visible
- merchant: Store or restaurant name
- totalAmount: Total amount paid (positive number only)
- currency: Currency code (TWD for Taiwan, CNY for Chinese, JPY for Japanese, etc.)
- receiptDetails: Reproduce the FULL receipt content line by line, preserving all information visible on the receipt: every item with its price, quantity if shown, discounts, subtotals, tax lines, service charges, payment method, change, etc. Use newline to separate each line. Keep the original language. Example: "コーヒー L ×1 — 480\nサンドイッチ ×2 — 760\n割引 -100\n小計 1,140\n内税(10%) 104\n合計 1,140\nVISA ****1234"
- suggestedCategory: One of: Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other

Capture EVERYTHING on the receipt.`;

      console.log('[GeminiService] Extracting receipt summary');
      const extractResult = await this.visionModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: extractPrompt },
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
          temperature: 0.1,
          topP: 0.85,
        }
      });

      const responseText = extractResult.response.text();
      const cleanedJson = this.extractJsonStrict(responseText);
      const receiptData = JSON.parse(cleanedJson);

      // Map category name to ID
      const categoryId = receiptData.suggestedCategory
        ? this.mapCategoryNameToId(receiptData.suggestedCategory)
        : undefined;

      const extracted: ExtractedTransaction[] = [{
        date: receiptData.date || new Date().toISOString().split('T')[0],
        description: receiptData.merchant || 'Receipt',
        amount: Math.abs(receiptData.totalAmount || 0),
        type: 'expense',
        currency: receiptData.currency || 'CNY',
        merchant: receiptData.merchant,
        category: categoryId,
        details: receiptData.receiptDetails || receiptData.itemsSummary || receiptData.items || receiptData.description || ''
      }];

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
    imageBase64Array: string[]
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
      return this.extractWithPositionMetadata(imageBase64Array[0], 0);
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    const prompt = `You are analyzing ${imageBase64Array.length} photos. They may be:
- Multiple photos of ONE receipt (overlapping pages) → items share the same receiptId
- Photos of DIFFERENT receipts → each receipt gets a different receiptId
- A mix of both

FIRST: Determine which photos belong to the same receipt (same merchant, date, style) vs different receipts.
Then: Extract EVERY line item. Items from the same receipt share the same receiptId (starting from 1).
If photos overlap, deduplicate — extract each unique item ONLY ONCE.

Output ONLY valid JSON array. NO explanation, NO thinking.

FIELDS:
- date: YYYY-MM-DD
- description: Product/item name (not merchant)
- amount: Individual item price
- type: 'expense' or 'income'
- currency: JPY, USD, TWD, etc
- receiptId: Integer grouping items from the same receipt (1, 2, 3...)
- imageIndex: Which photo (0-based)
- positionInImage: 'top', 'middle', 'bottom'
- confidence: 0.0-1.0
- category: Food, Transport, etc (optional)
- merchant: Store name (optional)
- details: Full context for this item — quantity, size, flavor, discount, tax info (optional)
- wasMerged: true if deduplicated across images (optional)
- mergedFromImages: [0,1] if from multiple images (optional)

For the LAST item of each receipt (receiptId group), include a "receiptDetails" field with the full receipt content reproduced line by line: all items, discounts, subtotals, tax, service charges, payment method, change, etc.

Example:
[
  {"date":"2024-01-15","description":"おにぎり","amount":151,"type":"expense","currency":"JPY","receiptId":1,"imageIndex":0,"positionInImage":"middle","confidence":0.95,"merchant":"セブンイレブン","details":"×1"},
  {"date":"2024-01-15","description":"コーヒー L","amount":330,"type":"expense","currency":"JPY","receiptId":1,"imageIndex":1,"positionInImage":"top","confidence":0.90,"merchant":"セブンイレブン","details":"×1 店内","receiptDetails":"おにぎり ×1 — 151\nコーヒー L ×1 — 330\n小計 481\n内税(8%) 36\n内税(10%) 30\n合計 481\n現金 500\nお釣り 19"}
]

Return ONLY valid JSON array:`;

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
            parts: [{ text: prompt }, ...imageParts]
          }],
          generationConfig: {
            maxOutputTokens: 4000,
            temperature: 0.05,
            topP: 0.7,
          }
        });
        const responseText = result.response.text();
        const cleanedJson = this.extractJson(responseText);
        const extracted: MultiImageExtractedTransaction[] = JSON.parse(cleanedJson);

        console.log(`[GeminiService] ✓ Extracted ${extracted.length} unique items from ${imageBase64Array.length} receipt images`);

        // Validate and normalize the extracted data
        return extracted.map(t => ({
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
    imageIndex: number
  ): Promise<MultiImageExtractedTransaction[]> {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const prompt = `Extract EVERY individual product/item from this receipt image.

Return each item as a SEPARATE JSON object in an array.
Do NOT include total, subtotal, tax, or service charge as items.

FIELDS PER ITEM:
- date: YYYY-MM-DD
- description: product name
- amount: individual item price
- type: "expense"
- currency: JPY, USD, TWD, CNY, etc
- positionInImage: "top", "middle", "bottom"
- confidence: 0.0-1.0
- category: Restaurants, Groceries, Coffee & Drinks, Fast Food, Shopping, Other (optional)
- merchant: store name (optional)
- details: quantity, size, flavor, discount if any (optional)

For the LAST item, include a "receiptDetails" field: reproduce the FULL receipt content line by line — all items with prices, discounts, tax, subtotals, service charges, payment method, change, etc. Keep original language.

Example:
[
  {"date":"2024-04-11","description":"おにぎり","amount":151,"type":"expense","currency":"JPY","positionInImage":"middle","confidence":0.95,"merchant":"セブン"},
  {"date":"2024-04-11","description":"コーヒー L","amount":330,"type":"expense","currency":"JPY","positionInImage":"bottom","confidence":0.90,"merchant":"セブン","receiptDetails":"おにぎり ×1 — 151\nコーヒー L ×1 — 330\n小計 481\n内税(8%) 36\n合計 481\n現金 500\nお釣り 19"}
]

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
          maxOutputTokens: 2000,
          temperature: 0.05,
          topP: 0.65,
        }
      });

      const responseText = result.response.text();
      const cleanedJson = this.extractJson(responseText);
      const extracted = JSON.parse(cleanedJson);

      // Add imageIndex and normalize data
      return extracted.map((t: Partial<MultiImageExtractedTransaction>) => ({
        date: t.date || new Date().toISOString().split('T')[0],
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: t.currency || 'USD',
        category: t.category ? this.mapCategoryNameToId(t.category) : undefined,
        merchant: t.merchant,
        details: t.details,
        imageIndex: imageIndex,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        receiptDetails: t.receiptDetails,
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
    const categories = this.categoryService.categories();
    const normalizedName = categoryName.toLowerCase().trim();

    // Category names may be stored as i18n keys (e.g. categoryNames.groceries),
    // while the model sees and returns translated names — match against both
    const namesOf = (c: Category) => [
      c.name.toLowerCase(),
      this.translateCategoryName(c.name).toLowerCase(),
    ];

    // Try exact match first
    const exactMatch = categories.find(
      c => namesOf(c).includes(normalizedName)
    );
    if (exactMatch) return exactMatch.id;

    // Try partial match
    const partialMatch = categories.find(
      c => namesOf(c).some(n => n.includes(normalizedName) || normalizedName.includes(n))
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
