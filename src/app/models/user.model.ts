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

/**
 * Per-provider API keys. Stored at users/{uid}/secrets/providers rather than
 * on UserPreferences, so they no longer ride along in every snapshot of the
 * broadly-subscribed user document. Field names match LLMProvider so
 * secrets[provider] type-checks.
 */
export interface ProviderSecrets {
  gemini?: string;
  openai?: string;
  claude?: string;
}

/**
 * How older builds stored the keys on the preferences map. Read only by the
 * one-time migration in ProviderKeyService.
 */
export interface LegacyProviderApiKeys {
  geminiApiKey?: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
}

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
  llmProviderPreferences?: LLMProviderPreferences; // Per-feature LLM provider selection
  enableRagInsights?: boolean;   // Legacy on/off RAG toggle. Kept and dual-written on save so
                                 // older installed clients keep working; never read directly —
                                 // use effectiveRagLevel().
  ragInsightsLevel?: RagInsightsLevel; // Tiered RAG grounding depth. Absent = derive from the
                                       // legacy boolean (true→'standard', else 'off').
  enableAppLock?: boolean;       // Absent = off. Requires a credential on this device.
  appLockTimeoutMinutes?: number; // Grace period after backgrounding; absent = default.
  enableUsageAnalytics?: boolean; // Premium only, absent = off. Ignored on the free tier,
                                  // where collection is always on — see docs/analytics.md.
}

/** Auto-lock delays offered in settings, in minutes. 0 locks immediately. */
export const APP_LOCK_TIMEOUT_MINUTES: readonly number[] = [0, 1, 5, 15, 60];

export const DEFAULT_APP_LOCK_TIMEOUT_MINUTES = 5;

/** Whether the account asked for an app lock. Absent means off. */
export function appLockEnabled(prefs: UserPreferences | null | undefined): boolean {
  return prefs?.enableAppLock === true;
}

/**
 * Resolve the auto-lock delay, tolerating values written by other builds the
 * same way effectiveRagLevel() tolerates unknown levels.
 */
export function effectiveAppLockTimeoutMinutes(
  prefs: UserPreferences | null | undefined
): number {
  const stored = prefs?.appLockTimeoutMinutes;
  if (typeof stored === 'number' && APP_LOCK_TIMEOUT_MINUTES.includes(stored)) {
    return stored;
  }
  return DEFAULT_APP_LOCK_TIMEOUT_MINUTES;
}

/** The account's tier. No subscription record means the free tier. */
export function subscriptionTier(user: User | null | undefined): SubscriptionTier {
  return user?.subscription?.tier ?? 'free';
}

/**
 * Whether anonymous usage statistics are collected for this account.
 *
 * Free tier: always. Usage statistics are part of what the free tier gives
 * back, so `enableUsageAnalytics` is not consulted at all — a stored `false`
 * from a lapsed premium account does not disable collection.
 *
 * Premium: the stored preference, absent meaning off. Turning collection off is
 * a paid entitlement.
 *
 * No account: never. A signed-out session and the window before the user
 * document arrives both land here, and neither can be attributed to a tier, so
 * both stay silent. Analytics is not initialised while this is false, so "off"
 * means no request was made rather than a suppressed one.
 */
export function usageAnalyticsEnabled(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }
  if (subscriptionTier(user) === 'premium') {
    return user.preferences?.enableUsageAnalytics === true;
  }
  return true;
}

/** Whether this account is allowed to turn usage statistics off. */
export function canDisableUsageAnalytics(user: User | null | undefined): boolean {
  return subscriptionTier(user) === 'premium';
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
