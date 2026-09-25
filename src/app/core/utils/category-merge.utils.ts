import { Category, DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../models';

/**
 * The built-in categories as one flat list: each catalog group, then its
 * subcategories, expense groups before income, numbered by `order` in that one
 * run from 0.
 *
 * The ids are stored data, not presentation: transactions and budgets name
 * them, and a stored row overrides a built-in only by carrying its id. So the
 * derivation must never change: a group keeps its catalog id, and a
 * subcategory is the group id, an underscore, and the last segment of its
 * translation key.
 *
 * Rows are rebuilt on every call, so a caller can change what it is handed
 * without reaching any other caller's copy.
 */
export function defaultCategories(): Category[] {
  const categories: Category[] = [];
  let order = 0;

  const keyName = (nameKey: string): string => {
    const parts = nameKey.split('.');
    return parts[parts.length - 1];
  };

  // The list a group sits in decides its type, not the group's own `type`.
  const lists = [
    { groups: DEFAULT_EXPENSE_GROUPS, type: 'expense' },
    { groups: DEFAULT_INCOME_GROUPS, type: 'income' },
  ] as const;

  for (const { groups, type } of lists) {
    for (const group of groups) {
      // `name` holds the translation key; the display resolves it.
      categories.push({
        id: group.id,
        userId: null,
        name: group.nameKey,
        icon: group.icon,
        color: group.color,
        type,
        order: order++,
        isActive: true,
        isDefault: true
      });

      for (const item of group.categories) {
        categories.push({
          id: `${group.id}_${keyName(item.nameKey)}`,
          userId: null,
          name: item.nameKey,
          icon: item.icon,
          color: group.color,
          type,
          parentId: group.id,
          order: order++,
          isActive: true,
          isDefault: true
        });
      }
    }
  }

  return categories;
}

/**
 * The built-ins overlaid with an account's stored categories. A stored row
 * with a built-in's id replaces that built-in (an edited or soft-deleted
 * built-in stays as stored); any other stored row is added. The result is
 * sorted by `order`, and the sort is stable, so on a tie the built-in comes
 * first. Neither input is changed.
 */
export function mergeCategories(
  defaults: readonly Category[],
  stored: readonly Category[]
): Category[] {
  const storedIds = new Set(stored.map(c => c.id));
  const unshadowed = defaults.filter(d => !storedIds.has(d.id));
  return [...unshadowed, ...stored].sort((a, b) => a.order - b.order);
}
