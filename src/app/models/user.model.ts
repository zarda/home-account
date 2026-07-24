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
  search: LLMProvider;
}

export const DEFAULT_LLM_PROVIDER_PREFERENCES: LLMProviderPreferences = {
  receiptScanning: 'gemini',
  categorization: 'gemini',
  insights: 'gemini',
  search: 'gemini',
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
  enableRagInsights?: boolean;   // Legacy on/off RAG toggle. Kept and dual-written on save so
                                 // older installed clients keep working; never read directly —
                                 // use effectiveRagLevel().
  ragInsightsLevel?: RagInsightsLevel; // Tiered RAG grounding depth. Absent = derive from the
                                       // legacy boolean (true→'standard', else 'off').
}

/** Detail-grounding depth for AI insights — a token/latency vs. detail trade-off. */
export type RagInsightsLevel = 'off' | 'light' | 'standard' | 'deep';

export const RAG_INSIGHTS_LEVELS: readonly RagInsightsLevel[] = ['off', 'light', 'standard', 'deep'];

export interface RagTierConfig {
  topExpenses: number;          // cap for the "Top expenses" section
  anomalies: number;            // cap for "Unusual amounts"; 0 = omit the section entirely
  categoryDeltas: number;       // cap for "Category changes"
  baselineWindowMonths: number; // trailing anomaly-baseline window; 0 = no history query needed
}

export const RAG_TIER_CONFIGS: Record<Exclude<RagInsightsLevel, 'off'>, RagTierConfig> = {
  light:    { topExpenses: 3,  anomalies: 0,  categoryDeltas: 5,  baselineWindowMonths: 0 },
  standard: { topExpenses: 10, anomalies: 5,  categoryDeltas: 5,  baselineWindowMonths: 6 },
  deep:     { topExpenses: 20, anomalies: 10, categoryDeltas: 10, baselineWindowMonths: 12 },
};

/**
 * Resolve the RAG level from preferences, tolerating unknown stored values
 * and migrating the legacy boolean (true→'standard', otherwise 'off').
 */
export function effectiveRagLevel(prefs: UserPreferences | null | undefined): RagInsightsLevel {
  const level = prefs?.ragInsightsLevel;
  if (level && RAG_INSIGHTS_LEVELS.includes(level)) {
    return level;
  }
  return prefs?.enableRagInsights ? 'standard' : 'off';
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  baseCurrency: 'USD',
  language: 'en',
  dateFormat: 'MM/DD/YYYY',
  theme: 'system',
  defaultCategories: []
};
