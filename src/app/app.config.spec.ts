import { HttpClient } from '@angular/common/http';
import {
  ANIMATION_MODULE_TYPE,
  EnvironmentInjector,
  EnvironmentProviders,
  ErrorHandler,
  Injector,
  WritableSignal,
  createEnvironmentInjector,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { FirebaseApp } from '@angular/fire/app';
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from '@angular/fire/auth';
import { FirestoreSettings, connectFirestoreEmulator, initializeFirestore } from '@angular/fire/firestore';
import { FirebaseStorage, connectStorageEmulator, getStorage } from '@angular/fire/storage';
import { Analytics, AnalyticsSettings, initializeAnalytics, setConsent } from '@angular/fire/analytics';
import { RemoteConfig } from '@angular/fire/remote-config';

import {
  LEDGER_SWEEP_IDLE_FALLBACK_MS,
  LEDGER_SWEEP_IDLE_TIMEOUT_MS,
  LedgerSweeper,
  NotificationTapArmer,
  appAnalyticsFactory,
  appAuthFactory,
  appConfig,
  appFirestoreFactory,
  appStorageFactory,
  armLedgerSweep,
  armNotificationTaps,
  firestoreCacheTabManager,
  firestorePersistentCacheSettings,
  ledgerSweepHooks,
  notificationTapLoader,
  provideAppAnalytics,
  provideAppRemoteConfig,
  whenBrowserIdle,
} from './app.config';
import { AuthService } from './core/services/auth.service';
import { PwaService } from './core/services/pwa.service';
import { LedgerShareService } from './core/services/ledger-share.service';
import { NotificationTapService } from './core/services/notification-tap.service';
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
  let connect: jasmine.Spy;

  beforeEach(() => {
    order = [];
    auth = { name: 'fake-auth' } as unknown as Auth;
    initialize = jasmine.createSpy('initializeAuth').and.callFake(() => {
      order.push('initializeAuth');
      return auth;
    });
    connect = jasmine.createSpy('connectAuthEmulator').and.callFake(() => void order.push('connect'));
  });

  function build(isNative: boolean, hosts?: typeof EMULATOR_BUILD_HOSTS): Auth {
    return appAuthFactory(
      () => isNative,
      initialize as unknown as typeof initializeAuth,
      () => app,
      hosts,
      connect as unknown as typeof connectAuthEmulator,
    );
  }

  it('should keep the web session in local storage first, where another tab\'s change arrives at once', () => {
    expect(build(false, null)).toBe(auth);

    // Another tab's sign-in or sign-out reaches this one by a storage event,
    // the channel Firestore's multi-tab cache reports that change's refusals
    // on; IndexedDB, getAuth()'s first choice, is polled every 800 ms. Second
    // in the list, IndexedDB is where the SDK looks for a session to carry
    // across, so the first load after the switch keeps whoever was signed in
    // there. The order is the contract: the first available persistence is
    // the one written.
    expect(initialize).toHaveBeenCalledOnceWith(app, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  });

  it('should use local-storage persistence on Capacitor', () => {
    // IndexedDB under the capacitor:// scheme leaves onAuthStateChanged
    // hanging, so the native shell must never be handed it.
    expect(build(true, null)).toBe(auth);
    expect(initialize).toHaveBeenCalledOnceWith(app, { persistence: browserLocalPersistence });
  });

  it('should connect the Auth emulator on http://127.0.0.1:9099 right after creating the instance', () => {
    expect(build(false, EMULATOR_BUILD_HOSTS)).toBe(auth);

    // Before the connect, a restored session would be refreshed against the
    // real project; after the first use the SDK refuses to connect at all.
    expect(connect).toHaveBeenCalledOnceWith(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    expect(order).toEqual(['initializeAuth', 'connect']);
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

/**
 * The tokens `providers` provide, however deep they sit: appConfig nests
 * arrays, and provideRouter, provideHttpClient and the rest return
 * EnvironmentProviders, whose provider array is only reachable through the
 * internal field (the reach providerCount uses above).
 */
function providedTokens(providers: unknown): unknown[] {
  if (Array.isArray(providers)) {
    return providers.flatMap(providedTokens);
  }
  if (typeof providers === 'function') {
    return [providers];
  }
  if (providers && typeof providers === 'object') {
    const nested = (providers as { ɵproviders?: unknown }).ɵproviders;
    if (nested) {
      return providedTokens(nested);
    }
    const { provide } = providers as { provide?: unknown };
    return provide === undefined ? [] : [provide];
  }
  return [];
}

describe('appConfig', () => {
  it('is read through the providers nested inside EnvironmentProviders', () => {
    // The pin below passes on a walk that sees nothing, so the walk is
    // pinned first: ErrorHandler is provided at the top level, HttpClient
    // only inside provideHttpClient()'s EnvironmentProviders.
    const tokens = providedTokens(appConfig.providers);

    expect(tokens).toContain(ErrorHandler);
    expect(tokens).toContain(HttpClient);
  });

  it('leaves the animations module type unprovided, so Material and the CDK animate with plain CSS', () => {
    // provideAnimations() answered this token with 'BrowserAnimations' and
    // pulled the deprecated animations runtime into the initial bundle.
    expect(providedTokens(appConfig.providers)).not.toContain(ANIMATION_MODULE_TYPE);
  });
});

describe('armLedgerSweep', () => {
  interface Armed {
    userId: WritableSignal<string | null>;
    online: WritableSignal<boolean>;
    /** Tasks handed to the idle scheduler and not run yet. */
    idle: (() => void)[];
    load: jasmine.Spy<() => Promise<LedgerSweeper>>;
    sweeper: jasmine.SpyObj<LedgerSweeper>;
  }

  function arm(start: { userId?: string | null; online?: boolean } = {}): Armed {
    const userId = signal<string | null>(start.userId === undefined ? 'u1' : start.userId);
    const online = signal(start.online ?? true);
    const idle: (() => void)[] = [];
    const sweeper = jasmine.createSpyObj<LedgerSweeper>('LedgerSweeper', ['reconcileAll']);
    sweeper.reconcileAll.and.resolveTo();
    const load = jasmine.createSpy<() => Promise<LedgerSweeper>>('load').and.resolveTo(sweeper);
    armLedgerSweep(
      { userId, isOnline: online, whenIdle: task => idle.push(task), load },
      TestBed.inject(Injector),
    );
    TestBed.tick();
    return { userId, online, idle, load, sweeper };
  }

  function change(update: () => void): void {
    update();
    TestBed.tick();
  }

  async function runIdle(armed: Armed): Promise<void> {
    for (const task of armed.idle.splice(0)) task();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('loads the sweep only from an idle task, never while the app starts', () => {
    const armed = arm();

    // The service's chunk is reached only by the idle task's dynamic import,
    // so it is never part of the initial bundle's start-up work.
    expect(armed.idle.length).toBe(1);
    expect(armed.load).not.toHaveBeenCalled();
  });

  it('runs the start-up sweep once per account in a session', async () => {
    const armed = arm();
    await runIdle(armed);
    expect(armed.sweeper.reconcileAll.calls.allArgs()).toEqual([['start']]);

    change(() => armed.userId.set(null));
    change(() => armed.userId.set('u1'));
    expect(armed.idle).toEqual([]);

    change(() => armed.userId.set('u2'));
    await runIdle(armed);
    expect(armed.sweeper.reconcileAll.calls.allArgs()).toEqual([['start'], ['start']]);
  });

  it('schedules nothing for a signed-out account, or offline', () => {
    expect(arm({ userId: null }).idle).toEqual([]);
    expect(arm({ online: false }).idle).toEqual([]);
  });

  it('starts once the account is signed in and online, whichever comes last', async () => {
    const armed = arm({ userId: null, online: false });
    change(() => armed.userId.set('u1'));
    expect(armed.idle).toEqual([]);

    change(() => armed.online.set(true));
    await runIdle(armed);

    // The first sweep of the account is its start-up sweep, not a reconnect.
    expect(armed.sweeper.reconcileAll.calls.allArgs()).toEqual([['start']]);
  });

  it('sweeps again each time the device comes back online', async () => {
    const armed = arm();
    await runIdle(armed);

    change(() => armed.online.set(false));
    change(() => armed.online.set(true));
    await runIdle(armed);

    expect(armed.sweeper.reconcileAll.calls.allArgs()).toEqual([['start'], ['reconnect']]);
  });

  it('drops an idle task whose account signed out before it ran', async () => {
    const armed = arm();
    armed.userId.set(null);
    await runIdle(armed);

    expect(armed.load).not.toHaveBeenCalled();
  });

  it('drops an idle task whose device went offline before it ran', async () => {
    const armed = arm();
    // Not ticked: the effect never hears the change, so only the idle
    // task's own check can drop the sweep already queued.
    armed.online.set(false);
    await runIdle(armed);

    expect(armed.load).not.toHaveBeenCalled();
  });

  it('logs a sweep that does not load or run, and lets nothing reach the error handler', async () => {
    const warn = spyOn(console, 'warn');
    const armed = arm();
    armed.load.and.rejectWith(new Error('the chunk did not load'));
    await runIdle(armed);

    change(() => armed.online.set(false));
    change(() => armed.online.set(true));
    armed.load.and.resolveTo(armed.sweeper);
    armed.sweeper.reconcileAll.and.rejectWith(new Error('the sweep failed'));
    await runIdle(armed);

    expect(warn.calls.allArgs().map(args => [String(args[0]).startsWith('[LedgerShareService]'), String(args[1])]))
      .toEqual([[true, 'Error: the chunk did not load'], [true, 'Error: the sweep failed']]);
  });

  it('never throws, whatever its collaborators do', () => {
    const warn = spyOn(console, 'warn');
    const userId = signal<string | null>('u1');

    expect(() => {
      armLedgerSweep(
        {
          userId,
          isOnline: () => true,
          whenIdle: () => {
            throw new Error('no scheduler');
          },
          load: () => Promise.reject(new Error('unused')),
        },
        TestBed.inject(Injector),
      );
      TestBed.tick();
    }).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('ledgerSweepHooks', () => {
  it('holds no reference to the sweep until its load runs, and then reaches it through the injector', async () => {
    const sweep = { reconcileAll: () => Promise.resolve() };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { userId: () => 'u1' } },
        { provide: PwaService, useValue: { isOnline: () => true } },
        { provide: LedgerShareService, useValue: sweep },
      ],
    });
    const injector = TestBed.inject(Injector);
    const get = spyOn(injector, 'get').and.callThrough();

    const hooks = ledgerSweepHooks(injector);
    expect(get.calls.allArgs().some(([token]) => token === LedgerShareService)).toBeFalse();
    expect(hooks.userId()).toBe('u1');
    expect(hooks.isOnline()).toBeTrue();

    expect(await hooks.load()).toBe(sweep as unknown as LedgerSweeper);
    expect(get.calls.allArgs().some(([token]) => token === LedgerShareService)).toBeTrue();
  });
});

describe('armNotificationTaps', () => {
  interface Armed {
    /** Tasks handed to the idle scheduler and not run yet. */
    idle: (() => void)[];
    load: jasmine.Spy<() => Promise<NotificationTapArmer>>;
    taps: jasmine.SpyObj<NotificationTapArmer>;
  }

  function arm(): Armed {
    const idle: (() => void)[] = [];
    const taps = jasmine.createSpyObj<NotificationTapArmer>('NotificationTapArmer', ['arm']);
    taps.arm.and.resolveTo();
    const load = jasmine.createSpy<() => Promise<NotificationTapArmer>>('load').and.resolveTo(taps);
    armNotificationTaps(load, task => idle.push(task));
    return { idle, load, taps };
  }

  async function runIdle(armed: Armed): Promise<void> {
    for (const task of armed.idle.splice(0)) task();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('loads the tap service only from an idle task on the web, never while the app starts', () => {
    const armed = arm();

    expect(armed.idle.length).toBe(1);
    expect(armed.load).not.toHaveBeenCalled();
  });

  it('loads and arms it at once in the iOS app, where the plugin holds a tap that launched the app', async () => {
    // An idle task attaches the listener seconds after launch, and the held
    // tap would then navigate over wherever the user had gone meanwhile.
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    const armed = arm();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(armed.idle.length).toBe(0);
    expect(armed.load).toHaveBeenCalledTimes(1);
    expect(armed.taps.arm).toHaveBeenCalledTimes(1);
  });

  it('arms the service once the idle task has loaded it', async () => {
    const armed = arm();
    await runIdle(armed);

    expect(armed.load).toHaveBeenCalledTimes(1);
    expect(armed.taps.arm).toHaveBeenCalledTimes(1);
  });

  it('logs a service that does not load or arm, and lets nothing reach the error handler', async () => {
    const warn = spyOn(console, 'warn');
    const notLoaded = arm();
    notLoaded.load.and.rejectWith(new Error('the chunk did not load'));
    await runIdle(notLoaded);
    const notArmed = arm();
    notArmed.taps.arm.and.rejectWith(new Error('the listener was refused'));
    await runIdle(notArmed);

    expect(warn.calls.allArgs().map(args => [String(args[0]).startsWith('[NotificationTapService]'), String(args[1])]))
      .toEqual([[true, 'Error: the chunk did not load'], [true, 'Error: the listener was refused']]);
  });

  it('never throws, whatever its collaborators do', () => {
    const warn = spyOn(console, 'warn');

    expect(() => armNotificationTaps(
      () => Promise.reject(new Error('unused')),
      () => {
        throw new Error('no scheduler');
      },
    )).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('notificationTapLoader', () => {
  it('holds no reference to the tap service until its load runs, and then reaches it through the injector', async () => {
    const taps = { arm: () => Promise.resolve() };
    TestBed.configureTestingModule({
      providers: [{ provide: NotificationTapService, useValue: taps }],
    });
    const injector = TestBed.inject(Injector);
    const get = spyOn(injector, 'get').and.callThrough();

    const load = notificationTapLoader(injector);
    expect(get).not.toHaveBeenCalled();

    expect(await load()).toBe(taps);
    expect(get.calls.allArgs().some(([token]) => token === NotificationTapService)).toBeTrue();
  });
});

describe('whenBrowserIdle', () => {
  it('waits for an idle period, bounded, where the browser has one', () => {
    const task = jasmine.createSpy('task');
    const host = {
      requestIdleCallback: jasmine.createSpy('requestIdleCallback'),
      setTimeout: jasmine.createSpy('setTimeout'),
    };

    whenBrowserIdle(task, host);

    expect(host.setTimeout).not.toHaveBeenCalled();
    expect(host.requestIdleCallback).toHaveBeenCalledOnceWith(jasmine.any(Function), {
      timeout: LEDGER_SWEEP_IDLE_TIMEOUT_MS,
    });
    expect(task).not.toHaveBeenCalled();
    host.requestIdleCallback.calls.mostRecent().args[0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('falls back on a timer where it has none (Safari, the iOS web view)', () => {
    const task = jasmine.createSpy('task');
    const host = { setTimeout: jasmine.createSpy('setTimeout') };

    whenBrowserIdle(task, host);

    expect(host.setTimeout).toHaveBeenCalledOnceWith(jasmine.any(Function), LEDGER_SWEEP_IDLE_FALLBACK_MS);
    host.setTimeout.calls.mostRecent().args[0]();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
