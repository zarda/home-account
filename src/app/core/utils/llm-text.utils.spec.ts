import {
  endsWithSentenceTerminator,
  trimToLastCompleteSentence,
  dropIncompleteTrailingLine,
} from './llm-text.utils';

describe('llm-text.utils', () => {
  describe('endsWithSentenceTerminator', () => {
    it('should accept Latin sentence endings', () => {
      expect(endsWithSentenceTerminator('All good.')).toBeTrue();
      expect(endsWithSentenceTerminator('Really?')).toBeTrue();
      expect(endsWithSentenceTerminator('Great!')).toBeTrue();
    });

    it('should accept CJK sentence endings', () => {
      expect(endsWithSentenceTerminator('支出を抑えましょう。')).toBeTrue();
      expect(endsWithSentenceTerminator('做得好！')).toBeTrue();
    });

    it('should accept terminators followed by closing quotes or brackets', () => {
      expect(endsWithSentenceTerminator('He said "done."')).toBeTrue();
      expect(endsWithSentenceTerminator('(All done.)')).toBeTrue();
    });

    it('should reject text cut off mid-sentence', () => {
      expect(endsWithSentenceTerminator('an income of 30000 TWD after')).toBeFalse();
      expect(endsWithSentenceTerminator('followed by Home & Garden at 3800')).toBeFalse();
    });
  });

  describe('trimToLastCompleteSentence', () => {
    it('should keep text that already ends a sentence', () => {
      expect(trimToLastCompleteSentence('Save more. Spend less.')).toBe('Save more. Spend less.');
    });

    it('should drop a trailing incomplete sentence', () => {
      expect(trimToLastCompleteSentence('Save 20% of income. Your current balance of 16875 TWD from an income of 30000 TWD after'))
        .toBe('Save 20% of income.');
    });

    it('should handle CJK sentences', () => {
      expect(trimToLastCompleteSentence('収入の20%を貯蓄しましょう。残高は16875'))
        .toBe('収入の20%を貯蓄しましょう。');
    });

    it('should keep the fragment when no complete sentence exists', () => {
      expect(trimToLastCompleteSentence('Your current balance of 16875 TWD'))
        .toBe('Your current balance of 16875 TWD');
    });
  });

  describe('dropIncompleteTrailingLine', () => {
    it('should drop a truncated last line', () => {
      const text = '## Spending Pattern\nGroceries dominate at 46.3%.\nThis is followed by Home & Garden at 3800';
      expect(dropIncompleteTrailingLine(text))
        .toBe('## Spending Pattern\nGroceries dominate at 46.3%.');
    });

    it('should keep text whose last line ends a sentence', () => {
      const text = '## Spending Pattern\nGroceries dominate at 46.3%.';
      expect(dropIncompleteTrailingLine(text)).toBe(text);
    });

    it('should handle empty input', () => {
      expect(dropIncompleteTrailingLine('')).toBe('');
    });
  });
});
