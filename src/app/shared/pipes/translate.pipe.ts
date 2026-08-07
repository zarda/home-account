import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Translates a key against the active locale.
 *
 * The pipe stays impure because translations depend on the current locale
 * and the async-loaded translation table, neither of which is a pipe
 * input — a pure pipe would never re-run on a language switch. To avoid the
 * cost of that impurity (a nested-object walk + param interpolation for
 * every one of ~440 bindings on every change-detection cycle), each pipe
 * instance memoizes its last result and only re-resolves when the key,
 * params, locale, or catalog version actually change. A binding uses a
 * fixed key, so after the first pass every later cycle is an O(1) equality
 * check.
 *
 * The catalog version (TranslationService.translationsVersion) covers the
 * load window: a view instantiated before the async catalog arrives
 * memoizes the raw key under an unchanged locale, so only the table's
 * arrival can invalidate that entry.
 */
@Pipe({
  name: 'translate',
  standalone: true,
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private translationService = inject(TranslationService);

  private lastKey: string | undefined;
  private lastParamsJson = '';
  private lastLocale: string | undefined;
  private lastVersion: number | undefined;
  private lastValue = '';

  transform(key: string, params?: Record<string, string | number>): string {
    // currentLocale and translationsVersion are signals on the real service;
    // guard the reads so a partial test mock that stubs only t() still works
    // (it simply loses those cache invalidations, which such tests never
    // exercise).
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;
    const versionSignal = this.translationService.translationsVersion;
    const version = typeof versionSignal === 'function' ? versionSignal() : undefined;
    const paramsJson = params ? JSON.stringify(params) : '';

    if (
      key === this.lastKey &&
      paramsJson === this.lastParamsJson &&
      locale === this.lastLocale &&
      version === this.lastVersion
    ) {
      return this.lastValue;
    }

    this.lastKey = key;
    this.lastParamsJson = paramsJson;
    this.lastLocale = locale;
    this.lastVersion = version;
    this.lastValue = this.translationService.t(key, params);
    return this.lastValue;
  }
}
