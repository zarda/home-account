import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DashboardLayoutService } from './dashboard-layout.service';
import { AuthService, withPreferenceFields } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { TranslationService } from '../../core/services/translation.service';
import { DashboardCardId, StoredDashboardLayout, User, UserPreferences } from '../../models';

describe('DashboardLayoutService', () => {
  let service: DashboardLayoutService;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let auth: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;

  // With holdWrites on, each write waits in pendingWrites until the case lands
  // or fails it, so a case can overlap one save with the next change.
  let holdWrites: boolean;
  let pendingWrites: { land: () => void; fail: (error: Error) => void }[];

  const defaultOrder: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'insights', 'budgets'];
  // The editor lists every card, so its moves step over all of them.
  const shown = (): readonly DashboardCardId[] => service.layout().order;

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

  const stored = (): unknown => currentUser()?.preferences.dashboardLayout;

  /** Lets every write and handler already queued run to completion. */
  const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve));

  /** Records how a promise settled, without leaving a rejection unhandled. */
  function outcome(promise: Promise<void>): () => 'pending' | 'landed' | 'failed' {
    let state: 'pending' | 'landed' | 'failed' = 'pending';
    promise.then(
      () => (state = 'landed'),
      () => (state = 'failed')
    );
    return () => state;
  }

  function start(preferences: Partial<UserPreferences> = { theme: 'light' }): void {
    currentUser.set(userWith(preferences));
    service = TestBed.inject(DashboardLayoutService);
  }

  beforeEach(() => {
    currentUser = signal<User | null>(null);
    auth = jasmine.createSpyObj(
      'AuthService',
      ['updatePreferenceFields', 'updateUserPreferences', 'clearUserPreferences'],
      { currentUser }
    );
    holdWrites = false;
    pendingWrites = [];
    const landing = (): Promise<void> =>
      holdWrites
        ? new Promise((land, fail) => pendingWrites.push({ land: () => land(), fail }))
        : Promise.resolve();

    // As AuthService does: the nested write lands, then its fields are merged
    // into the user as it stands by then.
    auth.updatePreferenceFields.and.callFake(async (key, fields) => {
      await landing();
      const latest = currentUser()!;
      currentUser.set({ ...latest, preferences: withPreferenceFields(latest.preferences, key, fields) });
    });
    auth.updateUserPreferences.and.callFake(async prefs => {
      const user = currentUser()!;
      await landing();
      currentUser.set({ ...user, preferences: { ...user.preferences, ...prefs } });
    });
    auth.clearUserPreferences.and.callFake(async keys => {
      const user = currentUser()!;
      await landing();
      const preferences = { ...user.preferences } as Record<string, unknown>;
      for (const key of keys) delete preferences[key];
      currentUser.set({ ...user, preferences: preferences as unknown as UserPreferences });
    });

    notifications = jasmine.createSpyObj('NotificationService', ['error']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
    });
  });

  describe('the held layout', () => {
    it("is the account's layout while nothing is saving", () => {
      start({ dashboardLayout: { order: ['chart', 'recent'], hidden: ['budgets'] } });

      expect(service.layout()).toEqual({
        order: ['chart', 'recent', 'upcoming', 'insights', 'budgets'],
        hidden: ['budgets'],
      });

      currentUser.set(userWith({ dashboardLayout: { hidden: ['insights'] } }));

      expect(service.layout()).withContext('a layout from another device').toEqual({
        order: defaultOrder,
        hidden: ['insights'],
      });
    });

    it('shows a change at once, and holds it while the write is out', async () => {
      holdWrites = true;
      start();

      const saved = service.hide('chart');

      expect(service.layout().hidden).toEqual(['chart']);

      // A preference write anywhere replaces the whole user object; the held
      // layout must not snap back to the account's mid-save.
      currentUser.set(userWith({ theme: 'dark' }));
      expect(service.layout().hidden).withContext('an unrelated change mid-save').toEqual(['chart']);

      pendingWrites[0].land();
      await saved;

      expect(service.layout().hidden).toEqual(['chart']);
      expect(stored()).toEqual({ hidden: ['chart'] });
    });

    it('becomes the account again once the save lands', async () => {
      start();

      await service.moveVisible('recent', 1, shown());
      currentUser.set(userWith({ dashboardLayout: { hidden: ['insights'] } }));

      expect(service.layout()).toEqual({ order: defaultOrder, hidden: ['insights'] });
    });
  });

  describe('minimal writes', () => {
    it('writes only hidden for a toggle, and leaves order absent (AC 2)', async () => {
      start();

      await service.hide('insights');

      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['insights'] },
      });
      expect(auth.updateUserPreferences).not.toHaveBeenCalled();
      expect(stored()).toEqual({ hidden: ['insights'] });
    });

    it('deletes hidden once the last hidden card is shown', async () => {
      start({ dashboardLayout: { hidden: ['insights'] } });

      await service.show('insights');

      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { delete: true },
      });
      expect(stored()).toEqual({});
    });

    it('writes only order for a move among the cards shown', async () => {
      start();

      await service.moveVisible('recent', 1, ['recent', 'chart', 'insights']);

      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        order: { set: ['upcoming', 'chart', 'recent', 'insights', 'budgets'] },
      });
    });

    it('writes only order for a dropped order', async () => {
      start();

      await service.setOrder(['upcoming', 'chart', 'insights', 'recent', 'budgets']);

      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        order: { set: ['upcoming', 'chart', 'insights', 'recent', 'budgets'] },
      });
    });

    it('keeps stored ids this build does not know through a hide and a move (AC 3)', async () => {
      start({
        dashboardLayout: {
          order: ['recent', 'future-card', 'upcoming', 'chart', 'insights', 'budgets'],
          hidden: ['future-hidden'],
        },
      });

      await service.hide('chart');

      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['future-hidden', 'chart'] },
      });

      await service.moveVisible('recent', 1, shown());

      expect(auth.updatePreferenceFields.calls.mostRecent().args).toEqual([
        'dashboardLayout',
        { order: { set: ['upcoming', 'recent', 'future-card', 'chart', 'insights', 'budgets'] } },
      ]);
      expect(stored()).toEqual({
        order: ['upcoming', 'recent', 'future-card', 'chart', 'insights', 'budgets'],
        hidden: ['future-hidden', 'chart'],
      } satisfies StoredDashboardLayout);
    });

    it('writes the whole key over a stored value that is not a map', async () => {
      start({ dashboardLayout: 'not-a-map' as unknown as StoredDashboardLayout });

      await service.hide('insights');

      expect(auth.updateUserPreferences).toHaveBeenCalledOnceWith({ dashboardLayout: { hidden: ['insights'] } });
      expect(auth.updatePreferenceFields).not.toHaveBeenCalled();
    });

    // A touched order is written as the full resolved list, so a no-op sent as
    // a change would rewrite this short stored order over whatever another
    // device stored since.
    it('writes nothing for a change that changes nothing', async () => {
      start({ dashboardLayout: { order: ['chart', 'recent'], hidden: ['insights'] } });

      await service.hide('insights');
      await service.moveVisible('chart', -1, shown());
      await service.setOrder(service.layout().order);

      expect(auth.updatePreferenceFields).not.toHaveBeenCalled();
      expect(auth.updateUserPreferences).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('deletes the key and shows the default at once', async () => {
      holdWrites = true;
      start({ dashboardLayout: { order: ['chart', 'recent'], hidden: ['budgets'] } });

      const saved = service.reset();

      expect(service.layout()).toEqual({ order: defaultOrder, hidden: [] });

      pendingWrites[0].land();
      await saved;

      expect(auth.clearUserPreferences).toHaveBeenCalledOnceWith(['dashboardLayout']);
      expect(auth.updatePreferenceFields).not.toHaveBeenCalled();
      expect(stored()).toBeUndefined();
    });

    it('writes a change made after it on top of the deleted key', async () => {
      holdWrites = true;
      start({ dashboardLayout: { order: ['chart', 'recent'] } });

      const saved = service.reset();
      service.hide('insights');
      pendingWrites[0].land();
      await flush();
      pendingWrites[1].land();
      await saved;

      expect(auth.clearUserPreferences).toHaveBeenCalledOnceWith(['dashboardLayout']);
      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['insights'] },
      });
      expect(stored()).toEqual({ hidden: ['insights'] });
    });
  });

  describe('one save at a time', () => {
    it('holds changes made during a save and sends them as one write once it lands', async () => {
      holdWrites = true;
      start();

      service.hide('chart');
      service.moveVisible('recent', 1, shown());
      service.hide('insights');
      service.moveVisible('recent', 1, shown());

      expect(auth.updatePreferenceFields).toHaveBeenCalledTimes(1);

      pendingWrites[0].land();
      await flush();

      expect(auth.updatePreferenceFields.calls.allArgs()).toEqual([
        ['dashboardLayout', { hidden: { set: ['chart'] } }],
        [
          'dashboardLayout',
          {
            hidden: { set: ['chart', 'insights'] },
            order: { set: ['upcoming', 'chart', 'recent', 'insights', 'budgets'] },
          },
        ],
      ]);

      pendingWrites[1].land();
      await flush();

      expect(stored()).toEqual({
        hidden: ['chart', 'insights'],
        order: ['upcoming', 'chart', 'recent', 'insights', 'budgets'],
      });
      expect(service.layout()).toEqual({
        order: ['upcoming', 'chart', 'recent', 'insights', 'budgets'],
        hidden: ['chart', 'insights'],
      });
    });

    it('hands every change made during one save the same promise, settled when the last write lands', async () => {
      holdWrites = true;
      start();

      const first = service.hide('chart');
      const second = service.moveVisible('recent', 1, shown());
      const noOp = service.hide('chart');
      const firstState = outcome(first);

      expect(second).toBe(first);
      expect(noOp).withContext('a change that changes nothing, mid-save').toBe(first);

      pendingWrites[0].land();
      await flush();

      expect(firstState()).withContext('with the queued write still out').toBe('pending');

      pendingWrites[1].land();
      await flush();

      expect(firstState()).toBe('landed');

      const next = service.show('chart');
      expect(next).withContext('a change after the save landed').not.toBe(first);
      pendingWrites[2].land();
      await next;
    });

    it('queues no field for a change that changes nothing while a save is out', async () => {
      holdWrites = true;
      start({ dashboardLayout: { order: ['chart', 'recent'] } });

      const saved = outcome(service.hide('budgets'));
      void service.moveVisible('chart', -1, shown());
      pendingWrites[0].land();
      await flush();

      expect(saved()).toBe('landed');
      expect(auth.updatePreferenceFields).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['budgets'] },
      });
    });

    it('rejects every caller of a failed save, with one snackbar and one revert', async () => {
      holdWrites = true;
      start();

      const first = service.hide('chart');
      const second = service.moveVisible('recent', 1, shown());

      // A change made from the first rejection must survive the second; a
      // revert per caller would undo it.
      let rejections = 0;
      let afterFailure: Promise<void> | undefined;
      first.catch(() => {
        rejections++;
        afterFailure = service.hide('budgets');
      });
      second.catch(() => rejections++);

      pendingWrites[0].fail(new Error('offline'));
      await flush();

      expect(rejections).toBe(2);
      expect(notifications.error).toHaveBeenCalledOnceWith('settings.dashboardLayoutSaveFailed');
      // The queued move was built on the write that failed, so it goes too.
      expect(auth.updatePreferenceFields.calls.allArgs()).toEqual([
        ['dashboardLayout', { hidden: { set: ['chart'] } }],
        ['dashboardLayout', { hidden: { set: ['budgets'] } }],
      ]);
      expect(service.layout()).toEqual({ order: defaultOrder, hidden: ['budgets'] });

      pendingWrites[1].land();
      await afterFailure;

      expect(stored()).toEqual({ hidden: ['budgets'] });
      expect(notifications.error).toHaveBeenCalledTimes(1);
    });

    it('drops a reset queued behind a failed write', async () => {
      holdWrites = true;
      start({ dashboardLayout: { order: ['chart', 'recent'] } });

      const failed = outcome(service.hide('insights'));
      service.reset();
      pendingWrites[0].fail(new Error('offline'));
      await flush();

      expect(failed()).toBe('failed');
      expect(service.layout().order).toEqual(['chart', 'recent', 'upcoming', 'insights', 'budgets']);

      const next = service.hide('budgets');
      pendingWrites[1].land();
      await next;

      expect(auth.clearUserPreferences).not.toHaveBeenCalled();
      expect(stored()).toEqual({ order: ['chart', 'recent'], hidden: ['budgets'] });
    });

    it("falls back to the account's layout when a save fails", async () => {
      auth.updatePreferenceFields.and.rejectWith(new Error('offline'));
      start({ dashboardLayout: { hidden: ['insights'] } });

      await expectAsync(service.moveVisible('recent', 1, shown())).toBeRejectedWithError('offline');

      expect(service.layout()).toEqual({ order: defaultOrder, hidden: ['insights'] });
      expect(notifications.error).toHaveBeenCalledOnceWith('settings.dashboardLayoutSaveFailed');
    });

    it('starts a fresh save after a failed one', async () => {
      auth.updatePreferenceFields.and.rejectWith(new Error('offline'));
      start();

      await expectAsync(service.hide('chart')).toBeRejected();

      auth.updatePreferenceFields.and.resolveTo();
      await expectAsync(service.hide('chart')).toBeResolved();
      expect(auth.updatePreferenceFields).toHaveBeenCalledTimes(2);
    });

    // The snackbar is the save's one report; a caller that ignores the
    // rejection must not also reach the global error handler.
    it('leaves no rejection unhandled for a caller that ignores it', async () => {
      const unhandled: PromiseRejectionEvent[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event);
      window.addEventListener('unhandledrejection', onUnhandled);
      // zone.js reports an unhandled rejection on the console.
      const consoleError = spyOn(console, 'error');
      try {
        auth.updatePreferenceFields.and.rejectWith(new Error('offline'));
        start();

        void service.hide('chart');
        await flush();
        await flush();
      } finally {
        window.removeEventListener('unhandledrejection', onUnhandled);
      }

      expect(notifications.error).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
