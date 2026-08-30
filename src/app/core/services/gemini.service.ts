import { Injectable } from '@angular/core';
import type {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerateContentResult,
  SingleRequestOptions,
} from '@google/generative-ai';
import { CloudLLMProviderBase, ProviderResponse } from './cloud-llm-provider.base';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';
import {
  readCurrencyCode,
  readPrintedLocation,
  readReceiptTotal,
} from '../utils/receipt-extraction.utils';
import {
  trimToLastCompleteSentence,
  dropIncompleteTrailingLine,
  dropNonCjkSentences,
  protectDecimalPoints,
  restoreDecimalPoints,
} from '../utils/llm-text.utils';
import {
  JSON_ONLY_PREAMBLE,
  PROMPTS,
  PromptId,
  RenderedPrompt,
  renderPrompt,
} from '../prompts';
import {
  AIRequestOptions,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ProviderCapabilities,
  isRateLimitMessage,
} from './llm-provider.interface';
import { environment } from '../../../environments/environment';
import { dayKey } from '../utils/transaction-date.utils';

/**
 * The extraction result types now live with the provider contract. They are
 * re-exported here because a dozen callers import them from this path, and
 * churning those imports would bury the move in unrelated diff.
 */
export type {
  CSVColumnMapping,
  CategorizedTransaction,
  ExtractedTransaction,
  MultiImageExtractedTransaction,
  ParsedReceipt,
  PreviousPeriodData,
  RawTransaction,
  ReceiptItem,
} from './llm-provider.interface';

@Injectable({ providedIn: 'root' })
export class GeminiService extends CloudLLMProviderBase {
  protected readonly providerLabel = 'Gemini';

  private genAI: GoogleGenerativeAI | null = null;
  private textModel: GenerativeModel | null = null;
  private visionModel: GenerativeModel | null = null;
  private currentApiKey: string | null = null;
  private currentTextModelId = DEFAULT_TEXT_MODEL;
  private currentVisionModelId = DEFAULT_VISION_MODEL;

  constructor() {
    super();
    void this.initializeGemini();
  }

