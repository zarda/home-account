import { EnvironmentInjector, EnvironmentProviders, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FirebaseApp } from '@angular/fire/app';
import { Auth, browserLocalPersistence, connectAuthEmulator, getAuth, initializeAuth } from '@angular/fire/auth';
import { FirestoreSettings, connectFirestoreEmulator, initializeFirestore } from '@angular/fire/firestore';
import { FirebaseStorage, connectStorageEmulator, getStorage } from '@angular/fire/storage';
import { Analytics, AnalyticsSettings, initializeAnalytics, setConsent } from '@angular/fire/analytics';
import { RemoteConfig } from '@angular/fire/remote-config';

import {
  appAnalyticsFactory,
  appAuthFactory,
  appFirestoreFactory,
  appStorageFactory,
  firestoreCacheTabManager,
  firestorePersistentCacheSettings,
  provideAppAnalytics,
  provideAppRemoteConfig,
} from './app.config';
// The hosts the `emulators` build configuration swaps in; imported directly
// because the unit build compiles the committed, null EMULATOR_HOSTS.
import { EMULATOR_HOSTS as EMULATOR_BUILD_HOSTS } from '../environments/emulators.on';

// The Firestore cache wiring is asserted through the exported factories
// (rather than through a live Firestore instance) because instantiating the
// SDK inside the Karma suite leaves background work that stalls the browser
// teardown after the run completes.
//
// The emulator connects go through the same kind of seam: each factory takes
// the hosts and the connect call as defaulted parameters, and the fakes stand
// in for the SDK.
//
// Known limitation: the final links — appConfig actually handing
// `() => appFirestoreFactory()`, `() => appAuthFactory()` and
// `() => appStorageFactory()` to their providers, and
// firestorePersistentCacheSettings actually forwarding the tab manager into
// persistentLocalCache — are single lines that cannot be asserted without
// booting Firebase or probing private SDK fields, so they stay covered by
// review only.

describe('firestoreCacheTabManager', () => {
  it('should choose the multi-tab manager so open tabs share one cache', () => {
    // 'PersistentMultipleTab' is the public discriminant of
    // PersistentMultipleTabManager; persistentSingleTabManager() (the
    // default when no tabManager option is passed) reports
    // 'persistentSingleTab'. Single-tab would make a second open tab fail
    // with failed-precondition errors instead of sharing the cache.
    expect(firestoreCacheTabManager().kind).toBe('PersistentMultipleTab');
  });
});

describe('firestorePersistentCacheSettings', () => {
  it('should configure a persistent (IndexedDB) local cache for offline reads', () => {
    const settings = firestorePersistentCacheSettings();

    // 'persistent' is the documented kind of an IndexedDB-backed cache; the
    // default in-memory cache reports 'memory'. Persistent storage is what
    // lets previously loaded documents render while offline.
    expect(settings.localCache?.kind).toBe('persistent');
  });

  it('should build an independent cache per call so each Firestore instance gets its own', () => {
    const first = firestorePersistentCacheSettings();
    const second = firestorePersistentCacheSettings();

    // initializeFirestore freezes the settings per instance; sharing one
    // cache object across instances would share its component providers.
    expect(first.localCache).toBeDefined();
    expect(first.localCache).not.toBe(second.localCache);
  });
});

