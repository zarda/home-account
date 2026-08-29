import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of, EMPTY } from 'rxjs';
import { SearchAnswerHistoryComponent } from './search-answer-history.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SEARCH_ANSWER_SCHEMA_VERSION, SearchAnswerRecord } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';
import { createCategory } from '../../../core/services/testing/test-data';

describe('SearchAnswerHistoryComponent', () => {
  let fixture: ComponentFixture<SearchAnswerHistoryComponent>;
  let storedAnswers: WritableSignal<SearchAnswerRecord[]>;
  let answerHistory: {
    answers: WritableSignal<SearchAnswerRecord[]>;
    loadAnswers: jasmine.Spy;
    touch: jasmine.Spy;
    refreshAnswer: jasmine.Spy;
    deleteAnswer: jasmine.Spy;
  };
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let nlSearch: jasmine.SpyObj<NlSearchService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let notifications: jasmine.SpyObj<NotificationService>;

  const rec = (
    id: string,
    millis: number,
    overrides: Partial<Omit<SearchAnswerRecord, 'kind'>> = {},
  ): SearchAnswerRecord => ({
    id,
    userId: 'user123',
    schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
    kind: 'aggregate',
    query: `question ${id}`,
    operation: 'sum',
    limit: 3,
    scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
    baseCurrency: 'USD',
    value: 421.5,
    currency: 'USD',
    transactionCount: 17,
    computedAt: Timestamp.fromMillis(millis),
    lastUsedAt: Timestamp.fromMillis(millis),
    ...overrides,
  });

  beforeEach(async () => {
    storedAnswers = signal<SearchAnswerRecord[]>([]);
    answerHistory = {
      answers: storedAnswers,
      loadAnswers: jasmine.createSpy('loadAnswers').and.returnValue(of([])),
      touch: jasmine.createSpy('touch').and.resolveTo(),
      refreshAnswer: jasmine.createSpy('refreshAnswer').and.resolveTo(),
      deleteAnswer: jasmine.createSpy('deleteAnswer').and.resolveTo(),
    };
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackSearchHistoryUsed']);
    nlSearch = jasmine.createSpyObj('NlSearchService', ['replayAggregate']);
    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    router.navigate.and.resolveTo(true);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'info', 'error']);
    matDialog.open.and.returnValue({
      afterClosed: () => of(true),
    } as MatDialogRef<unknown>);

    const categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
    ]);
    const currencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currencyService.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount.toFixed(2)}`);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    const dateFormatService = jasmine.createSpyObj('DateFormatService', ['formatDate']);
    dateFormatService.formatDate.and.callFake((d: Date) => dayKey(d));

    await TestBed.configureTestingModule({
      imports: [SearchAnswerHistoryComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: SearchAnswerHistoryService, useValue: answerHistory },
        { provide: NlSearchService, useValue: nlSearch },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: matDialog },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: DateFormatService, useValue: dateFormatService },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchAnswerHistoryComponent);
    fixture.detectChanges();
  });

  it('lists every stored answer with its question and figure', () => {
    storedAnswers.set([rec('a-1', 2_000), rec('a-2', 1_000)]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.history-row');
    expect(rows.length).toBe(2);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('question a-1');
    expect(text).toContain('question a-2');
    expect(text).toContain('USD 421.50');
  });

  it('shows the empty state when nothing is stored', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('aiSearch.historyEmpty');
    expect(fixture.nativeElement.querySelectorAll('.history-row').length).toBe(0);
  });

  it('expanding a row shows the stored snapshot with its computed-at label and touches recency', () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(answerHistory.touch).toHaveBeenCalledWith('a-1');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('aiSearch.historyComputedAt');
    expect(fixture.nativeElement.querySelector('app-nl-answer-card')).toBeTruthy();
  });

  it('refresh replays the stored intent locally and persists the fresh figures', async () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    const fresh = {
      operation: 'sum' as const,
      value: 500,
      currency: 'USD',
      transactionCount: 21,
      scope: {},
    };
    nlSearch.replayAggregate.and.resolveTo(fresh);

    (fixture.nativeElement.querySelector('.history-refresh') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(nlSearch.replayAggregate).toHaveBeenCalledWith(
      'sum',
      jasmine.objectContaining({ startDate: jasmine.any(Date), endDate: jasmine.any(Date) }),
      3,
    );
    expect(answerHistory.refreshAnswer).toHaveBeenCalledWith('a-1', fresh);
  });

  // A refresh whose figures happen to come back unchanged is otherwise
  // indistinguishable from a button that did nothing at all.
  it('confirms a completed refresh', async () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();
    nlSearch.replayAggregate.and.resolveTo({
      operation: 'sum' as const, value: 500, currency: 'USD', transactionCount: 21, scope: {},
    });

    (fixture.nativeElement.querySelector('.history-refresh') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(notifications.success).toHaveBeenCalledWith('aiSearch.historyRefreshed');
    expect(notifications.error).not.toHaveBeenCalled();
  });

  // Both legs used to reject into nothing: the spinner cleared and the user
  // was told neither that it worked nor that it had not.
  it('reports a failed replay and releases the button', async () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();
    nlSearch.replayAggregate.and.rejectWith(new Error('firestore down'));

    (fixture.nativeElement.querySelector('.history-refresh') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(notifications.error).toHaveBeenCalledWith('aiSearch.historyRefreshFailed');
    expect(notifications.success).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isRefreshing()).toBeFalse();
  });

  it('reports a rejected write, and does not claim the answer was updated', async () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();
    nlSearch.replayAggregate.and.resolveTo({
      operation: 'sum' as const, value: 500, currency: 'USD', transactionCount: 21, scope: {},
    });
    answerHistory.refreshAnswer.and.rejectWith(new Error('permission-denied'));

    (fixture.nativeElement.querySelector('.history-refresh') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(notifications.error).toHaveBeenCalledWith('aiSearch.historyRefreshFailed');
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it('deleting a record asks for confirmation first', async () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.history-delete') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(matDialog.open).toHaveBeenCalled();
    expect(answerHistory.deleteAnswer).toHaveBeenCalledWith('a-1');
  });

  it('view-transactions hands the stored scope to the pending channel and navigates', () => {
    storedAnswers.set([rec('a-1', 2_000)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cardButton = fixture.nativeElement.querySelector(
      'app-nl-answer-card button') as HTMLButtonElement;
    cardButton.click();

    expect(pendingFilters.apply).toHaveBeenCalledWith(jasmine.objectContaining({
      startDate: jasmine.any(Date),
      endDate: jasmine.any(Date),
    }));
    expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
  });

  describe('filter records', () => {
    const filterRec = (id: string, millis: number) =>
      ({ ...rec(id, millis), kind: 'filter', query: 'coffee last month' }) as never;

    // No figures were stored, so there is nothing to expand into: applying the
    // scope is what the interpretation meant in the first place.
    it('opening one applies its scope and leaves for the transactions list', () => {
      storedAnswers.set([filterRec('f-1', 1_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

      expect(pendingFilters.apply).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
    });

    it('reports the replay so the tokens it saved are measurable', () => {
      storedAnswers.set([filterRec('f-1', 1_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

      expect(analytics.trackSearchHistoryUsed).toHaveBeenCalledWith({ action: 'apply' });
    });

    it('shows a filter label where an answer would show its figure', () => {
      storedAnswers.set([filterRec('f-1', 1_000)]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('aiSearch.historyFilterRecord');
      expect(text).not.toContain('USD 421.50');
    });

    it('offers no refresh, because nothing was snapshotted', () => {
      storedAnswers.set([filterRec('f-1', 1_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.history-refresh')).toBeNull();
    });
  });

  describe('search_history_used', () => {
    it('reports a reopen when a stored answer is expanded', () => {
      storedAnswers.set([rec('a-1', 2_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

      expect(analytics.trackSearchHistoryUsed).toHaveBeenCalledWith({ action: 'reopen' });
    });

    // Putting a record away is not a use of it.
    it('reports nothing when the row is collapsed again', () => {
      storedAnswers.set([rec('a-1', 2_000)]);
      fixture.detectChanges();
      const open = fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement;

      open.click();
      fixture.detectChanges();
      analytics.trackSearchHistoryUsed.calls.reset();
      open.click();

      expect(analytics.trackSearchHistoryUsed).not.toHaveBeenCalled();
    });

    it('reports a refresh only once the figures have actually been rewritten', async () => {
      storedAnswers.set([rec('a-1', 2_000)]);
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
      fixture.detectChanges();
      analytics.trackSearchHistoryUsed.calls.reset();

      await fixture.componentInstance.refreshExpanded();

      expect(answerHistory.refreshAnswer).toHaveBeenCalled();
      expect(analytics.trackSearchHistoryUsed).toHaveBeenCalledWith({ action: 'refresh' });
    });
  });
});
