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
import { provideRouter } from '@angular/router';
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
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { TransactionService } from '../../core/services/transaction.service';
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
      // NG0205, and this file shares one Firebase app across both cases.
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
});
