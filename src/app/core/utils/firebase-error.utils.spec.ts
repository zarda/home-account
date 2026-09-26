import { errorCode, isRefused } from './firebase-error.utils';

describe('firebase-error.utils', () => {
  const firebaseError = (code: unknown) => Object.assign(new Error('failed'), { name: 'FirebaseError', code });

  describe('errorCode', () => {
    it('reads a string code off a Firestore or Functions error', () => {
      expect(errorCode(firebaseError('permission-denied'))).toBe('permission-denied');
      expect(errorCode(firebaseError('functions/not-found'))).toBe('functions/not-found');
    });

    it('answers undefined for anything without a string code', () => {
      expect(errorCode(new Error('plain'))).toBeUndefined();
      expect(errorCode(firebaseError(5))).toBeUndefined();
      expect(errorCode(null)).toBeUndefined();
      expect(errorCode(undefined)).toBeUndefined();
      expect(errorCode('permission-denied')).toBeUndefined();
    });
  });

  describe('isRefused', () => {
    it('is true only for a rules refusal', () => {
      expect(isRefused(firebaseError('permission-denied'))).toBeTrue();
      expect(isRefused(firebaseError('unavailable'))).toBeFalse();
      expect(isRefused(firebaseError('functions/permission-denied'))).toBeFalse();
      expect(isRefused(new Error('permission-denied'))).toBeFalse();
      expect(isRefused(null)).toBeFalse();
    });
  });
});
