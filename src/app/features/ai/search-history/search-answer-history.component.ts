import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  recordToAnswer,
  recordToFilters,
  recordToIntent,
} from '../../../core/utils/search-answer.utils';
import {
  SearchRecord,
  TransactionFilters,
  isAnswerRecord,
} from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { NlAnswerCardComponent } from '../../../shared/components/nl-answer-card/nl-answer-card.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Every stored smart-search answer, newest first — the "see all" behind the
 * dialog's five-record preview. A row expands into the shared answer card:
 * the snapshot as computed, labeled with its computed-at date, with a
 * token-free local refresh and a confirmed delete.
 */
@Component({
  selector: 'app-search-answer-history',
  standalone: true,
  imports: [
    EmptyStateComponent,
    MatButtonModule,
    MatIconModule,
    NlAnswerCardComponent,
    PageHeaderComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-answer-history.component.html',
  styleUrl: './search-answer-history.component.scss',
})
export class SearchAnswerHistoryComponent implements OnInit, OnDestroy {
  private nlSearch = inject(NlSearchService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private matDialog = inject(MatDialog);
  private analytics = inject(AnalyticsService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private dateFormatService = inject(DateFormatService);
  history = inject(SearchAnswerHistoryService);

  isRefreshing = signal(false);
  private expandedId = signal<string | null>(null);
  private subscription?: Subscription;

  // Read live from the subscription: a record deleted elsewhere collapses
  // instead of lingering as stale data.
  expandedRecord = computed(() =>
    this.history.answers().find(r => r.id === this.expandedId()) ?? null);
  expandedAnswer = computed(() => {
    const record = this.expandedRecord();
    return record && isAnswerRecord(record) ? recordToAnswer(record) : null;
  });
  expandedComputedAt = computed(() => this.expandedRecord()?.computedAt.toDate() ?? null);

  ngOnInit(): void {
    this.subscription = this.history.loadAnswers().subscribe();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Open a record. An aggregate expands into its stored card; a filter has no
   * figures to show, so it goes straight to the transactions it describes —
   * applying the scope is what the interpretation meant in the first place.
   */
  toggle(record: SearchRecord): void {
    if (!isAnswerRecord(record)) {
      void this.history.touch(record.id);
      this.analytics.trackSearchHistoryUsed({ action: 'apply' });
      this.viewTransactions(recordToFilters(record));
      return;
    }
    // Collapsing is not a use of the record, so it reports nothing.
    if (this.expandedId() === record.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(record.id);
    void this.history.touch(record.id);
    this.analytics.trackSearchHistoryUsed({ action: 'reopen' });
  }

  isExpanded(record: SearchRecord): boolean {
    return this.expandedId() === record.id;
  }

  isAnswer(record: SearchRecord): boolean {
    return isAnswerRecord(record);
  }

  /** Recompute the expanded snapshot locally from its stored scope — no model call. */
  async refreshExpanded(): Promise<void> {
    const record = this.expandedRecord();
    if (!record || this.isRefreshing()) return;

    if (!isAnswerRecord(record)) return;

    this.isRefreshing.set(true);
    try {
      const intent = recordToIntent(record);
      const fresh = await this.nlSearch.replayAggregate(intent.operation, intent.filters, intent.limit);
      await this.history.refreshAnswer(record.id, fresh);
      // Past the recomputation, so the event counts what happened.
      this.analytics.trackSearchHistoryUsed({ action: 'refresh' });
    } finally {
      this.isRefreshing.set(false);
    }
  }

  togglePin(record: SearchRecord): void {
    void this.history.togglePin(record.id, !record.pinned);
  }

  deleteRecord(record: SearchRecord): void {
    const confirmRef = this.matDialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translationService.t('aiSearch.historyDeleteTitle'),
        message: this.translationService.t('aiSearch.historyDeleteMessage'),
        confirmLabel: this.translationService.t('common.delete'),
        confirmColor: 'warn',
      },
    });
    confirmRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        void this.history.deleteAnswer(record.id);
      }
    });
  }

  viewTransactions(scope: TransactionFilters): void {
    this.pendingFilters.apply(scope);
    void this.router.navigate(['/transactions']);
  }

  /** The figures line under a stored answer. Filter records have none. */
  recordValueLabel(record: SearchRecord): string {
    if (!isAnswerRecord(record)) return '';
    if (record.operation === 'count') {
      return `${record.value}`;
    }
    return record.currency
      ? this.currencyService.formatCurrency(record.value, record.currency)
      : `${record.value}`;
  }

  recordDateLabel(record: SearchRecord): string {
    return this.dateFormatService.formatDate(record.computedAt.toDate());
  }

  emptyTitle(): string {
    return this.translationService.t('aiSearch.historyEmpty');
  }

  emptyHint(): string {
    return this.translationService.t('aiSearch.historyEmptyHint');
  }
}
