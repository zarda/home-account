import { Pipe, PipeTransform, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { LocaleFormatService, LocaleDateStyle } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Formats a date against the active language, replacing Angular's `date`.
 *
 * The built-in pipe reads `LOCALE_ID`, which is resolved once at bootstrap,
 * so it can never follow a language switch made in the running app. This
 * pipe reads the locale signal instead, which is why it is impure — and, for
 * the same reason as TranslatePipe, memoizes its last result so the impurity
 * costs an equality check per cycle rather than an Intl format call. The
 * locale is part of the cache key, so a switch invalidates every entry.
 */
@Pipe({
  name: 'localeDate',
  standalone: true,
  pure: false,
})
export class LocaleDatePipe implements PipeTransform {
  private localeFormat = inject(LocaleFormatService);
  private translationService = inject(TranslationService);

  private lastValue: unknown;
  private lastStyle: LocaleDateStyle | undefined;
  private lastLocale: string | undefined;
  private lastResult = '';

  transform(
    value: Date | Timestamp | string | number | null | undefined,
    style: LocaleDateStyle = 'medium',
  ): string {
    // Guarded like TranslatePipe's read, so a partial test mock that stubs
    // only the formatter still works.
    const localeSignal = this.translationService.currentLocale;
    const locale = typeof localeSignal === 'function' ? localeSignal() : undefined;

    // A Date is mutable and Timestamps are recreated on every snapshot, so
    // the cache key is the instant, not the object identity.
    const stamp = this.identityOf(value);

    if (stamp === this.lastValue && style === this.lastStyle && locale === this.lastLocale) {
      return this.lastResult;
    }

    this.lastValue = stamp;
    this.lastStyle = style;
    this.lastLocale = locale;
    this.lastResult = this.localeFormat.formatDate(value, style);
    return this.lastResult;
  }

  private identityOf(value: Date | Timestamp | string | number | null | undefined): unknown {
    if (value === null || value === undefined) return value;
    const date = (value as Timestamp)?.toDate?.() ?? (value instanceof Date ? value : null);
    return date ? date.getTime() : value;
  }
}
