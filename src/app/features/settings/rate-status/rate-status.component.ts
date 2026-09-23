import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Which rung of the exchange-rate ladder the loaded table came from, under
 * the currency it converts to.
 *
 * Passive on purpose. A missed live table retries on its own once the
 * connection returns (CurrencyService, bounded), but that recovery has no
 * control here to trigger early and nothing to confirm beyond the rung
 * itself flipping to `live` — what the user needs is to know that the
 * figures on screen are older than they look, and when they stopped being
 * current. Nothing read `lastUpdated` before this — ADR 0037 named that gap
 * while keeping the signal honest for it.
 *
 * `live` and `cached` render the same line: a fresh cache and a live fetch
 * both mean the table is under `CACHE_DURATION_MS` old, which is the same
 * claim about the table's age either way, so naming the provider would be
 * a distinction with no difference to the user. `expired` and `fallback`
 * keep lines of their own because they are the two rungs that did not reach
 * the provider — that failure is the thing worth saying.
 *
 * Renders nothing while `rateSource` is null: initialization has not settled,
 * and a marker that guesses is worse than one that waits a tick.
 */
@Component({
  selector: 'app-rate-status',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rate-status.component.html',
  styleUrl: './rate-status.component.scss',
})
export class RateStatusComponent {
  private currencyService = inject(CurrencyService);
  private dateFormat = inject(DateFormatService);
  private localeFormat = inject(LocaleFormatService);

  /** Read-only here: the ladder is the only thing that names a rung. */
  readonly rateSource = computed(() => this.currencyService.rateSource());

  /** The two rungs that mean a fetch failed, and the only two styled as such. */
  readonly isStale = computed(() => {
    const source = this.rateSource();
    return source === 'expired' || source === 'fallback';
  });

  /**
   * The stamp: its date through the user's own date-format preference — set
   * on the same Settings page, in the field right after the base currency this
   * line sits under, so a fixed pattern here would visibly disagree with it —
   * and its time in the locale's own format, since there is no clock
   * preference to follow. Read only by the three dated rungs; the constants
   * rung has no real date and says so in words instead.
   */
  readonly dateParam = computed(() => {
    const updated = this.currencyService.lastUpdated();
    return {
      date: updated ? this.dateFormat.formatDate(updated) : '',
      time: updated ? this.localeFormat.formatTime(updated) : '',
    };
  });
}
