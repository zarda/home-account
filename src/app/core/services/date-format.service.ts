import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';

@Injectable({ providedIn: 'root' })
export class DateFormatService {
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);

  /**
   * Get user's preferred date format
   */
  private getDateFormat(): string {
    return this.authService.currentUser()?.preferences?.dateFormat || 'MM/DD/YYYY';
  }

  /**
   * Formats a date using user's preferred format
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
        return `${year}-${month}-${day}`;
      case 'MM/DD/YYYY':
      default:
        return `${month}/${day}/${year}`;
    }
  }

  /**
   * Formats a date as a relative string with i18n support
   */
  formatRelativeDate(date: Date | Timestamp): string {
    const d = (date as Timestamp)?.toDate?.() ?? new Date(date as Date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

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
