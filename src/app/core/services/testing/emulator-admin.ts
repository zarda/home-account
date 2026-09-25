// Reads and writes to Firestore that no client is allowed to make, for smoke
// tests that need to set up (or look behind) the far side of a rule they are
// about to exercise.
//
// `users/{uid}/quota/receiptImages` is the case this exists for: the storage
// triggers own it through the Admin SDK and firestore.rules denies every
// client write, deliberately — a client that could edit its own limit would
// not be subject to one. So the SDK a smoke test uses for everything else
// cannot seed it, and the functions emulator (which would produce the doc for
// real) is not part of the smoke run.
//
// The Firestore emulator accepts `Authorization: Bearer owner` as the owner
// credential and skips rules evaluation for it — the same door the Admin SDK
// goes through in production. Emulator-only by construction: the host is
// pinned to the emulator's and no deployed project would honour that header.
//
// This file compiles into the app program (tsconfig.app.json excludes only
// *.spec.ts, not testing helpers), so it stays jasmine-free.

/** Must match the emulator port in firebase.json. */
const FIRESTORE_EMULATOR_ORIGIN = 'http://127.0.0.1:8080';

/** The demo project every smoke suite runs against. */
const PROJECT_ID = 'demo-home-account';

/** One Firestore REST typed value, e.g. `{ integerValue: '5' }`. */
export type EmulatorField = Record<string, string>;

/** REST carries integers as strings; a bare number would arrive as a double. */
export function integerField(value: number): EmulatorField {
  return { integerValue: String(value) };
}

export function timestampField(value: Date = new Date()): EmulatorField {
  return { timestampValue: value.toISOString() };
}

export function stringField(value: string): EmulatorField {
  return { stringValue: value };
}

function documentUrl(path: string): string {
  return `${FIRESTORE_EMULATOR_ORIGIN}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

/**
 * Create or replace a document, bypassing rules. `fields` are REST typed
 * values — build them with the encoders above.
 */
export async function setDocumentAsOwner(
  path: string,
  fields: Record<string, EmulatorField>
): Promise<void> {
  const response = await fetch(documentUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    throw new Error(
      `emulator write to ${path} failed: ${response.status} ${await response.text()}`
    );
  }
}

/**
 * Patch named fields of an existing document, bypassing rules. A key carrying
 * an `EmulatorField` is written; a key mapped to `null` is masked but left out
 * of the body, which is how REST's update mask spells a delete. A field path
 * containing a dot is not supported — the mask is `encodeURIComponent`ed, not
 * backtick-quoted the way a Firestore field-path segment would need.
 *
 * This is what a bad-state fixture needs, and `setDocumentAsOwner` cannot
 * stand in for it: the client rules require both timestamps on a create, a
 * document that lacks the field every enumeration orders by is never read back
 * at all, and the encoders above cannot express a rule's `frequency` map. So a
 * rule is written whole through the client SDK and only then broken here.
 */
export async function patchFieldsAsOwner(
  path: string,
  fields: Record<string, EmulatorField | null>
): Promise<void> {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    throw new Error('patchFieldsAsOwner: no fields');
  }
  const mask = entries
    .map(([key]) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  const present: Record<string, EmulatorField> = {};
  for (const [key, value] of entries) {
    if (value !== null) present[key] = value;
  }

  const response = await fetch(`${documentUrl(path)}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: present })
  });
  if (!response.ok) {
    throw new Error(
      `emulator patch of ${path} failed: ${response.status} ${await response.text()}`
    );
  }
}

/**
 * One REST typed value as the emulator returns it. Wider than `EmulatorField`
 * because a read can carry booleans, doubles and nested maps.
 */
export type EmulatorValue = Record<string, unknown>;

/**
 * Read a document's REST fields, bypassing rules; null when it does not exist.
 *
 * The values come back exactly as stored. A timestamp keeps its microseconds
 * here, which `timestampField` cannot reproduce (a `Date` holds milliseconds),
 * so a fixture that must equal a stored timestamp copies the value read back
 * rather than rebuilding it.
 */
export async function getDocumentAsOwner(
  path: string
): Promise<Record<string, EmulatorValue> | null> {
  const response = await fetch(documentUrl(path), {
    method: 'GET',
    headers: { Authorization: 'Bearer owner' }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `emulator read of ${path} failed: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { fields?: Record<string, EmulatorValue> };
  return body.fields ?? {};
}

/** Delete a document, bypassing rules. A document that is already gone is fine. */
export async function deleteDocumentAsOwner(path: string): Promise<void> {
  const response = await fetch(documentUrl(path), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `emulator delete of ${path} failed: ${response.status} ${await response.text()}`
    );
  }
}
