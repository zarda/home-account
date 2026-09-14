import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { SecuritySettingsComponent } from './security-settings.component';
import { AppLockMethod, AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import { BiometricAuthService } from '../../../core/services/biometric-auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User, UserPreferences } from '../../../models';

describe('SecuritySettingsComponent', () => {
  let fixture: ComponentFixture<SecuritySettingsComponent>;
  let component: SecuritySettingsComponent;
  let appLock: jasmine.SpyObj<AppLockService>;
  let authService: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let biometricAuth: jasmine.SpyObj<BiometricAuthService>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let isEnabled: ReturnType<typeof signal<boolean>>;
  let method: ReturnType<typeof signal<AppLockMethod>>;
  let available: ReturnType<typeof signal<boolean>>;
  let biometry: ReturnType<typeof signal<'faceId' | 'touchId' | 'none'>>;

  const userWith = (preferences: Partial<UserPreferences>): User =>
    ({ id: 'user-1', preferences }) as User;

  function biometricToggleEl(): HTMLElement | null {
    return fixture.nativeElement.querySelector('mat-slide-toggle.biometric-toggle');
  }

  beforeEach(async () => {
    currentUser = signal<User | null>(userWith({ enableAppLock: true }));
    isEnabled = signal(true);
    method = signal<AppLockMethod>('pin');
    available = signal(true);
    biometry = signal<'faceId' | 'touchId' | 'none'>('faceId');

    appLock = jasmine.createSpyObj<AppLockService>(
      'AppLockService',
      ['setBiometricOptIn', 'clearCredential', 'setPin'],
      { isEnabled, method }
    );
    appLock.setPin.and.resolveTo(true);
    // Mirrors the real service: clearing the credential leaves no PIN record,
    // so method() recomputes to 'none' and the biometric gate closes with it.
    appLock.clearCredential.and.callFake(() => method.set('none'));

    authService = jasmine.createSpyObj<AuthService>('AuthService', ['updateUserPreferences'], {
      currentUser,
    });
    authService.updateUserPreferences.and.resolveTo(undefined);

    notifications = jasmine.createSpyObj<NotificationService>('NotificationService', [
      'success',
      'info',
      'error',
    ]);

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key
    );

    biometricAuth = jasmine.createSpyObj<BiometricAuthService>('BiometricAuthService', [], {
      available,
      biometry,
    });

    await TestBed.configureTestingModule({
      imports: [SecuritySettingsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AppLockService, useValue: appLock },
        { provide: AuthService, useValue: authService },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: translation },
        { provide: BiometricAuthService, useValue: biometricAuth },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SecuritySettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the biometric toggle when the device offers biometry and a credential exists', () => {
    const toggle = biometricToggleEl();
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('appLock.useBiometry|{"biometry":"appLock.faceId"}');
  });

  it('renders the toggle checked when biometric is already the opted-in method', () => {
    method.set('biometric');
    fixture.detectChanges();

    const toggleButton = biometricToggleEl()!.querySelector('button[role="switch"]')!;
    expect(toggleButton.getAttribute('aria-checked')).toBe('true');
  });

  it('hides the biometric toggle on a device with no biometry (the web case)', () => {
    available.set(false);
    fixture.detectChanges();

    expect(biometricToggleEl()).toBeNull();
  });

  it('hides the biometric toggle when this device has no credential', () => {
    method.set('none');
    fixture.detectChanges();

    expect(biometricToggleEl()).toBeNull();
  });

  it('flipping the toggle opts the device in without writing a stored preference', () => {
    biometricToggleEl()!.querySelector('button[role="switch"]')!.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(appLock.setBiometricOptIn).toHaveBeenCalledWith(true);
    expect(authService.updateUserPreferences).not.toHaveBeenCalled();
  });

  it('flipping a checked toggle off opts the device back out', () => {
    method.set('biometric');
    fixture.detectChanges();

    biometricToggleEl()!.querySelector('button[role="switch"]')!.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(appLock.setBiometricOptIn).toHaveBeenCalledWith(false);
  });

  it('hides the toggle after removing the PIN', async () => {
    await component.removePin();
    fixture.detectChanges();

    expect(biometricToggleEl()).toBeNull();
  });
});