describe('appFirestoreFactory', () => {
  it('should initialize Firestore on the current app with the persistent cache settings', () => {
    const app = { name: 'test-app' } as unknown as FirebaseApp;
    const firestore = {} as ReturnType<typeof initializeFirestore>;
    const initialize = jasmine.createSpy('initializeFirestore').and.returnValue(firestore);

    const result = appFirestoreFactory(
      initialize as unknown as typeof initializeFirestore,
      () => app,
    );

    // Reverting the provider to a plain getFirestore() would silently drop
    // the offline cache: the factory must call initializeFirestore with the
    // app and the settings factory's output.
    expect(result).toBe(firestore);
    expect(initialize).toHaveBeenCalledTimes(1);
    const [calledApp, settings] = initialize.calls.mostRecent().args as [
      FirebaseApp,
      FirestoreSettings,
    ];
    expect(calledApp).toBe(app);
    expect(settings.localCache?.kind).toBe('persistent');
  });

  describe('emulator hosts', () => {
    const app = { name: 'test-app' } as unknown as FirebaseApp;
    let order: string[];
    let firestore: ReturnType<typeof initializeFirestore>;
    let initialize: jasmine.Spy;
    let connect: jasmine.Spy;

    beforeEach(() => {
      order = [];
      firestore = {} as ReturnType<typeof initializeFirestore>;
      initialize = jasmine.createSpy('initializeFirestore').and.callFake(() => {
        order.push('initialize');
        return firestore;
      });
      connect = jasmine.createSpy('connectFirestoreEmulator').and.callFake(() => void order.push('connect'));
    });

    it('should connect the Firestore emulator on 127.0.0.1:8080 right after initializing', () => {
      const result = appFirestoreFactory(
        initialize as unknown as typeof initializeFirestore,
        () => app,
        EMULATOR_BUILD_HOSTS,
        connect as unknown as typeof connectFirestoreEmulator,
      );

      // Any read or write before the connect goes to the real project, and
      // the SDK refuses a connect once the instance has been used.
      expect(result).toBe(firestore);
      expect(connect).toHaveBeenCalledOnceWith(firestore, '127.0.0.1', 8080);
      expect(order).toEqual(['initialize', 'connect']);
    });

    it('should connect nothing when the build names no hosts', () => {
      const result = appFirestoreFactory(
        initialize as unknown as typeof initializeFirestore,
        () => app,
        null,
        connect as unknown as typeof connectFirestoreEmulator,
      );

      expect(result).toBe(firestore);
      expect(connect).not.toHaveBeenCalled();
    });

    it('should default to the committed hosts, which name no emulator', () => {
      appFirestoreFactory(
        initialize as unknown as typeof initializeFirestore,
        () => app,
        undefined,
        connect as unknown as typeof connectFirestoreEmulator,
      );

      expect(connect).not.toHaveBeenCalled();
    });
  });
});

