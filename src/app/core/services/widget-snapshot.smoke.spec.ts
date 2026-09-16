// Route-level smoke test for #85: the home-screen widget's snapshot composed
// from real Firestore rows by the routed dashboard, and the lock and sign-out
// writes that must replace it — proven against the real router configuration,
// the Firestore emulator, AppLockService and WidgetSnapshotService. Only the
// native plugin is fake. The unit specs hand the service figures directly
// (widget-snapshot.service.spec.ts) or stub the service on the page
// (dashboard.component.spec.ts), so neither shows that what reaches the
// widget is what the page painted.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages), for the compatibility reason app.smoke.spec.ts documents.
//
// Runs only under the emulators:
//   npm run smoke
// (CI wraps `npm run test:smoke` with `firebase emulators:exec --only auth,storage,firestore`.)
//
// i18n JSON is not served by the Karma asset config, so every label in a
// snapshot is its raw key.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAppCharts } from '../config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  getDoc,
  DocumentReference,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { AuthService } from './auth.service';
import { AppLockService } from './app-lock.service';
import { WidgetSnapshotService } from './widget-snapshot.service';
import { WIDGET_SNAPSHOT_PLUGIN } from '../plugins/widget-snapshot.plugin';
import { APP_LOCK_STORAGE_PREFIX } from '../utils/app-lock.utils';
import { addDays, budgetPeriodWindow, dayKey } from '../utils/transaction-date.utils';
import { MockAuthService, createMockUser } from './testing';
import { DEFAULT_USER_PREFERENCES, User, WidgetSnapshot } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { stripProviderKeys } from './testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

