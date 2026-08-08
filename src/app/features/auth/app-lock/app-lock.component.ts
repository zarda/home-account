import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { PIN_LENGTH, isValidPin } from '../../../core/utils/pin-hash.utils';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-app-lock',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-lock.component.html',
  styleUrl: './app-lock.component.scss',
})
export class AppLockComponent implements OnInit, OnDestroy {
  private appLock = inject(AppLockService);
  private authService = inject(AuthService);
  private translation = inject(TranslationService);
  private router = inject(Router);

  readonly pinLength = PIN_LENGTH;

  pin = signal('');
  isChecking = signal(false);
  errorKey = signal<string | null>(null);
  blockedSeconds = signal(0);

  readonly attemptsExhausted = computed(() => this.appLock.attemptsExhausted());
  readonly isBlocked = computed(() => this.blockedSeconds() > 0);

  private countdown?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    // Drives the "try again in Ns" copy while the backoff runs.
    this.countdown = setInterval(() => {
      this.blockedSeconds.set(Math.ceil(this.appLock.blockedForMs() / 1000));
    }, 250);
  }

  ngOnDestroy(): void {
    if (this.countdown) clearInterval(this.countdown);
  }

  get canSubmit(): boolean {
    return isValidPin(this.pin()) && !this.isChecking() && !this.isBlocked();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit) return;

    this.isChecking.set(true);
    this.errorKey.set(null);
    try {
      const unlocked = await this.appLock.unlockWithPin(this.pin());
      if (unlocked) {
        await this.router.navigateByUrl(this.appLock.consumeRedirect());
        return;
      }
      this.pin.set('');
      this.errorKey.set(
        this.appLock.attemptsExhausted() ? 'appLock.tooManyAttempts' : 'appLock.wrongPin'
      );
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Always available: the lock must never become a state the user cannot leave.
   *
   * Clearing the device credential is what makes that true. Neither the stored
   * PIN nor the enableAppLock preference is touched by signing out, so without
   * this the user signs back in and lands straight back here with the same
   * forgotten PIN — and the settings screen that could remove it sits behind
   * the very lock they cannot pass. Recovery has to happen from this screen.
   */
  async signOut(): Promise<void> {
    // Order matters: clearing first means a sign-out that fails still leaves
    // the device recoverable. Navigation runs either way, so a rejected
    // sign-out cannot strand the user on this screen.
    this.appLock.clearCredential();
    try {
      await this.authService.signOut();
    } catch (error) {
      console.error('Sign-out from the lock screen failed:', error);
    }
    await this.router.navigate(['/login']);
  }

  t(key: string, params?: Record<string, string | number>): string {
    return this.translation.t(key, params);
  }
}
