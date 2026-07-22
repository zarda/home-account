import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { Sort } from '@angular/material/sort';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { TransactionListComponent } from './transaction-list.component';
import { TransactionWindowService } from '../../../core/services/transaction-window.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AuthService } from '../../../core/services/auth.service';
import { Transaction } from '../../../models';
import { createTransaction, createUser } from '../../../core/services/testing';

// Signal-based stand-in for the page-provided window source.
function createMockWindowSource() {
  const fetchingEdge = signal<'next' | 'prev' | null>(null);
  return {
    window: signal<Transaction[]>([]),
    visibleWindow: signal<Transaction[]>([]),
    isInitialLoading: signal(false),
    fetchingEdge,
    isFetching: computed(() => fetchingEdge() !== null),
    reachedStart: signal(true),
    reachedEnd: signal(true),
    totalCount: signal<number | null>(null),
    loadError: signal<'initial' | 'prev' | 'next' | null>(null),
    scrollTarget: signal<{ id: string; seq: number } | null>(null),
    resetSeq: signal(0),
    fetchNext: jasmine.createSpy('fetchNext').and.resolveTo(0),
    fetchPrev: jasmine.createSpy('fetchPrev').and.resolveTo(0),
    retry: jasmine.createSpy('retry').and.resolveTo(undefined),
    clearScrollTarget: jasmine.createSpy('clearScrollTarget'),
  };
}

describe('TransactionListComponent', () => {
  let component: TransactionListComponent;
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let translation: jasmine.SpyObj<TranslationService>;
  let windowSource: ReturnType<typeof createMockWindowSource>;

  const txns: Transaction[] = [
    createTransaction({ amount: 30, description: 'Banana', date: Timestamp.fromDate(new Date(2026, 0, 2)) }),
    createTransaction({ amount: 10, description: 'Apple', date: Timestamp.fromDate(new Date(2026, 0, 3)) }),
    createTransaction({ amount: 20, description: 'Cherry', date: Timestamp.fromDate(new Date(2026, 0, 1)) }),
  ];

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    windowSource = createMockWindowSource();

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: windowSource },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sortedTransactions', () => {
    it('passes the server-ordered window through for the default date sort', () => {
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('emits dateSortChange instead of sorting locally when the date header toggles', () => {
      const spy = jasmine.createSpy('dateSortChange');
      component.dateSortChange.subscribe(spy);
      component.onSortChange({ active: 'date', direction: 'asc' } as Sort);
      expect(spy).toHaveBeenCalledWith('asc');
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('sorts by amount ascending', () => {
      component.onSortChange({ active: 'amount', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.amount)).toEqual([10, 20, 30]);
    });

    it('sorts by description ascending', () => {
      component.onSortChange({ active: 'description', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('falls back to the server order when direction is cleared', () => {
      const spy = jasmine.createSpy('dateSortChange');
      component.dateSortChange.subscribe(spy);
      component.onSortChange({ active: 'amount', direction: 'asc' } as Sort);
      component.onSortChange({ active: 'amount', direction: '' } as Sort);
      expect(spy).toHaveBeenCalledWith('desc');
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });
  });

  describe('window state', () => {
    it('treats a fully loaded window as sortable client-side', () => {
      expect(component.fullyLoaded()).toBeTrue();
      windowSource.reachedEnd.set(false);
      expect(component.fullyLoaded()).toBeFalse();
    });

    it('shows the empty state only for a settled, complete, empty window', () => {
      fixture.componentRef.setInput('transactions', []);
      expect(component.showEmptyState()).toBeTrue();

      windowSource.fetchingEdge.set('next');
      expect(component.showEmptyState()).toBeFalse();
      windowSource.fetchingEdge.set(null);

      windowSource.reachedEnd.set(false);
      expect(component.showEmptyState()).toBeFalse();
      windowSource.reachedEnd.set(true);

      windowSource.loadError.set('initial');
      expect(component.showEmptyState()).toBeFalse();
    });

    it('delegates retry to the window source', () => {
      component.onRetry();
      expect(windowSource.retry).toHaveBeenCalled();
    });
  });

  it('delegates category and formatting helpers', () => {
    expect(component.getCategoryName('c')).toBe('Cat');
    expect(component.getCategoryIcon('c')).toBe('icon');
    expect(component.getCategoryColor('c')).toBe('#000');
    expect(component.formatAmount(5, 'USD')).toBe('USD 5');
    expect(component.formatDate(Timestamp.now())).toBe('date');
    expect(component.formatRelativeDate(Timestamp.now())).toBe('rel');
  });

  describe('convertedAmount', () => {
    it('shows the base-currency value for foreign-currency rows', () => {
      const foreign = createTransaction({
        amount: 3800,
        currency: 'JPY',
        amountInBaseCurrency: 25.42
      });
      expect(component.convertedAmount(foreign)).toBe('≈ USD 25.42');
    });

    it('returns null for rows already in the base currency', () => {
      const usd = createTransaction({ amount: 10, currency: 'USD' });
      expect(component.convertedAmount(usd)).toBeNull();
    });
  });

  describe('confirmDelete', () => {
    it('emits delete when confirmed', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).toHaveBeenCalledWith(txns[0]);
    });

    it('does not emit when cancelled', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
