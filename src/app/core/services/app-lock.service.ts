import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from './auth.service';
import {
  MAX_PIN_ATTEMPTS,
  clearAttemptState,
  clearPinRecord,
  readAttemptState,
  readPinRecord,
  shouldRelock,
  unlockBackoffMs,
  writeAttemptState,
  writePinRecord
} from '../utils/app-lock.utils';
import { derivePinRecord, verifyPin } from '../utils/pin-hash.utils';
import { appLockEnabled, effectiveAppLockTimeoutMinutes } from '../../models';

/**
 * How this device can satisfy the lock. Biometry is not wired yet — the native
 * plugin is tracked separately — so today this is 'pin' or 'none'.
 */
export type AppLockMethod = 'pin' | 'none';

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

  private credentialVersion = signal(0);
  private unlockedAt = signal<number | null>(null);
  private failed = signal(0);
  private blockedUntil = signal(0);

  private backgroundedAt: number | null = null;
  private redirectUrl: string | null = null;
  private lifecycleAttached = false;

  readonly failedAttempts = this.failed.asReadonly();
  readonly attemptsExhausted = computed(() => this.failed() >= MAX_PIN_ATTEMPTS);

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
    return userId && readPinRecord(userId) ? 'pin' : 'none';
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
    effect(() => {
      const userId = this.auth.userId();
      this.unlockedAt.set(null);

      const attempts = userId ? readAttemptState(userId) : { failed: 0, blockedUntil: 0 };
      this.failed.set(attempts.failed);
      this.blockedUntil.set(attempts.blockedUntil);
    });
  }

  /**
   * Attach lifecycle listeners. Awaited from the app initializer so the lock
   * state is settled before the first guarded navigation — if this is ever
   * made non-blocking, a cold start can slip past the lock.
   */
  init(): void {
    this.attachLifecycle();
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
    }
    this.failed.set(0);
    this.blockedUntil.set(0);
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
