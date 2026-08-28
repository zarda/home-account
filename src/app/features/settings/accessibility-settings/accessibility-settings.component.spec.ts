import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { AccessibilitySettingsComponent } from './accessibility-settings.component';
import { AccessibilityService } from '../../../core/services/accessibility.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User, UserPreferences } from '../../../models';

describe('AccessibilitySettingsComponent', () => {
  let fixture: ComponentFixture<AccessibilitySettingsComponent>;
  let component: AccessibilitySettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockAccessibilityService: jasmine.SpyObj<AccessibilityService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let fontScale: ReturnType<typeof signal<number>>;
  let highContrast: ReturnType<typeof signal<boolean>>;

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

  beforeEach(async () => {
    currentUser = signal<User | null>(userWith({}));
    fontScale = signal(1);
    highContrast = signal(false);

    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser,
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    mockAccessibilityService = jasmine.createSpyObj(
      'AccessibilityService',
      ['setFontScale', 'setHighContrast', 'setReducedMotion'],
      { fontScale, highContrast }
    );

    notifications = jasmine.createSpyObj('NotificationService', ['error']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackSettingsChange']);

    await TestBed.configureTestingModule({
      imports: [AccessibilitySettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AccessibilityService, useValue: mockAccessibilityService },
        { provide: NotificationService, useValue: notifications },
        { provide: AnalyticsService, useValue: analytics },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(AccessibilitySettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('display state', () => {
    it('reads font scale from the accessibility service signal', () => {
      fontScale.set(1.3);

      expect(component.fontScale()).toBe(1.3);
    });

    it('reads high contrast from the accessibility service signal', () => {
      highContrast.set(true);

      expect(component.highContrast()).toBeTrue();
    });

    it('reads reduced motion from the stored preference, not the resolved OR', () => {
      currentUser.set(userWith({ reducedMotion: true }));

      expect(component.reducedMotion()).toBeTrue();

      currentUser.set(userWith({ reducedMotion: false }));

      expect(component.reducedMotion()).toBeFalse();
    });
  });

  describe('font scale', () => {
    it('applies the scale immediately through the service', async () => {
      await component.onFontScaleChange(1.15);

      expect(mockAccessibilityService.setFontScale).toHaveBeenCalledWith(1.15);
    });

    it('persists only the touched key', async () => {
      await component.onFontScaleChange(1.15);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({ fontScale: 1.15 });
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledTimes(1);
    });

    it('tracks the setting change', async () => {
      await component.onFontScaleChange(1.15);

      expect(analytics.trackSettingsChange).toHaveBeenCalledWith({ setting: 'font_scale' });
    });

    it('shows an error toast when persistence fails', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));

      await component.onFontScaleChange(1.15);

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });
  });

  describe('high contrast', () => {
    it('applies immediately through the service', async () => {
      await component.onHighContrastChange(true);

      expect(mockAccessibilityService.setHighContrast).toHaveBeenCalledWith(true);
    });

    it('persists only the touched key', async () => {
      await component.onHighContrastChange(true);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({ highContrast: true });
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledTimes(1);
    });

    it('tracks the setting change', async () => {
      await component.onHighContrastChange(true);

      expect(analytics.trackSettingsChange).toHaveBeenCalledWith({ setting: 'high_contrast' });
    });

    it('shows an error toast when persistence fails', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));

      await component.onHighContrastChange(true);

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });
  });

  describe('reduced motion', () => {
    it('applies immediately through the service', async () => {
      await component.onReducedMotionChange(true);

      expect(mockAccessibilityService.setReducedMotion).toHaveBeenCalledWith(true);
    });

    it('persists only the touched key', async () => {
      await component.onReducedMotionChange(true);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({ reducedMotion: true });
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledTimes(1);
    });

    it('tracks the setting change', async () => {
      await component.onReducedMotionChange(true);

      expect(analytics.trackSettingsChange).toHaveBeenCalledWith({ setting: 'reduced_motion' });
    });

    it('shows an error toast when persistence fails', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));

      await component.onReducedMotionChange(true);

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });
  });
});
