import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { DashboardLayoutSettingsComponent } from './dashboard-layout-settings.component';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DashboardCardId, DashboardLayout, User, UserPreferences } from '../../../models';

describe('DashboardLayoutSettingsComponent', () => {
  let fixture: ComponentFixture<DashboardLayoutSettingsComponent>;
  let component: DashboardLayoutSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let auth: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let announcer: jasmine.SpyObj<AnnouncerService>;

  // With holdWrites on, each write waits in pendingWrites until the case lands
  // or fails it, so a case can overlap one save with the next change.
  let holdWrites: boolean;
  let pendingWrites: { land: () => void; fail: (error: Error) => void }[];

  const defaultOrder: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'insights', 'budgets'];
  const stored: DashboardLayout = {
    order: ['chart', 'recent', 'budgets', 'upcoming', 'insights'],
    hidden: [],
  };

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

  // Params are folded into the output, so an assertion on a string also pins
  // what it was filled with.
  const t = (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}|${JSON.stringify(params)}` : key;

  function render(preferences: Partial<UserPreferences> = { theme: 'light' }): void {
    currentUser.set(userWith(preferences));
    fixture = TestBed.createComponent(DashboardLayoutSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const rows = (): (string | undefined)[] =>
    Array.from(host().querySelectorAll<HTMLElement>('[data-card]')).map(row => row.dataset['card']);

  const switchFor = (id: DashboardCardId): HTMLButtonElement =>
    host().querySelector<HTMLButtonElement>(`[data-card="${id}"] button[role="switch"]`)!;

  const moveButton = (id: DashboardCardId, direction: 'up' | 'down'): HTMLButtonElement =>
    host().querySelector<HTMLButtonElement>(`[data-card="${id}"] [data-move="${direction}"]`)!;

  const resetButton = (): HTMLButtonElement =>
    host().querySelector<HTMLButtonElement>('[data-reset]')!;

  beforeEach(async () => {
    currentUser = signal<User | null>(null);

    auth = jasmine.createSpyObj('AuthService', ['updateUserPreferences', 'clearUserPreferences'], {
      currentUser,
    });
    holdWrites = false;
    pendingWrites = [];
    const landing = (): Promise<void> =>
      holdWrites
        ? new Promise((land, fail) => pendingWrites.push({ land: () => land(), fail }))
        : Promise.resolve();

    // As AuthService does: the user is read before the write and, once it
    // lands, currentUser becomes that user with the change folded in — so an
    // earlier write landing late reports an older layout than a newer one.
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
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    await TestBed.configureTestingModule({
      imports: [DashboardLayoutSettingsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: auth },
        { provide: NotificationService, useValue: notifications },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: { t } },
      ],
    }).compileComponents();
  });

  describe('rows and switches', () => {
    it('lists the five cards in the default order when nothing is stored', () => {
      render();

      expect(rows()).toEqual(defaultOrder);
    });

    it("lists them in the account's stored order", () => {
      render({ dashboardLayout: stored });

      expect(rows()).toEqual(stored.order);
    });

    it("names each switch by its row's visible title", () => {
      render();

      const titles: Record<DashboardCardId, string> = {
        recent: 'dashboard.recentTransactions',
        upcoming: 'dashboard.upcomingBills',
        chart: 'dashboard.spendingByCategory',
        insights: 'ai.insights',
        budgets: 'dashboard.budgetProgress',
      };
      for (const id of defaultOrder) {
        const labelledBy = switchFor(id).getAttribute('aria-labelledby');
        const title = labelledBy ? host().querySelector(`[id="${labelledBy}"]`) : null;

        expect(title?.textContent?.trim()).withContext(id).toBe(titles[id]);
      }
    });

    it("reads a hidden card's switch as off and the rest as on", () => {
      render({ dashboardLayout: { order: defaultOrder, hidden: ['insights'] } });

      expect(switchFor('insights').getAttribute('aria-checked')).toBe('false');
      expect(switchFor('recent').getAttribute('aria-checked')).toBe('true');
    });

    it("hides a card from its switch and writes the layout key alone", async () => {
      render();

      switchFor('insights').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.updateUserPreferences).toHaveBeenCalledOnceWith({
        dashboardLayout: { order: defaultOrder, hidden: ['insights'] },
      });
      expect(auth.clearUserPreferences).not.toHaveBeenCalled();
    });
  });

  describe('a failed toggle', () => {
    // The rejection lands before change detection renders the hidden state, so
    // the binding never reads a changed value and only the component turning
    // the switch back makes it agree with the account again.
    it('says so, and turns the switch back on', async () => {
      auth.updateUserPreferences.and.rejectWith(new Error('offline'));
      render();

      switchFor('insights').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notifications.error).toHaveBeenCalledOnceWith('settings.dashboardLayoutSaveFailed');
      expect(switchFor('insights').getAttribute('aria-checked')).toBe('true');
      expect(component.layout().hidden).toEqual([]);
    });
  });

  describe('move buttons and drop', () => {
    it('moves a card down, writes the swapped order and announces where it went', async () => {
      render();

      moveButton('recent', 'down').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.updateUserPreferences).toHaveBeenCalledOnceWith({
        dashboardLayout: { order: ['upcoming', 'recent', 'chart', 'insights', 'budgets'], hidden: [] },
      });
      expect(announcer.announce).toHaveBeenCalledOnceWith(
        t('settings.dashboardCardMoved', { card: 'dashboard.recentTransactions', position: 2, total: 5 })
      );
      expect(rows()).toEqual(['upcoming', 'recent', 'chart', 'insights', 'budgets']);
    });

    it("keeps focus on the moved card's button in its new row", async () => {
      render();

      moveButton('recent', 'down').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(document.activeElement).toBe(moveButton('recent', 'down'));
    });

    it('offers no move past either end', () => {
      render();

      expect(moveButton('recent', 'up').disabled).toBe(true);
      expect(moveButton('recent', 'down').disabled).toBe(false);
      expect(moveButton('budgets', 'down').disabled).toBe(true);
      expect(moveButton('budgets', 'up').disabled).toBe(false);
    });

    // Move up is disabled once the card reaches the first row, and a disabled
    // button cannot hold focus.
    it('hands focus to Move down when a card reaches the first row', async () => {
      render();

      moveButton('upcoming', 'up').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(rows()[0]).toBe('upcoming');
      expect(document.activeElement).toBe(moveButton('upcoming', 'down'));
    });

    it('hands focus to Move up when a card reaches the last row', async () => {
      render();

      moveButton('insights', 'down').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(rows()[4]).toBe('insights');
      expect(document.activeElement).toBe(moveButton('insights', 'up'));
    });

    it('keeps focus on Move up for a card that stays mid-list', async () => {
      render();

      moveButton('insights', 'up').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(rows()[2]).toBe('insights');
      expect(document.activeElement).toBe(moveButton('insights', 'up'));
    });

    it('writes the order a drop leaves behind', async () => {
      render();

      component.onDrop({ previousIndex: 0, currentIndex: 3 });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.updateUserPreferences).toHaveBeenCalledOnceWith({
        dashboardLayout: { order: ['upcoming', 'chart', 'insights', 'recent', 'budgets'], hidden: [] },
      });
      expect(rows()).toEqual(['upcoming', 'chart', 'insights', 'recent', 'budgets']);
    });
  });

  describe('reset', () => {
    it('is disabled while nothing is stored', () => {
      render();

      expect(resetButton().disabled).toBe(true);
    });

    it('deletes the stored key and renders the default order', async () => {
      render({ dashboardLayout: stored });
      expect(resetButton().disabled).toBe(false);

      resetButton().click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.clearUserPreferences).toHaveBeenCalledOnceWith(['dashboardLayout']);
      expect(auth.updateUserPreferences).not.toHaveBeenCalled();
      expect(rows()).toEqual(defaultOrder);
    });

    it('says so when the delete fails and keeps the stored order', async () => {
      auth.clearUserPreferences.and.rejectWith(new Error('offline'));
      render({ dashboardLayout: stored });

      resetButton().click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notifications.error).toHaveBeenCalledOnceWith('settings.dashboardLayoutSaveFailed');
      expect(rows()).toEqual(stored.order);
    });
  });

  describe('layout changes from outside', () => {
    it('re-renders the rows when a layout arrives from another device', () => {
      render();

      currentUser.set(userWith({ theme: 'light', dashboardLayout: stored }));
      TestBed.tick();

      expect(rows()).toEqual(stored.order);
    });

    // A preference write from anywhere replaces the whole user object, so a
    // layout derived by identity would snap back to the account's mid-save.
    it('keeps a pending move when an unrelated preference changes', async () => {
      let settle!: () => void;
      auth.updateUserPreferences.and.returnValue(new Promise<void>(resolve => (settle = resolve)));
      render();

      moveButton('recent', 'down').click();
      TestBed.tick();
      currentUser.set(userWith({ theme: 'dark' }));
      TestBed.tick();

      expect(rows()).toEqual(['upcoming', 'recent', 'chart', 'insights', 'budgets']);

      settle();
      await fixture.whenStable();
      fixture.detectChanges();
    });
  });

  describe('overlapping saves', () => {
    const afterFirst: DashboardCardId[] = ['upcoming', 'recent', 'chart', 'insights', 'budgets'];
    const afterSecond: DashboardCardId[] = ['upcoming', 'chart', 'recent', 'insights', 'budgets'];
    const afterThird: DashboardCardId[] = ['upcoming', 'chart', 'insights', 'recent', 'budgets'];

    async function settled(): Promise<void> {
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('holds a move made during a save until that save lands, then writes it', async () => {
      holdWrites = true;
      render();

      moveButton('recent', 'down').click();
      fixture.detectChanges();
      moveButton('recent', 'down').click();
      fixture.detectChanges();

      expect(rows()).toEqual(afterSecond);
      expect(auth.updateUserPreferences).toHaveBeenCalledTimes(1);

      pendingWrites[0].land();
      await settled();

      expect(rows()).withContext('once the first save lands').toEqual(afterSecond);

      pendingWrites[1].land();
      await settled();

      expect(auth.updateUserPreferences.calls.allArgs()).toEqual([
        [{ dashboardLayout: { order: afterFirst, hidden: [] } }],
        [{ dashboardLayout: { order: afterSecond, hidden: [] } }],
      ]);
      expect(currentUser()?.preferences.dashboardLayout?.order).toEqual(afterSecond);
      expect(rows()).toEqual(afterSecond);
    });

    it('sends only the latest of several changes made during one save', async () => {
      holdWrites = true;
      render();

      moveButton('recent', 'down').click();
      fixture.detectChanges();
      moveButton('recent', 'down').click();
      fixture.detectChanges();
      moveButton('recent', 'down').click();
      fixture.detectChanges();

      pendingWrites[0].land();
      await settled();
      pendingWrites[1]?.land();
      await settled();

      expect(auth.updateUserPreferences.calls.allArgs()).toEqual([
        [{ dashboardLayout: { order: afterFirst, hidden: [] } }],
        [{ dashboardLayout: { order: afterThird, hidden: [] } }],
      ]);
      expect(rows()).toEqual(afterThird);
    });

    it('drops a change queued behind a save that fails, and shows the account', async () => {
      holdWrites = true;
      render();

      moveButton('recent', 'down').click();
      fixture.detectChanges();
      moveButton('recent', 'down').click();
      fixture.detectChanges();

      pendingWrites[0].fail(new Error('offline'));
      await settled();
      for (const write of pendingWrites.slice(1)) write.land();
      await settled();

      expect(notifications.error).toHaveBeenCalledOnceWith('settings.dashboardLayoutSaveFailed');
      expect(auth.updateUserPreferences).toHaveBeenCalledTimes(1);
      expect(currentUser()?.preferences.dashboardLayout).toBeUndefined();
      expect(rows()).toEqual(defaultOrder);
    });
  });
});
