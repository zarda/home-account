import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { AiSearchDialogComponent } from './ai-search-dialog.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { GoalService } from '../../../core/services/goal.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Goal, NlSearchResult, SEARCH_ANSWER_SCHEMA_VERSION, SearchAnswerRecord } from '../../../models';
import { createCategory, createTransaction } from '../../../core/services/testing/test-data';

describe('AiSearchDialogComponent', () => {
  let fixture: ComponentFixture<AiSearchDialogComponent>;
  let component: AiSearchDialogComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let nlSearch: jasmine.SpyObj<NlSearchService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<AiSearchDialogComponent>>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let storedAnswers: WritableSignal<SearchAnswerRecord[]>;
  let answerHistory: {
    answers: WritableSignal<SearchAnswerRecord[]>;
    loadAnswers: jasmine.Spy;
    touch: jasmine.Spy;
    refreshAnswer: jasmine.Spy;
    deleteAnswer: jasmine.Spy;
  };
  let goalService: { goals: jasmine.Spy; exportAll: jasmine.Spy };

  async function searchWith(result: NlSearchResult): Promise<void> {
    nlSearch.search.and.resolveTo(result);
    component.query = 'some question';
    await component.submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackSearchHistoryUsed']);
    nlSearch = jasmine.createSpyObj('NlSearchService', ['search', 'replayAggregate']);
    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'info', 'error']);
    matDialog.open.and.returnValue({
      afterClosed: () => of(true),
    } as MatDialogRef<unknown>);
    storedAnswers = signal<SearchAnswerRecord[]>([]);
    answerHistory = {
      answers: storedAnswers,
      loadAnswers: jasmine.createSpy('loadAnswers').and.returnValue(of([])),
      touch: jasmine.createSpy('touch').and.resolveTo(),
      refreshAnswer: jasmine.createSpy('refreshAnswer').and.resolveTo(),
      deleteAnswer: jasmine.createSpy('deleteAnswer').and.resolveTo(),
    };
    // Cold by default, as on a page that never subscribed to goals; the
    // goal-chip suite warms the signal or resolves the fallback per test.
    goalService = {
      goals: jasmine.createSpy('goals').and.returnValue([]),
      exportAll: jasmine.createSpy('exportAll').and.resolveTo([]),
    };

    const categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    ]);
    const currencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currencyService.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount.toFixed(2)}`);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    // Keys the assertions care about resolve to text; everything else echoes,
    // as the real t() does on a miss. Reverting describeFilters to the phantom
    // transactions.* keys therefore fails the chip assertion below — the map
    // has no entry for them, so the chip would render the raw key.
    const translations: Record<string, string> = {
      'common.expense': 'Expense',
      'common.income': 'Income',
    };
    translationService.t.and.callFake((key: string) => translations[key] ?? key);
    const dateFormatService = jasmine.createSpyObj('DateFormatService', ['formatDate']);
    dateFormatService.formatDate.and.callFake((d: Date) => d.toISOString().slice(0, 10));

    await TestBed.configureTestingModule({
      imports: [AiSearchDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: NlSearchService, useValue: nlSearch },
        { provide: NotificationService, useValue: notifications },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: SearchAnswerHistoryService, useValue: answerHistory },
        { provide: CategoryService, useValue: categoryService },
        { provide: GoalService, useValue: goalService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: DateFormatService, useValue: dateFormatService },
      ],
    })
      // The component imports MatDialogModule, whose environment provider for
      // MatDialog shadows a root-level useValue; overrideProvider patches the
      // token in every injector the TestBed creates.
      .overrideProvider(MatDialog, { useValue: matDialog })
      .compileComponents();

    fixture = TestBed.createComponent(AiSearchDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not search with an empty query', async () => {
    component.query = '   ';
    await component.submit();
    expect(nlSearch.search).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is being confirmed', () => {
    nlSearch.search.and.resolveTo({ kind: 'filter', filters: {} });
    component.query = 'コンビニ';
    component.onEnter(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 } as KeyboardEventInit));
    expect(nlSearch.search).not.toHaveBeenCalled();
  });

  describe('filter results', () => {
    it('shows the interpreted filters as chips', async () => {
      await searchWith({
        kind: 'filter',
        filters: {
          type: 'expense',
          categoryId: 'food',
          startDate: new Date(2026, 5, 1),
          endDate: new Date(2026, 5, 30),
          minAmount: 50,
        },
      });

      const chips = Array.from(
        fixture.nativeElement.querySelectorAll('.summary-chip'),
        (el) => (el as HTMLElement).textContent?.trim());
      expect(chips).toContain('Expense');
      expect(chips).toContain('Food & Drinks');
      expect(chips).toContain('≥ 50');
    });

    it('apply hands the filters off and navigates to the transactions page', async () => {
      const filters = { categoryId: 'food' };
      await searchWith({ kind: 'filter', filters });

      (fixture.nativeElement.querySelector('.result-block button') as HTMLButtonElement).click();

      expect(pendingFilters.apply).toHaveBeenCalledWith(filters);
      expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
      expect(dialogRef.close).toHaveBeenCalled();
    });

    describe('goal chips', () => {
      const trip = { id: 'goal-japan', name: 'Japan Trip' } as Goal;

      it('names a matched goal from the warm goals signal', async () => {
        goalService.goals.and.returnValue([trip]);

        await searchWith({ kind: 'filter', filters: { goalId: 'goal-japan' } });

        const chips = Array.from(
          fixture.nativeElement.querySelectorAll('.summary-chip'),
          (el) => (el as HTMLElement).textContent?.trim());
        expect(chips).toEqual(['Japan Trip']);
      });

      it('shows the goal chip beside the other interpreted parts', async () => {
        goalService.goals.and.returnValue([trip]);

        await searchWith({
          kind: 'filter',
          filters: {
            type: 'expense',
            categoryId: 'food',
            goalId: 'goal-japan',
            startDate: new Date(2026, 5, 1),
            endDate: new Date(2026, 5, 30),
          },
        });

        const chips = Array.from(
          fixture.nativeElement.querySelectorAll('.summary-chip'),
          (el) => (el as HTMLElement).textContent?.trim());
        expect(chips).toContain('Japan Trip');
        expect(chips).toContain('Expense');
        expect(chips).toContain('Food & Drinks');
      });

      it('fetches the goals once when the signal is cold, then names the goal', async () => {
        goalService.exportAll.and.resolveTo([trip]);

        await searchWith({ kind: 'filter', filters: { goalId: 'goal-japan' } });
        await fixture.whenStable();
        fixture.detectChanges();

        const chips = Array.from(
          fixture.nativeElement.querySelectorAll('.summary-chip'),
          (el) => (el as HTMLElement).textContent?.trim());
        expect(chips).toEqual(['Japan Trip']);
        expect(goalService.exportAll).toHaveBeenCalledTimes(1);

        // A second interpretation does not pay for a second read.
        await searchWith({ kind: 'filter', filters: { goalId: 'goal-japan' } });
        expect(goalService.exportAll).toHaveBeenCalledTimes(1);
      });

      it('leaves the one-shot read alone while the signal is warm', async () => {
        goalService.goals.and.returnValue([trip]);

        await searchWith({ kind: 'filter', filters: { goalId: 'goal-japan' } });

        expect(goalService.exportAll).not.toHaveBeenCalled();
      });

      it('falls back to the raw id when no loaded goal matches', async () => {
        goalService.goals.and.returnValue([
          { id: 'goal-other', name: 'Emergency Fund' } as Goal,
        ]);

        await searchWith({ kind: 'filter', filters: { goalId: 'goal-gone' } });

        const chips = Array.from(
          fixture.nativeElement.querySelectorAll('.summary-chip'),
          (el) => (el as HTMLElement).textContent?.trim());
        expect(chips).toEqual(['goal-gone']);
      });
    });
  });

  describe('answer results', () => {
    it('renders a computed money answer with the match count', async () => {
      await searchWith({
        kind: 'answer',
        answer: {
          operation: 'sum',
          value: 123.4,
          currency: 'USD',
          transactionCount: 7,
          scope: { startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) },
        },
      });

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('USD 123.40');
      expect(text).toContain('aiSearch.matchCount');
    });

    it('renders top-category groups', async () => {
      await searchWith({
        kind: 'answer',
        answer: {
          operation: 'topCategories',
          value: 80,
          currency: 'USD',
          transactionCount: 4,
          scope: {},
          groups: [
            { categoryId: 'food', total: 80 },
            { categoryId: 'transport', total: 40 },
          ],
        },
      });

      const rows = Array.from(
        fixture.nativeElement.querySelectorAll('.answer-groups li'),
        (el) => (el as HTMLElement).textContent);
      expect(rows.length).toBe(2);
      expect(rows[0]).toContain('Food & Drinks');
      expect(rows[0]).toContain('USD 80.00');
    });

    it('shows an empty state instead of a number when nothing matched', async () => {
      await searchWith({
        kind: 'answer',
        answer: { operation: 'average', value: 0, currency: 'USD', transactionCount: 0, scope: {} },
      });

      expect(fixture.nativeElement.querySelector('.answer-empty')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.answer-value')).toBeNull();
    });

    it('shows the extreme transaction for max answers', async () => {
      await searchWith({
        kind: 'answer',
        answer: {
          operation: 'max',
          value: 90,
          currency: 'USD',
          transactionCount: 3,
          scope: {},
          extremeTransaction: createTransaction({ description: 'Flight home', amount: 90 }),
        },
      });

      expect(fixture.nativeElement.textContent).toContain('Flight home');
    });
  });

  describe('fallback results', () => {
    it('shows the offline notice and an apply-as-keyword button', async () => {
      await searchWith({
        kind: 'keywordFallback',
        filters: { searchQuery: 'coffee' },
        reason: 'offline',
      });

      expect(fixture.nativeElement.textContent).toContain('aiSearch.offlineFallback');
      const button = fixture.nativeElement.querySelector('.fallback button') as HTMLButtonElement;
      button.click();
      expect(pendingFilters.apply).toHaveBeenCalledWith({ searchQuery: 'coffee' });
    });

    it('maps each reason to its notice key', () => {
      expect(component.fallbackNoticeKey('offline')).toBe('aiSearch.offlineFallback');
      expect(component.fallbackNoticeKey('noProvider')).toBe('aiSearch.noProviderFallback');
      expect(component.fallbackNoticeKey('error')).toBe('aiSearch.errorFallback');
    });
  });

  describe('answer history', () => {
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

    it('shows the latest five stored answers with a see-all link when idle', () => {
      storedAnswers.set([1, 2, 3, 4, 5, 6].map(i => rec(`a-${i}`, 1_000_000 - i)));
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.history-row');
      expect(rows.length).toBe(5);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('aiSearch.historyTitle');
      expect(text).toContain('aiSearch.historySeeAll');
      expect(text).toContain('question a-1');
    });

    it('renders no history section when nothing is stored', () => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.history-section')).toBeNull();
    });

    it('reopening shows the stored snapshot and touches recency with no model call', () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(answerHistory.touch).toHaveBeenCalledWith('a-1');
      expect(nlSearch.search).not.toHaveBeenCalled();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('USD 421.50');
      expect(text).toContain('aiSearch.historyComputedAt');
      expect(fixture.nativeElement.querySelector('.history-section')).toBeNull();
    });

    it('refresh replays the stored intent locally and persists the fresh figures', async () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
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
        jasmine.objectContaining({
          startDate: jasmine.any(Date),
          endDate: jasmine.any(Date),
        }),
        3,
      );
      expect(answerHistory.refreshAnswer).toHaveBeenCalledWith('a-1', fresh);
      expect(nlSearch.search).not.toHaveBeenCalled();
      // Unchanged figures would otherwise look like a button that did nothing.
      expect(notifications.success).toHaveBeenCalledWith('aiSearch.historyRefreshed');
    });

    // The rejection used to escape as an unhandled promise while the spinner
    // cleared, so a failed refresh looked exactly like a dead button.
    it('reports a failed refresh and releases the button', async () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
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

    it('deleting a row asks for confirmation first', async () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-delete') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(matDialog.open).toHaveBeenCalled();
      expect(answerHistory.deleteAnswer).toHaveBeenCalledWith('a-1');
    });

    it('see-all closes the dialog and navigates to the history page', () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-see-all') as HTMLButtonElement).click();

      expect(dialogRef.close).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/search-history']);
    });

    it('submitting a new question leaves the snapshot view', async () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.answer-computed-at')).toBeTruthy();

      await searchWith({ kind: 'filter', filters: {} });

      expect(fixture.nativeElement.querySelector('.answer-computed-at')).toBeNull();
    });

  describe('filter records and search_history_used', () => {
    const filterRec = (id: string, millis: number) =>
      ({ ...rec(id, millis), kind: 'filter', query: 'coffee last month' }) as never;

    it('opening a filter record applies its scope and closes the dialog', () => {
      storedAnswers.set([filterRec('f-1', 1_000_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

      expect(pendingFilters.apply).toHaveBeenCalled();
      expect(analytics.trackSearchHistoryUsed).toHaveBeenCalledWith({ action: 'apply' });
    });

    it('shows a filter label where an answer would show its figure', () => {
      storedAnswers.set([filterRec('f-1', 1_000_000)]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('aiSearch.historyFilterRecord');
    });

    it('reports a reopen when a stored answer is opened', () => {
      storedAnswers.set([rec('a-1', 1_000_000)]);
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

      expect(analytics.trackSearchHistoryUsed).toHaveBeenCalledWith({ action: 'reopen' });
    });
  });
  });
});
