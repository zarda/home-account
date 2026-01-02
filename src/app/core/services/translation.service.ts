import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type SupportedLocale = 'en' | 'tc' | 'ja';

export interface Language {
  code: SupportedLocale;
  name: string;
  nativeName: string;
}

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly http = inject(HttpClient);
  private readonly DEFAULT_LOCALE: SupportedLocale = 'en';

  readonly languages: Language[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'tc', name: 'Traditional Chinese', nativeName: '繁體中文' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' }
  ];

  private translations = signal<Record<string, unknown>>({});
  currentLocale = signal<SupportedLocale>(this.DEFAULT_LOCALE);

  isLoaded = computed(() => Object.keys(this.translations()).length > 0);

  currentLanguage = computed(() =>
    this.languages.find(l => l.code === this.currentLocale()) || this.languages[0]
  );

  async init(): Promise<void> {
    const browserLocale = this.detectBrowserLocale();
    const locale = browserLocale || this.DEFAULT_LOCALE;
    await this.setLocale(locale);
  }

  async setLocale(locale: SupportedLocale): Promise<void> {
    try {
      const translations = await firstValueFrom(
        this.http.get<Record<string, unknown>>(`/assets/i18n/${locale}.json`)
      );
      this.translations.set(translations);
      this.currentLocale.set(locale);
      document.documentElement.lang = locale === 'tc' ? 'zh-Hant' : locale;
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
      return key;
    }

    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  private interpolate(text: string, params: Record<string, string | number>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return params[key]?.toString() ?? `{{${key}}}`;
    });
  }

  private detectBrowserLocale(): SupportedLocale | null {
    const browserLang = navigator.language.toLowerCase();

    if (browserLang.startsWith('zh')) {
      return 'tc';
    }
    if (browserLang.startsWith('ja')) {
      return 'ja';
    }
    if (browserLang.startsWith('en')) {
      return 'en';
    }

    return null;
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
