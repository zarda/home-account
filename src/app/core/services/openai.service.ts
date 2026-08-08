import { Injectable } from '@angular/core';
import type OpenAI from 'openai';
import { DEFAULT_OPENAI_MODEL } from '../config/ai-models';
import { CloudLLMProviderBase, ProviderResponse } from './cloud-llm-provider.base';
import {
  ParsedReceipt,
  RawTransaction,
  CategorizedTransaction,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  CSVColumnMapping,
} from './gemini.service';
import {
  applyCategorizations,
  buildCategoryPromptCatalog,
} from '../utils/categorization.utils';
import {
  readCurrencyCode,
  readFieldConfidence,
  readReceiptTotal,
} from '../utils/receipt-extraction.utils';
import { PromptId, RenderedPrompt, renderPrompt } from '../prompts';
import {
  AIRequestOptions,
  CloudLLMProviderAdapter,
  ProviderCapabilities,
} from './llm-provider.interface';
import { dayKey } from '../utils/transaction-date.utils';

@Injectable({ providedIn: 'root' })
export class OpenAIService extends CloudLLMProviderBase implements CloudLLMProviderAdapter {
  protected readonly providerLabel = 'OpenAI';

  private client: OpenAI | null = null;
  private currentApiKey: string | null = null;

  // Models
  // OpenAI models are multimodal — one selectable model serves both text
  // and vision tasks via the Responses API
  private model = DEFAULT_OPENAI_MODEL;

  constructor() {
    super();
    // OpenAI is not initialized by default - requires user API key
  }

  private async initialize(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      console.warn('OpenAI API key not provided');
      this.client = null;
      this.currentApiKey = null;
      this.available.set(false);
      return;
    }

    // Skip if already initialized with the same key
    if (apiKey === this.currentApiKey && this.client) {
      return;
    }

