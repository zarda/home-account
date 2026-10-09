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
import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatSelect } from '@angular/material/select';
import { provideAppCharts } from './core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from './app.routes';
import { addDays, startOfMonth } from './core/utils/transaction-date.utils';
import { currentScreenView } from './core/services/analytics-screen-view';
import { AuthService } from './core/services/auth.service';
import { CurrencyService } from './core/services/currency.service';
import { HouseholdService } from './core/services/household.service';
import { HouseholdPlansService } from './core/services/household-plans.service';
import { LedgerShareService } from './core/services/ledger-share.service';
import { ThemeService } from './core/services/theme.service';
import {
  getDocumentAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './core/services/testing/emulator-admin';
import {
  AUDIT_SCHEMES,
  MockAuthService,
  auditInView,
  createMockUser,
  runAxe,
  unexpectedViolations,
  withScheme
} from './core/services/testing';
import { BUDGET_TABS } from './features/budgets/budgets.component';
import { REPORT_TABS } from './features/reports/reports.component';
import { silenceFirebaseWarnings } from './core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from './core/services/testing/provider-keys';

// Declaration order matters here: the final spec shuts the shared Firebase
// app down, so no spec may run after it. Random ordering would break that.
jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();
stripProviderKeys();

describe('App routes (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';
  // Raised from 60s when the axe pass joined expectPage: nine routes plus
  // the tab variants, and `color-contrast` — the rule with the most to say
  // here, and the slowest — costs a few seconds on a page the size of the
  // dashboard. Raised again when /household's member view joined: a second
  // household page, with the rows, cards and members of a formed household.
  // Raised to 300s when every pass began running once per scheme, and the
  // cards below the fold and the recurring rules joined: from 11 passes to
  // 36.
  const WALKTHROUGH_TIMEOUT = 300000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  // The seeded row the walkthrough shares into its household.
  let blueBottleId: string;
  // The seeded orange category. The recurring rules sit in it, so the
  // tiles that draw their glyph on its colour are swept in both schemes.
  let groceriesId: string;
  let mockAuth: MockAuthService;
  let harness: RouterTestingHarness;
  // The walkthrough's ThemeService, which every pass forces each scheme
  // through.
  let themeService: ThemeService | undefined;
  // The theme classes <html> carried before the walkthrough forced a scheme,
  // until restoreTheme puts them back.
  let themeClassesBefore: { light: boolean; dark: boolean } | undefined;

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
    // A pass audits whatever has rendered, and a landmark can render above
    // a section still loading: /settings' categories and sign-in activity
    // load after its profile, and /reports' tabs after its title.
    await waitForDom(
      `${url} loaded`,
      () => !harness.routeNativeElement?.querySelector('app-loading-spinner')
    );
    expectScreenName(url, screenClass);
    expectCurrentRouteMarked(url);
    await expectNoAxeViolations(url);
  }

  /**
   * An axe-core pass over the page just opened, WCAG 2.1 A and AA.
   *
   * Asserted inside expectPage for the same reason expectCurrentRouteMarked
   * is: every route this spec visits gets it, so the sweep widens whenever
   * the walkthrough does, and nobody has to remember. The options — what is
   * disabled, what is deliberately left on, and the three harness
   * constraints that bound what any of it can mean — live in
   * core/services/testing/axe.ts, and the harness itself is proven against a
   * deliberately broken fixture in its own unit spec.
   *
   * Scoped to `routeNativeElement`, never the document: Karma's debug.html
   * owns the `<html>` element, a banner and its own headings, and auditing
   * the test runner's chrome would report failures nobody can fix here.
   *
   * The violation classes that still stand are frozen per route in
   * `KNOWN_VIOLATIONS`, each with its reason in `KNOWN_VIOLATION_REASONS`.
   * Anything else fails. A class is frozen rather than fixed inside a gate
   * because each fix is a production change to a surface the gate has no
   * business touching; frozen, it stays visible and named instead of
   * nobody's problem.
   *
   * Every pass runs once per scheme in `AUDIT_SCHEMES`, forced through the
   * real ThemeService, so a pair that fails only in the scheme the host
   * does not resolve to (light on a dark Mac, dark on CI) still fails here.
   *
   * The routes this reaches are the walkthrough's: /dashboard (its top,
   * then the spending legend and the budget widget scrolled into view, and
   * once a rule exists, Upcoming), /transactions, /budgets (its Budgets tab,
   * with the overview scrolled into view, then its Recurring tab with an
   * active rule and a paused one), /reports (its first tab), /settings,
   * /data, /household (its setup state, then its member view before and
   * after the household's own budget and goal are made, and the switcher's
   * open panel over two memberships, once the walkthrough's account forms
   * its households) and /about. Every other route is **unswept**: /login is
   * opened by the redirect case but never audited, and /lock, /ai,
   * /search-history, /import/file and /import/history are never visited —
   * see docs/emulator-blind-spots.md.
   */
  async function expectNoAxeViolations(url: string): Promise<void> {
    const element = harness.routeNativeElement;
    if (!element) {
      throw new Error(`No routed element to audit for ${url}`);
    }

    for (const scheme of AUDIT_SCHEMES) {
      await withScheme(requireThemeService(), scheme, async () => {
        // runAxe finishes the transitions already running, but not one that
        // has yet to start: the quick filters bind "This month" from a
        // zero-delay timer, and a class landing during the pass would move
        // mid-audit. Let such timers land first.
        await new Promise(resolve => setTimeout(resolve));
        harness.detectChanges();

        const results = await runAxe(element);

        expect(unexpectedViolations(results, url))
          .withContext(`axe-core (wcag2a, wcag2aa) violations on ${url} in the ${scheme} scheme beyond the frozen ones`)
          .toEqual([]);
      });
    }
  }

  /**
   * The same pass, once per scheme, over one card or list of the page just
   * opened, scrolled into the band axe can score.
   *
   * A page pass never scores what starts below Karma's frame: every page
   * sits in the shell's fixed scroller, and axe skips a node under a fixed
   * ancestor once its top is past the viewport's bottom (`auditInView`, in
   * core/services/testing/axe.ts). The node must fit between the header and
   * that bottom once centred, about 285px where the frame is 413px tall, so
   * a tall card is audited as its parts.
   */
  async function expectNoAxeViolationsInView(url: string, selector: string): Promise<void> {
    const node = harness.routeNativeElement?.querySelector(selector);
    if (!node) {
      throw new Error(`No ${selector} to audit on ${url}`);
    }

    for (const scheme of AUDIT_SCHEMES) {
      await withScheme(requireThemeService(), scheme, async () => {
        harness.detectChanges();

        const results = await auditInView(node);

        expect(unexpectedViolations(results, url))
          .withContext(
            `axe-core (wcag2a, wcag2aa) violations in ${selector} on ${url} in the ${scheme} scheme beyond the frozen ones`
          )
          .toEqual([]);
      });
    }
  }

  function requireThemeService(): ThemeService {
    if (!themeService) {
      throw new Error('No ThemeService to force a scheme through: the walkthrough forces one before its first page');
    }
    return themeService;
  }

  /**
   * Puts the theme preference back on 'system', flushes it, and then both
   * classes on <html> as they were before the walkthrough forced a scheme.
   *
   * The preference goes first: ThemeService stamps a class whenever the
   * effective theme changes, so classes restored before it is flushed would
   * be overwritten on the next tick, and a forced scheme would leak into the
   * smoke files that run after this one (ADR 0151). Safe to call twice; the
   * second call does nothing.
   */
  function restoreTheme(): void {
    const before = themeClassesBefore;
    if (!before) return;
    themeClassesBefore = undefined;
    const root = document.documentElement;
    try {
      themeService?.setTheme('system');
      TestBed.inject(NgZone).run(() => TestBed.tick());
    } finally {
      themeService = undefined;
      root.classList.toggle('light-theme', before.light);
      root.classList.toggle('dark-theme', before.dark);
    }
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
   * this harness renders do not carry all nine destinations — /settings,
   * /data, /household and /about have no link here — and a route with no
   * link is not a failure. The gate tests for the anchor, not the
   * attribute, so a regression that drops aria-current still fails on every
   * route that does have one. Where both surfaces render they mark the same
   * route, so the assertion is on the distinct set of destinations rather
   * than a count.
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
   * The shell's two navigation landmarks carry names, and not the same one.
   *
   * At Karma's tablet width the sidebar exists only inside the overlay
   * drawer, so the drawer is opened the way a reader opens it, through the
   * header's menu button. The bottom nav is in the document at every width,
   * shown by class. The drawer is closed again before anything else runs,
   * so no later axe pass audits a page behind its backdrop.
   */
  async function expectLandmarksNamed(): Promise<void> {
    const shell = harness.routeNativeElement;
    if (!shell) {
      throw new Error('No shell to read the navigation landmarks from');
    }
    const menuButton = () => shell.querySelector<HTMLButtonElement>('app-header .menu-button');
    expect(menuButton()).withContext('the header menu button').not.toBeNull();

    menuButton()!.click();
    await waitForDom('the navigation drawer', () => !!shell.querySelector('.sidebar-drawer app-sidebar nav'));

    const labels = Array.from(
      shell.querySelectorAll<HTMLElement>('nav'),
      nav => (nav.getAttribute('aria-label') ?? '').trim()
    );
    expect(labels.length).withContext('navigation landmarks with the drawer open').toBe(2);
    expect(labels.every(label => label !== ''))
      .withContext(`every navigation landmark is named: ${JSON.stringify(labels)}`)
      .toBeTrue();
    expect(new Set(labels).size)
      .withContext(`no two navigation landmarks share a name: ${JSON.stringify(labels)}`)
      .toBe(labels.length);

    menuButton()!.click();
    await waitForDom('the navigation drawer closed', () => !shell.querySelector('.sidebar-drawer'));
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
  function expectScreenName(
    url: string,
    screenClass?: string,
    expected = url.replace(/^\//, '').split('?')[0]
  ): void {
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

  // beforeAll takes an explicit 30 s rather than Jasmine's 5000 ms default: a
  // cold emulator's first anonymous sign-in and the seed writes can take
  // longer than that on a loaded machine. A timed-out beforeAll is reported
  // as a suite error, and Karma ends the run there: every smoke case not yet
  // run is lost, not only this file's.
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
    groceriesId = categoryRef.id;

    const transactionBase = {
      userId: uid,
      type: 'expense',
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false
    };
    blueBottleId = (await addDoc(collection(firestore, `users/${uid}/transactions`), {
      ...transactionBase,
      amount: 6.4,
      currency: 'USD',
      amountInBaseCurrency: 6.4,
      exchangeRate: 1,
      description: 'Blue Bottle Coffee'
    })).id;
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
  }, 30000);

  afterAll(async () => {
    // Normally already done at the end of the walkthrough spec; this is the
    // safety net if a spec failed before reaching it.
    try {
      restoreTheme();
    } finally {
      await deleteApp(app).catch(() => undefined);
    }
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

      // Forced before the first page rather than left on 'system', which
      // follows the host (dark on a dark Mac, light on CI): between its
      // passes the walkthrough renders the same scheme on every host.
      const root = document.documentElement;
      themeClassesBefore = {
        light: root.classList.contains('light-theme'),
        dark: root.classList.contains('dark-theme')
      };
      themeService = TestBed.inject(ThemeService);
      themeService.setTheme(AUDIT_SCHEMES[0]);

      try {
        await expectPage('/dashboard', 'dashboard.title', 'Blue Bottle Coffee', 'app-dashboard');
        await expectLandmarksNamed();

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

        // The cards below the fold, where the category glyphs are: the
        // spending legend's tiles and the budget widget's icons.
        await waitForDom(
          'the spending legend and the budget widget, each with its item',
          () =>
            !!harness.routeNativeElement?.querySelector('app-spending-chart .legend-list .legend-item')
            && !!harness.routeNativeElement?.querySelector('app-budget-progress .budget-item')
        );
        await expectNoAxeViolationsInView('/dashboard', 'app-spending-chart .legend-list');
        await expectNoAxeViolationsInView('/dashboard', 'app-budget-progress');

        await expectPage('/transactions', 'transactions.title', 'Blue Bottle Coffee');
        await expectPage('/budgets', 'budget.title', 'Groceries Budget');
        await expectNoAxeViolationsInView('/budgets', 'app-budget-overview');
        // BUDGET_TABS and REPORT_TABS are what the data hub's ?tab= links are
        // checked against, and this is the only place the real strips render.
        // A tab added to a template without a name added to the list would
        // otherwise leave the hub silently linking at the wrong section.
        expect(
          harness.routeNativeElement?.ownerDocument.querySelectorAll('.mdc-tab').length
        ).withContext('budget tabs').toBe(BUDGET_TABS.length);

        // The title renders above the page's loading gate, so the landmark
        // alone would audit the spinner; a tab label exists only past it.
        await expectPage('/reports', 'reports.title', 'reports.spendingAnalysis');
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
          categoryId: groceriesId,
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

        // A paused rule beside the active one, in the same orange category:
        // the Recurring tab draws each rule's glyph on a tile of that colour,
        // and a paused card has to hold its glyph at 4.5:1 too, not fade it.
        await addDoc(collection(firestore, `users/${uid}/recurring`), {
          userId: uid,
          name: 'Magazine',
          type: 'expense',
          amount: 12,
          currency: 'USD',
          categoryId: groceriesId,
          description: 'Magazine subscription',
          frequency: { type: 'monthly', interval: 1 },
          startDate: inThreeDays,
          nextOccurrence: inThreeDays,
          isActive: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        await expectPage('/budgets?tab=recurring', 'budget.title', 'Gym');
        await waitForDom('the paused rule, marked paused', () => {
          const text = pageText();
          return text.includes('Magazine') && text.includes('settings.paused');
        });
        await expectNoAxeViolationsInView('/budgets?tab=recurring', 'app-recurring-transactions .recurring-grid');

        // Upcoming lists the active rule, on its tile, once a rule exists; the
        // dashboard's first visit had none.
        await expectPage('/dashboard', 'dashboard.title', 'Gym', 'app-dashboard');
        await waitForDom(
          'Upcoming with the active rule',
          () => !!harness.routeNativeElement?.querySelector('app-upcoming-bills .bill-row')
        );
        await expectNoAxeViolationsInView('/dashboard', 'app-upcoming-bills');

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
        // A signed-in account with no household lands on the setup. The
        // household listeners the page opens close when it is left, and it is
        // left here, well before the app is deleted below: a listener still
        // streaming into deleteApp surfaces as an unhandled error.
        await expectPage('/household', 'household.title', 'household.setup.createTitle', 'app-household');

        // The member view, swept too: it holds most of the page's markup. The
        // account forms two households through the service's own commits,
        // which the rules check, so the header's switcher lists two
        // memberships; the page shows the one formed last. One invite written
        // the way the callable writes it puts the mail-status copy on the
        // page. One seeded row is shared into the household shown the way the
        // app shares one, so the view has a shared row to show; the other
        // stays private and must not show.
        await setDoc(doc(firestore, `users/${uid}`), {
          email: 'test@example.com',
          displayName: 'Test User',
          createdAt: Timestamp.now(),
          lastLoginAt: Timestamp.now(),
          preferences: { baseCurrency: 'USD', language: 'en' }
        });
        const householdService = TestBed.inject(HouseholdService);
        await householdService.create('Away');
        const householdId = await householdService.create('Home');
        // share() resolves once the row names the household, whether or not
        // its copy was written (a refused copy is left to the sweep), so the
        // row showing below is what proves the rules took the copy.
        await TestBed.inject(LedgerShareService).share([blueBottleId], householdId);
        const stored = await getDocumentAsOwner(`households/${householdId}`);
        await setDocumentAsOwner(`householdInvites/${householdId}_walkthrough-invitee`, {
          householdId: stringField(householdId),
          householdCreatedAt: { timestampValue: String(stored?.['createdAt']?.['timestampValue']) },
          householdName: stringField('Home'),
          inviterUid: stringField(uid),
          inviterName: stringField('Test User'),
          inviterEmail: stringField('test@example.com'),
          inviteeUid: stringField('walkthrough-invitee'),
          inviteeEmail: stringField('robin@example.test'),
          locale: stringField('en'),
          createdAt: timestampField(),
          expiresAt: timestampField(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          mail: stringField('held')
        });
        // Still on /household: the page swaps to the member view as the
        // listeners hear the household, with no navigation to wait on.
        await waitForDom('the member view, with its shared row, its plans section, its members and its pending invite', () => {
          const text = pageText();
          return ['Blue Bottle Coffee', 'household.plans.empty', 'household.members.dissolveHeading',
            'household.members.mailHeld'].every(shown => text.includes(shown));
        });
        expect(pageText()).withContext('a row not shared stays private').not.toContain('Tokyo Dinner');
        await expectNoAxeViolations('/household');
        // The household's own budget and goal, with a contribution, made
        // through the plans service the page provides and feeds, so the
        // section's cards are swept as well as its empty state.
        const plans = harness.fixture.debugElement.query(By.css('app-household')).injector.get(HouseholdPlansService);
        const today = new Date();
        await plans.createBudget({
          name: 'Walkthrough budget',
          categoryIds: ['food'],
          amount: 200,
          currency: 'USD',
          period: 'monthly',
          startDate: startOfMonth(today)
        });
        const goalId = await plans.createGoal({ name: 'Walkthrough goal', targetAmount: 500, currency: 'USD' });
        await plans.addContribution(goalId, 25, today);
        // Counted, not counting: a card still waiting on a feed replaces its
        // figures, progress bar and contributions list with one line.
        await waitForDom('the plans section with its budget, its goal and its contribution', () => {
          const text = pageText();
          const section = harness.routeNativeElement?.querySelector('app-household-plans');
          return ['Walkthrough budget', 'Walkthrough goal'].every(shown => text.includes(shown))
            && !text.includes('household.plans.empty')
            && !text.includes('household.plans.counting')
            && section?.querySelectorAll('mat-progress-bar').length === 2
            && !!section.querySelector('li.contribution .contribution-delete');
        });
        // The switcher's panel renders in the overlay container, outside the
        // routed element the page-level pass audits, so it is swept on its own
        // and closed before that pass.
        const page = harness.routeNativeElement?.ownerDocument;
        harness.routeNativeElement
          ?.querySelector<HTMLElement>('.household-switcher-select .mat-mdc-select-trigger')
          ?.click();
        await waitForDom(
          'the switcher panel over two memberships and the setup choice',
          () => page?.querySelectorAll('.mat-mdc-select-panel .switcher-choice').length === 3
        );
        const switcherPanel = page?.querySelector('.mat-mdc-select-panel');
        if (!switcherPanel) throw new Error('No switcher panel to audit on /household');
        for (const scheme of AUDIT_SCHEMES) {
          await withScheme(requireThemeService(), scheme, async () => {
            harness.detectChanges();
            const results = await runAxe(switcherPanel);
            expect(unexpectedViolations(results, '/household (switcher panel)'))
              .withContext(
                `axe-core (wcag2a, wcag2aa) violations on the /household switcher panel in the ${scheme} scheme`
              )
              .toEqual([]);
          });
        }
        harness.fixture.debugElement.query(By.css('mat-select.household-switcher-select')).injector.get(MatSelect).close();
        await waitForDom('the switcher panel closed', () => !page?.querySelector('.mat-mdc-select-panel'));
        expectScreenName('/household', 'app-household');
        expectCurrentRouteMarked('/household');
        await expectNoAxeViolations('/household');
        // The household's own address reaches the same page through a child
        // with no component of its own: named by its template, never the id,
        // and classed as the page.
        await harness.navigateByUrl(`/household/${householdId}`);
        expectScreenName(`/household/${householdId}`, 'app-household', 'household/:hid');
        // The about page has no seeded data of its own, so the landmark is the
        // whole assertion: what it proves is that the route resolves its
        // component at all, which is the part that changed when the layout's
        // children stopped being imported eagerly.
        await expectPage('/about', 'about.title', undefined, 'app-about');
        expect(TestBed.inject(Router).url).toBe('/about');

        // The household page is closed, and its listeners with it; the
        // erasure path dissolves with one-shot reads and needs none.
        await householdService.deleteAll();

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
      } finally {
        restoreTheme();
      }
    },
    WALKTHROUGH_TIMEOUT
  );
});