describe('appAuthFactory', () => {
  const app = { name: 'test-app' } as unknown as FirebaseApp;
  let order: string[];
  let auth: Auth;
  let initialize: jasmine.Spy;
  let get: jasmine.Spy;
  let connect: jasmine.Spy;

  beforeEach(() => {
    order = [];
    auth = { name: 'fake-auth' } as unknown as Auth;
    initialize = jasmine.createSpy('initializeAuth').and.callFake(() => {
      order.push('initializeAuth');
      return auth;
    });
    get = jasmine.createSpy('getAuth').and.callFake(() => {
      order.push('getAuth');
      return auth;
    });
    connect = jasmine.createSpy('connectAuthEmulator').and.callFake(() => void order.push('connect'));
  });

  function build(isNative: boolean, hosts?: typeof EMULATOR_BUILD_HOSTS): Auth {
    return appAuthFactory(
      () => isNative,
      initialize as unknown as typeof initializeAuth,
      get as unknown as typeof getAuth,
      () => app,
      hosts,
      connect as unknown as typeof connectAuthEmulator,
    );
  }

  it('should keep the default (IndexedDB) persistence on the web', () => {
    expect(build(false, null)).toBe(auth);
    expect(get).toHaveBeenCalledOnceWith(app);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('should use local-storage persistence on Capacitor', () => {
    // IndexedDB under the capacitor:// scheme leaves onAuthStateChanged
    // hanging, so the native shell must never get the default persistence.
    expect(build(true, null)).toBe(auth);
    expect(initialize).toHaveBeenCalledOnceWith(app, { persistence: browserLocalPersistence });
    expect(get).not.toHaveBeenCalled();
  });

  it('should connect the Auth emulator on http://127.0.0.1:9099 right after creating the instance', () => {
    expect(build(false, EMULATOR_BUILD_HOSTS)).toBe(auth);

    // Before the connect, a restored session would be refreshed against the
    // real project; after the first use the SDK refuses to connect at all.
    expect(connect).toHaveBeenCalledOnceWith(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    expect(order).toEqual(['getAuth', 'connect']);
  });

  it('should connect the Auth emulator on the Capacitor path too', () => {
    build(true, EMULATOR_BUILD_HOSTS);

    expect(connect).toHaveBeenCalledOnceWith(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    expect(order).toEqual(['initializeAuth', 'connect']);
  });

  it('should connect nothing when the build names no hosts', () => {
    build(false, null);
    build(true, null);

    expect(connect).not.toHaveBeenCalled();
  });

  it('should default to the committed hosts, which name no emulator', () => {
    build(false);

    expect(connect).not.toHaveBeenCalled();
  });
});

describe('appStorageFactory', () => {
  const app = { name: 'test-app' } as unknown as FirebaseApp;
  let order: string[];
  let storage: FirebaseStorage;
  let get: jasmine.Spy;
  let connect: jasmine.Spy;

  beforeEach(() => {
    order = [];
    storage = { app } as unknown as FirebaseStorage;
    get = jasmine.createSpy('getStorage').and.callFake(() => {
      order.push('getStorage');
      return storage;
    });
    connect = jasmine.createSpy('connectStorageEmulator').and.callFake(() => void order.push('connect'));
  });

  function build(hosts?: typeof EMULATOR_BUILD_HOSTS): FirebaseStorage {
    return appStorageFactory(
      get as unknown as typeof getStorage,
      () => app,
      hosts,
      connect as unknown as typeof connectStorageEmulator,
    );
  }

  it('should take the storage instance of the current app', () => {
    expect(build(null)).toBe(storage);
    expect(get).toHaveBeenCalledOnceWith(app);
  });

  it('should connect the Storage emulator on 127.0.0.1:9199 right after creating the instance', () => {
    expect(build(EMULATOR_BUILD_HOSTS)).toBe(storage);

    expect(connect).toHaveBeenCalledOnceWith(storage, '127.0.0.1', 9199);
    expect(order).toEqual(['getStorage', 'connect']);
  });

  it('should connect nothing when the build names no hosts', () => {
    build(null);

    expect(connect).not.toHaveBeenCalled();
  });

  it('should default to the committed hosts, which name no emulator', () => {
    build();

    expect(connect).not.toHaveBeenCalled();
  });
});

// The analytics wiring is asserted through the same kind of exported seams,
// and for a sharper reason than the Firestore ones: resolving the Analytics
// token is itself the irreversible step. It injects the gtag script, issues
// the config command and opens a dynamic-config request, so a test that built
// a real instance would be doing the exact thing the consent gate exists to
// prevent.

/**
 * provideAppAnalytics and provideAppRemoteConfig return EnvironmentProviders,
 * whose provider array is only reachable through the internal field. Resolving
 * the token instead is not an option for the positive case: it builds a real
 * SDK instance, per the note above.
 */
function providerCount(providers: EnvironmentProviders): number {
  return (providers as unknown as { ɵproviders: unknown[] }).ɵproviders.length;
}

describe('appAnalyticsFactory', () => {
  it('should push the consent defaults before creating the instance', () => {
    const order: string[] = [];
    const consent = jasmine.createSpy('setConsent').and.callFake(() => void order.push('consent'));
    const initialize = jasmine.createSpy('initializeAnalytics').and.callFake(() => {
      order.push('initialize');
      return {} as Analytics;
    });

    appAnalyticsFactory(
      initialize as unknown as typeof initializeAnalytics,
      consent as unknown as typeof setConsent,
      () => ({ name: 'test-app' }) as unknown as FirebaseApp,
    );

    // Called before an instance exists, setConsent is replayed as
    // gtag('consent','default',…) ahead of the config command. Called after,
    // it is only an update and arrives behind the first hit — so swapping
    // these two lines would send that hit under the default advertising
    // consent.
    expect(order).toEqual(['consent', 'initialize']);
    expect(consent.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      }),
    );
  });

  it('should suppress the automatic page view and the advertising signals', () => {
    const initialize = jasmine.createSpy('initializeAnalytics').and.returnValue({} as Analytics);

    appAnalyticsFactory(
      initialize as unknown as typeof initializeAnalytics,
      (() => undefined) as unknown as typeof setConsent,
      () => ({ name: 'test-app' }) as unknown as FirebaseApp,
    );

    const [, options] = initialize.calls.mostRecent().args as [unknown, AnalyticsSettings];
    // Reverting to getAnalytics() would drop all three: it takes no options,
    // and its config command fires a page_view no later call can undo.
    expect(options.config).toEqual(
      jasmine.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      }),
    );
  });

  it('should hand the SDK its own copy of the config', () => {
    const initialize = jasmine.createSpy('initializeAnalytics').and.returnValue({} as Analytics);

    appAnalyticsFactory(
      initialize as unknown as typeof initializeAnalytics,
      (() => undefined) as unknown as typeof setConsent,
      () => ({ name: 'test-app' }) as unknown as FirebaseApp,
    );
    const [, first] = initialize.calls.mostRecent().args as [unknown, AnalyticsSettings];
    (first.config as Record<string, unknown>)['injected'] = true;

    appAnalyticsFactory(
      initialize as unknown as typeof initializeAnalytics,
      (() => undefined) as unknown as typeof setConsent,
      () => ({ name: 'test-app' }) as unknown as FirebaseApp,
    );
    const [, second] = initialize.calls.mostRecent().args as [unknown, AnalyticsSettings];

    // The SDK writes its own keys (origin, update, the installation id) into
    // whatever object it is handed, so passing the shared const by reference
    // would pollute it for every later call.
    expect((second.config as Record<string, unknown>)['injected']).toBeUndefined();
  });
});

