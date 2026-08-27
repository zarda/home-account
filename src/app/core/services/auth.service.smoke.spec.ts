// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) for the same compatibility reason as the FirestoreService suite.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  terminate,
  disableNetwork,
  enableNetwork,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';
import { SecurityLogService } from './security-log.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';
import { DEFAULT_USER_PREFERENCES } from '../../models';

/**
 * Integration smoke test for AuthService against the auth and Firestore
 * emulators: the create and existing branches of the profile load, the
 * profile-load failure path (a signed-in auth user whose Firestore is
 * unreachable must stay signed in on a degraded fallback profile, not be
 * bounced to login), and the three profile/preference write paths with
 * their exact written shapes.
 *
 * The module-level @angular/fire calls the service makes cannot be spied on,
 * which is why this coverage runs against the emulator rather than in the
 * unit spec (which covers the pure seam and the signal contracts).
 */
describe('AuthService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  function stubProviders() {
    return [
      {
        provide: TranslationService,
        useValue: {
          syncFromDatabase: jasmine.createSpy('syncFromDatabase'),
          t: jasmine.createSpy('t').and.callFake((k: string) => k)
        }
      },
      { provide: ThemeService, useValue: { init: jasmine.createSpy('init') } },
      { provide: AccessibilityService, useValue: { init: jasmine.createSpy('init') } },
      {
        provide: SecurityLogService,
        useValue: { record: jasmine.createSpy('record').and.resolveTo() }
      },
      {
        provide: NotificationService,
        useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info'])
      },
      // Offline by default so the profile-retry effect only runs when a
      // spec flips it deliberately.
      { provide: PwaService, useValue: { isOnline: signal(false) } }
    ];
  }

  async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  describe('profile load and writes', () => {
    let app: FirebaseApp;
    let auth: Auth;
    let firestore: ReturnType<typeof getFirestore>;
    let uid: string;

    beforeAll(async () => {
      app = initializeApp(
        { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
        `auth-smoke-${Date.now()}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
      uid = (await signInAnonymously(auth)).user.uid;
    });

    afterAll(async () => {
      await deleteApp(app).catch(() => undefined);
    });

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: Auth, useValue: auth },
          { provide: Firestore, useValue: firestore },
          ...stubProviders()
        ]
      });
    });

    function userRef() {
      return doc(firestore, 'users', uid);
    }

    async function authedService(): Promise<AuthService> {
      const service = TestBed.inject(AuthService);
      await waitFor(() => service.isAuthenticated(), 'the profile load');
      return service;
    }

    it('creates the profile document with defaults on first sign-in', async () => {
      await deleteDoc(userRef());

      const service = await authedService();

      expect(service.currentUser()!.id).toBe(uid);
      expect(service.userId()).toBe(uid);
      expect(service.isLoading()).toBeFalse();
      expect(service.firebaseUser()!.uid).toBe(uid);

      const written = (await getDoc(userRef())).data()!;
      expect(written['email']).toBe('');
      expect(written['displayName']).toBe('User');
      expect(written['preferences']).toEqual(DEFAULT_USER_PREFERENCES as unknown as Record<string, unknown>);
      // An anonymous account has no photo; the key must be absent, not null.
      expect('photoURL' in written).toBeFalse();
    });

    it('returns the stored profile and bumps lastLoginAt when one exists', async () => {
      await setDoc(userRef(), {
        email: 'seeded@example.com',
        displayName: 'Seeded Name',
        createdAt: Timestamp.fromMillis(1_000),
        lastLoginAt: Timestamp.fromMillis(1_000),
        preferences: DEFAULT_USER_PREFERENCES
      });

      const service = await authedService();

      // The stored document won, rather than a fresh default profile.
      expect(service.currentUser()!.displayName).toBe('Seeded Name');
      expect(service.currentUser()!.email).toBe('seeded@example.com');

      // The lastLoginAt bump is deliberately not awaited by the service (an
      // offline launch must not block on it), so poll for it here.
      let stored = (await getDoc(userRef())).data()!;
      const start = Date.now();
      while ((stored['lastLoginAt'] as Timestamp).toMillis() <= 1_000) {
        if (Date.now() - start > 5000) break;
        await new Promise(resolve => setTimeout(resolve, 25));
        stored = (await getDoc(userRef())).data()!;
      }
      expect((stored['lastLoginAt'] as Timestamp).toMillis()).toBeGreaterThan(1_000);
      expect((stored['createdAt'] as Timestamp).toMillis()).toBe(1_000);
    });

    it('updateUserPreferences sends only the touched key, so concurrent edits survive', async () => {
      const service = await authedService();
      const before = service.currentUser()!.preferences;

      // An edit from "another device", landing after this session read its
      // snapshot. The whole-map rewrite this method used to do would revert
      // it; the per-field write must not.
      await updateDoc(userRef(), { 'preferences.theme': 'dark' });

      await service.updateUserPreferences({ baseCurrency: 'EUR' });

      const written = (await getDoc(userRef())).data()!['preferences'] as Record<string, unknown>;
      expect(written['baseCurrency']).toBe('EUR');
      expect(written['theme']).toBe('dark');
      expect(service.currentUser()!.preferences).toEqual({ ...before, baseCurrency: 'EUR' });
    });

    it('clearStoredProviderApiKeys deletes the legacy fields without clobbering the map', async () => {
      await updateDoc(userRef(), {
        'preferences.geminiApiKey': 'legacy-g',
        'preferences.openaiApiKey': 'legacy-o',
        'preferences.claudeApiKey': 'legacy-c'
      });
      const service = await authedService();

      await service.clearStoredProviderApiKeys();

      const written = (await getDoc(userRef())).data()!['preferences'] as Record<string, unknown>;
      expect('geminiApiKey' in written).toBeFalse();
      expect('openaiApiKey' in written).toBeFalse();
      expect('claudeApiKey' in written).toBeFalse();
      expect(written['language']).toBeDefined();
      const local = service.currentUser()!.preferences as unknown as Record<string, unknown>;
      expect('geminiApiKey' in local).toBeFalse();
    });

    it('updateUserProfile patches the named fields in place', async () => {
      const service = await authedService();

      await service.updateUserProfile({ displayName: 'Renamed' });

      expect((await getDoc(userRef())).data()!['displayName']).toBe('Renamed');
      expect(service.currentUser()!.displayName).toBe('Renamed');
    });
  });

  describe('profile-load failure', () => {
    let app: FirebaseApp;
    let auth: Auth;
    let firestore: ReturnType<typeof getFirestore>;

    beforeAll(async () => {
      app = initializeApp(
        { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
        `auth-smoke-broken-${Date.now()}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
      await signInAnonymously(auth);
      // Every Firestore call from here on rejects immediately: a signed-in
      // auth user whose profile cannot be loaded.
      await terminate(firestore);
    });

    afterAll(async () => {
      await deleteApp(app).catch(() => undefined);
    });

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: Auth, useValue: auth },
          { provide: Firestore, useValue: firestore },
          ...stubProviders()
        ]
      });
    });

    it('stays signed in on a degraded fallback profile instead of bouncing to login', async () => {
      spyOn(console, 'error');
      const service = TestBed.inject(AuthService);

      await waitFor(() => !service.isLoading(), 'the listener to settle');

      // The Firebase session is valid; only the profile read failed. Nulling
      // the user here used to make isAuthenticated false and the guard
      // bounce a signed-in user to /login with no explanation.
      expect(service.firebaseUser()).not.toBeNull();
      expect(service.currentUser()).not.toBeNull();
      expect(service.currentUser()!.id).toBe(auth.currentUser!.uid);
      expect(service.isAuthenticated()).toBeTrue();
      expect(service.profileDegraded()).toBeTrue();

      // The cause is logged and the user is told (AC: explanation + retry).
      expect(console.error).toHaveBeenCalled();
      const notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
      expect(notifications.error).toHaveBeenCalledWith('auth.profileLoadDegraded');
    });

    it('a reconnect retry against still-broken Firestore stays safely degraded', async () => {
      spyOn(console, 'error');
      const service = TestBed.inject(AuthService);
      await waitFor(() => !service.isLoading(), 'the listener to settle');
      expect(service.profileDegraded()).toBeTrue();

      const pwa = TestBed.inject(PwaService) as unknown as {
        isOnline: ReturnType<typeof signal<boolean>>;
      };
      pwa.isOnline.set(true);
      TestBed.tick();
      // Give the failed re-read a moment to settle.
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(service.isAuthenticated()).toBeTrue();
      expect(service.profileDegraded()).toBeTrue();
    });

  });

  describe('sign-out', () => {
    let app: FirebaseApp;
    let auth: Auth;
    let firestore: ReturnType<typeof getFirestore>;

    beforeAll(async () => {
      app = initializeApp(
        { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
        `auth-smoke-signout-${Date.now()}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
      await signInAnonymously(auth);
    });

    afterAll(async () => {
      await deleteApp(app).catch(() => undefined);
    });

    it('clears the user signals', async () => {
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: Auth, useValue: auth },
          { provide: Firestore, useValue: firestore },
          ...stubProviders()
        ]
      });
      const service = TestBed.inject(AuthService);
      await waitFor(() => service.isAuthenticated(), 'the profile load');

      await service.signOut();

      expect(service.currentUser()).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
      // The SDK's own state is already null here, before the listener has
      // observed anything. That ordering is what the session-identity guard
      // rests on: auth.currentUser leads the firebaseUser signal, which is
      // written from the listener a beat later, so only the SDK can answer
      // "is this still the session that started the read" in time.
      expect(auth.currentUser).toBeNull();
      await waitFor(() => service.firebaseUser() === null, 'the listener to observe the sign-out');
    });
  });

  /**
   * The retry effect's SUCCESS path, which nothing else reaches: the
   * profile-load failure block above terminates its Firestore, so every read
   * there rejects and its retry can only ever land in .catch — the one branch
   * the session-identity guard does not sit on.
   *
   * The degraded state is armed through the public signal rather than induced
   * by a real failure. Inducing one is not reliable here: with the network
   * disabled and a cold cache the profile read does not fail, it falls
   * through to the create path and succeeds. What matters is that everything
   * after the arming is real — a real Firestore read, a real effect, and the
   * real guard deciding whether its answer may be written.
   */
  describe('degraded recovery', () => {
    let app: FirebaseApp;
    let auth: Auth;
    let firestore: ReturnType<typeof getFirestore>;

    beforeAll(async () => {
      app = initializeApp(
        { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
        `auth-smoke-recovery-${Date.now()}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
      await signInAnonymously(auth);
    });

    afterAll(async () => {
      await deleteApp(app).catch(() => undefined);
    });

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: Auth, useValue: auth },
          { provide: Firestore, useValue: firestore },
          ...stubProviders()
        ]
      });
    });

    it('a reconnect retry swaps the real profile in for the session that is still live', async () => {
      const service = TestBed.inject(AuthService);
      await waitFor(() => service.isAuthenticated(), 'the profile load');
      const uid = auth.currentUser!.uid;
      await setDoc(doc(firestore, 'users', uid), { displayName: 'Recovered' }, { merge: true });

      service.currentUser.set({ id: uid, displayName: 'Fallback' } as never);
      service.profileDegraded.set(true);
      (TestBed.inject(PwaService) as unknown as {
        isOnline: ReturnType<typeof signal<boolean>>;
      }).isOnline.set(true);
      // Out of the current turn: Firestore's callbacks run inside the Angular
      // zone, so a tick issued here can land inside one already in progress.
      await new Promise(resolve => setTimeout(resolve, 0));
      TestBed.tick();

      await waitFor(() => !service.profileDegraded(), 'the retry to swap in the real profile');
      // The stored document, not the in-memory fallback it replaced.
      expect(service.currentUser()!.displayName).toBe('Recovered');
      expect(service.currentUser()!.id).toBe(uid);
      expect(service.isAuthenticated()).toBeTrue();
    });

    it('signing back in leaves no stale degraded flag behind', async () => {
      const service = TestBed.inject(AuthService);
      await waitFor(() => service.isAuthenticated(), 'the profile load');

      await service.signOut();
      await waitFor(() => service.firebaseUser() === null, 'the listener to observe the sign-out');

      await signInAnonymously(auth);
      await waitFor(() => service.isAuthenticated(), 'the new session to load its profile');

      expect(service.profileDegraded()).toBeFalse();
      expect(service.currentUser()!.id).toBe(auth.currentUser!.uid);
    });
  });

  /**
   * The ghost session: a profile read that resolves after the session that
   * asked for it has ended. On the unfixed build the retry's .then writes the
   * profile back and the app holds a signed-in identity with no Firebase
   * session behind it.
   *
   * Two things are arranged rather than waited for, and both are deliberate.
   *
   * The network is disabled so the read RESOLVES: offline, a cached document
   * is served from the local cache, while an uncached one rejects. The guard
   * only exists on the resolving branch — with the network up, a read issued
   * after sign-out is denied by the rules and lands in .catch, the one branch
   * that cannot install a ghost. The spec proves the cache serves the read
   * rather than assuming it.
   *
   * And the stale signal is written back by hand. The natural race cannot be
   * won reliably: firebaseSignOut nulls auth.currentUser and runs the
   * listener's synchronous null branch before its promise resolves, so by the
   * time a spec regains control the effect can no longer start. What is
   * reconstructed is only the signal value that window leaves behind; the
   * emulator, the auth SDK, the Firestore read and the effect are all real.
   * The exact interleavings live in auth.service.spec.ts, which drives them.
   *
   * What this case actually holds is the pair of retry guards together — it
   * fails with both removed, and the start gate alone is enough to satisfy
   * it, because a gate that refuses to read never reaches the write. Do not
   * read a green here as cover for the guard inside .then; that one is pinned
   * case by case in the unit spec, where the read is already in flight before
   * the session ends.
   */
  describe('sign-out during a profile retry', () => {
    let app: FirebaseApp;
    let auth: Auth;
    let firestore: ReturnType<typeof getFirestore>;
    let uid: string;

    beforeAll(async () => {
      app = initializeApp(
        { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
        `auth-smoke-ghost-${Date.now()}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
      uid = (await signInAnonymously(auth)).user.uid;
    });

    afterAll(async () => {
      await enableNetwork(firestore).catch(() => undefined);
      await deleteApp(app).catch(() => undefined);
    });

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: Auth, useValue: auth },
          { provide: Firestore, useValue: firestore },
          ...stubProviders()
        ]
      });
    });

    it('a retry that resolves after sign-out does not resurrect the session', async () => {
      const service = TestBed.inject(AuthService);
      await waitFor(() => service.isAuthenticated(), 'the profile load');
      const endedSession = service.firebaseUser()!;

      await disableNetwork(firestore);
      // Offline, this document is answered from the local cache — which is
      // what makes the retry below resolve instead of rejecting.
      expect((await getDoc(doc(firestore, 'users', uid))).exists()).toBeTrue();

      await service.signOut();
      await waitFor(() => service.firebaseUser() === null, 'the listener to observe the sign-out');

      // The state the race leaves behind: an ended session still named by the
      // signal the effect reads, with the retry armed.
      service.firebaseUser.set(endedSession);
      service.profileDegraded.set(true);
      (TestBed.inject(PwaService) as unknown as {
        isOnline: ReturnType<typeof signal<boolean>>;
      }).isOnline.set(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      TestBed.tick();
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(auth.currentUser).toBeNull();
      expect(service.currentUser()).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
      expect(service.profileDegraded()).toBeTrue();
    });
  });
});
