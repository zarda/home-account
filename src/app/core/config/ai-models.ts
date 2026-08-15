/**
 * Single source of truth for the cloud AI model catalog and defaults.
 * Model ids verified from https://ai.google.dev/gemini-api/docs/models
 * and https://ai.google.dev/gemma/docs/core, last checked 2026-08-14.
 *
 * A model retired upstream keeps working for nobody, so the check is not
 * optional maintenance — see docs/ai-models.md for the retirement procedure
 * and ai-model-migrations.ts for what happens to a preference left behind.
 */
export interface AIModelOption {
  id: string;
  name: string;
  /**
   * The model accepts the sampling parameters (`temperature`, `top_p`,
   * `top_k`) the prompt registry declares.
   *
   * Absent means it does not. Vendors have been removing these together rather
   * than one at a time, and a model that rejects one rejects the family, so
   * this is a single flag rather than three. Defaulting to absent is what makes
   * a newly added id safe: it omits the parameter, which is what every adapter
   * but Gemini did before this flag existed. See ADR 0043.
   */
  acceptsSampling?: boolean;
}

// Every Gemini and Gemma model takes generationConfig.temperature, so all of
// these carry the flag.
export const TEXT_MODELS: AIModelOption[] = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Recommended)', acceptsSampling: true },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', acceptsSampling: true },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', acceptsSampling: true },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B MoE', acceptsSampling: true },
];

export const VISION_MODELS: AIModelOption[] = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Recommended)', acceptsSampling: true },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', acceptsSampling: true },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', acceptsSampling: true },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', acceptsSampling: true },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B', acceptsSampling: true },
];

export const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_VISION_MODEL = 'gemini-3.5-flash-lite';

// OpenAI models (multimodal — one model serves text and vision)
// Ids verified from https://developers.openai.com/api/docs/models
// None accepts sampling: the Responses API rejects `temperature` for the whole
// GPT-5 family, and every id offered here is GPT-5.
export const OPENAI_MODELS: AIModelOption[] = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (Recommended)' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
];
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

// Anthropic Claude models (multimodal)
// Anthropic removed sampling for models released after Claude Opus 4.6: the SDK
// types `temperature` @deprecated and the API rejects any value but 1.0 with a
// 400. Haiku 4.5 predates that line and still accepts it; the other two do not.
export const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (Recommended)' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', acceptsSampling: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
];
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

/**
 * Whether a model accepts the prompt's declared sampling parameters.
 *
 * Unknown ids answer false. A model the catalog has not been told about is
 * either brand new or one a user's stored preference kept alive past a
 * refresh (ADR 0041), and in both cases omitting the parameter degrades to the
 * provider default rather than failing the request outright.
 */
export function acceptsSampling(modelId: string): boolean {
  const known = [...TEXT_MODELS, ...VISION_MODELS, ...OPENAI_MODELS, ...CLAUDE_MODELS]
    .find(model => model.id === modelId);
  return known?.acceptsSampling === true;
}
