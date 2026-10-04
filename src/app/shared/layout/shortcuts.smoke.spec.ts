// Shortcuts smoke test (#446): '?' pressed on a desktop-width shell opens the
// command palette on its Shortcuts section, in the real overlay, through the
// real host binding, service and dialog; the open panel passes the axe sweep
// in both schemes; and Escape closes it.
//
// Unit specs prove each link alone: the layout spec dispatches '?' against a
// spy, the service spec opens a fake MatDialog, and the palette spec renders
// outside any dialog. Only the shell shows them joined, with Material's
// dialog chrome around the section the pass scores.
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
// - The spec deletes the Firebase app while its injector is alive (teardown
//   is disabled) — no spec may run after it, hence random: false.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MediaMatcher } from '@angular/cdk/layout';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { BehaviorSubject } from 'rxjs';
import { provideAppCharts } from '../../core/config/chart.config';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { ThemeService } from '../../core/services/theme.service';
import {
  AUDIT_SCHEMES,
  MockAuthService,
  createMockUser,
  runAxe,
  summarizeViolations,
  withScheme,
} from '../../core/services/testing';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';

/**
 * A viewport width standing in for the device (add-entrypoints.smoke.spec.ts
 * has the original). Width features are answered from that width, which is
 * the app's breakpoint scale, and any query with no width feature in it
 * (reduced motion, forced colours) is handed to the real matcher rather than
 * silently answered "no match".
 */
class FakeMediaMatcher {
  constructor(private readonly width$: BehaviorSubject<number>) {}

  private evaluate(query: string, width: number): boolean {
    const mins = [...query.matchAll(/\(min-width:\s*([\d.]+)px\)/g)];
    const maxes = [...query.matchAll(/\(max-width:\s*([\d.]+)px\)/g)];
    if (mins.length === 0 && maxes.length === 0) {
      return window.matchMedia(query).matches;
    }
    return (
      mins.every(m => width >= parseFloat(m[1])) && maxes.every(m => width <= parseFloat(m[1]))
    );
  }

  matchMedia(query: string): MediaQueryList {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const evaluate = (width: number) => this.evaluate(query, width);
    const width$ = this.width$;

    width$.subscribe(width => {
      const event = { media: query, matches: evaluate(width) } as MediaQueryListEvent;
      listeners.forEach(fn => fn(event));
    });

    return {
      media: query,
      get matches() {
        return evaluate(width$.value);
      },
      addListener: (fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeListener: (fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn)
    } as unknown as MediaQueryList;
  }
}

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();
stripProviderKeys();

describe('Shortcuts (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;

  async function waitFor(label: string, predicate: () => boolean, flush?: () => void, timeoutMs = 15000): Promise<void> {
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

  const overlay = () => document.querySelector<HTMLElement>('.cdk-overlay-container');
  const palette = () => overlay()?.querySelector<HTMLElement>('app-command-palette') ?? null;
  const panel = () => overlay()?.querySelector<HTMLElement>('.mat-mdc-dialog-surface') ?? null;
  const shortcuts = () => palette()?.querySelector<HTMLElement>('.palette-shortcuts') ?? null;

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `shortcuts-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterEach(() => {
    overlay()?.remove();
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        // The OS-level matcher is faked, never BreakpointObserver itself, so
        // the shell's own breakpoint logic decides it is on a desktop.
        { provide: MediaMatcher, useValue: new FakeMediaMatcher(new BehaviorSubject<number>(1440)) },
        provideNoopAnimations(),
        provideHttpClient(),
        provideNativeDateAdapter(),
        provideAppCharts(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth }
      ],
      teardown: { destroyAfterEach: false }
    });
  });

  it(
    "opens the palette on its Shortcuts section from '?', passes the axe sweep, and closes on Escape",
    async () => {
      // The mock user's id must match the emulator uid so users/{uid}/… reads
      // pass the isOwner Firestore rules.
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/about');
      await waitFor(
        'the about page inside the shell',
        () => !!document.querySelector('app-main-layout app-about')
          && (document.body.textContent ?? '').includes('about.title'),
        () => harness.detectChanges()
      );
      expect(palette()).withContext('no palette before the key').toBeNull();

      // US layout: '?' is Shift+/. Dispatched on the body, as a key pressed
      // with nothing focused reaches the document.
      const question = new KeyboardEvent('keydown', {
        key: '?',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(question);
      expect(question.defaultPrevented).withContext('the key is claimed').toBeTrue();

      await waitFor('the Shortcuts section in the overlay', () => !!shortcuts(), () => harness.detectChanges());

      const titles = Array.from(
        palette()!.querySelectorAll('.palette-section-title'),
        title => title.textContent?.trim()
      );
      expect(titles[0]).withContext('the palette opens on the section').toBe('palette.sectionShortcuts');
      expect(shortcuts()!.querySelectorAll('dl kbd').length).withContext('its keys').toBeGreaterThan(0);

      // In view, inside the panel and the window: a section past the fold is
      // one the pass below would skip and the user would not see.
      const section = shortcuts()!.getBoundingClientRect();
      const surface = panel()!.getBoundingClientRect();
      expect(section.top).toBeGreaterThanOrEqual(surface.top);
      expect(section.bottom).toBeLessThanOrEqual(Math.min(surface.bottom, window.innerHeight));

      const themes = TestBed.inject(ThemeService);
      for (const scheme of AUDIT_SCHEMES) {
        await withScheme(themes, scheme, async () => {
          harness.detectChanges();
          expect(summarizeViolations(await runAxe(panel()!)))
            .withContext(`axe-core (wcag2a, wcag2aa) violations in the palette panel in the ${scheme} scheme`)
            .toEqual([]);
        });
      }

      // The CDK dialog reads keyCode for Escape.
      const target = (document.activeElement as HTMLElement | null) ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      );
      await waitFor('the palette closed', () => !palette(), () => harness.detectChanges());

      // Drain the exchange-rate initialization chain before teardown (see
      // app.smoke.spec.ts), then shut down while this spec's injector is alive.
      await TestBed.inject(CurrencyService).ensureRatesLoaded();
      await new Promise(resolve => setTimeout(resolve, 500));
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    SPEC_TIMEOUT
  );
});
