import { DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS, CategoryGroup } from './category.model';
import en from '../../assets/i18n/en.json';
import ja from '../../assets/i18n/ja.json';
import tc from '../../assets/i18n/tc.json';

type Catalog = Record<string, string>;

const LOCALES: { name: string; categoryNames: Catalog }[] = [
  { name: 'en', categoryNames: en.categoryNames },
  { name: 'ja', categoryNames: ja.categoryNames },
  { name: 'tc', categoryNames: tc.categoryNames },
];

const ALL_GROUPS: CategoryGroup[] = [...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS];

/** Last segment of a translation key — the part CategoryService builds ids from. */
function keyName(nameKey: string): string {
  const parts = nameKey.split('.');
  return parts[parts.length - 1];
}

function allNameKeys(): string[] {
  const keys: string[] = [];
  for (const group of ALL_GROUPS) {
    keys.push(group.nameKey);
    for (const item of group.categories) {
      keys.push(item.nameKey);
    }
  }
  return keys;
}

describe('default category catalog', () => {
  it('namespaces every nameKey under categoryNames', () => {
    for (const nameKey of allNameKeys()) {
      expect(nameKey.startsWith('categoryNames.')).toBe(true, `${nameKey} is not namespaced`);
    }
  });

  it('gives every group a unique id', () => {
    const ids = ALL_GROUPS.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Ids are `${group.id}_${keyName}`, so a repeated key inside one group would
  // collide; the same key in two different groups is fine and already relied on
  // (`miscellaneous` appears under both other_expense and other_income).
  it('does not repeat a nameKey within a group', () => {
    for (const group of ALL_GROUPS) {
      const names = group.categories.map(c => keyName(c.nameKey));
      expect(new Set(names).size).toBe(names.length, `duplicate entry in group ${group.id}`);
    }
  });

  it('never collides a generated item id with a group id', () => {
    const groupIds = new Set(ALL_GROUPS.map(g => g.id));
    for (const group of ALL_GROUPS) {
      for (const item of group.categories) {
        const id = `${group.id}_${keyName(item.nameKey)}`;
        expect(groupIds.has(id)).toBe(false, `${id} collides with a group id`);
      }
    }
  });

  it('gives every entry a non-empty icon', () => {
    for (const group of ALL_GROUPS) {
      expect(group.icon.trim()).not.toBe('');
      for (const item of group.categories) {
        expect(item.icon.trim()).not.toBe('', `${item.nameKey} has no icon`);
      }
    }
  });

  describe('translations', () => {
    for (const locale of LOCALES) {
      it(`resolves every catalog nameKey in ${locale.name}`, () => {
        const missing = allNameKeys()
          .map(keyName)
          .filter(name => {
            const value = locale.categoryNames[name];
            return value === undefined || value.trim() === '';
          });
        expect(missing).toEqual([]);
      });
    }

    it('keeps the same categoryNames key set in every locale', () => {
      const [reference, ...rest] = LOCALES;
      const expected = Object.keys(reference.categoryNames).sort();
      for (const locale of rest) {
        expect(Object.keys(locale.categoryNames).sort()).toEqual(
          expected,
          `${locale.name} diverges from ${reference.name}`
        );
      }
    });

    it('carries no categoryNames key the catalog does not use', () => {
      const used = new Set(allNameKeys().map(keyName));
      const orphans = Object.keys(en.categoryNames).filter(k => !used.has(k));
      expect(orphans).toEqual([]);
    });
  });
});
