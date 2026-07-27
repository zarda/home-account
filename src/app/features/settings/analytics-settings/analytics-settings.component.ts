import { Component, computed, inject } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { usageAnalyticsEnabled } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Opt-in for anonymous usage statistics.
 *
 * The toggle reads straight off the preferences signal rather than holding its
 * own copy, so it stays right when the preference changes elsewhere — another
 * device, or a sign-out — and so the displayed state can never disagree with
 * what AnalyticsService is acting on.
 */
@Component({
  selector: 'app-analytics-settings',
  standalone: true,
  imports: [MatSlideToggleModule, TranslatePipe],
  templateUrl: './analytics-settings.component.html',
  styleUrl: './analytics-settings.component.scss',
})
export class AnalyticsSettingsComponent {
  private authService = inject(AuthService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  readonly enabled = computed(() =>
    usageAnalyticsEnabled(this.authService.currentUser()?.preferences)
  );

  async onEnabledChange(enabled: boolean): Promise<void> {
    try {
      await this.authService.updateUserPreferences({
        ...this.authService.currentUser()?.preferences,
        enableUsageAnalytics: enabled,
      });
    } catch {
      // The signal is unchanged on failure, so the toggle springs back to the
      // stored value rather than showing a setting that was never saved.
      this.notifications.error(this.translation.t('common.error'));
    }
  }
}
