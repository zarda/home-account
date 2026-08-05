import { Signal, WritableSignal } from '@angular/core';
import {
  Budget,
  Category,
  MonthlyTotal,
  SearchIntent,
  SearchQueryContext,
  Transaction,
} from '../../models';
import {
  CSVColumnMapping,
  CategorizedTransaction,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ParsedReceipt,
  PreviousPeriodData,
  RawTransaction,
} from './gemini.service';

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
  /** Can accept a PDF directly, without the pages being rasterized first. */
  nativePdf: boolean;
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
  /** Present only where `capabilities.nativePdf` is true. */
  extractTransactionsFromPDF?(pdfBase64: string): Promise<RawTransaction[]>;

  // Categorization
  suggestCategory(description: string, categories: Category[]): Promise<string>;
  /** `grounding` is the user's own categorization history; omitted when RAG is off. */
  categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]>;
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
    ragContext?: string
  ): Promise<string>;
  generatePatternNarrative(context: string, locale: string): Promise<string>;
  getFinancialAdvice(
    summary: MonthlyTotal,
    baseCurrency: string,
    period?: string
  ): Promise<string>;
}
