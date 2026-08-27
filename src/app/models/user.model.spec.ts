import {
  DEFAULT_FONT_SCALE,
  DEFAULT_USER_PREFERENCES,
  RAG_INSIGHTS_LEVELS,
  RAG_TIER_CONFIGS,
  RagInsightsLevel,
  User,
  UserPreferences,
  baseCurrencyOf,
  canDisableUsageAnalytics,
  effectiveFontScale,
  effectiveRagLevel,
  highContrastEnabled,
  reducedMotionRequested,
  subscriptionTier,
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

describe('effectiveFontScale', () => {
  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  it('should default for missing preferences', () => {
    expect(effectiveFontScale(undefined)).toBe(DEFAULT_FONT_SCALE);
    expect(effectiveFontScale(null)).toBe(DEFAULT_FONT_SCALE);
  });

  it('should default when the field is absent', () => {
    expect(effectiveFontScale(prefs({}))).toBe(DEFAULT_FONT_SCALE);
  });

  it('should report a stored scale that is on the list', () => {
    expect(effectiveFontScale(prefs({ fontScale: 1.15 }))).toBe(1.15);
    expect(effectiveFontScale(prefs({ fontScale: 1.3 }))).toBe(1.3);
  });

  it('should fall back to the default for a scale off the list', () => {
    expect(effectiveFontScale(prefs({ fontScale: 2 }))).toBe(DEFAULT_FONT_SCALE);
  });

  it('should tolerate junk written by another build', () => {
    const corrupt = prefs({ fontScale: 'large' as unknown as number });
    expect(effectiveFontScale(corrupt)).toBe(DEFAULT_FONT_SCALE);
  });
});

describe('highContrastEnabled', () => {
  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  it('should be off for missing preferences', () => {
    expect(highContrastEnabled(undefined)).toBeFalse();
    expect(highContrastEnabled(null)).toBeFalse();
  });

  it('should be off when the field is absent', () => {
    expect(highContrastEnabled(prefs({}))).toBeFalse();
  });

  it('should be on only for a stored true', () => {
    expect(highContrastEnabled(prefs({ highContrast: true }))).toBeTrue();
  });

  it('should require exactly true, tolerating junk', () => {
    expect(highContrastEnabled(prefs({ highContrast: false }))).toBeFalse();
    const corrupt = prefs({ highContrast: 'yes' as unknown as boolean });
    expect(highContrastEnabled(corrupt)).toBeFalse();
  });
});

describe('reducedMotionRequested', () => {
  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  it('should be off for missing preferences', () => {
    expect(reducedMotionRequested(undefined)).toBeFalse();
    expect(reducedMotionRequested(null)).toBeFalse();
  });

  it('should be off when the field is absent', () => {
    expect(reducedMotionRequested(prefs({}))).toBeFalse();
  });

  it('should be on only for a stored true', () => {
    expect(reducedMotionRequested(prefs({ reducedMotion: true }))).toBeTrue();
  });

  it('should require exactly true, tolerating junk', () => {
    expect(reducedMotionRequested(prefs({ reducedMotion: false }))).toBeFalse();
    const corrupt = prefs({ reducedMotion: 'yes' as unknown as boolean });
    expect(reducedMotionRequested(corrupt)).toBeFalse();
  });
});

describe('usageAnalyticsEnabled', () => {
  const user = (overrides: Partial<User> = {}): User =>
    ({ id: 'u1', preferences: { ...DEFAULT_USER_PREFERENCES }, ...overrides }) as User;

  it('should be off with no account', () => {
    // A signed-out session and the window before the user document arrives both
    // land here. Neither can be attributed to a tier, so both stay silent.
    expect(usageAnalyticsEnabled(undefined)).toBeFalse();
    expect(usageAnalyticsEnabled(null)).toBeFalse();
  });

  it('should be on for a free-tier account', () => {
    // No subscription record means free tier, which includes collection.
    expect(usageAnalyticsEnabled(user())).toBeTrue();
    expect(usageAnalyticsEnabled(user({ subscription: { tier: 'free' } }))).toBeTrue();
  });

  it('should ignore a stored opt-out on the free tier', () => {
    // A false left behind by a lapsed premium account must not disable
    // collection the free tier includes.
    const optedOut = user({
      preferences: { ...DEFAULT_USER_PREFERENCES, enableUsageAnalytics: false },
    });

    expect(usageAnalyticsEnabled(optedOut)).toBeTrue();
  });

  it('should honour the stored preference on premium', () => {
    const base = { subscription: { tier: 'premium' as const } };

    expect(
      usageAnalyticsEnabled(
        user({ ...base, preferences: { ...DEFAULT_USER_PREFERENCES, enableUsageAnalytics: false } })
      )
    ).toBeFalse();
    expect(
      usageAnalyticsEnabled(
        user({ ...base, preferences: { ...DEFAULT_USER_PREFERENCES, enableUsageAnalytics: true } })
      )
    ).toBeTrue();
  });

  it('should default premium to off when the preference is absent', () => {
    // Premium is where the choice lives, so an unanswered choice is off.
    expect(usageAnalyticsEnabled(user({ subscription: { tier: 'premium' } }))).toBeFalse();
  });

  it('should require exactly true on premium', () => {
    const loose = user({
      subscription: { tier: 'premium' },
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        enableUsageAnalytics: 'yes' as unknown as boolean,
      },
    });

    expect(usageAnalyticsEnabled(loose)).toBeFalse();
  });

  it('should stay out of the defaults', () => {
    expect('enableUsageAnalytics' in DEFAULT_USER_PREFERENCES).toBeFalse();
  });
});

describe('baseCurrencyOf', () => {
  const user = (baseCurrency: unknown): User =>
    ({ id: 'u1', preferences: { ...DEFAULT_USER_PREFERENCES, baseCurrency } }) as User;

  it('reports the account preference', () => {
    expect(baseCurrencyOf(user('KRW'))).toBe('KRW');
  });

  it('falls back to USD with no account', () => {
    expect(baseCurrencyOf(null)).toBe('USD');
    expect(baseCurrencyOf(undefined)).toBe('USD');
  });

  it('falls back to USD for a preference saved empty', () => {
    // The reason this is one function now: the seventeen files that used to
    // spell it out disagreed, and the `??` half kept '' — yielding a
    // transaction with no currency at all.
    expect(baseCurrencyOf(user(''))).toBe('USD');
  });

  it('falls back to USD when preferences are absent entirely', () => {
    expect(baseCurrencyOf({ id: 'u1' } as User)).toBe('USD');
  });
});

describe('canDisableUsageAnalytics', () => {
  const user = (tier?: 'free' | 'premium'): User =>
    ({
      id: 'u1',
      preferences: { ...DEFAULT_USER_PREFERENCES },
      ...(tier ? { subscription: { tier } } : {}),
    }) as User;

  it('should be a premium entitlement', () => {
    expect(canDisableUsageAnalytics(user('premium'))).toBeTrue();
  });

  it('should be denied on the free tier and with no account', () => {
    expect(canDisableUsageAnalytics(user())).toBeFalse();
    expect(canDisableUsageAnalytics(user('free'))).toBeFalse();
    expect(canDisableUsageAnalytics(null)).toBeFalse();
  });
});

describe('subscriptionTier', () => {
  it('should treat an absent subscription as the free tier', () => {
    expect(subscriptionTier(null)).toBe('free');
    expect(subscriptionTier({ id: 'u1' } as User)).toBe('free');
  });

  it('should report a stored tier', () => {
    expect(subscriptionTier({ id: 'u1', subscription: { tier: 'premium' } } as User)).toBe(
      'premium'
    );
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
