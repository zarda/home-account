import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { Subject, of } from 'rxjs';

import {
  ReminderService,
  clearReminderDeviceState,
  reminderSentStorageKey,
} from './reminder.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { RecurringService } from './recurring.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import {
  BudgetAlert,
  BudgetAlertSeverity,
  DEFAULT_USER_PREFERENCES,
  RecurringOccurrence,
  Transaction,
  User,
  UserPreferences,
} from '../../models';
import { addDays, dayKey, startOfDay } from '../utils/transaction-date.utils';
import {
  clearWeeklyRecapDeviceState,
  writeDismissedRecapWeek,
} from '../utils/weekly-recap.utils';

const USER_ID = 'user-1';

interface WebNotification {
  title: string;
  body: string;
  tag: string;
  route: string;
}

/**
 * Substitutes the production seams. `webPermitted` stands in for the browser
 * permission without touching the read-only global; `webDisplays` is what
 * the seam reports back, which is what the service uses to decide whether
 * the reminder counts as sent. `webPermissionReads` counts calls to
 * `webPermission()`, the only way to prove a batch reads permission once
 * rather than once per reminder.
 */
class TestReminderService extends ReminderService {
  readonly webNotifications: WebNotification[] = [];
  readonly plugin = jasmine.createSpyObj<LocalNotificationsPlugin>('LocalNotifications', [
    'schedule',
    'getPending',
    'cancel',
    'checkPermissions',
    'requestPermissions',
  ]);
  webPermitted = true;
  webDisplays: boolean | ((tag: string) => boolean) = true;
  webPermissionReads = 0;
  /**
   * What the recap gate answers. Defaults to `'news'` so cases about
   * scheduling, dedup and pruning are not also about the gate's read;
   * `'read'` hands the question to the real seam, which reads through the
   * TransactionService and CurrencyService doubles.
   */
  recapGate: 'news' | 'read' = 'news';

  protected override recapWeekHasNews(at: Date): Promise<boolean> {
    return this.recapGate === 'read' ? super.recapWeekHasNews(at) : Promise.resolve(true);
  }

  protected override async showWebNotification(
    title: string,
    body: string,
    tag: string,
    route: string
  ): Promise<boolean> {
    this.webNotifications.push({ title, body, tag, route });
    return typeof this.webDisplays === 'function' ? this.webDisplays(tag) : this.webDisplays;
  }

  protected override webPermission(): NotificationPermission | 'unsupported' {
    this.webPermissionReads += 1;
    return this.webPermitted ? 'granted' : 'denied';
  }

  protected override nativePlugin(): LocalNotificationsPlugin {
    return this.plugin;
  }
}

/**
 * Exercises the real `showWebNotification` rather than the stand-in above:
 * only `nativePlugin` and `webPermission` are substituted, so every case
 * reaches the production registration/constructor logic. The seam stays
 * `protected` in production; this wrapper is the test-only public door to it.
 */
class RealWebSeamService extends ReminderService {
  readonly plugin = jasmine.createSpyObj<LocalNotificationsPlugin>('LocalNotifications', [
    'schedule',
    'getPending',
    'cancel',
    'checkPermissions',
    'requestPermissions',
  ]);

  protected override nativePlugin(): LocalNotificationsPlugin {
    return this.plugin;
  }

  protected override webPermission(): NotificationPermission | 'unsupported' {
    return 'granted';
  }

  raiseWebNotification(title: string, body: string, tag: string, route: string): Promise<boolean> {
    return this.showWebNotification(title, body, tag, route);
  }
}

