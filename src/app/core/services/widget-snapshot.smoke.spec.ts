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
// snapshot is its raw key — until the language case, which answers the
// catalog request itself with a fixture.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAppDatepicker } from '../config/datepicker.config';
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
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { TranslationService } from './translation.service';
import { WidgetSnapshotService } from './widget-snapshot.service';
import { WIDGET_SNAPSHOT_PLUGIN } from '../plugins/widget-snapshot.plugin';
import { DashboardLayoutService } from '../../features/dashboard/dashboard-layout.service';
import { APP_LOCK_STORAGE_PREFIX } from '../utils/app-lock.utils';
import { addDays, budgetPeriodWindow, dayKey } from '../utils/transaction-date.utils';
import { MockAuthService, createMockUser, provideNoMotion } from './testing';
import { DashboardCardId, DEFAULT_USER_PREFERENCES, User, WidgetSnapshot } from '../../models';
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
  // The language case's catalog: the one title, the sentences and the budget
  // line the widget words, as the Japanese catalog words them.
  const JA_CATALOG = {
    dashboard: { thisMonth: '今月' },
    widget: {
      spent: '支出',
      topBudget: '最も使った予算',
      nextScheduled: '次の予定',
      noBudgets: '有効な予算はありません',
      locked: '今月の数字を見るにはアプリのロックを解除してください',
      signedOut: '今月の数字を見るにはサインインしてください',
      stale: '今月の数字を更新するにはアプリを開いてください',
      updated: '{{date}}更新',
      budgetDetail: '{{spent}} / {{limit}}'
    }
  };

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

  // A formatted amount reduced to its digits, so a case names the figure
  // without naming the symbol, the grouping or the sign the formatter writes.
  function digits(text: string | undefined): string {
    return (text ?? '').replace(/\D/g, '');
  }

  function localMonthKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async function transactionsJson(): Promise<string[]> {
    return Promise.all(transactionRefs.map(async ref => JSON.stringify((await getDoc(ref)).data())));
  }

  // onboardingCompleted is restated because an override replaces the whole
  // preferences object rather than merging into it.
  function accountUser(enableAppLock = false, baseCurrency = 'USD', hidden?: DashboardCardId[]): User {
    return createMockUser(uid, {
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        onboardingCompleted: true,
        baseCurrency,
        enableAppLock,
        ...(hidden ? { dashboardLayout: { hidden } } : {})
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
        provideNoMotion(),
        provideHttpClient(),
        // After the real one, so a catalog request is the case's to answer.
        provideHttpClientTesting(),
        provideAppDatepicker(),
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
    'rewrites the figures in a new base currency as the open dashboard repaints them',
    async () => {
      mockAuth.setMockUser(accountUser());
      TestBed.inject(WidgetSnapshotService);

      await harness.navigateByUrl('/dashboard');
      // Expenses 70 + 50 in dollars, written and painted.
      await waitFor(
        'the figures in dollars',
        () => digits(lastWrite()?.figures?.spent) === '12000' && digits(statValues()[1]) === '12000'
      );
      const dollars = lastWrite()!;
      expect(digits(dollars.figures?.net)).toBe('9000');

      // The rows are at rate 1 and the cached rates read 150 yen to the dollar,
      // so the page and the widget both move to 18,000 and 13,500 with no new
      // row and no other change.
      mockAuth.setMockUser(accountUser(false, 'JPY'));
      await waitFor(
        'the figures in yen, painted and written',
        () => digits(statValues()[1]) === '18000' && digits(lastWrite()?.figures?.spent) === '18000'
      );

      const yen = lastWrite()!;
      const [, expenses, balance] = statValues();
      expect(yen.state).toBe('figures');
      expect(yen.figures?.spent).withContext('the expenses stat card').toBe(expenses);
      expect(yen.figures?.net).withContext('the balance stat card').toBe(balance);
      expect(digits(yen.figures?.net)).toBe('13500');
      expect(yen.figures?.spent).withContext('not the dollar sentence again').not.toBe(dollars.figures?.spent);

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  it(
    'rewrites the labels when the language changes with the dashboard open',
    async () => {
      mockAuth.setMockUser(accountUser());
      TestBed.inject(WidgetSnapshotService);
      const http = TestBed.inject(HttpTestingController);
      const translation = TestBed.inject(TranslationService);
      // setLocale writes the document's language; the next case reads English.
      const lang = document.documentElement.lang;

      try {
        await harness.navigateByUrl('/dashboard');
        await waitFor(
          'a figures write with the budget',
          () => lastWrite()?.figures?.topBudget?.name === BUDGET_NAME
        );
        expect(lastWrite()!.labels.title).withContext('no catalog loaded yet').toBe('dashboard.thisMonth');
        expect(lastWrite()!.figures?.topBudget?.detail).toBe('widget.budgetDetail');

        // The way the settings page and the account's own language reach it:
        // the real service, its request answered with the fixture.
        const switching = translation.setLocale('ja');
        http.expectOne('/assets/i18n/ja.json').flush(JA_CATALOG);
        await switching;

        await waitFor('the labels in the new language', () => lastWrite()?.labels.title === '今月');
        const written = lastWrite()!;
        expect(written.state).toBe('figures');
        expect(written.labels.spent).toBe('支出');
        expect(written.labels.topBudget).toBe('最も使った予算');
        expect(written.figures?.topBudget?.name).toBe(BUDGET_NAME);
        expect(written.figures?.topBudget?.detail).withContext('the budget line, recomposed too').toMatch(/ \/ /);
        expect(written.figures?.topBudget?.detail).not.toContain('widget.budgetDetail');
        expect(http.match(() => true).map(request => request.request.url))
          .withContext('no other request left unanswered')
          .toEqual([]);
      } finally {
        document.documentElement.lang = lang;
      }

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );

  // #441 P5: the widget follows the account's hidden set. The budgets stream
  // stays open for the banner and the other readers, so the seeded budget does
  // reach the page; what is proved is that it does not reach the widget.
  it(
    'leaves out the cards the account hid, and brings one back once it is shown',
    async () => {
      mockAuth.setMockUser(accountUser(false, 'USD', ['budgets', 'upcoming']));
      TestBed.inject(WidgetSnapshotService);
      const budgets = TestBed.inject(BudgetService);
      // The dashboard is the window's only caller, and with Upcoming hidden
      // and the recap off nothing on it reads the window.
      const upcomingListener = spyOn(TestBed.inject(RecurringService), 'getUpcomingSchedule').and.callThrough();

      await harness.navigateByUrl('/dashboard');
      await waitFor(
        'the seeded budget loaded and a figures write',
        () => budgets.activeBudgets().some(budget => budget.name === BUDGET_NAME) && lastWrite()?.state === 'figures'
      );
      // A window for the publishing effect to run on the loaded budget.
      for (let pass = 0; pass < 5; pass++) {
        harness.detectChanges();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const bothHidden = lastWrite()!;
      expect(bothHidden.state).toBe('figures');
      expect(bothHidden.figures?.hidden).toEqual(['budgets', 'upcoming']);
      expect(bothHidden.figures?.topBudget).toBeNull();
      expect(bothHidden.figures?.nextScheduled).toBeNull();
      expect(JSON.stringify(bothHidden)).not.toContain(BUDGET_NAME);
      expect(JSON.stringify(bothHidden)).not.toContain(RULE_NAME);
      expect(upcomingListener).withContext('the recurring listener').not.toHaveBeenCalled();
      // The positive proof: the same write carries the month's figures.
      expect(digits(bothHidden.figures?.spent)).toBe('12000');

      await TestBed.inject(DashboardLayoutService).show('budgets');
      await waitFor('the budget back in the widget', () => lastWrite()?.figures?.topBudget?.name === BUDGET_NAME);

      const shown = lastWrite()!;
      expect(shown.figures?.hidden).toEqual(['upcoming']);
      expect(shown.figures?.topBudget?.percent).toBe(82);
      expect(shown.figures?.nextScheduled).toBeNull();
      expect(upcomingListener).withContext('the recurring listener, still').not.toHaveBeenCalled();

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

  it(
    'leaves the signed-out sentence when the session ends under the open dashboard',
    async () => {
      mockAuth.setMockUser(accountUser());
      TestBed.inject(WidgetSnapshotService);

      await harness.navigateByUrl('/dashboard');
      await waitFor('a figures write', () => lastWrite()?.state === 'figures');

      // The page stays alive, as it does when the device's SDK ends a session
      // on its own: no navigation, no teardown, the dashboard still painted.
      mockAuth.setMockUser(null);
      // Any signed-out write, not the last one: the failure this case guards
      // is a figures write landing after it.
      await waitFor('a signed-out write', () => writes.some(write => write.state === 'signedOut'));
      const signedOutAt = writes.findIndex(write => write.state === 'signedOut');

      // A window for the dashboard's effect to republish what it still holds.
      for (let pass = 0; pass < 15; pass++) {
        harness.detectChanges();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      expect(writes.slice(signedOutAt + 1).map(write => write.state))
        .withContext('writes after the signed-out one')
        .toEqual([]);
      expect(lastWrite()!.state).toBe('signedOut');
      expect('figures' in lastWrite()!).toBeFalse();

      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    CASE_TIMEOUT
  );
});
