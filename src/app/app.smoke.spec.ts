// Route-level UI smoke test: boots the real router configuration and page
// components against the Firebase emulators and asserts that each main page
// renders its landmark heading (and live Firestore data) without errors.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from root `firebase/*` are incompatible with the ones the app's
// services receive via DI — they must come from the same copy.
//
// Runs only under the emulators:
//   npm run smoke
// (CI wraps `npm run test:smoke` with `firebase emulators:exec --only auth,storage,firestore`.)
//
// Notes:
// - `app.config.ts` / `src/environments/environment` are NOT imported: the
//   local environment file is gitignored, and the app's persistent-cache
//   Firestore factory stalls Karma teardown (see app.config.spec.ts). The
//   emulator-connected instances are provided directly via the DI tokens.
// - i18n JSON is not served by the Karma asset config, so `| translate`
//   renders raw keys — assertions match keys and seeded data, never copy.
// - All authenticated pages are visited inside ONE spec: @angular/fire routes
//   Firestore's async callbacks through the injector that was active at call
//   time, so the SDK must be terminated (deleteApp) while that spec's
//   injector is still alive — otherwise pending stream timers fire into a
//   destroyed injector and crash the run with NG0205 after the specs pass.
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAppCharts } from './core/config/chart.config';
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
import { routes } from './app.routes';
import { addDays } from './core/utils/transaction-date.utils';
import { currentScreenView } from './core/services/analytics-screen-view';
import { AuthService } from './core/services/auth.service';
import { CurrencyService } from './core/services/currency.service';
import { MockAuthService, createMockUser } from './core/services/testing';
import { BUDGET_TABS } from './features/budgets/budgets.component';
import { REPORT_TABS } from './features/reports/reports.component';
import { silenceFirebaseWarnings } from './core/services/testing/silence-firebase-warnings';

// Declaration order matters here: the final spec shuts the shared Firebase
// app down, so no spec may run after it. Random ordering would break that.
jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();

