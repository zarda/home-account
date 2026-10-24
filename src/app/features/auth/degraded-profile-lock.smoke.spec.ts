// A start that cannot read the profile, against the Firebase emulators: the
// real AuthService falls back to its in-memory profile, and the real
// AppLockService, route guards, lock screen and WidgetSnapshotService decide
// what that profile may open and what the widget may show. Only the widget's
// native plugin, the connectivity signal and the page reload are fake.
//
// The unit specs raise `profileDegraded` on a double (app-lock.service.spec.ts,
// widget-snapshot.service.spec.ts). Here a real profile read fails, the way it
// does on a device that starts offline with nothing cached, and the real routes
// answer for it.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
//
// Notes:
// - Every case boots its own Firebase app, signed in as the one account a
//   seeder app writes the profile for, because the read can only fail on a
//   client whose network was down from before its first read.
// - i18n JSON is not served by the Karma asset config, so the lock screen and
//   the widget's sentences carry raw keys; nothing here matches copy.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  doc,
  getDoc,
  setDoc,
  Firestore,
  FirestoreError,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { provideAppDatepicker } from '../../core/config/datepicker.config';
import { provideAppCharts } from '../../core/config/chart.config';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { AppLockService } from '../../core/services/app-lock.service';
import { PwaService } from '../../core/services/pwa.service';
import { PAGE_RELOAD } from '../../core/services/page-reload';
import { WidgetSnapshotService } from '../../core/services/widget-snapshot.service';
import { WIDGET_SNAPSHOT_PLUGIN } from '../../core/plugins/widget-snapshot.plugin';
import { APP_LOCK_STORAGE_PREFIX, writePinRecord } from '../../core/utils/app-lock.utils';
import { derivePinRecord, PinRecord } from '../../core/utils/pin-hash.utils';
import { DEFAULT_USER_PREFERENCES, WidgetSnapshot, WidgetSnapshotInput } from '../../models';
import { provideNoMotion } from '../../core/services/testing';
import { emulatorCustomToken } from '../../core/services/testing/emulator-custom-token';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';

silenceFirebaseWarnings();
stripProviderKeys();

