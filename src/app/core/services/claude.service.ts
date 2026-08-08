import { Injectable } from '@angular/core';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL } from '../config/ai-models';
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
export class ClaudeService extends CloudLLMProviderBase implements CloudLLMProviderAdapter {
  protected readonly providerLabel = 'Claude';

  private client: Anthropic | null = null;
  private currentApiKey: string | null = null;

  // Selectable Claude model (all catalog entries are vision-capable)
  private model = DEFAULT_CLAUDE_MODEL;

  constructor() {
    super();
    // Claude is not initialized by default - requires user API key
  }

  private async initialize(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      console.warn('Claude API key not provided');
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
      const { default: Anthropic } = await this.loadSdk();
      this.client = new Anthropic({
        apiKey: apiKey,
        // Same bring-your-own-key trust model as the OpenAI provider: the
        // user's own key, stored in their own account. Without this flag the
        // SDK throws at construction in browsers, so Claude could never
        // become available and its settings card stayed 'Not configured'.
        dangerouslyAllowBrowser: true,
      });
      this.currentApiKey = apiKey;
      this.available.set(true);
    } catch (error) {
      console.error('Failed to initialize Claude:', error);
      this.client = null;
      this.currentApiKey = null;
      this.available.set(false);
    }
  }

  // Seam for the on-demand SDK import so the load step can be substituted.
  protected loadSdk(): Promise<typeof import('@anthropic-ai/sdk')> {
    return import('@anthropic-ai/sdk');
  }

  /**
   * Reinitialize Claude with a new API key.
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


  /** Switch the Claude model used for all requests. */
  setModel(modelId: string): void {
    if (modelId && modelId !== this.model) {
      this.model = modelId;
      console.log(`[ClaudeService] Model switched to ${modelId}`);
    }
  }

  // Check if Claude is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Every entry in the Claude catalog is vision-capable. PDFs are not accepted
   * directly — the pages have to be rasterized first.
   */
  get capabilities(): ProviderCapabilities {
    return { vision: true, nativePdf: false };
  }

  // Parse receipt image
  async parseReceipt(imageBase64: string, options?: AIRequestOptions): Promise<ParsedReceipt> {
    if (!this.client) {
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('receiptParse');

      // Extract base64 data without the data URL prefix
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const mediaType = this.getMediaType(imageBase64);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              { type: 'text', text: this.renderedText(rendered) },
            ],
          },
        ],
      }, this.requestOptions(options));

      const responseText = this.extractTextFromResponse(response);
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
      console.error('Claude receipt parsing error:', error);
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
      throw new Error('Claude client not available');
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      const categorizations = JSON.parse(cleanedJson);

      return applyCategorizations(transactions, categorizations, categories);
    } catch (error) {
      console.error('Claude batch categorization error:', error);
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
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);
    this.lastError.set(null);

    try {
      const rendered = renderPrompt('statementTransactions');

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const mediaType = this.getMediaType(imageBase64);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              { type: 'text', text: this.renderedText(rendered) },
            ],
          },
        ],
      }, this.requestOptions(options));

      const responseText = this.extractTextFromResponse(response);
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
      console.error('Claude image extraction error:', error);
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
      throw new Error('Claude client not available');
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

      const content: Anthropic.Messages.ContentBlockParam[] = [];

      // Add all images first
      for (const imageBase64 of imageBase64Array) {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const mediaType = this.getMediaType(imageBase64);
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        });
      }

      // Add the prompt text
      content.push({ type: 'text', text: this.renderedText(rendered) });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content }],
      }, this.requestOptions(options));

      const responseText = this.extractTextFromResponse(response);
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
      console.error('Claude multi-image extraction error:', error);
      // Rethrow for the same reason as the single-image path above.
      throw error;
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Detect CSV column mapping
  async detectCSVMapping(headers: string[], sampleRows: string[][]): Promise<CSVColumnMapping> {
    if (!this.client) {
      throw new Error('Claude client not available');
    }

    this.isProcessing.set(true);

    try {
      const rendered = renderPrompt('csvMapping', { headers, sampleRows });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: rendered.maxOutputTokens,
        ...this.systemParam(rendered),
        messages: [{ role: 'user', content: this.renderedText(rendered) }],
      });

      const responseText = this.extractTextFromResponse(response);
      const cleanedJson = this.extractJson(responseText);
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('Claude CSV mapping detection error:', error);
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
      throw new Error('Claude client not available');
    }
  }

  /** Text transport: one Messages call, and the text block it carries back. */
  protected async sendText(
    promptId: PromptId,
    rendered: RenderedPrompt
  ): Promise<ProviderResponse> {
    this.assertTextTransport();

    const response = await this.client!.messages.create({
      model: this.model,
      max_tokens: rendered.maxOutputTokens,
      ...this.systemParam(rendered),
      messages: [{ role: 'user', content: this.renderedText(rendered) }],
    });

    return {
      text: this.extractTextFromResponse(response),
      truncated: response.stop_reason === 'max_tokens',
    };
  }

  // Helper: Extract text from Claude response
  private extractTextFromResponse(response: Anthropic.Messages.Message): string {
    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }

  // Helper: Get media type from base64 image
  private getMediaType(
    imageBase64: string
  ): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    if (imageBase64.startsWith('data:image/png')) return 'image/png';
    if (imageBase64.startsWith('data:image/gif')) return 'image/gif';
    if (imageBase64.startsWith('data:image/webp')) return 'image/webp';
    return 'image/jpeg';
  }

  /**
   * The user turn of a registry prompt.
   *
   * Claude is the one provider with a real top-level `system` parameter, so a
   * prompt that sets `system` must not have it folded into the user turn here —
   * `systemParam` below carries it instead.
   */
  private renderedText(rendered: RenderedPrompt): string {
    return rendered.user;
  }

  /** Spread into `messages.create` so `system` is only sent when a prompt sets one. */
  private systemParam(rendered: RenderedPrompt): { system?: string } {
    return rendered.system ? { system: rendered.system } : {};
  }

  /**
   * The caller's cancellation, in the shape `messages.create` takes as its
   * second argument. Undefined when there is nothing to cancel with, so a
   * request without a signal is issued exactly as it was before.
   */
  private requestOptions(options?: AIRequestOptions): { signal: AbortSignal } | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }
}
