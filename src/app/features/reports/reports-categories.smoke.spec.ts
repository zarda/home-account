// Route-level smoke test for #488: the Reports page's Categories tab lists two
// categories with equal totals in category id order, in both its panels and
// its donut's legend, on each side of the toggle. Proven against the real
// router configuration and the Firestore emulator, where rows arrive
// date-descending, rather than the component's stubbed doubles
// (category-breakdown.component.spec.ts).
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
import { provideHttpClient } from '@angular/common/http';
import { provideAppDatepicker } from '../../core/config/datepicker.config';
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
import { startOfDay } from '../../core/utils/transaction-date.utils';
import { MockAuthService, createMockUser, provideNoMotion } from '../../core/services/testing';
import { DEFAULT_USER_PREFERENCES } from '../../models';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

describe('reports Categories tab (emulator smoke test)', () => {
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

  beforeAll(async () => {
    // A fresh cache keeps CurrencyService, constructed as soon as the
    // page is, off the network entirely.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, EUR: 0.9, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account', storageBucket: 'demo-home-account.appspot.com' },
      `reports-categories-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
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
        provideNoMotion(),
        provideHttpClient(),
        provideAppDatepicker(),
        provideAppCharts(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth }
      ],
      // Kept alive after the case (destroyed by hand below instead): a
      // Firestore timer that fires into a torn-down injector crashes with
      // NG0205.
      teardown: { destroyAfterEach: false }
    });
    harness = await RouterTestingHarness.create();
  });

  // Each side seeds its higher id's row later today, so the window, which
  // arrives date-descending, holds it first: first-seen order would list it
  // first. The income names run against their ids, so a sort by name would
  // fail too. Two categories a side keeps the legend's six-row cut out of it.
  it(
    'lists two categories with equal totals in category id order, on each side of the toggle',
    async () => {
      const categoryIds = ['smoke-tie-a', 'smoke-tie-b', 'smoke-tie-c', 'smoke-tie-d'];
      const transactionIds: string[] = [];
      const seedCategory = (id: string, name: string, type: 'expense' | 'income') =>
        setDoc(doc(firestore, `users/${uid}/categories/${id}`), {
          userId: uid,
          name,
          icon: 'category',
          color: '#607D8B',
          type,
          order: 1,
          isActive: true,
          isDefault: false
        });
      const seedRow = async (type: 'expense' | 'income', categoryId: string, date: Timestamp) => {
        const ref = await addDoc(collection(firestore, `users/${uid}/transactions`), {
          userId: uid,
          type,
          categoryId,
          date,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          isRecurring: false,
          amount: 25,
          currency: 'USD',
          amountInBaseCurrency: 25,
          exchangeRate: 1,
          description: `Smoke ${categoryId}`
        });
        transactionIds.push(ref.id);
      };

      try {
        const earlier = Timestamp.fromDate(startOfDay(new Date()));
        await seedCategory('smoke-tie-a', 'Tie Alpha', 'expense');
        await seedCategory('smoke-tie-b', 'Tie Beta', 'expense');
        await seedCategory('smoke-tie-c', 'Tie Gamma', 'income');
        await seedCategory('smoke-tie-d', 'Tie Delta', 'income');
        await seedRow('expense', 'smoke-tie-a', earlier);
        await seedRow('expense', 'smoke-tie-b', Timestamp.now());
        await seedRow('income', 'smoke-tie-c', earlier);
        await seedRow('income', 'smoke-tie-d', Timestamp.now());

        mockAuth.setMockUser(createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
        }));

        // The tab is read from ?tab= once, at construction, and the tab group
        // renders only once the window has loaded. Material attaches only the
        // active tab's body, so these queries see the Categories tab alone.
        await harness.navigateByUrl('/reports?tab=categories');
        const page = harness.routeNativeElement!.ownerDocument;
        const tied = (names: string[]): string[] => names.filter(name => name.startsWith('Tie '));
        const panelNames = (): string[] =>
          tied(Array.from(page.querySelectorAll('app-category-breakdown .category-name'))
            .map(el => (el.textContent ?? '').replace(/\s*\(\d+\)\s*$/, '').trim()));
        const legendNames = (): string[] =>
          tied(Array.from(page.querySelectorAll('app-category-breakdown app-spending-chart .legend-name'))
            .map(el => el.textContent?.trim() ?? ''));

        await waitForDom(
          'both tied expense categories in the panels and the legend',
          () => panelNames().length === 2 && legendNames().length === 2
        );
        expect(panelNames()).withContext('expense panels').toEqual(['Tie Alpha', 'Tie Beta']);
        expect(legendNames()).withContext('expense legend').toEqual(['Tie Alpha', 'Tie Beta']);

        const incomeToggle = page.querySelector<HTMLButtonElement>(
          'app-category-breakdown mat-button-toggle[value="income"] button'
        );
        expect(incomeToggle).withContext('the income toggle').not.toBeNull();
        incomeToggle!.click();

        await waitForDom(
          'both tied income categories in the panels and the legend',
          () => panelNames().includes('Tie Gamma') && legendNames().includes('Tie Gamma')
            && panelNames().length === 2 && legendNames().length === 2
        );
        expect(panelNames()).withContext('income panels').toEqual(['Tie Gamma', 'Tie Delta']);
        expect(legendNames()).withContext('income legend').toEqual(['Tie Gamma', 'Tie Delta']);
      } finally {
        harness.fixture.destroy();
        for (const id of transactionIds) {
          await deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined);
        }
        for (const id of categoryIds) {
          await deleteDoc(doc(firestore, `users/${uid}/categories/${id}`)).catch(() => undefined);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    },
    CASE_TIMEOUT
  );

  // A panel lists its rows in each row's own currency, formatted in the
  // account's language: a yen amount carries no decimals. The category's
  // figures beside it stay in the base currency, with cents. The name keeps
  // it out of the tie case's filter should a row outlive its case.
  it(
    "reads a yen row without decimals while the category's figures keep the base currency's cents",
    async () => {
      const categoryId = 'smoke-yen';
      const transactionIds: string[] = [];

      try {
        await setDoc(doc(firestore, `users/${uid}/categories/${categoryId}`), {
          userId: uid,
          name: 'Yen Smoke',
          icon: 'category',
          color: '#607D8B',
          type: 'expense',
          order: 1,
          isActive: true,
          isDefault: false
        });
        const ref = await addDoc(collection(firestore, `users/${uid}/transactions`), {
          userId: uid,
          type: 'expense',
          categoryId,
          date: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          isRecurring: false,
          amount: 1000,
          currency: 'JPY',
          amountInBaseCurrency: 6.67,
          exchangeRate: 1 / 150,
          description: 'Smoke yen'
        });
        transactionIds.push(ref.id);

        mockAuth.setMockUser(createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true }
        }));

        await harness.navigateByUrl('/reports?tab=categories');
        const page = harness.routeNativeElement!.ownerDocument;
        const panel = (): Element | undefined =>
          Array.from(page.querySelectorAll('app-category-breakdown mat-expansion-panel')).find(candidate =>
            (candidate.querySelector('.category-name')?.textContent ?? '').trim().startsWith('Yen Smoke')
          );

        await waitForDom(
          "the yen category's panel with its row",
          () => panel()?.querySelector('.transaction-amount') != null
        );
        const yen = panel()!;
        expect(yen.querySelector('.transaction-amount')?.textContent?.trim())
          .withContext("the row, in its own currency")
          .toBe('¥1,000');
        const stats = Array.from(yen.querySelectorAll('.stats-grid .stat-value'))
          .map(el => el.textContent?.trim());
        expect(stats[0]).withContext('the total, in the base currency').toBe('$6.67');
        expect(stats[1]).withContext('the average, in the base currency').toBe('$6.67');
      } finally {
        harness.fixture.destroy();
        for (const id of transactionIds) {
          await deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined);
        }
        await deleteDoc(doc(firestore, `users/${uid}/categories/${categoryId}`)).catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    },
    CASE_TIMEOUT
  );
});
