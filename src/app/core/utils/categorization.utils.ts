import { Category } from '../../models';
import type { RawTransaction, CategorizedTransaction } from '../services/gemini.service';

/** Catalog entry every unresolvable suggestion falls back to. */
export const FALLBACK_CATEGORY_ID = 'other_expense';

/**
 * Clamp a model-reported confidence to [0, 1]. Accepts numeric strings;
 * anything non-finite falls back to the given default.
 */
export function normalizeConfidence(value: unknown, fallback: number): number {
  const num =
    typeof value === 'number' ? value :
    typeof value === 'string' && value.trim() !== '' ? Number(value) :
    NaN;
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, num));
}

/**
 * Resolve a model-suggested category ID against the live catalog.
 * Only active catalog entries are valid targets; anything else lands on
 * the fallback so the UI never renders an unknown category.
 */
export function resolveCategoryId(
  suggestedId: unknown,
  categories: Category[],
  fallbackId: string = FALLBACK_CATEGORY_ID
): string {
  if (typeof suggestedId !== 'string' || !suggestedId) {
    return fallbackId;
  }
  const match = categories.find(c => c.id === suggestedId && c.isActive);
  return match?.id ?? fallbackId;
}

/**
 * Render the category catalog for a categorization prompt. Active parents
 * appear as `id: Name`, their active children as `id: Parent / Child` so the
 * model can pick the most specific entry without extra prose.
 */
export function buildCategoryPromptCatalog(
  categories: Category[],
  translate: (name: string) => string
): string {
  const active = categories.filter(c => c.isActive);
  const lines: string[] = [];
  for (const parent of active.filter(c => !c.parentId)) {
    lines.push(`${parent.id}: ${translate(parent.name)}`);
    for (const child of active.filter(c => c.parentId === parent.id)) {
      lines.push(`${child.id}: ${translate(parent.name)} / ${translate(child.name)}`);
    }
  }
  return lines.join('\n');
}

interface CategorizationEntry {
  index?: unknown;
  categoryId?: unknown;
  confidence?: unknown;
}

/**
 * Map a parsed batch-categorization response onto the input transactions.
 *
 * Confidence contract (downstream: >=0.8 shows the high chip, <0.5 counts
 * as "needs review"):
 * - no entry for an index -> 0.3
 * - entry with an ID not in the active catalog -> fallback category at 0.3
 * - valid ID with a numeric confidence -> that value clamped to [0, 1]
 * - valid ID without a usable confidence -> 0.8
 */
export function applyCategorizations(
  transactions: RawTransaction[],
  parsed: unknown,
  categories: Category[]
): CategorizedTransaction[] {
  const entries: CategorizationEntry[] = Array.isArray(parsed)
    ? parsed.filter((e): e is CategorizationEntry => !!e && typeof e === 'object')
    : [];

  return transactions.map((t, i) => {
    const match = entries.find(e => e.index === i);
    if (!match) {
      return { ...t, suggestedCategoryId: FALLBACK_CATEGORY_ID, confidence: 0.3 };
    }
    const categoryId = resolveCategoryId(match.categoryId, categories);
    const isValidId = categoryId === match.categoryId;
    return {
      ...t,
      suggestedCategoryId: categoryId,
      confidence: isValidId ? normalizeConfidence(match.confidence, 0.8) : 0.3,
    };
  });
}

/**
 * Fuzzy category-name -> catalog-ID mapper used by the receipt/PDF
 * extraction paths. Matches against both the stored name (possibly an i18n
 * key) and its translation, then falls back to common English keywords.
 */
export function mapCategoryNameToId(
  categoryName: string,
  categories: Category[],
  translate: (name: string) => string
): string {
  const normalizedName = categoryName.toLowerCase().trim();

  const namesOf = (c: Category) => [
    c.name.toLowerCase(),
    translate(c.name).toLowerCase(),
  ];

  const exactMatch = categories.find(c => namesOf(c).includes(normalizedName));
  if (exactMatch) return exactMatch.id;

  const partialMatch = categories.find(
    c => namesOf(c).some(n => n.includes(normalizedName) || normalizedName.includes(n))
  );
  if (partialMatch) return partialMatch.id;

  const keywordMap: Record<string, string> = {
    restaurant: 'food_restaurants',
    grocery: 'food_groceries',
    coffee: 'food_coffeeAndDrinks',
    food: 'food',
    transport: 'transport',
    gas: 'transport_fuelAndGas',
    shopping: 'shopping',
    pharmacy: 'health_pharmacyAndMedicine',
    health: 'health',
  };

  for (const [keyword, categoryId] of Object.entries(keywordMap)) {
    if (normalizedName.includes(keyword)) {
      return categoryId;
    }
  }

  return FALLBACK_CATEGORY_ID;
}