/**
 * Turn the microtask queue until delivery has settled. jasmine.clock()
 * replaces setTimeout, so a timer-based flush would never resolve; every
 * await on the delivery path is on an already-settled promise, so turning
 * the queue a fixed number of times drains it.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('ReminderService', () => {
  let currentUser: ReturnType<typeof signal<User | null>>;
  let budgetAlerts: ReturnType<typeof signal<BudgetAlert[]>>;
  let occurrences: RecurringOccurrence[];
  let recurring: jasmine.SpyObj<RecurringService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let isNative: jasmine.Spy<() => boolean>;
  let now: Date;

  /** 10:00 keeps every assertion clear of both local midnight boundaries. */
  const NOW = new Date(2026, 8, 1, 10, 0, 0);

  function setPreferences(prefs: Partial<UserPreferences>): void {
    currentUser.set(
      createMockUser(USER_ID, { preferences: { ...DEFAULT_USER_PREFERENCES, ...prefs } })
    );
  }

  function daysOut(days: number): Date {
    return addDays(startOfDay(now), days);
  }

  function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
    return {
      recurringId: 'rule-1',
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'cat-1',
      date: daysOut(0),
      ...overrides,
    };
  }

  function alert(overrides: Partial<BudgetAlert> = {}): BudgetAlert {
    return {
      budgetId: 'budget-1',
      budgetName: 'Groceries',
      percentUsed: 85,
      remaining: 15,
      severity: 'warning' as BudgetAlertSeverity,
      spentPeriod: '2026-09-01',
      ...overrides,
    };
  }

  function createService(): TestReminderService {
    const service = TestBed.runInInjectionContext(() => new TestReminderService());
    service.plugin.checkPermissions.and.resolveTo({ display: 'granted' });
    service.plugin.requestPermissions.and.resolveTo({ display: 'granted' });
    service.plugin.schedule.and.resolveTo({ notifications: [] });
    service.plugin.getPending.and.resolveTo({ notifications: [] });
    service.plugin.cancel.and.resolveTo();
    return service;
  }

  /** Run the constructor effects, then let delivery finish. */
  async function sweep(): Promise<void> {
    TestBed.tick();
    await settle();
  }

  function readSentLog(): Record<string, number> {
    return JSON.parse(localStorage.getItem(reminderSentStorageKey(USER_ID)) ?? '{}');
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(NOW);
    now = new Date();
    localStorage.removeItem(reminderSentStorageKey(USER_ID));
    clearWeeklyRecapDeviceState(USER_ID);

    currentUser = signal<User | null>(null);
    budgetAlerts = signal<BudgetAlert[]>([]);
    occurrences = [];

    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['updateUserPreferences'], {
      currentUser,
      // Derived from currentUser the way the real computed is, so a test that
      // signs an account in cannot leave the two disagreeing.
      userId: computed(() => currentUser()?.id ?? null),
    });

    const budget = jasmine.createSpyObj<BudgetService>('BudgetService', [], { budgetAlerts });

    recurring = jasmine.createSpyObj<RecurringService>('RecurringService', ['getNextOccurrences']);
    recurring.getNextOccurrences.and.callFake(() => of(occurrences));

    translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    isNative = spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: BudgetService, useValue: budget },
        { provide: RecurringService, useValue: recurring },
        { provide: TranslationService, useValue: translation },
      ],
    });

    setPreferences({ enableReminders: true });
  });

  afterEach(() => {
    localStorage.removeItem(reminderSentStorageKey(USER_ID));
    clearWeeklyRecapDeviceState(USER_ID);
    jasmine.clock().uninstall();
  });

  describe('bill reminders', () => {
    it('notifies when an occurrence enters its lead window', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications.length).toBe(1);
      expect(service.webNotifications[0].title).toBe('app.title');
      expect(service.webNotifications[0].tag).toBe('bill|rule-1|2026-09-04|3');
      expect(translation.t).toHaveBeenCalledWith('reminders.billDueIn', { name: 'Rent', count: 3 });
    });

    it('stays silent one day before the window opens', async () => {
      occurrences = [occurrence({ date: daysOut(4), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
    });

    it('never notifies for a rule that carries no lead', async () => {
      occurrences = [occurrence({ date: daysOut(0) })];
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
    });

    it('with a zero lead notifies only on the due day', async () => {
      occurrences = [occurrence({ date: daysOut(1), remindDaysBefore: 0 })];
      const service = createService();

      await sweep();
      expect(service.webNotifications).toEqual([]);

      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      const today = createService();
      await sweep();

      expect(today.webNotifications.length).toBe(1);
      expect(translation.t).toHaveBeenCalledWith('reminders.billDue', { name: 'Rent' });
    });

    it('skips an occurrence dated before today', async () => {
      occurrences = [occurrence({ date: daysOut(-1), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
    });

    it('notifies once per occurrence across service instances', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];

      const first = createService();
      await sweep();
      expect(first.webNotifications.length).toBe(1);

      const second = createService();
      await sweep();
      expect(second.webNotifications).toEqual([]);
    });

    it('rounds a fractional lead rather than letting it fall through', async () => {
      occurrences = [occurrence({ date: daysOut(4), remindDaysBefore: 3.6 })];
      const rounded = createService();
      await sweep();
      expect(rounded.webNotifications.length).toBe(1);

      localStorage.removeItem(reminderSentStorageKey(USER_ID));
      occurrences = [occurrence({ date: daysOut(4), remindDaysBefore: 3.4 })];
      const down = createService();
      await sweep();
      expect(down.webNotifications).toEqual([]);
    });

    it('bounds an oversized lead to the sweep window', async () => {
      occurrences = [occurrence({ date: daysOut(31), remindDaysBefore: 3650 })];
      const beyond = createService();
      await sweep();
      expect(beyond.webNotifications).toEqual([]);

      occurrences = [occurrence({ date: daysOut(30), remindDaysBefore: 3650 })];
      const within = createService();
      await sweep();
      expect(within.webNotifications.length).toBe(1);
    });

    it('notifies once for a rule with many occurrences already in window', async () => {
      occurrences = [0, 1, 2, 3].map(day =>
        occurrence({ date: daysOut(day), remindDaysBefore: 30 })
      );
      const service = createService();

      await sweep();

      expect(service.webNotifications.length).toBe(1);
      expect(service.webNotifications[0].tag).toBe('bill|rule-1|2026-09-01|30');
    });

    it('reads the window from the recurring service once per sweep', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      createService();

      await sweep();

      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(1);
      expect(recurring.getNextOccurrences).toHaveBeenCalledWith(31);
    });
  });

  describe('budget alerts', () => {
    it('notifies once per budget, period and severity', async () => {
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();
      expect(service.webNotifications.length).toBe(1);
      expect(service.webNotifications[0].tag).toBe('budget|budget-1|2026-09-01|warning');
      expect(translation.t).toHaveBeenCalledWith('budget.alertSnackbarWarning', {
        name: 'Groceries',
        percent: 85,
      });

      budgetAlerts.set([alert({ percentUsed: 86 })]);
      await sweep();
      expect(service.webNotifications.length).toBe(1);
    });

    it('notifies again when the severity escalates', async () => {
      budgetAlerts.set([alert()]);
      const service = createService();
      await sweep();

      budgetAlerts.set([alert({ severity: 'exceeded', percentUsed: 120 })]);
      await sweep();

      expect(service.webNotifications.map(n => n.tag)).toEqual([
        'budget|budget-1|2026-09-01|warning',
        'budget|budget-1|2026-09-01|exceeded',
      ]);
    });

    it('notifies again in the next spend period', async () => {
      budgetAlerts.set([alert()]);
      const service = createService();
      await sweep();

      budgetAlerts.set([alert({ spentPeriod: '2026-10-01' })]);
      await sweep();

      expect(service.webNotifications.length).toBe(2);
    });

    it('skips an alert with no spend period to scope it to', async () => {
      budgetAlerts.set([alert({ spentPeriod: undefined })]);
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
    });
  });

  describe('the route a tap opens', () => {
    it('hands the web seam the dashboard row for a bill', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications.map(n => n.route)).toEqual(['/dashboard?bill=rule-1']);
    });

    it('hands the web seam the budgets tab for a budget alert', async () => {
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();

      expect(service.webNotifications.map(n => n.route)).toEqual(['/budgets?tab=budgets']);
    });

    it('books every native bill, due now or ahead, with its row', async () => {
      isNative.and.returnValue(true);
      occurrences = [
        occurrence({ date: daysOut(3), remindDaysBefore: 3 }),
        occurrence({ recurringId: 'rule-2', name: 'Gym', date: daysOut(10), remindDaysBefore: 3 }),
      ];
      const service = createService();

      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.map(n => [Boolean(n.schedule), n.extra])).toEqual([
        [false, { route: '/dashboard?bill=rule-1' }],
        [true, { route: '/dashboard?bill=rule-2' }],
      ]);
    });

    it('books a native budget alert with the budgets tab', async () => {
      isNative.and.returnValue(true);
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.map(n => n.extra)).toEqual([{ route: '/budgets?tab=budgets' }]);
    });

    it('books the recap nudge with the week it announces', async () => {
      isNative.and.returnValue(true);
      setPreferences({ enableWeeklyRecap: true });
      const service = createService();

      await sweep();

      // NOW is Tuesday 1 September; the nudge on Monday the 7th announces
      // the week that opened on 31 August.
      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.map(n => n.extra)).toEqual([
        { route: '/dashboard?recap=2026-08-31' },
      ]);
    });
  });

  describe('gating', () => {
    it('is inert while the preference is off', async () => {
      setPreferences({ enableReminders: false });
      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(recurring.getNextOccurrences).not.toHaveBeenCalled();
    });

    it('opens no listener while the user document is still loading', async () => {
      currentUser.set(null);
      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(recurring.getNextOccurrences).not.toHaveBeenCalled();
    });

    it('sweeps once the account and its preference arrive', async () => {
      currentUser.set(null);
      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      const service = createService();
      await sweep();

      setPreferences({ enableReminders: true });
      await sweep();

      expect(service.webNotifications.length).toBe(1);
    });
  });

  describe('visibility sweeps', () => {
    it('debounces flaps inside the interval', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      createService();
      await sweep();
      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(1);

      jasmine.clock().tick(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(1);
    });

    it('sweeps again once the interval has passed', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      createService();
      await sweep();

      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(2);
    });
  });

  describe('sweep', () => {
    it('runs a pass inside the debounce interval', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();
      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(1);

      // The settings toggle, seconds after the sweep at app open. Debouncing
      // an explicit user action would leave reminders silent until the next
      // visibility flap, five minutes away at the earliest.
      jasmine.clock().tick(1_000);
      await service.sweep();

      expect(recurring.getNextOccurrences).toHaveBeenCalledTimes(2);
    });

    it('resolves only once the pass has delivered', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      // No settle(): the caller awaits delivery, not just the subscription.
      await service.sweep();

      expect(service.webNotifications.length).toBe(1);
    });

    it('books nothing when a listener an earlier pass left open resolves after both preferences go off', async () => {
      isNative.and.returnValue(true);
      const waiting = new Subject<RecurringOccurrence[]>();
      recurring.getNextOccurrences.and.returnValue(waiting);
      const service = createService();
      await sweep();
      expect(waiting.observed).toBeTrue();

      // Cancelling pending notifications never touches a listener a previous
      // pass opened; only a late snapshot proves whether it was closed too.
      setPreferences({ enableReminders: false, enableWeeklyRecap: false });
      await service.sweep();
      waiting.next([occurrence({ date: daysOut(0), remindDaysBefore: 0 })]);
      await settle();

      expect(service.plugin.schedule).not.toHaveBeenCalled();
      expect(readSentLog()).toEqual({});
    });

    it('settles a pass a later pass closed before its first snapshot, once that pass has delivered', async () => {
      const first = new Subject<RecurringOccurrence[]>();
      const second = new Subject<RecurringOccurrence[]>();
      const listeners = [first, second];
      recurring.getNextOccurrences.and.callFake(() => listeners.shift() ?? of(occurrences));
      const service = createService();
      let settled = false;
      const swept = service.sweep().then(() => (settled = true));
      await settle();
      expect(first.observed).withContext('the first pass waits on its listener').toBeTrue();

      // The toggle's next pass closes that listener before anything reaches it.
      void service.sweep();
      await settle();
      expect(first.observed).withContext('closed by the pass that took over').toBeFalse();
      expect(settled).withContext('before the pass that took over has delivered').toBeFalse();

      second.next([occurrence({ date: daysOut(3), remindDaysBefore: 3 })]);
      await settle();

      expect(settled).withContext('once it has').toBeTrue();
      await swept;
      expect(service.webNotifications.length).toBe(1);
    });

    it('settles a pass whose listener the both-off cancel closed before its first snapshot', async () => {
      const waiting = new Subject<RecurringOccurrence[]>();
      recurring.getNextOccurrences.and.returnValue(waiting);
      const service = createService();
      let settled = false;
      const swept = service.sweep().then(() => (settled = true));
      await settle();
      expect(waiting.observed).toBeTrue();

      setPreferences({ enableReminders: false, enableWeeklyRecap: false });
      await service.sweep();
      await settle();

      expect(settled).toBeTrue();
      await swept;
    });
  });

  describe('the weekly recap nudge', () => {
    /** 09:00 on the Monday after NOW, which is a Tuesday. */
    const NEXT_MONDAY_NINE = new Date(2026, 8, 7, 9, 0, 0);

    /** The week that Monday's nudge announces: the one it opens is not over. */
    const ANNOUNCED_WEEK = '2026-08-31';

    beforeEach(() => isNative.and.returnValue(true));

    it('schedules one for the next Monday at 09:00', async () => {
      setPreferences({ enableReminders: true, enableWeeklyRecap: true });
      const service = createService();

      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.length).toBe(1);
      expect(request.notifications[0].body).toBe('reminders.recapReady');
      expect(request.notifications[0].schedule?.at as Date).toEqual(NEXT_MONDAY_NINE);
      expect(Object.keys(readSentLog())).toEqual(['recap|2026-09-07']);
    });

    it('produces the same notification for the next sweep to spare', async () => {
      setPreferences({ enableWeeklyRecap: true });
      const service = createService();
      await sweep();
      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const id = booked.notifications[0].id;

      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.recapReady' }],
      });
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      // Produced, not queued: the key is already delivered, so it is not
      // scheduled a second time — but the stale-cancel still has to see it.
      expect(service.plugin.schedule).toHaveBeenCalledTimes(1);
      expect(service.plugin.cancel).not.toHaveBeenCalled();
    });

    it('books one without opening the recurring listener when reminders are off', async () => {
      setPreferences({ enableReminders: false, enableWeeklyRecap: true });
      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      const service = createService();

      await sweep();

      expect(recurring.getNextOccurrences).not.toHaveBeenCalled();
      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.length).toBe(1);
      expect(request.notifications[0].schedule?.at as Date).toEqual(NEXT_MONDAY_NINE);
    });

    it('sweeps on a visibility change for a recap-only account', async () => {
      setPreferences({ enableWeeklyRecap: true });
      const service = createService();
      await sweep();
      const swept = service.plugin.getPending.calls.count();

      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.plugin.getPending.calls.count()).toBeGreaterThan(swept);
    });

    it('says nothing about a week this device has already dismissed', async () => {
      writeDismissedRecapWeek(USER_ID, ANNOUNCED_WEEK);
      setPreferences({ enableWeeklyRecap: true });
      const service = createService();
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: 4242, title: 'app.title', body: 'reminders.recapReady' }],
      });

      await sweep();

      expect(service.plugin.schedule).not.toHaveBeenCalled();
      // Dismissing after the nudge was booked has to retire it too, or it
      // announces a card the user has already put away.
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
    });

    it('announces this Monday from before nine and the next one from after', async () => {
      jasmine.clock().mockDate(new Date(2026, 8, 7, 8, 59, 0));
      setPreferences({ enableWeeklyRecap: true });
      const early = createService();
      await sweep();

      const [beforeNine] = early.plugin.schedule.calls.mostRecent().args;
      expect(beforeNine.notifications[0].schedule?.at as Date).toEqual(NEXT_MONDAY_NINE);

      // A second device-day, past the moment: the week that Monday opened is
      // still running, so there is nothing to recap until the one after it.
      localStorage.removeItem(reminderSentStorageKey(USER_ID));
      jasmine.clock().mockDate(new Date(2026, 8, 7, 9, 1, 0));
      const late = createService();
      await sweep();

      const [afterNine] = late.plugin.schedule.calls.mostRecent().args;
      expect(afterNine.notifications[0].schedule?.at as Date).toEqual(
        new Date(2026, 8, 14, 9, 0, 0)
      );
    });

    it('is never raised on the web, where nothing can be scheduled', async () => {
      isNative.and.returnValue(false);
      setPreferences({ enableWeeklyRecap: true });
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(service.plugin.schedule).not.toHaveBeenCalled();
      expect(readSentLog()).toEqual({});
    });

    it('drops a listener the previous bill pass left open', async () => {
      const waiting = new Subject<RecurringOccurrence[]>();
      recurring.getNextOccurrences.and.returnValue(waiting);
      setPreferences({ enableReminders: true, enableWeeklyRecap: true });
      createService();
      await sweep();
      expect(waiting.observed).toBeTrue();

      // Reminders off while that first snapshot is still on its way: a pass
      // that produces no bills must not leave one able to deliver them.
      jasmine.clock().tick(5 * 60_000);
      setPreferences({ enableReminders: false, enableWeeklyRecap: true });
      await sweep();

      expect(waiting.observed).toBeFalse();
    });

    it('retires everything and books nothing once both preferences are off', async () => {
      setPreferences({ enableReminders: false, enableWeeklyRecap: false });
      occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
      const service = createService();
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: 4242, title: 'app.title', body: 'reminders.recapReady' }],
      });

      await service.sweep();

      expect(recurring.getNextOccurrences).not.toHaveBeenCalled();
      expect(service.plugin.schedule).not.toHaveBeenCalled();
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
    });

    describe('the gate on what the announced week has to say', () => {
      /** The week before the announced one, which the card compares against. */
      const WEEK_BEFORE = '2026-08-24';

      let transactions: jasmine.SpyObj<TransactionService>;

      /** Rows each window read answers with, keyed by the day it opens on. */
      let rowsByWeek: Map<string, Transaction[]>;

      function expense(date: Date): Transaction {
        return {
          id: `tx-${dayKey(date)}`,
          userId: USER_ID,
          type: 'expense',
          amount: 20,
          currency: 'USD',
          amountInBaseCurrency: 20,
          exchangeRate: 1,
          categoryId: 'cat-food',
          description: 'Lunch',
          isRecurring: false,
          date: Timestamp.fromDate(date),
          createdAt: Timestamp.fromDate(date),
          updatedAt: Timestamp.fromDate(date),
        };
      }

      function answerReads(): void {
        transactions.getTransactionsInRangeFromServer.and.callFake(
          async (start: Date) => rowsByWeek.get(dayKey(start)) ?? []
        );
      }

      /** Hold every read until the returned release is called, for the races. */
      function holdReads(): () => void {
        let release!: () => void;
        const landed = new Promise<void>(resolve => (release = resolve));
        transactions.getTransactionsInRangeFromServer.and.callFake(async (start: Date) => {
          await landed;
          return rowsByWeek.get(dayKey(start)) ?? [];
        });
        return release;
      }

      /** The windows the gate read, as `start..end` day keys. */
      function readWindows(): string[] {
        return transactions.getTransactionsInRangeFromServer.calls
          .allArgs()
          .map(([start, end]) => `${dayKey(start)}..${dayKey(end)}`);
      }

      function bookedNudges(service: TestReminderService): number {
        return service.plugin.schedule.calls
          .allArgs()
          .flatMap(([request]) => request.notifications)
          .filter(notification => notification.body === 'reminders.recapReady').length;
      }

      function createReadingService(): TestReminderService {
        const service = createService();
        service.recapGate = 'read';
        return service;
      }

      beforeEach(() => {
        rowsByWeek = new Map();
        transactions = jasmine.createSpyObj<TransactionService>('TransactionService', [
          'getTransactionsInRangeFromServer',
        ]);
        answerReads();

        TestBed.configureTestingModule({
          providers: [
            { provide: TransactionService, useValue: transactions },
            // Answers from the row's own snapshot, as the recap's smoke does.
            {
              provide: CurrencyService,
              useValue: {
                amountInBase: (transaction: Transaction) =>
                  transaction.amountInBaseCurrency ?? transaction.amount,
              },
            },
          ],
        });

        // Recap only, so the nudge is the whole of what a pass books.
        setPreferences({ enableWeeklyRecap: true });
      });

      it('books nothing for a quiet fortnight, and retires the nudge already booked', async () => {
        const service = createReadingService();
        service.plugin.getPending.and.resolveTo({
          notifications: [{ id: 4242, title: 'app.title', body: 'reminders.recapReady' }],
        });

        await sweep();

        // The week Monday's nudge announces, so far, and the one before it.
        expect(readWindows()).toEqual(['2026-08-31..2026-09-06', '2026-08-24..2026-08-30']);
        expect(service.plugin.schedule).not.toHaveBeenCalled();
        expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
        expect(readSentLog()).toEqual({});
      });

      it('books it for spending in the announced week so far', async () => {
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const service = createReadingService();

        await sweep();

        const [request] = service.plugin.schedule.calls.mostRecent().args;
        expect(request.notifications.map(n => n.schedule?.at as Date)).toEqual([NEXT_MONDAY_NINE]);
        expect(Object.keys(readSentLog())).toEqual(['recap|2026-09-07']);
      });

      it('books it for spending in the week before alone', async () => {
        // An empty week after a week of spending is the story the card tells.
        rowsByWeek.set(WEEK_BEFORE, [expense(new Date(2026, 7, 25, 12))]);
        const service = createReadingService();

        await sweep();

        expect(bookedNudges(service)).toBe(1);
      });

      it('books it when the read fails', async () => {
        transactions.getTransactionsInRangeFromServer.and.rejectWith(new Error('unavailable'));
        const service = createReadingService();

        await sweep();

        expect(bookedNudges(service)).toBe(1);
      });

      it('reads nothing on the web, where the nudge is never booked', async () => {
        isNative.and.returnValue(false);
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const service = createReadingService();

        await sweep();

        expect(transactions.getTransactionsInRangeFromServer).not.toHaveBeenCalled();
        expect(service.plugin.schedule).not.toHaveBeenCalled();
      });

      it('publishes nothing for an account the session left while the gate was reading', async () => {
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const release = holdReads();
        const service = createReadingService();
        await sweep();
        expect(transactions.getTransactionsInRangeFromServer).toHaveBeenCalled();

        currentUser.set(createMockUser('user-2', { preferences: { ...DEFAULT_USER_PREFERENCES } }));
        await sweep();
        release();
        await settle();

        expect(service.plugin.schedule).not.toHaveBeenCalled();
        expect(readSentLog()).toEqual({});
      });

      it('delivers once when an explicit sweep overlaps the pass the effect started', async () => {
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const release = holdReads();
        const service = createReadingService();

        // The effect's pass is waiting on the read when the settings toggle
        // asks for its own.
        TestBed.tick();
        const swept = service.sweep();
        release();
        await swept;
        await settle();

        expect(bookedNudges(service)).toBe(1);
        // One read of each week, shared by both passes.
        expect(transactions.getTransactionsInRangeFromServer).toHaveBeenCalledTimes(2);
      });

      it('holds an explicit sweep the effect took over until the effect has booked', async () => {
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const release = holdReads();
        const service = createReadingService();
        let grant!: () => void;
        const granted = new Promise<void>(resolve => (grant = resolve));
        service.plugin.checkPermissions.and.callFake(async () => {
          await granted;
          return { display: 'granted' as const };
        });

        // The toggle's pass first, then the effect's first run: meeting the
        // account resets the debounce, so it starts a pass of its own.
        let resolved = false;
        const swept = service.sweep().then(() => (resolved = true));
        TestBed.tick();
        release();
        await settle();

        // The effect's pass is the one booking, and it is still asking.
        expect(resolved).toBeFalse();

        grant();
        await swept;

        expect(bookedNudges(service)).toBe(1);
        expect(Object.keys(readSentLog())).toEqual(['recap|2026-09-07']);
      });

      it('books nothing when both preferences go off while the gate is reading', async () => {
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        const release = holdReads();
        const service = createReadingService();
        await sweep();

        setPreferences({ enableReminders: false, enableWeeklyRecap: false });
        await service.sweep();
        release();
        await settle();

        expect(service.plugin.schedule).not.toHaveBeenCalled();
        expect(readSentLog()).toEqual({});
      });

      it('books nothing when the switch cancels while the gate is reading, before its write lands', async () => {
        occurrences = [occurrence({ date: daysOut(0), remindDaysBefore: 0 })];
        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        setPreferences({ enableReminders: true, enableWeeklyRecap: true });
        const release = holdReads();
        const service = createReadingService();
        await sweep();
        expect(transactions.getTransactionsInRangeFromServer).toHaveBeenCalled();

        // The switch cancels before it writes the preference, and the account
        // document moves only once the server acknowledges that write, so the
        // pass wakes with reminders still on.
        await service.cancelScheduled();
        expect(service.enabled()).toBeTrue();
        release();
        await settle();

        expect(service.plugin.schedule).not.toHaveBeenCalled();
        expect(readSentLog()).toEqual({});
      });

      it('asks again after a quiet answer, and not again once the week has news', async () => {
        const service = createReadingService();
        await sweep();
        expect(bookedNudges(service)).toBe(0);

        rowsByWeek.set(ANNOUNCED_WEEK, [expense(new Date(2026, 7, 31, 12))]);
        jasmine.clock().tick(5 * 60_000);
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(bookedNudges(service)).toBe(1);

        jasmine.clock().tick(5 * 60_000);
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();

        // Three passes, and only the first two read: a week found to have news
        // is not asked about again.
        expect(service.plugin.getPending.calls.count()).toBe(3);
        expect(transactions.getTransactionsInRangeFromServer).toHaveBeenCalledTimes(4);
      });
    });
  });

  describe('the sent log', () => {
    it('prunes entries older than 60 days', async () => {
      const stale = now.getTime() - 61 * 24 * 60 * 60 * 1000;
      const recent = now.getTime() - 59 * 24 * 60 * 60 * 1000;
      localStorage.setItem(
        reminderSentStorageKey(USER_ID),
        JSON.stringify({ 'bill|old|2026-06-01': stale, 'bill|fresh|2026-07-04': recent })
      );
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      createService();

      await sweep();

      const log = readSentLog();
      expect(Object.keys(log)).not.toContain('bill|old|2026-06-01');
      expect(Object.keys(log)).toContain('bill|fresh|2026-07-04');
      expect(Object.keys(log)).toContain('bill|rule-1|2026-09-04|3');
    });

    it('prunes on a sweep that delivers nothing', async () => {
      // A device that never delivers again — permission refused, or every rule
      // long gone — never writes, so pruning cannot hang off the write.
      const stale = now.getTime() - 61 * 24 * 60 * 60 * 1000;
      localStorage.setItem(
        reminderSentStorageKey(USER_ID),
        JSON.stringify({ 'bill|old|2026-06-01': stale })
      );
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const denied = createService();
      denied.webPermitted = false;

      await sweep();

      expect(denied.webNotifications).toEqual([]);
      expect(readSentLog()).toEqual({});
    });

    it('still notifies when the log cannot be read', async () => {
      localStorage.setItem(reminderSentStorageKey(USER_ID), 'not json');
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications.length).toBe(1);
    });

    it('is emptied by the erasure the account-deletion cascade runs', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      createService();
      await sweep();
      expect(Object.keys(readSentLog())).toEqual(['bill|rule-1|2026-09-04|3']);

      clearReminderDeviceState(USER_ID);

      expect(readSentLog()).toEqual({});
    });

    it('survives a storage that refuses the write without repeating itself', async () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();
      expect(service.webNotifications.length).toBe(1);

      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.webNotifications.length).toBe(1);
    });
  });

  describe('web delivery', () => {
    it('marks nothing as sent when the page has no permission', async () => {
      occurrences = [
        occurrence({ date: daysOut(3), remindDaysBefore: 3 }),
        occurrence({ recurringId: 'rule-2', name: 'Gym', date: daysOut(3), remindDaysBefore: 3 }),
      ];
      const denied = createService();
      denied.webPermitted = false;

      await sweep();

      // Once per batch, not once per reminder: the read happens exactly once
      // even though two bills are due.
      expect(denied.webPermissionReads).toBe(1);
      expect(denied.webNotifications).toEqual([]);
      expect(readSentLog()).toEqual({});
    });

    it('skips a reminder the browser refuses to raise and still raises the next', async () => {
      occurrences = [
        occurrence({ date: daysOut(3), remindDaysBefore: 3 }),
        occurrence({ recurringId: 'rule-2', name: 'Gym', date: daysOut(3), remindDaysBefore: 3 }),
      ];
      const service = createService();
      const firstKey = 'bill|rule-1|2026-09-04|3';
      service.webDisplays = tag => tag !== firstKey;

      await sweep();

      expect(service.webNotifications.map(n => n.tag)).toEqual([
        firstKey,
        'bill|rule-2|2026-09-04|3',
      ]);
      expect(Object.keys(readSentLog())).toEqual(['bill|rule-2|2026-09-04|3']);
    });

    it('never schedules ahead of time', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(service.plugin.schedule).not.toHaveBeenCalled();
    });
  });

  describe('the web seam', () => {
    const ROUTE = '/dashboard?bill=rule-1';
    let service: RealWebSeamService;

    beforeEach(() => {
      if (!('serviceWorker' in navigator)) {
        pending('this browser has no navigator.serviceWorker');
      }
      service = TestBed.runInInjectionContext(() => new RealWebSeamService());
    });

    it('raises through the registered worker rather than the constructor', async () => {
      const fakeRegistration = {
        active: {},
        showNotification: jasmine.createSpy().and.resolveTo(),
      } as unknown as ServiceWorkerRegistration;
      const getRegistrationSpy = spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(fakeRegistration);
      const notificationSpy = spyOn(window, 'Notification');

      // Not awaited yet: a `.ready`-based implementation would hang here
      // forever (nothing controls this origin), and this must fail fast on
      // that rather than ride out Jasmine's async timeout. Two microtask
      // turns are enough for the real seam's `getRegistration()` call.
      const pending = service.raiseWebNotification('title', 'b', 't', ROUTE);
      await Promise.resolve();
      await Promise.resolve();
      expect(getRegistrationSpy).toHaveBeenCalledTimes(1);

      const result = await pending;

      expect(result).toBeTrue();
      expect(getRegistrationSpy).toHaveBeenCalledTimes(1);
      // The route rides in `data`, which is all the worker's click handler
      // can read back.
      expect(fakeRegistration.showNotification).toHaveBeenCalledWith('title', {
        body: 'b',
        tag: 't',
        data: { route: ROUTE },
      });
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('falls back to the constructor when nothing is registered', async () => {
      const getRegistrationSpy = spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(undefined);
      const notificationSpy = spyOn(window, 'Notification');

      const result = await service.raiseWebNotification('title', 'b', 't', ROUTE);

      expect(result).toBeTrue();
      expect(getRegistrationSpy).toHaveBeenCalledTimes(1);
      expect(notificationSpy).toHaveBeenCalledWith('title', { body: 'b', tag: 't' });
      expect(notificationSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to the constructor while the registration has no active worker', async () => {
      // A worker still installing: showNotification rejects until one is
      // active, so the first visit after a deploy would raise nothing.
      const fakeRegistration = {
        active: null,
        showNotification: jasmine.createSpy().and.rejectWith(new TypeError('No active registration')),
      } as unknown as ServiceWorkerRegistration;
      spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(fakeRegistration);
      const notificationSpy = spyOn(window, 'Notification');

      const result = await service.raiseWebNotification('title', 'b', 't', ROUTE);

      expect(result).toBeTrue();
      expect(fakeRegistration.showNotification).not.toHaveBeenCalled();
      expect(notificationSpy).toHaveBeenCalledOnceWith('title', { body: 'b', tag: 't' });
    });

    it('opens the route in this page when a constructor-raised notification is clicked', async () => {
      spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(undefined);
      const raised = {
        onclick: null as ((event: Event) => unknown) | null,
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'Notification').and.callFake(function () {
        return raised;
      } as unknown as () => Notification);
      const focus = spyOn(window, 'focus');
      const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

      await service.raiseWebNotification('title', 'b', 't', ROUTE);
      expect(navigate).not.toHaveBeenCalled();

      raised.onclick?.(new Event('click'));

      expect(focus).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledOnceWith(ROUTE);
      expect(raised.close).toHaveBeenCalled();
    });

    it('reports false when the registration refuses to display', async () => {
      const fakeRegistration = {
        active: {},
        showNotification: jasmine.createSpy().and.rejectWith(new Error('refused')),
      } as unknown as ServiceWorkerRegistration;
      const getRegistrationSpy = spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(fakeRegistration);

      const result = await service.raiseWebNotification('title', 'b', 't', ROUTE);

      expect(result).toBeFalse();
      expect(getRegistrationSpy).toHaveBeenCalledTimes(1);
    });

    it('reports false when the constructor throws', async () => {
      spyOn(navigator.serviceWorker, 'getRegistration').and.resolveTo(undefined);
      const notificationSpy = spyOn(window, 'Notification').and.callFake(() => {
        throw new TypeError('Notification is not allowed');
      });

      const result = await service.raiseWebNotification('title', 'b', 't', ROUTE);

      expect(result).toBeFalse();
      expect(notificationSpy).toHaveBeenCalled();
    });
  });

  describe('native delivery', () => {
    beforeEach(() => isNative.and.returnValue(true));

    it('never constructs a web notification', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      budgetAlerts.set([alert()]);
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(service.plugin.schedule).toHaveBeenCalled();
    });

    it('delivers an in-window bill immediately', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.length).toBe(1);
      expect(request.notifications[0].schedule).toBeUndefined();
    });

    it('schedules only the nearest future reminder per rule, at 09:00 local', async () => {
      occurrences = [
        occurrence({ date: daysOut(10), remindDaysBefore: 3 }),
        occurrence({ date: daysOut(20), remindDaysBefore: 3 }),
      ];
      const service = createService();

      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      expect(request.notifications.length).toBe(1);
      const at = request.notifications[0].schedule?.at as Date;
      expect(at).toEqual(new Date(2026, 8, 8, 9, 0, 0));
    });

    it('counts an ahead-of-time reminder as delivered once the OS accepts it', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();
      expect(Object.keys(readSentLog())).toEqual(['bill|rule-1|2026-09-11|3']);

      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.plugin.schedule).toHaveBeenCalledTimes(1);
    });

    it('leaves nothing behind when the OS refuses the schedule', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      service.plugin.schedule.and.rejectWith(new Error('too many pending'));

      await sweep();

      expect(readSentLog()).toEqual({});
    });

    it('does not repeat an ahead-of-time reminder as an immediate one', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const scheduled = createService();
      // A day earlier the reminder was scheduled for 09:00 today, which marks
      // it sent; today's sweep must leave it to the operating system.
      localStorage.setItem(
        reminderSentStorageKey(USER_ID),
        JSON.stringify({ 'bill|rule-1|2026-09-04|3': now.getTime() - 86_400_000 })
      );

      await sweep();

      expect(scheduled.plugin.schedule).not.toHaveBeenCalled();
    });

    it('cancels a pending reminder the sweep no longer produces', async () => {
      occurrences = [];
      const service = createService();
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: 4242, title: 'app.title', body: 'reminders.billDue' }],
      });

      await sweep();

      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
    });

    it('keeps a pending reminder whose occurrence is still produced', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      const id = request.notifications[0].id;
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.plugin.cancel).not.toHaveBeenCalled();
    });

    it('reschedules and retires the old moment when the lead widens', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();

      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const staleId = booked.notifications[0].id;
      expect(booked.notifications[0].schedule?.at as Date).toEqual(new Date(2026, 8, 8, 9, 0, 0));

      // The rule keeps its date and its already-delivered occurrence; only the
      // lead moves, which must still move the notification.
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: staleId, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 7 })];
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.plugin.schedule).toHaveBeenCalledTimes(2);
      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications[0].schedule?.at as Date).toEqual(new Date(2026, 8, 4, 9, 0, 0));
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: staleId }] });
    });

    it('drops the key of a reminder the sweep retired, so a restored rule re-books', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();
      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const id = booked.notifications[0].id;

      // The rule is edited away, so the sweep stops producing its key and the
      // pending notification is retired.
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      occurrences = [];
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });

      // Restored: scheduling marked the key delivered, so a cancel that left
      // the entry behind would let the reminder day pass in silence.
      service.plugin.getPending.and.resolveTo({ notifications: [] });
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(service.plugin.schedule).toHaveBeenCalledTimes(2);
      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications.map(notification => notification.id)).toEqual([id]);
    });

    it('keeps the key of a reminder that already fired', async () => {
      const both = (): RecurringOccurrence[] => [
        occurrence({ date: daysOut(0), remindDaysBefore: 0 }),
        occurrence({ recurringId: 'rule-2', name: 'Gym', date: daysOut(10), remindDaysBefore: 3 }),
      ];
      occurrences = both();
      const service = createService();
      await sweep();

      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const pendingId = booked.notifications.find(n => n.schedule)?.id as number;
      const firedId = booked.notifications.find(n => !n.schedule)?.id as number;

      // Only the ahead-of-time one is still pending: the immediate reminder was
      // handed to the user the moment it was raised, so the prune cannot reach
      // it and the entry that stops it repeating has to survive.
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: pendingId, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      occurrences = [];
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      service.plugin.getPending.and.resolveTo({ notifications: [] });
      occurrences = both();
      jasmine.clock().tick(5 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications.map(notification => notification.id)).toEqual([pendingId]);
      expect(rebooked.notifications.map(notification => notification.id)).not.toContain(firedId);
    });

    it('stays inert when the operating system has not granted permission', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();
      service.plugin.checkPermissions.and.resolveTo({ display: 'denied' });

      await sweep();

      expect(service.plugin.schedule).not.toHaveBeenCalled();
      expect(readSentLog()).toEqual({});
    });

    it('retires a pending reminder even when permission has been revoked', async () => {
      occurrences = [];
      const service = createService();
      service.plugin.checkPermissions.and.resolveTo({ display: 'denied' });
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: 4242, title: 'app.title', body: 'reminders.billDue' }],
      });

      await sweep();

      expect(service.plugin.schedule).not.toHaveBeenCalled();
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 4242 }] });
    });

    it('asks the plugin nothing once every alert is deduped', async () => {
      budgetAlerts.set([alert()]);
      const service = createService();
      await sweep();
      const settled = service.plugin.checkPermissions.calls.count();

      budgetAlerts.set([alert({ percentUsed: 86 })]);
      await sweep();

      expect(service.plugin.checkPermissions.calls.count()).toBe(settled);
    });

    it('reports a plugin missing from the binary as unavailable', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const service = createService();
      service.plugin.checkPermissions.and.rejectWith(new Error('not implemented'));

      await expectAsync(sweep()).toBeResolved();

      expect(service.plugin.schedule).not.toHaveBeenCalled();
    });
  });

  describe('cancelScheduled', () => {
    it('retires everything the operating system still holds', async () => {
      isNative.and.returnValue(true);
      const service = createService();
      service.plugin.getPending.and.resolveTo({
        notifications: [
          { id: 11, title: 'app.title', body: 'reminders.billDueIn' },
          { id: 22, title: 'app.title', body: 'reminders.billDueIn' },
        ],
      });

      await service.cancelScheduled();

      expect(service.plugin.cancel).toHaveBeenCalledWith({
        notifications: [{ id: 11 }, { id: 22 }],
      });
    });

    it('touches no plugin on the web, where nothing is ever scheduled', async () => {
      const service = createService();

      await expectAsync(service.cancelScheduled()).toBeResolved();

      expect(service.plugin.getPending).not.toHaveBeenCalled();
      expect(service.plugin.cancel).not.toHaveBeenCalled();
    });

    it('reports a plugin missing from the binary as no failure', async () => {
      isNative.and.returnValue(true);
      const service = createService();
      service.plugin.getPending.and.rejectWith(new Error('not implemented'));

      await expectAsync(service.cancelScheduled()).toBeResolved();
    });

    it('retires the departing account on sign-out', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();

      // The reminder booked above, still pending: on a signed-out device it
      // would fire naming a bill nobody there has an account for.
      const [request] = service.plugin.schedule.calls.mostRecent().args;
      const id = request.notifications[0].id;
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });

      currentUser.set(null);
      await sweep();

      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });
    });

    it('retires the previous account on a switch', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();

      const [request] = service.plugin.schedule.calls.mostRecent().args;
      const id = request.notifications[0].id;
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });

      currentUser.set(
        createMockUser('user-2', {
          preferences: { ...DEFAULT_USER_PREFERENCES, enableReminders: false },
        })
      );
      await sweep();

      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });
    });

    it('re-books an ahead-of-time reminder that was cancelled while off', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();
      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const id = booked.notifications[0].id;

      // Off. Scheduling marked the key delivered, so retiring the notification
      // without retiring the log entry would make the cancel one-way.
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      await service.cancelScheduled();
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });

      // On again, the toggle's own sweep.
      service.plugin.getPending.and.resolveTo({ notifications: [] });
      await service.sweep();

      expect(service.plugin.schedule).toHaveBeenCalledTimes(2);
      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications.map(notification => notification.id)).toEqual([id]);
    });

    it('leaves a reminder that already fired suppressed across an off and on', async () => {
      isNative.and.returnValue(true);
      occurrences = [
        occurrence({ date: daysOut(0), remindDaysBefore: 0 }),
        occurrence({ recurringId: 'rule-2', name: 'Gym', date: daysOut(10), remindDaysBefore: 3 }),
      ];
      const service = createService();
      await sweep();

      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const pendingId = booked.notifications.find(n => n.schedule)?.id;
      const firedId = booked.notifications.find(n => !n.schedule)?.id;
      expect(pendingId).toBeDefined();
      expect(firedId).toBeDefined();

      // Only the ahead-of-time one is still pending: the immediate reminder was
      // handed to the user the moment it was raised, and the log entry that
      // stops it being raised again has to survive the cancel.
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id: pendingId as number, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      await service.cancelScheduled();

      service.plugin.getPending.and.resolveTo({ notifications: [] });
      await service.sweep();

      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications.map(notification => notification.id)).toEqual([
        pendingId as number,
      ]);
    });

    it('re-books for an account signed back in after a sign-out cancelled it', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();
      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const id = booked.notifications[0].id;
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });

      // The sign-out cancels under the departing account, which the auth signal
      // has already moved off; its keys are the ones that have to go.
      currentUser.set(null);
      await sweep();

      service.plugin.getPending.and.resolveTo({ notifications: [] });
      setPreferences({ enableReminders: true });
      await sweep();

      expect(service.plugin.schedule).toHaveBeenCalledTimes(2);
      const [rebooked] = service.plugin.schedule.calls.mostRecent().args;
      expect(rebooked.notifications.map(notification => notification.id)).toEqual([id]);
    });

    it('cancels even when the sent log refuses the write', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();
      await sweep();
      const [booked] = service.plugin.schedule.calls.mostRecent().args;
      const id = booked.notifications[0].id;
      service.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

      await expectAsync(service.cancelScheduled()).toBeResolved();

      // The cancel is what the user asked for, and the log is touched only
      // once the operating system has accepted it.
      expect(service.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });
      expect(service.plugin.cancel).toHaveBeenCalledBefore(setItem);
    });

    it('retires nothing when a session opens on an account already signed in', async () => {
      isNative.and.returnValue(true);
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const booked = createService();
      await sweep();
      const [request] = booked.plugin.schedule.calls.mostRecent().args;
      const id = request.notifications[0].id;

      // The relaunch. The sent log spares an already-booked key from being
      // scheduled again, so treating the first account of a session as a
      // change would drop what the previous session scheduled for good.
      const reopened = createService();
      reopened.plugin.getPending.and.resolveTo({
        notifications: [{ id, title: 'app.title', body: 'reminders.billDueIn' }],
      });
      await sweep();

      expect(reopened.plugin.cancel).not.toHaveBeenCalled();
    });
  });

  describe('requestPermission', () => {
    it('asks the operating system on native', async () => {
      isNative.and.returnValue(true);
      const service = createService();

      await expectAsync(service.requestPermission()).toBeResolvedTo(true);
      expect(service.plugin.requestPermissions).toHaveBeenCalled();
    });

    it('reports refusal rather than throwing when the plugin is absent', async () => {
      isNative.and.returnValue(true);
      const service = createService();
      service.plugin.requestPermissions.and.rejectWith(new Error('not implemented'));

      await expectAsync(service.requestPermission()).toBeResolvedTo(false);
    });

    it('asks the browser on the web', async () => {
      spyOn(Notification, 'requestPermission').and.resolveTo('granted');
      const service = createService();

      await expectAsync(service.requestPermission()).toBeResolvedTo(true);
    });

    it('reports refusal when the browser denies', async () => {
      spyOn(Notification, 'requestPermission').and.resolveTo('denied');
      const service = createService();

      await expectAsync(service.requestPermission()).toBeResolvedTo(false);
    });
  });
});
