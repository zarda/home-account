import { Injectable, NgZone, inject } from '@angular/core';
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

export interface ActionNoticeOptions {
  /**
   * What a screen reader hears in place of the message. The snack bar's own
   * live region, which would read the action's label out with the message,
   * is quiet for a notice with an action, so this is where the action is
   * named: without it a screen reader hears the message alone and is never
   * told the action is there.
   */
  announcement?: string;
}

/**
 * A notice that carries an action, as its caller holds it. Every handler
 * it takes hears this notice alone: a notice that replaced it, or that it
 * replaced, never reaches them, and `dismiss()` never takes another notice
 * down.
 */
export interface ActionNotice {
  /** Runs when the reader presses the notice's action. */
  onAction(handler: () => void): void;
  /**
   * Runs once the notice has left the screen, with whether its action took
   * it down. A notice that opens in its place takes it down too, and it
   * reports that only as it leaves, after the next one has opened.
   */
  afterDismissed(handler: (byAction: boolean) => void): void;
  /**
   * Runs when the notice comes to be held, by the pointer over it or focus
   * inside it (true), and when neither holds it any more (false).
   */
  onHold(handler: (held: boolean) => void): void;
  /** Takes the notice down; once it is gone this does nothing. */
  dismiss(): void;
}

/**
 * One place for transient user feedback. Wraps the single snackbar call
 * shape (message + a Close action + a tone-appropriate duration) and pairs
 * every snackbar with a matching screen-reader announcement, so callers no
 * longer repeat both. Snackbars are transient feedback ONLY — anything that
 * must persist (e.g. budget alerts) belongs in inline UI, not here.
 *
 * One exception: the notice with an action (`withAction`), which a deleted
 * transaction's Undo uses. It has no duration of its own and stays until its
 * caller takes it down, because the caller runs the window itself and holds
 * it while the notice is hovered or focused.
 *
 * Messages are passed already translated; the Close action is localized
 * here, and the one action a notice carries, with what a screen reader hears
 * of it, is passed translated too.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private snackBar = inject(MatSnackBar);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);
  private zone = inject(NgZone);

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

  /**
   * A neutral notice with one action, in place of Close. Material is given
   * no duration: the notice stays until the caller takes it down through
   * the handle it returns. It is announced once, politely, through the
   * queue, as `options.announcement` when the caller gives one (which names
   * the action) and as the message otherwise; the snack bar's own live
   * region is turned off for it, so a screen reader does not hear it a
   * second time as it is shown.
   */
  withAction(message: string, action: string, options?: ActionNoticeOptions): ActionNotice {
    const ref = this.snackBar.open(message, action, {
      panelClass: 'snackbar-info',
      politeness: 'off',
    });
    this.announcer.announce(options?.announcement || message, 'polite');

    const element = ref.containerInstance._elementRef.nativeElement;
    const holdHandlers: ((held: boolean) => void)[] = [];
    let hovered = false;
    let focused = false;
    let held = false;
    // Set as the notice is taken down, before it has finished leaving.
    let down = false;
    const update = (): void => {
      const now = hovered || focused;
      if (now === held) return;
      held = now;
      for (const handler of holdHandlers) handler(held);
    };
    const listeners: [string, (event: Event) => void][] = [
      ['pointerenter', () => { hovered = true; update(); }],
      ['pointerleave', () => { hovered = false; update(); }],
      ['focusin', () => { focused = true; update(); }],
      ['focusout', event => {
        focused = element.contains((event as FocusEvent).relatedTarget as Node | null);
        update();
      }],
    ];
    // Outside Angular: a pointer crossing the notice changes nothing a view
    // renders, and the caller's window runs on its own timer.
    this.zone.runOutsideAngular(() => {
      for (const [type, listener] of listeners) element.addEventListener(type, listener);
    });
    ref.afterDismissed().subscribe(() => {
      down = true;
      for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    });

    return {
      onAction: handler => {
        ref.onAction().subscribe(() => handler());
      },
      afterDismissed: handler => {
        ref.afterDismissed().subscribe(({ dismissedByAction }) => handler(dismissedByAction));
      },
      onHold: handler => {
        holdHandlers.push(handler);
      },
      dismiss: () => {
        if (down) return;
        down = true;
        ref.dismiss();
      },
    };
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