describe('App routes (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const WALKTHROUGH_TIMEOUT = 60000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;
  let harness: RouterTestingHarness;

  // Polls until the rendered DOM satisfies the predicate; flushes change
  // detection between polls because Firestore listener callbacks arrive
  // outside the harness's knowledge.
  async function waitForDom(label: string, predicate: () => boolean, timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      harness.detectChanges();
      if (predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${label}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  function pageText(): string {
    return (harness.routeNativeElement?.ownerDocument.body.textContent ?? '');
  }

  async function expectPage(
    url: string,
    landmark: string,
    data?: string,
    screenClass?: string
  ): Promise<void> {
    await harness.navigateByUrl(url);
    await waitForDom(`${url} landmark "${landmark}"`, () => pageText().includes(landmark));
    if (data) {
      await waitForDom(`${url} data "${data}"`, () => pageText().includes(data));
    }
    expectScreenName(url, screenClass);
    expectCurrentRouteMarked(url);
  }

  /**
   * The navigation link for the page just opened claims it, and no other
   * link does (ADR 0055).
   *
   * Asserted inside expectPage rather than as its own case, so every route
   * this spec visits checks it. What it adds over the component specs is
   * real navigation through the real route configuration: the attribute has
   * to keep up with the router, and a stubbed router cannot show that.
   *
   * Gated on a link for the route actually being on screen. The surfaces
   * this harness renders do not carry all eight destinations — /settings,
   * /data and /about have no link here — and a route with no link is not a
   * failure. The gate tests for the anchor, not the attribute, so a
   * regression that drops aria-current still fails on every route that does
   * have one. Where both surfaces render they mark the same route, so the
   * assertion is on the distinct set of destinations rather than a count.
   */
  function expectCurrentRouteMarked(url: string): void {
    const doc = harness.routeNativeElement?.ownerDocument;
    if (!doc?.querySelector(`a.nav-item[href="${url}"]`)) return;

    const marked = new Set(
      Array.from(
        doc.querySelectorAll<HTMLAnchorElement>('a.nav-item[aria-current="page"]')
      ).map(link => link.getAttribute('href'))
    );

    expect(Array.from(marked))
      .withContext(`links marking themselves current on ${url}`)
      .toEqual([url]);
  }

  /**
   * The screen name analytics would report for the page just navigated to.
   *
   * Worth asserting here rather than only in the unit spec: this is a real
   * activated router state built from the real route configuration, so it
   * catches the case a synthetic snapshot cannot — a route nested or renamed
   * in app.routes.ts silently changing what GA4 calls the screen. The names
   * are a published contract in three places at once (docs/analytics.md, the
   * web transport, and the hand-written iOS one), and this is what keeps all
   * three describing the same screen.
   */
  function expectScreenName(url: string, screenClass?: string): void {
    const expected = url.replace(/^\//, '').split('?')[0];
    const screen = currentScreenView(TestBed.inject(Router));

    expect(screen?.screenName).withContext(`screen_name for ${url}`).toBe(expected);
    if (screenClass) {
      // screen_class reads the activated snapshot's component, which the
      // router fills in from the loaded component only after a lazy route
      // resolves. Asserting it on a real navigation is what proves a page
      // still reports its own selector rather than 'unknown' now that every
      // child route loads on demand.
      expect(screen?.screenClass).withContext(`screen_class for ${url}`).toBe(screenClass);
    }
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `route-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seed a category, two transactions (one foreign-currency) and a budget so
    // the pages exercise their real Firestore read paths, mirroring the shapes
    // TransactionService.addTransaction / BudgetService write.
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

    const transactionBase = {
      userId: uid,
      type: 'expense',
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false
    };
    await addDoc(collection(firestore, `users/${uid}/transactions`), {
      ...transactionBase,
      amount: 6.4,
      currency: 'USD',
      amountInBaseCurrency: 6.4,
      exchangeRate: 1,
      description: 'Blue Bottle Coffee'
    });
    await addDoc(collection(firestore, `users/${uid}/transactions`), {
      ...transactionBase,
      amount: 3800,
      currency: 'JPY',
      amountInBaseCurrency: 25.42,
      exchangeRate: 1 / 149.5,
      description: 'Tokyo Dinner'
    });

    await addDoc(collection(firestore, `users/${uid}/budgets`), {
      userId: uid,
      categoryId: categoryRef.id,
      name: 'Groceries Budget',
      amount: 300,
      currency: 'USD',
      period: 'monthly',
      startDate: now,
      spent: 50,
      isActive: true,
      alertThreshold: 80,
      createdAt: now,
      updatedAt: now
    });
  });

  afterAll(async () => {
    // Normally already deleted at the end of the walkthrough spec; this is
    // the safety net if a spec failed before reaching it.
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    mockAuth = new MockAuthService();
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
        { provide: AuthService, useValue: mockAuth }
      ],
      // Keep the module (and its injector) alive after the spec: Firestore
      // timers scheduled through @angular/fire's zone wrapper re-enter the
      // capturing injector when they fire, and a destroyed injector turns
      // those late no-op callbacks into NG0205 crashes in afterAll.
      teardown: { destroyAfterEach: false }
    });
    harness = await RouterTestingHarness.create();
  });

  // No Firestore API is exercised on this path (mocked AuthService + login
  // page only), so it is safe to run under its own short-lived injector.
  it('redirects unauthenticated visitors to the login page', async () => {
    await harness.navigateByUrl('/dashboard');
    expect(TestBed.inject(Router).url).toBe('/login');
    await waitForDom('login landmark', () => pageText().includes('app.title'));
  }, 20000);

  it(
    'renders every main page with its landmark and seeded data',
    async () => {
      // The mock user's id must match the emulator uid so the services'
      // users/{uid}/… reads pass the isOwner Firestore rules.
      mockAuth.setMockUser(createMockUser(uid));

      await expectPage('/dashboard', 'dashboard.title', 'Blue Bottle Coffee', 'app-dashboard');

      // Every component checks with OnPush (ADR 0024), so a view only
      // repaints when something marks it dirty. Both seeded transactions are
      // dated today, so the period totals must fall to zero on last month and
      // come back on this month. The recent-transactions list is deliberately
      // not the probe: it shows the last five regardless of period.
      //
      // A stale view here is the failure mode OnPush introduces, and no
      // TestBed spec catches it — fixture.detectChanges() checks the view
      // whether or not anything marked it.
      const statValues = () =>
        Array.from(
          harness.routeNativeElement?.ownerDocument.querySelectorAll('.stat-value') ?? []
        ).map(el => (el as HTMLElement).innerText);
      const periodToggles =
        harness.routeNativeElement?.ownerDocument.querySelectorAll<HTMLElement>(
          '.mat-button-toggle-button'
        );
      expect(periodToggles?.length).toBeGreaterThan(1);
      await waitForDom('dashboard totals for this month', () =>
        statValues().some(v => /[1-9]/.test(v))
      );

      periodToggles?.[1]?.click();
      await waitForDom('dashboard totals repainted for last month', () => {
        const values = statValues();
        return values.length > 0 && values.every(v => !/[1-9]/.test(v));
      });

      periodToggles?.[0]?.click();
      await waitForDom('dashboard totals repainted back to this month', () =>
        statValues().some(v => /[1-9]/.test(v))
      );
      await expectPage('/transactions', 'transactions.title', 'Blue Bottle Coffee');
      await expectPage('/budgets', 'budget.title', 'Groceries Budget');
      // BUDGET_TABS and REPORT_TABS are what the data hub's ?tab= links are
      // checked against, and this is the only place the real strips render.
      // A tab added to a template without a name added to the list would
      // otherwise leave the hub silently linking at the wrong section.
      expect(
        harness.routeNativeElement?.ownerDocument.querySelectorAll('.mdc-tab').length
      ).withContext('budget tabs').toBe(BUDGET_TABS.length);

      await expectPage('/reports', 'reports.title');
      await waitForDom(
        'reports chart canvas',
        () => !!harness.routeNativeElement?.ownerDocument.querySelector('canvas')
      );
      // After the canvas, not before: the reports tab strip sits behind the
      // page's loading gate, so it does not exist at the moment the landmark
      // resolves.
      expect(
        harness.routeNativeElement?.ownerDocument.querySelectorAll('.mdc-tab').length
      ).withContext('report tabs').toBe(REPORT_TABS.length);

      // Drive the lazily created Forecast tab: its recurring listener only
      // opens on selection, and with no seeded rules it must land on the
      // empty state rather than a broken chart.
      const tabHeaders =
        harness.routeNativeElement?.ownerDocument.querySelectorAll<HTMLElement>('.mdc-tab');
      tabHeaders?.[tabHeaders.length - 1]?.click();
      await waitForDom(
        'forecast empty state',
        () => pageText().includes('reports.forecastNoRulesTitle')
      );

      // Seeded live, after the empty state is proven rather than instead of
      // it: the tab's listener is already open, so a new rule has to reach
      // it without a reload. This is the only place the forecast chart is
      // actually built — the empty state above never constructs a series, so
      // nothing else here exercises the bucketing (issue #268).
      const inThreeDays = Timestamp.fromDate(addDays(new Date(), 3));
      await addDoc(collection(firestore, `users/${uid}/recurring`), {
        userId: uid,
        name: 'Gym',
        type: 'expense',
        amount: 30,
        currency: 'USD',
        categoryId: 'other',
        description: 'Gym membership',
        frequency: { type: 'monthly', interval: 1 },
        startDate: inThreeDays,
        nextOccurrence: inThreeDays,
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      await waitForDom(
        'forecast chart once a rule arrives',
        () => pageText().includes('reports.forecastProjectedNet')
      );
      // The report period is the current month, comfortably inside the point
      // ceiling, so the chart stays at one point per day and says nothing
      // about bucket width.
      expect(pageText())
        .withContext('bucket caption at one point per day')
        .not.toContain('reports.forecastBucketNote');

      await expectPage('/settings', 'settings.title', 'Test User');
      // The hub counts each stored kind through a server-side aggregate. The
      // seeded categories prove the counts land as numbers rather than as the
      // dash a failed aggregate would leave behind.
      await expectPage('/data', 'data.title', undefined, 'app-data-hub');
      await waitForDom(
        'a stored-kind count',
        () =>
          Array.from(
            harness.routeNativeElement?.ownerDocument.querySelectorAll<HTMLElement>(
              '.kind-count'
            ) ?? []
          ).some(cell => /^\d+$/.test(cell.textContent?.trim() ?? ''))
      );
      // The sixth child route. It has no seeded data of its own, so the
      // landmark is the whole assertion: what it proves is that the route
      // resolves its component at all, which is the part that changed when
      // the layout's children stopped being imported eagerly.
      await expectPage('/about', 'about.title', undefined, 'app-about');
      expect(TestBed.inject(Router).url).toBe('/about');

      // Drain in-flight async work before shutting Firebase down, so nothing
      // races the teardown into the afterAll window: the exchange-rate
      // initialization chain (Firestore cache read + external fetch) is the
      // long pole, plus a grace tick for fire-and-forget emulator writes.
      await TestBed.inject(CurrencyService).ensureRatesLoaded();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Destroy the routed components first (teardown is disabled, so nothing
      // else will): their ngOnDestroy hooks close the Firestore listeners,
      // which must not still be streaming when the app is deleted below —
      // terminated streams reject asynchronously and would surface as
      // unhandled errors in afterAll.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Stop all remaining Firestore streams/timers while this spec's
      // injector is still alive (see header comment).
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    WALKTHROUGH_TIMEOUT
  );
});
