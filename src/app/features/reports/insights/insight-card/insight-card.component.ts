import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { CategoryService } from '../../../../core/services/category.service';
import { PendingFiltersService } from '../../../../core/services/pending-filters.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  InsightCard,
  InsightKind,
  SerializableFilters,
  Transaction,
  TransactionFilters,
} from '../../../../models';
import { cadenceKey } from '../../../../core/utils/insight-card.utils';
import { parseDayKey } from '../../../../core/utils/transaction-date.utils';
import { RecurringCadence } from '../../../../core/utils/recurring-pattern.utils';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { InsightTransactionListComponent } from './insight-transaction-list.component';

/** Which metric each kind features, and the label it goes under. */
const HEADLINE: Partial<Record<InsightKind, { metric: string; labelKey: string }>> = {
  recurringPortfolio: { metric: 'totalMonthlyEquivalent', labelKey: 'insights.perMonth' },
  recurringItem: { metric: 'monthlyEquivalent', labelKey: 'insights.perMonth' },
  categoryTrend: { metric: 'secondHalfMean', labelKey: 'insights.recentMonthlyAverage' },
  habitWeekdayWeekend: { metric: 'weekendDailyAverage', labelKey: 'insights.perWeekendDay' },
  habitMonthEnd: { metric: 'tailDailyAverage', labelKey: 'insights.perDayAtMonthEnd' },
  habitPayday: { metric: 'postPaydayDailyAverage', labelKey: 'insights.perDayAfterPayday' },
  smallDrip: { metric: 'total', labelKey: 'insights.smallTotal' },
};

const ICONS: Partial<Record<InsightKind, string>> = {
  recurringPortfolio: 'autorenew',
  recurringItem: 'trending_up',
  categoryTrend: 'show_chart',
  habitWeekdayWeekend: 'weekend',
  habitMonthEnd: 'event_busy',
  habitPayday: 'payments',
  smallDrip: 'water_drop',
};

/**
 * One insight, rendered from a card.
 *
 * Switches on `kind` but always falls back to a generic title-and-metrics
 * rendering, because a snapshot written by a newer build can carry a kind this
 * version has never heard of. Never blank, never a crash.
 *
 * Money is read out of `metrics` and formatted here rather than being
 * interpolated into the body string, so a stored card is not frozen to the
 * locale or base currency it was computed under.
 */
@Component({
  selector: 'app-insight-card',
  standalone: true,
  imports: [
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    StatCardComponent,
    TranslatePipe,
    InsightTransactionListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insight-card.component.html',
  styleUrl: './insight-card.component.scss',
})
export class InsightCardComponent {
  private categoryService = inject(CategoryService);
  private translation = inject(TranslationService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);

  card = input.required<InsightCard>();
  currency = input.required<string>();
  lookup = input<Map<string, Transaction>>(new Map());
  /** Frozen snapshots have no live rows, so the inline list is suppressed. */
  archived = input(false);

  readonly showRows = signal(false);

  readonly icon = computed(() => ICONS[this.card().kind] ?? 'lightbulb');

  /** True when this build does not know the kind — render the generic form. */
  readonly isUnknownKind = computed(() => !(this.card().kind in ICONS));

  readonly title = computed(() => this.translation.t(this.card().titleKey));

  /**
   * Body text with the values the card deliberately did not store: the category
   * name and the cadence word, both locale-dependent.
   */
  readonly body = computed(() => {
    const card = this.card();
    const params: Record<string, string | number> = { ...card.params };

    const categoryId = card.categoryIds[0];
    if (categoryId) {
      params['category'] = this.categoryName(categoryId);
    }
    const cadence = card.params['cadence'];
    if (typeof cadence === 'string') {
      params['cadence'] = this.translation.t(cadenceKey(cadence as RecurringCadence));
    }
    return this.translation.t(card.bodyKey, params);
  });

  readonly headline = computed(() => {
    const card = this.card();
    const slot = HEADLINE[card.kind];
    const value = slot ? card.metrics[slot.metric] : null;
    return slot && value !== null && value !== undefined
      ? { label: this.translation.t(slot.labelKey), value }
      : null;
  });

  /** Metric entries for the generic fallback rendering. */
  readonly metricEntries = computed(() =>
    Object.entries(this.card().metrics)
      .filter((entry): entry is [string, number] => entry[1] !== null));

  readonly categoryNames = computed(
    () => this.card().categoryIds.map(id => this.categoryName(id)));

  readonly canOpenFilters = computed(() => this.card().drillDown.mode === 'filters');

  readonly inlineIds = computed<string[]>(() => {
    const drillDown = this.card().drillDown;
    return drillDown.mode === 'inline' ? drillDown.transactionIds : [];
  });

  readonly inlineTruncated = computed(() => {
    const drillDown = this.card().drillDown;
    return drillDown.mode === 'inline' ? drillDown.truncated : false;
  });

  readonly canShowRows = computed(() => !this.archived() && this.inlineIds().length > 0);

  toggleRows(): void {
    this.showRows.update(shown => !shown);
  }

  /**
   * Hand the filter set to the Transactions page and navigate.
   *
   * PendingFiltersService is a hand-off channel, not a navigator, so the caller
   * navigates — and the page picks the filters up whether it was already open or
   * is created by this navigation.
   */
  openFilters(): void {
    const drillDown = this.card().drillDown;
    if (drillDown.mode !== 'filters') {
      return;
    }
    this.pendingFilters.apply(this.toLiveFilters(drillDown.filters));
    void this.router.navigate(['/transactions']);
  }

  /**
   * Stored day keys back to Dates, which is what the filter surface expects.
   * Day keys are local calendar days, so they must revive as local midnight —
   * `new Date(string)` would read them as UTC and skew the window by the zone
   * offset, dropping its whole last day west of UTC. The constructor stays as
   * the fallback for any legacy snapshot holding a full ISO instant.
   */
  private toLiveFilters(filters: SerializableFilters): TransactionFilters {
    const live: TransactionFilters = {};
    if (filters.type !== undefined) live.type = filters.type;
    if (filters.categoryId !== undefined) live.categoryId = filters.categoryId;
    if (filters.startDate !== undefined) {
      live.startDate = parseDayKey(filters.startDate) ?? new Date(filters.startDate);
    }
    if (filters.endDate !== undefined) {
      live.endDate = parseDayKey(filters.endDate) ?? new Date(filters.endDate);
    }
    if (filters.minAmount !== undefined) live.minAmount = filters.minAmount;
    if (filters.maxAmount !== undefined) live.maxAmount = filters.maxAmount;
    if (filters.currency !== undefined) live.currency = filters.currency;
    return live;
  }

  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(item => item.id === categoryId);
    return category?.name ? this.translation.t(category.name) : categoryId;
  }
}
