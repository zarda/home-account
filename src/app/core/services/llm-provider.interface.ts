import { Signal, WritableSignal } from '@angular/core';
import {
  Budget,
  BudgetPeriod,
  Category,
  FieldConfidence,
  Goal,
  MonthlyTotal,
  SearchIntent,
  SearchQueryContext,
  Transaction,
  TransactionLocation,
} from '../../models';

/**
 * What the providers hand back, declared where the contract that uses them
 * lives.
 *
 * These used to be declared in gemini.service.ts and imported from there by
 * this file, by the other two providers, and by a dozen callers — so the
 * interface every provider implements depended on one of its implementers,
 * and OpenAI could not be read without opening Gemini. They describe an
 * extraction result, not a Gemini result; nothing here is provider-specific.
 */
export interface ParsedReceipt {
  merchant: string;
  amount: number;
  currency: string;
  date: Date;
  items?: ReceiptItem[];
  receiptDetails?: string;          // Full receipt content reproduced line by line
  suggestedCategory: string;
  confidence: number;
  receiptCount?: number;            // Distinct receipts visible in the photo (defaults to 1)
  /**
   * How clearly the model read the total and the date. The receipt prompt has
   * always asked for these; nothing used to carry them out of the response,
   * so a blurred total looked exactly like a crisp one.
   */
  fieldConfidence?: FieldConfidence;
  location?: string;                // branch/address as printed, absent when none
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

/**
 * One row offered to the tag suggester.
 *
 * The prompt's own `SuggestTagsRow` is this plus the index it answers by; the
 * index belongs to the request's chunking rather than to the row, and this
 * file may not import from the prompts directory.
 */
export interface TagSuggestionRow {
  description: string;
  merchant?: string;
  details?: string;
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
  amountConfidence?: number;       // How legible the amount was (0-1); absent when unreported
  dateConfidence?: number;         // How legible the date was (0-1); absent when unreported
  // The optional fields a transaction can hold and an import source may or
  // may not answer. Absent means "nobody looked" — no producer defaults any
  // of them, so a slot only carries a value somebody actually read.
  note?: string;
  tags?: string[];
  location?: TransactionLocation;
  period?: BudgetPeriod;
  isRecurring?: boolean;
  recurringId?: string;
}

export interface MultiImageExtractedTransaction extends ExtractedTransaction {
  imageIndex: number;             // Which image this item came from (0-based)
  positionInImage: 'top' | 'middle' | 'bottom';  // Vertical position
  confidence: number;             // OCR/extraction confidence (0-1)
  receiptId?: number;             // AI-assigned receipt group (items from same receipt share same ID)
  receiptDetails?: string;        // Full receipt content reproduced line by line
  // Printed grand total for this receiptId group, reported once on the last
  // item (same convention as receiptDetails). Consolidation takes the first
  // value present in the group.
  receiptTotal?: number;
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

/**
 * What a provider can actually do, as opposed to what it is asked to do.
 *
 * Nothing in the app detected this before: Gemini's vision methods failed at
 * the point of use with 'Gemini Vision model not available', and OpenAI and
 * Claude simply assumed every catalog model was multimodal. Declaring it lets
 * the façade choose a provider that can serve the request, and lets a caller
 * fail with a sentence the user can act on rather than an SDK error.
 */
export interface ProviderCapabilities {
  /** Can accept images as input. */
  vision: boolean;
}

/**
 * Per-request options every extraction method accepts.
 *
 * `signal` exists because the import timeouts were a `Promise.race` with
 * nothing on the losing side: the UI gave up after sixty seconds and the
 * request carried on uploading and downloading in the background. On a metered
 * or roaming connection that is the user's money, spent on a result no longer
 * on its way to anywhere.
 */
export interface AIRequestOptions {
  signal?: AbortSignal;
}

/**
 * The contract every cloud provider service satisfies.
 *
 * `CloudLLMProviderService` used to dispatch to the three services through a
 * `switch (provider)` per method with nothing enforcing that they offered the
 * same surface — they were duck-typed, so "OpenAI never got this method" was a
 * runtime fallthrough rather than a compile error. That is the same gap that
 * let each service keep its own quietly diverging copy of every prompt.
 *
 * Named `CloudLLMProviderAdapter` rather than `LLMProvider`, which already
 * means `'gemini' | 'openai' | 'claude'` in the models barrel.
 */
export interface CloudLLMProviderAdapter {
  readonly capabilities: ProviderCapabilities;

  isAvailable(): boolean;
  readonly isAvailableSignal: Signal<boolean>;
  readonly isProcessing: WritableSignal<boolean>;
  readonly lastError: WritableSignal<string | null>;

  /**
   * Gemini alone takes model ids, because it is the only provider with
   * separate text and vision model handles.
   */
  reinitialize(apiKey?: string, textModelId?: string, visionModelId?: string): Promise<void>;

  // Receipt scanning
  parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt>;
  extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]>;
  extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]>;
  /**
   * Read a statement or other multi-row document into one row per line item.
   *
   * Distinct from the receipt methods, which collapse a photo into a single
   * transaction. A statement screenshot has no single total to extract.
   */
  extractStatementTransactions(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]>;

  // Categorization
  suggestCategory(description: string, categories: Category[]): Promise<string>;
  /** `grounding` is the user's own categorization history; omitted when RAG is off. */
  categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]>;
  /** Tags drawn only from `vocabulary`; `grounding` as for categorization. */
  suggestTags(
    rows: TagSuggestionRow[],
    vocabulary: string[],
    grounding?: string
  ): Promise<string[][]>;
  detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping>;

  // Search
  interpretSearchQuery(query: string, context: SearchQueryContext): Promise<SearchIntent>;

  // Insights
  /**
   * `baseCurrency` is required, not defaulted, on every insights method that
   * takes it: a new call site has to say which currency the amounts are in.
   * It used to default to `'USD'`, silently labelling a non-dollar ledger.
   */
  generateSpendingSummary(
    transactions: Transaction[],
    period: string,
    baseCurrency: string,
    previousPeriodData?: PreviousPeriodData | null,
    budgets?: Budget[],
    goals?: Goal[],
    ragContext?: string
  ): Promise<string>;
  generatePatternNarrative(context: string, locale: string): Promise<string>;
  getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency: string,
    period?: string
  ): Promise<string>;
}
