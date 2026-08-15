import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { InsightsService } from '../../../core/services/insights.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RecurringService } from '../../../core/services/recurring.service';
import { TranslationService } from '../../../core/services/translation.service';
import { InsightCard, InsightSnapshot, SnapshotStaleness } from '../../../models';
import { sortInsightCards } from '../../../core/utils/insight-card.utils';
import {
  ConfirmDialogComponent,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnapshotTimelineComponent } from './snapshot-timeline/snapshot-timeline.component';
import { SnapshotCompareComponent } from './snapshot-compare/snapshot-compare.component';
import { InsightNarrativeComponent } from './insight-narrative/insight-narrative.component';
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
    MatExpansionModule,
    MatIconModule,
    EmptyStateComponent,
    LoadingSpinnerComponent,
    TranslatePipe,
    InsightCardComponent,
    RecurringListComponent,
    SnapshotTimelineComponent,
    SnapshotCompareComponent,
    InsightNarrativeComponent,
  ],
  providers: [InsightsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights-tab.component.html',
  styleUrl: './insights-tab.component.scss',
})
export class InsightsTabComponent implements OnInit {
  private insights = inject(InsightsService);
  private snapshots = inject(InsightSnapshotService);
  private translation = inject(TranslationService);
  private notifications = inject(NotificationService);
  private recurringService = inject(RecurringService);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  period = input.required<PeriodSelection>();
  currency = input.required<string>();

  readonly isLoading = this.insights.isLoading;
  readonly hasFailed = this.insights.hasFailed;
  readonly liveCards = this.insights.cards;
  readonly facts = this.insights.facts;
  readonly drillDownIds = this.insights.drillDownIds;
  readonly lookup = this.insights.transactionLookup;
  readonly transactionCount = this.insights.windowTransactionCount;
  readonly isOfflineWithoutData = this.insights.isOfflineWithoutData;

  readonly storedSnapshots = this.snapshots.snapshots;
  readonly isRegenerating = signal(false);

  /** Which stored month is open, or null for the live computation. */
  readonly viewedMonth = signal<string | null>(null);
  readonly staleness = signal<SnapshotStaleness | null>(null);

  readonly viewedSnapshot = computed<InsightSnapshot | null>(() => {
    const month = this.viewedMonth();
    return month ? this.snapshots.get(month) : null;
  });

  readonly isViewingArchive = computed(() => this.viewedSnapshot() !== null);

  /**
   * Cards for whatever is on screen.
   *
   * A stored month renders its own frozen cards rather than re-running any
   * detector, which is what keeps old history readable as the detectors change.
   */
  readonly cards = computed<InsightCard[]>(() => {
    const snapshot = this.viewedSnapshot();
    return snapshot ? sortInsightCards(snapshot.cards) : this.liveCards();
  });

  /** A frozen month is shown in the currency it was computed in, not today's. */
  readonly displayCurrency = computed(
    () => this.viewedSnapshot()?.fingerprint.baseCurrency ?? this.currency());

  readonly archivedRecurring = computed(
    () => this.viewedSnapshot()?.facts?.recurring ?? null);

  /**
   * The newest stored month's facts, so the narrative can skip a request when
   * nothing has moved materially since then.
   */
  readonly previousMonthFacts = computed(
    () => this.storedSnapshots()[0]?.facts ?? null);

  constructor() {
    // Reload when the page's period selector moves. untracked keeps the read of
    // the service out of the dependency set, so this fires on the input only.
    effect(() => {
      const period = this.period();
      untracked(() => this.insights.load(period));
    });
  }

  ngOnInit(): void {
    // The constructor effect above performs the initial load once inputs are
    // bound; loading here as well opened a second six-month listener on every
    // first render.
    this.snapshots.watch().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    // Keeps InsightsService's coverage input fresh: a conversion (or a rule
    // added anywhere else) recomputes the facts, so the covered group leaves
    // the figures and the list together. Never completes, so its lifetime is
    // the tab's.
    this.recurringService.getRecurring().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    // Also triggered from the dashboard; the service shares one in-flight run,
    // so this only matters for someone deep-linking straight to Reports, who
    // would otherwise be a session behind on history.
    this.snapshots.generateClosedMonths().catch(() => {
      // Non-fatal: the live tab does not depend on stored history.
    });
  }

  /**
   * Open a stored month, or return to the live computation.
   *
   * Staleness is resolved only for the month actually opened. Fingerprinting
   * every stored month up front would mean a query per month for information
   * nobody has asked for.
   */
  onMonthSelected(monthKey: string | null): void {
    this.viewedMonth.set(monthKey);
    this.staleness.set(null);
    if (!monthKey) {
      return;
    }
    this.snapshots.staleness(monthKey)
      .then(result => {
        // Ignore a result that arrived after the user moved on.
        if (this.viewedMonth() === monthKey) {
          this.staleness.set(result);
        }
      })
      .catch(() => this.staleness.set(null));
  }

  /**
   * Recompute a stored month with the current detectors.
   *
   * Confirmed first: it overwrites a point-in-time record, and the numbers a
   * user remembers seeing will change.
   */
  onRegenerate(monthKey: string): void {
    const dialog = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translation.t('insights.regenerateTitle'),
        message: this.translation.t('insights.regenerateMessage'),
        confirmLabel: this.translation.t('insights.regenerate'),
        confirmColor: 'warn' as const,
        icon: 'refresh',
      },
    });

    dialog.afterClosed().subscribe(async confirmed => {
      if (!confirmed) {
        return;
      }
      this.isRegenerating.set(true);
      try {
        await this.snapshots.regenerate(monthKey);
        this.staleness.set(await this.snapshots.staleness(monthKey));
        // Already translated, per the notification service's contract.
        this.notifications.success(this.translation.t('insights.snapshotRegenerated'));
      } catch {
        this.notifications.error(this.translation.t('insights.regenerateFailed'));
      } finally {
        this.isRegenerating.set(false);
      }
    });
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