  private async initializeGemini(customApiKey?: string, textModelId?: string, visionModelId?: string): Promise<void> {
    // Priority: custom key > environment key (if available)
    const apiKey = customApiKey || (environment as { geminiApiKey?: string }).geminiApiKey;

    if (!apiKey || apiKey.startsWith('${')) {
      console.warn('[GeminiService] No valid API key found. Custom:', !!customApiKey, 'Environment:', !!(environment as { geminiApiKey?: string }).geminiApiKey);
      this.clear();
      return;
    }

    // Fall back to the CURRENT models, not the catalog defaults — a
    // reinitialization without explicit model ids (e.g. when the API key is
    // saved) must not silently revert the user's model selection
    const finalTextModel = textModelId || this.currentTextModelId;
    const finalVisionModel = visionModelId || this.currentVisionModelId;

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
      // The SDK is loaded on demand to keep it out of the initial bundle
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(apiKey);

      this.textModel = this.genAI.getGenerativeModel({ model: finalTextModel });
      this.visionModel = this.genAI.getGenerativeModel({ model: finalVisionModel });
      this.currentApiKey = apiKey;
      this.currentTextModelId = finalTextModel;
      this.currentVisionModelId = finalVisionModel;
      this.available.set(true);

      console.log(`[GeminiService] ✓ Initialized successfully with text model: ${finalTextModel}, vision model: ${finalVisionModel}`);
    } catch (error) {
      console.error('[GeminiService] ✗ Failed to initialize:', error);
      this.genAI = null;
      this.textModel = null;
      this.visionModel = null;
      this.currentApiKey = null;
      this.available.set(false);
    }
  }

  /**
   * Reinitialize Gemini with a new API key and/or models.
   * Used when user provides their own API key or changes model selection in settings.
   */
  reinitialize(apiKey?: string, textModelId?: string, visionModelId?: string): Promise<void> {
    return this.initializeGemini(apiKey, textModelId, visionModelId);
  }

  /**
   * Tear the client down and report unavailable.
   *
   * Distinct from `reinitialize()` with no key, which falls back to the build's
   * environment key — right at start-up, wrong at sign-out. On a build that
   * ships one, clearing via reinitialize would re-arm Gemini under the
   * departing account's key and leave it available to the next account.
   */
  clear(): void {
    this.genAI = null;
    this.textModel = null;
    this.visionModel = null;
    this.currentApiKey = null;
    this.available.set(false);
  }

  // Check if Gemini is available
  isAvailable(): boolean {
    return this.genAI !== null && this.textModel !== null;
  }

  /**
   * Gemini is the only provider with separate text and vision handles, so it is
   * the only one that can be available for text while unable to see an image —
   * every vision method here used to fail at the point of use with 'Gemini
   * Vision model not available' rather than being routed around.
   */
  override get capabilities(): ProviderCapabilities {
    return { vision: this.visionModel !== null };
  }

  /**
   * Vision transport: one call carrying the prompt and the images, on
   * whichever handle serves this prompt.
   *
   * Gemini is the only provider with two model handles, so it is the only one
   * where "which model reads the image" is a question with an answer. The
   * receipt paths have always tried the text model first — the more capable of
   * the two — with the vision model as the rate-limit fallback. The statement
   * path has only ever used the vision model, which is the one the user chose
   * for reading images; routing it anywhere else would quietly change which
   * model reads their bank statement.
   */
  protected sendVision(
    promptId: PromptId,
    rendered: RenderedPrompt,
    imagesBase64: string[],
    options?: AIRequestOptions
  ): Promise<ProviderResponse> {
    return this.generateWithMedia(
      this.visionModelsFor(promptId),
      rendered,
      imagesBase64.map(image => ({
        mimeType: 'image/jpeg',
        // Any mediatype, not just data:image/ — a shared photo can arrive
        // labelled application/octet-stream, and an unstripped prefix turns
        // the payload into invalid base64.
        data: image.replace(/^data:[^;,]+;base64,/, ''),
      })),
      options
    );
  }

  protected assertVisionTransport(promptId: PromptId): void {
    if (promptId === 'statementTransactions') {
      this.assertVisionModel();
      return;
    }
    if (!this.textModel && !this.visionModel) {
      throw new Error('Gemini model not available');
    }
  }

  private visionModelsFor(promptId: PromptId): (GenerativeModel | null)[] {
    return promptId === 'statementTransactions'
      ? [this.visionModel]
      : [this.textModel, this.visionModel];
  }

  private assertVisionModel(): void {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model not available');
    }
  }

  /**
   * One generateContent call carrying inline media, tried against each handle
   * in turn and moving on only when the last one was rate-limited. Any other
   * failure is the answer: retrying a malformed request on a second model
   * spends a second quota to get the same error.
   */
  private async generateWithMedia(
    models: (GenerativeModel | null)[],
    rendered: RenderedPrompt,
    media: { mimeType: string; data: string }[],
    options?: AIRequestOptions
  ): Promise<ProviderResponse> {
    const handles = models.filter((model): model is GenerativeModel => model !== null);
    let lastError: unknown;

    for (const model of handles) {
      try {
        const result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { text: this.renderedText(rendered) },
              ...media.map(inlineData => ({ inlineData })),
            ],
          }],
          generationConfig: this.generationConfig(rendered),
        }, this.requestOptions(options));

        return { text: result.response.text(), truncated: this.hitTokenLimit(result) };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (this.isRateLimitError(message) && model !== handles[handles.length - 1]) {
          console.warn('[GeminiService] Model rate-limited, trying the fallback model');
          continue;
        }
        break;
      }
    }

    throw lastError;
  }

  /**
   * One photo read as a single summary row, carrying the whole receipt body
   * as notes.
   *
   * The one operation where Gemini answers a different prompt from the other
   * two, which is why the receiptSummary call site is here rather than in the
   * base: OpenAI and Claude go straight to statement extraction and get a row
   * per line item.
   */
  override async extractTransactionsFromImage(
    imageBase64: string,
    options?: AIRequestOptions
  ): Promise<ExtractedTransaction[]> {
    this.assertVisionModel();

    return this.run('image extraction', async () => {
      const rendered = renderPrompt('receiptSummary');
      const response = await this.generateWithMedia(
        [this.visionModel],
        rendered,
        [{ mimeType: 'image/jpeg', data: imageBase64.replace(/^data:[^;,]+;base64,/, '') }],
        options
      );

      // The strict reader, not the shared one: this response is a single
      // object rather than a list, so text with no JSON in it at all has to
      // fail here instead of reaching JSON.parse as a bare sentence.
      const receiptData = JSON.parse(this.extractJsonStrict(response.text));

      return [{
        date: receiptData.date || dayKey(new Date()),
        description: receiptData.merchant || 'Receipt',
        amount: Math.abs(receiptData.totalAmount || 0),
        type: 'expense' as const,
        currency: readCurrencyCode(receiptData.currency),
        merchant: receiptData.merchant,
        category: this.matchedCategoryId(receiptData.suggestedCategory),
        details: receiptData.receiptDetails || receiptData.itemsSummary ||
          receiptData.items || receiptData.description || '',
        ...this.countrySlots(receiptData.country, readPrintedLocation(receiptData.location, receiptData.merchant)),
        // A missing date is patched with today's day-key above; nothing was
        // claimed about that date, so nothing here claims a confidence for it.
        ...(receiptData.date ? {} : { dateConfidence: 0 }),
      }];
    });
  }

  /**
   * One photo goes through the itemizing prompt, which reports where on the
   * receipt each line was found so overlapping photos can be reconciled.
   * Several go to the shared multi-image path.
   */
  override async extractTransactionsFromMultipleImages(
    imageBase64Array: string[],
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    this.assertVisionTransport('multiImageReceipts');

    if (imageBase64Array.length === 1) {
      return this.extractWithPositionMetadata(imageBase64Array[0], 0, options);
    }
    return super.extractTransactionsFromMultipleImages(imageBase64Array, options);
  }

  /** One image, itemized, with each row's position on the receipt. */
  private async extractWithPositionMetadata(
    imageBase64: string,
    imageIndex: number,
    options?: AIRequestOptions
  ): Promise<MultiImageExtractedTransaction[]> {
    this.assertVisionModel();

    return this.run('image itemization', async () => {
      const rendered = renderPrompt('receiptItems');
      const response = await this.generateWithMedia(
        [this.visionModel],
        rendered,
        [{ mimeType: 'image/jpeg', data: imageBase64.replace(/^data:[^;,]+;base64,/, '') }],
        options
      );
      // One photo, but it can hold several receipts side by side, so this
      // answer runs long enough to be cut short like the multi-photo one.
      const extracted = this.parseRowsAnswer(response.text) as (Partial<MultiImageExtractedTransaction> & {
        country?: unknown;
      })[];

      return extracted.map(t => ({
        date: t.date || dayKey(new Date()),
        description: t.description || 'Unknown',
        amount: Math.abs(t.amount || 0),
        type: t.type || 'expense',
        currency: readCurrencyCode(t.currency),
        category: this.matchedCategoryId(t.category),
        merchant: t.merchant,
        details: t.details,
        imageIndex: imageIndex,
        positionInImage: t.positionInImage || 'middle',
        confidence: t.confidence ?? 0.7,
        receiptId: t.receiptId ?? 1,
        receiptDetails: t.receiptDetails,
        receiptTotal: readReceiptTotal(t.receiptTotal),
        wasMerged: false,
        ...this.countrySlots(t.country, readPrintedLocation(t.location, t.merchant)),
        // A missing date is patched with today's day-key above, and that
        // string parses just fine — so a claimed dateConfidence must not
        // outlive the date it was claimed about. A date that was read keeps
        // whatever grade the model reported; when it reported none, none is
        // invented here either.
        ...(t.date
          ? (t.dateConfidence !== undefined ? { dateConfidence: t.dateConfidence } : {})
          : { dateConfidence: 0 }),
      }));
    });
  }


  protected assertTextTransport(): void {
    if (!this.textModel) {
      throw new Error('Gemini text model not available');
    }
  }

  /**
   * Text transport: one call on the text handle.
   *
   * The insights prompts get the retrying variant and no others. The dashboard
   * asks for the summary and the advice within a second of each other, which
   * is enough to trip a free-tier per-minute limit, and those two have no
   * answer of their own to fall back on — categorization and search do, so for
   * them a retry would only delay the default they were always going to use.
   */
  protected async sendText(
    promptId: PromptId,
    rendered: RenderedPrompt
  ): Promise<ProviderResponse> {
    this.assertTextTransport();

    const request = {
      contents: [{ role: 'user', parts: [{ text: this.renderedText(rendered) }] }],
      generationConfig: this.generationConfig(rendered),
    };
    const result = PROMPTS[promptId].feature === 'insights'
      ? await this.generateTextWithRetry(request)
      : await this.textModel!.generateContent(request);

    return { text: result.response.text(), truncated: this.hitTokenLimit(result) };
  }

  /**
   * What has to come off a Gemini answer before the user sees it, per task.
   *
   * Every case here is a property of the model rather than of the prompt, which
   * is why it lives beside the transport and not in the registry (ADR 0005):
   * Gemma drafts several attempts before its final one, and in CJK locales the
   * English sentences left in an answer are draft commentary rather than
   * anything the user asked for.
   */
  protected override postProcessProse(
    promptId: PromptId,
    response: ProviderResponse
  ): string {
    const text = response.text.trim();
    switch (promptId) {
      case 'categorySuggestion':
        return this.filterReasoningContext(text);
      case 'patternNarrative':
        return this.dropDraftLanguage(text);
      case 'spendingSummary': {
        const filtered = this.currentTextModelId.includes('gemma-4')
          ? this.filterReasoningContext(text)
          : text;
        // Never end on a line that was cut off mid-sentence; when the token
        // limit was hit, even a trailing list item is known to be truncated
        return dropIncompleteTrailingLine(filtered, { dropListItems: response.truncated });
      }
      case 'financialAdvice': {
        const filtered = this.currentTextModelId.includes('gemma-4')
          ? this.filterReasoningContextForAdvice(text)
          : text;
        // Never show advice that was cut off mid-sentence
        return trimToLastCompleteSentence(this.dropDraftLanguage(filtered));
      }
      default:
        return text;
    }
  }

  /** In CJK locales, an English-only sentence is leftover draft commentary. */
  private dropDraftLanguage(text: string): string {
    const locale = this.translationService.currentLocale();
    return locale === 'tc' || locale === 'ja' ? dropNonCjkSentences(text) : text;
  }

  /**
   * Render a registry prompt into the text Gemini should receive.
   *
   * The JSON-only preamble is added here rather than written into the prompts
   * because it is a Gemini quirk: its models otherwise narrate their reasoning
   * ahead of the JSON and the parse fails. OpenAI and Claude need no such
   * warning, and when the preamble lived in the prompt text it was one of the
   * reasons the three copies of each prompt drifted apart.
   */
  private renderedText(rendered: RenderedPrompt): string {
    const preamble = rendered.expects === 'json' ? `${JSON_ONLY_PREAMBLE}\n\n` : '';
    const system = rendered.system ? `${rendered.system}\n\n` : '';
    return `${preamble}${system}${rendered.user}`;
  }

  /**
   * Gemma drafts verbosely before its final answer, so every prose reply gets
   * double the room or the visible text arrives truncated. That is a property of
   * the model rather than of the task, which is why it is applied here and not
   * in the registry. JSON replies are unaffected — they do not get drafted.
   */
  private generationConfig(rendered: RenderedPrompt) {
    const draftsVerbosely =
      this.currentTextModelId.includes('gemma') && rendered.expects !== 'json';
    return {
      maxOutputTokens: draftsVerbosely ? rendered.maxOutputTokens * 2 : rendered.maxOutputTokens,
      temperature: rendered.temperature,
      ...(rendered.topP !== undefined ? { topP: rendered.topP } : {}),
    };
  }

  /**
   * The caller's cancellation, in the shape `generateContent` takes as its
   * second argument.
   *
   * Undefined when there is nothing to cancel with, so a request without a
   * signal reaches fetch exactly as it did before — the SDK wires up an
   * AbortController of its own for any options object it is handed.
   */
  private requestOptions(options?: AIRequestOptions): SingleRequestOptions | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
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

  /**
   * Gemini narrates before its JSON often enough that a greedy bracket match
   * grabs prose, so this counts brackets from the first one instead. That is
   * why the shared implementation is overridden rather than shared.
   */
  protected override extractJson(text: string): string {
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
}
