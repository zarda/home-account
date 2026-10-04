import { TestBed } from '@angular/core/testing';
import {
  Event as RouterEvent,
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ActionPerformed, LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { Subject } from 'rxjs';

import { NotificationTapService } from './notification-tap.service';

/** The message `public/share-target-sw.js` posts to an open tab (share-target-sw.spec.ts pins the worker's side). */
const ROUTE_MESSAGE = 'notification-route';

type TapListener = (action: ActionPerformed) => void;

/**
 * Stands in for the proxy registerPlugin() returns. Like it, every member it
 * does not define answers as a native call that never settles (ADR 0138), so
 * a plugin adopted as a promise hangs the case instead of passing it.
 */
class FakeLocalNotifications {
  readonly handle: PluginListenerHandle = { remove: jasmine.createSpy('remove').and.resolveTo() };
  readonly listeners: TapListener[] = [];
  readonly addListener = jasmine
    .createSpy<(event: string, listener: TapListener) => Promise<PluginListenerHandle>>('addListener')
    .and.callFake((_event, listener) => {
      this.listeners.push(listener);
      return Promise.resolve(this.handle);
    });

  readonly proxy = new Proxy(this, {
    get: (target, key) => (key in target
      ? target[key as keyof FakeLocalNotifications]
      : () => new Promise(() => undefined)),
  }) as unknown as LocalNotificationsPlugin;

  /** What the plugin hands a listener when a delivered notification is acted on. */
  act(actionId: string, extra?: unknown): void {
    const action = {
      actionId,
      notification: { id: 7, title: 'Rent', body: 'Due tomorrow', extra },
    } as ActionPerformed;
    for (const listener of this.listeners) listener(action);
  }
}

/** Substitutes only the plugin seam; the worker side is the real `navigator.serviceWorker`. */
class TestNotificationTapService extends NotificationTapService {
  readonly plugin = new FakeLocalNotifications();

  protected override nativePlugin(): LocalNotificationsPlugin {
    return this.plugin.proxy;
  }
}

interface FakeRouter {
  navigated: boolean;
  events: Subject<RouterEvent>;
  navigateByUrl: jasmine.Spy;
}

describe('NotificationTapService', () => {
  let router: FakeRouter;
  let isNative: jasmine.Spy;

  beforeEach(() => {
    router = {
      navigated: true,
      events: new Subject<RouterEvent>(),
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true),
    };
    isNative = spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  function service(): TestNotificationTapService {
    return TestBed.runInInjectionContext(() => new TestNotificationTapService());
  }

  /** What the page receives when the worker posts to it. */
  function postFromWorker(data: unknown): void {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data }));
  }

  /** The events of a cold start whose first navigation settles at `/dashboard`. */
  function settleFirstNavigation(): void {
    router.events.next(new NavigationEnd(1, '/', '/dashboard'));
    router.navigated = true;
  }

  describe('on the web', () => {
    it('opens the route a worker message names at once when the app has already navigated', async () => {
      await service().arm();

      postFromWorker({ type: ROUTE_MESSAGE, route: '/dashboard?bill=rule-1' });

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard?bill=rule-1');
    });

    it('waits for the first navigation to end before opening the route', async () => {
      router.navigated = false;
      await service().arm();

      postFromWorker({ type: ROUTE_MESSAGE, route: '/budgets?tab=budgets' });
      router.events.next(new NavigationStart(1, '/'));
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      settleFirstNavigation();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/budgets?tab=budgets');

      // Later navigations are the user's own, not a cue to open it again.
      router.events.next(new NavigationEnd(2, '/budgets?tab=budgets', '/budgets?tab=budgets'));
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting through a redirect or a superseded navigation, as the router does', async () => {
      router.navigated = false;
      await service().arm();
      postFromWorker({ type: ROUTE_MESSAGE, route: '/dashboard?recap=2026-08-31' });

      router.events.next(new NavigationCancel(1, '/', 'redirect', NavigationCancellationCode.Redirect));
      router.events.next(new NavigationCancel(2, '/lock', 'newer', NavigationCancellationCode.SupersededByNewNavigation));
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      router.events.next(new NavigationCancel(3, '/lock', 'guard', NavigationCancellationCode.GuardRejected));
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard?recap=2026-08-31');
    });

    it('opens the route after a first navigation that fails', async () => {
      router.navigated = false;
      await service().arm();
      postFromWorker({ type: ROUTE_MESSAGE, route: '/budgets?tab=budgets' });

      router.events.next(new NavigationError(1, '/', new Error('the chunk did not load')));

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/budgets?tab=budgets');
    });

    it('ignores a route that is not a path on this origin, and a message that is not a route', async () => {
      await service().arm();

      for (const route of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example',
        '/\t/evil.example', 'dashboard', '', undefined, null, 42, ['/dashboard']]) {
        postFromWorker({ type: ROUTE_MESSAGE, route });
      }
      for (const data of [{ type: 'SYNC_OFFLINE_QUEUE', route: '/budgets' }, { route: '/budgets' }, ROUTE_MESSAGE,
        '/budgets', null, undefined]) {
        postFromWorker(data);
      }

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('listens to the worker only, never to the native plugin', async () => {
      const taps = service();
      await taps.arm();

      expect(taps.plugin.addListener).not.toHaveBeenCalled();
    });

    it('arms once however often it is asked', async () => {
      const taps = service();
      await Promise.all([taps.arm(), taps.arm()]);
      await taps.arm();

      postFromWorker({ type: ROUTE_MESSAGE, route: '/dashboard?bill=rule-1' });

      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('stops listening when its injector is destroyed, since the worker container outlives it', async () => {
      await service().arm();

      TestBed.resetTestingModule();
      postFromWorker({ type: ROUTE_MESSAGE, route: '/dashboard?bill=rule-1' });

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('in the iOS app', () => {
    beforeEach(() => isNative.and.returnValue(true));

    it('opens the route a tapped notification carries', async () => {
      const taps = service();
      await taps.arm();

      expect(taps.plugin.addListener).toHaveBeenCalledOnceWith('localNotificationActionPerformed', jasmine.any(Function));
      taps.plugin.act('tap', { route: '/budgets?tab=budgets' });

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/budgets?tab=budgets');
    });

    it('holds a cold-start tap until the first navigation ends', async () => {
      router.navigated = false;
      const taps = service();
      await taps.arm();

      taps.plugin.act('tap', { route: '/dashboard?bill=rule-1' });
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      settleFirstNavigation();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard?bill=rule-1');
    });

    it('ignores a dismissal, a notification with no route, and an unsafe route', async () => {
      const taps = service();
      await taps.arm();

      taps.plugin.act('dismiss', { route: '/budgets?tab=budgets' });
      taps.plugin.act('tap');
      taps.plugin.act('tap', {});
      taps.plugin.act('tap', { route: '//evil.example' });
      taps.plugin.act('tap', { route: 'https://evil.example' });

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('never listens to the worker', async () => {
      await service().arm();

      postFromWorker({ type: ROUTE_MESSAGE, route: '/dashboard?bill=rule-1' });

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('arms once however often it is asked', async () => {
      const taps = service();
      await Promise.all([taps.arm(), taps.arm()]);
      await taps.arm();

      expect(taps.plugin.addListener).toHaveBeenCalledTimes(1);
    });

    it('logs a listener the plugin refuses, and arming still settles', async () => {
      const warn = spyOn(console, 'warn');
      const taps = service();
      taps.plugin.addListener.and.rejectWith(Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }));

      await taps.arm();

      expect(warn).toHaveBeenCalledOnceWith('[NotificationTapService] Notification taps were not armed', jasmine.any(Error));
    });
  });
});
