import { Injectable, inject, signal } from '@angular/core';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { CategoryService } from './category.service';
import { Category, Transaction, MonthlyTotal } from '../../models';
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

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private categoryService = inject(CategoryService);

  private genAI: GoogleGenerativeAI | null = null;
  private textModel: GenerativeModel | null = null;
  private visionModel: GenerativeModel | null = null;

  // Signals
  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);

  constructor() {
    this.initializeGemini();
  }

  private initializeGemini(): void {
    const apiKey = environment.geminiApiKey;

    if (!apiKey || apiKey.startsWith('${')) {
      console.warn('Gemini API key not configured');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.textModel = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
      this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
    } catch (error) {
      console.error('Failed to initialize Gemini:', error);
    }
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
    period: string
  ): Promise<string> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();

      // Group transactions by category
      const byCategory = new Map<string, { name: string; total: number; count: number }>();
      for (const t of transactions) {
        if (t.type !== 'expense') continue;

        const category = categories.find(c => c.id === t.categoryId);
        const categoryName = category?.name ?? 'Other';

        const existing = byCategory.get(t.categoryId) ?? { name: categoryName, total: 0, count: 0 };
        existing.total += t.amountInBaseCurrency;
        existing.count += 1;
        byCategory.set(t.categoryId, existing);
      }

      const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

      const totalExpense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

      const categoryBreakdown = Array.from(byCategory.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map(c => `${c.name}: $${c.total.toFixed(2)} (${c.count} transactions)`)
        .join('\n');

      const prompt = `Generate a brief, helpful spending summary for ${period}.

Financial data:
- Total Income: $${totalIncome.toFixed(2)}
- Total Expenses: $${totalExpense.toFixed(2)}
- Net: $${(totalIncome - totalExpense).toFixed(2)}
- Transaction count: ${transactions.length}

Top spending categories:
${categoryBreakdown}

Write a 2-3 sentence summary that:
1. Highlights the main spending pattern
2. Notes if spending is high in any category
3. Provides one actionable insight

Keep it concise and encouraging. Use plain language, no bullet points.`;

      const result = await this.textModel.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      console.error('Summary generation error:', error);
      return 'Unable to generate spending summary at this time.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Get financial advice based on monthly totals
  async getFinancialAdvice(summary: MonthlyTotal): Promise<string> {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }

    this.isProcessing.set(true);

    try {
      const savingsRate = summary.income > 0
        ? ((summary.income - summary.expense) / summary.income * 100)
        : 0;

      const prompt = `Provide brief financial advice based on this monthly summary:

- Income: $${summary.income.toFixed(2)}
- Expenses: $${summary.expense.toFixed(2)}
- Balance: $${summary.balance.toFixed(2)}
- Savings Rate: ${savingsRate.toFixed(1)}%
- Transaction Count: ${summary.transactionCount}

Give 1-2 sentences of personalized, actionable advice. Be encouraging but honest.
Consider:
- If savings rate is <20%, suggest ways to save more
- If balance is negative, acknowledge the situation kindly
- If doing well (>30% savings), congratulate and suggest next steps`;

      const result = await this.textModel.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      console.error('Financial advice error:', error);
      return 'Keep tracking your expenses to better understand your spending patterns.';
    } finally {
      this.isProcessing.set(false);
    }
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
