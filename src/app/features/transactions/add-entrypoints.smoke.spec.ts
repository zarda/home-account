// Entry-point smoke test: proves the capture flow is reachable from both the
// desktop transactions page (header add menu) and the mobile bottom nav
// (center action menu), with the real router, real Material overlays, and the
// Firebase emulators behind the page's Firestore reads.
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
// - No AI provider is configured in this environment; the capture dialog is
//   only opened and inspected, never asked to process.
// - The final spec deletes the Firebase app while its injector is alive
//   (teardown is disabled) — no spec may run after it, hence random: false.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideAppCharts } from '../../core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { MediaMatcher } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MockAuthService, createMockUser } from '../../core/services/testing';
import { BottomNavComponent } from '../../shared/layout/bottom-nav/bottom-nav.component';
import { DeviceService } from '../../core/services/device.service';

/**
 * A viewport width standing in for the device, so a spec can rotate a phone.
 * Width features are answered from that width — which covers the app's
 * breakpoint scale and the list's own `(min-width: 768px)` alike — and any
 * query with no width feature in it (reduced motion, forced colours) is handed
 * to the real matcher rather than silently answered "no match".
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

describe('Add entry points (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;
  let width$: BehaviorSubject<number>;

  function bodyText(): string {
    return document.body.textContent ?? '';
  }

  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
  }

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

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `entrypoints-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // One category + one transaction so /transactions exercises its real
    // Firestore read path (shapes mirror TransactionService.addTransaction).
    const now = Timestamp.now();
    const categoryRef = await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: 'Groceries',
      icon: 'shopping_cart',
      color: '#FF9800',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: false
    });
    await addDoc(collection(firestore, `users/${uid}/transactions`), {
      userId: uid,
      type: 'expense',
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      amount: 6.4,
      currency: 'USD',
      amountInBaseCurrency: 6.4,
      exchangeRate: 1,
      description: 'Blue Bottle Coffee'
    });
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    width$ = new BehaviorSubject<number>(1440);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        // Fake the OS-level matcher, never BreakpointObserver itself: the
        // observer's own logic is part of what these specs are checking.
        { provide: MediaMatcher, useValue: new FakeMediaMatcher(width$) },
        // A phone user agent at every width. Without it the header FAB's old
        // gate is trivially satisfied under desktop Chrome and the rotation
        // spec cannot fail. Kept after the fix as a trap: the page must not
        // consult the agent again.
        {
          provide: DeviceService,
          useValue: { isMobile: () => true, supportsCameraCapture: () => true }
        },
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
    'mobile bottom-nav action button opens the three-entry menu and reaches the capture dialog',
    async () => {
      const fixture = TestBed.createComponent(BottomNavComponent);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('button.action-button') as HTMLElement).click();
      await waitFor(
        'bottom-nav add menu',
        () => menuItems().length === 3,
        () => fixture.detectChanges()
      );
      const labels = menuItems().map(el => el.textContent ?? '');
      expect(labels[0]).toContain('transactions.addManually');
      expect(labels[1]).toContain('ai.scanReceipt');
      expect(labels[2]).toContain('import.importPhotos');

      menuItems()[1].click();
      await waitFor(
        'capture dialog from bottom nav',
        () => bodyText().includes('import.takePhoto') && bodyText().includes('import.multiSnapHint'),
        () => fixture.detectChanges()
      );

      TestBed.inject(MatDialog).closeAll();
      await waitFor(
        'dialog closed',
        () => !bodyText().includes('import.takePhoto'),
        () => fixture.detectChanges()
      );
      fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  // The reported bug: turning a phone sideways took the bottom bar away and
  // put nothing back, because the header FAB was gated on the user agent while
  // the bottom nav was gated on the viewport. Karma cannot supply either input
  // — it is desktop Chrome at a fixed size — so exactly two environment
  // sources are faked here and everything else stays real: the router, the
  // real MainLayoutComponent with its own .visible gate and stylesheet, real
  // Material overlays, and the emulator behind the page's Firestore reads.
  it(
    'keeps an add affordance when a phone rotates into landscape',
    async () => {
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/transactions');
      await waitFor(
        'transactions page with seeded data',
        () => bodyText().includes('transactions.title') && bodyText().includes('Blue Bottle Coffee'),
        () => harness.detectChanges()
      );

      const bottomNavShown = (): boolean => {
        const container = document.querySelector<HTMLElement>('.bottom-nav-container');
        return container !== null && getComputedStyle(container).display !== 'none';
      };
      const headerFab = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('app-page-header button[mat-fab]');

      // Portrait: the bottom nav carries Add, the header stays out of the way.
      width$.next(430);
      harness.detectChanges();
      await waitFor('portrait bottom nav', bottomNavShown, () => harness.detectChanges());
      expect(headerFab()).withContext('portrait: no header FAB').toBeNull();

      // Rotate. The bottom bar leaves at this width — something must replace it.
      width$.next(932);
      harness.detectChanges();
      await waitFor('landscape header FAB', () => headerFab() !== null, () =>
        harness.detectChanges()
      );
      expect(bottomNavShown()).withContext('landscape: bottom nav is gone').toBeFalse();

      const fab = headerFab()!;
      expect(fab.getBoundingClientRect().width)
        .withContext('a real target, not a sliver')
        .toBeGreaterThanOrEqual(48);

      // And it still opens the three entries it is supposed to.
      fab.click();
      await waitFor(
        'landscape header add menu',
        () => menuItems().length === 3,
        () => harness.detectChanges()
      );
      TestBed.inject(MatDialog).closeAll();
      document.body.click();
      harness.detectChanges();

      // Leave no live Firestore listeners for the spec that follows.
      harness.fixture.destroy();
      width$.next(1440);
    },
    SPEC_TIMEOUT
  );

  it(
    'desktop transactions page reaches the capture dialog through the header add menu',
    async () => {
      // The mock user's id must match the emulator uid so users/{uid}/… reads
      // pass the isOwner Firestore rules.
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/transactions');
      await waitFor(
        'transactions page with seeded data',
        () => bodyText().includes('transactions.title') && bodyText().includes('Blue Bottle Coffee'),
        () => harness.detectChanges()
      );

      // The header menu is gated on the viewport, and this suite's fake
      // matcher reports a desktop width by default, so it renders. The gate
      // itself is covered at every width by add-affordance.spec.ts.
      const fab = document.querySelector<HTMLElement>('app-page-header button[mat-fab]');
      expect(fab).withContext('header add button').not.toBeNull();
      // Presence is not visibility: a squeezed FAB is still in the DOM.
      expect(fab!.getBoundingClientRect().width)
        .withContext('a real 48px target, not a sliver')
        .toBeGreaterThanOrEqual(48);
      fab!.click();
      await waitFor(
        'header add menu',
        () => menuItems().length === 3,
        () => harness.detectChanges()
      );
      expect(menuItems().map(el => el.textContent ?? '').join('|')).toContain('import.importFromCamera');

      menuItems()[1].click();
      await waitFor(
        'capture dialog from transactions page',
        () => bodyText().includes('import.takePhoto') && bodyText().includes('import.multiSnapHint'),
        () => harness.detectChanges()
      );

      TestBed.inject(MatDialog).closeAll();
      await waitFor(
        'dialog closed',
        () => !bodyText().includes('import.takePhoto'),
        () => harness.detectChanges()
      );

      // Drain the exchange-rate initialization chain (Firestore cache read +
      // external fetch) before teardown — its in-flight work would otherwise
      // outlive the app and stall the browser (same rationale as
      // app.smoke.spec.ts).
      await TestBed.inject(CurrencyService).ensureRatesLoaded();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Shut down while this spec's injector is alive (see header comment):
      // close the routed components' Firestore listeners, then the SDK.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    SPEC_TIMEOUT
  );
});
