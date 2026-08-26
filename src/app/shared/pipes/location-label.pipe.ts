import { Pipe, PipeTransform, inject } from '@angular/core';
import type { TransactionLocation } from '../../models';
import { locationLabel } from '../../core/utils/location-label.utils';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Renders a transaction's location: the printed or typed place name, or the
 * country's own name when that is all the receipt gave.
 *
 * Impure and memoized for the same reason as LocaleNumberPipe: the locale is
 * not a pipe input, so a pure pipe would keep naming the country in the boot
 * language after a switch. The memo key is the location object's identity —
 * transactions are replaced rather than mutated — plus the locale.
 */
@Pipe({
  name: 'locationLabel',
  standalone: true,
  pure: false,
})
export class LocationLabelPipe implements PipeTransform {
  private localeFormat = inject(LocaleFormatService);
  private translationService = inject(TranslationService);

  private lastValue: TransactionLocation | null | undefined;
  private lastLocale: string | undefined;
  private lastResult = '';

  transform(value: TransactionLocation | null | undefined): string {
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;

    if (value === this.lastValue && locale === this.lastLocale) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastLocale = locale;
    this.lastResult = locationLabel(value, this.localeFormat.locale);
    return this.lastResult;
  }
}
