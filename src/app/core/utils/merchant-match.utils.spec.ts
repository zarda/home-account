import {
  DEFAULT_MERCHANT_SIMILARITY,
  bigramSimilarity,
  merchantKeysMatch,
} from './merchant-match.utils';

describe('merchantKeysMatch', () => {
  describe('the three rungs, one at a time', () => {
    it('matches identical keys', () => {
      expect(merchantKeysMatch('netflix', 'netflix')).toBeTrue();
    });

    it('matches by containment when the shorter key is at least three characters', () => {
      expect(merchantKeysMatch('starbucks', 'starbucks shibuya')).toBeTrue();
    });

    it('does not reach the containment rung for a two-character key', () => {
      // 'ab' is inside 'abcdefgh', but two characters is too little evidence
      // that they are the same payee.
      expect(merchantKeysMatch('ab', 'abcdefgh')).toBeFalse();
    });

    it('matches by similarity when neither contains the other', () => {
      expect(bigramSimilarity('netflix', 'netflix uk')).toBeGreaterThan(DEFAULT_MERCHANT_SIMILARITY);
      expect(merchantKeysMatch('netflix', 'netflix uk')).toBeTrue();
    });

    it('refuses two unrelated merchants', () => {
      expect(merchantKeysMatch('netflix', 'groceries')).toBeFalse();
    });
  });

  describe('the empty guard, which is the whole behaviour change of the merge', () => {
    it('refuses two empty keys', () => {
      // The detection copy called this a match. It never showed because
      // computeRecurringGroups filters empty keys before clustering -- which
      // is exactly the kind of caller-side rescue that stops working the
      // moment a second caller appears.
      expect(merchantKeysMatch('', '')).toBeFalse();
    });

    it('refuses an empty key against a real one', () => {
      expect(merchantKeysMatch('', 'netflix')).toBeFalse();
      expect(merchantKeysMatch('netflix', '')).toBeFalse();
    });
  });

  describe('the threshold', () => {
    it('matches at exactly the threshold, not just above it', () => {
      // A pair scoring precisely the cut-off: the comparison is >=.
      const pair = ['abcd', 'abce'] as const;
      const score = bigramSimilarity(pair[0], pair[1]);
      expect(merchantKeysMatch(pair[0], pair[1], score)).toBeTrue();
      expect(merchantKeysMatch(pair[0], pair[1], score + 0.0001)).toBeFalse();
    });

    it('defaults to the shared constant', () => {
      expect(DEFAULT_MERCHANT_SIMILARITY).toBe(0.7);
    });
  });

  describe('symmetry', () => {
    const pairs: [string, string][] = [
      ['netflix', 'netflix uk'],
      ['starbucks', 'starbucks shibuya'],
      ['全聯福利中心', '全聯福利'],
      ['netflix', 'groceries'],
      ['cvs', 'cvs nails'],
      ['', 'netflix'],
      ['ab', 'abcdefgh'],
    ];

    for (const [a, b] of pairs) {
      it(`answers the same either way round for "${a}" and "${b}"`, () => {
        expect(merchantKeysMatch(a, b)).toBe(merchantKeysMatch(b, a));
      });
    }
  });

  describe('known costs, pinned so a change to them is deliberate', () => {
    it('matches a short key against an unrelated merchant that contains it', () => {
      // The containment rung's price. Category blocking takes most of the
      // sting out of it in the detection path, and dropping the rung would
      // lose "starbucks" against "starbucks shibuya", which is what it is for.
      expect(merchantKeysMatch('cvs', 'cvs nails')).toBeTrue();
    });

    it('still cannot bridge two spellings that share no characters', () => {
      // The gap #296 exists for. Neither containment nor character bigrams
      // can see that these are one merchant.
      expect(merchantKeysMatch('amzn mktp de', 'amazon de')).toBeFalse();
      expect(merchantKeysMatch('7 eleven', 'セブン イレブン')).toBeFalse();
    });
  });

  describe('agrees with both implementations it replaces', () => {
    // Temporary, and deliberately duplicative: it inlines the two bodies this
    // module merged and asserts the merged one answers as they did. Delete it
    // once the merge is old news -- it pins a refactor, not a behaviour.
    const detectionCopy = (a: string, b: string, threshold: number): boolean => {
      if (a === b) return true;
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
      if (shorter.length >= 3 && longer.includes(shorter)) return true;
      return bigramSimilarity(a, b) >= threshold;
    };
    const coverageCopy = (a: string, b: string): boolean => {
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
      return bigramSimilarity(a, b) >= DEFAULT_MERCHANT_SIMILARITY;
    };

    const keys = [
      '', 'a', 'ab', 'abc', 'abcd', 'xab', 'abx', 'xabx', 'xyz', 'abcabc',
      'netflix', 'netflix uk', 'starbucks', 'starbucks shibuya',
      '全聯福利中心', '全聯福利', 'cvs', 'cvs nails', 'amzn mktp de', 'amazon de',
    ];

    it('answers as the coverage copy did, on every pair', () => {
      for (const a of keys) {
        for (const b of keys) {
          expect(merchantKeysMatch(a, b))
            .withContext(`"${a}" vs "${b}"`)
            .toBe(coverageCopy(a, b));
        }
      }
    });

    it('answers as the detection copy did on every pair but two empty keys', () => {
      const divergent: [string, string][] = [];
      for (const a of keys) {
        for (const b of keys) {
          if (merchantKeysMatch(a, b, DEFAULT_MERCHANT_SIMILARITY)
              !== detectionCopy(a, b, DEFAULT_MERCHANT_SIMILARITY)) {
            divergent.push([a, b]);
          }
        }
      }
      expect(divergent).toEqual([['', '']]);
    });
  });
});

describe('bigramSimilarity, re-exported from recurring-pattern.utils', () => {
  it('is 1 for identical non-empty strings and 0 for empty ones', () => {
    expect(bigramSimilarity('netflix', 'netflix')).toBe(1);
    expect(bigramSimilarity('', '')).toBe(0);
  });

  it('scores CJK, which has no whitespace to tokenise on', () => {
    expect(bigramSimilarity('全聯福利中心', '全聯福利')).toBeGreaterThan(0.7);
  });

  it('is symmetric', () => {
    expect(bigramSimilarity('netflix', 'netflix uk'))
      .toBe(bigramSimilarity('netflix uk', 'netflix'));
  });
});
