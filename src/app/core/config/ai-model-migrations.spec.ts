import {
  AI_PREFERENCES_SCHEMA_VERSION,
  migrateModelPreferences,
  VersionedModelPreferences,
} from './ai-model-migrations';
import { DEFAULT_TEXT_MODEL } from './ai-models';

/** The id that was the default for both text and vision until it was shut
 * down upstream, so it is the value most stored blobs actually hold. */
const RETIRED_DEFAULT = 'gemini-3.1-flash-lite-preview';

/**
 * Every blob written before this module existed carries no version stamp, and
 * two of the ids it may hold no longer answer. The rewrite has to reach those
 * blobs exactly once: skip it and the retired default survives forever, repeat
 * it and a user who deliberately re-picks a superseded model is overruled on
 * every reload.
 *
 * These run against the plain function rather than through AIStrategyService,
 * because the branch that matters is a comparison against a number and none of
 * it needs an injector. The service's own spec covers the wiring, where the
 * order of migrate and merge is what can go wrong.
 */
describe('migrateModelPreferences', () => {
  describe('a blob from before the stamp existed', () => {
    it('moves the retired default forward in both Gemini fields', () => {
      const { prefs, changed } = migrateModelPreferences({
        textModel: RETIRED_DEFAULT,
        visionModel: RETIRED_DEFAULT,
      });

      expect(prefs.textModel).toBe(DEFAULT_TEXT_MODEL);
      expect(prefs.visionModel).toBe(DEFAULT_TEXT_MODEL);
      expect(prefs.schemaVersion).toBe(AI_PREFERENCES_SCHEMA_VERSION);
      expect(changed).toBeTrue();
    });

    it('moves a model dropped from the catalog onto its successor', () => {
      // 3.1 Pro still answers upstream; it left the list, and a stored id the
      // list does not hold shows the user an empty dropdown.
      const { prefs } = migrateModelPreferences({ textModel: 'gemini-3.1-pro-preview' });

      expect(prefs.textModel).toBe('gemini-3.7-flash');
    });

    it('reports a change for the stamp alone when no id moved', () => {
      // Without persisting the stamp the pass runs again on the next load,
      // and the deliberate-pick case below would never be reachable.
      const { prefs, changed } = migrateModelPreferences({
        textModel: DEFAULT_TEXT_MODEL,
        visionModel: DEFAULT_TEXT_MODEL,
      });

      expect(prefs.textModel).toBe(DEFAULT_TEXT_MODEL);
      expect(prefs.schemaVersion).toBe(AI_PREFERENCES_SCHEMA_VERSION);
      expect(changed).toBeTrue();
    });

    it('leaves the OpenAI and Claude ids alone', () => {
      const { prefs } = migrateModelPreferences({
        textModel: RETIRED_DEFAULT,
        openaiModel: 'gpt-5.4-mini',
        claudeModel: 'claude-sonnet-5',
      });

      expect(prefs.openaiModel).toBe('gpt-5.4-mini');
      expect(prefs.claudeModel).toBe('claude-sonnet-5');
    });

    it('does not invent the fields the blob left out', () => {
      // The result is spread over the defaults by the caller, and an explicit
      // undefined wins that spread — it would blank the default it lands on.
      const { prefs } = migrateModelPreferences({ textModel: RETIRED_DEFAULT });

      expect('visionModel' in prefs).toBeFalse();
      expect('openaiModel' in prefs).toBeFalse();
      expect('claudeModel' in prefs).toBeFalse();
    });

    it('carries unrelated settings through untouched', () => {
      const { prefs } = migrateModelPreferences({
        autoSync: false,
        textModel: RETIRED_DEFAULT,
      } as VersionedModelPreferences & { autoSync: boolean });

      expect(prefs.autoSync).toBeFalse();
    });
  });

  describe('a blob already at the current version', () => {
    it('keeps a superseded model the user picked back', () => {
      // The whole point of the stamp: 3.1 Flash-Lite is still in the catalog,
      // so choosing it after the migration is a choice, not a leftover.
      const stored = {
        schemaVersion: AI_PREFERENCES_SCHEMA_VERSION,
        textModel: RETIRED_DEFAULT,
        visionModel: DEFAULT_TEXT_MODEL,
      };

      const { prefs, changed } = migrateModelPreferences(stored);

      expect(prefs.textModel).toBe(RETIRED_DEFAULT);
      expect(changed).toBeFalse();
    });

    it('returns the blob it was given rather than a copy', () => {
      const stored = { schemaVersion: AI_PREFERENCES_SCHEMA_VERSION, textModel: DEFAULT_TEXT_MODEL };

      expect(migrateModelPreferences(stored).prefs).toBe(stored);
    });
  });

  it('stamps an empty blob rather than throwing', () => {
    // localStorage can hold `{}` — a write that failed halfway, or a hand
    // edit. It must migrate like any other unstamped blob.
    const { prefs, changed } = migrateModelPreferences({});

    expect(prefs.schemaVersion).toBe(AI_PREFERENCES_SCHEMA_VERSION);
    expect(changed).toBeTrue();
  });
});
