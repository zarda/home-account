import { Injectable } from '@angular/core';
import type OpenAI from 'openai';
import { DEFAULT_OPENAI_MODEL } from '../config/ai-models';
import { CloudLLMProviderBase, ProviderResponse } from './cloud-llm-provider.base';
import { PromptId, RenderedPrompt } from '../prompts';
import { AIRequestOptions, ProviderCapabilities } from './llm-provider.interface';

@Injectable({ providedIn: 'root' })
export class OpenAIService extends CloudLLMProviderBase {
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
  override get capabilities(): ProviderCapabilities {
    return { vision: true, nativePdf: false };
  }

  /**
   * Vision transport: the prompt text, then every image, in one Responses
   * call. Text first is this provider's own ordering — Claude puts the images
   * ahead of the prompt.
   */
  protected async sendVision(
    promptId: PromptId,
    rendered: RenderedPrompt,
    imagesBase64: string[],
    options?: AIRequestOptions
  ): Promise<ProviderResponse> {
    this.assertTextTransport();

    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: 'input_text', text: this.renderedText(rendered) },
    ];
    for (const imageBase64 of imagesBase64) {
      content.push({ type: 'input_image', image_url: this.imageUrl(imageBase64), detail: 'auto' });
    }

    const response = await this.client!.responses.create({
      model: this.model,
      input: [{ role: 'user', content }],
      max_output_tokens: rendered.maxOutputTokens,
      store: false,
    }, this.requestOptions(options));

    return {
      text: response.output_text ?? '',
      truncated: response.incomplete_details?.reason === 'max_output_tokens',
    };
  }

  /** The Responses API takes a data URL; anything not declared image/* gets re-declared. */
  private imageUrl(imageBase64: string): string {
    if (!imageBase64.startsWith('data:')) return `data:image/jpeg;base64,${imageBase64}`;
    if (imageBase64.startsWith('data:image/')) return imageBase64;
    // A generic mediatype (a shared photo read through a mislabelled Blob)
    // would be rejected as a non-image; the payload is an image, so say so.
    return `data:image/jpeg;base64,${imageBase64.replace(/^data:[^;,]+;base64,/, '')}`;
  }

  /** One client serves text and images alike, so it is the same check. */
  protected assertVisionTransport(): void {
    this.assertTextTransport();
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
