import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from './auth.service';
import { BiometricAuthService, BiometricOutcome } from './biometric-auth.service';
import {
  APP_LOCK_STORAGE_PREFIX,
  MAX_PIN_ATTEMPTS,
  clearAttemptState,
  clearBiometricOptIn,
  clearPinRecord,
  readAttemptState,
  readBiometricOptIn,
  readPinRecord,
  shouldRelock,
  unlockBackoffMs,
  writeAttemptState,
  writeBiometricOptIn,
  writePinRecord
} from '../utils/app-lock.utils';
import { derivePinRecord, verifyPin } from '../utils/pin-hash.utils';
import { appLockEnabled, effectiveAppLockTimeoutMinutes } from '../../models';

/**
 * How this device can satisfy the lock: a biometric prompt when the device
 * offers one and the account has opted in, the PBKDF2 PIN otherwise, or
 * 'none' when this device has no PIN at all.
 */
export type AppLockMethod = 'biometric' | 'pin' | 'none';

const DEFAULT_REDIRECT = '/dashboard';

/**
 * Gates the app behind a device credential when the account asks for one.
 *
 * The unlocked timestamp lives in memory and starts null, so a cold start is
 * locked by construction — there is no separate "locked" flag to keep in sync,
 * and nothing an attacker could edit on disk to widen the grace window.
 */
@Injectable({ providedIn: 'root' })
export class AppLockService {
  private auth = inject(AuthService);
  private router = inject(Router);
  private biometric = inject(BiometricAuthService);

  private credentialVersion = signal(0);
  private unlockedAt = signal<number | null>(null);
  private failed = signal(0);
  private blockedUntil = signal(0);
  private lastOutcome = signal<BiometricOutcome | null>(null);

  private backgroundedAt: number | null = null;
  private redirectUrl: string | null = null;
  private lifecycleAttached = false;

  readonly failedAttempts = this.failed.asReadonly();
  readonly attemptsExhausted = computed(() => this.failed() >= MAX_PIN_ATTEMPTS);
  /** The most recent biometric prompt result, so the lock screen can word a lockout. */
  readonly lastBiometricOutcome = this.lastOutcome.asReadonly();

  readonly isEnabled = computed(() => appLockEnabled(this.auth.currentUser()?.preferences));
  readonly timeoutMinutes = computed(() =>
    effectiveAppLockTimeoutMinutes(this.auth.currentUser()?.preferences)
  );

  /**
   * 'none' means the account wants a lock but this device has no credential to
   * satisfy it. The app then stays open and settings shows a warning: failing
   * closed would strand the user with nothing to unlock with.
   */
  readonly method = computed<AppLockMethod>(() => {
    this.credentialVersion();
    const userId = this.auth.userId();
    if (!userId || !readPinRecord(userId)) return 'none';
    if (readBiometricOptIn(userId) && this.biometric.available()) return 'biometric';
    return 'pin';
  });

  readonly canEngage = computed(() => this.isEnabled() && this.method() !== 'none');
  readonly isLocked = computed(() => this.canEngage() && this.unlockedAt() === null);

  constructor() {
    // Covers the resume-timeout case, where nothing is navigating for the
    // guard to intercept.
    effect(() => {
      if (!this.isLocked()) return;
      const url = this.router.url;
      if (url.startsWith('/lock') || url.startsWith('/login')) return;
      this.rememberRedirect(url);
      void this.router.navigate(['/lock']);
    });

    // Never carry one account's unlocked state into the next. The throttle is
    // restored from storage rather than reset, so a reload cannot clear it.
    // The remembered biometric outcome has no such record to restore from, so
    // it is simply cleared — a 'lockedOut' from one account must not survive
    // into the next account's lock screen.
    effect(() => {
      const userId = this.auth.userId();
      this.unlockedAt.set(null);
      this.lastOutcome.set(null);

      const attempts = userId ? readAttemptState(userId) : { failed: 0, blockedUntil: 0 };
      this.failed.set(attempts.failed);
      this.blockedUntil.set(attempts.blockedUntil);
    });
  }

  /**
   * Attach lifecycle listeners and kick off the biometric probe: fired and
   * forgotten from the app initializer — the lock state is settled
   * synchronously, and the probe races its own deadline rather than being
   * allowed to delay the first guarded navigation.
   */
  init(): void {
    this.attachLifecycle();
    void this.biometric.detectAvailability();
  }

