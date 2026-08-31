// Writes to Firestore that no client is allowed to make, for smoke tests that
// need to set up the far side of a rule they are about to exercise.
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
