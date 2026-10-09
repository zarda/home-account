// Route-level smoke test for #87: the account's own arrangement of the
// dashboard's five grid cards, proven against the real router configuration,
// the Firestore emulator and the Settings editor — not just the pure layout
// math (dashboard-layout.utils.spec.ts) or the component's stubbed doubles
// (dashboard.component.spec.ts).
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages), for the compatibility reason app.smoke.spec.ts documents.
//
// Runs only under the emulators:
//   npm run smoke
// (CI wraps `npm run test:smoke` with `firebase emulators:exec --only auth,storage,firestore`.)
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAppCharts } from '../../core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { TransactionService } from '../../core/services/transaction.service';
import { FirestoreService } from '../../core/services/firestore.service';
import { addDays, budgetPeriodWindow, dayKey, startOfDay } from '../../core/utils/transaction-date.utils';
import { MockAuthService, createMockUser } from '../../core/services/testing';
import { DEFAULT_USER_PREFERENCES } from '../../models';
import { dashboardGridAreas } from './dashboard-layout.utils';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

describe('dashboard card arrangement (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const CASE_TIMEOUT = 30000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;
  let harness: RouterTestingHarness;

  // Polls until the rendered DOM satisfies the predicate; flushes change
  // detection between polls because Firestore listener callbacks arrive
  // outside the harness's knowledge (app.smoke.spec.ts's idiom).
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
    return harness.routeNativeElement?.ownerDocument.body.textContent ?? '';
  }

  beforeAll(async () => {
    // A fresh cache keeps CurrencyService, constructed as soon as the
    // dashboard is, off the network entirely.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, EUR: 0.9, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account', storageBucket: 'demo-home-account.appspot.com' },
      `dashboard-layout-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // A category, a transaction dated today and an active budget, mirroring
    // the shapes TransactionService.addTransaction / BudgetService write —
    // enough for the budget card to have something to show and for the
    // arrangement's DOM order to be the whole point of the assertions below.
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

    // Over its threshold, so the alert banner has something to say. Stamped
    // with the current period: BudgetService.freshenSpent shows an unstamped
    // `spent` as 0 and recalculates it, which would clear the alert.
    const budgetStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    await addDoc(collection(firestore, `users/${uid}/budgets`), {
      userId: uid,
      categoryId: categoryRef.id,
      name: 'Dining Out Budget',
      amount: 100,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(budgetStart),
      spent: 95,
      spentPeriod: dayKey(budgetPeriodWindow('monthly', budgetStart, new Date()).start),
      isActive: true,
      alertThreshold: 80,
      createdAt: now,
      updatedAt: now
    });
  });

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
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
      // Kept alive after each case (destroyed by hand below instead): a
      // Firestore timer that fires into a torn-down injector crashes with
      // NG0205, and this file shares one Firebase app across its cases.
      teardown: { destroyAfterEach: false }
    });
    harness = await RouterTestingHarness.create();
  });

  it(
    "renders the account's own arrangement, skips the hidden card's query, and matches the settings editor",
    async () => {
      mockAuth.setMockUser(createMockUser(uid, {
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          onboardingCompleted: true,
          ragInsightsLevel: 'standard',
          dashboardLayout: {
            order: ['budgets', 'chart', 'recent', 'upcoming', 'insights'],
            hidden: ['insights']
          }
        }
      }));

      const transactionService = TestBed.inject(TransactionService);
      const getExpensesInRangeSpy = spyOn(transactionService, 'getExpensesInRange').and.callThrough();

      await harness.navigateByUrl('/dashboard');
      await waitForDom('the budget card', () => pageText().includes('Groceries Budget'));

      const grid = harness.routeNativeElement?.ownerDocument.querySelector<HTMLElement>('.dashboard-grid');
      const childTags = Array.from(grid?.children ?? []).map(el => el.tagName);
      expect(childTags).toEqual([
        'APP-BUDGET-PROGRESS',
        'APP-SPENDING-CHART',
        'APP-RECENT-TRANSACTIONS',
        'APP-UPCOMING-BILLS'
      ]);
      expect(harness.routeNativeElement?.ownerDocument.querySelector('app-ai-summary')).toBeNull();
      expect(getExpensesInRangeSpy).not.toHaveBeenCalled();
      expect(grid?.style.getPropertyValue('--dashboard-areas')).toBe(
        dashboardGridAreas(['budgets', 'chart', 'recent', 'upcoming'])
      );

      await harness.navigateByUrl('/settings?panel=dashboard');
      await waitForDom(
        'the dashboard layout editor rows',
        () => (harness.routeNativeElement?.ownerDocument.querySelectorAll('.card-row').length ?? 0) === 5
      );

      const settingsDoc = harness.routeNativeElement!.ownerDocument;
      const titleIds = Array.from(settingsDoc.querySelectorAll<HTMLElement>('.card-row .card-title'))
        .map(el => el.id);
      expect(titleIds).toEqual([
        'dashboard-card-budgets-title',
        'dashboard-card-chart-title',
        'dashboard-card-recent-title',
        'dashboard-card-upcoming-title',
        'dashboard-card-insights-title'
      ]);

      const ariaCheckedFor = (titleId: string): string | null =>
        settingsDoc
          .querySelector<HTMLButtonElement>(`button[role="switch"][aria-labelledby="${titleId}"]`)
          ?.getAttribute('aria-checked') ?? null;
      expect(ariaCheckedFor('dashboard-card-insights-title')).toBe('false');
      expect(ariaCheckedFor('dashboard-card-budgets-title')).toBe('true');
      expect(ariaCheckedFor('dashboard-card-chart-title')).toBe('true');
      expect(ariaCheckedFor('dashboard-card-recent-title')).toBe('true');
      expect(ariaCheckedFor('dashboard-card-upcoming-title')).toBe('true');

      // Close the routed components' listeners (getBudgets, getGoals, …)
      // before the next case's beforeEach spins up a fresh harness on the
      // same shared Firebase app.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  it(
    'falls back to the fixed default order with no stored layout, and queries the baseline for the shown insights card',
    async () => {
      mockAuth.setMockUser(createMockUser(uid, {
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          onboardingCompleted: true,
          ragInsightsLevel: 'standard'
        }
      }));

      const transactionService = TestBed.inject(TransactionService);
      const getExpensesInRangeSpy = spyOn(transactionService, 'getExpensesInRange').and.callThrough();

      await harness.navigateByUrl('/dashboard');
      await waitForDom('the budget card', () => pageText().includes('Groceries Budget'));

      const grid = harness.routeNativeElement?.ownerDocument.querySelector<HTMLElement>('.dashboard-grid');
      const childTags = Array.from(grid?.children ?? []).map(el => el.tagName);
      expect(childTags).toEqual([
        'APP-RECENT-TRANSACTIONS',
        'APP-UPCOMING-BILLS',
        'APP-SPENDING-CHART',
        'APP-AI-SUMMARY',
        'APP-BUDGET-PROGRESS'
      ]);
      // No provider key survives stripProviderKeys(), so the insights host
      // renders its own no-provider state rather than nothing at all.
      expect(harness.routeNativeElement?.ownerDocument.querySelector('app-ai-summary')).not.toBeNull();

      await waitForDom(
        "getExpensesInRange called for the shown insights card's anomaly baseline",
        () => getExpensesInRangeSpy.calls.count() > 0
      );

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  // #442 AC 2, through the real editor and layout service: a toggle sends the
  // hidden field alone, so no order is pinned on an account that never moved
  // a card.
  it(
    'saves an editor toggle as the hidden field alone',
    async () => {
      mockAuth.setMockUser(createMockUser(uid, {
        preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
      }));

      await harness.navigateByUrl('/settings?panel=dashboard');
      await waitForDom(
        'the dashboard layout editor rows',
        () => (harness.routeNativeElement?.ownerDocument.querySelectorAll('.card-row').length ?? 0) === 5
      );

      const settingsDoc = harness.routeNativeElement!.ownerDocument;
      const insightsSwitch = (): HTMLButtonElement | null =>
        settingsDoc.querySelector<HTMLButtonElement>(
          'button[role="switch"][aria-labelledby="dashboard-card-insights-title"]'
        );
      expect(insightsSwitch()?.getAttribute('aria-checked')).toBe('true');

      insightsSwitch()!.click();
      await waitForDom(
        'the insights switch saved as off',
        () =>
          mockAuth.updatePreferenceFieldsSpy.calls.count() > 0 &&
          insightsSwitch()?.getAttribute('aria-checked') === 'false'
      );

      expect(mockAuth.updatePreferenceFieldsSpy).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      const wholeLayoutWrites = mockAuth.updateUserPreferencesSpy.calls
        .allArgs()
        .filter(([prefs]) => 'dashboardLayout' in prefs);
      expect(wholeLayoutWrites).toEqual([]);
      expect(mockAuth.currentUser()?.preferences.dashboardLayout).toEqual({ hidden: ['insights'] });

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  // #442: a hidden card opens no listener that nothing else on the page reads.
  // Budgets is hidden too, yet keeps its one listener: the banner, which
  // cannot be hidden, reads it.
  it(
    'opens no recent or upcoming listener for hidden cards, and one budgets listener for the banner',
    async () => {
      mockAuth.setMockUser(createMockUser(uid, {
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          onboardingCompleted: true,
          enableWeeklyRecap: false,
          dashboardLayout: { hidden: ['recent', 'upcoming', 'budgets'] }
        }
      }));

      const subscribeSpy = spyOn(TestBed.inject(FirestoreService), 'subscribeToCollection').and.callThrough();
      const listenersOn = (path: string, limit?: number): number =>
        subscribeSpy.calls.allArgs()
          .filter(([p, options]) => p === path && (limit === undefined || options?.limit === limit))
          .length;

      await harness.navigateByUrl('/dashboard');
      const doc = harness.routeNativeElement!.ownerDocument;
      await waitForDom(
        'the budget alert banner beside the rendered grid',
        () =>
          doc.querySelector('app-budget-alert-banner .alert-banner') !== null &&
          doc.querySelector('.dashboard-grid') !== null
      );

      const childTags = Array.from(doc.querySelector('.dashboard-grid')!.children).map(el => el.tagName);
      expect(childTags).toEqual(['APP-SPENDING-CHART', 'APP-AI-SUMMARY']);
      expect(doc.querySelector('app-budget-progress')).toBeNull();

      expect(listenersOn(`users/${uid}/transactions`, 5)).withContext('recent transactions').toBe(0);
      expect(listenersOn(`users/${uid}/recurring`)).withContext('recurring rules').toBe(0);
      expect(listenersOn(`users/${uid}/budgets`)).withContext('budgets').toBe(1);

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  // #442 AC 4: a card hidden from its own menu on the dashboard, through the
  // real layout service, and the editor shows the same state.
  it(
    "hides a card from the dashboard's own menu, and the editor shows it hidden",
    async () => {
      mockAuth.setMockUser(createMockUser(uid, {
        preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
      }));

      await harness.navigateByUrl('/dashboard');
      const doc = harness.routeNativeElement!.ownerDocument;
      const chartTrigger = (): HTMLButtonElement | null =>
        doc.querySelector<HTMLButtonElement>('app-spending-chart .card-menu-trigger');
      const hideItem = (): HTMLButtonElement | null =>
        doc.querySelector<HTMLButtonElement>('.mat-mdc-menu-panel [data-action="hide"]');
      await waitForDom('the spending chart card and its menu', () => chartTrigger() !== null);

      chartTrigger()!.click();
      await waitForDom('the open card menu', () => hideItem() !== null);
      hideItem()!.click();

      await waitForDom(
        'the chart hidden and its hide saved',
        () => doc.querySelector('app-spending-chart') === null && mockAuth.updatePreferenceFieldsSpy.calls.count() > 0
      );
      expect(mockAuth.updatePreferenceFieldsSpy).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['chart'] }
      });
      expect(mockAuth.currentUser()?.preferences.dashboardLayout).toEqual({ hidden: ['chart'] });

      await harness.navigateByUrl('/settings?panel=dashboard');
      await waitForDom(
        'the dashboard layout editor rows',
        () => (harness.routeNativeElement?.ownerDocument.querySelectorAll('.card-row').length ?? 0) === 5
      );

      const settingsDoc = harness.routeNativeElement!.ownerDocument;
      const ariaCheckedFor = (titleId: string): string | null =>
        settingsDoc
          .querySelector<HTMLButtonElement>(`button[role="switch"][aria-labelledby="${titleId}"]`)
          ?.getAttribute('aria-checked') ?? null;
      expect(ariaCheckedFor('dashboard-card-chart-title')).toBe('false');
      for (const card of ['recent', 'upcoming', 'insights', 'budgets']) {
        expect(ariaCheckedFor(`dashboard-card-${card}-title`)).withContext(card).toBe('true');
      }

      harness.fixture.destroy();
      // The menu rendered into the CDK overlay, outside the routed view.
      doc.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  // #446: a bill reminder's link, /dashboard?bill=<rule id>, through the real
  // router, the recurring listener and the card.
  describe('a bill link', () => {
    const RULE_ID = 'smoke-bill-link';

    // Three days ahead, so the catch-up the dashboard runs posts nothing and
    // the row stays on the Upcoming card.
    beforeEach(async () => {
      const due = addDays(startOfDay(new Date()), 3);
      await setDoc(doc(firestore, `users/${uid}/recurring/${RULE_ID}`), {
        userId: uid,
        name: 'Smoke Rent',
        type: 'expense',
        amount: 42,
        currency: 'USD',
        categoryId: 'housing_rent',
        description: 'Smoke Rent',
        frequency: { type: 'yearly', interval: 1 },
        startDate: Timestamp.fromDate(due),
        nextOccurrence: Timestamp.fromDate(due),
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    });

    afterEach(async () => {
      harness.fixture.destroy();
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${RULE_ID}`)).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it(
      'focuses the rule on the Upcoming card, and takes the link off the URL',
      async () => {
        mockAuth.setMockUser(createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
        }));
        const router = TestBed.inject(Router);

        await harness.navigateByUrl(`/dashboard?bill=${RULE_ID}`);
        const page = harness.routeNativeElement!.ownerDocument;
        await waitForDom(
          'the bill row focused',
          () => page.activeElement?.matches(`app-upcoming-bills .bill-row[data-rule-id="${RULE_ID}"]`) ?? false
        );

        expect(page.activeElement?.textContent).toContain('Smoke Rent');
        expect(router.url).toBe('/dashboard');
      },
      CASE_TIMEOUT
    );

    it(
      'opens the recurring rules while Upcoming is hidden',
      async () => {
        mockAuth.setMockUser(createMockUser(uid, {
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            onboardingCompleted: true,
            dashboardLayout: { hidden: ['upcoming'] }
          }
        }));
        const router = TestBed.inject(Router);

        await harness.navigateByUrl(`/dashboard?bill=${RULE_ID}`);
        await waitForDom('the recurring rules', () => router.url === '/budgets?tab=recurring');

        expect(harness.routeNativeElement?.ownerDocument.querySelector('app-upcoming-bills')).toBeNull();
      },
      CASE_TIMEOUT
    );

    // The card has no row for it, so the server is asked before the user is
    // sent away; the emulator answers that read here.
    it(
      'opens the recurring rules for a rule the server does not list in the fortnight',
      async () => {
        mockAuth.setMockUser(createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
        }));
        const router = TestBed.inject(Router);

        await harness.navigateByUrl('/dashboard?bill=smoke-no-such-rule');
        await waitForDom('the recurring rules', () => router.url === '/budgets?tab=recurring');
      },
      CASE_TIMEOUT
    );
  });
});
