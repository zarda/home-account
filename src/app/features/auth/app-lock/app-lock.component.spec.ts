import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { AppLockComponent } from './app-lock.component';
import { AppLockMethod, AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  BiometricAuthService,
  BiometricOutcome,
} from '../../../core/services/biometric-auth.service';
import { TranslationService } from '../../../core/services/translation.service';

describe('AppLockComponent', () => {
  let component: AppLockComponent;
  let fixture: ComponentFixture<AppLockComponent>;
  let appLock: jasmine.SpyObj<AppLockService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let biometricAuth: jasmine.SpyObj<BiometricAuthService>;
  let attemptsExhausted: ReturnType<typeof signal<boolean>>;
  let method: ReturnType<typeof signal<AppLockMethod>>;
  let lastBiometricOutcome: ReturnType<typeof signal<BiometricOutcome | null>>;
  let biometry: ReturnType<typeof signal<'faceId' | 'touchId' | 'none'>>;

  beforeEach(async () => {
    attemptsExhausted = signal(false);
    method = signal<AppLockMethod>('pin');
    lastBiometricOutcome = signal<BiometricOutcome | null>(null);

    appLock = jasmine.createSpyObj<AppLockService>(
      'AppLockService',
      ['unlockWithPin', 'unlockWithBiometrics', 'consumeRedirect', 'blockedForMs', 'clearCredential'],
      { attemptsExhausted, method, lastBiometricOutcome }
    );
    appLock.unlockWithPin.and.resolveTo(true);
    appLock.unlockWithBiometrics.and.resolveTo(false);
    appLock.consumeRedirect.and.returnValue('/transactions');
    appLock.blockedForMs.and.returnValue(0);

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['signOut']);
    auth.signOut.and.resolveTo(undefined);

    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);

    biometry = signal<'faceId' | 'touchId' | 'none'>('faceId');
    biometricAuth = jasmine.createSpyObj<BiometricAuthService>('BiometricAuthService', [], {
      biometry,
    });

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key
    );

    await TestBed.configureTestingModule({
      imports: [AppLockComponent, NoopAnimationsModule],
      providers: [
        { provide: AppLockService, useValue: appLock },
        { provide: AuthService, useValue: auth },
        { provide: BiometricAuthService, useValue: biometricAuth },
        { provide: TranslationService, useValue: translation },
        { provide: Router, useValue: router },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(AppLockComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  /**
   * fixture.whenStable() waits on NgZone's periodic-timer flag, which the
   * 250ms countdown interval from ngOnInit never clears — it would hang
   * every biometric test for the full Jasmine timeout. The pending
   * unlockWithBiometrics/navigateByUrl chain is flushed by hand instead.
   */
  async function flushBiometricPrompt(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('refuses to submit an incomplete PIN', async () => {
    component.pin.set('123');

    expect(component.canSubmit).toBe(false);
    await component.submit();

    expect(appLock.unlockWithPin).not.toHaveBeenCalled();
  });

  it('returns the user to where they were headed on success', async () => {
    component.pin.set('123456');

    await component.submit();

    expect(appLock.unlockWithPin).toHaveBeenCalledWith('123456');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/transactions');
  });

  it('clears the field and reports a wrong PIN', async () => {
    appLock.unlockWithPin.and.resolveTo(false);
    component.pin.set('000000');

    await component.submit();

    expect(component.pin()).toBe('');
    expect(component.errorKey()).toBe('appLock.wrongPin');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('says so once the attempts are used up', async () => {
    appLock.unlockWithPin.and.resolveTo(false);
    attemptsExhausted.set(true);
    component.pin.set('000000');

    await component.submit();

    expect(component.errorKey()).toBe('appLock.tooManyAttempts');
  });

  // The lock must never become a state the user cannot leave.
  it('always offers a way out via sign-out', async () => {
    await component.signOut();

    expect(auth.signOut).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  // Signing out is the only recovery reachable from here — the settings screen
  // that removes a PIN is behind the lock. Without clearing the credential the
  // user signs back in and lands straight back on this screen.
  it('clears the device credential when signing out', async () => {
    await component.signOut();

    expect(appLock.clearCredential).toHaveBeenCalled();
  });

  // A rejected sign-out must not strand the user on the lock screen, and the
  // credential is cleared first so the device stays recoverable regardless.
  it('still clears the credential and leaves when sign-out fails', async () => {
    spyOn(console, 'error');
    auth.signOut.and.rejectWith(new Error('offline'));

    await component.signOut();

    expect(appLock.clearCredential).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('blocks submission while throttled', () => {
    appLock.blockedForMs.and.returnValue(8_000);
    component.pin.set('123456');
    component.blockedSeconds.set(8);

    expect(component.isBlocked()).toBe(true);
    expect(component.canSubmit).toBe(false);
  });

  describe('biometric unlock', () => {
    it('offers no biometric button and prompts nothing when the method is pin', () => {
      expect(fixture.nativeElement.querySelector('button.biometric-button')).toBeNull();
      expect(appLock.unlockWithBiometrics).not.toHaveBeenCalled();
    });

    it('renders a labelled button with the Face ID icon when the method is biometric', async () => {
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      const button = fixture.nativeElement.querySelector('button.biometric-button');
      expect(button).not.toBeNull();
      expect(button.textContent).toContain(
        'appLock.unlockWithBiometry|{"biometry":"appLock.faceId"}'
      );
      expect(button.querySelector('mat-icon').textContent.trim()).toBe('face');
    });

    it('shows the fingerprint icon and Touch ID label when biometry is touchId', async () => {
      biometry.set('touchId');
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      const button = fixture.nativeElement.querySelector('button.biometric-button');
      expect(button.textContent).toContain(
        'appLock.unlockWithBiometry|{"biometry":"appLock.touchId"}'
      );
      expect(button.querySelector('mat-icon').textContent.trim()).toBe('fingerprint');
    });

    it('prompts once on its own and navigates to the consumed redirect on success', async () => {
      appLock.unlockWithBiometrics.and.resolveTo(true);
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(appLock.unlockWithBiometrics).toHaveBeenCalledWith('appLock.biometricReason');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/transactions');
    });

    it('does not auto-prompt a second time on the same instance', async () => {
      method.set('biometric');
      fixture.detectChanges();
      await flushBiometricPrompt();
      expect(appLock.unlockWithBiometrics).toHaveBeenCalledTimes(1);

      method.set('pin');
      fixture.detectChanges();
      method.set('biometric');
      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(appLock.unlockWithBiometrics).toHaveBeenCalledTimes(1);
    });

    it('defers the auto-prompt while a pin submit is in flight, then prompts once it releases', async () => {
      let resolvePin!: (unlocked: boolean) => void;
      appLock.unlockWithPin.and.returnValue(
        new Promise<boolean>((resolve) => {
          resolvePin = resolve;
        })
      );
      component.pin.set('123456');
      const submitDone = component.submit();

      method.set('biometric');
      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(appLock.unlockWithBiometrics).not.toHaveBeenCalled();

      resolvePin(false);
      await submitDone;
      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(appLock.unlockWithBiometrics).toHaveBeenCalledTimes(1);
    });

    it('prompts again when the button is clicked', async () => {
      method.set('biometric');
      fixture.detectChanges();
      await flushBiometricPrompt();
      // The auto-prompt's own isChecking(false) landed mid-microtask, off any
      // zone-triggered tick this detached fixture would pick up on its own.
      fixture.detectChanges();
      appLock.unlockWithBiometrics.calls.reset();

      fixture.nativeElement.querySelector('button.biometric-button').click();
      await flushBiometricPrompt();

      expect(appLock.unlockWithBiometrics).toHaveBeenCalledTimes(1);
    });

    it('shows no error and leaves the PIN field enabled when the prompt is cancelled', async () => {
      lastBiometricOutcome.set('cancelled');
      appLock.unlockWithBiometrics.and.resolveTo(false);
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(component.errorKey()).toBeNull();
      const pinInput = fixture.nativeElement.querySelector('input[name="pin"]');
      expect(pinInput.disabled).toBe(false);
    });

    it('renders the locked-out copy when the outcome is lockedOut', async () => {
      lastBiometricOutcome.set('lockedOut');
      appLock.unlockWithBiometrics.and.resolveTo(false);
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(component.errorKey()).toBe('appLock.biometricLockedOut');
    });

    it('renders the failed copy when the outcome is failed', async () => {
      lastBiometricOutcome.set('failed');
      appLock.unlockWithBiometrics.and.resolveTo(false);
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(component.errorKey()).toBe('appLock.biometricFailed');
    });

    it('leaves the PIN path untouched when the outcome is unavailable', async () => {
      lastBiometricOutcome.set('unavailable');
      appLock.unlockWithBiometrics.and.resolveTo(false);
      method.set('biometric');

      fixture.detectChanges();
      await flushBiometricPrompt();

      expect(component.errorKey()).toBeNull();
      expect(component.pin()).toBe('');
    });
  });
});
