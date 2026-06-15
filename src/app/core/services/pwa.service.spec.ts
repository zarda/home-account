import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { PwaService, CacheSize, PwaInstallPrompt } from './pwa.service';

describe('PwaService', () => {
  function make(swUpdate?: Partial<SwUpdate>): PwaService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PwaService, ...(swUpdate ? [{ provide: SwUpdate, useValue: swUpdate }] : [])],
    });
    return TestBed.inject(PwaService);
  }

  // An enabled SwUpdate must expose the observables the constructor subscribes to.
  function enabledSw(overrides: Partial<SwUpdate> = {}): Partial<SwUpdate> {
    return {
      isEnabled: true,
      versionUpdates: new Subject(),
      unrecoverable: new Subject(),
      checkForUpdate: () => Promise.resolve(false),
      activateUpdate: () => Promise.resolve(false),
      ...overrides,
    } as unknown as Partial<SwUpdate>;
  }

  it('creates without a service worker', () => {
    expect(make()).toBeTruthy();
  });

  describe('formatBytes', () => {
    it('formats across units', () => {
      const s = make();
      expect(s.formatBytes(0)).toBe('0 Bytes');
      expect(s.formatBytes(512)).toBe('512 Bytes');
      expect(s.formatBytes(1024)).toBe('1 KB');
      expect(s.formatBytes(1024 * 1024)).toBe('1 MB');
      expect(s.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });
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

  describe('install prompt lifecycle', () => {
    it('captures beforeinstallprompt and clears on appinstalled', () => {
      const s = make();
      const event = new Event('beforeinstallprompt');
      spyOn(event, 'preventDefault');
      window.dispatchEvent(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(s.isInstallable()).toBeTrue();

      window.dispatchEvent(new Event('appinstalled'));
      expect(s.isInstallable()).toBeFalse();
      expect(s.isStandalone()).toBeTrue();
    });
  });

  describe('promptInstall', () => {
    it('returns false when no prompt is available', async () => {
      expect(await make().promptInstall()).toBeFalse();
    });

    it('returns true when the user accepts', async () => {
      const s = make();
      (s as unknown as { deferredInstallPrompt: PwaInstallPrompt }).deferredInstallPrompt = {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      };
      expect(await s.promptInstall()).toBeTrue();
    });

    it('returns false when the user dismisses', async () => {
      const s = make();
      (s as unknown as { deferredInstallPrompt: PwaInstallPrompt }).deferredInstallPrompt = {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      };
      expect(await s.promptInstall()).toBeFalse();
    });

    it('returns false when prompting throws', async () => {
      const s = make();
      (s as unknown as { deferredInstallPrompt: PwaInstallPrompt }).deferredInstallPrompt = {
        prompt: () => Promise.reject(new Error('x')),
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      };
      expect(await s.promptInstall()).toBeFalse();
    });
  });

  describe('applyUpdate', () => {
    it('does nothing without an enabled service worker', async () => {
      await expectAsync(make().applyUpdate()).toBeResolved();
    });

    it('handles activation that reports no update', async () => {
      const s = make(enabledSw({ activateUpdate: () => Promise.resolve(false) }));
      await expectAsync(s.applyUpdate()).toBeResolved();
    });

    it('swallows activation errors', async () => {
      const s = make(enabledSw({ activateUpdate: () => Promise.reject(new Error('x')) }));
      await expectAsync(s.applyUpdate()).toBeResolved();
    });
  });

  describe('service worker version updates', () => {
    it('flags an available update on VERSION_READY', () => {
      const versionUpdates = new Subject<{ type: string }>();
      const s = make(enabledSw({ versionUpdates } as unknown as Partial<SwUpdate>));
      expect(s.serviceWorkerReady()).toBeTrue();
      versionUpdates.next({ type: 'VERSION_READY' });
      expect(s.updateAvailable()).toBeTrue();
    });
  });

  describe('service worker messages', () => {
    type Handler = (d: { type: string; payload?: unknown }) => void;

    it('stores cache size from CACHE_SIZE messages', () => {
      const s = make();
      const size: CacheSize = { total: 10, models: 4, static: 3, dynamic: 3 };
      (s as unknown as { handleServiceWorkerMessage: Handler }).handleServiceWorkerMessage({
        type: 'CACHE_SIZE', payload: size,
      });
      expect(s.cacheSize()).toEqual(size);
    });

    it('re-dispatches sync and model-update signals', () => {
      const s = make();
      const events: string[] = [];
      const onSync = () => events.push('sync');
      const onModel = () => events.push('model');
      window.addEventListener('sync-offline-queue', onSync);
      window.addEventListener('check-model-updates', onModel);
      const handler = (s as unknown as { handleServiceWorkerMessage: Handler }).handleServiceWorkerMessage.bind(s);
      handler({ type: 'SYNC_OFFLINE_QUEUE' });
      handler({ type: 'CHECK_MODEL_UPDATES' });
      window.removeEventListener('sync-offline-queue', onSync);
      window.removeEventListener('check-model-updates', onModel);
      expect(events).toEqual(['sync', 'model']);
    });
  });

  describe('cache operations without a controller', () => {
    it('getCacheSize returns zeros', async () => {
      expect(await make().getCacheSize()).toEqual({ total: 0, models: 0, static: 0, dynamic: 0 });
    });

    it('clearModelCache and cacheModels resolve quietly', async () => {
      const s = make();
      await expectAsync(s.clearModelCache()).toBeResolved();
      await expectAsync(s.cacheModels(['/models/a.bin'])).toBeResolved();
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

    it('computes iOS install instructions from internal state', () => {
      const s = make();
      const internal = s as unknown as {
        _isIOS: { set: (v: boolean) => void };
        _isStandalone: { set: (v: boolean) => void };
        _isInstallable: { set: (v: boolean) => void };
      };
      internal._isIOS.set(true);
      internal._isStandalone.set(false);
      internal._isInstallable.set(false);
      expect(s.showIOSInstallInstructions()).toBeTrue();
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
