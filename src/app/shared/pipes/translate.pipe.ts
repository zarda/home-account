import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Translates a key against the active locale.
 *
 * The pipe stays impure because translations depend on the current locale
 * (and the async-loaded translation table), neither of which is a pipe
 * input — a pure pipe would never re-run on a language switch. To avoid the
 * cost of that impurity (a nested-object walk + param interpolation for
 * every one of ~440 bindings on every change-detection cycle), each pipe
 * instance memoizes its last result and only re-resolves when the key,
 * params, or locale actually change. A binding uses a fixed key, so after
 * the first pass every later cycle is an O(1) equality check.
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
  private lastValue = '';

  transform(key: string, params?: Record<string, string | number>): string {
    // currentLocale is a signal on the real service; guard the read so a
    // partial test mock that stubs only t() still works (it simply loses
    // locale-based cache invalidation, which those tests never exercise).
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;
    const paramsJson = params ? JSON.stringify(params) : '';

    if (key === this.lastKey && paramsJson === this.lastParamsJson && locale === this.lastLocale) {
      return this.lastValue;
    }

    this.lastKey = key;
    this.lastParamsJson = paramsJson;
    this.lastLocale = locale;
    this.lastValue = this.translationService.t(key, params);
    return this.lastValue;
  }
}
