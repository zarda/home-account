import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { PwaService } from './pwa.service';

describe('PwaService', () => {
  // Every instance built here keeps its window listeners for the rest of the
  // file, so a probe fired by one spec can still be in flight during the next.
  // Stubbing fetch keeps them off the network and deterministic.
  let fetchSpy: jasmine.Spy<typeof fetch>;

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch').and.resolveTo(new Response(null, { status: 200 }));
  });

  function make(): PwaService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PwaService],
    });
    return TestBed.inject(PwaService);
  }

  it('creates', () => {
    expect(make()).toBeTruthy();
  });

  describe('online/offline state', () => {
    it('tracks window online and offline events', () => {
      const s = make();
      window.dispatchEvent(new Event('offline'));
      expect(s.isOnline()).toBeFalse();
      window.dispatchEvent(new Event('online'));
      expect(s.isOnline()).toBeTrue();
    });
  });

  describe('reachability probe', () => {
    interface Internals {
      cancelReachabilityRetry: () => void;
      retryTimer: unknown;
    }

    // Leaves no backoff timer behind for the next spec.
    function settle(s: PwaService): void {
      (s as unknown as Internals).cancelReachabilityRetry();
    }

    function withNavigatorOnline(value: boolean): void {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
    }

    afterEach(() => {
      delete (navigator as unknown as Record<string, unknown>)['onLine'];
      delete (document as unknown as Record<string, unknown>)['visibilityState'];
    });

    it('stays online when the probe gets an answer', async () => {
      const s = make();
      expect(await s.refreshOnlineStatus()).toBeTrue();
      expect(s.isOnline()).toBeTrue();
      const request = fetchSpy.calls.mostRecent().args[1] as RequestInit;
      expect(request.method).toBe('HEAD');
      expect(request.cache).toBe('no-store');
    });

    it('reports offline when the request never lands', async () => {
      const s = make();
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      expect(await s.refreshOnlineStatus()).toBeFalse();
      expect(s.isOnline()).toBeFalse();
      settle(s);
    });

    it('reports offline when a portal answers with a redirect', async () => {
      const s = make();
      fetchSpy.and.resolveTo({ type: 'opaqueredirect', ok: false } as Response);
      expect(await s.refreshOnlineStatus()).toBeFalse();
      settle(s);
    });

    it('stays online on an error status — the request still crossed the network', async () => {
      const s = make();
      fetchSpy.and.resolveTo(new Response(null, { status: 404 }));
      expect(await s.refreshOnlineStatus()).toBeTrue();
    });

    it('skips the probe when the OS reports no network at all', async () => {
      const s = make();
      withNavigatorOnline(false);
      expect(await s.refreshOnlineStatus()).toBeFalse();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('shares one request between callers that ask at the same time', async () => {
      const s = make();
      const results = await Promise.all([s.refreshOnlineStatus(), s.refreshOnlineStatus()]);
      expect(results).toEqual([true, true]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('schedules a retry after a failed probe and drops it once back online', async () => {
      const s = make();
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      await s.refreshOnlineStatus();
      expect((s as unknown as Internals).retryTimer).not.toBeNull();

      fetchSpy.and.resolveTo(new Response(null, { status: 200 }));
      await s.refreshOnlineStatus();
      expect(s.isOnline()).toBeTrue();
      expect((s as unknown as Internals).retryTimer).toBeNull();
    });

    it('an online event clears an offline state the probe was holding', async () => {
      const s = make();
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      await s.refreshOnlineStatus();
      expect(s.isOnline()).toBeFalse();

      // The signal flips before the confirming probe resolves, so a probe that
      // simply cannot work here can never pin the app offline.
      window.dispatchEvent(new Event('online'));
      expect(s.isOnline()).toBeTrue();
      settle(s);
    });

    it('re-checks when the app comes back to the foreground', () => {
      const s = make();
      expect(s).toBeTruthy();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('ignores visibility changes that hide the app', () => {
      const s = make();
      expect(s).toBeTruthy();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('appinstalled marks the app standalone', () => {
    const s = make();
    window.dispatchEvent(new Event('appinstalled'));
    expect(s.isStandalone()).toBeTrue();
  });

  describe('install prompt (#446)', () => {
    interface FakeInstallPrompt extends Event {
      prompt: jasmine.Spy<() => Promise<void>>;
    }

    // Chrome's BeforeInstallPromptEvent cannot be constructed, so a plain
    // event carries the one member the service calls.
    function installPrompt(): FakeInstallPrompt {
      return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: jasmine.createSpy('prompt').and.resolveTo(),
      });
    }

    it('captures beforeinstallprompt without preventDefault, so the browser keeps its own install UI', () => {
      // A pin (ADR 0112): preventDefault would hide Chrome's install UI on
      // every visit, including the pages that never offer the prompt.
      make();
      const event = installPrompt();
      spyOn(event, 'preventDefault');
      window.dispatchEvent(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('can offer the prompt once the browser hands one over', () => {
      const s = make();
      expect(s.canPromptInstall()).toBeFalse();
      window.dispatchEvent(installPrompt());
      expect(s.canPromptInstall()).toBeTrue();
    });

    it('prompts once, then has nothing left to offer', async () => {
      const s = make();
      const event = installPrompt();
      window.dispatchEvent(event);

      await s.promptInstall();
      expect(event.prompt).toHaveBeenCalledTimes(1);
      expect(s.canPromptInstall()).toBeFalse();

      // Chrome rejects a second prompt() on the same event.
      await s.promptInstall();
      expect(event.prompt).toHaveBeenCalledTimes(1);
    });

    it('settles when the browser refuses the prompt, and does not offer that event again', async () => {
      const warn = spyOn(console, 'warn');
      const s = make();
      const event = installPrompt();
      event.prompt.and.rejectWith(new DOMException('No user activation', 'NotAllowedError'));
      window.dispatchEvent(event);

      await expectAsync(s.promptInstall()).toBeResolved();
      expect(warn).toHaveBeenCalled();
      expect(s.canPromptInstall()).toBeFalse();
    });

    it('appinstalled clears it', () => {
      const s = make();
      window.dispatchEvent(installPrompt());
      window.dispatchEvent(new Event('appinstalled'));
      expect(s.canPromptInstall()).toBeFalse();
    });

    it('never offers it on native', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      const s = make();
      window.dispatchEvent(installPrompt());
      expect(s.canPromptInstall()).toBeFalse();
    });
  });

  describe('service worker channel', () => {
    // The channel is shared: the share-target worker posts notification routes
    // on it and NotificationTapService reads them with its own listener, and
    // anything else under this origin may post anything. This service has no
    // message of its own to answer, so it stays off the channel.
    it('registers no message listener on the service worker container', () => {
      const addListener = spyOn(navigator.serviceWorker, 'addEventListener').and.callThrough();

      make();

      expect(addListener.calls.allArgs().map(([type]) => type)).not.toContain('message');
    });

    // No worker here answers a sync event, so there is nothing to register.
    it('has no background-sync registration', () => {
      expect('registerBackgroundSync' in make()).toBeFalse();
    });
  });

  describe('platform detection', () => {
    it('detects standalone display mode', () => {
      const original = window.matchMedia;
      spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
      const s = make();
      expect(s.isStandalone()).toBeTrue();
      window.matchMedia = original;
    });

    it('counts the native app as installed, so it never asks to be added to the Home Screen', () => {
      // The iOS app's WKWebView does not match the standalone display-mode
      // query and reports navigator.standalone as false, so only the shell
      // itself can say the app is installed. The camera dialog read the web
      // checks alone and told people already in the app to add it to their
      // Home Screen.
      spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);

      expect(make().isStandalone()).toBeTrue();
    });

    it('still finds a plain browser tab not installed', () => {
      // A pin: the native answer must not leak into a browser tab. In Safari
      // the camera dialog's hint is what points to Add to Home Screen, which
      // is the only way iOS installs the web app.
      spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

      expect(make().isStandalone()).toBeFalse();
    });

    describe('iPadOS (#446)', () => {
      // What iPadOS Safari sends by default: it asks for the desktop site.
      const MAC_SAFARI_UA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

      function withDevice(userAgent: string, maxTouchPoints: number): void {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent });
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => maxTouchPoints });
      }

      afterEach(() => {
        delete (navigator as unknown as Record<string, unknown>)['userAgent'];
        delete (navigator as unknown as Record<string, unknown>)['maxTouchPoints'];
      });

      it('counts a Mac user agent with touch points as iOS: an iPad', () => {
        withDevice(MAC_SAFARI_UA, 5);
        expect(make().isIOS()).toBeTrue();
      });

      it('still finds a Mac, which has no touch points, not iOS', () => {
        // A pin: the iPad answer must not reach a desktop Mac.
        withDevice(MAC_SAFARI_UA, 0);
        expect(make().isIOS()).toBeFalse();
      });
    });
  });
});
