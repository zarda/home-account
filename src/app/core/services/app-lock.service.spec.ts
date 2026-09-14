import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';

import { AppLockService } from './app-lock.service';
import { AuthService } from './auth.service';
import { BiometricAuthService, BiometricOutcome } from './biometric-auth.service';
import { Biometry } from '../plugins/biometric-auth.plugin';
import {
  APP_LOCK_STORAGE_PREFIX,
  appLockStorageKey,
  clearAttemptState,
  clearBiometricOptIn,
  MAX_PIN_ATTEMPTS,
  readBiometricOptIn,
  writeBiometricOptIn,
} from '../utils/app-lock.utils';
import { derivePinRecord } from '../utils/pin-hash.utils';
import { User, UserPreferences, DEFAULT_USER_PREFERENCES } from '../../models';
import { createMockUser } from './testing/mock-auth.service';

/** A stand-in for BiometricAuthService — the real one guards a Capacitor plugin proxy that must never be reached from a unit spec. */
interface BiometricAuthDouble {
  available: ReturnType<typeof signal<boolean>>;
  biometry: ReturnType<typeof signal<Biometry>>;
  authenticate: jasmine.Spy<(reason: string) => Promise<BiometricOutcome>>;
  detectAvailability: jasmine.Spy<() => Promise<void>>;
}

