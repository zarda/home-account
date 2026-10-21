import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyService } from '../../core/services/currency.service';
import { TranslationService } from '../../core/services/translation.service';
import { snapDisplayZero } from '../../core/utils/money-display.utils';

/**
 * Formats an amount in its currency against the active language, replacing
 * Angular's `currency`. The output is CurrencyService.formatCurrency's: the
 * account's language for the symbol and separators, and the currency's own
 * decimals (a yen amount has none). A figure that rounds to zero at those
 * decimals reads unsigned (snapDisplayZero): a balance of 12.6 - (4.2 + 8.4)
 * is -1.78e-15, and Intl would print it "-$0.00".
 *
 * Impure and memoized for the same reason as LocaleNumberPipe: the locale is
 * not a pipe input, so a pure pipe would keep rendering the boot locale after
 * a language switch.
 */
@Pipe({
  name: 'localeCurrency',
  standalone: true,
  pure: false,
})
export class LocaleCurrencyPipe implements PipeTransform {
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  private lastValue: number | null | undefined;
  private lastCode: string | undefined;
  private lastLocale: string | undefined;
  private lastResult = '';

  transform(value: number | null | undefined, currencyCode: string): string {
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;

    if (value === this.lastValue && currencyCode === this.lastCode && locale === this.lastLocale) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastCode = currencyCode;
    this.lastLocale = locale;
    this.lastResult =
      value == null
        ? ''
        : this.currencyService.formatCurrency(snapDisplayZero(value, currencyCode), currencyCode);
    return this.lastResult;
  }
}
