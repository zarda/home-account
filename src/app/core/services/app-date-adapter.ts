import { Injectable, effect, inject, untracked } from '@angular/core';
import { MAT_NATIVE_DATE_FORMATS, MatDateFormats, NativeDateAdapter } from '@angular/material/core';
import { DateFormatService } from './date-format.service';
import { LocaleFormatService } from './locale-format.service';
import { DAY_KEY_PATTERN, dayKey, parseDayKey } from '../utils/transaction-date.utils';

/**
 * The display and parse format a date input is handed: the account's own
 * date format, in the reader's language. A frozen object compared by
 * identity, so no Intl option bag or other display format a caller passes can
 * be mistaken for it. Its contents are never read.
 */
export const APP_DATE_INPUT = Object.freeze({});

/**
 * An input's text goes through `APP_DATE_INPUT` both ways. The calendar's own
 * labels (the period, a day's and a month's accessible names) keep Material's
 * Intl formats, which already speak the adapter's locale.
 */
export const APP_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: APP_DATE_INPUT },
  display: { ...MAT_NATIVE_DATE_FORMATS.display, dateInput: APP_DATE_INPUT },
};

/**
 * The adapter every date picker in the app reads: an input shows and reads a
 * date in the account's date format and the reader's language, and the
 * calendar names its months and weekdays in that language.
 *
 * Material's native adapter takes its locale once, from LOCALE_ID at
 * bootstrap, and reads typed text with `Date.parse`: the browser's order, an
 * ISO day as UTC midnight (the previous evening west of Greenwich), and
 * `Aug 19 2026` or a bare `2` as a valid date. This one follows the reader
 * instead, and reads only what `DateFormatService.parseDate` reads.
 *
 * It follows the reader itself. The constructor takes the reader's language
 * at once, so the first paint is right, and an effect follows the language
 * and the stored format from then on. Either change calls `setLocale`, the
 * one signal Material re-renders every input on, so a change of format alone
 * re-renders too. The last language and format followed guard it, so the
 * effect's first run, which finds what the constructor took, re-renders
 * nothing. Constructed by the first picker, so nothing is resolved at
 * bootstrap for it.
 */
@Injectable({ providedIn: 'root' })
export class AppDateAdapter extends NativeDateAdapter {
  private readonly localeFormat = inject(LocaleFormatService);
  private readonly dateFormat = inject(DateFormatService);
  private followed = '';

  constructor() {
    super();
    untracked(() => this.follow());
    effect(() => this.follow());
  }

  /** The account's format for an input's text; Material's Intl in this locale for every other format. */
  override format(date: Date, displayFormat: object): string {
    return displayFormat === APP_DATE_INPUT && this.isValid(date)
      ? this.dateFormat.formatDate(date)
      : super.format(date, displayFormat);
  }

  /**
   * Typed text, read in the order the account's format names its fields. An
   * empty or blank input is no date, so clearing one is not an error; text
   * that names no day is an Invalid Date, since a null would count as valid
   * and the input would never report it.
   */
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value === 'number') {
      return super.parse(value, parseFormat);
    }
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    return this.dateFormat.parseDate(value) ?? this.invalid();
  }

  /**
   * A value handed to an input. A date-only ISO string is its local day, and
   * one that names no day is invalid rather than `new Date`'s UTC reading,
   * which rolls `2026-02-31` into March. Anything else is Material's.
   */
  override deserialize(value: unknown): Date | null {
    if (typeof value === 'string' && DAY_KEY_PATTERN.test(value.trim())) {
      return parseDayKey(value) ?? this.invalid();
    }
    return super.deserialize(value);
  }

  /** An input's `min` and `max` attributes, from the local day rather than the UTC one. */
  override toIso8601(date: Date): string {
    return dayKey(date);
  }

  private follow(): void {
    const locale = this.localeFormat.locale;
    const key = `${locale} ${this.dateFormat.preference()}`;
    if (key !== this.followed) {
      this.followed = key;
      untracked(() => this.setLocale(locale));
    }
  }
}
