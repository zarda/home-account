// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) for the same compatibility reason as the FirestoreService suite.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  terminate,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';
import { ThemeService } from './theme.service';
import { SecurityLogService } from './security-log.service';
import { DEFAULT_USER_PREFERENCES, UserPreferences } from '../../models';

/**
 * Integration smoke test for AuthService against the auth and Firestore
 * emulators: the create and existing branches of the profile load, the
 * profile-load failure path (a signed-in auth user whose Firestore is
 * unreachable must land in a clean signed-out state, not a crash), and the
 * three profile/preference write paths with their exact written shapes.
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
        useValue: { syncFromDatabase: jasmine.createSpy('syncFromDatabase') }
      },
      { provide: ThemeService, useValue: { init: jasmine.createSpy('init') } },
      {
        provide: SecurityLogService,
        useValue: { record: jasmine.createSpy('record').and.resolveTo() }
      }
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

      const stored = (await getDoc(userRef())).data()!;
      expect((stored['lastLoginAt'] as Timestamp).toMillis()).toBeGreaterThan(1_000);
      expect((stored['createdAt'] as Timestamp).toMillis()).toBe(1_000);
    });

    it('getCurrentUser emits the loaded profile', async () => {
      const service = TestBed.inject(AuthService);
      const emissions: ({ id: string } | null)[] = [];
      const sub = service.getCurrentUser().subscribe(user => emissions.push(user));

      await waitFor(() => emissions.length >= 1, 'an emission');
      sub.unsubscribe();

      expect(emissions[0]!.id).toBe(uid);
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

    it('lands in a clean signed-out state instead of crashing', async () => {
      const service = TestBed.inject(AuthService);

      await waitFor(() => !service.isLoading(), 'the listener to settle');

      expect(service.firebaseUser()).not.toBeNull();
      expect(service.currentUser()).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
    });

    it('getCurrentUser emits null rather than erroring', async () => {
      const service = TestBed.inject(AuthService);
      const emissions: unknown[] = [];
      const errors: unknown[] = [];
      const sub = service.getCurrentUser().subscribe({
        next: value => emissions.push(value),
        error: e => errors.push(e)
      });

      await waitFor(() => emissions.length >= 1, 'an emission');
      sub.unsubscribe();

      expect(emissions[0]).toBeNull();
      expect(errors).toEqual([]);
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
      await waitFor(() => service.firebaseUser() === null, 'the listener to observe the sign-out');
    });
  });
});
