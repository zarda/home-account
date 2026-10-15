import { categoryDisplayName, categoryNameOrUnknown } from './category-display.utils';
import { createCategory } from '../services/testing/test-data';

describe('category display name', () => {
  // Marks what went through the translator, so a raw name or a raw key that
  // skipped it cannot pass for a translated one.
  const t = (key: string) => `t(${key})`;

  const categories = [
    createCategory({ id: 'food', name: 'categoryNames.food' }),
    createCategory({ id: 'nameless', name: '' }),
  ];

  it('names a category the catalog holds by its translated name', () => {
    expect(categoryDisplayName(categories, 'food', t)).toBe('t(categoryNames.food)');
  });

  // A deleted category, an id written on another device, a catalog that has
  // not loaded: the reader sees the transaction list's own word for it, which
  // no real category is called, so it cannot pass for the catch-all.
  it('names an id the catalog does not hold as unknown', () => {
    expect(categoryDisplayName(categories, 'deleted-custom', t)).toBe('t(common.unknownCategory)');
  });

  it('names a category that has no name as unknown', () => {
    expect(categoryDisplayName(categories, 'nameless', t)).toBe('t(common.unknownCategory)');
  });

  it('reads a name, or its absence, the same way when the caller already holds it', () => {
    expect(categoryNameOrUnknown('categoryNames.food', t)).toBe('t(categoryNames.food)');
    expect(categoryNameOrUnknown(undefined, t)).toBe('t(common.unknownCategory)');
  });
});
