import {
  DEFAULT_USER_PREFERENCES,
  RAG_INSIGHTS_LEVELS,
  RAG_TIER_CONFIGS,
  RagInsightsLevel,
  UserPreferences,
  effectiveRagLevel,
  usageAnalyticsEnabled,
} from './user.model';

describe('effectiveRagLevel', () => {
  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  it('should be off for missing preferences', () => {
    expect(effectiveRagLevel(undefined)).toBe('off');
    expect(effectiveRagLevel(null)).toBe('off');
  });

  it('should be off when neither field is set', () => {
    expect(effectiveRagLevel(prefs({}))).toBe('off');
  });

  it('should migrate the legacy boolean: true maps to standard', () => {
    expect(effectiveRagLevel(prefs({ enableRagInsights: true }))).toBe('standard');
  });

  it('should migrate the legacy boolean: false maps to off', () => {
    expect(effectiveRagLevel(prefs({ enableRagInsights: false }))).toBe('off');
  });

  it('should let an explicit level win over the legacy boolean', () => {
    expect(effectiveRagLevel(prefs({ ragInsightsLevel: 'light', enableRagInsights: true }))).toBe('light');
    expect(effectiveRagLevel(prefs({ ragInsightsLevel: 'deep', enableRagInsights: false }))).toBe('deep');
    expect(effectiveRagLevel(prefs({ ragInsightsLevel: 'off', enableRagInsights: true }))).toBe('off');
  });

  it('should fall back to the boolean when the stored level is unknown', () => {
    const corrupt = prefs({ ragInsightsLevel: 'bogus' as RagInsightsLevel, enableRagInsights: true });
    expect(effectiveRagLevel(corrupt)).toBe('standard');
    const corruptOff = prefs({ ragInsightsLevel: 'bogus' as RagInsightsLevel });
    expect(effectiveRagLevel(corruptOff)).toBe('off');
  });
});

describe('usageAnalyticsEnabled', () => {
  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  it('should be off for missing preferences', () => {
    // Signed out, and the window before the user document arrives. Neither
    // may read as consent, which is what keeps the app silent at boot.
    expect(usageAnalyticsEnabled(undefined)).toBeFalse();
    expect(usageAnalyticsEnabled(null)).toBeFalse();
  });

  it('should be off when the field is absent', () => {
    // Every account created before the setting shipped is in this state, so
    // absent has to mean off rather than "not migrated yet".
    expect(usageAnalyticsEnabled(prefs({}))).toBeFalse();
  });

  it('should be off unless the stored value is exactly true', () => {
    expect(usageAnalyticsEnabled(prefs({ enableUsageAnalytics: false }))).toBeFalse();
    // A map written by another build could hold anything; only a real boolean
    // true is consent.
    expect(
      usageAnalyticsEnabled(prefs({ enableUsageAnalytics: 'yes' as unknown as boolean }))
    ).toBeFalse();
  });

  it('should be on when the account opted in', () => {
    expect(usageAnalyticsEnabled(prefs({ enableUsageAnalytics: true }))).toBeTrue();
  });

  it('should stay out of the defaults so a new account starts opted out', () => {
    expect('enableUsageAnalytics' in DEFAULT_USER_PREFERENCES).toBeFalse();
  });
});

describe('RAG tier configs', () => {
  it('should enumerate all four levels', () => {
    expect(RAG_INSIGHTS_LEVELS).toEqual(['off', 'light', 'standard', 'deep']);
  });

  it('light should skip anomalies and need no history window', () => {
    expect(RAG_TIER_CONFIGS.light).toEqual({
      topExpenses: 3, anomalies: 0, categoryDeltas: 5, baselineWindowMonths: 0,
    });
  });

  it('standard should match the original grounding caps', () => {
    expect(RAG_TIER_CONFIGS.standard).toEqual({
      topExpenses: 10, anomalies: 5, categoryDeltas: 5, baselineWindowMonths: 6,
    });
  });

  it('deep should widen every cap and the history window', () => {
    expect(RAG_TIER_CONFIGS.deep).toEqual({
      topExpenses: 20, anomalies: 10, categoryDeltas: 10, baselineWindowMonths: 12,
    });
  });
});
