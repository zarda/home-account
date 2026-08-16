import { Injectable } from '@angular/core';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL, acceptsSampling } from '../config/ai-models';
import { CloudLLMProviderBase, ProviderResponse } from './cloud-llm-provider.base';
import { PromptId, RenderedPrompt } from '../prompts';
import { AIRequestOptions, ProviderCapabilities } from './llm-provider.interface';

@Injectable({ providedIn: 'root' })
export class ClaudeService extends CloudLLMProviderBase {
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

  /** Every entry in the Claude catalog is vision-capable. */
  override get capabilities(): ProviderCapabilities {
    return { vision: true };
  }

  /**
   * Vision transport: every image, then the prompt text, in one Messages
   * call. Images first is this provider's own ordering — OpenAI puts the
   * prompt ahead of them.
   */
  protected async sendVision(
    promptId: PromptId,
    rendered: RenderedPrompt,
    imagesBase64: string[],
    options?: AIRequestOptions
  ): Promise<ProviderResponse> {
    this.assertTextTransport();

    const content: Anthropic.Messages.ContentBlockParam[] = imagesBase64.map(imageBase64 => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: this.getMediaType(imageBase64),
        // Any mediatype, not just data:image/ — a shared photo can arrive
        // labelled application/octet-stream, and an unstripped prefix turns
        // the payload into invalid base64. getMediaType declares jpeg for
        // the unknown prefixes, which is what the bytes are.
        data: imageBase64.replace(/^data:[^;,]+;base64,/, ''),
      },
    }));
    content.push({ type: 'text', text: this.renderedText(rendered) });

    const response = await this.client!.messages.create({
      model: this.model,
      max_tokens: rendered.maxOutputTokens,
      ...this.systemParam(rendered),
      ...this.samplingParams(rendered),
      messages: [{ role: 'user', content }],
    }, this.requestOptions(options));

    return {
      text: this.extractTextFromResponse(response),
      truncated: response.stop_reason === 'max_tokens',
    };
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
      ...this.samplingParams(rendered),
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
   * The prompt's declared temperature, on the models that still take one.
   *
   * Anthropic removed sampling for models released after Claude Opus 4.6 — the
   * SDK types `temperature` `@deprecated` and the API rejects any value but 1.0
   * with a 400. Two of the three ids in `CLAUDE_MODELS` are past that line,
   * including the default, so sending the registry's 0.05–0.3 unconditionally
   * would fail every request rather than sharpen it.
   *
   * One helper for both transports rather than a literal in each: the vision
   * and text envelopes are edited independently, and an inline spread in only
   * one of them is exactly how the parameter went missing in the first place.
   * `topP` stays out — prompt-inputs.ts marks it Gemini-only. ADR 0043.
   */
  private samplingParams(rendered: RenderedPrompt): { temperature?: number } {
    return acceptsSampling(this.model) ? { temperature: rendered.temperature } : {};
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
