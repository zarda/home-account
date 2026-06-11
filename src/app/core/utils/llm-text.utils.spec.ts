import {
  endsWithSentenceTerminator,
  trimToLastCompleteSentence,
  dropIncompleteTrailingLine,
  protectDecimalPoints,
  restoreDecimalPoints,
  stripAdviceArtifacts,
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

    it('should not cut a number at its decimal point', () => {
      expect(trimToLastCompleteSentence('Great savings rate. Keep expenses below 13,125.00 TW'))
        .toBe('Great savings rate.');
    });

    it('should accept a sentence genuinely ending after a decimal number', () => {
      expect(trimToLastCompleteSentence('Save more. You kept 16,875.00.'))
        .toBe('Save more. You kept 16,875.00.');
    });
  });

  describe('decimal point protection', () => {
    it('should round-trip decimals through protect/restore', () => {
      const text = 'Balance of 16,875.00 TWD. Spend less.';
      const isProtected = protectDecimalPoints(text);
      expect(isProtected).not.toContain('16,875.00');
      expect(restoreDecimalPoints(isProtected)).toBe(text);
    });

    it('should leave sentence periods alone', () => {
      expect(protectDecimalPoints('Done. Next 5. items')).toBe('Done. Next 5. items');
    });
  });

  describe('dropIncompleteTrailingLine', () => {
    it('should drop a truncated prose last line', () => {
      const text = '## Spending Pattern\nGroceries dominate at 46.3%.\nThis is followed by Home & Garden at 3800';
      expect(dropIncompleteTrailingLine(text))
        .toBe('## Spending Pattern\nGroceries dominate at 46.3%.');
    });

    it('should keep text whose last line ends a sentence', () => {
      const text = '## Spending Pattern\nGroceries dominate at 46.3%.';
      expect(dropIncompleteTrailingLine(text)).toBe(text);
    });

    it('should keep an unpunctuated trailing list item by default', () => {
      const text = '## Actionable Insights\n- Reduce entertainment spending by 20%';
      expect(dropIncompleteTrailingLine(text)).toBe(text);
    });

    it('should drop a trailing list item when the response hit the token limit', () => {
      const text = '## Actionable Insights\n- Set a monthly budget.\n- Reduce entertainment spending by';
      expect(dropIncompleteTrailingLine(text, { dropListItems: true }))
        .toBe('## Actionable Insights\n- Set a monthly budget.');
    });

    it('should keep a trailing section header ending with a colon', () => {
      const text = 'Summary done.\nNext steps:';
      expect(dropIncompleteTrailingLine(text)).toBe(text);
    });

    it('should handle empty input', () => {
      expect(dropIncompleteTrailingLine('')).toBe('');
    });
  });
});

describe('stripAdviceArtifacts', () => {
  it('should drop an echoed language-instruction prefix and unbalanced quote', () => {
    expect(stripAdviceArtifacts('on Traditional Chinese: "今年您成功將支出控制在收入內。'))
      .toBe('今年您成功將支出控制在收入內。');
  });

  it('should strip balanced wrapping quotes', () => {
    expect(stripAdviceArtifacts('"Save 20% of your income."'))
      .toBe('Save 20% of your income.');
  });

  it('should leave clean advice untouched', () => {
    const text = 'Your savings rate of 56% is excellent. Keep it up.';
    expect(stripAdviceArtifacts(text)).toBe(text);
  });

  it('should not eat sentences that merely contain a colon', () => {
    expect(stripAdviceArtifacts('Remember: save first, spend later.'))
      .toBe('Remember: save first, spend later.');
  });
});
