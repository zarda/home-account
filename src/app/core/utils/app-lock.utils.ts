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
