import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AppLockService } from '../../../core/services/app-lock.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { PIN_LENGTH, isValidPin } from '../../../core/utils/pin-hash.utils';
import { APP_LOCK_TIMEOUT_MINUTES, effectiveAppLockTimeoutMinutes } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-security-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    TranslatePipe,
  ],
  templateUrl: './security-settings.component.html',
  styleUrl: './security-settings.component.scss',
})
export class SecuritySettingsComponent {
  private appLock = inject(AppLockService);
  private authService = inject(AuthService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  readonly pinLength = PIN_LENGTH;
  readonly timeoutOptions = APP_LOCK_TIMEOUT_MINUTES;

  enabled = signal<boolean>(this.appLock.isEnabled());
  timeoutMinutes = signal<number>(
    effectiveAppLockTimeoutMinutes(this.authService.currentUser()?.preferences)
  );

  isSettingPin = signal(false);
  newPin = '';
  confirmPin = '';

  readonly hasCredential = computed(() => this.appLock.method() !== 'none');

  /** The account asked for a lock but this device has no PIN to satisfy it. */
  readonly needsCredential = computed(() => this.enabled() && !this.hasCredential());

  get canSavePin(): boolean {
    return isValidPin(this.newPin) && this.newPin === this.confirmPin;
  }

  startPinSetup(): void {
    this.newPin = '';
    this.confirmPin = '';
    this.isSettingPin.set(true);
  }

  cancelPinSetup(): void {
    this.newPin = '';
    this.confirmPin = '';
    this.isSettingPin.set(false);
  }

  async savePin(): Promise<void> {
    if (!this.canSavePin) return;

    if (await this.appLock.setPin(this.newPin)) {
      this.cancelPinSetup();
      this.notifications.success(this.translation.t('appLock.pinSaved'));
    } else {
      this.notifications.error(this.translation.t('appLock.pinSaveFailed'));
    }
  }

  async removePin(): Promise<void> {
    this.appLock.clearCredential();
    if (this.enabled()) {
      // A lock with no credential protects nothing; turn the setting off with it.
      this.enabled.set(false);
      await this.persist({ enableAppLock: false });
    }
    this.notifications.success(this.translation.t('appLock.pinRemoved'));
  }

  async onEnabledChange(enabled: boolean): Promise<void> {
    this.enabled.set(enabled);
    await this.persist({ enableAppLock: enabled });
    if (enabled && !this.hasCredential()) {
      this.startPinSetup();
    }
  }

  async onTimeoutChange(minutes: number): Promise<void> {
    this.timeoutMinutes.set(minutes);
    await this.persist({ appLockTimeoutMinutes: minutes });
  }

  private async persist(patch: Record<string, unknown>): Promise<void> {
    try {
      await this.authService.updateUserPreferences({
        ...this.authService.currentUser()?.preferences,
        ...patch,
      });
    } catch {
      this.notifications.error(this.translation.t('common.error'));
    }
  }

  timeoutLabel(minutes: number): string {
    if (minutes === 0) return this.translation.t('appLock.timeoutImmediately');
    if (minutes === 1) return this.translation.t('appLock.timeoutMinute');
    return this.translation.t('appLock.timeoutMinutes', { minutes });
  }
}
