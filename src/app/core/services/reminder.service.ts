import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type {
  LocalNotificationSchema,
  LocalNotificationsPlugin,
} from '@capacitor/local-notifications';
import { Subscription, take } from 'rxjs';

import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { TranslationService } from './translation.service';
import { fnv1a32 } from '../utils/transaction-aggregation.utils';
import { addDays, dayKey, startOfDay, wholeDaysBetween } from '../utils/transaction-date.utils';
import {
  BudgetAlert,
  BudgetAlertSeverity,
  MAX_REMINDER_LEAD_DAYS,
  RecurringOccurrence,
  remindersEnabled,
} from '../../models';

/** Where this device records what it has already raised, per account. */
export function reminderSentStorageKey(userId: string): string {
  return `home-account.reminders.sent.${userId}`;
}

/**
 * Drop that record — what account deletion erases on this device.
 *
 * Pure and exported rather than a method, so the cascade can clear the log
 * without injecting this service and dragging the sweep effects, the plugin
 * and the budget and recurring graphs into an erasure. The in-memory mirror
 * needs nothing from here: the user-switch effect empties it when the session
 * the deletion ends signs out.
 */
export function clearReminderDeviceState(userId: string): void {
  try {
    localStorage.removeItem(reminderSentStorageKey(userId));
  } catch {
    // A store that refuses removal refuses reads too, so nothing is left
    // behind that a later session could act on.
  }
}

/** Shortest gap between two bill sweeps. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** How long a delivered key is remembered before it is pruned. */
const SENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

/** Local hour an ahead-of-time reminder is scheduled for. */
const SCHEDULED_HOUR = 9;

const BUDGET_BODY_KEYS: Record<BudgetAlertSeverity, string> = {
  exceeded: 'budget.alertSnackbarExceeded',
  critical: 'budget.alertSnackbarCritical',
  warning: 'budget.alertSnackbarWarning',
};

interface PreparedReminder {
  /** Dedup key; also the web tag and the seed for the native id. */
  key: string;
  body: string;
  /** Ahead-of-time delivery moment; absent means deliver now. */
  at?: Date;
}

/**
 * The stored lead, rounded and bounded to a day a sweep could act on.
 *
 * firestore.rules stops at "a whole number of days, not negative" — no
 * ceiling, deliberately, so restoring a backup written by any build still
 * validates. A foreign client can therefore leave a fraction or a decade
 * here, and a bound alone would let the fraction through to a comparison
 * that silently never matches. Null means the rule asks for no reminder.
 */
function clampReminderLead(stored: number | undefined): number | null {
  if (stored == null || !Number.isFinite(stored)) return null;
  return Math.min(MAX_REMINDER_LEAD_DAYS, Math.max(0, Math.round(stored)));
}

/**
 * Stable per dedup key, so re-scheduling the same reminder replaces it
 * rather than adding a second. Masked to a positive 32-bit integer: the
 * plugin's id must fit a Java int on Android.
 */
function notificationId(key: string): number {
  return parseInt(fnv1a32(key), 16) & 0x7fffffff;
}

