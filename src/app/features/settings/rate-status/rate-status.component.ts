import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Which rung of the exchange-rate ladder the loaded table came from, under
 * the currency it converts to.
 *
 * Passive on purpose. The ladder runs once, from the service's constructor,
 * and `refreshRates` is a rejecting API with no recovery of its own, so a
 * "refresh now" control here would be an affordance for something the app
 * cannot yet honour; what the user needs first is to know that the figures
 * on screen are older than they look. Nothing read `lastUpdated` before
 * this — ADR 0037 named that gap while keeping the signal honest for it.
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

  /** Read-only here: the ladder is the only thing that names a rung. */
  readonly rateSource = computed(() => this.currencyService.rateSource());

  /** The two rungs that mean a fetch failed, and the only two styled as such. */
  readonly isStale = computed(() => {
    const source = this.rateSource();
    return source === 'expired' || source === 'fallback';
  });

  /**
   * The stamp, through the user's own date preference — set two fields above
   * this one, so a fixed pattern here would visibly disagree with it. Read
   * only by the three dated rungs; the constants rung has no real date and
   * says so in words instead.
   */
  readonly dateParam = computed(() => {
    const updated = this.currencyService.lastUpdated();
    return { date: updated ? this.dateFormat.formatDate(updated) : '' };
  });
}
