import { signal } from '@angular/core';
import en from '../../../../assets/i18n/en.json';
import ja from '../../../../assets/i18n/ja.json';
import tc from '../../../../assets/i18n/tc.json';
import { INTL_LOCALES, type SupportedLocale, translateFrom } from '../translation.service';
import { type TranslationStub, createTranslationStub } from './translation-stub';

/**
 * The three shipped catalogs, for specs that need the words a reader sees.
 *
 * Karma serves no `/assets/i18n`, so the real service never loads one in a
 * unit spec; these are the same files, imported.
 */
export const CATALOGS = { en, ja, tc } satisfies Record<SupportedLocale, object>;

/** What `TranslationService.t` is called as. */
export type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * `locale`'s catalog read as the app reads it: `translateFrom`, the service's
 * own walk, with its plural rules and its interpolation. A spec that wants
 * the words a reader sees calls this rather than walking a catalog of its own
 * (ADR 0171). A missing key comes back as the key, as it does in the app;
 * `strict` throws instead, for a spec whose keys must all exist.
 *
 * A spec that checks a key's raw leaf (a non-empty string, or a plural whose
 * every member is one) still reads the JSON itself: this picks one member of
 * a plural, and an empty leaf comes back as `''`, not as a miss.
 */
export function catalogTranslator(locale: SupportedLocale, { strict = false }: { strict?: boolean } = {}): Translator {
  const catalog = CATALOGS[locale];
  const intlLocale = () => INTL_LOCALES[locale];
  return (key, params) => {
    const text = translateFrom(catalog, key, params, intlLocale);
    // The walk answers a key it cannot resolve with the key itself.
    if (strict && text === key) {
      throw new Error(`catalogTranslator: ${locale} has no string for ${key}`);
    }
    return text;
  };
}

/**
 * A `TranslationService` stub that renders `locale`'s real words, with its
 * `currentLocale` set to match, for a spec that measures or reads the text:
 * the echo stub renders each key as one unbroken token, which never wraps and
 * is longer than any label.
 */
export function catalogTranslationStub(locale: SupportedLocale): TranslationStub {
  return createTranslationStub({ t: catalogTranslator(locale), currentLocale: signal<string>(locale) });
}
