import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnalyticsSettingsComponent } from './analytics-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SubscriptionTier, User, UserPreferences } from '../../../models';
import {
  Translator,
  accessibleDescription,
  accessibleName,
  catalogTranslator,
  holdsShownWords,
  provideNoMotion,
  runAxe,
  summarizeViolations,
} from '../../../core/services/testing';

describe('AnalyticsSettingsComponent', () => {
  let fixture: ComponentFixture<AnalyticsSettingsComponent>;
  let component: AnalyticsSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  /** The words the template is rendered in: the keys themselves, unless a case reads a catalog. */
  let translate: Translator;

  const userWith = (
    preferences: Partial<UserPreferences>,
    tier?: SubscriptionTier
  ): User =>
    ({
      id: 'user-1',
      preferences,
      ...(tier ? { subscription: { tier } } : {}),
    }) as User;

  beforeEach(async () => {
    currentUser = signal<User | null>(userWith({ baseCurrency: 'USD' }));
    translate = (key: string) => key;

    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser,
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    notifications = jasmine.createSpyObj('NotificationService', ['error']);

    await TestBed.configureTestingModule({
      imports: [AnalyticsSettingsComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: { t: (key: string, params?: Record<string, string | number>) => translate(key, params) } },
        provideNoMotion(),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('free tier', () => {
    it('should show collection as on', () => {
      // Included in the free plan, so there is nothing to opt in to.
      expect(component.enabled()).toBeTrue();
    });

    it('should not offer the control', () => {
      expect(component.canDisable()).toBeFalse();
    });

    it('should show as on even with a stored opt-out', () => {
      // A false left behind by a lapsed premium account.
      currentUser.set(userWith({ enableUsageAnalytics: false }));

      expect(component.enabled()).toBeTrue();
    });

    it('should refuse to write a preference it is not entitled to change', async () => {
      // The template disables the toggle, but a disabled control is a UI
      // affordance rather than a guarantee — the handler is public.
      await component.onEnabledChange(false);

      expect(mockAuthService.updateUserPreferences).not.toHaveBeenCalled();
      expect(component.enabled()).toBeTrue();
    });
  });

  describe('premium', () => {
    beforeEach(() => {
      currentUser.set(userWith({ baseCurrency: 'USD' }, 'premium'));
    });

    it('should default to off when the choice has not been made', () => {
      expect(component.enabled()).toBeFalse();
    });

    it('should offer the control', () => {
      expect(component.canDisable()).toBeTrue();
    });

    it('should read the stored opt-in', () => {
      currentUser.set(userWith({ enableUsageAnalytics: true }, 'premium'));

      expect(component.enabled()).toBeTrue();
    });

    it('should save the opt-in without touching other preferences', async () => {
      await component.onEnabledChange(true);

      // Only the consent key: updateUserPreferences writes per-field now, so
      // sending the rest of the map would re-send stale copies of keys
      // another device may have changed.
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableUsageAnalytics: true,
      });
    });

    it('should save the opt-out', async () => {
      currentUser.set(userWith({ baseCurrency: 'USD', enableUsageAnalytics: true }, 'premium'));

      await component.onEnabledChange(false);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableUsageAnalytics: false,
      });
    });

    it('should follow the preference rather than the last click', async () => {
      mockAuthService.updateUserPreferences.and.callFake(async () => {
        currentUser.set(
          userWith({ baseCurrency: 'USD', enableUsageAnalytics: true }, 'premium')
        );
      });

      await component.onEnabledChange(true);

      // The displayed state comes from the same signal AnalyticsService acts on,
      // so the two cannot disagree — including when the change arrives from
      // another device.
      expect(component.enabled()).toBeTrue();
    });

    it('should report a failed save and keep showing the stored value', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));

      await component.onEnabledChange(true);

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      // Nothing was persisted, so the toggle must not claim otherwise.
      expect(component.enabled()).toBeFalse();
    });
  });

  /**
   * Material hands a toggle's aria-labelledby to its role="switch" button in
   * place of its own label, which holds the words shown beside the switch.
   * Pointed at the section's label, the switch was named by the section and
   * not by what it shows, so a voice user saying those words reached nothing
   * (WCAG 2.5.3). The section names the group the switch stands in instead.
   * Read with the real words, in a component of its own: the ids are the
   * template's own, so the echo-worded one goes first. On the free plan the
   * switch is held on, and the note saying why is its description; that
   * description was written on the toggle's host, which is no control, and
   * never reached the switch.
   */
  describe("the switch's name (real template)", () => {
    function renderIn(l: 'en' | 'ja' | 'tc'): HTMLElement {
      fixture.destroy();
      (fixture.nativeElement as HTMLElement).remove();
      translate = catalogTranslator(l);
      fixture = TestBed.createComponent(AnalyticsSettingsComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const switchIn = (root: HTMLElement) => root.querySelector('button[role="switch"]') as HTMLButtonElement;

    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`names the switch by the words it shows, in a group named by the section, in ${l}`, async () => {
        const t = catalogTranslator(l, { strict: true });
        currentUser.set(userWith({ baseCurrency: 'USD' }, 'premium'));
        const root = renderIn(l);
        const control = switchIn(root);
        const shown = root.querySelector('mat-slide-toggle label')?.textContent?.trim() ?? '';

        expect(shown).withContext('the words beside the switch').toBe(t('analytics.enable'));
        expect(accessibleName(control)).withContext("the switch's name").toBe(t('analytics.enable'));
        expect(holdsShownWords(accessibleName(control), shown, l)).withContext('the name holds the shown words').toBeTrue();
        const group = control.closest('[role="group"]');
        expect(group).withContext('the group the switch stands in').not.toBeNull();
        expect(accessibleName(group!)).withContext("the group's name").toBe(t('analytics.settingsTitle'));
        expect(accessibleDescription(control)).withContext('premium: no note to describe it').toBe('');

        const names = summarizeViolations(await runAxe(root))
          .filter(line => line.startsWith('button-name') || line.startsWith('aria-toggle-field-name'));
        expect(names).withContext('the name rules of the shared pass').toEqual([]);
      });

      it(`describes the switch held on by the free plan by the note that says why, in ${l}`, () => {
        const t = catalogTranslator(l, { strict: true });
        const root = renderIn(l);
        const control = switchIn(root);

        expect(accessibleName(control)).withContext("the switch's name").toBe(t('analytics.enable'));
        expect(control.disabled).withContext('held on').toBeTrue();
        expect(accessibleDescription(control)).withContext("the switch's description").toBe(t('analytics.freeTierNotice'));
      });
    }
  });
});