/**
 * Local notifications for budget thresholds and bills about to fall due.
 *
 * Named for what it raises, not how: NotificationService is the snackbar
 * wrapper. Delivery is a strict platform split — the installed iOS app has no
 * `Notification` constructor, and on the web the plugin proxy has no native
 * half to call — so neither path may touch the other's API.
 *
 * Everything here is per-device by design. The OS permission and the log of
 * what has already been raised both live on the device, so two devices signed
 * into one account each remind independently.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private auth = inject(AuthService);
  private budgetService = inject(BudgetService);
  private recurringService = inject(RecurringService);
  private translation = inject(TranslationService);
  private destroyRef = inject(DestroyRef);

  private billSweep: Subscription | null = null;
  private lastSweptAt = 0;
  private lastUserId: string | null = null;
  private deliveredThisSession = new Set<string>();

  readonly enabled = computed(() => remindersEnabled(this.auth.currentUser()?.preferences));

  constructor() {
    // Neither gate holds until the account document has loaded, so a cold
    // start and a signed-out session sweep nothing and open no listener.
    // Switching accounts drops the previous one's sent keys with it.
    effect(() => {
      const userId = this.auth.userId();
      const enabled = this.enabled();

      if (userId !== this.lastUserId) {
        const previous = this.lastUserId;
        this.lastUserId = userId;
        this.lastSweptAt = 0;
        this.deliveredThisSession.clear();
        this.closeBillSweep();
        // Signing out leaves that account's scheduled reminders booked with
        // the operating system, naming its bills on a device nobody is signed
        // into; a switch leaves them to fire for the wrong account. Only a
        // departure, never the first account of a session: the sent log spares
        // an already-booked key from being scheduled again, so cancelling on
        // the way in would drop what an earlier session scheduled for good.
        if (previous !== null) void this.cancelScheduledFor(previous);
      }

      if (enabled && userId) this.maybeSweepBills();
    });

    // An effect rather than a getBudgets() subscription: owning one would make
    // this service a second writer of the freshenSpent recalculations. Reading
    // budgetAlerts() at app open would race the dashboard's listener and see
    // nothing, so the alerts are read first and unconditionally — that keeps
    // them tracked while the gates are shut, and this re-runs when they land.
    effect(() => {
      const alerts = this.budgetService.budgetAlerts();
      const userId = this.auth.userId();
      if (!this.enabled() || !userId) return;
      void this.deliverBudgetAlerts(userId, alerts);
    });

    this.watchVisibility();
  }

  /**
   * Ask for the operating system's permission.
   *
   * Called from the settings toggle, never from a sweep: iOS shows the system
   * prompt once per install, and spending it on an app open the user did not
   * connect to notifications loses it for good.
   */
  async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await this.nativePlugin().requestPermissions();
        return status.display === 'granted';
      } catch {
        return false;
      }
    }

    if (typeof Notification === 'undefined') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * One bill pass, run now.
   *
   * The settings toggle's, and deliberately outside the debounce below: that
   * debounce is there to stop a flap between tabs reopening a listener, and
   * applying it to an explicit user action would make turning reminders on
   * within five minutes of an app-open sweep do nothing at all.
   *
   * It still stamps `lastSweptAt`, which is what stops the preference this
   * click writes from sweeping a second time when it reaches the effect.
   */
  async sweep(): Promise<void> {
    await this.sweepBills();
  }

  /**
   * Retire every reminder this device has pending.
   *
   * A sweep is the only other caller of the prune and no sweep runs while the
   * preference is off, so without this an opt-out would leave up to a month of
   * scheduled bill reminders firing with no way in the app to stop them.
   */
  async cancelScheduled(): Promise<void> {
    await this.cancelScheduledFor(this.auth.userId());
  }

  /**
   * The account the retired reminders belong to is passed in rather than read:
   * on a sign-out the auth signal has already moved off it, and dropping the
   * keys under the wrong account would leave the departing one's reminders
   * cancelled and still logged as delivered.
   */
  private async cancelScheduledFor(userId: string | null): Promise<void> {
    // Nothing is ever scheduled ahead of time on the web, and the plugin proxy
    // has no native half to ask.
    if (!Capacitor.isNativePlatform()) return;

    try {
      const cancelled = await this.prunePending(new Set());
      // Strictly after the operating system has accepted the cancel: a key
      // dropped for a notification that is in fact still pending would be
      // scheduled a second time.
      if (userId) this.forgetDelivered(userId, cancelled);
    } catch {
      // The plugin is absent from this binary, or the OS refused the call.
      // Reminders are a convenience and must never surface as a failure.
    }
  }

  private watchVisibility(): void {
    if (typeof document === 'undefined') return;

    // WKWebView fires this when the app is backgrounded, so one handler covers
    // both the installed iOS app and the web build.
    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      if (this.enabled() && this.auth.userId()) this.maybeSweepBills();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      this.closeBillSweep();
    });
  }

  /**
   * At most one sweep per interval. Every sweep opens and closes a Firestore
   * listener, and a tab switch fires visibilitychange, so an undebounced
   * handler would reopen one on every flap between two tabs.
   */
  private maybeSweepBills(): void {
    const now = this.now().getTime();
    if (now - this.lastSweptAt < SWEEP_INTERVAL_MS) return;
    void this.sweepBills();
  }

  /** Resolves once the pass has delivered, so `sweep()` can be awaited. */
  private sweepBills(): Promise<void> {
    this.lastSweptAt = this.now().getTime();

    const userId = this.auth.userId();
    if (!userId) return Promise.resolve();

    // getNextOccurrences opens a listener that never completes; take(1) closes
    // it once the first snapshot has been read.
    //
    // It reaches Firestore through getRecurring(), which sets the shared
    // recurringTransactions signal as a side effect, so every sweep refreshes
    // state the UI owns from a background path. No Firestore write hangs off
    // it — unlike the freshenSpent recalculations a getBudgets() subscription
    // would make this service a second writer of — and nothing here may grow
    // one.
    this.closeBillSweep();
    return new Promise<void>(resolve => {
      let delivering = false;
      this.billSweep = this.recurringService
        .getNextOccurrences(MAX_REMINDER_LEAD_DAYS + 1)
        .pipe(take(1))
        .subscribe({
          next: occurrences => {
            delivering = true;
            void this.deliverBills(userId, occurrences).then(
              () => resolve(),
              () => resolve()
            );
          },
          error: () => resolve(),
          // take(1) completes immediately after its emission, so a pass still
          // delivering must not be released here.
          complete: () => {
            if (!delivering) resolve();
          },
        });
    });
  }

  private closeBillSweep(): void {
    this.billSweep?.unsubscribe();
    this.billSweep = null;
  }

  private async deliverBills(
    userId: string,
    occurrences: RecurringOccurrence[]
  ): Promise<void> {
    const today = startOfDay(this.now());
    const reminders: PreparedReminder[] = [];
    const hasDue = new Set<string>();
    const hasUpcoming = new Set<string>();

    // Nearest first: at most one of each kind per rule is kept, so the order
    // decides which occurrence that is.
    const ordered = [...occurrences].sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const occurrence of ordered) {
      const lead = clampReminderLead(occurrence.remindDaysBefore);
      if (lead === null) continue;

      const date = startOfDay(occurrence.date);
      // An occurrence already past its date is the catch-up's business: it is
      // owed, not upcoming, and warning about it would say the wrong thing.
      if (date < today) continue;

      const daysUntil = wholeDaysBetween(today, date);
      // The lead belongs in the key, not just the date: widening it moves the
      // reminder without moving the occurrence, and a key that ignored it would
      // read as already delivered — leaving the old moment pending, since the
      // stale-cancel below spares every id this sweep produced.
      const key = `bill|${occurrence.recurringId}|${dayKey(occurrence.date)}|${lead}`;

      if (daysUntil <= lead) {
        // One immediate per rule. A daily rule with a month's lead has all 31
        // of its occurrences inside their windows at once, and an uncapped
        // sweep would raise every one of them together.
        if (hasDue.has(occurrence.recurringId)) continue;
        hasDue.add(occurrence.recurringId);
        reminders.push({ key, body: this.billBody(occurrence.name, daysUntil) });
        continue;
      }

      // One pending per rule: iOS silently drops local notifications past 64
      // per app, which that same daily rule would exhaust on its own.
      if (hasUpcoming.has(occurrence.recurringId)) continue;
      hasUpcoming.add(occurrence.recurringId);
      reminders.push({
        key,
        // The body is read on the reminder day, when the bill is `lead` days
        // out — not `daysUntil`, which is where it stands today.
        body: this.billBody(occurrence.name, lead),
        at: this.reminderMoment(date, lead),
      });
    }

    await this.deliver(userId, reminders, true);
  }

  private async deliverBudgetAlerts(userId: string, alerts: BudgetAlert[]): Promise<void> {
    const reminders: PreparedReminder[] = [];

    for (const alert of alerts) {
      // Without the period the spend was computed for there is nothing to
      // scope the dedup to, and one alert would repeat into every period it
      // survives into. Docs written before the stamp existed land here.
      if (!alert.spentPeriod) continue;

      reminders.push({
        key: `budget|${alert.budgetId}|${alert.spentPeriod}|${alert.severity}`,
        body: this.translation.t(BUDGET_BODY_KEYS[alert.severity], {
          name: alert.budgetName,
          percent: Math.round(alert.percentUsed),
        }),
      });
    }

    await this.deliver(userId, reminders, false);
  }

  private billBody(name: string, daysUntil: number): string {
    return daysUntil <= 0
      ? this.translation.t('reminders.billDue', { name })
      : this.translation.t('reminders.billDueIn', { name, count: daysUntil });
  }

  /**
   * 09:00 local on the reminder day, built from that day's own local parts so
   * a lead spanning a DST change still lands at 09:00 rather than an hour out.
   */
  private reminderMoment(date: Date, lead: number): Date {
    const day = addDays(date, -lead);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), SCHEDULED_HOUR);
  }

  private async deliver(
    userId: string,
    reminders: PreparedReminder[],
    pruneStale: boolean
  ): Promise<void> {
    // A sweep that produced nothing still has pending notifications to retire.
    if (reminders.length === 0 && !pruneStale) return;

    if (Capacitor.isNativePlatform()) {
      await this.deliverNative(userId, reminders, pruneStale);
    } else {
      this.deliverWeb(userId, reminders);
    }
  }

  private deliverWeb(userId: string, reminders: PreparedReminder[]): void {
    const title = this.translation.t('app.title');

    for (const reminder of reminders) {
      // A browser can only raise a notification while the page is open, so an
      // ahead-of-time reminder has nowhere to be scheduled. No service worker
      // is involved: nothing here may depend on one being registered.
      if (reminder.at !== undefined) continue;
      if (this.wasDelivered(userId, reminder.key)) continue;
      // Permission is refused for the whole page, not per notification.
      if (!this.showWebNotification(title, reminder.body, reminder.key)) return;
      this.markDelivered(userId, reminder.key);
    }
  }

  private async deliverNative(
    userId: string,
    reminders: PreparedReminder[],
    pruneStale: boolean
  ): Promise<void> {
    const plugin = this.nativePlugin();
    const title = this.translation.t('app.title');

    // Deduped before the permission check, which is a round trip to the native
    // side: the budget effect re-evaluates on change detection, and its steady
    // state — every alert already raised — must cost nothing.
    const queued = reminders.filter(reminder => !this.wasDelivered(userId, reminder.key));
    if (queued.length === 0 && !pruneStale) return;

    try {
      // Not an early return: revoking the permission in iOS Settings must
      // still retire what is pending, or those reminders fire on a re-grant
      // long after the rules behind them were edited away. Cancelling is
      // allowed without it; only delivery is gated.
      const permission = await plugin.checkPermissions();
      const granted = permission.display === 'granted';

      if (granted && queued.length > 0) {
        await plugin.schedule({
          notifications: queued.map<LocalNotificationSchema>(reminder => ({
            id: notificationId(reminder.key),
            title,
            body: reminder.body,
            ...(reminder.at ? { schedule: { at: reminder.at } } : {}),
          })),
        });
        // An ahead-of-time reminder counts as delivered the moment the OS
        // accepts it. The sweep that runs on the reminder day sees the same
        // key as due and would otherwise raise an immediate copy beside the
        // one already pending.
        for (const reminder of queued) this.markDelivered(userId, reminder.key);
      }

      if (pruneStale) {
        // A rule that was deleted, paused or re-dated stops producing its key,
        // so anything still pending that this sweep did not produce is retired
        // — including the keys already delivered, whose pending notification
        // has not fired yet. This service is the only scheduler in the app.
        await this.prunePending(new Set(reminders.map(reminder => notificationId(reminder.key))));
      }
    } catch {
      // The plugin is absent from this binary, or the OS refused the call.
      // Reminders are a convenience and must never surface as a failure.
    }
  }

  /**
   * Cancel everything pending but the ids in `produced`, reporting back what
   * the operating system accepted a cancel for. Callers own the catch.
   */
  private async prunePending(produced: Set<number>): Promise<Set<number>> {
    const plugin = this.nativePlugin();
    const pending = await plugin.getPending();
    const stale = pending.notifications
      .filter(notification => !produced.has(notification.id))
      .map(notification => ({ id: notification.id }));
    if (stale.length > 0) await plugin.cancel({ notifications: stale });
    return new Set(stale.map(notification => notification.id));
  }

  /**
   * Drop the sent-log entries for the reminders just cancelled.
   *
   * Without this a cancel is one-way: the log would go on reporting them as
   * delivered, so turning reminders back on would never book them again and
   * the reminder day would pass in silence — the same bill, silently missed,
   * for every rule that had been scheduled.
   *
   * Only the cancelled ids, never the whole log. A reminder that actually
   * fired is no longer pending and so is not among them, and its entry is what
   * stops the next sweep raising it a second time.
   */
  private forgetDelivered(userId: string, cancelled: Set<number>): void {
    if (cancelled.size === 0) return;

    for (const key of this.deliveredThisSession) {
      if (cancelled.has(notificationId(key))) this.deliveredThisSession.delete(key);
    }

    const log = this.readSentLog(userId);
    let dropped = false;
    for (const key of Object.keys(log)) {
      if (!cancelled.has(notificationId(key))) continue;
      delete log[key];
      dropped = true;
    }
    // Only when something actually went: an unreadable log reads as empty, and
    // writing that back would clear the entries it could not see.
    if (dropped) this.writeSentLog(userId, log);
  }

  private wasDelivered(userId: string, key: string): boolean {
    if (this.deliveredThisSession.has(key)) return true;
    return key in this.readSentLog(userId);
  }

  private markDelivered(userId: string, key: string): void {
    // Mirrored in memory because the durable half can fail. The budget effect
    // re-evaluates on change detection — the alert banner needed its own
    // `announced` flag for the same reason — so a storage that refuses writes
    // would turn one alert into a stream of them.
    this.deliveredThisSession.add(key);

    const log = this.readSentLog(userId);
    log[key] = this.now().getTime();
    this.writeSentLog(userId, log);
  }

  /**
   * The log, with everything past the retention window dropped and the shorter
   * log written back.
   *
   * Pruning has to happen here rather than beside the write: a device whose
   * permission was refused, or whose rules have all lapsed, never delivers
   * again and would keep every key it ever recorded.
   */
  private readSentLog(userId: string): Record<string, number> {
    try {
      const raw = localStorage.getItem(reminderSentStorageKey(userId));
      if (!raw) return {};

      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

      const now = this.now().getTime();
      const log: Record<string, number> = {};
      let dropped = false;
      for (const [key, at] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof at === 'number' && Number.isFinite(at) && now - at <= SENT_RETENTION_MS) {
          log[key] = at;
        } else {
          dropped = true;
        }
      }
      if (dropped) this.writeSentLog(userId, log);
      return log;
    } catch {
      // Unreadable storage degrades to "nothing raised yet", which costs a
      // repeat at worst; throwing would take the whole sweep down with it.
      return {};
    }
  }

  private writeSentLog(userId: string, log: Record<string, number>): void {
    try {
      localStorage.setItem(reminderSentStorageKey(userId), JSON.stringify(log));
    } catch {
      // Private-mode Safari and a full quota both throw here. The cost is at
      // most one repeat in a later session, never a failed sweep.
    }
  }

  /**
   * Raise a browser notification, reporting whether it was displayed. Nothing
   * outside this method may name `Notification`: the constructor does not
   * exist in the iOS WKWebView, where every sweep would then throw.
   */
  protected showWebNotification(title: string, body: string, tag: string): boolean {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return false;
    }
    try {
      new Notification(title, { body, tag });
      return true;
    } catch {
      return false;
    }
  }

  /** Plugin seam, so specs can observe scheduling without a native binary. */
  protected nativePlugin(): LocalNotificationsPlugin {
    return LocalNotifications;
  }

  protected now(): Date {
    return new Date();
  }
}
