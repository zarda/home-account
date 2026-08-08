import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { canDisableUsageAnalytics, usageAnalyticsEnabled } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Usage-statistics setting.
 *
 * Collection is part of the free tier and cannot be switched off there, so for
 * most accounts this is a disclosure rather than a control: the toggle shows the
 * real state, disabled, with copy saying why. Turning it off is a premium
 * entitlement.
 *
 * Both the state and the entitlement are computed off the auth signal rather
 * than copied into local state, so the control cannot disagree with what
 * AnalyticsService is acting on — including when a tier or preference change
 * arrives from another device.
 */
@Component({
  selector: 'app-analytics-settings',
  standalone: true,
  imports: [MatSlideToggleModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analytics-settings.component.html',
  styleUrl: './analytics-settings.component.scss',
})
export class AnalyticsSettingsComponent {
  private authService = inject(AuthService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  readonly enabled = computed(() => usageAnalyticsEnabled(this.authService.currentUser()));

  /** Premium only. Drives the disabled state and which explanation is shown. */
  readonly canDisable = computed(() => canDisableUsageAnalytics(this.authService.currentUser()));

  async onEnabledChange(enabled: boolean): Promise<void> {
    // The template disables the control on the free tier, but the handler is
    // public and a disabled control is a UI affordance rather than a
    // guarantee — so the entitlement is re-checked here.
    if (!this.canDisable()) {
      return;
    }

    try {
      // Only the touched key: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences({
        enableUsageAnalytics: enabled,
      });
    } catch {
      // The signal is unchanged on failure, so the toggle springs back to the
      // stored value rather than showing a setting that was never saved.
      this.notifications.error(this.translation.t('common.error'));
    }
  }
}