describe('widget snapshot from real rows (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const CASE_TIMEOUT = 30000;
  const BUDGET_NAME = 'Groceries Budget';
  const RULE_NAME = 'Gym';
  // Expenses 70 + 50 against income 30, so the net is negative and its
  // on-page display carries the pinned word joiner.
  const EXPENSES = [70, 50];
  const INCOME = 30;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let transactionRefs: DocumentReference[];
  let mockAuth: MockAuthService;
  let harness: RouterTestingHarness;
  let writes: WidgetSnapshot[];

  // Polls until the predicate holds; flushes change detection between polls
  // because Firestore listener callbacks arrive outside the harness's
  // knowledge (app.smoke.spec.ts's idiom). Once the fixture is destroyed only
  // the application tick is left to run the service's root effects.
  async function waitFor(
    label: string,
    predicate: () => boolean,
    flush: () => void = () => harness.detectChanges(),
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

  function page(): Document {
    return harness.routeNativeElement!.ownerDocument;
  }

  function lastWrite(): WidgetSnapshot | undefined {
    return writes[writes.length - 1];
  }

  function statValues(): string[] {
    return Array.from(page().querySelectorAll<HTMLElement>('app-financial-summary .stat-value'))
      .map(el => (el.textContent ?? '').replace(/\u2060/g, '').trim());
  }

  function localMonthKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async function transactionsJson(): Promise<string[]> {
    return Promise.all(transactionRefs.map(async ref => JSON.stringify((await getDoc(ref)).data())));
  }

  // onboardingCompleted is restated because an override replaces the whole
  // preferences object rather than merging into it.
  function accountUser(enableAppLock = false): User {
    return createMockUser(uid, {
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        onboardingCompleted: true,
        baseCurrency: 'USD',
        enableAppLock
      }
    });
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
      `widget-snapshot-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Shapes mirror what TransactionService.addTransaction, BudgetService and
    // RecurringService write.
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
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      currency: 'USD',
      exchangeRate: 1
    };
    transactionRefs = await Promise.all([
      ...EXPENSES.map((amount, index) =>
        addDoc(collection(firestore, `users/${uid}/transactions`), {
          ...transactionBase,
          type: 'expense',
          amount,
          amountInBaseCurrency: amount,
          description: `Groceries run ${index + 1}`
        })
      ),
      addDoc(collection(firestore, `users/${uid}/transactions`), {
        ...transactionBase,
        type: 'income',
        amount: INCOME,
        amountInBaseCurrency: INCOME,
        description: 'Refund'
      })
    ]);

    // Stamped with the current period: BudgetService.freshenSpent shows an
    // unstamped `spent` as 0 and recalculates it from the transactions, which
    // would replace the 246 this case ranks on.
    const budgetStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    await addDoc(collection(firestore, `users/${uid}/budgets`), {
      userId: uid,
      categoryId: categoryRef.id,
      name: BUDGET_NAME,
      amount: 300,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(budgetStart),
      spent: 246,
      spentPeriod: dayKey(budgetPeriodWindow('monthly', budgetStart, new Date()).start),
      isActive: true,
      alertThreshold: 90,
      createdAt: now,
      updatedAt: now
    });

    // Not yet due, so the dashboard's catch-up posts nothing from it.
    const inThreeDays = Timestamp.fromDate(addDays(new Date(), 3));
    await addDoc(collection(firestore, `users/${uid}/recurring`), {
      userId: uid,
      name: RULE_NAME,
      type: 'expense',
      amount: 30,
      currency: 'USD',
      categoryId: categoryRef.id,
      description: 'Gym membership',
      frequency: { type: 'monthly', interval: 1 },
      startDate: inThreeDays,
      nextOccurrence: inThreeDays,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
  });

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    writes = [];
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
        { provide: AuthService, useValue: mockAuth },
        // The web factory yields null, which leaves nothing to write through.
        {
          provide: WIDGET_SNAPSHOT_PLUGIN,
          useValue: {
            write: jasmine.createSpy('write').and.callFake(async ({ snapshot }: { snapshot: string }) => {
              writes.push(JSON.parse(snapshot) as WidgetSnapshot);
            })
          }
        }
      ],
      // Kept alive after each case (destroyed by hand below instead): a
      // Firestore timer that fires into a torn-down injector crashes with
      // NG0205, and this file shares one Firebase app across its cases.
      teardown: { destroyAfterEach: false }
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    // PIN records are device-local and keyed by the account, which every case
    // here shares.
    Object.keys(localStorage)
      .filter(key => key.startsWith(APP_LOCK_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  });

  it(
    "writes the figures the dashboard painted for this month, and nothing for last month's",
    async () => {
      mockAuth.setMockUser(accountUser());
      // app.config's initializer is what arms the service in the app; smoke
      // specs do not load app.config.
      TestBed.inject(WidgetSnapshotService);
      const transactionsBefore = await transactionsJson();

      await harness.navigateByUrl('/dashboard');
      await waitFor(
        'the budget card, the scheduled rule and a write',
        () =>
          (page().querySelector('app-budget-progress')?.textContent ?? '').includes(BUDGET_NAME) &&
          (page().querySelector('app-upcoming-bills')?.textContent ?? '').includes(RULE_NAME) &&
          statValues().length === 3 &&
          /[1-9]/.test(statValues()[1]) &&
          writes.length > 0
      );

      const snapshot = lastWrite()!;
      const [, expenses, balance] = statValues();
      expect(snapshot.version).toBe(1);
      expect(snapshot.state).toBe('figures');
      expect(snapshot.monthKey).toBe(localMonthKey(new Date()));
      expect(snapshot.labels.title).toBe('dashboard.thisMonth');
      expect(snapshot.figures?.spent).withContext('the expenses stat card').toBe(expenses);
      expect(snapshot.figures?.net).withContext('the balance stat card').toBe(balance);
      expect(snapshot.figures?.net).withContext('the seeded net is negative').toMatch(/^[-−]/);
      expect(snapshot.figures?.topBudget?.name).toBe(BUDGET_NAME);
      expect(snapshot.figures?.topBudget?.percent).toBe(82);
      expect(snapshot.figures?.nextScheduled?.name).toBe(RULE_NAME);
      expect(await transactionsJson()).toEqual(transactionsBefore);

      const writesBeforeSwitch = writes.length;
      const periodToggles = page().querySelectorAll<HTMLElement>('.mat-button-toggle-button');
      expect(periodToggles.length).toBeGreaterThan(1);
      periodToggles[1].click();
      await waitFor('the totals repainted for last month', () => {
        const values = statValues();
        return values.length === 3 && values.every(value => !/[1-9]/.test(value));
      });
      expect(writes.length).withContext('writes after switching to last month').toBe(writesBeforeSwitch);

      // Close the routed components' listeners before the next case's
      // harness opens its own on the same Firebase app.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  it(
    'writes a locked snapshot with no figures once the lock can engage, without the dashboard',
    async () => {
      mockAuth.setMockUser(accountUser(true));
      TestBed.inject(WidgetSnapshotService);

      await harness.navigateByUrl('/settings');
      await waitFor('the settings page', () => (page().body.textContent ?? '').includes('settings.title'));
      expect(writes.length).withContext('no credential yet, so nothing to lock').toBe(0);

      await TestBed.inject(AppLockService).setPin('123456');
      await waitFor('a locked write', () => writes.some(write => write.state === 'locked'));

      const locked = writes.find(write => write.state === 'locked')!;
      expect('figures' in locked).toBeFalse();
      expect(locked.labels.locked).toBe('widget.locked');
      expect(writes.some(write => write.state === 'figures')).toBeFalse();

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  it(
    "replaces the account's figures with a signed-out snapshot on sign-out",
    async () => {
      mockAuth.setMockUser(accountUser());
      TestBed.inject(WidgetSnapshotService);

      await harness.navigateByUrl('/dashboard');
      await waitFor('a figures write', () => lastWrite()?.state === 'figures');
      // The routed pages' listeners go first: a signed-out account's
      // services have no path to read from.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));

      mockAuth.setMockUser(null);
      await waitFor('a signed-out write', () => lastWrite()?.state === 'signedOut', () => TestBed.tick());

      const signedOut = lastWrite()!;
      expect('figures' in signedOut).toBeFalse();
      expect(signedOut.labels.signedOut).toBe('widget.signedOut');
    },
    CASE_TIMEOUT
  );
});
