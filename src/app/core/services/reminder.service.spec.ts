import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { of } from 'rxjs';

import { ReminderService, reminderSentStorageKey } from './reminder.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import {
  BudgetAlert,
  BudgetAlertSeverity,
  DEFAULT_USER_PREFERENCES,
  RecurringOccurrence,
  User,
  UserPreferences,
} from '../../models';
import { addDays, startOfDay } from '../utils/transaction-date.utils';

const USER_ID = 'user-1';

interface WebNotification {
  title: string;
  body: string;
  tag: string;
}

/**
 * Substitutes the three production seams. The web seam reports whether it
 * displayed anything, which is what the service uses to decide whether the
 * reminder counts as sent, so `webPermitted` stands in for the browser
 * permission without touching the read-only global.
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

  protected override showWebNotification(title: string, body: string, tag: string): boolean {
    if (!this.webPermitted) return false;
    this.webNotifications.push({ title, body, tag });
    return true;
  }

  protected override nativePlugin(): LocalNotificationsPlugin {
    return this.plugin;
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
    it('marks nothing as sent when the browser refuses to display', async () => {
      occurrences = [occurrence({ date: daysOut(3), remindDaysBefore: 3 })];
      const denied = createService();
      denied.webPermitted = false;

      await sweep();

      expect(denied.webNotifications).toEqual([]);
      expect(readSentLog()).toEqual({});
    });

    it('never schedules ahead of time', async () => {
      occurrences = [occurrence({ date: daysOut(10), remindDaysBefore: 3 })];
      const service = createService();

      await sweep();

      expect(service.webNotifications).toEqual([]);
      expect(service.plugin.schedule).not.toHaveBeenCalled();
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
  });
});
