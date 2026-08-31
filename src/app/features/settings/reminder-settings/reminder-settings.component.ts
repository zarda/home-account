import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Bill and budget reminders — the opt-in for the local notifications
 * ReminderService raises.
 *
 * Free tier, so there is no entitlement gate here; the only gate is the
 * operating system's, and it is asked for on the way in rather than on the
 * way out. The displayed state is the service's own `enabled` signal rather
 * than a copy, so the control cannot disagree with what is being acted on —
 * including when the preference arrives from another device.
 */
@Component({
  selector: 'app-reminder-settings',
  standalone: true,
  imports: [MatSlideToggleModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reminder-settings.component.html',
  styleUrl: './reminder-settings.component.scss',
})
export class ReminderSettingsComponent {
  private authService = inject(AuthService);
  private reminders = inject(ReminderService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  readonly enabled = this.reminders.enabled;

  async onEnabledChange(event: MatSlideToggleChange): Promise<void> {
    if (!event.checked) {
      await this.persist(false, event);
      return;
    }

    // Permission first, preference second. Both platforms only raise the OS
    // prompt inside a user gesture and sweeps deliberately never ask, so a
    // request that does not happen on this click never happens at all —
    // leaving a stored opt-in that can never deliver anything.
    const granted = await this.reminders.requestPermission();
    if (!granted) {
      this.notifications.error(
        this.translation.t('settings.reminderNotificationsPermissionDenied')
      );
      this.revert(event);
      return;
    }

    if (!(await this.persist(true, event))) return;

    // The service's own effect would sweep when the preference lands, but on
    // its schedule rather than this one; sweeping here is what makes the
    // first reminders arrive with the click.
    void this.reminders.sweep();
  }

  private async persist(enabled: boolean, event: MatSlideToggleChange): Promise<boolean> {
    try {
      // Only the touched key: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences({ enableReminders: enabled });
      return true;
    } catch {
      this.notifications.error(this.translation.t('common.error'));
      this.revert(event);
      return false;
    }
  }

  /**
   * Put the switch back where the account says it is.
   *
   * The `[checked]` binding cannot do this on its own: the click moved the
   * control without moving the bound expression, so change detection
   * compares the stored value against the one it last wrote, finds them
   * equal and skips the DOM. Nothing rewrites the switch unless this does.
   */
  private revert(event: MatSlideToggleChange): void {
    event.source.checked = this.enabled();
  }
}
