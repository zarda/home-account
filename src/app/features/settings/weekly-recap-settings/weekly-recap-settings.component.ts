import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Capacitor } from '@capacitor/core';

import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * The weekly recap — the opt-in for last week's card, and for the Monday
 * nudge that points at it.
 *
 * Nothing is read until this is on: the recap costs two queries per dashboard
 * open, so the switch is what decides whether an account pays for a card it
 * never asked for.
 *
 * Unlike the reminders switch, the operating system is not a gate here. The
 * card is the recap and needs nothing from the OS; the nudge only points at
 * it. So the preference is stored whether or not the prompt is answered, and
 * a refusal is worth one sentence rather than a refused opt-in.
 *
 * The displayed state is WeeklyRecapService's own `enabled` signal rather
 * than a copy, so the control cannot disagree with what is being acted on —
 * including when the preference arrives from another device.
 */
@Component({
  selector: 'app-weekly-recap-settings',
  standalone: true,
  imports: [MatSlideToggleModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './weekly-recap-settings.component.html',
  styleUrl: './weekly-recap-settings.component.scss',
})
export class WeeklyRecapSettingsComponent {
  private authService = inject(AuthService);
  private recap = inject(WeeklyRecapService);
  private reminders = inject(ReminderService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  readonly enabled = this.recap.enabled;

  async onEnabledChange(event: MatSlideToggleChange): Promise<void> {
    // Devices only. The nudge is always scheduled ahead of time and the web
    // build never raises one, so asking here would spend the single prompt a
    // browser offers on a notification that cannot arrive. Both platforms
    // only raise it inside a user gesture and sweeps deliberately never ask,
    // so a request that does not happen on this click never happens at all.
    const refused =
      event.checked && Capacitor.isNativePlatform() && !(await this.reminders.requestPermission());

    if (!(await this.persist(event.checked, event))) return;

    // Said once and no more: the card still shows, on every platform, and a
    // refusal costs the Monday notification alone.
    if (refused) {
      this.notifications.info(this.translation.t('settings.weeklyRecapNoNotifications'));
    }

    // The service's own effect would sweep when the preference lands, but on
    // its schedule rather than this one; sweeping here books the nudge — or
    // retires it — with the click rather than five minutes later.
    void this.reminders.sweep();
  }

  private async persist(enabled: boolean, event: MatSlideToggleChange): Promise<boolean> {
    try {
      // Only the touched key: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences({ enableWeeklyRecap: enabled });
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
   * control without moving the bound expression, so change detection compares
   * the stored value against the one it last wrote, finds them equal and skips
   * the DOM. Nothing rewrites the switch unless this does.
   */
  private revert(event: MatSlideToggleChange): void {
    event.source.checked = this.enabled();
  }
}
