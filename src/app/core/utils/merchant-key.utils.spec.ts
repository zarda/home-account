import {
  MAX_MERCHANT_KEY_LENGTH,
  merchantKeyForStorage,
  normalizeMerchantKey,
} from './merchant-key.utils';

describe('merchant key', () => {
  describe('normalizeMerchantKey', () => {
    it('folds case and strips punctuation and spacing', () => {
      expect(normalizeMerchantKey('  STARBUCKS  Coffee #123 ')).toBe('starbuckscoffee123');
      expect(normalizeMerchantKey('7-ELEVEN')).toBe('7eleven');
    });

    it('treats the same merchant written differently as one key', () => {
      expect(normalizeMerchantKey('Amazon.com*A1B2C')).toBe(normalizeMerchantKey('AMAZON COM A1B2C'));
    });

    it('keeps CJK merchant names distinct', () => {
      // The previous normalizer stripped everything outside [a-z0-9], so every
      // Japanese and Chinese description normalized to '' and compared equal to
      // every other. Two unrelated merchants must not share a key.
      expect(normalizeMerchantKey('セブンイレブン')).toBe('セブンイレブン');
      expect(normalizeMerchantKey('全家便利商店')).toBe('全家便利商店');
      expect(normalizeMerchantKey('セブンイレブン')).not.toBe(normalizeMerchantKey('全家便利商店'));
    });

    it('strips punctuation around CJK without swallowing the name', () => {
      expect(normalizeMerchantKey('スターバックス 渋谷店 #4821')).toBe('スターバックス渋谷店4821');
    });

    it('is empty only when there is nothing alphanumeric left', () => {
      expect(normalizeMerchantKey('---')).toBe('');
      expect(normalizeMerchantKey('   ')).toBe('');
      expect(normalizeMerchantKey('')).toBe('');
    });

    it('tolerates a null or undefined description', () => {
      expect(normalizeMerchantKey(undefined as unknown as string)).toBe('');
      expect(normalizeMerchantKey(null as unknown as string)).toBe('');
    });
  });

  describe('merchantKeyForStorage', () => {
    it('returns null when the description normalizes to nothing', () => {
      // An empty segment in a Firestore path addresses the collection rather
      // than a document in it, so this has to be caught before the write.
      expect(merchantKeyForStorage('***')).toBeNull();
      expect(merchantKeyForStorage('')).toBeNull();
    });

    it('truncates a very long description to a storable key', () => {
      const key = merchantKeyForStorage('a'.repeat(MAX_MERCHANT_KEY_LENGTH + 50));
      expect(key?.length).toBe(MAX_MERCHANT_KEY_LENGTH);
    });

    it('returns the normalized key for a normal merchant', () => {
      expect(merchantKeyForStorage('Starbucks #123')).toBe('starbucks123');
    });
  });
});
