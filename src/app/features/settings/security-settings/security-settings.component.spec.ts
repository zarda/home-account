import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SecuritySettingsComponent } from './security-settings.component';
import { AppLockMethod, AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import { BiometricAuthService } from '../../../core/services/biometric-auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User, UserPreferences } from '../../../models';
import {
  accessibleName,
  catalogTranslator,
  holdsShownWords,
  provideNoMotion,
  runAxe,
  summarizeViolations,
} from '../../../core/services/testing';

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
  let translation: jasmine.SpyObj<TranslationService>;

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

    translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
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
        provideNoMotion(),
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

  /**
   * Material hands a toggle's aria-labelledby to its role="switch" button in
   * place of its own label, which holds the words shown beside the switch.
   * Pointed at the section's label, the lock's switch was named by the
   * section and not by what it shows, so a voice user saying those words
   * reached nothing (WCAG 2.5.3). The section names the group the switch
   * stands in instead. Read with the real words, in a component of its own:
   * the ids are the template's own, so the echo-worded one goes first.
   */
  describe("the switches' names (real template)", () => {
    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`names the lock's switch by the words it shows, in a group named by the section, in ${l}`, async () => {
        const t = catalogTranslator(l, { strict: true });
        fixture.destroy();
        (fixture.nativeElement as HTMLElement).remove();
        translation.t.and.callFake(catalogTranslator(l));
        fixture = TestBed.createComponent(SecuritySettingsComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const lock = root.querySelector('mat-slide-toggle:not(.biometric-toggle)') as HTMLElement;
        const control = lock.querySelector('button[role="switch"]') as HTMLButtonElement;
        const shown = lock.querySelector('label')?.textContent?.trim() ?? '';

        expect(shown).withContext('the words beside the switch').toBe(t('appLock.enable'));
        expect(accessibleName(control)).withContext("the switch's name").toBe(t('appLock.enable'));
        expect(holdsShownWords(accessibleName(control), shown, l)).withContext('the name holds the shown words').toBeTrue();
        const group = control.closest('[role="group"]');
        expect(group).withContext('the group the switch stands in').not.toBeNull();
        expect(accessibleName(group!)).withContext("the group's name").toBe(t('appLock.settingsTitle'));

        // Pin: the biometric switch was always named by its own words.
        const biometric = biometricToggleEl()!.querySelector('button[role="switch"]') as HTMLButtonElement;
        expect(accessibleName(biometric))
          .withContext("the biometric switch's name")
          .toBe(t('appLock.useBiometry', { biometry: t('appLock.faceId') }));

        const names = summarizeViolations(await runAxe(root))
          .filter(line => line.startsWith('button-name') || line.startsWith('aria-toggle-field-name'));
        expect(names).withContext('the name rules of the shared pass').toEqual([]);
      });
    }
  });
});
