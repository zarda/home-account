import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AccessibilityService } from '../../../core/services/accessibility.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { FONT_SCALES, reducedMotionRequested } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Font scale, high contrast, and reduced motion — the three preferences
 * AccessibilityService carries down to the document root.
 *
 * Font scale and high contrast are read straight off the service's signals,
 * so this control can never disagree with what is actually applied to the
 * document root. Reduced motion is different: AccessibilityService exposes
 * the *resolved* value (stored preference OR the OS's own
 * prefers-reduced-motion), but toggling the OS half is not this control's
 * job, so its display state reads the stored override directly off the
 * account.
 */
@Component({
  selector: 'app-accessibility-settings',
  standalone: true,
  imports: [MatButtonToggleModule, MatSlideToggleModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accessibility-settings.component.html',
  styleUrl: './accessibility-settings.component.scss',
})
export class AccessibilitySettingsComponent {
  private accessibility = inject(AccessibilityService);
  private authService = inject(AuthService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);
  private analytics = inject(AnalyticsService);

  readonly fontScales = FONT_SCALES;

  readonly fontScale = this.accessibility.fontScale;
  readonly highContrast = this.accessibility.highContrast;

  readonly reducedMotion = computed(() =>
    reducedMotionRequested(this.authService.currentUser()?.preferences)
  );

  async onFontScaleChange(scale: number): Promise<void> {
    this.accessibility.setFontScale(scale);
    await this.persist({ fontScale: scale });
    this.analytics.trackSettingsChange({ setting: 'font_scale' });
  }

  async onHighContrastChange(enabled: boolean): Promise<void> {
    this.accessibility.setHighContrast(enabled);
    await this.persist({ highContrast: enabled });
    this.analytics.trackSettingsChange({ setting: 'high_contrast' });
  }

  async onReducedMotionChange(enabled: boolean): Promise<void> {
    this.accessibility.setReducedMotion(enabled);
    await this.persist({ reducedMotion: enabled });
    this.analytics.trackSettingsChange({ setting: 'reduced_motion' });
  }

  private async persist(patch: Record<string, unknown>): Promise<void> {
    try {
      // Only the touched keys: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences(patch);
    } catch {
      this.notifications.error(this.translation.t('common.error'));
    }
  }

  fontScaleLabelKey(scale: number): string {
    if (scale === FONT_SCALES[2]) return 'settings.fontScaleExtraLarge';
    if (scale === FONT_SCALES[1]) return 'settings.fontScaleLarge';
    return 'settings.fontScaleDefault';
  }
}
