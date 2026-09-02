import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';

import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BudgetAlert, Category, RecurringOccurrence } from '../../../models';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { roundMoney } from '../../../core/utils/transaction-aggregation.utils';
import { addDays, endOfDay, startOfDay } from '../../../core/utils/transaction-date.utils';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * How far ahead the card looks for bills, today included. The recap is a
 * week's story, so the week ahead is the span that reads beside it — the
 * page's own fortnight belongs to the upcoming-bills card.
 */
const BILLS_WINDOW_DAYS = 7;

/** Which way the recapped week went against the one before it. */
export type RecapTrend = 'up' | 'down' | 'flat' | 'none';

/**
 * Last week in a card: what went out, where it went, and what that leaves
 * standing this week.
 *
 * The figures and the narrative come from WeeklyRecapService, which owns the
 * week boundary, the two queries and the once-per-week memo; the card only
 * reads them. The live lines — budgets over their thresholds, bills about to
 * fall due — are inputs, because the page already holds those listeners and a
 * second subscription would be a second answer to the same question.
 *
 * Neither line names anything: a budget or a rule named here would repeat, in
 * a summary, text the user typed for a different surface, and the count is the
 * part that belongs in a recap.
 */
@Component({
  selector: 'app-weekly-recap',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    AmountDisplayComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './weekly-recap.component.html',
  styleUrl: './weekly-recap.component.scss',
})
export class WeeklyRecapComponent implements OnInit {
  alerts = input.required<BudgetAlert[]>();
  upcoming = input.required<RecurringOccurrence[]>();
  baseCurrency = input.required<string>();
  categories = input.required<Map<string, Category>>();

  /** Read here, never written: the service decides what the week says. */
  readonly recap = inject(WeeklyRecapService);

  private currencyService = inject(CurrencyService);
  private categoryHelperService = inject(CategoryHelperService);
  private localeFormatService = inject(LocaleFormatService);
  private announcer = inject(AnnouncerService);
  private translationService = inject(TranslationService);
  private pendingFilters = inject(PendingFiltersService);
  private reminders = inject(ReminderService);
  private router = inject(Router);

  private announced = false;

  /**
   * The week on screen, or null while the card is away. `visible()` already
   * implies a composition, so pairing the two here spares the template a
   * nullable it would otherwise re-check on every line.
   */
  readonly week = computed(() => (this.recap.visible() ? this.recap.figures() : null));

  readonly range = computed(() => {
    const window = this.recap.window();
    return this.localeFormatService.formatRange(window.start, window.end, 'medium');
  });

  /**
   * The change against the week before, as the chip states it. A delta that
   * rounds away is flat rather than a rise of nothing: "up 0%" is a figure
   * the arithmetic produced, not a thing that happened.
   */
  private readonly change = computed<{ trend: RecapTrend; percent: number }>(() => {
    const delta = this.week()?.spendDelta ?? null;
    if (delta === null) return { trend: 'none', percent: 0 };

    const percent = Math.round(Math.abs(delta) * 100);
    if (percent === 0) return { trend: 'flat', percent };
    return { trend: delta > 0 ? 'up' : 'down', percent };
  });

  readonly trend = computed(() => this.change().trend);

  /** The copy carries the direction, so the percentage is unsigned. */
  readonly deltaLabel = computed(() => {
    const { trend, percent } = this.change();
    switch (trend) {
      case 'up':
        return this.translationService.t('recap.upVsLastWeek', { percent });
      case 'down':
        return this.translationService.t('recap.downVsLastWeek', { percent });
      case 'flat':
        return this.translationService.t('recap.flat');
      default:
        return this.translationService.t('recap.noComparison');
    }
  });

  readonly budgetsLabel = computed(() => {
    const count = this.alerts().length;
    return count === 0
      ? this.translationService.t('recap.budgetsOnTrack')
      : this.translationService.t('recap.budgetsOver', { count });
  });

  readonly billsLabel = computed(() =>
    this.translationService.t('recap.billsDue', { count: this.billsDue().length })
  );

  /**
   * The rules landing between today and the end of the week ahead. The page's
   * window runs a fortnight and deliberately keeps occurrences already past;
   * those are the upcoming-bills card's to show, and counting them here would
   * read as money still to move.
   */
  readonly billsDue = computed(() => {
    const today = new Date();
    const from = startOfDay(today).getTime();
    const until = endOfDay(addDays(today, BILLS_WINDOW_DAYS - 1)).getTime();
    return this.upcoming().filter(occurrence => {
      const at = occurrence.date.getTime();
      return at >= from && at <= until;
    });
  });

  /**
   * Live conversion, unlike the recapped week's own figures: a scheduled
   * occurrence has not been written yet, so there is no base-currency
   * snapshot to prefer (ADR 0091). Income counts positive, as it does in the
   * page's upcoming net.
   */
  readonly billsDueNet = computed(() => {
    const baseCurrency = this.baseCurrency();
    const net = this.billsDue().reduce((sum, occurrence) => {
      const amount = this.currencyService.convert(
        occurrence.amount, occurrence.currency, baseCurrency);
      return occurrence.type === 'income' ? sum + amount : sum - amount;
    }, 0);
    return roundMoney(net);
  });

  /** One sentence for assistive technology, not the card read out in full. */
  private readonly announcement = computed(() => {
    const week = this.week();
    if (!week) return '';
    return this.translationService.t('recap.announcement', {
      amount: this.currencyService.formatCurrency(week.spend, this.baseCurrency()),
      change: this.deltaLabel(),
    });
  });

  constructor() {
    // Screen readers hear the recap once per appearance, not once per
    // recompute: the effect reruns whenever a signal it reads changes, so
    // an ungated announcement would fire repeatedly for one sighting — the
    // same guard, for the same reason, as the budget alert banner's.
    effect(() => {
      if (this.week() && !this.announced) {
        this.announced = true;
        this.announcer.announce(this.announcement());
      }
    });
  }

  ngOnInit(): void {
    // Safe on every dashboard open: past its own gates the service composes a
    // week once per account, and a card the gates hide still needs the
    // composition that decides it should be hidden.
    void this.recap.load();
  }

  /**
   * Open the transaction list on exactly the week the card describes. Same
   * pending-filters hand-off the spending chart uses, so the window lands as
   * visible, clearable filters rather than an invisible query param.
   */
  seeTransactions(): void {
    const window = this.recap.window();
    this.pendingFilters.apply({ startDate: window.start, endDate: window.end });
    void this.router.navigate(['/transactions']);
  }

  dismiss(): void {
    this.recap.dismiss();

    // Only a sweep reads the dismissed week, so a Monday nudge already booked
    // for it stays booked until the next one runs — closing the card at 08:30
    // would otherwise still be interrupted at 09:00. Ordered after the write:
    // the sweep produces no nudge for a week already put away, and its prune
    // retires the pending one.
    void this.reminders.sweep();
  }

  categoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }
}
