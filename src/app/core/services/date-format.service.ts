import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { LocaleFormatService } from './locale-format.service';
import { TranslationService } from './translation.service';
import { addDays, dayKey, startOfDay } from '../utils/transaction-date.utils';

/**
 * The stored dateFormat value meaning "follow the chosen language". Not one
 * of the three fixed patterns — the point is that no pattern is fixed.
 */
export const DATE_FORMAT_AUTO = 'auto';

@Injectable({ providedIn: 'root' })
export class DateFormatService {
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);

  /**
   * Get user's preferred date format
   */
  private getDateFormat(): string {
    return this.authService.currentUser()?.preferences?.dateFormat || DATE_FORMAT_AUTO;
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
    const format = this.getDateFormat();

    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();

    switch (format) {
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`;
      case 'YYYY-MM-DD':
        return dayKey(d);
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      case DATE_FORMAT_AUTO:
      default:
        return this.localeFormat.formatDate(d, 'short');
    }
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
}
