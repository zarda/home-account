import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DefaultUrlSerializer, Navigation, Router, UrlTree } from '@angular/router';

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
  /** The navigation the Router double reports in flight; null is the idle router. */
  let currentNavigation: ReturnType<typeof signal<Navigation | null>>;
  let biometric: BiometricAuthDouble;
  let userId: ReturnType<typeof signal<string | null>>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let profileDegraded: ReturnType<typeof signal<boolean>>;

  const PIN = '246813';

  function setPreferences(prefs: Partial<UserPreferences>): void {
    currentUser.set(
      createMockUser('user-1', {
        preferences: { ...DEFAULT_USER_PREFERENCES, ...prefs },
      })
    );
  }

  /**
   * What AuthService runs on when the profile read fails: an in-memory profile
   * under the same uid, built from DEFAULT_USER_PREFERENCES, so it never names
   * a lock.
   */
  function degrade(): void {
    currentUser.set(createMockUser('user-1', { preferences: { ...DEFAULT_USER_PREFERENCES } }));
    profileDegraded.set(true);
  }

  /** The retry swapping the stored profile in for the fallback. */
  function recover(prefs: Partial<UserPreferences>): void {
    setPreferences(prefs);
    profileDegraded.set(false);
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
    profileDegraded = signal(false);

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['signOut'], {
      userId,
      currentUser,
      profileDegraded,
    });

    currentNavigation = signal<Navigation | null>(null);
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl', 'serializeUrl'], {
      url: '/dashboard',
      currentNavigation
    });
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    router.serializeUrl.and.callFake((tree: UrlTree) => tree.toString());

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

  // The fallback profile cannot say whether the account asked for a lock. A
  // PIN for this account on this device is the evidence that is left, so the
  // lock takes it, and the real profile settles the question when it arrives.
  describe('a profile that could not be read', () => {
    it('locks a cold start when this device holds the account PIN', async () => {
      await seedPin();
      degrade();

      expect(service.canEngage()).toBe(true);
      expect(service.isLocked()).toBe(true);
    });

    // The device rule is unchanged: with nothing here to unlock with, locking
    // would strand the user exactly as it would on a loaded profile.
    it('stays unlocked when this device has no PIN', () => {
      degrade();

      expect(service.method()).toBe('none');
      expect(service.canEngage()).toBe(false);
      expect(service.isLocked()).toBe(false);
    });

    // Not a path the SDK takes today: it hands the listener the same uid again
    // only after a sign-out, which clears the unlocked state first, or as the
    // registration's first emit repeats at start-up, before any unlock.
    // Pinned so that a later read failing under a locked session never opens
    // it.
    it('keeps a locked session locked when its profile turns degraded', async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      expect(service.isLocked()).toBe(true);

      degrade();
      TestBed.tick();

      expect(service.isLocked()).toBe(true);
    });

    it('keeps an unlock made while degraded once the real profile arrives with the lock on', async () => {
      await seedPin();
      degrade();
      // The account effect clears the unlocked state on its first run.
      TestBed.tick();
      expect(service.isLocked()).toBe(true);
      expect(router.navigate).toHaveBeenCalledWith(['/lock']);
      await expectAsync(service.unlockWithPin(PIN)).toBeResolvedTo(true);

      recover({ enableAppLock: true });
      TestBed.tick();

      expect(service.canEngage()).toBe(true);
      expect(service.isLocked()).toBe(false);
    });

    it('stands down once the real profile arrives without a lock', async () => {
      await seedPin();
      degrade();
      expect(service.isLocked()).toBe(true);

      recover({ enableAppLock: false });

      expect(service.canEngage()).toBe(false);
      expect(service.isLocked()).toBe(false);
    });

    // Settings reads isEnabled for its switch and its missing-PIN warning, so
    // it keeps meaning what the account asked for, not what the lock does.
    it('leaves isEnabled to the account preference', async () => {
      await seedPin();
      degrade();

      expect(service.isEnabled()).toBe(false);
    });
  });

  // Nothing navigates when the real profile arrives, so lockGuard never sees
  // a lock that came down with it: the service takes a lock screen that is
  // showing down itself, as its relock effect puts one up.
  describe('standing the lock screen down', () => {
    function onLockScreen(): void {
      (Object.getOwnPropertyDescriptor(router, 'url')!.get as jasmine.Spy).and.returnValue('/lock');
    }

    beforeEach(async () => {
      await seedPin();
      degrade();
      // Runs the effects on the degraded profile; the relock effect remembers
      // the page it sent to /lock, which the case then replaces.
      TestBed.tick();
      service.rememberRedirect('/transactions');
    });

    it('leaves the lock screen for the remembered page once the real profile asks for no lock', () => {
      onLockScreen();
      recover({ enableAppLock: false });
      TestBed.tick();

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/transactions');
    });

    it('stays when the real profile asks for the lock', () => {
      onLockScreen();
      recover({ enableAppLock: true });
      TestBed.tick();

      expect(service.isLocked()).toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('leaves any page but the lock screen alone', () => {
      recover({ enableAppLock: false });
      TestBed.tick();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    // A cold start on the web can settle while its own navigation to /lock
    // is still loading the screen: the stand-down waits for it rather than
    // being lost to it.
    it('waits out a navigation under way, then leaves the lock screen it landed on', () => {
      currentNavigation.set({
        extractedUrl: new DefaultUrlSerializer().parse('/lock'),
      } as Navigation);
      recover({ enableAppLock: false });
      TestBed.tick();
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      onLockScreen();
      currentNavigation.set(null);
      TestBed.tick();

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/transactions');
    });

    it('does nothing once a navigation under way lands anywhere but the lock screen', () => {
      currentNavigation.set({
        extractedUrl: new DefaultUrlSerializer().parse('/dashboard'),
      } as Navigation);
      recover({ enableAppLock: false });
      TestBed.tick();

      currentNavigation.set(null);
      TestBed.tick();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    // Settled, then unknown again before the navigation it waited on landed:
    // the lock holds once more, and the screen stays.
    it('stays when the profile is unknown again by the time a navigation under way lands', () => {
      currentNavigation.set({
        extractedUrl: new DefaultUrlSerializer().parse('/lock'),
      } as Navigation);
      recover({ enableAppLock: false });
      TestBed.tick();
      degrade();
      TestBed.tick();

      onLockScreen();
      currentNavigation.set(null);
      TestBed.tick();

      expect(service.isLocked()).toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('stands down once, not again on a later navigation', () => {
      onLockScreen();
      recover({ enableAppLock: false });
      TestBed.tick();
      currentNavigation.set({
        extractedUrl: new DefaultUrlSerializer().parse('/settings'),
      } as Navigation);
      TestBed.tick();
      currentNavigation.set(null);
      TestBed.tick();

      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    // The listener's signed-out branch lowers the flag too; the sign-out's
    // own navigation goes to /login.
    it('does nothing when the session ends', () => {
      onLockScreen();
      currentUser.set(null);
      userId.set(null);
      profileDegraded.set(false);
      TestBed.tick();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    // A sign-out from the lock screen clears the PIN before the session
    // ends, and a retry can land in between: the lock is down then, but the
    // real profile asks for it, so the screen is not the stand-down's to take.
    it('stays when the profile settles asking for the lock after the lock fell for another reason', () => {
      onLockScreen();
      service.clearCredential();
      recover({ enableAppLock: true });
      TestBed.tick();

      expect(service.isLocked()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    // Only the profile settling takes the screen down. A PIN removed in
    // another tab is, more often than not, a sign-out on its way there, and
    // the reload it brings places the page.
    it('does not follow a lock that falls for any other reason', () => {
      onLockScreen();
      service.clearCredential();
      TestBed.tick();

      expect(service.isLocked()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
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

  describe('relocking while a navigation is in flight', () => {
    /** A navigation whose target the router has parsed but not yet committed. */
    function inFlight(target: string): Navigation {
      return { extractedUrl: new DefaultUrlSerializer().parse(target) } as Navigation;
    }

    beforeEach(async () => {
      await seedPin();
      setPreferences({ enableAppLock: true });
      await service.unlockWithPin(PIN);
      // The router is on /transactions: its url is the page the tap left.
      // createSpyObj already spies the property's getter.
      (Object.getOwnPropertyDescriptor(router, 'url')!.get as jasmine.Spy).and.returnValue(
        '/transactions'
      );
      // Flushes the effect; whichever state it first ran in, the reset below
      // leaves a clean slate.
      TestBed.tick();
      // The cold start above was locked until the PIN: the effect already
      // sent that first lock to /lock, which is not what these cases count.
      router.navigate.calls.reset();
      service.consumeRedirect();
    });

    it('remembers the target of a navigation that has not committed yet', () => {
      currentNavigation.set(inFlight('/dashboard?bill=r1'));

      service.lockNow();
      TestBed.tick();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/lock']);
      expect(service.consumeRedirect())
        .withContext('the tap target, neither the page the relock left nor the default redirect')
        .toBe('/dashboard?bill=r1');
    });

    // A target that is not an app route (a scheme-relative `//evil.example`) is
    // refused by safeAppRoute, so the relock falls back to the page the router
    // is on: both the guard and the router.url fallback are held here.
    it('refuses a navigation target that is not an app route and remembers the page the router is on', () => {
      router.serializeUrl.and.returnValue('//evil.example');
      currentNavigation.set(inFlight('/dashboard'));

      service.lockNow();
      TestBed.tick();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/lock']);
      expect(service.consumeRedirect())
        .withContext('the page the relock left, never the refused target')
        .toBe('/transactions');
    });

    // The idle router has no navigation to read, so the page it is on stays
    // the answer: this passed before the target was read from a navigation.
    it('remembers the page the router is on when nothing is in flight', () => {
      service.lockNow();
      TestBed.tick();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/lock']);
      expect(service.consumeRedirect()).toBe('/transactions');
    });

    // Read untracked. With this double's frozen url, a tracked read would run
    // again when the /lock navigation ends and navigate a second time; on the
    // real Router url is /lock by then, so this case guards the untracked read
    // itself.
    it('runs once per lock, not again when a navigation starts or ends after it', () => {
      currentNavigation.set(inFlight('/dashboard?bill=r1'));
      service.lockNow();
      TestBed.tick();
      expect(router.navigate).toHaveBeenCalledOnceWith(['/lock']);

      currentNavigation.set(inFlight('/lock')); // the navigation to /lock itself
      TestBed.tick();
      currentNavigation.set(null); // and its end
      TestBed.tick();

      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(service.consumeRedirect()).toBe('/dashboard?bill=r1');
    });

    it('leaves the lock screen alone when that is where the navigation is going', async () => {
      currentNavigation.set(inFlight('/lock'));

      service.lockNow();
      TestBed.tick();

      expect(router.navigate).not.toHaveBeenCalled();

      // The effect did run: the next relock, with nothing in flight, acts.
      await service.unlockWithPin(PIN);
      TestBed.tick(); // the effect sees the unlock, so the next lock is a transition
      currentNavigation.set(null);
      service.lockNow();
      TestBed.tick();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/lock']);
      expect(service.consumeRedirect()).toBe('/transactions');
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
