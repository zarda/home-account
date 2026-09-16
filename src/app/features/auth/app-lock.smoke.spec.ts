// App lock biometric door smoke test: proves the real BiometricAuthService,
// AppLockService, route guards and lock screen agree end to end under the
// Firebase emulators. Only the native bridge is fake — everything above it
// (the probe, the opt-in storage, the PIN fallback, the guard redirects) is
// the genuine implementation.
//
// Unit specs mount AppLockComponent against a spied AppLockService and a
// spied BiometricAuthService (app-lock.component.spec.ts), so none of them
// can see whether the real service graph actually agrees on when the
// biometric button should appear, or whether a device-only opt-in ever
// reaches the account's Firestore document. That is what this covers.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
//
// Notes:
// - i18n JSON is not served by the Karma asset config, so `| translate`
//   renders raw keys — assertions match keys, never copy.
// - The final spec deletes the Firebase app while its injector is alive
//   (teardown is disabled) — no spec may run after it, hence random: false.
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { Capacitor } from '@capacitor/core';
import { provideAppCharts } from '../../core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { AppLockService } from '../../core/services/app-lock.service';
import { BiometricAuthService } from '../../core/services/biometric-auth.service';
import {
  BIOMETRIC_AUTH_PLUGIN,
  Biometry,
  BiometricAuthPlugin
} from '../../core/plugins/biometric-auth.plugin';
import { APP_LOCK_STORAGE_PREFIX } from '../../core/utils/app-lock.utils';
import { DEFAULT_USER_PREFERENCES } from '../../models';
import { MockAuthService, createMockUser } from '../../core/services/testing';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();
stripProviderKeys();

