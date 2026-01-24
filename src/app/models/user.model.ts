import { Timestamp } from '@angular/fire/firestore';

export interface User {
  id: string;                    // Firebase Auth UID
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  preferences: UserPreferences;
}

export type LLMProvider = 'gemini' | 'openai' | 'claude';

export interface LLMProviderPreferences {
  receiptScanning: LLMProvider;
  categorization: LLMProvider;
  insights: LLMProvider;
}

export const DEFAULT_LLM_PROVIDER_PREFERENCES: LLMProviderPreferences = {
  receiptScanning: 'gemini',
  categorization: 'gemini',
  insights: 'gemini',
};

export interface UserPreferences {
  baseCurrency: string;          // ISO 4217 code (e.g., 'USD', 'THB')
  language: string;              // 'en', 'zh-Hant', 'ja'
  dateFormat: string;            // 'MM/DD/YYYY', 'DD/MM/YYYY'
  theme: 'light' | 'dark' | 'system';
  defaultCategories: string[];   // Category IDs to show first
  geminiApiKey?: string;         // Optional user-provided Gemini API key
  openaiApiKey?: string;         // Optional user-provided OpenAI API key
  claudeApiKey?: string;         // Optional user-provided Claude/Anthropic API key
  llmProviderPreferences?: LLMProviderPreferences; // Per-feature LLM provider selection
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  baseCurrency: 'USD',
  language: 'en',
  dateFormat: 'MM/DD/YYYY',
  theme: 'system',
  defaultCategories: []
};
