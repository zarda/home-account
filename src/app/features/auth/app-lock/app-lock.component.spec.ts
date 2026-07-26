import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { AppLockComponent } from './app-lock.component';
import { AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';

describe('AppLockComponent', () => {
  let component: AppLockComponent;
  let fixture: ComponentFixture<AppLockComponent>;
  let appLock: jasmine.SpyObj<AppLockService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let attemptsExhausted: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    attemptsExhausted = signal(false);
    appLock = jasmine.createSpyObj<AppLockService>(
      'AppLockService',
      ['unlockWithPin', 'consumeRedirect', 'blockedForMs', 'clearCredential'],
      { attemptsExhausted }
    );
    appLock.unlockWithPin.and.resolveTo(true);
    appLock.consumeRedirect.and.returnValue('/transactions');
    appLock.blockedForMs.and.returnValue(0);

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['signOut']);
    auth.signOut.and.resolveTo(undefined);

    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [AppLockComponent, NoopAnimationsModule],
      providers: [
        { provide: AppLockService, useValue: appLock },
        { provide: AuthService, useValue: auth },
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

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('refuses to submit an incomplete PIN', async () => {
    component.pin = '123';

    expect(component.canSubmit).toBe(false);
    await component.submit();

    expect(appLock.unlockWithPin).not.toHaveBeenCalled();
  });

  it('returns the user to where they were headed on success', async () => {
    component.pin = '123456';

    await component.submit();

    expect(appLock.unlockWithPin).toHaveBeenCalledWith('123456');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/transactions');
  });

  it('clears the field and reports a wrong PIN', async () => {
    appLock.unlockWithPin.and.resolveTo(false);
    component.pin = '000000';

    await component.submit();

    expect(component.pin).toBe('');
    expect(component.errorKey()).toBe('appLock.wrongPin');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('says so once the attempts are used up', async () => {
    appLock.unlockWithPin.and.resolveTo(false);
    attemptsExhausted.set(true);
    component.pin = '000000';

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
    component.pin = '123456';
    component.blockedSeconds.set(8);

    expect(component.isBlocked()).toBe(true);
    expect(component.canSubmit).toBe(false);
  });
});
