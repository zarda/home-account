import { DEFAULT_TEXT_MODEL } from './ai-models';

/**
 * Version of the stored AI-preferences shape.
 *
 * Bumped when a stored blob needs moving forward. An absent version is the
 * pre-migration shape, which is every blob written before this file existed.
 */
export const AI_PREFERENCES_SCHEMA_VERSION = 1;

/**
 * Stored model ids the app moves forward on its single migration pass, keyed
 * by the id a preference may still hold and valued by what now serves that
 * role.
 *
 * Deliberately not "ids missing from the catalog": 3.1 Flash-Lite is still
 * offered, because a user who picks it after the migration has chosen it. The
 * map means "moved forward once", not "not offered".
 */
const MODEL_ID_REPLACEMENTS: Record<string, string> = {
  // Shut down upstream — listed under "Previous models" on ai.google.dev. It
  // was the default for both text and vision, so most stored blobs name it.
  'gemini-3.1-flash-lite-preview': DEFAULT_TEXT_MODEL,
  // Dropped from the catalog in favour of 3.7 Flash. A stored id the catalog
  // no longer lists leaves the settings dropdown showing nothing at all.
  'gemini-3.1-pro-preview': 'gemini-3.7-flash',
};

/** The stored fields this module reads. Kept structural so the preferences
 * interface can live with the service that owns it rather than here. */
export interface VersionedModelPreferences {
  schemaVersion?: number;
  textModel?: string;
  visionModel?: string;
  openaiModel?: string;
  claudeModel?: string;
}

/** The four fields that hold a model id, named once so adding a fifth provider
 * cannot half-migrate. */
const MODEL_FIELDS = ['textModel', 'visionModel', 'openaiModel', 'claudeModel'] as const;

/**
 * Move a stored preferences blob onto the current model catalog, once.
 *
 * Returns the blob to persist and whether anything changed. A blob already at
 * the current version is returned untouched — that is what lets a deliberate
 * pick of a superseded model survive, even though its id is still in the
 * replacement map.
 *
 * `changed` is true whenever the version stamp was missing, even if no id
 * actually moved: without persisting the stamp the pass would run again on
 * every load, and a later deliberate pick would be undone.
 *
 * Call this on the parsed stored object, **before** merging it over the
 * defaults. The defaults carry the current stamp, so merging first hands a
 * legacy blob a version it never had and the migration silently declines to
 * run.
 */
export function migrateModelPreferences<T extends VersionedModelPreferences>(
  stored: T,
): { prefs: T & VersionedModelPreferences; changed: boolean } {
  if (stored?.schemaVersion === AI_PREFERENCES_SCHEMA_VERSION) {
    return { prefs: stored, changed: false };
  }

  const prefs = { ...stored, schemaVersion: AI_PREFERENCES_SCHEMA_VERSION };
  // One mutable view over the four fields, rather than a cast per assignment:
  // the ids are strings whatever the caller's blob is typed as.
  const fields = prefs as unknown as Record<string, unknown>;

  for (const field of MODEL_FIELDS) {
    const current = fields[field];
    // `in` rather than a truthiness check on the lookup: a blob without the
    // field must not gain it as undefined, and a replacement is only ever
    // applied to an id the map actually names.
    if (typeof current === 'string' && current in MODEL_ID_REPLACEMENTS) {
      fields[field] = MODEL_ID_REPLACEMENTS[current];
    }
  }

  return { prefs, changed: true };
}

/** Read-only view of the replacement map, for the specs that assert the
 * catalog and the map cannot drift apart. */
export function modelIdReplacements(): Readonly<Record<string, string>> {
  return MODEL_ID_REPLACEMENTS;
}
