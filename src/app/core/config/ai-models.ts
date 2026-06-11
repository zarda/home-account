/**
 * Single source of truth for the cloud AI model catalog and defaults.
 * Model ids verified from https://ai.google.dev/gemini-api/docs/models
 * and https://ai.google.dev/gemma/docs/core
 */
export interface AIModelOption {
  id: string;
  name: string;
}

export const TEXT_MODELS: AIModelOption[] = [
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite (Recommended)' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B MoE' },
];

export const VISION_MODELS: AIModelOption[] = [
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite (Recommended)' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B' },
];

export const DEFAULT_TEXT_MODEL = 'gemini-3.1-flash-lite-preview';
export const DEFAULT_VISION_MODEL = 'gemini-3.1-flash-lite-preview';

// OpenAI models (multimodal — one model serves text and vision)
// Ids verified from https://developers.openai.com/api/docs/models
export const OPENAI_MODELS: AIModelOption[] = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (Recommended)' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
];
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

// Anthropic Claude models (multimodal)
export const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Recommended)' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
];
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Languages requested from Vision OCR for receipt recognition. */
export const OCR_LANGUAGES = ['en-US', 'ja-JP', 'zh-Hant'];