describe('AppLockService', () => {
  let service: AppLockService;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let biometric: BiometricAuthDouble;
  let userId: ReturnType<typeof signal<string | null>>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  const PIN = '246813';

  function setPreferences(prefs: Partial<UserPreferences>): void {
    currentUser.set(
      createMockUser('user-1', {
        preferences: { ...DEFAULT_USER_PREFERENCES, ...prefs },
      })
    );
  }

  /** Seed a credential directly so tests do not pay the production PBKDF2 cost. */
  async function seedPin(pin = PIN): Promise<void> {
    const record = await derivePinRecord(pin, 1000);
    localStorage.setItem(appLockStorageKey('user-1'), JSON.stringify(record));
  }

  beforeEach(() => {
    localStorage.removeItem(appLockStorageKey('user-1'));
    clearAttemptState('user-1');
    clearAttemptState('user-2');
    clearBiometricOptIn('user-1');
    clearBiometricOptIn('user-2');

    userId = signal<string | null>('user-1');
    currentUser = signal<User | null>(
      createMockUser('user-1', { preferences: { ...DEFAULT_USER_PREFERENCES } })
    );

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['signOut'], {
      userId,
      currentUser,
    });

    router = jasmine.createSpyObj<Router>('Router', ['navigate'], { url: '/dashboard' });
    router.navigate.and.resolveTo(true);

    biometric = {
      available: signal(false),
      biometry: signal<Biometry>('none'),
      authenticate: jasmine.createSpy('authenticate').and.resolveTo('success' as BiometricOutcome),
      detectAvailability: jasmine.createSpy('detectAvailability').and.resolveTo(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        AppLockService,
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: BiometricAuthService, useValue: biometric },
      ],
    });

    service = TestBed.inject(AppLockService);
  });

  afterEach(() => {
    localStorage.removeItem(appLockStorageKey('user-1'));
    clearAttemptState('user-1');
    clearBiometricOptIn('user-1');
    clearBiometricOptIn('user-2');
    clearAttemptState('user-2');
  });

  describe('engagement', () => {
    it('stays unlocked when the preference is off', async () => {
      await seedPin();

      expect(service.isEnabled()).toBe(false);
      expect(service.isLocked()).toBe(false);
    });

    // Failing closed would strand a user with nothing to unlock with.
    it('stays unlocked when enabled but this device has no PIN', () => {
      setPreferences({ enableAppLock: true });

      expect(service.method()).toBe('none');
      expect(service.canEngage()).toBe(false);
      expect(service.isLocked()).toBe(false);
    });

    // A fresh process is locked by construction: nothing records "unlocked".
    it('locks on a cold start when enabled with a PIN', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });

      expect(service.method()).toBe('pin');
      expect(service.isLocked()).toBe(true);
    });
  });

  describe('unlockWithPin', () => {
    beforeEach(async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
    });

    it('unlocks with the right PIN', async () => {
      await expectAsync(service.unlockWithPin(PIN)).toBeResolvedTo(true);
      expect(service.isLocked()).toBe(false);
    });

    it('stays locked on the wrong PIN', async () => {
      await expectAsync(service.unlockWithPin('000000')).toBeResolvedTo(false);
      expect(service.isLocked()).toBe(true);
      expect(service.failedAttempts()).toBe(1);
    });

    it('clears the failure count on success', async () => {
      await service.unlockWithPin('000000');
      await service.unlockWithPin(PIN);

      expect(service.failedAttempts()).toBe(0);
    });

    it('throttles after repeated failures', async () => {
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');

      expect(service.blockedForMs()).toBeGreaterThan(0);
      // Even the correct PIN is refused while the backoff runs.
      await expectAsync(service.unlockWithPin(PIN)).toBeResolvedTo(false);
      expect(service.isLocked()).toBe(true);
    });

    // Guesses made while throttled are refused outright, so they must not
    // count towards the limit — otherwise hammering the button would burn
    // through the allowance without a single PIN being checked.
    it('does not count attempts made while throttled', async () => {
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      expect(service.failedAttempts()).toBe(3);

      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');

      expect(service.failedAttempts()).toBe(3);
    });

    it('flags exhausted attempts so the screen can offer sign-out', async () => {
      let now = Date.now();
      spyOn(Date, 'now').and.callFake(() => now);

      for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
        await service.unlockWithPin('000000');
        now += 60_000; // outlast the backoff so the next guess is evaluated
      }

      expect(service.attemptsExhausted()).toBe(true);
    });

    it('refuses when this device has no PIN', async () => {
      localStorage.removeItem(appLockStorageKey('user-1'));

      await expectAsync(service.unlockWithPin(PIN)).toBeResolvedTo(false);
    });
  });

  describe('locking', () => {
    beforeEach(async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      await service.unlockWithPin(PIN);
    });

    it('relocks on demand', () => {
      service.lockNow();

      expect(service.isLocked()).toBe(true);
    });

    it('does not carry the unlocked state across accounts', () => {
      expect(service.isLocked()).toBe(false);

      userId.set('user-2');
      currentUser.set(
        createMockUser('user-2', {
          preferences: { ...DEFAULT_USER_PREFERENCES, enableAppLock: true },
        })
      );
      TestBed.tick();

      expect(service.isLocked()).toBe(false); // user-2 has no PIN on this device
      expect(service.method()).toBe('none');
    });
  });

  describe('recovery from a forgotten PIN', () => {
    // Signing out is the only recovery reachable from the lock screen: the
    // settings screen that removes a PIN sits behind the lock itself.
    it('clearing the credential unlocks the next sign-in', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      expect(service.isLocked()).toBe(true);

      service.clearCredential();

      expect(service.method()).toBe('none');
      expect(service.isLocked()).toBe(false);
    });

    it('leaves nothing behind that would re-lock the account', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      await service.unlockWithPin('000000');

      service.clearCredential();

      expect(service.failedAttempts()).toBe(0);
      expect(service.blockedForMs()).toBe(0);
    });
  });

  describe('cross-tab recovery', () => {
    // Another tab removing the PIN must not leave this one stuck on the lock
    // screen with a credential that no longer exists and no PIN that works.
    it('unlocks when the credential is removed in another tab', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      service.init();
      expect(service.isLocked()).toBe(true);

      localStorage.removeItem(appLockStorageKey('user-1'));
      window.dispatchEvent(
        new StorageEvent('storage', { key: appLockStorageKey('user-1') })
      );

      expect(service.method()).toBe('none');
      expect(service.isLocked()).toBe(false);
    });

    it('re-reads the credential when storage is cleared wholesale', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      service.init();
      expect(service.isLocked()).toBe(true);

      localStorage.removeItem(appLockStorageKey('user-1'));
      window.dispatchEvent(new StorageEvent('storage', { key: null }));

      expect(service.isLocked()).toBe(false);
    });

    it('ignores unrelated storage keys', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      service.init();
      // Read once so there is a memoized value an over-eager listener could
      // invalidate; otherwise the next read would recompute regardless.
      expect(service.isLocked()).toBe(true);

      localStorage.removeItem(appLockStorageKey('user-1'));
      window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }));

      expect(service.isLocked()).toBe(true);
      expect(APP_LOCK_STORAGE_PREFIX.startsWith('homeaccount')).toBe(true);
    });
  });

  describe('throttle persistence', () => {
    // A reload is a control the person holding the device already has, so an
    // in-memory backoff would be no rate limit at all.
    it('survives a service restart', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      expect(service.blockedForMs()).toBeGreaterThan(0);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AppLockService,
          { provide: AuthService, useValue: auth },
          { provide: Router, useValue: router },
          { provide: BiometricAuthService, useValue: biometric },
        ],
      });
      const fresh = TestBed.inject(AppLockService);
      TestBed.tick();

      expect(fresh.failedAttempts()).toBe(3);
      expect(fresh.blockedForMs()).toBeGreaterThan(0);
    });

    it('is cleared by a successful unlock', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      await service.unlockWithPin('000000');
      await service.unlockWithPin(PIN);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AppLockService,
          { provide: AuthService, useValue: auth },
          { provide: Router, useValue: router },
          { provide: BiometricAuthService, useValue: biometric },
        ],
      });
      const fresh = TestBed.inject(AppLockService);
      TestBed.tick();

      expect(fresh.failedAttempts()).toBe(0);
    });
  });

  describe('setPin and clearCredential', () => {
    it('stores a credential and leaves the app unlocked', async () => {
      setPreferences({ enableAppLock: true });

      await expectAsync(service.setPin(PIN)).toBeResolvedTo(true);

      expect(service.method()).toBe('pin');
      expect(service.isLocked()).toBe(false);
    });

    it('reports a storage failure instead of claiming a lock', async () => {
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');

      await expectAsync(service.setPin(PIN)).toBeResolvedTo(false);
      expect(service.method()).toBe('none');
    });

    it('removes the credential', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      expect(service.method()).toBe('pin');

      service.clearCredential();

      expect(service.method()).toBe('none');
    });
  });

  describe('redirects', () => {
    it('returns the remembered url once', () => {
      service.rememberRedirect('/transactions');

      expect(service.consumeRedirect()).toBe('/transactions');
      expect(service.consumeRedirect()).toBe('/dashboard');
    });

    it('never sends the user back to the lock screen', () => {
      service.rememberRedirect('/lock');

      expect(service.consumeRedirect()).toBe('/dashboard');
    });
  });

  describe('biometric method', () => {
    it('stays none with no PIN even when opted in and available', () => {
      setPreferences({ enableAppLock: true });
      writeBiometricOptIn('user-1', true);
      biometric.available.set(true);

      expect(service.method()).toBe('none');
    });

    it('prefers biometric when opted in and available', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      writeBiometricOptIn('user-1', true);
      biometric.available.set(true);

      expect(service.method()).toBe('biometric');
    });

    it('falls back to pin when opted in but unavailable', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      writeBiometricOptIn('user-1', true);
      biometric.available.set(false);

      expect(service.method()).toBe('pin');
    });

    it('stays pin without the opt-in even when available', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      biometric.available.set(true);

      expect(service.method()).toBe('pin');
    });
  });

  describe('unlockWithBiometrics', () => {
    beforeEach(async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      writeBiometricOptIn('user-1', true);
      biometric.available.set(true);
    });

    it('marks unlocked and clears attempts on success', async () => {
      await service.unlockWithPin('000000');
      expect(service.failedAttempts()).toBe(1);
      biometric.authenticate.and.resolveTo('success');

      await expectAsync(service.unlockWithBiometrics('reason')).toBeResolvedTo(true);

      expect(service.isLocked()).toBe(false);
      expect(service.failedAttempts()).toBe(0);
    });

    // A cancelled or failed prompt is not a wrong PIN — the OS owns biometric lockout.
    // Three failures (not one) so the backoff is actually running before the
    // prompt fires — a single failure leaves blockedForMs() structurally 0 and
    // the assertion could not tell a preserved throttle from a reset one.
    it('stays locked and leaves the PIN throttle untouched on cancel', async () => {
      const frozen = Date.now();
      spyOn(Date, 'now').and.returnValue(frozen);

      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      await service.unlockWithPin('000000');
      const failedBefore = service.failedAttempts();
      const blockedBefore = service.blockedForMs();
      expect(failedBefore).toBe(3);
      expect(blockedBefore).toBeGreaterThan(0);

      biometric.authenticate.and.resolveTo('cancelled');
      await expectAsync(service.unlockWithBiometrics('reason')).toBeResolvedTo(false);

      expect(service.isLocked()).toBe(true);
      expect(service.failedAttempts()).toBe(failedBefore);
      expect(service.blockedForMs()).toBe(blockedBefore);
    });

    it('returns false when the outcome is unavailable', async () => {
      biometric.authenticate.and.resolveTo('unavailable');

      await expectAsync(service.unlockWithBiometrics('reason')).toBeResolvedTo(false);
      expect(service.isLocked()).toBe(true);
    });

    it('refuses without calling the plugin when the method is not biometric', async () => {
      biometric.available.set(false);

      await expectAsync(service.unlockWithBiometrics('reason')).toBeResolvedTo(false);
      expect(biometric.authenticate).not.toHaveBeenCalled();
    });

    // A 'lockedOut' from one account must not survive into the next account's
    // lock screen — or word a lockout that no longer applies once relocked.
    it('clears the remembered outcome on lockNow', async () => {
      biometric.authenticate.and.resolveTo('lockedOut');
      await service.unlockWithBiometrics('reason');
      expect(service.lastBiometricOutcome()).toBe('lockedOut');

      service.lockNow();

      expect(service.lastBiometricOutcome()).toBeNull();
    });

    it('clears the remembered outcome on a user change', async () => {
      biometric.authenticate.and.resolveTo('lockedOut');
      await service.unlockWithBiometrics('reason');
      expect(service.lastBiometricOutcome()).toBe('lockedOut');

      userId.set('user-2');
      currentUser.set(
        createMockUser('user-2', {
          preferences: { ...DEFAULT_USER_PREFERENCES, enableAppLock: true },
        })
      );
      TestBed.tick();

      expect(service.lastBiometricOutcome()).toBeNull();
    });
  });

  describe('setBiometricOptIn', () => {
    it('bumps the method once a PIN and availability exist', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      biometric.available.set(true);
      expect(service.method()).toBe('pin');

      service.setBiometricOptIn(true);

      expect(service.method()).toBe('biometric');
    });
  });

  describe('clearCredential', () => {
    it('clears the biometric opt-in as well', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      service.setBiometricOptIn(true);
      biometric.available.set(true);
      expect(service.method()).toBe('biometric');

      service.clearCredential();

      expect(readBiometricOptIn('user-1')).toBe(false);
    });
  });
});
