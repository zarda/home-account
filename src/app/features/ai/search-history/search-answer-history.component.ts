import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { TranslationService } from '../../../core/services/translation.service';
import { recordToAnswer, recordToIntent } from '../../../core/utils/search-answer.utils';
import { SearchAnswerRecord, TransactionFilters } from '../../../models';
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
  templateUrl: './search-answer-history.component.html',
  styleUrl: './search-answer-history.component.scss',
})
export class SearchAnswerHistoryComponent implements OnInit, OnDestroy {
  private nlSearch = inject(NlSearchService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private matDialog = inject(MatDialog);
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
    return record ? recordToAnswer(record) : null;
  });
  expandedComputedAt = computed(() => this.expandedRecord()?.computedAt.toDate() ?? null);

  ngOnInit(): void {
    this.subscription = this.history.loadAnswers().subscribe();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  toggle(record: SearchAnswerRecord): void {
    if (this.expandedId() === record.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(record.id);
    void this.history.touch(record.id);
  }

  isExpanded(record: SearchAnswerRecord): boolean {
    return this.expandedId() === record.id;
  }

  /** Recompute the expanded snapshot locally from its stored scope — no model call. */
  async refreshExpanded(): Promise<void> {
    const record = this.expandedRecord();
    if (!record || this.isRefreshing()) return;

    this.isRefreshing.set(true);
    try {
      const intent = recordToIntent(record);
      const fresh = await this.nlSearch.replayAggregate(intent.operation, intent.filters, intent.limit);
      await this.history.refreshAnswer(record.id, fresh);
    } finally {
      this.isRefreshing.set(false);
    }
  }

  deleteRecord(record: SearchAnswerRecord): void {
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

  recordValueLabel(record: SearchAnswerRecord): string {
    if (record.operation === 'count') {
      return `${record.value}`;
    }
    return record.currency
      ? this.currencyService.formatCurrency(record.value, record.currency)
      : `${record.value}`;
  }

  recordDateLabel(record: SearchAnswerRecord): string {
    return this.dateFormatService.formatDate(record.computedAt.toDate());
  }

  emptyTitle(): string {
    return this.translationService.t('aiSearch.historyEmpty');
  }

  emptyHint(): string {
    return this.translationService.t('aiSearch.historyEmptyHint');
  }
}
