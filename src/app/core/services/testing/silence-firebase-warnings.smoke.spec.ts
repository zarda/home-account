// Regression net for the noise silenceFirebaseWarnings() removes (#355).
// @angular/fire's zone wrapper warns whenever a call happens outside an
// Angular injection context — the normal case for every raw SDK call this
// suite's beforeAll/afterAll hooks and spec bodies make. See
// silence-firebase-warnings.ts for the full mechanism; this spec exists so
// that if a future @angular/fire changes the advisory wording or the
// log-level gating, the drift shows up here as a red build instead of the
// noise silently coming back into every smoke run.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts's header for why the two are
// incompatible instances.
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { silenceFirebaseWarnings } from './silence-firebase-warnings';

// This file is itself one of the harness files, so it silences for itself at
// module scope like every other *.smoke.spec.ts.
// Captured before silencing runs, so the second spec below can prove the
// helper's console.warn swap was temporary rather than a lasting
// monkey-patch — a broken restore would leave the patched closure in place
// and fail this expectation. Independent of the spyOn in the first spec,
// which jasmine restores automatically once that spec finishes.
const consoleWarnBeforeSilencing = console.warn;
silenceFirebaseWarnings();

describe('silenceFirebaseWarnings (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;

  it('keeps the injection-context quartet silent against the emulators', async () => {
    const warnSpy = spyOn(console, 'warn').and.callThrough();

    // The same out-of-context shape every existing smoke file's beforeAll
    // uses: no TestBed, no injector, called straight from the spec body.
    const app: FirebaseApp = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `silence-warnings-smoke-${Date.now()}`
    );

    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    await deleteApp(app);

    const injectionContextCalls = warnSpy.calls
      .all()
      .filter(call => call.args.some(arg => typeof arg === 'string' && /injection context/i.test(arg)));

    expect(injectionContextCalls).withContext('console.warn calls mentioning injection context').toEqual([]);
  });

  it('restores console.warn once silencing finishes, leaving no lasting monkey-patch', () => {
    expect(console.warn).toBe(consoleWarnBeforeSilencing);
  });
});