    try {
      // The SDK is loaded on demand to keep it out of the initial bundle
      const { default: OpenAI } = await this.loadSdk();
      this.client = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true, // Required for browser usage
      });
      this.currentApiKey = apiKey;
      this.available.set(true);
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
      this.client = null;
      this.currentApiKey = null;
      this.available.set(false);
    }
  }

  // Seam for the on-demand SDK import so the load step can be substituted.
  protected loadSdk(): Promise<typeof import('openai')> {
    return import('openai');
  }

  /**
   * Reinitialize OpenAI with a new API key.
   */
  reinitialize(apiKey?: string): Promise<void> {
    if (apiKey) {
      return this.initialize(apiKey);
    }
    this.client = null;
    this.currentApiKey = null;
    this.available.set(false);
    return Promise.resolve();
  }


  /** Switch the OpenAI model used for all requests. */
  setModel(modelId: string): void {
    if (modelId && modelId !== this.model) {
      this.model = modelId;
      console.log(`[OpenAIService] Model switched to ${modelId}`);
    }
  }

  // Check if OpenAI is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Every model in the OpenAI catalog is multimodal, so one selectable model
   * serves both text and vision. PDFs are not accepted directly — the pages
   * have to be rasterized first.
   */
  get capabilities(): ProviderCapabilities {
    return { vision: true, nativePdf: false };
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptParse');

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: this.renderedText(rendered) },
              { type: 'input_image', image_url: imageUrl, detail: 'auto' },
            ],
          },
        ],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const parsed = JSON.parse(cleanedJson);

      // Map suggested category to category ID
      const categoryId = this.mapCategoryNameToId(parsed.suggestedCategory);

      return {
        merchant: parsed.merchant || 'Unknown',
        amount: Number(parsed.amount) || 0,
        currency: readCurrencyCode(parsed.currency),
        date: parsed.date ? new Date(parsed.date) : new Date(),
        items: parsed.items || [],
        receiptDetails: parsed.receiptDetails,
        suggestedCategory: categoryId,
        confidence: parsed.amount && parsed.merchant ? 0.85 : 0.5,
        receiptCount: Number(parsed.receiptCount) || 1,
        fieldConfidence: readFieldConfidence(parsed),
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

  // Categorize multiple transactions
  async categorizeTransactions(
    transactions: RawTransaction[],
    grounding?: string
  ): Promise<CategorizedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);

    try {
      const categories = this.categoryService.categories();
      const categoryList = buildCategoryPromptCatalog(
        categories,
        (name) => this.translateCategoryName(name)
      );

      const rendered = renderPrompt('categorizeTransactions', {
        categoryCatalog: categoryList,
        grounding,
        rows: transactions.map((t, i) => ({
          index: i,
          description: t.description,
          amount: t.amount,
        })),
      });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return applyCategorizations(transactions, categorizations, categories);
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

  /**
   * Statement extraction. Same call as extractTransactionsFromImage here —
   * this provider has always treated an image as a set of rows — but named for
   * the intent so the import path can ask for it explicitly.
   */
  extractStatementTransactions(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    return this.extractTransactionsFromImage(imageBase64, options);
  }

  // Extract transactions from an image
  async extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('statementTransactions');

      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: this.renderedText(rendered) },
              { type: 'input_image', image_url: imageUrl, detail: 'auto' },
            ],
          },
        ],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: ExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category,
        merchant: t.merchant,
        details: t.details,
        amountConfidence: t.amountConfidence,
        dateConfidence: t.dateConfidence,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI image extraction error:', error);
      // Rethrow, matching GeminiService: an expired key or a billing cap must
      // reach parseAIError and render as a typed error card, not as "no
      // transactions found" — and the strategy layer can only fall back to
      // another provider on a throw, never on a plausible empty result.
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Extract transactions from multiple images
  async extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
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
      const rendered = renderPrompt('multiImageReceipts', {
        imageCount: imageBase64Array.length,
      });

      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: 'input_text', text: this.renderedText(rendered) },
      ];

      for (const imageBase64 of imageBase64Array) {
        const imageUrl = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        content.push({ type: 'input_image', image_url: imageUrl, detail: 'auto' });
      }

      const response = await this.client.responses.create({
        model: this.model,
        input: [{ role: 'user', content }],
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      }, this.requestOptions(options));

      const responseText = response.output_text || '';
      const cleanedJson = this.extractJson(responseText);
      const extracted: MultiImageExtractedTransaction[] = JSON.parse(cleanedJson);

      return extracted.map((t) => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: t.category ? this.mapCategoryNameToId(t.category) : undefined,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError.set(errorMessage);
      console.error('OpenAI multi-image extraction error:', error);
      // Rethrow for the same reason as the single-image path above.
      throw error;
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
      const rendered = renderPrompt('csvMapping', { headers, sampleRows });

      const response = await this.client.responses.create({
        model: this.model,
        input: this.renderedText(rendered),
        max_output_tokens: rendered.maxOutputTokens,
        store: false,
      });

      const responseText = response.output_text || '';
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

  /**
   * One client, so one sentence: there is no second handle to fall back to
   * the way Gemini has.
   */
  protected assertTextTransport(): void {
    if (!this.client) {
      throw new Error('OpenAI client not available');
    }
  }

  /** Text transport: one Responses call, and the text it carries back. */
  protected async sendText(
    promptId: PromptId,
    rendered: RenderedPrompt
  ): Promise<ProviderResponse> {
    this.assertTextTransport();

    const response = await this.client!.responses.create({
      model: this.model,
      input: this.renderedText(rendered),
      max_output_tokens: rendered.maxOutputTokens,
      store: false,
    });

    return {
      text: response.output_text ?? '',
      truncated: response.incomplete_details?.reason === 'max_output_tokens',
    };
  }

  /**
   * Flatten a registry prompt for the Responses API, which has no separate
   * system field — unlike Claude, which takes one at the top level.
   *
   * No JSON preamble is added: that is a Gemini workaround, and adding it here
   * would spend tokens telling OpenAI not to do something it does not do.
   */
  private renderedText(rendered: RenderedPrompt): string {
    return rendered.system ? `${rendered.system}\n\n${rendered.user}` : rendered.user;
  }

  /**
   * The caller's cancellation, in the shape `responses.create` takes as its
   * second argument. Undefined when there is nothing to cancel with, so a
   * request without a signal is issued exactly as it was before.
   */
  private requestOptions(options?: AIRequestOptions): { signal: AbortSignal } | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }
}
