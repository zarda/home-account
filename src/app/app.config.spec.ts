import { firestorePersistentCacheSettings } from './app.config';

describe('firestorePersistentCacheSettings', () => {
  // The settings are asserted directly (rather than through a live Firestore
  // instance) because instantiating the SDK inside the Karma suite leaves
  // background work that stalls the browser teardown after the run completes.

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
