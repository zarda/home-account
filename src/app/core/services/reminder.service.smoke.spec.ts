// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { Capacitor } from '@capacitor/core';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { of } from 'rxjs';

import { ReminderService, reminderSentStorageKey } from './reminder.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { RecurringService } from './recurring.service';
import { TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import { addDays, dayKey, startOfDay } from '../utils/transaction-date.utils';
import {
  clearWeeklyRecapDeviceState,
  nextRecapMoment
} from '../utils/weekly-recap.utils';
import { BudgetAlert, DEFAULT_USER_PREFERENCES, User, UserPreferences } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for one reminder sweep against the Firestore
 * emulator.
 *
 * The unit suite hands the sweep a hand-built `RecurringOccurrence[]`, so it
 * can prove which reminders the sweep produces from a list but not that the
 * list is the one a real rule walk produces: `remindDaysBefore` reaches the
 * occurrence through a stored document, the horizon is computed from real
 * `Timestamp`s, and a lead that never arrives on the occurrence looks exactly
 * like a rule with no reminder. Only a real read shows the two halves agree.
 *
 * It lives in `test:smoke:dates` because the recap nudge lands on a local
 * Monday at 09:00, which is a different instant in every zone.
 *
 * Runs only under the emulators:
 *   npm run smoke:dates
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('ReminderService sweep (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  /** In its lead window, so the sweep raises it now. */
  const DUE_ID = 'smoke-reminder-due';
  /** Beyond its lead window, so the sweep books 09:00 on its reminder day. */
  const AHEAD_ID = 'smoke-reminder-ahead';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let recurring: RecurringService;

  interface WebNotification {
    title: string;
    body: string;
    tag: string;
  }

  /**
   * The unit harness's three seams, unchanged: the plugin so scheduling can be
   * observed without a native binary, the web notification so nothing reaches
   * the browser's own, and the clock — read once, since jasmine.clock() cannot
   * be installed here (it replaces setTimeout, which the Firestore SDK needs).
   */
  class TestReminderService extends ReminderService {
    readonly webNotifications: WebNotification[] = [];
    readonly plugin = jasmine.createSpyObj<LocalNotificationsPlugin>('LocalNotifications', [
      'schedule',
      'getPending',
      'cancel',
      'checkPermissions',
      'requestPermissions'
    ]);
    /** The instant every assertion in the case is derived from. */
    readonly at = new Date();

    protected override showWebNotification(title: string, body: string, tag: string): boolean {
      this.webNotifications.push({ title, body, tag });
      return true;
    }

    protected override nativePlugin(): LocalNotificationsPlugin {
      return this.plugin;
    }

    protected override now(): Date {
      return this.at;
    }
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `reminder-sweep-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  // Yearly, so exactly one occurrence of each rule can fall inside the sweep's
  // 31-day horizon and the reminder each produces is the only thing under test.
  const seedRule = (id: string, dueInDays: number, remindDaysBefore: number): Promise<void> => {
    const due = addDays(startOfDay(new Date()), dueInDays);
    return setDoc(doc(firestore, `users/${uid}/recurring/${id}`), {
      userId: uid,
      name: id,
      type: 'expense',
      amount: 42,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: id,
      frequency: { type: 'yearly', interval: 1 },
      startDate: Timestamp.fromDate(due),
      nextOccurrence: Timestamp.fromDate(due),
      remindDaysBefore,
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  };

  beforeEach(async () => {
    await seedRule(DUE_ID, 3, 7);
    await seedRule(AHEAD_ID, 20, 3);

    localStorage.removeItem(reminderSentStorageKey(uid));
    clearWeeklyRecapDeviceState(uid);
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);

    currentUser = signal<User | null>(null);

    TestBed.configureTestingModule({
      providers: [
        RecurringService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        {
          provide: AuthService,
          useValue: {
            currentUser,
            userId: computed(() => currentUser()?.id ?? null)
          }
        },
        // The recurring walk loads rates and budgets on its way; the reminder
        // sweep reads only the alert signal, and neither plays a part in which
        // reminders a rule produces.
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1
          }
        },
        {
          provide: BudgetService,
          useValue: {
            budgetAlerts: signal<BudgetAlert[]>([]),
            getBudgets: () => of([]),
            recalculateBudgetsForCategory: () => Promise.resolve()
          }
        },
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ]
    });
    recurring = TestBed.inject(RecurringService);
  });

  afterEach(async () => {
    localStorage.removeItem(reminderSentStorageKey(uid));
    clearWeeklyRecapDeviceState(uid);
    await deleteDoc(doc(firestore, `users/${uid}/recurring/${DUE_ID}`)).catch(() => undefined);
    await deleteDoc(doc(firestore, `users/${uid}/recurring/${AHEAD_ID}`)).catch(() => undefined);
  });

  /** The account's preferences decide the pass, so they are set before it. */
  const createService = (prefs: Partial<UserPreferences>): TestReminderService => {
    currentUser.set(
      createMockUser(uid, { preferences: { ...DEFAULT_USER_PREFERENCES, ...prefs } })
    );
    const service = TestBed.runInInjectionContext(() => new TestReminderService());
    service.plugin.checkPermissions.and.resolveTo({ display: 'granted' });
    service.plugin.requestPermissions.and.resolveTo({ display: 'granted' });
    service.plugin.schedule.and.resolveTo({ notifications: [] });
    service.plugin.getPending.and.resolveTo({ notifications: [] });
    service.plugin.cancel.and.resolveTo();
    return service;
  };

  const sentKeys = (): string[] =>
    Object.keys(JSON.parse(localStorage.getItem(reminderSentStorageKey(uid)) ?? '{}'));

  it('books both bills and the recap nudge from one walk of the stored rules', async () => {
    const service = createService({ enableReminders: true, enableWeeklyRecap: true });

    await service.sweep();

    // The pass that carries them, rather than the number of passes: the
    // service's own effect may have swept first, and a second pass produces
    // the same set without scheduling what is already booked.
    const [request] = service.plugin.schedule.calls.mostRecent().args;
    expect(request.notifications.length).toBe(3);

    // Due in three days with a seven-day lead: inside the window, so it is
    // raised now rather than booked for a day that has already passed.
    const immediate = request.notifications.filter(n => !n.schedule);
    expect(immediate.length).toBe(1);
    expect(immediate[0].body).toBe('reminders.billDueIn');

    // Due in twenty days with a three-day lead: 09:00 on the seventeenth day.
    const reminderDay = addDays(startOfDay(service.at), 17);
    const ahead = request.notifications.find(
      n => n.schedule && n.body === 'reminders.billDueIn'
    );
    expect(ahead?.schedule?.at as Date).toEqual(
      new Date(reminderDay.getFullYear(), reminderDay.getMonth(), reminderDay.getDate(), 9)
    );

    const nudge = request.notifications.find(n => n.body === 'reminders.recapReady');
    expect(nudge?.schedule?.at as Date).toEqual(nextRecapMoment(service.at));
    expect(sentKeys()).toContain(`recap|${dayKey(nextRecapMoment(service.at))}`);
    expect(service.webNotifications).toEqual([]);
  }, 30000);

  it('books only the nudge, reading no rules at all, when reminders are off', async () => {
    const service = createService({ enableReminders: false, enableWeeklyRecap: true });

    await service.sweep();

    const [request] = service.plugin.schedule.calls.mostRecent().args;
    expect(request.notifications.length).toBe(1);
    expect(request.notifications[0].body).toBe('reminders.recapReady');
    expect(sentKeys()).toEqual([`recap|${dayKey(nextRecapMoment(service.at))}`]);

    // The listener is the point: reaching it would refresh the signal the
    // pages own from a background path, for a pass that produces no bill.
    expect(recurring.recurringTransactions()).toEqual([]);
  }, 30000);

  it('retires what is pending and books nothing once both preferences are off', async () => {
    const service = createService({ enableReminders: false, enableWeeklyRecap: false });
    service.plugin.getPending.and.resolveTo({
      notifications: [{ id: 4242, title: 'app.title', body: 'reminders.recapReady' }]
    });

    await service.sweep();

    expect(service.plugin.schedule).not.toHaveBeenCalled();
    expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
    expect(recurring.recurringTransactions()).toEqual([]);
  }, 30000);
});
