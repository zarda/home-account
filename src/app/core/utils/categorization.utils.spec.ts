import {
  normalizeConfidence,
  resolveCategoryId,
  buildCategoryPromptCatalog,
  applyCategorizations,
  gradeCategorySuggestion,
  mapCategoryNameToId,
  matchCategoryName,
  FALLBACK_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_CONFIDENCE,
  UNRESOLVED_CATEGORY_CONFIDENCE,
} from './categorization.utils';
import { Category, DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../models';
import { createCategory } from '../services/testing/test-data';
import type { RawTransaction } from '../services/gemini.service';

describe('categorization.utils', () => {
  const identity = (name: string) => name;

  const categories: Category[] = [
    createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
    createCategory({ id: 'food_groceries', name: 'Groceries', type: 'expense', parentId: 'food' }),
    createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    createCategory({ id: 'dormant', name: 'Dormant', type: 'expense', isActive: false }),
  ];

  // Default catalog entries as CategoryService writes them: the name is the
  // i18n key, so the display name depends entirely on the reader's locale.
  const defaultCategories: Category[] = [
    createCategory({ id: 'food', name: 'categoryNames.food', type: 'expense' }),
    createCategory({
      id: 'food_groceries', name: 'categoryNames.groceries', type: 'expense', parentId: 'food',
    }),
    createCategory({ id: 'transport', name: 'categoryNames.transport', type: 'expense' }),
    createCategory({ id: 'other_expense', name: 'categoryNames.otherExpense', type: 'expense' }),
  ];
  // The active locale is not loaded, so t() echoes the key back.
  const untranslated = (name: string) => name;

  /**
   * The built-in catalog with the ids CategoryService actually generates:
   * a parent under the group id, a child under `${group}_${key tail}`. Built
   * from the shipped groups rather than written out, so a renamed or dropped
   * default is visible here instead of being asserted against a fixture that
   * agrees with the test rather than with the app.
   */
  const defaultCatalog = (): Category[] =>
    [...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].flatMap(group => [
      createCategory({ id: group.id, name: group.nameKey }),
      ...group.categories.map(item =>
        createCategory({
          id: `${group.id}_${item.nameKey.split('.').pop()}`,
          name: item.nameKey,
          parentId: group.id,
        })
      ),
    ]);

  describe('normalizeConfidence', () => {
    it('clamps values into [0, 1]', () => {
      expect(normalizeConfidence(1.7, 0.5)).toBe(1);
      expect(normalizeConfidence(-0.2, 0.5)).toBe(0);
      expect(normalizeConfidence(0.42, 0.5)).toBe(0.42);
    });

    it('accepts numeric strings', () => {
      expect(normalizeConfidence('0.9', 0.5)).toBe(0.9);
    });

    it('falls back for non-numeric input', () => {
      expect(normalizeConfidence('high', 0.5)).toBe(0.5);
      expect(normalizeConfidence(undefined, 0.5)).toBe(0.5);
      expect(normalizeConfidence(NaN, 0.5)).toBe(0.5);
      expect(normalizeConfidence('', 0.5)).toBe(0.5);
      expect(normalizeConfidence({}, 0.5)).toBe(0.5);
    });
  });

  describe('resolveCategoryId', () => {
    it('accepts a valid parent ID', () => {
      expect(resolveCategoryId('food', categories)).toBe('food');
    });

    it('accepts a valid child ID', () => {
      expect(resolveCategoryId('food_groceries', categories)).toBe('food_groceries');
    });

    it('rejects an ID missing from the catalog', () => {
      expect(resolveCategoryId('dining_out', categories)).toBe(FALLBACK_CATEGORY_ID);
    });

    it('rejects an inactive category', () => {
      expect(resolveCategoryId('dormant', categories)).toBe(FALLBACK_CATEGORY_ID);
    });

    it('rejects non-string input', () => {
      expect(resolveCategoryId(undefined, categories)).toBe(FALLBACK_CATEGORY_ID);
      expect(resolveCategoryId(42, categories)).toBe(FALLBACK_CATEGORY_ID);
    });

    it('honors a custom fallback', () => {
      expect(resolveCategoryId('nope', categories, 'transport')).toBe('transport');
    });
  });

  describe('buildCategoryPromptCatalog', () => {
    it('renders parents as id: Name and children as id: Parent / Child', () => {
      const catalog = buildCategoryPromptCatalog(categories, identity);
      const lines = catalog.split('\n');
      expect(lines).toContain('food: Food & Drinks');
      expect(lines).toContain('food_groceries: Food & Drinks / Groceries');
      expect(lines).toContain('transport: Transport');
    });

    it('lists children directly under their parent', () => {
      const lines = buildCategoryPromptCatalog(categories, identity).split('\n');
      expect(lines.indexOf('food_groceries: Food & Drinks / Groceries'))
        .toBe(lines.indexOf('food: Food & Drinks') + 1);
    });

    it('excludes inactive categories', () => {
      expect(buildCategoryPromptCatalog(categories, identity)).not.toContain('dormant');
    });

    it('translates names', () => {
      const catalog = buildCategoryPromptCatalog(
        [createCategory({ id: 'food', name: 'categoryNames.food', type: 'expense' })],
        () => 'Translated'
      );
      expect(catalog).toBe('food: Translated');
    });
  });

  describe('applyCategorizations', () => {
    const txns: RawTransaction[] = [
      { description: 'Milk', amount: 3, date: new Date() },
      { description: 'Bus', amount: 2, date: new Date() },
    ];

    it('applies a valid match with its model confidence', () => {
      const result = applyCategorizations(
        txns,
        [{ index: 0, categoryId: 'food_groceries', confidence: 0.65 }],
        categories
      );
      expect(result[0].suggestedCategoryId).toBe('food_groceries');
      expect(result[0].confidence).toBe(0.65);
    });

    it('defaults a valid match without usable confidence to 0.8', () => {
      const result = applyCategorizations(
        txns,
        [
          { index: 0, categoryId: 'food' },
          { index: 1, categoryId: 'transport', confidence: 'very sure' },
        ],
        categories
      );
      expect(result[0].confidence).toBe(0.8);
      expect(result[1].confidence).toBe(0.8);
    });

    it('marks an unmatched index as fallback with 0.3', () => {
      const result = applyCategorizations(
        txns,
        [{ index: 0, categoryId: 'food' }],
        categories
      );
      expect(result[1].suggestedCategoryId).toBe(FALLBACK_CATEGORY_ID);
      expect(result[1].confidence).toBe(0.3);
    });

    it('coerces an invalid category ID to fallback with 0.3', () => {
      const result = applyCategorizations(
        txns,
        [{ index: 0, categoryId: 'made_up', confidence: 0.99 }],
        categories
      );
      expect(result[0].suggestedCategoryId).toBe(FALLBACK_CATEGORY_ID);
      expect(result[0].confidence).toBe(0.3);
    });

    it('treats a non-array payload as no matches', () => {
      const result = applyCategorizations(txns, { oops: true }, categories);
      expect(result.every(t => t.suggestedCategoryId === FALLBACK_CATEGORY_ID)).toBeTrue();
      expect(result.every(t => t.confidence === 0.3)).toBeTrue();
    });

    it('ignores malformed entries in the payload', () => {
      const result = applyCategorizations(
        txns,
        [null, 'junk', { index: 1, categoryId: 'transport', confidence: 0.7 }],
        categories
      );
      expect(result[0].suggestedCategoryId).toBe(FALLBACK_CATEGORY_ID);
      expect(result[1].suggestedCategoryId).toBe('transport');
      expect(result[1].confidence).toBe(0.7);
    });
  });

  /**
   * The same grading ladder as applyCategorizations, entered from the other
   * door: the import seams, where an extracted row's category is coerced to
   * the catch-all for display. The distinction this exists to keep is between
   * an answer that resolved to nothing and a row nobody ever categorized —
   * the regex reader produces the second on every scan it handles, and
   * grading it as the first would flag every one of those rows for review.
   */
  describe('gradeCategorySuggestion', () => {
    it('keeps the extraction confidence when a category resolved', () => {
      expect(gradeCategorySuggestion({
        suggestedCategoryId: 'food_groceries',
        confidence: 0.92,
      })).toEqual({ suggestedCategoryId: 'food_groceries', categoryConfidence: 0.92 });
    });

    it('grades an answer that resolved to nothing for review', () => {
      const graded = gradeCategorySuggestion({ suggestedCategoryId: undefined, confidence: 0.9 });

      expect(graded.suggestedCategoryId).toBe(FALLBACK_CATEGORY_ID);
      expect(graded.categoryConfidence).toBe(UNRESOLVED_CATEGORY_CONFIDENCE);
      // The band the review table reads; Vision's ~0.9 would have shown green.
      expect(graded.categoryConfidence).toBeLessThan(0.5);
    });

    it('grades a row nothing attempted to categorize at the floor', () => {
      const graded = gradeCategorySuggestion({
        suggestedCategoryId: undefined,
        confidence: 0.9,
        categoryAttempted: false,
      });

      expect(graded.suggestedCategoryId).toBe(FALLBACK_CATEGORY_ID);
      expect(graded.categoryConfidence).toBe(UNCATEGORIZED_CATEGORY_CONFIDENCE);
      expect(graded.categoryConfidence).toBeLessThan(UNRESOLVED_CATEGORY_CONFIDENCE);
    });

    it('treats an empty id as unresolved, exactly as the coercion it replaced did', () => {
      expect(gradeCategorySuggestion({ suggestedCategoryId: '', confidence: 0.9 }))
        .toEqual({
          suggestedCategoryId: FALLBACK_CATEGORY_ID,
          categoryConfidence: UNRESOLVED_CATEGORY_CONFIDENCE,
        });
    });

    it('grades a resolved category on a never-attempted row by the id it carries', () => {
      // categoryAttempted only decides how an ABSENT id is read; an id that is
      // present was resolved by someone and keeps its own number.
      expect(gradeCategorySuggestion({
        suggestedCategoryId: 'transport',
        confidence: 0.64,
        categoryAttempted: false,
      })).toEqual({ suggestedCategoryId: 'transport', categoryConfidence: 0.64 });
    });
  });

  describe('mapCategoryNameToId', () => {
    it('takes a catalog ID as-is, whatever language the rest of the answer is in', () => {
      expect(mapCategoryNameToId('food_groceries', defaultCategories, untranslated))
        .toBe('food_groceries');
    });

    it('ignores case in a catalog ID', () => {
      expect(mapCategoryNameToId('Food_Groceries', defaultCategories, untranslated))
        .toBe('food_groceries');
    });

    it('prefers a catalog ID over a keyword hiding inside it', () => {
      const catalog = [
        createCategory({ id: 'shopping_electronics', name: 'categoryNames.electronics' }),
      ];
      expect(mapCategoryNameToId('shopping_electronics', catalog, untranslated))
        .toBe('shopping_electronics');
    });

    it('ignores an inactive catalog ID', () => {
      expect(mapCategoryNameToId('retired_id', [
        createCategory({ id: 'retired_id', name: 'Zzz', isActive: false }),
      ], identity)).toBe(FALLBACK_CATEGORY_ID);
    });

    it('falls back for an absent name', () => {
      expect(mapCategoryNameToId(undefined, categories, identity)).toBe(FALLBACK_CATEGORY_ID);
    });

    it('matches a name in a locale that is not the active one', () => {
      expect(mapCategoryNameToId('食料品', defaultCategories, untranslated)).toBe('food_groceries');
      expect(mapCategoryNameToId('雜貨', defaultCategories, untranslated)).toBe('food_groceries');
      expect(mapCategoryNameToId('交通', defaultCategories, untranslated)).toBe('transport');
    });

    it('matches an exact stored or translated name', () => {
      expect(mapCategoryNameToId('Groceries', categories, identity)).toBe('food_groceries');
    });

    it('matches a partial name', () => {
      expect(mapCategoryNameToId('Transp', categories, identity)).toBe('transport');
    });

    it('maps keywords to catalog IDs that actually exist by default', () => {
      // The map is compiled in and names ids by hand, so the guard is that
      // each one is a real default. Asserted against ids built the way
      // CategoryService builds them rather than against an empty catalog,
      // which could only ever restate the map back to itself.
      const catalog = defaultCatalog();
      const has = (id: string) => catalog.some(c => c.id === id);
      expect(has('food_coffeeAndDrinks')).toBeTrue();
      expect(has('transport_fuelAndGas')).toBeTrue();
      expect(has('health_pharmacyAndMedicine')).toBeTrue();
      expect(has('food_groceries')).toBeTrue();

      expect(mapCategoryNameToId('some coffee shop', catalog, identity)).toBe('food_coffeeAndDrinks');
      expect(mapCategoryNameToId('gas station', catalog, identity)).toBe('transport_fuelAndGas');
      expect(mapCategoryNameToId('pharmacy run', catalog, identity)).toBe('health_pharmacyAndMedicine');
      expect(mapCategoryNameToId('grocery store', catalog, identity)).toBe('food_groceries');
    });

    it('falls back to other_expense when nothing matches', () => {
      expect(mapCategoryNameToId('zzz unmatched', [], identity)).toBe(FALLBACK_CATEGORY_ID);
    });
  });

  describe('matchCategoryName', () => {
    it('separates a deliberate Other from an answer nothing matched', () => {
      const deliberate = matchCategoryName('その他', defaultCategories, untranslated);
      expect(deliberate).toEqual({ id: 'other_expense', matched: true });

      const unresolved = matchCategoryName('zzz unmatched', defaultCategories, untranslated);
      expect(unresolved).toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
    });

    it('reports an empty answer as unmatched', () => {
      expect(matchCategoryName('   ', categories, identity))
        .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
    });

    it('reports an absent or non-string answer as unmatched', () => {
      // Every caller reads this off a JSON.parse of a model answer, so an
      // omitted field arrives as undefined and a model answering a
      // single-value question with a list arrives as an array. Both are
      // names nothing matched, not grounds for a TypeError.
      expect(matchCategoryName(undefined, categories, identity))
        .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
      expect(matchCategoryName(null, categories, identity))
        .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
      expect(matchCategoryName(['Groceries'], categories, identity))
        .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
    });

    it('counts an ID, a name and a keyword all as matched', () => {
      expect(matchCategoryName('transport', defaultCategories, untranslated).matched).toBeTrue();
      expect(matchCategoryName('Groceries', categories, identity).matched).toBeTrue();
      expect(matchCategoryName('gas station', [
        createCategory({ id: 'transport_fuelAndGas', name: 'Fuel & Gas' }),
      ], identity)).toEqual({ id: 'transport_fuelAndGas', matched: true });
    });

    /**
     * A deleted built-in stays in the merged catalog as a stored override with
     * isActive false, and the prompt never offers it — so a name that reaches
     * the resolver matching one came from the model's own knowledge. Filing a
     * receipt under it would resurrect a category the user removed, and the
     * review chip reads the unfiltered catalog, so it would render under its
     * real name and look like an ordinary suggestion.
     */
    describe('a category the user deleted', () => {
      const withDeletedRestaurants = [
        createCategory({ id: 'food_groceries', name: 'categoryNames.groceries' }),
        createCategory({ id: 'food_restaurants', name: 'categoryNames.restaurants', isActive: false }),
      ];

      it('does not resolve by its display name', () => {
        expect(matchCategoryName('Restaurants', withDeletedRestaurants, untranslated))
          .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
      });

      it('does not resolve by a display name in another shipped locale', () => {
        // The locale pass is the reason the id check alone was not enough: it
        // exists to catch an answer given in the receipt's language.
        expect(matchCategoryName('レストラン', withDeletedRestaurants, untranslated).matched)
          .toBeFalse();
      });

      it('does not resolve through a partial name match', () => {
        expect(matchCategoryName('Restaurants and bars', withDeletedRestaurants, untranslated))
          .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
      });

      it('does not resolve through the keyword map', () => {
        expect(matchCategoryName('a restaurant', withDeletedRestaurants, untranslated))
          .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
      });

      it('still resolves the entries the account kept', () => {
        expect(matchCategoryName('Groceries', withDeletedRestaurants, untranslated))
          .toEqual({ id: 'food_groceries', matched: true });
      });
    });

    it('does not answer with a keyword id the catalog does not carry', () => {
      // The map is compiled in and names defaults an account need not have.
      // An id nothing can render is not a resolution; the chip shows
      // "Unknown" for it, and the row is not flagged for review.
      expect(matchCategoryName('gas station', defaultCategories, untranslated))
        .toEqual({ id: FALLBACK_CATEGORY_ID, matched: false });
    });
  });
});
