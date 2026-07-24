import {
  DEFAULT_USER_PREFERENCES,
  RAG_INSIGHTS_LEVELS,
  RAG_TIER_CONFIGS,
  RagInsightsLevel,
  UserPreferences,
  effectiveRagLevel,
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
