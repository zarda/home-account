// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) for the same compatibility reason as the FirestoreService suite.
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import {
  Auth,
  getAuth,
  initializeAuth,
  connectAuthEmulator,
  signInAnonymously
} from '@angular/fire/auth';
import { appAuthFactory } from './app.config';
// The hosts the `emulators` build configuration swaps in, as app.config.spec.ts
// imports them: the smoke build compiles the committed, null EMULATOR_HOSTS.
import { EMULATOR_HOSTS as EMULATOR_BUILD_HOSTS } from '../environments/emulators.on';
import { silenceFirebaseWarnings } from './core/services/testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Where appAuthFactory keeps the web session, against the auth emulator.
 *
 * The unit spec pins the persistence list the factory hands the SDK; what the
 * SDK then does with it is only visible here. Two things rest on it: a session
 * the former getAuth() stored in IndexedDB is carried into local storage, so
 * the next load keeps the account signed in, and a change another tab writes
 * reaches this page by a storage event, the channel Firestore's multi-tab
 * cache reports that change's refusals on, instead of by IndexedDB's 800 ms
 * poll.
 *
 * A suite cannot open a second tab. Another document on the origin stands for
 * it: a same-origin frame whose own localStorage writes the change, which the
 * browser announces to every other document on the origin and never to the
 * writer. The frame writes exactly what the other tab's SDK writes on a
 * sign-out, the removal of the session's key.
 *
 * Auth instances only: no Firestore client is opened, so the two-client limit
 * in docs/testing.md is untouched. Each case names its own app, and clears
 * the key it used from both stores, because both outlive the case.
 */
describe('appAuthFactory (emulator smoke test)', () => {
  const API_KEY = 'fake-api-key';
  const OPTIONS = { apiKey: API_KEY, projectId: 'demo-home-account' };
  const AUTH_URL = 'http://127.0.0.1:9099';
  // The store the SDK's IndexedDB persistence keeps its records in, each
  // record `{ fbase_key, value }`.
  const IDB_NAME = 'firebaseLocalStorageDb';
  const IDB_STORE = 'firebaseLocalStorage';

  let apps: FirebaseApp[];
  let keys: string[];

  beforeEach(() => {
    apps = [];
    keys = [];
  });

  afterEach(async () => {
    for (const app of apps) await deleteApp(app).catch(() => undefined);
    for (const key of keys) {
      localStorage.removeItem(key);
      await indexedDbRequest('readwrite', store => store.delete(key));
    }
  });

  /** The key the SDK stores an app's session under, in either store. */
  function sessionKey(appName: string): string {
    return `firebase:authUser:${API_KEY}:${appName}`;
  }

  /** The web branch of the factory, connected to the emulator as the `emulators` build is. */
  function webAuth(app: FirebaseApp): Auth {
    return appAuthFactory(() => false, initializeAuth, () => app, EMULATOR_BUILD_HOSTS, connectAuthEmulator);
  }

  /**
   * One request against the SDK's IndexedDB store, resolving with its result.
   * Creates nothing: a database that does not exist yet aborts its upgrade and
   * answers undefined, so the SDK still builds its own store when it first
   * opens it.
   */
  function indexedDbRequest(
    mode: IDBTransactionMode,
    request: (store: IDBObjectStore) => IDBRequest
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(IDB_NAME);
      open.onupgradeneeded = () => open.transaction!.abort();
      open.onerror = () => (open.error?.name === 'AbortError' ? resolve(undefined) : reject(open.error));
      open.onsuccess = () => {
        const db = open.result;
        const pending = request(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
        pending.onsuccess = () => {
          db.close();
          resolve(pending.result);
        };
        pending.onerror = () => {
          db.close();
          reject(pending.error);
        };
      };
    });
  }

  /** The session record IndexedDB holds under `key`, or undefined. */
  function indexedDbSession(key: string): Promise<unknown> {
    return indexedDbRequest('readonly', store => store.get(key));
  }

  /**
   * Signs a fresh account in on its own app through getAuth(), the factory's
   * former web branch, whose first choice is IndexedDB: the session every web
   * user holds today. The app is deleted after, as closing the page ends it.
   */
  async function sessionKeptByGetAuth(name: string): Promise<string> {
    const former = initializeApp(OPTIONS, name);
    try {
      const auth = getAuth(former);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      return (await signInAnonymously(auth)).user.uid;
    } finally {
      await deleteApp(former);
    }
  }

  /**
   * Resolves with `read()` taken in the turn after the next storage event for
   * `key`. The SDK's handler for that event awaits nothing but promises, so by
   * then it has run its course with no timer of its own. Rejects when no event
   * comes at all, which is what a session kept in IndexedDB gives: a change
   * there raises none.
   */
  function afterStorageEvent<T>(key: string, read: () => T, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        clearTimeout(timer);
        window.removeEventListener('storage', onStorage);
        setTimeout(() => resolve(read()), 0);
      };
      const timer = setTimeout(() => {
        window.removeEventListener('storage', onStorage);
        reject(new Error(`no storage event for ${key}`));
      }, timeoutMs);
      window.addEventListener('storage', onStorage);
    });
  }

  it('carries a session the former getAuth() kept in IndexedDB into local storage, keeping the account signed in on the next load', async () => {
    const name = `auth-persistence-carry-${Date.now()}`;
    const key = sessionKey(name);
    keys.push(key);
    const uid = await sessionKeptByGetAuth(name);
    expect(await indexedDbSession(key)).toEqual(
      jasmine.objectContaining({ value: jasmine.objectContaining({ uid }) })
    );
    expect(localStorage.getItem(key)).toBeNull();

    // The next page load: the same app name and API key, so the same key,
    // with the instance built by the factory.
    const app = initializeApp(OPTIONS, name);
    apps.push(app);
    const auth = webAuth(app);
    await auth.authStateReady();

    expect(auth.currentUser?.uid).toBe(uid);
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(jasmine.objectContaining({ uid }));
    // Left behind, an IndexedDB copy would sign the account back in on a
    // later load after a sign-out had removed the local-storage one.
    expect(await indexedDbSession(key)).toBeUndefined();
  });

  it('hears another tab sign the session out in the turn the change is written', async () => {
    const name = `auth-persistence-hear-${Date.now()}`;
    const key = sessionKey(name);
    keys.push(key);
    const app = initializeApp(OPTIONS, name);
    apps.push(app);
    const auth = webAuth(app);
    await auth.authStateReady();
    const uid = (await signInAnonymously(auth)).user.uid;
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(jasmine.objectContaining({ uid }));

    const delivered: (string | null)[] = [];
    const unsubscribe = auth.onAuthStateChanged(user => void delivered.push(user?.uid ?? null));
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const heard = afterStorageEvent(key, () => auth.currentUser?.uid ?? null);
      frame.contentWindow!.localStorage.removeItem(key);

      expect(await heard).toBeNull();
      expect(delivered).toEqual([uid, null]);
    } finally {
      unsubscribe();
      frame.remove();
    }
  });
});
