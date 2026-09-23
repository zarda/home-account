import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AnnouncerService } from './announcer.service';
import { TranslationService } from './translation.service';

export type NotificationTone = 'success' | 'error' | 'info';

/** How long each tone's snackbar stays up when a caller names no duration. */
export const NOTIFICATION_DURATION_MS: Readonly<Record<NotificationTone, number>> = {
  success: 3000,
  info: 3000,
  error: 5000,
};

export interface NotificationOptions {
  /**
   * How long the snackbar stays up. For a notice longer than the one
   * sentence the tone's own duration was sized for.
   */
  durationMs?: number;
}

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

  /** Confirmation of a completed action (polite announce, 3s by default). */
  success(message: string, options?: NotificationOptions): void {
    this.show(message, 'success', options);
  }

  /** Neutral status update (polite announce, 3s by default). */
  info(message: string, options?: NotificationOptions): void {
    this.show(message, 'info', options);
  }

  /** A failure the user should read (assertive announce, 5s by default). */
  error(message: string, options?: NotificationOptions): void {
    this.show(message, 'error', options);
  }

  private show(message: string, tone: NotificationTone, options?: NotificationOptions): void {
    if (!message) return;
    this.snackBar.open(message, this.translation.t('common.close'), {
      duration: options?.durationMs ?? NOTIFICATION_DURATION_MS[tone],
      panelClass: `snackbar-${tone}`,
    });
    this.announcer.announce(message, tone === 'error' ? 'assertive' : 'polite');
  }
}