  private attachLifecycle(): void {
    if (this.lifecycleAttached || typeof document === 'undefined') return;
    this.lifecycleAttached = true;

    // WKWebView fires this when the app is backgrounded, so one handler covers
    // both the installed iOS app and the web build.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.onBackground();
      } else {
        this.onForeground();
      }
    });

    if (typeof window === 'undefined') return;

    // Fires only in the app's *other* tabs. Without it, a tab sitting on the
    // lock screen keeps its memoized 'pin' method after the credential is
    // removed elsewhere, so no PIN opens it and it stays stuck until reload.
    window.addEventListener('storage', event => {
      if (event.key === null || event.key.startsWith(APP_LOCK_STORAGE_PREFIX)) {
        this.credentialVersion.update(v => v + 1);
      }
    });
  }

  private onBackground(): void {
    this.backgroundedAt = Date.now();
  }

  private onForeground(): void {
    if (shouldRelock(this.backgroundedAt, Date.now(), this.timeoutMinutes())) {
      this.lockNow();
    }
    this.backgroundedAt = null;
  }

  lockNow(): void {
    this.unlockedAt.set(null);
    this.lastOutcome.set(null);
  }

  private markUnlocked(): void {
    this.unlockedAt.set(Date.now());
    this.failed.set(0);
    this.blockedUntil.set(0);

    const userId = this.auth.userId();
    if (userId) clearAttemptState(userId);
  }

  /** Remaining backoff in milliseconds, for the lock screen countdown. */
  blockedForMs(): number {
    return Math.max(0, this.blockedUntil() - Date.now());
  }

  async unlockWithPin(pin: string): Promise<boolean> {
    if (this.blockedForMs() > 0) return false;

    const userId = this.auth.userId();
    if (!userId) return false;

    const record = readPinRecord(userId);
    if (!record) return false;

    if (await verifyPin(pin, record)) {
      this.markUnlocked();
      return true;
    }

    const attempts = this.failed() + 1;
    const blockedUntil = Date.now() + unlockBackoffMs(attempts);
    this.failed.set(attempts);
    this.blockedUntil.set(blockedUntil);
    writeAttemptState(userId, { failed: attempts, blockedUntil });
    return false;
  }

  /**
   * A cancelled or failed prompt is not a wrong PIN attempt — the OS owns
   * biometric lockout — so this never touches `failedAttempts` or the
   * backoff, only the PIN path does.
   */
  async unlockWithBiometrics(reason: string): Promise<boolean> {
    // Deliberately blind to the PIN backoff and the exhausted-attempts state —
    // the OS owns biometric lockout, and a face is not brute-forceable from the
    // keyboard — and reads `method()` fresh because `available()` can flip
    // false->true after the lock screen has painted, moving it from 'pin' to
    // 'biometric' underneath this call.
    if (this.method() !== 'biometric') return false;

    const outcome = await this.biometric.authenticate(reason);
    this.lastOutcome.set(outcome);

    if (outcome !== 'success') return false;

    this.markUnlocked();
    return true;
  }

  /** Store a new PIN for this device. False when storage refused the write. */
  async setPin(pin: string): Promise<boolean> {
    const userId = this.auth.userId();
    if (!userId) return false;

    const record = await derivePinRecord(pin);
    if (!writePinRecord(userId, record)) return false;

    this.credentialVersion.update(v => v + 1);
    this.markUnlocked();
    return true;
  }

  clearCredential(): void {
    const userId = this.auth.userId();
    if (userId) {
      clearPinRecord(userId);
      clearAttemptState(userId);
      clearBiometricOptIn(userId);
    }
    this.failed.set(0);
    this.blockedUntil.set(0);
    this.credentialVersion.update(v => v + 1);
  }

  /** Opt this device's PIN in or out of the biometric shortcut. */
  setBiometricOptIn(on: boolean): void {
    const userId = this.auth.userId();
    if (userId) writeBiometricOptIn(userId, on);
    this.credentialVersion.update(v => v + 1);
  }

  rememberRedirect(url: string): void {
    this.redirectUrl = url;
  }

  consumeRedirect(): string {
    const url = this.redirectUrl ?? DEFAULT_REDIRECT;
    this.redirectUrl = null;
    return url.startsWith('/lock') ? DEFAULT_REDIRECT : url;
  }
}