describe('provideAppAnalytics', () => {
  it('should withhold the Analytics token on Capacitor', () => {
    const injector = createEnvironmentInjector(
      [provideAppAnalytics(() => true, () => true)],
      TestBed.inject(EnvironmentInjector),
    );

    // A gtag hit from inside the WKWebView lands in the web data stream, not
    // the iOS app stream. Nothing to inject means nothing can make that
    // mistake, and the native transport is the only path left.
    expect(injector.get(Analytics, null)).toBeNull();
  });

  it('should withhold the Analytics token when the build has no real measurement id', () => {
    const injector = createEnvironmentInjector(
      [provideAppAnalytics(() => false, () => false)],
      TestBed.inject(EnvironmentInjector),
    );

    // The committed templates and the CI stubs both land here, so a
    // placeholder build boots normally and stays silent.
    expect(injector.get(Analytics, null)).toBeNull();
  });

  it('should register the Analytics providers only for a configured web build', () => {
    expect(providerCount(provideAppAnalytics(() => false, () => true))).toBeGreaterThan(0);
    expect(providerCount(provideAppAnalytics(() => true, () => true))).toBe(0);
    expect(providerCount(provideAppAnalytics(() => false, () => false))).toBe(0);
  });
});

describe('provideAppRemoteConfig', () => {
  it('should withhold the Remote Config token from a build served against the emulators', () => {
    const injector = createEnvironmentInjector(
      [provideAppRemoteConfig(EMULATOR_BUILD_HOSTS)],
      TestBed.inject(EnvironmentInjector),
    );

    // Remote Config has no emulator. Once the token resolves, RemoteConfigService
    // fetches with the emulators build's demo API key from the live endpoints,
    // which refuse it; with nothing to resolve, it keeps its in-app defaults.
    expect(injector.get(RemoteConfig, null)).toBeNull();
  });

  it('should register the Remote Config providers only when the build names no emulator', () => {
    expect(providerCount(provideAppRemoteConfig(null))).toBeGreaterThan(0);
    expect(providerCount(provideAppRemoteConfig(EMULATOR_BUILD_HOSTS))).toBe(0);
  });

  it('should default to the committed hosts, which name no emulator', () => {
    expect(providerCount(provideAppRemoteConfig())).toBeGreaterThan(0);
  });
});
