import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';

import { AppLockService } from './app-lock.service';
import { AuthService } from './auth.service';
import {
  APP_LOCK_STORAGE_PREFIX,
  appLockStorageKey,
  clearAttemptState,
  MAX_PIN_ATTEMPTS,
} from '../utils/app-lock.utils';
import { derivePinRecord } from '../utils/pin-hash.utils';
import { User, UserPreferences, DEFAULT_USER_PREFERENCES } from '../../models';
import { createMockUser } from './testing/mock-auth.service';

describe('AppLockService', () => {
  let service: AppLockService;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
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

    TestBed.configureTestingModule({
      providers: [
        AppLockService,
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });

    service = TestBed.inject(AppLockService);
  });

  afterEach(() => {
    localStorage.removeItem(appLockStorageKey('user-1'));
    clearAttemptState('user-1');
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
});
