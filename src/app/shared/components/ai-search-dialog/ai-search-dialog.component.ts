import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { TranslationService } from '../../../core/services/translation.service';
import { isImeComposition } from '../../../core/utils/keyboard.utils';
import {
  recordToAnswer,
  recordToFilters,
  recordToIntent,
} from '../../../core/utils/search-answer.utils';
import {
  NlSearchResult,
  SearchRecord,
  TransactionFilters,
  isAnswerRecord,
} from '../../../models';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { NlAnswerCardComponent } from '../nl-answer-card/nl-answer-card.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Global natural-language search dialog, opened from the app header.
 * Filter interpretations are shown for confirmation before they are
 * applied; aggregate answers are computed locally from real transaction
 * data by NlSearchService.
 */
@Component({
  selector: 'app-ai-search-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    NlAnswerCardComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-search-dialog.component.html',
  styleUrl: './ai-search-dialog.component.scss',
})
export class AiSearchDialogComponent implements OnInit, OnDestroy {
  private nlSearch = inject(NlSearchService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private dialogRef = inject(MatDialogRef<AiSearchDialogComponent>);
  private matDialog = inject(MatDialog);
  private analytics = inject(AnalyticsService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private dateFormatService = inject(DateFormatService);
  private answerHistory = inject(SearchAnswerHistoryService);

  query = '';
  isLoading = signal(false);
  isRefreshing = signal(false);
  private result = signal<NlSearchResult | null>(null);
  private openedRecordId = signal<string | null>(null);
  private historySubscription?: Subscription;

  filterResult = computed(() => {
    const r = this.result();
    return r?.kind === 'filter' ? r : null;
  });
  answerResult = computed(() => {
    const r = this.result();
    return r?.kind === 'answer' ? r.answer : null;
  });
  fallbackResult = computed(() => {
    const r = this.result();
    return r?.kind === 'keywordFallback' ? r : null;
  });

  historyPreview = computed(() => this.answerHistory.answers().slice(0, 5));
  // The find survives deletion and refresh: the record is always read live
  // from the subscription, so a deleted record simply closes the snapshot.
  openedRecord = computed(() =>
    this.answerHistory.answers().find(r => r.id === this.openedRecordId()) ?? null);
  snapshotAnswer = computed(() => {
    const record = this.openedRecord();
    return record && isAnswerRecord(record) ? recordToAnswer(record) : null;
  });
  openedComputedAt = computed(() => this.openedRecord()?.computedAt.toDate() ?? null);
  showHistory = computed(() =>
    !this.isLoading()
    && !this.result()
    && !this.openedRecord()
    && this.historyPreview().length > 0);

  ngOnInit(): void {
    this.historySubscription = this.answerHistory.loadAnswers().subscribe();
  }

  ngOnDestroy(): void {
    this.historySubscription?.unsubscribe();
  }

  async submit(): Promise<void> {
    const query = this.query.trim();
    if (!query || this.isLoading()) return;

    this.isLoading.set(true);
    this.result.set(null);
    this.openedRecordId.set(null);
    try {
      this.result.set(await this.nlSearch.search(query));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Open a record. An aggregate reopens its stored card in place; a filter
   * has no figures to show, so it applies its scope and leaves for the
   * transactions list, which is what the interpretation meant.
   */
  openRecord(record: SearchRecord): void {
    void this.answerHistory.touch(record.id);
    if (!isAnswerRecord(record)) {
      this.analytics.trackSearchHistoryUsed({ action: 'apply' });
      this.applyFilters(recordToFilters(record));
      return;
    }
    this.result.set(null);
    this.openedRecordId.set(record.id);
    this.analytics.trackSearchHistoryUsed({ action: 'reopen' });
  }

  isAnswer(record: SearchRecord): boolean {
    return isAnswerRecord(record);
  }

  closeSnapshot(): void {
    this.openedRecordId.set(null);
  }

  /** Recompute the opened snapshot locally from its stored scope — no model call. */
  async refreshOpened(): Promise<void> {
    const record = this.openedRecord();
    if (!record || !isAnswerRecord(record) || this.isRefreshing()) return;

    this.isRefreshing.set(true);
    try {
      const intent = recordToIntent(record);
      const fresh = await this.nlSearch.replayAggregate(intent.operation, intent.filters, intent.limit);
      await this.answerHistory.refreshAnswer(record.id, fresh);
      // Past the recomputation, so the event counts what happened.
      this.analytics.trackSearchHistoryUsed({ action: 'refresh' });
    } finally {
      this.isRefreshing.set(false);
    }
  }

  togglePin(record: SearchRecord): void {
    void this.answerHistory.togglePin(record.id, !record.pinned);
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
        void this.answerHistory.deleteAnswer(record.id);
      }
    });
  }

  seeAllHistory(): void {
    this.dialogRef.close();
    void this.router.navigate(['/search-history']);
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

  onEnter(event: Event): void {
    if (isImeComposition(event)) return;
    void this.submit();
  }

  applyFilters(filters: TransactionFilters): void {
    this.pendingFilters.apply(filters);
    void this.router.navigate(['/transactions']);
    this.dialogRef.close();
  }

  /** Human-readable summary chips for an interpreted filter set. */
  describeFilters(filters: TransactionFilters): string[] {
    const parts: string[] = [];
    if (filters.type) {
      parts.push(this.translationService.t(
        filters.type === 'expense' ? 'common.expense' : 'common.income'));
    }
    if (filters.categoryId) {
      parts.push(this.categoryName(filters.categoryId));
    }
    if (filters.startDate || filters.endDate) {
      parts.push(this.periodLabel(filters));
    }
    if (filters.minAmount !== undefined) {
      parts.push(`≥ ${filters.minAmount}`);
    }
    if (filters.maxAmount !== undefined) {
      parts.push(`≤ ${filters.maxAmount}`);
    }
    if (filters.currency) {
      parts.push(filters.currency);
    }
    if (filters.searchQuery) {
      parts.push(`"${filters.searchQuery}"`);
    }
    return parts;
  }

  periodLabel(filters: TransactionFilters): string {
    const start = filters.startDate ? this.dateFormatService.formatDate(filters.startDate) : '…';
    const end = filters.endDate ? this.dateFormatService.formatDate(filters.endDate) : '…';
    return `${start} – ${end}`;
  }

  categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Other';
  }

  fallbackNoticeKey(reason: 'offline' | 'noProvider' | 'error'): string {
    switch (reason) {
      case 'offline': return 'aiSearch.offlineFallback';
      case 'noProvider': return 'aiSearch.noProviderFallback';
      case 'error': return 'aiSearch.errorFallback';
    }
  }
}
