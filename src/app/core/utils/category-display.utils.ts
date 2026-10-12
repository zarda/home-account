import { Category } from '../../models';

/**
 * A category name as a reader sees it: the stored name translated, or, for a
 * category the catalog cannot name, the transaction list's own word for one.
 *
 * Unknown rather than Other: Other is the name of a real category, the
 * catch-all, so an id the catalog lacks (a deleted category, an id written on
 * another device, a catalog not yet loaded) would read as that category, beside
 * it, with a total of its own. Shown and never stored, so it is in the reader's
 * language (ADR 0036). The parameter is named `t` so the i18n gate sees the key.
 */
export function categoryNameOrUnknown(name: string | undefined, t: (key: string) => string): string {
  return name ? t(name) : t('common.unknownCategory');
}

/**
 * A category id's name as a reader sees it, looked up in `categories`: the one
 * rule every surface that names a category by its id reads, so no two of them
 * can name the same id differently (ADR 0171).
 */
export function categoryDisplayName(
  categories: readonly Category[],
  categoryId: string,
  t: (key: string) => string,
): string {
  return categoryNameOrUnknown(categories.find(c => c.id === categoryId)?.name, t);
}
