import { Injectable, inject, signal, computed } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService, SupportedLocale } from './translation.service';
import { AuthService } from './auth.service';
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
import { Budget, Category, Transaction, MonthlyTotal } from '../../models';

export type GemmaVariant = 'E2B' | 'E4B';

const MODEL_IDS: Record<GemmaVariant, string> = {
  E2B: 'onnx-community/gemma-4-E2B-it-ONNX',
  E4B: 'onnx-community/gemma-4-E4B-it-ONNX',
};

interface ChatImagePart {
  type: 'image';
  image: string;
}
interface ChatTextPart {
  type: 'text';
  text: string;
}
type ChatPart = ChatImagePart | ChatTextPart;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: ChatPart[];
}

interface LoadedModel {
  variant: GemmaVariant;
  processor: unknown;
  model: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TransformersModule = any;

@Injectable({ providedIn: 'root' })
export class GemmaService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);

  private transformers: TransformersModule | null = null;
  private loaded: LoadedModel | null = null;
  private variant = signal<GemmaVariant>('E2B');
  private wasmPathsSet = false;

  isProcessing = signal<boolean>(false);
  lastError = signal<string | null>(null);
  downloadProgress = signal<number>(0);
  private _isAvailable = signal<boolean>(false);

  isAvailableSignal = computed(() => this._isAvailable());

  constructor() {
    this.detectAvailability();
  }

  private detectAvailability(): void {
    const hasWebGPU = typeof navigator !== 'undefined' &&
      (navigator as unknown as { gpu?: unknown }).gpu != null;
    this._isAvailable.set(hasWebGPU);
  }

  isAvailable(): boolean {
    return this._isAvailable() && this.loaded !== null;
  }

  reinitialize(_apiKey?: string): void {
    this.detectAvailability();
  }

  setVariant(variant: GemmaVariant): void {
    this.variant.set(variant);
  }

  private async loadTransformers(): Promise<TransformersModule> {
    if (this.transformers) return this.transformers;
    const mod = await import(/* webpackIgnore: true */ '@huggingface/transformers');
    if (!this.wasmPathsSet && mod.env?.backends?.onnx?.wasm) {
      mod.env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
      this.wasmPathsSet = true;
    }
    this.transformers = mod;
    return mod;
  }

  async isDownloaded(): Promise<boolean> {
    if (typeof caches === 'undefined' && typeof indexedDB === 'undefined') return false;
    return this.loaded !== null;
  }

  async download(progress: (n: number) => void): Promise<void> {
    const t = await this.loadTransformers();
    const variant = this.variant();
    if (this.loaded && this.loaded.variant !== variant) {
      this.unload();
    }
    if (this.loaded) return;

    const modelId = MODEL_IDS[variant];
    const progressCallback = (data: { progress?: number; status?: string }) => {
      if (typeof data.progress === 'number') {
        this.downloadProgress.set(data.progress);
        progress(data.progress);
      }
    };

    const processor = await t.AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback });
    const model = await t.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: progressCallback,
    });
    this.loaded = { variant, processor, model };
  }

  unload(): void {
    if (this.loaded) {
      const m = this.loaded.model as { dispose?: () => void };
      try { m.dispose?.(); } catch { /* ignore */ }
      this.loaded = null;
    }
  }

  private async ensureLoaded(): Promise<LoadedModel> {
    if (!this._isAvailable()) {
      throw new Error('WebGPU not supported');
    }
    if (!this.loaded || this.loaded.variant !== this.variant()) {
      await this.download(() => { /* noop */ });
    }
    if (!this.loaded) throw new Error('Gemma model not loaded');
    return this.loaded;
  }

  private getThinkingEnabled(): boolean {
    const user = this.authService.currentUser();
    return user?.preferences?.gemmaThinkingEnabled ?? false;
  }

  private async generate(
    messages: ChatMessage[],
    options: { doSample?: boolean; maxNewTokens?: number; onToken?: (chunk: string) => void } = {}
  ): Promise<string> {
    const t = await this.loadTransformers();
    const { processor, model } = await this.ensureLoaded();
    const proc = processor as {
      apply_chat_template: (msgs: ChatMessage[], opts: Record<string, unknown>) => unknown;
    };
    const inputs = proc.apply_chat_template(messages, {
      add_generation_prompt: true,
      enable_thinking: this.getThinkingEnabled(),
      return_dict: true,
      return_tensors: 'pt',
      tokenize: true,
    });

    let streamer: unknown = undefined;
    if (options.onToken && t.TextStreamer) {
      streamer = new t.TextStreamer((processor as { tokenizer: unknown }).tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => options.onToken?.(text),
      });
    }

    const mdl = model as {
      generate: (args: Record<string, unknown>) => Promise<unknown>;
    };
    const output = await mdl.generate({
      ...(inputs as Record<string, unknown>),
      max_new_tokens: options.maxNewTokens ?? 1024,
      do_sample: options.doSample ?? false,
      streamer,
    });

    const decoded = (processor as {
      batch_decode: (out: unknown, opts: Record<string, unknown>) => string[];
    }).batch_decode(output, { skip_special_tokens: true });
    const full = decoded[0] ?? '';
    return this.stripPrompt(full);
  }

  private stripPrompt(text: string): string {
    const lastModel = text.lastIndexOf('model\n');
    if (lastModel >= 0) return text.slice(lastModel + 'model\n'.length).trim();
    return text.trim();
  }

  async parseReceipt(imageBase64: string, onToken?: (chunk: string) => void): Promise<ParsedReceipt> {
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

      const messages: ChatMessage[] = [{
        role: 'user',
        content: [
          { type: 'image', image: imageBase64 },
          { type: 'text', text: prompt },
        ],
      }];

      const responseText = await this.generate(messages, { doSample: false, maxNewTokens: 1120, onToken });
      const cleanedJson = this.extractJson(responseText);
      const parsed = JSON.parse(cleanedJson);
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
      console.error('Receipt parsing error:', error);
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  async suggestCategory(description: string, categories: Category[]): Promise<string> {
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

      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
      const suggestedId = (await this.generate(messages, { doSample: false, maxNewTokens: 280 })).trim();
      const validCategory = categories.find(c => c.id === suggestedId);
      return validCategory?.id ?? 'other_expense';
    } catch (error) {
      console.error('Category suggestion error:', error);
      return 'other_expense';
    } finally {
      this.isProcessing.set(false);
    }
  }

  async categorizeTransactions(transactions: RawTransaction[]): Promise<CategorizedTransaction[]> {
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

      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
      const responseText = await this.generate(messages, { doSample: false, maxNewTokens: 2048 });
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
      console.error('Batch categorization error:', error);
      return transactions.map(t => ({
        ...t,
        suggestedCategoryId: 'other_expense',
        confidence: 0.1,
      }));
    } finally {
      this.isProcessing.set(false);
    }
  }

  async generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency = 'USD',
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    onToken?: (chunk: string) => void
  ): Promise<string> {
    this.isProcessing.set(true);
    try {
      const categories = this.categoryService.categories();
      const toBaseCurrency = (amount: number, currency: string) =>
        this.currencyService.convert(amount, currency, baseCurrency);

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

      const expenseTransactions = transactions.filter(t => t.type === 'expense');
      const largestExpenses = [...expenseTransactions]
        .sort((a, b) => toBaseCurrency(b.amount, b.currency) - toBaseCurrency(a.amount, a.currency))
        .slice(0, 5)
        .map(t => {
          const cat = categories.find(c => c.id === t.categoryId);
          return `- ${t.description}: ${toBaseCurrency(t.amount, t.currency).toFixed(2)} ${baseCurrency} (${cat?.name ?? 'Other'})`;
        })
        .join('\n');

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

      let budgetSection = '';
      if (budgets && budgets.length > 0) {
        const budgetLines = budgets.map(b => {
          const categorySpent = byCategory.get(b.categoryId)?.total ?? 0;
          const budgetAmountInBaseCurrency = this.currencyService.convert(b.amount, b.currency, baseCurrency);
          const percentUsed = budgetAmountInBaseCurrency > 0 ? (categorySpent / budgetAmountInBaseCurrency * 100) : 0;
          const status = percentUsed >= 100 ? 'EXCEEDED' : percentUsed >= 80 ? 'Near limit' : 'OK';
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

      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
      const result = await this.generate(messages, { doSample: true, maxNewTokens: 512, onToken });
      return result.trim();
    } catch (error) {
      console.error('Summary generation error:', error);
      return 'Unable to generate spending summary at this time.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  async getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency = 'USD',
    period = 'this month',
    onToken?: (chunk: string) => void
  ): Promise<string> {
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

      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
      const result = await this.generate(messages, { doSample: true, maxNewTokens: 256, onToken });
      return result.trim();
    } catch (error) {
      console.error('Financial advice error:', error);
      return 'Keep tracking your expenses to better understand your spending patterns.';
    } finally {
      this.isProcessing.set(false);
    }
  }

  async extractTransactionsFromImage(imageBase64: string): Promise<RawTransaction[]> {
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

      const messages: ChatMessage[] = [{
        role: 'user',
        content: [
          { type: 'image', image: imageBase64 },
          { type: 'text', text: prompt },
        ],
      }];

      const responseText = await this.generate(messages, { doSample: false, maxNewTokens: 1120 });
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map(t => ({
        description: t.description || 'Unknown',
        amount: t.type === 'expense' ? -Math.abs(t.amount) : Math.abs(t.amount),
        date: t.date ? new Date(t.date) : new Date(),
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

  async extractTransactionsFromPDF(pdfBase64: string): Promise<RawTransaction[]> {
    this.isProcessing.set(true);
    this.lastError.set(null);
    try {
      const pageImages = await this.rasterizePdf(pdfBase64);
      const all: RawTransaction[] = [];
      for (const pageImage of pageImages) {
        const perPage = await this.extractTransactionsFromImage(pageImage);
        all.push(...perPage);
      }
      return all;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('PDF extraction error:', error);
      return [];
    } finally {
      this.isProcessing.set(false);
    }
  }

  private async rasterizePdf(pdfBase64: string): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import(/* webpackIgnore: true */ 'pdfjs-dist');
    const raw = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const images: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      let pngDataUrl: string;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        pngDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read canvas blob'));
          reader.readAsDataURL(blob);
        });
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pngDataUrl = canvas.toDataURL('image/png');
      }
      images.push(pngDataUrl);
    }
    return images;
  }

  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[]
  ): Promise<MultiImageExtractedTransaction[]> {
    if (imageBase64Array.length === 0) return [];

    this.isProcessing.set(true);
    this.lastError.set(null);
    try {
      const prompt = `You are analyzing ${imageBase64Array.length} sequential photos of a SINGLE receipt or financial document.
The images are ordered from TOP to BOTTOM of the receipt.

Return a JSON array of unique line items, each with:
- date (YYYY-MM-DD), description, amount (positive number), type ("income"|"expense"), currency
- imageIndex (0-based), positionInImage ("top"|"middle"|"bottom"), confidence (0-1)
- wasMerged (bool), mergedFromImages (optional array), taxInfo (optional)

Return ONLY the JSON array, no markdown.`;

      const content: ChatPart[] = imageBase64Array.map<ChatPart>(img => ({ type: 'image', image: img }));
      content.push({ type: 'text', text: prompt });
      const messages: ChatMessage[] = [{ role: 'user', content }];

      const responseText = await this.generate(messages, { doSample: false, maxNewTokens: 2048 });
      const cleanedJson = this.extractJson(responseText);
      const extracted: (MultiImageExtractedTransaction & { taxInfo?: ExtractedTaxInfo })[] = JSON.parse(cleanedJson);

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
        taxInfo: t.taxInfo,
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

  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    this.isProcessing.set(true);
    try {
      const prompt = `Analyze these CSV headers and sample data to determine the best column mapping for financial transaction data.

Headers: ${JSON.stringify(headers)}
Sample rows (first 3): ${JSON.stringify(sampleRows.slice(0, 3))}

Identify which columns contain:
- dateColumn, descriptionColumn, amountColumn, debitColumn, creditColumn, typeColumn, categoryColumn
- dateFormat (e.g., "MM/DD/YYYY")
- hasHeader (bool)

Return ONLY valid JSON with that structure.`;

      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
      const responseText = await this.generate(messages, { doSample: false, maxNewTokens: 512 });
      const cleanedJson = this.extractJson(responseText);
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('CSV mapping detection error:', error);
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

  private getLanguageInstruction(): string {
    const locale = this.translationService.currentLocale();
    const languageMap: Record<SupportedLocale, string> = {
      'en': 'Respond in English.',
      'tc': 'Respond in Traditional Chinese (繁體中文).',
      'ja': 'Respond in Japanese (日本語).',
    };
    return languageMap[locale] || 'Respond in English.';
  }

  private extractJson(text: string): string {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    return cleaned.trim();
  }

  private mapCategoryNameToId(categoryName: string): string {
    const categories = this.categoryService.categories();
    const normalizedName = (categoryName || '').toLowerCase().trim();

    const exactMatch = categories.find(c => c.name.toLowerCase() === normalizedName);
    if (exactMatch) return exactMatch.id;

    const partialMatch = categories.find(
      c => c.name.toLowerCase().includes(normalizedName) ||
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
