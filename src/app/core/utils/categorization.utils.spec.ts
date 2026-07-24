import {
  normalizeConfidence,
  resolveCategoryId,
  buildCategoryPromptCatalog,
  applyCategorizations,
  mapCategoryNameToId,
  FALLBACK_CATEGORY_ID,
} from './categorization.utils';
import { Category } from '../../models';
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

  describe('mapCategoryNameToId', () => {
    it('matches an exact stored or translated name', () => {
      expect(mapCategoryNameToId('Groceries', categories, identity)).toBe('food_groceries');
    });

    it('matches a partial name', () => {
      expect(mapCategoryNameToId('Transp', categories, identity)).toBe('transport');
    });

    it('maps keywords to catalog IDs that actually exist by default', () => {
      expect(mapCategoryNameToId('some coffee shop', [], identity)).toBe('food_coffeeAndDrinks');
      expect(mapCategoryNameToId('gas station', [], identity)).toBe('transport_fuelAndGas');
      expect(mapCategoryNameToId('pharmacy run', [], identity)).toBe('health_pharmacyAndMedicine');
      expect(mapCategoryNameToId('grocery store', [], identity)).toBe('food_groceries');
    });

    it('falls back to other_expense when nothing matches', () => {
      expect(mapCategoryNameToId('zzz unmatched', [], identity)).toBe(FALLBACK_CATEGORY_ID);
    });
  });
});
