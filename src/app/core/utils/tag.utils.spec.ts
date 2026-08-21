import { MAX_TAG_LENGTH, normalizeTag, normalizeTags } from './tag.utils';

describe('normalizeTag', () => {
  it('trims, lowercases and cuts at the form\'s limit', () => {
    expect(normalizeTag('  Coffee ')).toBe('coffee');
    expect(normalizeTag('x'.repeat(40)).length).toBe(MAX_TAG_LENGTH);
  });
  it('is a no-op for scripts without case', () => {
    expect(normalizeTag('コーヒー')).toBe('コーヒー');
  });
});

describe('normalizeTags', () => {
  it('drops empties and duplicates, keeping first-seen order', () => {
    expect(normalizeTags(['Work', ' ', 'work', 'coffee'])).toEqual(['work', 'coffee']);
  });
});
