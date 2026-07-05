import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AnnouncerService } from './announcer.service';
import { TranslationService } from './translation.service';

export type NotificationTone = 'success' | 'error' | 'info';

/**
 * One place for transient user feedback. Wraps the single snackbar call
 * shape (message + a Close action + a tone-appropriate duration) and pairs
 * every snackbar with a matching screen-reader announcement, so callers no
 * longer repeat both. Snackbars are transient feedback ONLY — anything that
 * must persist (e.g. budget alerts) belongs in inline UI, not here.
 *
 * Messages are passed already translated; the Close action is localized
 * here.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private snackBar = inject(MatSnackBar);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);

  /** Confirmation of a completed action (polite announce, 3s). */
  success(message: string): void {
    this.show(message, 'success');
  }

  /** Neutral status update (polite announce, 3s). */
  info(message: string): void {
    this.show(message, 'info');
  }

  /** A failure the user should read (assertive announce, 5s). */
  error(message: string): void {
    this.show(message, 'error');
  }

  private show(message: string, tone: NotificationTone): void {
    if (!message) return;
    const isError = tone === 'error';
    this.snackBar.open(message, this.translation.t('common.close'), {
      duration: isError ? 5000 : 3000,
      panelClass: `snackbar-${tone}`,
    });
    this.announcer.announce(message, isError ? 'assertive' : 'polite');
  }
}
