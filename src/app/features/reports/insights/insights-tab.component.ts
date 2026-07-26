import { Component, OnInit, computed, effect, inject, input, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { InsightsService } from '../../../core/services/insights.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DEFAULT_HABIT_RHYTHM_OPTIONS } from '../../../core/utils/habit-rhythm.utils';
import { DEFAULT_CATEGORY_TREND_OPTIONS } from '../../../core/utils/category-trend.utils';
import { parseMonthKey } from '../../../core/utils/transaction-date.utils';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import {
  PeriodSelection,
} from '../../../shared/components/period-selector/period-selector.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { InsightCardComponent } from './insight-card/insight-card.component';
import { RecurringListComponent } from './recurring-list/recurring-list.component';

/**
 * The Insights tab: rule-based spending patterns over a trailing window.
 *
 * Provides InsightsService itself so the six-month Firestore listener is scoped
 * to this tab. The parent wraps it in `<ng-template matTabContent>`, so the
 * listener only opens once the tab is actually visited.
 *
 * Deliberately takes the period selection rather than a transaction list. The
 * other three tabs render from the page's shared `transactions` signal, but
 * insights need a trailing window that is usually wider than the selected
 * period, and reusing that signal would both tie them to the wrong range and
 * re-run every detector on any edit.
 */
@Component({
  selector: 'app-insights-tab',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    EmptyStateComponent,
    LoadingSpinnerComponent,
    TranslatePipe,
    InsightCardComponent,
    RecurringListComponent,
  ],
  providers: [InsightsService],
  templateUrl: './insights-tab.component.html',
  styleUrl: './insights-tab.component.scss',
})
export class InsightsTabComponent implements OnInit {
  private insights = inject(InsightsService);
  private translation = inject(TranslationService);

  period = input.required<PeriodSelection>();
  currency = input.required<string>();

  readonly isLoading = this.insights.isLoading;
  readonly hasFailed = this.insights.hasFailed;
  readonly cards = this.insights.cards;
  readonly facts = this.insights.facts;
  readonly drillDownIds = this.insights.drillDownIds;
  readonly lookup = this.insights.transactionLookup;
  readonly transactionCount = this.insights.windowTransactionCount;
  readonly isOfflineWithoutData = this.insights.isOfflineWithoutData;

  constructor() {
    // Reload when the page's period selector moves. untracked keeps the read of
    // the service out of the dependency set, so this fires on the input only.
    effect(() => {
      const period = this.period();
      untracked(() => this.insights.load(period));
    });
  }

  ngOnInit(): void {
    this.insights.load(this.period());
  }

  /** "Feb – Jul 2026", so the trailing window is never mistaken for a bug. */
  readonly windowLabel = computed(() => {
    const months = this.insights.window()?.months ?? [];
    if (months.length === 0) {
      return '';
    }
    const locale = this.translation.getIntlLocale();
    const format = (key: string): string => {
      const parsed = parseMonthKey(key);
      return parsed
        ? new Date(parsed.year, parsed.month, 1).toLocaleDateString(
          locale, { month: 'short', year: 'numeric' })
        : key;
    };
    return months.length === 1
      ? format(months[0])
      : `${format(months[0])} – ${format(months[months.length - 1])}`;
  });

  readonly hasCards = computed(() => this.cards().length > 0);

  readonly recurringSummary = computed(() => {
    const summary = this.facts()?.recurring;
    return summary && summary.groups.length > 0 ? summary : null;
  });

  /**
   * What the detectors are still short of.
   *
   * Every detector has a data gate, so a young account legitimately produces no
   * cards at all. Without naming the gaps the tab would just look broken.
   */
  readonly missingRequirements = computed<string[]>(() => {
    const facts = this.facts();
    if (!facts) {
      return [];
    }
    const needed: string[] = [];

    const months = facts.window.months.length;
    if (months < DEFAULT_CATEGORY_TREND_OPTIONS.minMonths) {
      needed.push(this.translation.t('insights.needMonths', {
        needed: DEFAULT_CATEGORY_TREND_OPTIONS.minMonths,
        have: months,
      }));
    }

    const expenses = facts.totals.count;
    if (expenses < DEFAULT_HABIT_RHYTHM_OPTIONS.minTransactions) {
      needed.push(this.translation.t('insights.needTransactions', {
        needed: DEFAULT_HABIT_RHYTHM_OPTIONS.minTransactions,
        have: expenses,
      }));
    }

    return needed;
  });

  refresh(): void {
    this.insights.refresh(this.period());
  }
}
