/**
 * PIN derivation for the app lock.
 *
 * Threat model, stated plainly: this is a UI gate against someone picking up an
 * unlocked, signed-in device. It is not encryption — the Firebase token and the
 * Firestore cache sit beside this hash, so filesystem or devtools access
 * bypasses it entirely, and a six-digit PIN is only 10^6 candidates however
 * many PBKDF2 rounds guard it.
 */

export interface PinRecord {
  v: 1;
  salt: string;       // base64
  hash: string;       // base64, 32 bytes
  iterations: number; // stored so the cost can be raised without resetting PINs
}

export const PIN_LENGTH = 6;

const DEFAULT_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveBits(
  pin: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

/**
 * The iterations parameter exists so specs can derive cheaply; production
 * callers must not pass it.
 */
export async function derivePinRecord(
  pin: string,
  iterations: number = DEFAULT_ITERATIONS
): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(pin, salt, iterations);
  return { v: 1, salt: toBase64(salt), hash: toBase64(hash), iterations };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  try {
    const candidate = await deriveBits(pin, fromBase64(record.salt), record.iterations);
    return constantTimeEqual(candidate, fromBase64(record.hash));
  } catch {
    return false;
  }
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
