import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

/**
 * TranslationService.t() returns the key itself when a lookup misses, and setLocale()
 * replaces the whole dictionary rather than layering over English. A key present in one
 * locale but not another therefore renders as raw text (`import.noTransactions`) for
 * users on the locale that lacks it — nothing throws, so only a check like this catches it.
 *
 * category.model.spec.ts asserts the same parity for the categoryNames block alone;
 * this covers every namespace in the file. Keys referenced by the source but defined in
 * no locale at all are checked separately by scripts/check-i18n.mjs, which can read
 * templates off disk.
 */

type Tree = Record<string, unknown>;

const REFERENCE = 'en';
const LOCALES: { name: string; tree: Tree }[] = [
  { name: REFERENCE, tree: en },
  { name: 'ja', tree: ja },
  { name: 'tc', tree: tc },
];

/** Dotted paths of every leaf, e.g. `import.noTransactions`. */
function leafKeys(tree: Tree, prefix = '', out: string[] = []): string[] {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      leafKeys(value as Tree, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function leafValue(tree: Tree, key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    return node !== null && typeof node === 'object'
      ? (node as Record<string, unknown>)[segment]
      : undefined;
  }, tree);
}

describe('translation files', () => {
  const keysByLocale = new Map(LOCALES.map(l => [l.name, leafKeys(l.tree).sort()]));
  const reference = keysByLocale.get(REFERENCE)!;

  it('defines at least one key', () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const { name } of LOCALES.filter(l => l.name !== REFERENCE)) {
    it(`keeps the same key set in ${name} as in ${REFERENCE}`, () => {
      const keys = keysByLocale.get(name)!;
      const present = new Set(keys);
      const expected = new Set(reference);

      const missing = reference.filter(k => !present.has(k));
      const extra = keys.filter(k => !expected.has(k));

      // Joined rather than compared as arrays so a failure names the keys instead of
      // reporting only a length mismatch.
      expect(missing.join(', ')).toBe('', `missing from ${name}, but defined in ${REFERENCE}`);
      expect(extra.join(', ')).toBe('', `defined in ${name}, but not in ${REFERENCE}`);
    });
  }

  for (const { name, tree } of LOCALES) {
    it(`gives every key a non-empty string in ${name}`, () => {
      const bad = keysByLocale
        .get(name)!
        .filter(key => {
          const value = leafValue(tree, key);
          return typeof value !== 'string' || value.trim() === '';
        });
      expect(bad.join(', ')).toBe('', `blank or non-string values in ${name}`);
    });
  }
});
