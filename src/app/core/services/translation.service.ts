import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Direction } from '@angular/cdk/bidi';
import { firstValueFrom } from 'rxjs';
import { AppDirectionality } from './app-directionality';

export type SupportedLocale = 'en' | 'tc' | 'ja';

/**
 * The member names a pluralized catalog entry may carry (CLDR cardinal
 * categories). A leaf whose keys all come from this set, with string values,
 * is a plural object rather than a namespace — scripts/check-i18n.mjs and
 * translation-keys.spec.ts apply the same rule. Only en.json carries members;
 * ja and tc have no number agreement and stay plain strings (docs/i18n.md).
 */
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Resolve a BCP 47 language tag to the catalog we would show it in, or null
 * when we ship none for it.
 *
 * Pure and exported because two very different sources are matched with the
 * same rules: the browser/OS language at boot, and the `locale` a Google
 * account carries. Null rather than the default locale is the point — a caller
 * has to be able to tell "asked for English" from "asked for something we
 * cannot serve", because only the second hands the turn to the next link of
 * the chain — see AuthService's first-sign-in language.
 */
export function mapLocaleTag(tag: string): SupportedLocale | null {
  const normalized = tag?.toLowerCase() ?? '';

  if (normalized.startsWith('zh')) {
    return 'tc';
  }
  if (normalized.startsWith('ja')) {
    return 'ja';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }

  return null;
}

export interface Language {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  /**
   * The layout direction the language is written in. Every locale shipped
   * today is left-to-right; carrying it here rather than deriving it means
   * adding a right-to-left catalog is a data change, and the direction can
   * never disagree with the language the document declares.
   */
  dir: Direction;
}

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly http = inject(HttpClient);
  private readonly directionality = inject(AppDirectionality);
  private readonly DEFAULT_LOCALE: SupportedLocale = 'en';

  readonly languages: Language[] = [
    { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
    { code: 'tc', name: 'Traditional Chinese', nativeName: '繁體中文', dir: 'ltr' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' }
  ];

  private translations = signal<Record<string, unknown>>({});
  currentLocale = signal<SupportedLocale>(this.DEFAULT_LOCALE);

  /**
   * Bumped after every successful catalog load. The locale alone can't signal
   * that the table changed — the catalog arrives async under an unchanged
   * locale (initial load, or the error fallback re-loading the default) — so
   * per-instance memos (see TranslatePipe) fold this into their cache key.
   */
  translationsVersion = signal(0);

  isLoaded = computed(() => Object.keys(this.translations()).length > 0);

  /**
   * What the browser/OS asked for at boot, or null when it named a language we
   * ship no catalog for. Not the same question as `currentLocale`, which has
   * already collapsed "undetectable" into the 'en' default — a first sign-in
   * needs the distinction to decide whether the Google account's language gets
   * a turn. A plain signal would invite writes from elsewhere; this is set once
   * by init() and read-only to everyone else.
   */
  private browserLocale: SupportedLocale | null = null;
  get detectedBrowserLocale(): SupportedLocale | null {
    return this.browserLocale;
  }

  currentLanguage = computed(() =>
    this.languages.find(l => l.code === this.currentLocale()) || this.languages[0]
  );

  async init(): Promise<void> {
    this.browserLocale = this.detectBrowserLocale();
    const locale = this.browserLocale || this.DEFAULT_LOCALE;
    await this.setLocale(locale);
  }

  async setLocale(locale: SupportedLocale): Promise<void> {
    try {
      const translations = await firstValueFrom(
        this.http.get<Record<string, unknown>>(`/assets/i18n/${locale}.json`)
      );
      this.translations.set(translations);
      this.translationsVersion.update(v => v + 1);
      this.currentLocale.set(locale);
      document.documentElement.lang = locale === 'tc' ? 'zh-Hant' : locale;
      // Beside the lang write on purpose: a catalog that failed to load never
      // gets here, so the document can never declare one locale's language
      // with another's direction. The service — not the attribute — is what
      // already-constructed Material and CDK components follow.
      this.directionality.setDirection(this.currentLanguage().dir);
    } catch (error) {
      console.error(`Failed to load translations for ${locale}:`, error);
      if (locale !== this.DEFAULT_LOCALE) {
        await this.setLocale(this.DEFAULT_LOCALE);
      }
    }
  }

  /**
   * Sync locale from database preference.
   * Called by AuthService when user data loads to ensure database is source of truth.
   */
  async syncFromDatabase(locale: SupportedLocale): Promise<void> {
    if (this.isValidLocale(locale) && locale !== this.currentLocale()) {
      await this.setLocale(locale);
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    const keys = key.split('.');
    let value: unknown = this.translations();

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }

    if (typeof value !== 'string') {
      const selected = this.selectPluralMember(value, params?.['count']);
      if (selected === undefined) {
        return key;
      }
      value = selected;
    }

    if (params) {
      return this.interpolate(value as string, params);
    }

    return value as string;
  }

  /**
   * Resolves a plural object to one member via Intl.PluralRules for the
   * active locale, falling back to `other` when the selected category has no
   * member. Anything that is not plural-shaped — or a plural entry reached
   * without a numeric `count` — resolves to nothing, and t() returns the key,
   * as it always has for non-string leaves.
   */
  private selectPluralMember(value: unknown, count: unknown): string | undefined {
    if (typeof count !== 'number' || value === null || typeof value !== 'object') {
      return undefined;
    }
    const members = value as Record<string, unknown>;
    const names = Object.keys(members);
    if (names.length === 0 || !names.every(name => PLURAL_CATEGORIES.has(name))) {
      return undefined;
    }
    const category = new Intl.PluralRules(this.getIntlLocale()).select(count);
    const selected = members[category] ?? members['other'];
    return typeof selected === 'string' ? selected : undefined;
  }

  private interpolate(text: string, params: Record<string, string | number>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return params[key]?.toString() ?? `{{${key}}}`;
    });
  }

  private detectBrowserLocale(): SupportedLocale | null {
    return mapLocaleTag(navigator.language);
  }

  private isValidLocale(locale: string): boolean {
    return this.languages.some(l => l.code === locale);
  }

  /**
   * Get locale code compatible with Intl and Angular formatters.
   * Maps our locale codes to standard BCP 47 codes.
   */
  getIntlLocale(): string {
    const locale = this.currentLocale();
    const localeMap: Record<SupportedLocale, string> = {
      'en': 'en-US',
      'tc': 'zh-Hant-TW',
      'ja': 'ja-JP'
    };
    return localeMap[locale] || 'en-US';
  }
}
