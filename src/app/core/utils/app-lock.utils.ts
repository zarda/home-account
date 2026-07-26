import { PinRecord } from './pin-hash.utils';

export const APP_LOCK_STORAGE_PREFIX = 'homeaccount.app-lock';

/** Wrong PINs allowed before the lock screen offers only sign-out. */
export const MAX_PIN_ATTEMPTS = 10;

export function appLockStorageKey(userId: string): string {
  return `${APP_LOCK_STORAGE_PREFIX}.${userId}`;
}

/**
 * The stored credential for this device, or null when there is none.
 *
 * A corrupt or partially-written record degrades to "no credential" rather
 * than throwing: this is read during bootstrap, and an exception here would
 * white-screen the app.
 */
export function readPinRecord(userId: string): PinRecord | null {
  try {
    const raw = localStorage.getItem(appLockStorageKey(userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PinRecord>;
    const valid =
      parsed?.v === 1 &&
      typeof parsed.salt === 'string' &&
      parsed.salt !== '' &&
      typeof parsed.hash === 'string' &&
      parsed.hash !== '' &&
      typeof parsed.iterations === 'number' &&
      parsed.iterations > 0;

    return valid ? (parsed as PinRecord) : null;
  } catch {
    return null;
  }
}

export function writePinRecord(userId: string, record: PinRecord): boolean {
  try {
    localStorage.setItem(appLockStorageKey(userId), JSON.stringify(record));
    return true;
  } catch {
    // Private browsing and full quotas both throw; the caller reports that the
    // PIN could not be saved rather than claiming a lock that will not hold.
    return false;
  }
}

export function clearPinRecord(userId: string): void {
  try {
    localStorage.removeItem(appLockStorageKey(userId));
  } catch {
    // Nothing to do — the record is unreadable either way.
  }
}

/** Failed-attempt state, kept across reloads. */
export interface AttemptState {
  failed: number;
  blockedUntil: number;
}

const EMPTY_ATTEMPTS: AttemptState = { failed: 0, blockedUntil: 0 };

function attemptStorageKey(userId: string): string {
  return `${appLockStorageKey(userId)}.attempts`;
}

/**
 * Without persistence the backoff is reset by a page reload or an app
 * relaunch, which is a control the person holding the device already has —
 * so the whole rate limit would be bypassable without any tooling.
 */
export function readAttemptState(userId: string): AttemptState {
  try {
    const raw = localStorage.getItem(attemptStorageKey(userId));
    if (!raw) return { ...EMPTY_ATTEMPTS };

    const parsed = JSON.parse(raw) as Partial<AttemptState>;
    const failed = typeof parsed?.failed === 'number' && parsed.failed >= 0 ? parsed.failed : 0;
    const blockedUntil =
      typeof parsed?.blockedUntil === 'number' && parsed.blockedUntil >= 0 ? parsed.blockedUntil : 0;
    return { failed, blockedUntil };
  } catch {
    return { ...EMPTY_ATTEMPTS };
  }
}

export function writeAttemptState(userId: string, state: AttemptState): void {
  try {
    localStorage.setItem(attemptStorageKey(userId), JSON.stringify(state));
  } catch {
    // Storage refusing the write only costs the cross-reload backoff.
  }
}

export function clearAttemptState(userId: string): void {
  try {
    localStorage.removeItem(attemptStorageKey(userId));
  } catch {
    // Nothing to do.
  }
}

/** True when the app sat in the background longer than the configured delay. */
export function shouldRelock(
  backgroundedAt: number | null,
  now: number,
  timeoutMinutes: number
): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= timeoutMinutes * 60_000;
}

/** Escalating delay after repeated wrong PINs: 0, 0, 0, 5s, 10s, 20s, 30s… */
export function unlockBackoffMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  return Math.min(30_000, 5_000 * 2 ** (failedAttempts - 3));
}
