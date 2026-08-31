import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSlideToggle, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { ReminderSettingsComponent } from './reminder-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User, UserPreferences, remindersEnabled } from '../../../models';

describe('ReminderSettingsComponent', () => {
  let fixture: ComponentFixture<ReminderSettingsComponent>;
  let component: ReminderSettingsComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let reminders: jasmine.SpyObj<ReminderService>;
  let notifications: jasmine.SpyObj<NotificationService>;

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

    reminders = jasmine.createSpyObj<ReminderService>(
      'ReminderService',
      ['requestPermission', 'sweep'],
      {
        // Derived through the real resolver, so the stub cannot drift from
        // what the service would report for the same account.
        enabled: computed(() => remindersEnabled(currentUser()?.preferences)),
      }
    );
    reminders.requestPermission.and.resolveTo(true);
    reminders.sweep.and.resolveTo();

    notifications = jasmine.createSpyObj('NotificationService', ['error']);

    await TestBed.configureTestingModule({
      imports: [ReminderSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: NotificationService, useValue: notifications },
        { provide: ReminderService, useValue: reminders },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ReminderSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should default to off when the preference is absent', () => {
    expect(component.enabled()).toBeFalse();
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
  });

  it('should read the stored opt-in', () => {
    currentUser.set(userWith({ enableReminders: true }));
    fixture.detectChanges();

    expect(component.enabled()).toBeTrue();
  });

  describe('turning reminders on', () => {
    it('should ask the operating system before storing anything', async () => {
      // The prompt only appears inside a user gesture, and sweeps never ask,
      // so a permission request that does not happen here never happens.
      await flip(true);

      expect(reminders.requestPermission).toHaveBeenCalledTimes(1);
      expect(reminders.requestPermission).toHaveBeenCalledBefore(
        mockAuthService.updateUserPreferences
      );
    });

    it('should store only the touched key once permission is granted', async () => {
      await flip(true);

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableReminders: true,
      });
    });

    it('should sweep so the first reminders arrive with the click', async () => {
      await flip(true);

      expect(reminders.sweep).toHaveBeenCalledTimes(1);
    });

    it('should store nothing when permission is refused', async () => {
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      expect(mockAuthService.updateUserPreferences).not.toHaveBeenCalled();
      expect(reminders.sweep).not.toHaveBeenCalled();
      expect(component.enabled()).toBeFalse();
    });

    it('should spring the switch back when permission is refused', async () => {
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      // The bound expression never changed value, so change detection has no
      // reason to rewrite the DOM — leaving a switch that reads as on for a
      // setting that was never stored unless the component turns it back.
      expect(toggle().checked).toBeFalse();
      expect(switchEl().getAttribute('aria-checked')).toBe('false');
    });

    it('should explain that a refusal will not be asked about again', async () => {
      reminders.requestPermission.and.resolveTo(false);

      await flip(true);

      expect(notifications.error).toHaveBeenCalledWith(
        'settings.reminderNotificationsPermissionDenied'
      );
    });
  });

  describe('turning reminders off', () => {
    beforeEach(() => {
      currentUser.set(userWith({ enableReminders: true }));
      fixture.detectChanges();
    });

    it('should store the opt-out without prompting', async () => {
      await flip(false);

      expect(reminders.requestPermission).not.toHaveBeenCalled();
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        enableReminders: false,
      });
    });

    it('should not sweep on the way out', async () => {
      await flip(false);

      expect(reminders.sweep).not.toHaveBeenCalled();
    });
  });

  describe('when the write fails', () => {
    beforeEach(() => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('offline')));
    });

    it('should report the failure and leave the stored value showing', async () => {
      await flip(true);

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(component.enabled()).toBeFalse();
      expect(switchEl().getAttribute('aria-checked')).toBe('false');
    });

    it('should not sweep for a preference that was never stored', async () => {
      await flip(true);

      expect(reminders.sweep).not.toHaveBeenCalled();
    });
  });

  it('should drive the handler from the switch itself', async () => {
    switchEl().click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(reminders.requestPermission).toHaveBeenCalledTimes(1);
  });
});
