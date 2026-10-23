import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  Event as RouterEvent,
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  Router,
} from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { ActionPerformed, LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { filter, take } from 'rxjs';

import { WIDGET_SNAPSHOT_PLUGIN } from '../plugins/widget-snapshot.plugin';
import { safeAppRoute, widgetRoute } from '../utils/notification-route.utils';

/**
 * The type of the message `public/share-target-sw.js` posts to an open tab
 * when one of its notifications is tapped. The worker cannot import it, so
 * the literal is written on both sides.
 */
const NOTIFICATION_ROUTE_MESSAGE = 'notification-route';

/** The plugin's name for opening the app from the notification itself, as opposed to `dismiss`. */
const TAP_ACTION = 'tap';

const LOG = '[NotificationTapService]';

/**
 * Opens the in-app path a tapped reminder names, in a page that is already
 * running, and the dashboard for a tap on the home-screen widget.
 *
 * On the web the worker owns the tap: it focuses an open tab and posts it
 * the route, because only the page's router can open it without a reload.
 * In the iOS app the plugin reports the tap to whichever listener is
 * attached, and holds a tap that started the app until one attaches; the
 * widget's plugin does the same for a tap on the widget, which exists only
 * there.
 *
 * A reminder's route is data from outside the page, so only what
 * `safeAppRoute` admits is opened, and anything else is ignored: the app
 * stays where it is. The widget's route is the app's own, and takes the same
 * path.
 *
 * Loaded by dynamic import (`armNotificationTaps` in app.config.ts), so this
 * code stays out of the initial bundle: from an idle task on the web, and at
 * once in the iOS app, where the held tap would otherwise open seconds after
 * launch, over wherever the user had gone.
 */
@Injectable({ providedIn: 'root' })
export class NotificationTapService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly widget = inject(WIDGET_SNAPSHOT_PLUGIN);
  private armed = false;

  /**
   * Starts listening for taps; later calls do nothing. Never rejects. In the
   * iOS app the reminders and the widget arm side by side, and either one
   * failing leaves the other armed.
   */
  async arm(): Promise<void> {
    if (this.armed) return;
    this.armed = true;
    if (Capacitor.isNativePlatform()) {
      await Promise.all([this.listenToPlugin(), this.listenToWidget()]);
    } else {
      this.listenToWorker();
    }
  }

  private listenToWorker(): void {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data !== 'object' || data === null) return;
      const message = data as { type?: unknown; route?: unknown };
      if (message.type !== NOTIFICATION_ROUTE_MESSAGE) return;
      this.open(message.route);
    };
    container.addEventListener('message', onMessage);
    // The container is global and outlives this injector.
    this.destroyRef.onDestroy(() => container.removeEventListener('message', onMessage));
  }

  /**
   * The listener's handle is awaited, never the plugin: the plugin is a proxy
   * whose catch-all trap would answer `then` as a native call (ADR 0138).
   */
  private async listenToPlugin(): Promise<void> {
    try {
      await this.nativePlugin().addListener('localNotificationActionPerformed', (action: ActionPerformed) => {
        if (action.actionId !== TAP_ACTION) return;
        const extra: unknown = action.notification?.extra;
        this.open(typeof extra === 'object' && extra !== null ? (extra as { route?: unknown }).route : undefined);
      });
    } catch (error) {
      console.warn(`${LOG} Notification taps were not armed`, error);
    }
  }

  /**
   * The widget's tap carries no route: it always opens the dashboard. As with
   * the reminders, only the listener's handle is awaited (ADR 0138).
   */
  private async listenToWidget(): Promise<void> {
    const widget = this.widget;
    if (!widget) return;
    try {
      await widget.addListener('tapped', () => this.open(widgetRoute()));
    } catch (error) {
      console.warn(`${LOG} Widget taps were not armed`, error);
    }
  }

  /**
   * Navigates straight away when the router has completed a navigation.
   * Before that, the start-up navigation, or a redirect it makes (to the
   * lock screen, say), can still start after this one and replace it, so it
   * waits for the first navigation to settle: the events after which the
   * router reports `navigated`, and a failed navigation too.
   */
  private open(candidate: unknown): void {
    const route = safeAppRoute(candidate);
    if (!route) return;
    if (this.router.navigated) {
      void this.router.navigateByUrl(route);
      return;
    }
    this.router.events.pipe(filter(settlesNavigation), take(1)).subscribe(() => {
      void this.router.navigateByUrl(route);
    });
  }

  /** Plugin seam, so specs can deliver a tap without a native binary. */
  protected nativePlugin(): LocalNotificationsPlugin {
    return LocalNotifications;
  }
}

/** A navigation that ended, failed, or was cancelled with no other navigation taking its place. */
function settlesNavigation(event: RouterEvent): boolean {
  if (event instanceof NavigationEnd || event instanceof NavigationError) return true;
  return event instanceof NavigationCancel
    && event.code !== NavigationCancellationCode.Redirect
    && event.code !== NavigationCancellationCode.SupersededByNewNavigation;
}
