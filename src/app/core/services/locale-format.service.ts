import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { TranslationService } from './translation.service';
import { DateFieldOrder } from '../utils/transaction-date.utils';

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

/** The orders `fieldOrder` can answer with, as the letters of year, month and day. */
const FIELD_ORDERS: readonly DateFieldOrder[] = ['ymd', 'mdy', 'dmy'];

/**
 * Angular's digitsInfo, `{minInt}.{minFrac}-{maxFrac}` — kept as the number
 * vocabulary because every call site already speaks it and the meaning is
 * exact. Only the formatting moves to the active locale.
 */
const DIGITS_INFO = /^(\d+)?\.(\d+)-(\d+)$/;

/** Used when a partial test mock supplies no locale resolver. */
const DEFAULT_INTL_LOCALE = 'en-US';

/** The steps a file size climbs past whole bytes, each 1024 of the one before. */
const FILE_SIZE_UNITS = ['kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * Every user-facing date, number and file size is formatted here, against
 * the language the user chose rather than the browser's.
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
  private unitFormatters = new Map<string, Intl.NumberFormat>();
  private timeFormatters = new Map<string, Intl.DateTimeFormat>();
  private fieldOrders = new Map<string, DateFieldOrder>();

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
   * The order the active locale writes a numeric date's year, month and day
   * in, read off the same `short` style `formatDate` prints: en-US is `mdy`,
   * ja-JP and zh-Hant-TW are `ymd`. What a picker is typed into is then read
   * in the order it prints, rather than a second table of locales kept beside
   * Intl's. A locale whose order is none of the three the typed-date reader
   * knows is read as `ymd`, the order ISO dates and any leading four-digit
   * year already use.
   */
  fieldOrder(): DateFieldOrder {
    const locale = this.locale;
    let order = this.fieldOrders.get(locale);
    if (!order) {
      const letters = this.dateFormatter('short')
        .formatToParts(new Date(2026, 7, 19))
        .flatMap(part => (part.type === 'year' || part.type === 'month' || part.type === 'day'
          ? [part.type[0]]
          : []))
        .join('');
      order = FIELD_ORDERS.find(candidate => candidate === letters) ?? 'ymd';
      this.fieldOrders.set(locale, order);
    }
    return order;
  }

  /**
   * A date range in the active locale's conventions. Shared fields collapse
   * per CLDR (Aug 1 – 19, 2026 in en; 2026年8月1日～19日 in ja) and a
   * same-day range collapses to the single date. Sides arrive swapped from
   * open-ended pickers often enough that they are ordered here rather than
   * thrown on; either side absent or unparseable formats as the empty
   * string, matching `formatDate`'s contract.
   */
  formatRange(
    start: Date | Timestamp | string | number | null | undefined,
    end: Date | Timestamp | string | number | null | undefined,
    style: LocaleDateStyle = 'medium'
  ): string {
    const a = this.toDate(start);
    const b = this.toDate(end);
    if (!a || !b) return '';
    const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
    return this.dateFormatter(style).formatRange(from, to);
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

  /**
   * A file's size in the active language: whole bytes below 1024, then kB,
   * MB and GB to one decimal place, each step 1024 of the one before.
   *
   * From kB up the unit is Intl's own short form: `10 MB` in en, ja and tc,
   * `kB` in en and tc, `KB` in ja. The byte step is the catalog's
   * (`common.fileSizeBytes`), its figure formatted here, because CLDR writes
   * the byte in English for zh-Hant at every width and its short en form does
   * not agree in number ("281 byte"). An absent or non-finite size formats as
   * the empty string, as `formatNumber` does.
   */
  formatFileSize(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
    // A loop rather than Math.log, so 1024 ** 3 cannot floor to the step below.
    // It steps on the figure as it will be written, so 1,048,525 bytes reads
    // 1 MB rather than 1,024 kB.
    const written = (figure: number, at: number) => (at === 0 ? Math.round(figure) : Math.round(figure * 10) / 10);
    let value = Math.max(0, bytes);
    let step = 0;
    while (written(value, step) >= 1024 && step < FILE_SIZE_UNITS.length) {
      value /= 1024;
      step++;
    }
    if (step === 0) {
      return this.translationService.t('common.fileSizeBytes', { size: this.formatNumber(value, '1.0-0') });
    }
    return this.unitFormatter(FILE_SIZE_UNITS[step - 1]).format(value);
  }

  /**
   * A time of day in the active locale's conventions (hour and minute; the
   * locale's own 12/24-hour convention and separator). Same absent/unparseable
   * contract as `formatDate`.
   */
  formatTime(value: Date | Timestamp | string | number | null | undefined): string {
    const date = this.toDate(value);
    if (!date) return '';
    return this.timeFormatter().format(date);
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

  private timeFormatter(): Intl.DateTimeFormat {
    const locale = this.locale;
    let formatter = this.timeFormatters.get(locale);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
      this.timeFormatters.set(locale, formatter);
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

  private unitFormatter(unit: string): Intl.NumberFormat {
    const locale = this.locale;
    const key = `${locale}|${unit}`;
    let formatter = this.unitFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 });
      this.unitFormatters.set(key, formatter);
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
