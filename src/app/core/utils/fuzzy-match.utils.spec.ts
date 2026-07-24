import {
  boundedLevenshtein,
  editTolerance,
  fuzzyQueryMatches,
  fuzzyTokenMatches
} from './fuzzy-match.utils';

describe('fuzzy-match utils', () => {
  describe('editTolerance', () => {
    it('allows no edits for tokens under 4 characters', () => {
      expect(editTolerance(1)).toBe(0);
      expect(editTolerance(3)).toBe(0);
    });

    it('allows one edit for tokens of 4-6 characters', () => {
      expect(editTolerance(4)).toBe(1);
      expect(editTolerance(6)).toBe(1);
    });

    it('allows two edits for tokens of 7+ characters', () => {
      expect(editTolerance(7)).toBe(2);
      expect(editTolerance(12)).toBe(2);
    });
  });

  describe('boundedLevenshtein', () => {
    it('computes known distances', () => {
      expect(boundedLevenshtein('kitten', 'sitting', 3)).toBe(3);
      expect(boundedLevenshtein('starbcks', 'starbucks', 2)).toBe(1);
      expect(boundedLevenshtein('abc', 'abc', 2)).toBe(0);
      expect(boundedLevenshtein('', 'ab', 2)).toBe(2);
    });

    it('returns max + 1 once the distance provably exceeds max', () => {
      expect(boundedLevenshtein('abcdefgh', 'zyxwvuts', 2)).toBe(3);
    });

    it('short-circuits on a length delta beyond max', () => {
      expect(boundedLevenshtein('a', 'abcde', 2)).toBe(3);
    });
  });

  describe('fuzzyTokenMatches', () => {
    it('matches an exact substring anywhere in the text', () => {
      expect(fuzzyTokenMatches('bus', 'airbus shuttle')).toBeTrue();
    });

    it('matches a word within one edit for medium tokens', () => {
      expect(fuzzyTokenMatches('cofee', 'coffee at home')).toBeTrue();
    });

    it('matches a word within two edits for long tokens', () => {
      expect(fuzzyTokenMatches('strbcks', 'morning starbucks run')).toBeTrue();
    });

    it('matches a typo against the word prefix of the token length', () => {
      expect(fuzzyTokenMatches('restuar', 'dinner restaurant bill')).toBeTrue();
    });

    it('requires exact substring for short tokens', () => {
      expect(fuzzyTokenMatches('gm', 'gym session')).toBeFalse();
      expect(fuzzyTokenMatches('gym', 'gym session')).toBeTrue();
    });

    it('is case-insensitive', () => {
      expect(fuzzyTokenMatches('Starbcks', 'Coffee at STARBUCKS')).toBeTrue();
    });

    it('matches CJK sequences via the substring path', () => {
      expect(fuzzyTokenMatches('拉麵', '一蘭拉麵店')).toBeTrue();
    });

    it('rejects unrelated tokens', () => {
      expect(fuzzyTokenMatches('coffee', 'afternoon tea time')).toBeFalse();
    });
  });

  describe('fuzzyQueryMatches', () => {
    it('requires every token of the query to match', () => {
      expect(fuzzyQueryMatches('starbcks cofee', 'coffee at starbucks')).toBeTrue();
      expect(fuzzyQueryMatches('starbcks pizza', 'coffee at starbucks')).toBeFalse();
    });
  });
});
