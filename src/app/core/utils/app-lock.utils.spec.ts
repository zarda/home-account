import {
  MAX_PIN_ATTEMPTS,
  appLockStorageKey,
  clearPinRecord,
  readPinRecord,
  shouldRelock,
  unlockBackoffMs,
  writePinRecord,
} from './app-lock.utils';
import { PinRecord } from './pin-hash.utils';

const RECORD: PinRecord = { v: 1, salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 1000 };

describe('app-lock.utils', () => {
  afterEach(() => {
    localStorage.removeItem(appLockStorageKey('user-1'));
  });

  describe('pin record storage', () => {
    it('round-trips a record per user', () => {
      expect(writePinRecord('user-1', RECORD)).toBe(true);
      expect(readPinRecord('user-1')).toEqual(RECORD);
    });

    it('keeps records separate per account', () => {
      writePinRecord('user-1', RECORD);

      expect(readPinRecord('user-2')).toBeNull();
    });

    it('returns null when nothing is stored', () => {
      expect(readPinRecord('user-1')).toBeNull();
    });

    it('clears a stored record', () => {
      writePinRecord('user-1', RECORD);
      clearPinRecord('user-1');

      expect(readPinRecord('user-1')).toBeNull();
    });

    // This runs during bootstrap; a throw here would white-screen the app.
    it('treats unparseable storage as no credential', () => {
      localStorage.setItem(appLockStorageKey('user-1'), 'not json');

      expect(readPinRecord('user-1')).toBeNull();
    });

    it('rejects a record of an unknown version', () => {
      localStorage.setItem(appLockStorageKey('user-1'), JSON.stringify({ ...RECORD, v: 2 }));

      expect(readPinRecord('user-1')).toBeNull();
    });

    it('rejects a record missing its salt or hash', () => {
      localStorage.setItem(appLockStorageKey('user-1'), JSON.stringify({ ...RECORD, salt: '' }));
      expect(readPinRecord('user-1')).toBeNull();

      localStorage.setItem(appLockStorageKey('user-1'), JSON.stringify({ ...RECORD, hash: '' }));
      expect(readPinRecord('user-1')).toBeNull();
    });

    it('rejects a record with a nonsensical cost', () => {
      localStorage.setItem(
        appLockStorageKey('user-1'),
        JSON.stringify({ ...RECORD, iterations: 0 })
      );

      expect(readPinRecord('user-1')).toBeNull();
    });

    it('reports a failed write instead of throwing', () => {
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');

      expect(writePinRecord('user-1', RECORD)).toBe(false);
    });
  });

  describe('shouldRelock', () => {
    it('does not relock when the app was never backgrounded', () => {
      expect(shouldRelock(null, 10_000, 0)).toBe(false);
    });

    it('relocks immediately at a zero-minute timeout', () => {
      expect(shouldRelock(1_000, 1_000, 0)).toBe(true);
    });

    it('waits for the full delay', () => {
      const backgrounded = 0;
      expect(shouldRelock(backgrounded, 4 * 60_000, 5)).toBe(false);
      expect(shouldRelock(backgrounded, 5 * 60_000, 5)).toBe(true);
      expect(shouldRelock(backgrounded, 6 * 60_000, 5)).toBe(true);
    });
  });

  describe('unlockBackoffMs', () => {
    it('does not delay the first attempts', () => {
      expect(unlockBackoffMs(0)).toBe(0);
      expect(unlockBackoffMs(1)).toBe(0);
      expect(unlockBackoffMs(2)).toBe(0);
    });

    it('escalates after repeated failures', () => {
      expect(unlockBackoffMs(3)).toBe(5_000);
      expect(unlockBackoffMs(4)).toBe(10_000);
      expect(unlockBackoffMs(5)).toBe(20_000);
    });

    it('caps the delay', () => {
      expect(unlockBackoffMs(6)).toBe(30_000);
      expect(unlockBackoffMs(MAX_PIN_ATTEMPTS)).toBe(30_000);
      expect(unlockBackoffMs(100)).toBe(30_000);
    });
  });
});
