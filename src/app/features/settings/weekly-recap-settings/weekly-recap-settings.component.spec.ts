import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSlideToggle, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Capacitor } from '@capacitor/core';

import { WeeklyRecapSettingsComponent } from './weekly-recap-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { User, UserPreferences, weeklyRecapEnabled } from '../../../models';

describe('WeeklyRecapSettingsComponent', () => {
  let fixture: ComponentFixture<WeeklyRecapSettingsComponent>;
  let component: WeeklyRecapSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let reminders: jasmine.SpyObj<ReminderService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let isNative: jasmine.Spy<() => boolean>;

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

  /** The live control, so what a test asserts is the real switch's state. */
  function toggle(): MatSlideToggle {
    return fixture.debugElement.query(By.directive(MatSlideToggle))
      .componentInstance as MatSlideToggle;
  }

  function switchEl(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;
  }

  /**
   * The click, as Material delivers it: the control moves itself first and
   * reports the new value second, which is why turning it back is the
   * component's job rather than the binding's.
   */
  async function flip(checked: boolean): Promise<void> {
    const control = toggle();
    control.checked = checked;
    fixture.detectChanges();
    await component.onEnabledChange(new MatSlideToggleChange(control, checked));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    currentUser = signal<User | null>(userWith({ baseCurrency: 'USD' }));

    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser,
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    reminders = jasmine.createSpyObj<ReminderService>('ReminderService', [
      'requestPermission',
      'sweep',
      'cancelScheduled',
    ]);
    reminders.requestPermission.and.resolveTo(true);
    reminders.sweep.and.resolveTo();

    notifications = jasmine.createSpyObj('NotificationService', ['error', 'info']);

    // The web is the default the other tests read against: nothing is ever
    // delivered ahead of time there, so nothing is ever asked for either.
    isNative = spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [WeeklyRecapSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: NotificationService, useValue: notifications },
        { provide: ReminderService, useValue: reminders },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
        {
          provide: WeeklyRecapService,
          useValue: {
            // Derived through the real resolver, so the stub cannot drift
            // from what the service would report for the same account.
            enabled: computed(() => weeklyRecapEnabled(currentUser()?.preferences)),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyRecapSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should default to off when the preference is absent', () => {
    expect(component.enabled()).toBeFalse();
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
  });

  it('should read the stored opt-in', () => {
    currentUser.set(userWith({ enableWeeklyRecap: true }));
    fixture.detectChanges();

    expect(component.enabled()).toBeTrue();
  });

  describe('turning the recap on', () => {
    it('should not spend the browser prompt on a notification the web never raises', async () => {
      await flip(true);

      expect(reminders.requestPermission).not.toHaveBeenCalled();
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableWeeklyRecap: true,
      });
    });

    it('should ask the operating system before storing anything on a device', async () => {
      isNative.and.returnValue(true);

      await flip(true);

      // The prompt only appears inside a user gesture, and sweeps never ask,
      // so a permission request that does not happen here never happens.
      expect(reminders.requestPermission).toHaveBeenCalledTimes(1);
      expect(reminders.requestPermission).toHaveBeenCalledBefore(
        mockAuthService.updateUserPreferences
      );
    });

    it('should store only the touched key', async () => {
      await flip(true);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableWeeklyRecap: true,
      });
    });

    it('should sweep so the nudge is booked with the click', async () => {
      await flip(true);

      expect(reminders.sweep).toHaveBeenCalledTimes(1);
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledBefore(reminders.sweep);
    });

    it('should store the opt-in even when the device refuses notifications', async () => {
      isNative.and.returnValue(true);
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      // The card is the recap; the nudge only points at it, so a refusal
      // costs the Monday notification and nothing else.
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableWeeklyRecap: true,
      });
      expect(toggle().checked).toBeTrue();
      expect(reminders.sweep).toHaveBeenCalledTimes(1);
    });

    it('should say what a refusal costs', async () => {
      isNative.and.returnValue(true);
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      expect(notifications.info).toHaveBeenCalledWith('settings.weeklyRecapNoNotifications');
      expect(notifications.error).not.toHaveBeenCalled();
    });
  });

  describe('turning the recap off', () => {
    beforeEach(() => {
      currentUser.set(userWith({ enableWeeklyRecap: true }));
      fixture.detectChanges();
    });

    it('should store the opt-out without prompting', async () => {
      await flip(false);

      expect(reminders.requestPermission).not.toHaveBeenCalled();
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableWeeklyRecap: false,
      });
    });

    it('should sweep so the nudge is retired with the click', async () => {
      await flip(false);

      // The sweep is the only thing here that touches what the operating
      // system holds: an outright cancel would also retire the bill
      // reminders of an account that never switched those off.
      expect(reminders.sweep).toHaveBeenCalledTimes(1);
      expect(reminders.cancelScheduled).not.toHaveBeenCalled();
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledBefore(reminders.sweep);
    });
  });

  describe('when the write fails', () => {
    beforeEach(() => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));
    });

    it('should report the failure and leave the stored value showing', async () => {
      await flip(true);

      // The bound expression never changed value, so change detection has no
      // reason to rewrite the DOM — leaving a switch that reads as on for a
      // setting that was never stored unless the component turns it back.
      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(toggle().checked).toBeFalse();
      expect(switchEl().getAttribute('aria-checked')).toBe('false');
    });

    it('should not sweep for a preference that was never stored', async () => {
      await flip(true);

      expect(reminders.sweep).not.toHaveBeenCalled();
    });

    it('should say nothing about notifications on top of the failure', async () => {
      isNative.and.returnValue(true);
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      expect(notifications.info).not.toHaveBeenCalled();
    });
  });

  it('should drive the handler from the switch itself', async () => {
    switchEl().click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
      enableWeeklyRecap: true,
    });
  });
});
