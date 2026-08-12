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
 *
 * A leaf may be a plural object (#272): members drawn from the CLDR cardinal
 * categories, string values, English only — ja and tc have no number agreement
 * and stay plain strings. Parity is asserted on the bare leaf path, and a
 * plural object's members must be exactly its locale's cardinal categories.
 */

type Tree = Record<string, unknown>;

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const INTL_LOCALES: Record<string, string> = { en: 'en-US', ja: 'ja-JP', tc: 'zh-Hant-TW' };

/** A leaf may be a plural object: every member a CLDR category name, every value a string. */
function isPluralObject(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every(key => PLURAL_CATEGORIES.has(key)) &&
    Object.values(value).every(member => typeof member === 'string')
  );
}

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
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !isPluralObject(value)) {
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
          if (isPluralObject(value)) {
            return Object.values(value).some(member => member.trim() === '');
          }
          return typeof value !== 'string' || value.trim() === '';
        });
      expect(bad.join(', ')).toBe('', `blank or non-string values in ${name}`);
    });
  }

  // A plural object's members are exactly its locale's cardinal categories.
  // en resolves one+other; ja and tc resolve only `other`, so in those files
  // a pluralized entry is a mistake — the entry stays a plain string and the
  // path-level parity above is the contract (docs/i18n.md, ADR 0036).
  for (const { name, tree } of LOCALES) {
    it(`shapes every plural entry after ${name}'s cardinal categories`, () => {
      const expected = [...new Intl.PluralRules(INTL_LOCALES[name]).resolvedOptions().pluralCategories]
        .sort()
        .join(',');
      const bad = keysByLocale.get(name)!.filter(key => {
        const value = leafValue(tree, key);
        return isPluralObject(value) && Object.keys(value).sort().join(',') !== expected;
      });
      expect(bad.join(', ')).toBe('', `plural members out of shape in ${name}`);
    });
  }

  // Nothing else can see this. The key-set check above passes when a
  // placeholder is added to English alone, scripts/check-i18n.mjs only asks
  // whether a key resolves at all, and interpolate() renders an unknown
  // placeholder as the literal `{{goals}}` rather than throwing — so the two
  // locales nobody on the team reads quietly ship braces to their users.
  for (const { name, tree } of LOCALES.filter(l => l.name !== REFERENCE)) {
    it(`fills the same placeholders in ${name} as in ${REFERENCE}`, () => {
      const drift = reference
        .map(key => {
          const optional = OPTIONAL_PLACEHOLDERS[key] ?? [];
          const wanted = placeholders(leafValue(en, key));
          const got = placeholders(leafValue(tree, key));
          const missing = [...wanted].filter(p => !got.has(p) && !optional.includes(p));
          // No carve-out in this direction: a call site builds its params from
          // the English string, so a slot only a translation has can never be
          // filled and renders with its braces showing.
          const extra = [...got].filter(p => !wanted.has(p));
          return missing.length || extra.length
            ? `${key} (missing ${missing.join('/') || 'none'}, extra ${extra.join('/') || 'none'})`
            : '';
        })
        .filter(Boolean);

      expect(drift.join('; ')).toBe('', `placeholder drift in ${name}`);
    });
  }
});

/**
 * Placeholders a translation may leave out on purpose, with the reason.
 *
 * An allow-list rather than a looser rule: each of these is a judgement call
 * about one string, and the whole value of the check is that adding a slot to
 * English and forgetting the other two files fails loudly.
 */
const OPTIONAL_PLACEHOLDERS: Record<string, string[]> = {
  // The English ordinal suffix. Japanese and Chinese write the day as 15日 /
  // 15 號, where an appended "th" would simply be wrong.
  'settings.everyMonthOn': ['suffix'],
  'settings.everyNMonthsOn': ['suffix'],
  // The underlying error text is English whatever the locale, so ja and tc
  // report the failure rather than switching script mid-sentence.
  'import.importFailed': ['error'],
};

/** The `{{name}}` slots a value interpolates; for a plural object, the union across members. */
function placeholders(value: unknown): Set<string> {
  if (isPluralObject(value)) {
    const union = new Set<string>();
    for (const member of Object.values(value)) {
      for (const slot of placeholders(member)) union.add(slot);
    }
    return union;
  }
  if (typeof value !== 'string') return new Set();
  return new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]));
}