describe('A profile that could not be read, behind the app lock (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const SPEC_TIMEOUT = 60000;
  const PIN = '135790';

  /** Figures as the dashboard would hand them over after a paint. */
  const FIGURES: WidgetSnapshotInput = {
    spent: 4200,
    net: 800,
    baseCurrency: 'USD',
    budgets: [],
    upcoming: [],
    hidden: [],
    month: new Date()
  };

  interface Device {
    app: FirebaseApp;
    auth: Auth;
    firestore: Firestore;
    storage: Storage;
  }

  const uid = `degraded-lock-${Date.now()}`;
  let seeder: FirebaseApp;
  /** The case's own client, deleted after it whether it passed or not. */
  let caseApp: FirebaseApp | undefined;
  let seederStore: Firestore;
  let createdAt: Timestamp;
  let pinRecord: PinRecord;
  let isOnline: ReturnType<typeof signal<boolean>>;
  let writes: WidgetSnapshot[];
  /** The case's routed page, destroyed after it whether it passed or not. */
  let livePage: RouterTestingHarness | undefined;

  async function waitFor(
    label: string,
    predicate: () => boolean,
    flush: () => void = () => undefined,
    timeoutMs = 15000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      flush();
      if (predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${label}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 100));
  }

  function lastWrite(): WidgetSnapshot | undefined {
    return writes[writes.length - 1];
  }

  /** The stored profile, written from another client: the account's own answer. */
  async function seedProfile(enableAppLock: boolean): Promise<void> {
    await setDoc(doc(seederStore, 'users', uid), {
      email: 'test@example.com',
      displayName: 'Test User',
      createdAt,
      lastLoginAt: Timestamp.now(),
      preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true, enableAppLock }
    });
  }

  /**
   * A device signed in as the account whose Firestore is offline before its
   * first read, so nothing is cached. The premise is checked rather than
   * assumed: the profile read on it must fail.
   */
  async function deviceOffline(label: string): Promise<Device> {
    const app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `degraded-lock-${label}-${Date.now()}`
    );
    caseApp = app;
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    const storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    // Signed in before AuthService exists: its listener's first delivery is
    // this session, not a change from elsewhere that would ask for a reload.
    await signInWithCustomToken(auth, emulatorCustomToken(uid));
    await disableNetwork(firestore);

    const outcome = await getDoc(doc(firestore, 'users', uid)).then(
      () => 'read',
      (error: FirestoreError) => error.code
    );
    expect(outcome).withContext('an offline read of a profile nothing has cached').toBe('unavailable');
    return { app, auth, firestore, storage };
  }

  function configure(device: Device): void {
    // Each configuration's fake writes into its own array: the earlier ones'
    // services outlive their cases (teardown is disabled below).
    const caseWrites: WidgetSnapshot[] = [];
    writes = caseWrites;
    isOnline = signal(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideNoMotion(),
        provideHttpClient(),
        provideAppDatepicker(),
        provideAppCharts(),
        { provide: Firestore, useValue: device.firestore },
        { provide: Auth, useValue: device.auth },
        { provide: Storage, useValue: device.storage },
        // Offline until a case reconnects; the profile retry runs on the flip.
        { provide: PwaService, useValue: { isOnline } },
        // A real reload would abort the whole Karma run.
        { provide: PAGE_RELOAD, useValue: jasmine.createSpy('reload') },
        // The web factory yields null, which leaves nothing to write through.
        {
          provide: WIDGET_SNAPSHOT_PLUGIN,
          useValue: {
            write: jasmine.createSpy('write').and.callFake(async ({ snapshot }: { snapshot: string }) => {
              caseWrites.push(JSON.parse(snapshot) as WidgetSnapshot);
            })
          }
        }
      ],
      // Kept alive after each case (the fixture is destroyed by hand instead):
      // a Firestore timer that fires into a torn-down injector crashes with
      // NG0205.
      teardown: { destroyAfterEach: false }
    });
  }

  /** What app.config's initializers arm, then the start-up navigation. */
  async function boot(): Promise<{
    authService: AuthService;
    appLock: AppLockService;
    router: Router;
    harness: RouterTestingHarness;
  }> {
    TestBed.inject(WidgetSnapshotService);
    const appLock = TestBed.inject(AppLockService);
    const authService = TestBed.inject(AuthService);
    await waitFor('the session to settle on a profile', () => !authService.isLoading());

    const router = TestBed.inject(Router);
    const routed = await RouterTestingHarness.create();
    livePage = routed;
    await routed.navigateByUrl('/dashboard');
    return { authService, appLock, router, harness: routed };
  }

  /** Connectivity comes back, and the retry swaps the stored profile in. */
  async function reconnect(
    device: Device,
    authService: AuthService,
    harness: RouterTestingHarness
  ): Promise<void> {
    await enableNetwork(device.firestore);
    // No TestBed.tick() to run the retry effect: with a routed page live, the
    // tick lands inside one the page's own Firestore callbacks started
    // (NG0101). The scheduler runs it, and the polls flush the fixture.
    isOnline.set(true);
    await waitFor(
      'the retry to swap the stored profile in',
      () => !authService.profileDegraded(),
      () => harness.detectChanges()
    );
  }

  /** Types the PIN on the lock screen and presses unlock. */
  async function unlockFromLockScreen(router: Router, harness: RouterTestingHarness): Promise<void> {
    const pinInput = document.querySelector<HTMLInputElement>('input[name="pin"]')!;
    pinInput.value = PIN;
    pinInput.dispatchEvent(new Event('input'));
    await waitFor(
      'the unlock button to enable once the PIN is valid',
      () => document.querySelector<HTMLButtonElement>('button.unlock-button')?.disabled === false,
      () => harness.detectChanges()
    );
    document.querySelector<HTMLButtonElement>('button.unlock-button')!.click();
    await waitFor('the PIN to leave /lock', () => router.url !== '/lock', () => harness.detectChanges());
  }

  beforeAll(async () => {
    // A fresh cache keeps CurrencyService, constructed with the dashboard and
    // asked to format the widget's figures, off the network.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, EUR: 0.9, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    seeder = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `degraded-lock-seeder-${Date.now()}`
    );
    const seederAuth = getAuth(seeder);
    connectAuthEmulator(seederAuth, AUTH_URL, { disableWarnings: true });
    seederStore = getFirestore(seeder);
    connectFirestoreEmulator(seederStore, '127.0.0.1', 8080);
    await signInWithCustomToken(seederAuth, emulatorCustomToken(uid));

    createdAt = Timestamp.now();
    // A cheap derivation: the production iteration count only slows the run.
    pinRecord = await derivePinRecord(PIN, 1000);
  });

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    await deleteApp(seeder).catch(() => undefined);
  });

  beforeEach(() => {
    // The fallback's load failure is logged on purpose; keep it out of the run.
    spyOn(console, 'error');
  });

  afterEach(async () => {
    const app = caseApp;
    caseApp = undefined;
    try {
      // A page left live keeps its offline listeners, which the app's
      // deletion below would abort under a later case.
      livePage?.fixture.destroy();
    } finally {
      livePage = undefined;
      // Each case's client goes with the case, not at the end of the file.
      // An online client holds a hanging request to the emulator for each
      // open stream, and Chrome pools at most six HTTP/1.1 connections per
      // origin. With the earlier cases' sessions left online, the next
      // case's seeder write waited past Karma's 30 s of silence in the full
      // run (testing.md, Six connections to the emulator).
      if (app) await deleteApp(app).catch(() => undefined);
      // A recovered session went on with an online boot's work, and the
      // deletion aborts it; the abort is logged a macrotask later, so let it
      // land under this case's spy.
      await settle();
      // PIN records are device-local and keyed by the account every case
      // shares.
      Object.keys(localStorage)
        .filter(key => key.startsWith(APP_LOCK_STORAGE_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    }
  });

  it(
    'sends a start that cannot read the profile to /lock, and the widget writes only the locked sentence',
    async () => {
      await seedProfile(true);
      writePinRecord(uid, pinRecord);
      configure(await deviceOffline('locked'));

      const { authService, appLock, router, harness } = await boot();

      // The fallback, not the stored profile: it names no lock.
      expect(authService.profileDegraded()).toBeTrue();
      expect(authService.currentUser()!.preferences.enableAppLock).toBeUndefined();

      await waitFor('the guard to send the start to /lock', () => router.url === '/lock', () =>
        harness.detectChanges()
      );
      expect(appLock.isLocked()).toBeTrue();

      await waitFor('the widget to be written', () => writes.length > 0, () => harness.detectChanges());
      expect(lastWrite()!.state).toBe('locked');

      TestBed.inject(WidgetSnapshotService).publish(FIGURES);
      await settle();
      expect(lastWrite()!.state).toBe('locked');
      expect(writes.map(write => write.state)).not.toContain('figures');
    },
    SPEC_TIMEOUT
  );

  it(
    'opens with the PIN, and stays open with the widget locked once the stored profile arrives asking for the lock',
    async () => {
      await seedProfile(true);
      writePinRecord(uid, pinRecord);
      const device = await deviceOffline('unlocked');
      configure(device);

      const { authService, appLock, router, harness } = await boot();
      await waitFor('the guard to send the start to /lock', () => router.url === '/lock', () =>
        harness.detectChanges()
      );

      await unlockFromLockScreen(router, harness);
      expect(router.url).toBe('/dashboard');

      await reconnect(device, authService, harness);

      // The stored profile, which asks for the lock, and the unlock still holds.
      expect(authService.currentUser()!.preferences.enableAppLock).toBeTrue();
      expect(appLock.canEngage()).toBeTrue();
      expect(appLock.isLocked()).toBeFalse();
      expect(router.url).toBe('/dashboard');

      TestBed.inject(WidgetSnapshotService).publish(FIGURES);
      await settle();
      expect(writes.map(write => write.state)).not.toContain('figures');
    },
    SPEC_TIMEOUT
  );

  it(
    'takes the lock down by itself once the stored profile arrives asking for none',
    async () => {
      // The PIN kept after the lock was switched off: the device cannot tell
      // that apart from a lock while the profile is unknown.
      await seedProfile(false);
      writePinRecord(uid, pinRecord);
      const device = await deviceOffline('stood-down');
      configure(device);

      const { authService, appLock, router, harness } = await boot();
      await waitFor('the guard to send the start to /lock', () => router.url === '/lock', () =>
        harness.detectChanges()
      );

      await reconnect(device, authService, harness);

      expect(authService.currentUser()!.preferences.enableAppLock).toBeFalse();
      expect(appLock.canEngage()).toBeFalse();
      await waitFor('the lock screen to stand down', () => router.url === '/dashboard', () =>
        harness.detectChanges()
      );

      // The fake records a write synchronously, so this is the case's own
      // write. The dashboard now on screen publishes its own figures as its
      // listeners answer, and a later one of those may follow it.
      const from = writes.length;
      TestBed.inject(WidgetSnapshotService).publish(FIGURES);
      expect(writes[from].state).toBe('figures');
      expect(writes[from].figures!.spent.replace(/\D/g, '')).toContain('4200');
    },
    SPEC_TIMEOUT
  );

  it(
    'still opens a start that cannot read the profile when this device has no PIN',
    async () => {
      await seedProfile(true);
      configure(await deviceOffline('no-pin'));

      const { authService, appLock, router, harness } = await boot();

      expect(authService.profileDegraded()).toBeTrue();
      expect(appLock.method()).toBe('none');
      expect(appLock.canEngage()).toBeFalse();
      await waitFor('the start-up navigation to open the dashboard', () => router.url === '/dashboard', () =>
        harness.detectChanges()
      );
    },
    SPEC_TIMEOUT
  );
});
