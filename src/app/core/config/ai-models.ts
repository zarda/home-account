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

/** Languages requested from Vision OCR for receipt recognition. */
export const OCR_LANGUAGES = ['en-US', 'ja-JP', 'zh-Hant'];
