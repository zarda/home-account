import { TestBed } from '@angular/core/testing';
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

  it('ignores beforeinstallprompt', () => {
    make();
    const event = new Event('beforeinstallprompt');
    spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  describe('service worker messages', () => {
    type Handler = (d: { type: string; payload?: unknown }) => void;

    it('re-dispatches the sync signal', () => {
      const s = make();
      const events: string[] = [];
      const onSync = () => events.push('sync');
      window.addEventListener('sync-offline-queue', onSync);
      const handler = (s as unknown as { handleServiceWorkerMessage: Handler }).handleServiceWorkerMessage.bind(s);
      handler({ type: 'SYNC_OFFLINE_QUEUE' });
      window.removeEventListener('sync-offline-queue', onSync);
      expect(events).toEqual(['sync']);
    });

    it('ignores CACHE_SIZE messages', () => {
      const s = make();
      const dispatchSpy = spyOn(window, 'dispatchEvent').and.callThrough();
      const handler = (s as unknown as { handleServiceWorkerMessage: Handler }).handleServiceWorkerMessage.bind(s);
      expect(() => handler({
        type: 'CACHE_SIZE', payload: { total: 10, models: 4, static: 3, dynamic: 3 },
      })).not.toThrow();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('ignores CHECK_MODEL_UPDATES messages', () => {
      const s = make();
      const onModel = jasmine.createSpy('onModel');
      window.addEventListener('check-model-updates', onModel);
      const handler = (s as unknown as { handleServiceWorkerMessage: Handler }).handleServiceWorkerMessage.bind(s);
      handler({ type: 'CHECK_MODEL_UPDATES' });
      window.removeEventListener('check-model-updates', onModel);
      expect(onModel).not.toHaveBeenCalled();
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
  });

  describe('registerBackgroundSync', () => {
    it('resolves to a boolean without hanging', async () => {
      const s = make();
      const supported =
        'serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype;
      if (supported) {
        Object.defineProperty(navigator.serviceWorker, 'ready', {
          configurable: true,
          value: Promise.resolve({ sync: { register: () => Promise.resolve() } }),
        });
      }
      const result = await s.registerBackgroundSync('sync-offline-queue');
      expect(typeof result).toBe('boolean');
    });
  });
});
