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
import { AnalyticsEventName } from '../config/analytics-events';
import { AnalyticsParams, AnalyticsTransport } from './analytics-transport';
import { ScreenView } from './analytics-screen-view';
import { AuthService } from './auth.service';
import { SecurityLogService } from './security-log.service';
import { ThemeService } from './theme.service';
import { TranslationService } from './translation.service';
import { User, UserPreferences, usageAnalyticsEnabled } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

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

    track(name: AnalyticsEventName, params: Record<string, unknown> = {}): void {
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

  /** The stored preferences as a premium account, whose preference is read. */
  const asPremium = (preferences: UserPreferences): User =>
    ({ id: uid, subscription: { tier: 'premium' }, preferences }) as User;

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
    expect(stored.enableUsageAnalytics).toBeTrue();
    // Read back through the accessor as premium, the only tier that consults it.
    expect(usageAnalyticsEnabled(asPremium(stored))).toBeTrue();
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

    expect(usageAnalyticsEnabled(asPremium(await storedPreferences()))).toBeFalse();
  });

  it('should leave a fresh premium profile opted out', async () => {
    // No migration writes the field, so a premium account that has not answered
    // reads as off.
    expect(usageAnalyticsEnabled(asPremium(await storedPreferences()))).toBeFalse();
  });

  it('should collect for the seeded free-tier profile', async () => {
    // The seeded document carries no subscription record, so it is free tier.
    expect(service.collectionEnabled()).toBeTrue();
  });

  it('should enable and disable collection as a premium account changes its mind', fakeAsync(() => {
    // Premium, because that is the only tier whose preference is consulted;
    // a free-tier account cannot express "off" at all.
    const premium = (enableUsageAnalytics?: boolean): User =>
      ({
        id: uid,
        subscription: { tier: 'premium' },
        preferences: {
          ...authService.currentUser()?.preferences,
          ...(enableUsageAnalytics === undefined ? {} : { enableUsageAnalytics }),
        },
      }) as User;

    authService.currentUser.set(premium());
    TestBed.tick();
    tick();
    // A premium account that has not answered is off.
    expect(transport.enabledCalls).toEqual([false]);

    // updateUserPreferences re-sets the currentUser signal after the write, so
    // the change reaches the service the same way it would from the settings
    // toggle — without a reload.
    authService.currentUser.set(premium(true));
    TestBed.tick();
    tick();

    expect(transport.enabledCalls).toEqual([false, true]);

    service.track('budget_create');
    tick();
    expect(transport.events.map(event => event.name)).toEqual(['budget_create']);

    authService.currentUser.set(premium(false));
    TestBed.tick();
    tick();

    service.track('budget_create');
    tick();

    expect(transport.enabledCalls).toEqual([false, true, false]);
    // Still one: the second call was dropped by the consent gate.
    expect(transport.events.length).toBe(1);
  }));

  it('should coerce the transaction_add usage params through the real pipeline', fakeAsync(() => {
    // The unit specs prove the validator coerces in isolation; this proves the
    // typed wrapper's booleans and count survive the consent gate and reach
    // the transport as the enumerated strings the taxonomy declares.
    authService.currentUser.set({
      id: uid,
      subscription: { tier: 'premium' },
      preferences: {
        ...authService.currentUser()?.preferences,
        enableUsageAnalytics: true,
      },
    } as User);
    TestBed.tick();
    tick();

    service.trackTransactionAdd({
      method: 'manual',
      type: 'expense',
      has_tags: true,
      has_location: false,
      receipt_image_count: 2,
    });
    tick();

    expect(transport.events).toEqual([
      {
        name: 'transaction_add',
        params: {
          method: 'manual',
          type: 'expense',
          has_tags: 'true',
          has_location: 'false',
          receipt_image_count: '2',
        },
      },
    ]);
  }));
});
