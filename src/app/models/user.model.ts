import { Timestamp } from '@angular/fire/firestore';

export interface User {
  id: string;                    // Firebase Auth UID
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  preferences: UserPreferences;
  subscription?: UserSubscription; // Absent = free tier
}

export type SubscriptionTier = 'free' | 'premium';

/**
 * Subscription state. General (free) users can store up to
 * FREE_TIER_RECEIPT_IMAGE_LIMIT receipt images; a paid premium upgrade
 * that lifts the limit will be offered in a future release, so billing
 * metadata (renewal, payment reference) will be added here when it lands.
 */
export interface UserSubscription {
  tier: SubscriptionTier;
}

/**
 * Default maximum stored receipt images for free-tier (general) users.
 * Tunable at runtime via Remote Config (docs/remote-config.md); this
 * constant is the in-app fallback when no remote value is available.
 */
export const FREE_TIER_RECEIPT_IMAGE_LIMIT = 200;

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
  enableRagInsights?: boolean;   // Master RAG toggle: ground AI insights in retrieved
                                 // transaction details (absent/undefined = OFF)
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  baseCurrency: 'USD',
  language: 'en',
  dateFormat: 'MM/DD/YYYY',
  theme: 'system',
  defaultCategories: []
};
