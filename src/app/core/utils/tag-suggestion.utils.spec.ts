import { applyTagSuggestions, MAX_SUGGESTED_TAGS } from './tag-suggestion.utils';

describe('applyTagSuggestions', () => {
  const vocabulary = ['coffee', 'work', 'travel'];

  it('keeps only tags the account already uses, normalized, at most three', () => {
    const out = applyTagSuggestions(2, [
      { index: 0, tags: ['Coffee', 'invented', ' work '] },
      { index: 1, tags: ['travel', 'coffee', 'work', 'travel'] },
    ], vocabulary);
    expect(out).toEqual([['coffee', 'work'], ['travel', 'coffee', 'work']]);
  });

  it('answers an empty list for a row the model skipped, misindexed or garbled', () => {
    expect(applyTagSuggestions(2, [{ index: 1, tags: 'coffee' }, { index: 7, tags: ['work'] }], vocabulary))
      .toEqual([[], []]);
    expect(applyTagSuggestions(1, 'nonsense', vocabulary)).toEqual([[]]);
  });

  it('never hands back more than the cap, however many the model named', () => {
    const out = applyTagSuggestions(1, [
      { index: 0, tags: ['coffee', 'work', 'travel', 'coffee'] },
    ], [...vocabulary, 'extra']);
    expect(out[0].length).toBe(MAX_SUGGESTED_TAGS);
  });

  it('suggests nothing at all for an account with no vocabulary', () => {
    // Nothing to draw from means nothing to offer — not a free-form tag.
    expect(applyTagSuggestions(1, [{ index: 0, tags: ['coffee'] }], [])).toEqual([[]]);
  });
});
