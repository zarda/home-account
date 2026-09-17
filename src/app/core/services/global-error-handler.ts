import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';

/**
 * Minimum gap between error snackbars. One broken subscription can reject on
 * every emission; the log gets each occurrence, the user gets one message.
 */
export const ERROR_NOTIFY_THROTTLE_MS = 10_000;

/**
 * True for a CapacitorException raised by registerPlugin()'s proxy for a
 * method the native side never declared. That is always a wiring mistake on
 * this side of the bridge, never something the user caused or can act on.
 */
function isUnimplementedPluginCall(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'UNIMPLEMENTED'
  );
}

/**
 * Last-resort reporter for errors nothing else caught — a rejected promise
 * without a .catch(), a throw inside a template or an effect. Before this,
 * such failures reached the console at best and the user saw a screen that
 * simply did not react.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  // The handler is constructed before the app finishes bootstrapping, so its
  // dependencies are resolved lazily: instantiating MatSnackBar eagerly here
  // would pull Material into every bootstrap error path.
  private injector = inject(Injector);
  private lastNotifiedAt = 0;

  handleError(error: unknown): void {
    // Zone wraps async errors; unwrap so the log carries the real cause.
    const unwrapped = (error as { rejection?: unknown })?.rejection ?? error;
    console.error('[GlobalErrorHandler]', unwrapped);

    // A plugin method the native side never declared is a developer defect,
    // not a user-actionable failure; a bare "Error" snackbar would only
    // alarm the user with nothing to do about it, so this stays log-only.
    if (isUnimplementedPluginCall(unwrapped)) return;

    const now = Date.now();
    if (now - this.lastNotifiedAt < ERROR_NOTIFY_THROTTLE_MS) return;

    try {
      const notifications = this.injector.get(NotificationService);
      const translation = this.injector.get(TranslationService);
      notifications.error(translation.t('common.error'));
      this.lastNotifiedAt = now;
    } catch {
      // Bootstrap not far enough for the snackbar — the console entry above
      // is the best that can be done.
    }
  }
}
