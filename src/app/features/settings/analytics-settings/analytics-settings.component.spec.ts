import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { AnalyticsSettingsComponent } from './analytics-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User, UserPreferences } from '../../../models';

describe('AnalyticsSettingsComponent', () => {
  let fixture: ComponentFixture<AnalyticsSettingsComponent>;
  let component: AnalyticsSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

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

  it('should start off when the preference is absent', () => {
    // Every account created before the setting shipped is in this state.
    expect(component.enabled()).toBeFalse();
  });

  it('should read the stored opt-in', () => {
    currentUser.set(userWith({ enableUsageAnalytics: true }));

    expect(component.enabled()).toBeTrue();
  });

  it('should save the opt-in without dropping other preferences', async () => {
    await component.onEnabledChange(true);

    // updateUserPreferences rewrites the whole map, so the spread is what
    // stops a consent change from wiping the rest of the account's settings.
    expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
      baseCurrency: 'USD',
      enableUsageAnalytics: true,
    });
  });

  it('should save the opt-out', async () => {
    currentUser.set(userWith({ baseCurrency: 'USD', enableUsageAnalytics: true }));

    await component.onEnabledChange(false);

    expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
      baseCurrency: 'USD',
      enableUsageAnalytics: false,
    });
  });

  it('should follow the preference rather than the last click', async () => {
    mockAuthService.updateUserPreferences.and.callFake(async () => {
      currentUser.set(userWith({ baseCurrency: 'USD', enableUsageAnalytics: true }));
    });

    await component.onEnabledChange(true);

    // The displayed state comes from the same signal AnalyticsService acts on,
    // so the two cannot disagree — including when the change arrives from
    // another device.
    expect(component.enabled()).toBeTrue();
  });

  it('should report a failed save and leave the toggle showing the stored value', async () => {
    mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));

    await component.onEnabledChange(true);

    expect(notifications.error).toHaveBeenCalledWith('common.error');
    // Nothing was persisted, so the toggle must not claim otherwise.
    expect(component.enabled()).toBeFalse();
  });
});
