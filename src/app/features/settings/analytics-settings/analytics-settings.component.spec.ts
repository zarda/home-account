import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { AnalyticsSettingsComponent } from './analytics-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SubscriptionTier, User, UserPreferences } from '../../../models';

describe('AnalyticsSettingsComponent', () => {
  let fixture: ComponentFixture<AnalyticsSettingsComponent>;
  let component: AnalyticsSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;

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

    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser,
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    notifications = jasmine.createSpyObj('NotificationService', ['error']);

    await TestBed.configureTestingModule({
      imports: [AnalyticsSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
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
});
