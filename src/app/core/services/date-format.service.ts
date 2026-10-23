import { Injectable, computed, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { LocaleFormatService } from './locale-format.service';
import { TranslationService } from './translation.service';
import {
  DateFieldOrder,
  addDays,
  dayKey,
  parseTypedDate,
  startOfDay,
} from '../utils/transaction-date.utils';

/**
 * The stored dateFormat value meaning "follow the chosen language". Not one
 * of the three fixed patterns — the point is that no pattern is fixed.
 */
export const DATE_FORMAT_AUTO = 'auto';

/**
 * One of the three fixed patterns an account can store: the order its fields
 * are written in, and the writer that prints a date that way. The two
 * directions live in one entry so what `formatDate` prints is exactly what
 * `parseDate` reads back, and the profile select's worked examples are these
 * writers rather than a list of strings beside them (ADR 0171).
 */
export interface FixedDateFormat {
  readonly order: DateFieldOrder;
  readonly write: (date: Date) => string;
}

function dayParts(date: Date): [year: string, month: string, day: string] {
  const [year, month, day] = dayKey(date).split('-');
  return [year, month, day];
}

/**
 * The stored patterns, in the order the profile select lists them. Look a
 * stored value up with `Object.hasOwn`: it is a string the account document
 * held, and `toString` or `__proto__` must not find the object's own members.
 */
export const FIXED_FORMATS: Readonly<Record<string, FixedDateFormat>> = {
  'MM/DD/YYYY': {
    order: 'mdy',
    write: date => {
      const [year, month, day] = dayParts(date);
      return `${month}/${day}/${year}`;
    },
  },
  'DD/MM/YYYY': {
    order: 'dmy',
    write: date => {
      const [year, month, day] = dayParts(date);
      return `${day}/${month}/${year}`;
    },
  },
  'YYYY-MM-DD': {
    order: 'ymd',
    write: date => dayKey(date),
  },
};

@Injectable({ providedIn: 'root' })
export class DateFormatService {
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);

  /**
   * The format the signed-in user stored, or `auto` when none is: the one
   * place that default is written. The profile select seeds from it, and
   * whatever must follow the setting reads it rather than the user's document.
   */
  readonly preference = computed<string>(
    () => this.authService.currentUser()?.preferences?.dateFormat || DATE_FORMAT_AUTO);

  /**
   * The order the reader's dates are written and typed in: the stored
   * pattern's own, or the chosen language's on `auto`.
   */
  fieldOrder(): DateFieldOrder {
    return this.fixedFormat()?.order ?? this.localeFormat.fieldOrder();
  }

  /**
   * A date the reader typed, in the order `formatDate` writes: the local
   * midnight it names, or null when it is not a day in that order.
   */
  parseDate(text: string): Date | null {
    return parseTypedDate(text, this.fieldOrder());
  }

  /**
   * Formats a date using the user's preferred format.
   *
   * `auto` — the default for accounts created from here on — hands the date
   * to the active locale instead of a fixed pattern, so a Japanese UI reads
   * 2026年8月19日 rather than 08/19/2026.
   *
   * An account that explicitly stored one of the three patterns keeps it.
   * A stored 'MM/DD/YYYY' cannot be told apart from a deliberate choice, so
   * overriding it would silently undo a setting the user may have made on
   * purpose; the setting is theirs to change. See ADR 0058.
   */
  formatDate(date: Date | Timestamp): string {
    const d = (date as Timestamp)?.toDate?.() ?? new Date(date as Date);

    return this.fixedFormat()?.write(d) ?? this.localeFormat.formatDate(d, 'short');
  }

  /**
   * Formats a date as a relative string with i18n support
   */
  formatRelativeDate(date: Date | Timestamp): string {
    const d = (date as Timestamp)?.toDate?.() ?? new Date(date as Date);
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = addDays(today, -1);
    const dateOnly = startOfDay(d);

    if (dateOnly.getTime() === today.getTime()) {
      return this.translationService.t('dates.today');
    }
    if (dateOnly.getTime() === yesterday.getTime()) {
      return this.translationService.t('dates.yesterday');
    }
    if (now.getTime() - d.getTime() < 7 * 86400000 && d.getTime() < now.getTime()) {
      const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      return this.translationService.t(`days.${weekdays[d.getDay()]}`);
    }

    // Use locale for older dates
    const locale = this.translationService.getIntlLocale();
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }

  /** The stored pattern's table entry, or null on `auto` and on anything else. */
  private fixedFormat(): FixedDateFormat | null {
    const stored = this.preference();
    return Object.hasOwn(FIXED_FORMATS, stored) ? FIXED_FORMATS[stored] : null;
  }
}
