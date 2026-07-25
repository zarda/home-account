import {
  PIN_LENGTH,
  constantTimeEqual,
  derivePinRecord,
  isValidPin,
  verifyPin,
} from './pin-hash.utils';

// Production derivation is deliberately expensive; specs use a low cost.
const TEST_ITERATIONS = 1000;

describe('pin-hash.utils', () => {
  describe('isValidPin', () => {
    it('accepts exactly the configured number of digits', () => {
      expect(isValidPin('1'.repeat(PIN_LENGTH))).toBe(true);
    });

    it('rejects the wrong length', () => {
      expect(isValidPin('1'.repeat(PIN_LENGTH - 1))).toBe(false);
      expect(isValidPin('1'.repeat(PIN_LENGTH + 1))).toBe(false);
    });

    it('rejects non-digits', () => {
      expect(isValidPin('12345a')).toBe(false);
      expect(isValidPin('')).toBe(false);
      expect(isValidPin('12 456')).toBe(false);
    });
  });

  describe('derivePinRecord', () => {
    it('records the version and cost alongside the hash', async () => {
      const record = await derivePinRecord('123456', TEST_ITERATIONS);

      expect(record.v).toBe(1);
      expect(record.iterations).toBe(TEST_ITERATIONS);
      expect(record.salt.length).toBeGreaterThan(0);
      expect(record.hash.length).toBeGreaterThan(0);
    });

    it('never stores the PIN itself', async () => {
      const record = await derivePinRecord('123456', TEST_ITERATIONS);

      expect(JSON.stringify(record)).not.toContain('123456');
    });

    it('salts each record so the same PIN hashes differently', async () => {
      const a = await derivePinRecord('123456', TEST_ITERATIONS);
      const b = await derivePinRecord('123456', TEST_ITERATIONS);

      expect(a.salt).not.toEqual(b.salt);
      expect(a.hash).not.toEqual(b.hash);
    });
  });

  describe('verifyPin', () => {
    it('accepts the PIN it was derived from', async () => {
      const record = await derivePinRecord('420024', TEST_ITERATIONS);

      await expectAsync(verifyPin('420024', record)).toBeResolvedTo(true);
    });

    it('rejects a different PIN', async () => {
      const record = await derivePinRecord('420024', TEST_ITERATIONS);

      await expectAsync(verifyPin('420025', record)).toBeResolvedTo(false);
    });

    // The stored cost is what verification must use, so raising the default
    // later cannot invalidate existing PINs.
    it('verifies against the cost stored in the record', async () => {
      const record = await derivePinRecord('420024', 2000);

      await expectAsync(verifyPin('420024', record)).toBeResolvedTo(true);
    });

    it('returns false for a corrupt record rather than throwing', async () => {
      const record = await derivePinRecord('420024', TEST_ITERATIONS);

      await expectAsync(
        verifyPin('420024', { ...record, salt: 'not base64 !!' })
      ).toBeResolvedTo(false);
    });
  });

  describe('constantTimeEqual', () => {
    it('is true for identical arrays', () => {
      expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it('is false when any byte differs', () => {
      expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
      expect(constantTimeEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
    });

    it('is false for different lengths', () => {
      expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });
  });
});
