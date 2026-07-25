import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { AiSearchDialogComponent } from './ai-search-dialog.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NlSearchResult } from '../../../models';
import { createCategory, createTransaction } from '../../../core/services/testing/test-data';

describe('AiSearchDialogComponent', () => {
  let fixture: ComponentFixture<AiSearchDialogComponent>;
  let component: AiSearchDialogComponent;
  let nlSearch: jasmine.SpyObj<NlSearchService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<AiSearchDialogComponent>>;

  async function searchWith(result: NlSearchResult): Promise<void> {
    nlSearch.search.and.resolveTo(result);
    component.query = 'some question';
    await component.submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    nlSearch = jasmine.createSpyObj('NlSearchService', ['search']);
    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    const categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    ]);
    const currencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currencyService.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount.toFixed(2)}`);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    const dateFormatService = jasmine.createSpyObj('DateFormatService', ['formatDate']);
    dateFormatService.formatDate.and.callFake((d: Date) => d.toISOString().slice(0, 10));

    await TestBed.configureTestingModule({
      imports: [AiSearchDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: NlSearchService, useValue: nlSearch },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: DateFormatService, useValue: dateFormatService },
      ],
    }).compileComponents();

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
      expect(chips).toContain('transactions.expense');
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
});
