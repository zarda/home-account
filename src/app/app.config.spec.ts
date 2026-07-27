import { EnvironmentInjector, EnvironmentProviders, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FirebaseApp } from '@angular/fire/app';
import { FirestoreSettings, initializeFirestore } from '@angular/fire/firestore';
import { Analytics, AnalyticsSettings, initializeAnalytics, setConsent } from '@angular/fire/analytics';

import {
  appAnalyticsFactory,
  appFirestoreFactory,
  firestoreCacheTabManager,
  firestorePersistentCacheSettings,
  provideAppAnalytics,
} from './app.config';

// The Firestore cache wiring is asserted through the exported factories
// (rather than through a live Firestore instance) because instantiating the
// SDK inside the Karma suite leaves background work that stalls the browser
// teardown after the run completes.
//
// Known limitation: the final links — appConfig actually handing
// `() => appFirestoreFactory()` to provideFirestore, and
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
});

// The analytics wiring is asserted through the same kind of exported seams,
// and for a sharper reason than the Firestore ones: resolving the Analytics
// token is itself the irreversible step. It injects the gtag script, issues
// the config command and opens a dynamic-config request, so a test that built
// a real instance would be doing the exact thing the consent gate exists to
// prevent.

/**
 * provideAppAnalytics returns EnvironmentProviders, whose provider array is
 * only reachable through the internal field. Resolving the token instead is
 * not an option for the positive case, per the note above.
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
