import { FirebaseApp } from '@angular/fire/app';
import { FirestoreSettings, initializeFirestore } from '@angular/fire/firestore';

import {
  appFirestoreFactory,
  firestoreCacheTabManager,
  firestorePersistentCacheSettings,
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
