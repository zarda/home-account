import { Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class DateFormatService {
  /**
   * Formats a date as a localized date string
   */
  formatDate(date: Date | Timestamp): string {
    if ((date as Timestamp)?.toDate) {
      return (date as Timestamp).toDate().toLocaleDateString();
    }
    return new Date(date as Date).toLocaleDateString();
  }

  /**
   * Formats a date as a relative string (Today, Yesterday, weekday, or short date)
   */
  formatRelativeDate(date: Date | Timestamp): string {
    const d = (date as Timestamp)?.toDate ? (date as Timestamp).toDate() : new Date(date as Date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (dateOnly.getTime() === today.getTime()) {
      return 'Today';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
      return 'Yesterday';
    } else if (now.getTime() - d.getTime() < 7 * 86400000) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
}
