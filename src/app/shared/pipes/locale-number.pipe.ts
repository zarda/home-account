import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Formats a plain number against the active language, replacing Angular's
 * `number`. Grouping and decimal separators differ by locale even where the
 * digits do not.
 *
 * Impure and memoized for the same reason as LocaleDatePipe: the locale is
 * not a pipe input, so a pure pipe would keep rendering the boot locale after
 * a language switch.
 *
 * Currency stays with CurrencyService.formatCurrency — an amount needs its
 * currency code and decimal rules, which this pipe has no business guessing.
 */
@Pipe({
  name: 'localeNumber',
  standalone: true,
  pure: false,
})
export class LocaleNumberPipe implements PipeTransform {
  private localeFormat = inject(LocaleFormatService);
  private translationService = inject(TranslationService);

  private lastValue: number | null | undefined;
  private lastDigits: string | undefined;
  private lastLocale: string | undefined;
  private lastResult = '';

  transform(value: number | null | undefined, digitsInfo?: string): string {
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;

    if (value === this.lastValue && digitsInfo === this.lastDigits && locale === this.lastLocale) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastDigits = digitsInfo;
    this.lastLocale = locale;
    this.lastResult = this.localeFormat.formatNumber(value, digitsInfo);
    return this.lastResult;
  }
}
