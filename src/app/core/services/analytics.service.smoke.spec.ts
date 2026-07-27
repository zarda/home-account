// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from root `firebase/*` are incompatible with the ones the app's
// services receive via DI.
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp,
} from '@angular/fire/firestore';
import { AnalyticsService } from './analytics.service';
import { AnalyticsParams, AnalyticsTransport } from './analytics-transport';
import { ScreenView } from './analytics-screen-view';
import { AuthService } from './auth.service';
import { SecurityLogService } from './security-log.service';
import { ThemeService } from './theme.service';
import { TranslationService } from './translation.service';
import { User, UserPreferences, usageAnalyticsEnabled } from '../../models';

/**
 * Integration smoke test for the analytics opt-in against the Firebase
 * emulators.
 *
 * The unit specs drive AnalyticsService against a fake AuthService, so they
 * prove the service reacts to a signal — not that the preference survives the
 * trip to Firestore. That trip is where this feature can quietly fail:
 * updateUserPreferences rewrites the *whole* preferences map from an in-memory
 * copy, and firestore.rules validates the map on the way in. A field that is
 * dropped or rejected there would leave the toggle looking like it worked
 * while collection stayed off (or, worse, on) after a reload.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('Analytics opt-in (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let authService: AuthService;
  let transport: RecordingTransport;
  let service: TestAnalyticsService;

  class RecordingTransport implements AnalyticsTransport {
    enabledCalls: boolean[] = [];
    events: { name: string; params: AnalyticsParams }[] = [];
    screens: ScreenView[] = [];

    async setEnabled(enabled: boolean): Promise<void> {
      this.enabledCalls.push(enabled);
    }

    async logEvent(name: string, params: AnalyticsParams): Promise<void> {
      this.events.push({ name, params });
    }

    async logScreenView(screen: ScreenView): Promise<void> {
      this.screens.push(screen);
    }
  }

  class TestAnalyticsService extends AnalyticsService {
    constructor(private readonly fake: AnalyticsTransport) {
      super();
    }

    protected override createTransport(): AnalyticsTransport {
      return this.fake;
    }

    track(name: string, params: AnalyticsParams = {}): void {
      this.send(name, params);
    }
  }

  const seedProfile = async (): Promise<void> => {
    // Shaped to satisfy the users/{uid} create rule: every required field
    // present and correctly typed.
    await setDoc(doc(firestore, `users/${uid}`), {
      email: 'analytics-smoke@example.com',
      displayName: 'Analytics Smoke',
      createdAt: Timestamp.now(),
      lastLoginAt: Timestamp.now(),
      preferences: {
        baseCurrency: 'USD',
        language: 'en',
        dateFormat: 'MM/DD/YYYY',
        theme: 'system',
        defaultCategories: [],
      } satisfies UserPreferences,
    });
  };

  const storedPreferences = async (): Promise<UserPreferences> => {
    const snapshot = await getDoc(doc(firestore, `users/${uid}`));
    return (snapshot.data() as { preferences: UserPreferences }).preferences;
  };

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'demo-key', projectId: 'demo-home-account', appId: 'demo-app' },
      'analytics-smoke'
    );
    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteDoc(doc(firestore, `users/${uid}`)).catch(() => undefined);
    await deleteApp(app);
  });

  beforeEach(async () => {
    transport = new RecordingTransport();

    TestBed.configureTestingModule({
      providers: [
        { provide: Auth, useValue: auth },
        { provide: Firestore, useValue: firestore },
        // Not involved in the preference round-trip; stubbed so the test does
        // not depend on locale files being served to the Karma browser.
        { provide: TranslationService, useValue: { syncFromDatabase: () => undefined } },
        { provide: ThemeService, useValue: { init: () => undefined } },
        { provide: SecurityLogService, useValue: { record: () => Promise.resolve() } },
        {
          provide: Router,
          useValue: {
            navigated: false,
            events: { pipe: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) },
            routerState: { snapshot: { root: { firstChild: null, pathFromRoot: [] } } },
          },
        },
      ],
    });

    await seedProfile();

    authService = TestBed.inject(AuthService);
    // The auth-state listener races the emulator; the round-trip under test is
    // updateUserPreferences, so the signals are seeded directly.
    authService.isLoading.set(false);
    authService.currentUser.set({
      id: uid,
      preferences: await storedPreferences(),
    } as User);

    const injector = TestBed.inject(EnvironmentInjector);
    service = runInInjectionContext(injector, () => new TestAnalyticsService(transport));
  });

  it('should persist the opt-in through the whole-map preferences rewrite', async () => {
    await authService.updateUserPreferences({
      ...authService.currentUser()?.preferences,
      enableUsageAnalytics: true,
    });

    const stored = await storedPreferences();
    // Firestore accepted the new key, and the rewrite did not drop the
    // preferences that were already there.
    expect(usageAnalyticsEnabled(stored)).toBeTrue();
    expect(stored.baseCurrency).toBe('USD');
    expect(stored.theme).toBe('system');
  });

  it('should read back as opted out once the toggle is turned off again', async () => {
    await authService.updateUserPreferences({
      ...authService.currentUser()?.preferences,
      enableUsageAnalytics: true,
    });
    await authService.updateUserPreferences({
      ...authService.currentUser()?.preferences,
      enableUsageAnalytics: false,
    });

    expect(usageAnalyticsEnabled(await storedPreferences())).toBeFalse();
  });

  it('should leave a fresh profile opted out', async () => {
    // No migration writes the field, so an account created before the setting
    // shipped has to read as off.
    expect(usageAnalyticsEnabled(await storedPreferences())).toBeFalse();
    expect(service.consentGranted()).toBeFalse();
  });

  it('should enable and disable collection as the stored preference changes', fakeAsync(() => {
    TestBed.tick();
    tick();
    // Nothing is collected while the seeded profile has no opt-in.
    expect(transport.enabledCalls).toEqual([false]);

    // updateUserPreferences re-sets the currentUser signal after the write, so
    // the change reaches the service the same way it would from the settings
    // toggle — without a reload.
    authService.currentUser.set({
      id: uid,
      preferences: { ...authService.currentUser()?.preferences, enableUsageAnalytics: true },
    } as User);
    TestBed.tick();
    tick();

    expect(transport.enabledCalls).toEqual([false, true]);

    service.track('budget_create');
    tick();
    expect(transport.events.map(event => event.name)).toEqual(['budget_create']);

    authService.currentUser.set({
      id: uid,
      preferences: { ...authService.currentUser()?.preferences, enableUsageAnalytics: false },
    } as User);
    TestBed.tick();
    tick();

    service.track('budget_create');
    tick();

    expect(transport.enabledCalls).toEqual([false, true, false]);
    // Still one: the second call was dropped by the consent gate.
    expect(transport.events.length).toBe(1);
  }));
});
