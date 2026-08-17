import { Category } from '../../models';
import type { CategorizedImportTransaction } from '../../models';
import type { RawTransaction, CategorizedTransaction } from '../services/gemini.service';
import type { ProcessedTransaction } from '../services/ai-types';
import type { SupportedLocale } from '../services/translation.service';
import { categoryNames as enCategoryNames } from '../../../assets/i18n/en.json';
import { categoryNames as tcCategoryNames } from '../../../assets/i18n/tc.json';
import { categoryNames as jaCategoryNames } from '../../../assets/i18n/ja.json';

/** Catalog entry every unresolvable suggestion falls back to. */
export const FALLBACK_CATEGORY_ID = 'other_expense';

/**
 * Tried and failed: something was asked to categorize the row and the catalog
 * did not understand the answer. Under the 0.5 review band, so the chip asks
 * for a second look.
 */
export const UNRESOLVED_CATEGORY_CONFIDENCE = 0.3;

/**
 * Never attempted: no categorizer ran on this row at all. Below the
 * tried-and-failed grade because less is known, not more — this is the floor
 * the categorization ladder already seeds for rows nobody could answer.
 */
export const UNCATEGORIZED_CATEGORY_CONFIDENCE = 0.1;

/**
 * Category names in every locale we ship, not just the one on screen. A model
 * reading a Japanese receipt answers in Japanese however the catalog was
 * rendered, and an English-only lookup drops that answer into the fallback
 * bucket. Keyed by SupportedLocale so a fourth language cannot be added
 * without its names landing here too.
 *
 * These are static imports rather than TranslationService lookups on purpose:
 * the service holds one bundle at a time and reaching the others needs
 * HttpClient, which would drag DI into a file every AI provider imports.
 */
const SHIPPED_CATEGORY_NAMES: Record<SupportedLocale, Record<string, string>> = {
  en: enCategoryNames,
  tc: tcCategoryNames,
  ja: jaCategoryNames,
};

/** Default catalog entries store this key as their name; custom ones store whatever the user typed. */
const CATEGORY_NAME_KEY_PREFIX = 'categoryNames.';

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
      return {
        ...t,
        suggestedCategoryId: FALLBACK_CATEGORY_ID,
        confidence: UNRESOLVED_CATEGORY_CONFIDENCE,
      };
    }
    const categoryId = resolveCategoryId(match.categoryId, categories);
    const isValidId = categoryId === match.categoryId;
    return {
      ...t,
      suggestedCategoryId: categoryId,
      confidence: isValidId
        ? normalizeConfidence(match.confidence, 0.8)
        : UNRESOLVED_CATEGORY_CONFIDENCE,
    };
  });
}

/**
 * The category an extracted row is filed under for review, and what that
 * suggestion is worth.
 *
 * Both halves come from here because they answer one question and used to be
 * decided a line apart, from different inputs, in two near-duplicate import
 * seams. An unset `suggestedCategoryId` is the {@link matchCategoryName}
 * signal that nothing resolved the answer, so the row is coerced to the
 * catch-all for display — but grading it by the row's own `confidence` handed
 * the chip a number that describes something else entirely. On the on-device
 * path that number is how clearly Vision read the characters, so an answer
 * nobody understood rendered as a high-confidence "Other".
 *
 * Three cases, because "nobody answered" and "the answer meant nothing" are
 * not the same claim: a resolved category keeps the extraction's own
 * confidence, an answer that resolved to nothing earns the review grade, and
 * a row no categorizer ever looked at earns the floor.
 *
 * Deliberately total: both call sites sit inside a `try` whose `catch` falls
 * back to a fresh cloud extraction, so a throw here would silently cost a
 * second billable request. It therefore takes no catalog and performs no
 * lookup — resolution already happened upstream.
 */
export function gradeCategorySuggestion(
  row: Pick<ProcessedTransaction, 'suggestedCategoryId' | 'confidence' | 'categoryAttempted'>
): Pick<CategorizedImportTransaction, 'suggestedCategoryId' | 'categoryConfidence'> {
  if (row.suggestedCategoryId) {
    return {
      suggestedCategoryId: row.suggestedCategoryId,
      categoryConfidence: row.confidence,
    };
  }

  return {
    suggestedCategoryId: FALLBACK_CATEGORY_ID,
    categoryConfidence: row.categoryAttempted === false
      ? UNCATEGORIZED_CATEGORY_CONFIDENCE
      : UNRESOLVED_CATEGORY_CONFIDENCE,
  };
}

/** Every shipped rendering of a catalog entry's name; empty for custom names, which have no translations. */
function shippedNamesFor(name: string): string[] {
  if (!name.startsWith(CATEGORY_NAME_KEY_PREFIX)) {
    return [];
  }
  const key = name.slice(CATEGORY_NAME_KEY_PREFIX.length);
  return Object.values(SHIPPED_CATEGORY_NAMES)
    .map(names => names[key])
    .filter((translated): translated is string => !!translated);
}

export interface CategoryNameMatch {
  id: string;
  /**
   * False when nothing in the catalog matched, so `id` is only the fallback.
   * Callers need this to tell a model that deliberately answered "Other" from
   * one whose answer we failed to understand.
   */
  matched: boolean;
}

/**
 * Resolve whatever a model called a category onto a catalog ID, in the order
 * we can trust: the ID itself (the one token in the prompt that carries no
 * language), then display names in every locale we ship, then English
 * keywords as a last resort for free-text answers like "gas station".
 *
 * The name is `unknown` rather than `string` for the same reason
 * {@link resolveCategoryId} takes one: every caller is handing over a field
 * off a `JSON.parse` of a model answer, where the declared type is an
 * assertion nobody checked. A model that simply omits the field, or answers
 * a single-value question with a list, is an unmatched name — not a crash.
 */
export function matchCategoryName(
  categoryName: unknown,
  categories: Category[],
  translate: (name: string) => string
): CategoryNameMatch {
  const trimmed = typeof categoryName === 'string' ? categoryName.trim() : '';
  if (!trimmed) {
    return { id: FALLBACK_CATEGORY_ID, matched: false };
  }
  const normalizedName = trimmed.toLowerCase();

  // An empty fallback turns resolveCategoryId into a plain lookup; the second
  // pass is for models that title-case the ID they echo back.
  const byId =
    resolveCategoryId(trimmed, categories, '') ||
    categories.find(c => c.isActive && c.id.toLowerCase() === normalizedName)?.id;
  if (byId) {
    return { id: byId, matched: true };
  }

  // An empty name would swallow every input through the substring pass below.
  const namesOf = (c: Category) => [
    c.name.toLowerCase(),
    translate(c.name).toLowerCase(),
    ...shippedNamesFor(c.name).map(n => n.toLowerCase()),
  ].filter(n => n !== '');

  const exactMatch = categories.find(c => namesOf(c).includes(normalizedName));
  if (exactMatch) return { id: exactMatch.id, matched: true };

  const partialMatch = categories.find(
    c => namesOf(c).some(n => n.includes(normalizedName) || normalizedName.includes(n))
  );
  if (partialMatch) return { id: partialMatch.id, matched: true };

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
      return { id: categoryId, matched: true };
    }
  }

  return { id: FALLBACK_CATEGORY_ID, matched: false };
}

/**
 * Category-name -> catalog-ID mapper used by the receipt/PDF extraction paths.
 * Reach for {@link matchCategoryName} where an unresolved name has to be
 * handled differently from a genuine "Other".
 */
export function mapCategoryNameToId(
  categoryName: unknown,
  categories: Category[],
  translate: (name: string) => string
): string {
  return matchCategoryName(categoryName, categories, translate).id;
}
