import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { TranslationService } from './translation.service';

/**
 * The named date shapes the app renders. Deliberately a small closed set
 * rather than Angular's pattern strings: a pattern like `MMM d, yyyy` hard-
 * codes English field order and an English separator, which is the defect
 * this service exists to remove. A name lets Intl order the fields the way
 * the locale does — 2026年8月19日 in ja, Aug 19, 2026 in en.
 */
export type LocaleDateStyle = 'short' | 'medium' | 'long';

const DATE_STYLES: Record<LocaleDateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
};

/**
 * Angular's digitsInfo, `{minInt}.{minFrac}-{maxFrac}` — kept as the number
 * vocabulary because every call site already speaks it and the meaning is
 * exact. Only the formatting moves to the active locale.
 */
const DIGITS_INFO = /^(\d+)?\.(\d+)-(\d+)$/;

/** Used when a partial test mock supplies no locale resolver. */
const DEFAULT_INTL_LOCALE = 'en-US';

/**
 * Every user-facing date and number is formatted here, against the language
 * the user chose rather than the browser's.
 *
 * Before this existed the app formatted three different ways: Angular's
 * `date`/`number` pipes with no LOCALE_ID provided (always en-US), bare
 * `toLocaleDateString()` calls (the browser's locale, not the app's), and a
 * handful of sites that already passed `getIntlLocale()`. The same screen
 * could show two conventions at once. See docs/locale-formatting.md.
 *
 * Formatters are memoized per locale and option set. Constructing an
 * `Intl.DateTimeFormat` is expensive relative to formatting with one, and
 * these are reached from impure pipes that run on every change-detection
 * cycle; a fresh formatter per binding per cycle is the cost this avoids.
 *
 * Machine-facing formatting deliberately does NOT come through here — the
 * currency-symbol table `receipt-text-parser` matches OCR text against, and
 * the receipt item lines that are persisted onto a transaction note. Both
 * must stay stable regardless of the UI language.
 */
@Injectable({ providedIn: 'root' })
export class LocaleFormatService {
  private translationService = inject(TranslationService);

  private dateFormatters = new Map<string, Intl.DateTimeFormat>();
  private numberFormatters = new Map<string, Intl.NumberFormat>();

  /**
   * The BCP 47 tag the active language maps to.
   *
   * Guarded the way TranslatePipe guards its signal reads, and for the same
   * reason: plenty of specs stub TranslationService with `t()` alone, and a
   * formatter reached through a shared template should not be what makes
   * them fail. Such a mock simply formats in the default locale.
   */
  get locale(): string {
    const resolve = this.translationService.getIntlLocale;
    return typeof resolve === 'function'
      ? resolve.call(this.translationService)
      : DEFAULT_INTL_LOCALE;
  }

  /**
   * A date in the active locale's conventions.
   *
   * Accepts what the app actually holds: a `Date`, a Firestore `Timestamp`,
   * or a value one of those round-tripped through. An unparseable or absent
   * value formats as the empty string rather than "Invalid Date" — these are
   * bindings, and a template should not be the thing that reports bad data.
   */
  formatDate(value: Date | Timestamp | string | number | null | undefined,
             style: LocaleDateStyle = 'medium'): string {
    const date = this.toDate(value);
    if (!date) return '';
    return this.dateFormatter(style).format(date);
  }

  /**
   * A number in the active locale's grouping and decimal conventions.
   *
   * `digitsInfo` is Angular's, so `'1.0-2'` still means "at least one integer
   * digit, zero to two fraction digits". A malformed string is ignored rather
   * than thrown on, matching how the built-in pipe's callers expect to be
   * treated.
   */
  formatNumber(value: number | null | undefined, digitsInfo?: string): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return this.numberFormatter(digitsInfo).format(value);
  }

  private dateFormatter(style: LocaleDateStyle): Intl.DateTimeFormat {
    const locale = this.locale;
    const key = `${locale}|${style}`;
    let formatter = this.dateFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, DATE_STYLES[style] ?? DATE_STYLES.medium);
      this.dateFormatters.set(key, formatter);
    }
    return formatter;
  }

  private numberFormatter(digitsInfo?: string): Intl.NumberFormat {
    const locale = this.locale;
    const key = `${locale}|${digitsInfo ?? ''}`;
    let formatter = this.numberFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, this.digitOptions(digitsInfo));
      this.numberFormatters.set(key, formatter);
    }
    return formatter;
  }

  private digitOptions(digitsInfo?: string): Intl.NumberFormatOptions {
    const parsed = digitsInfo ? DIGITS_INFO.exec(digitsInfo) : null;
    if (!parsed) return {};
    const [, minInt, minFrac, maxFrac] = parsed;
    return {
      minimumIntegerDigits: minInt ? Number(minInt) : 1,
      minimumFractionDigits: Number(minFrac),
      maximumFractionDigits: Number(maxFrac),
    };
  }

  /**
   * Timestamps arrive from Firestore, Dates from everything local. The
   * duck-typed `toDate` check is how the rest of the app narrows this
   * (DateFormatService does the same) — instanceof would fail across the
   * SDK's own re-exported class identities.
   */
  private toDate(value: Date | Timestamp | string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = (value as Timestamp)?.toDate?.() ?? new Date(value as Date);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