describe('App lock biometric door (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 30000;
  const PIN = '123456';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;
  let authenticateSpy: jasmine.Spy;
  let isNativeSpy: jasmine.Spy;

  async function waitFor(
    label: string,
    predicate: () => boolean,
    flush?: () => void,
    timeoutMs = 15000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      flush?.();
      if (predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${label}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  function isDisabled(selector: string): boolean {
    return document.querySelector<HTMLButtonElement>(selector)?.disabled !== false;
  }

  /**
   * Locks the mock account with a PIN and the biometric shortcut opted in,
   * probes the fake plugin so `available()` is true before the screen ever
   * reads it, then navigates to /lock — the same order a real cold start
   * follows (the probe settles before the first guarded navigation).
   */
  async function openLockedScreen(): Promise<RouterTestingHarness> {
    // onboardingCompleted is restated because the override below replaces the
    // whole preferences object rather than merging into it — omitting it
    // would reopen the onboarding dialog over the /dashboard this navigates to.
    mockAuth.setMockUser(
      createMockUser(uid, {
        preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true, enableAppLock: true }
      })
    );

    await TestBed.inject(BiometricAuthService).detectAvailability();
    // The probe is the only thing here that needs a native platform: several
    // other providedIn:'root' services the wider app constructs past /lock
    // (AnalyticsService among them) branch on this same flag and reach a
    // real Capacitor plugin that has no web implementation.
    isNativeSpy.and.returnValue(false);
    const appLock = TestBed.inject(AppLockService);
    await appLock.setPin(PIN);
    appLock.setBiometricOptIn(true);
    appLock.lockNow();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/lock');
    await waitFor(
      'lock screen with the biometric button',
      () => document.querySelector('button.biometric-button') !== null,
      () => harness.detectChanges()
    );
    return harness;
  }

  /** Drains the exchange-rate chain a routed dashboard kicks off (same rationale as app.smoke.spec.ts). */
  async function settleDashboard(harness: RouterTestingHarness): Promise<void> {
    await TestBed.inject(CurrencyService).ensureRatesLoaded();
    await new Promise(resolve => setTimeout(resolve, 300));
    harness.fixture.destroy();
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `app-lock-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded once so the last case has a real document to prove untouched —
    // the opt-in it exercises never reaches Firestore, so nothing else in
    // this file needs to know this document exists.
    const now = Timestamp.now();
    await setDoc(doc(firestore, 'users', uid), {
      email: 'test@example.com',
      displayName: 'Test User',
      createdAt: now,
      lastLoginAt: now,
      preferences: { ...DEFAULT_USER_PREFERENCES, enableAppLock: true }
    });
  });

  afterAll(async () => {
    // Normally already deleted at the end of the last spec; this is the
    // safety net if a spec failed before reaching it.
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    authenticateSpy = jasmine.createSpy('authenticate');
    const fakePlugin: BiometricAuthPlugin = {
      isAvailable: (): Promise<{ available: boolean; biometry: Biometry; reason: string }> =>
        Promise.resolve({ available: true, biometry: 'faceId', reason: '' }),
      authenticate: authenticateSpy
    };

    // Must be true before the probe runs (openLockedScreen calls it first
    // thing) so the real BiometricAuthService reads a native platform;
    // openLockedScreen flips it back once the probe has settled.
    isNativeSpy = spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideNoopAnimations(),
        provideHttpClient(),
        provideNativeDateAdapter(),
        provideAppCharts(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth },
        { provide: BIOMETRIC_AUTH_PLUGIN, useValue: fakePlugin }
      ],
      // Keep the module alive after each spec (see app.smoke.spec.ts's
      // header): a destroyed injector turns late Firestore timers into
      // NG0205 crashes.
      teardown: { destroyAfterEach: false }
    });
  });

  afterEach(() => {
    // The opt-in and PIN records are device-local; a device fingerprinted
    // by userId would otherwise leak into the next case in this file.
    Object.keys(localStorage)
      .filter(key => key.startsWith(APP_LOCK_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  });

  it(
    'renders the biometric button and the PIN field, and auto-prompts exactly once',
    async () => {
      authenticateSpy.and.returnValue(new Promise<never>(() => undefined));

      const harness = await openLockedScreen();

      expect(document.querySelector('button.biometric-button')?.textContent)
        .withContext('raw key, since the i18n catalog is not served here')
        .toContain('appLock.unlockWithBiometry');
      expect(document.querySelector('input[name="pin"]'))
        .withContext('the PIN field stays as the fallback')
        .not.toBeNull();

      await waitFor(
        'the auto-prompt to fire',
        () => authenticateSpy.calls.count() === 1,
        () => harness.detectChanges()
      );

      expect(authenticateSpy.calls.count()).toBe(1);
      const reason = authenticateSpy.calls.argsFor(0)[0]?.reason;
      expect(typeof reason).withContext('a reason string is passed to the prompt').toBe('string');
      expect(reason).withContext('a non-empty reason').toBeTruthy();
      expect(TestBed.inject(Router).url).toBe('/lock');

      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'lands on the consumed redirect once the auto-prompt succeeds',
    async () => {
      authenticateSpy.and.resolveTo({ success: true });

      const harness = await openLockedScreen();

      await waitFor(
        'the router to leave /lock on biometric success',
        () => TestBed.inject(Router).url !== '/lock',
        () => harness.detectChanges()
      );
      expect(TestBed.inject(Router).url).toBe('/dashboard');
      expect(document.querySelector('app-onboarding-dialog'))
        .withContext('the mock user is already onboarded')
        .toBeNull();

      await settleDashboard(harness);
    },
    SPEC_TIMEOUT
  );

  it(
    'stays on the lock screen with no error line when the prompt is cancelled, and the PIN still unlocks',
    async () => {
      authenticateSpy.and.rejectWith(Object.assign(new Error('cancelled'), { code: 'cancelled' }));

      const harness = await openLockedScreen();

      // isChecking() releases once the rejected prompt is reduced to an
      // outcome; the biometric button's own [disabled] binding is the signal
      // (canSubmit also depends on an as-yet-empty PIN, so it can't be used).
      await waitFor(
        'the cancelled prompt to settle',
        () => !isDisabled('button.biometric-button'),
        () => harness.detectChanges()
      );

      expect(TestBed.inject(Router).url).toBe('/lock');
      expect(document.querySelector('.lock-error'))
        .withContext('no error line for a cancelled prompt')
        .toBeNull();

      const pinInput = document.querySelector<HTMLInputElement>('input[name="pin"]')!;
      pinInput.value = PIN;
      pinInput.dispatchEvent(new Event('input'));
      await waitFor(
        'the unlock button to enable once the PIN is valid',
        () => !isDisabled('button.unlock-button'),
        () => harness.detectChanges()
      );

      document.querySelector<HTMLButtonElement>('button.unlock-button')!.click();
      await waitFor(
        'the PIN path to leave /lock',
        () => TestBed.inject(Router).url !== '/lock',
        () => harness.detectChanges()
      );
      expect(TestBed.inject(Router).url).toBe('/dashboard');
      expect(document.querySelector('app-onboarding-dialog'))
        .withContext('the mock user is already onboarded')
        .toBeNull();

      await settleDashboard(harness);
    },
    SPEC_TIMEOUT
  );

  it(
    'leaves the Firestore user document unchanged by the biometric opt-in',
    async () => {
      // onboardingCompleted restated for the same reason as openLockedScreen
      // (the override replaces preferences wholesale).
      mockAuth.setMockUser(
        createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true, enableAppLock: true }
        })
      );
      const appLock = TestBed.inject(AppLockService);
      await appLock.setPin(PIN);

      const userRef = doc(firestore, 'users', uid);
      const before = (await getDoc(userRef)).data();

      // The flag this writes is device-only (app-lock.utils.ts); the
      // document is read here only to prove the write never reaches it.
      appLock.setBiometricOptIn(true);

      const after = (await getDoc(userRef)).data();
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));

      // Stop remaining Firestore streams/timers while this spec's injector
      // is still alive (see app.smoke.spec.ts's header).
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    SPEC_TIMEOUT
  );
});
