import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, SimpleChange, signal } from '@angular/core';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionFiltersComponent } from './transaction-filters.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { Category, SavedSearch, TransactionFilters } from '../../../models';

describe('TransactionFiltersComponent', () => {
  let component: TransactionFiltersComponent;
  let fixture: ComponentFixture<TransactionFiltersComponent>;
  let mockTransactionService: {
    getTransactionDatesForMonth: jasmine.Spy;
  };
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockSearchHistory: {
    savedSearches: ReturnType<typeof signal<SavedSearch[]>>;
    recentSearches: ReturnType<typeof signal<SavedSearch[]>>;
    loadSearches: jasmine.Spy;
    recordRecent: jasmine.Spy;
    saveSearch: jasmine.Spy;
    touch: jasmine.Spy;
    deleteSearch: jasmine.Spy;
  };

  const savedSearch = (id: string, query: string, overrides: Partial<SavedSearch> = {}): SavedSearch => ({
    id,
    userId: 'user123',
    query,
    pinned: false,
    lastUsedAt: Timestamp.fromMillis(1_800_000_000_000),
    ...overrides
  });

  const mockCategories: Category[] = [
    {
      id: 'cat1',
      userId: null,
      name: 'Food & Drinks',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: true
    },
    {
      id: 'cat2',
      userId: null,
      name: 'Transportation',
      icon: 'directions_car',
      color: '#2196F3',
      type: 'expense',
      order: 2,
      isActive: true,
      isDefault: true
    }
  ];

  const mockIncomeCategories: Category[] = [
    {
      id: 'income1',
      userId: null,
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      order: 1,
      isActive: true,
      isDefault: true
    }
  ];

  beforeEach(async () => {
    mockTransactionService = {
      getTransactionDatesForMonth: jasmine.createSpy('getTransactionDatesForMonth').and.returnValue(of(new Map()))
    };

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'transactions.today': 'Today',
        'transactions.thisWeek': 'Week',
        'transactions.thisMonth': 'Month',
        'transactions.addTransaction': 'Add',
        'transactions.type': 'Type',
        'transactions.category': 'Category',
        'transactions.search': 'Search',
        'transactions.minAmount': 'Min Amount',
        'transactions.maxAmount': 'Max Amount',
        'transactions.clearFilters': 'Clear Filters',
        'transactions.filters': 'Filters',
        'transactions.income': 'Income',
        'transactions.expense': 'Expense'
      };
      return translations[key] || key;
    });

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies']);
    mockCurrencyService.getSupportedCurrencies.and.returnValue([
      { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
      { code: 'EUR', nameKey: 'currencies.eur', symbol: '€' }
    ]);

    mockSearchHistory = {
      savedSearches: signal<SavedSearch[]>([]),
      recentSearches: signal<SavedSearch[]>([]),
      loadSearches: jasmine.createSpy('loadSearches').and.returnValue(of([])),
      recordRecent: jasmine.createSpy('recordRecent').and.resolveTo(),
      saveSearch: jasmine.createSpy('saveSearch').and.resolveTo('saved-id'),
      touch: jasmine.createSpy('touch').and.resolveTo(),
      deleteSearch: jasmine.createSpy('deleteSearch').and.resolveTo()
    };

    await TestBed.configureTestingModule({
      imports: [TransactionFiltersComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: SearchHistoryService, useValue: mockSearchHistory }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionFiltersComponent);
    component = fixture.componentInstance;
    component.categories = mockCategories;
    component.incomeCategories = mockIncomeCategories;
    fixture.detectChanges();
  });

  describe('initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should default to the current month on init', fakeAsync(() => {
      // Create a fresh component in fakeAsync zone
      const freshFixture = TestBed.createComponent(TransactionFiltersComponent);
      const freshComponent = freshFixture.componentInstance;
      freshComponent.categories = mockCategories;
      freshComponent.incomeCategories = mockIncomeCategories;
      freshFixture.detectChanges();
      tick(); // Wait for setTimeout in ngOnInit

      const now = new Date();
      // This Month starts on the 1st (vs the old Today default).
      expect(freshComponent.filters.startDate?.getDate()).toBe(1);
      expect(freshComponent.filters.startDate?.getMonth()).toBe(now.getMonth());
      expect(freshComponent.filters.startDate?.getFullYear()).toBe(now.getFullYear());
    }));

    it('should set thisMonth as active quick filter', fakeAsync(() => {
      // Create a fresh component in fakeAsync zone
      const freshFixture = TestBed.createComponent(TransactionFiltersComponent);
      const freshComponent = freshFixture.componentInstance;
      freshComponent.categories = mockCategories;
      freshComponent.incomeCategories = mockIncomeCategories;
      freshFixture.detectChanges();
      tick(); // Wait for setTimeout in ngOnInit

      expect(freshComponent.isQuickFilterActive('thisMonth')).toBe(true);
    }));

    it('should start with expanded as false', () => {
      expect(component.expanded()).toBe(false);
    });

    it('should load supported currencies from CurrencyService', () => {
      expect(mockCurrencyService.getSupportedCurrencies).toHaveBeenCalled();
      expect(component.currencies.length).toBe(2);
      expect(component.currencies[0].code).toBe('USD');
    });
  });

  describe('setQuickFilter', () => {
    it('should set today filter correctly', () => {
      component.setQuickFilter('today');

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      expect(component.filters.startDate).toEqual(startOfDay);
      expect(component.filters.endDate).toEqual(endOfDay);
      expect(component.isQuickFilterActive('today')).toBe(true);
    });

    it('should set thisWeek filter correctly', () => {
      component.setQuickFilter('thisWeek');

      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);

      expect(component.filters.startDate?.getDate()).toBe(monday.getDate());
      expect(component.isQuickFilterActive('thisWeek')).toBe(true);
    });

    it('should set thisMonth filter correctly', () => {
      component.setQuickFilter('thisMonth');

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      expect(component.filters.startDate).toEqual(startOfMonth);
      expect(component.filters.endDate).toEqual(endOfMonth);
      expect(component.isQuickFilterActive('thisMonth')).toBe(true);
    });

    it('should emit filters when quick filter is set', () => {
      spyOn(component.filtersChanged, 'emit');

      component.setQuickFilter('today');

      expect(component.filtersChanged.emit).toHaveBeenCalled();
    });
  });

  describe('setDateFilter', () => {
    it('should set single date filter', () => {
      const testDate = new Date(2024, 5, 15);
      component.setDateFilter(testDate);

      const expectedStart = new Date(2024, 5, 15, 0, 0, 0, 0);
      const expectedEnd = new Date(2024, 5, 15, 23, 59, 59, 999);

      expect(component.filters.startDate).toEqual(expectedStart);
      expect(component.filters.endDate).toEqual(expectedEnd);
    });

    it('should clear active quick filter when date is selected', () => {
      component.setQuickFilter('today');
      expect(component.isQuickFilterActive('today')).toBe(true);

      component.setDateFilter(new Date(2024, 5, 15));
      expect(component.isQuickFilterActive('today')).toBe(false);
    });

    it('should not set filter if date is null', () => {
      const originalStart = component.filters.startDate;
      component.setDateFilter(null);
      expect(component.filters.startDate).toEqual(originalStart);
    });

    it('should emit filters when date is selected', () => {
      spyOn(component.filtersChanged, 'emit');

      component.setDateFilter(new Date(2024, 5, 15));

      expect(component.filtersChanged.emit).toHaveBeenCalled();
    });
  });

  describe('activeFilterCount', () => {
    it('should return 0 when only date filters are set (from quick filters)', () => {
      // Quick filters set startDate and endDate, which count as 2
      component.setQuickFilter('today');
      expect(component.activeFilterCount()).toBe(2);
    });

    it('should count type filter', () => {
      component.filters = { type: 'expense' };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count categoryId filter', () => {
      component.filters = { categoryId: 'cat1' };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count searchQuery filter', () => {
      component.filters = { searchQuery: 'test' };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count minAmount filter', () => {
      component.filters = { minAmount: 100 };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count maxAmount filter', () => {
      component.filters = { maxAmount: 500 };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count currency filter', () => {
      component.filters = { currency: 'USD' };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count multiple filters', () => {
      component.filters = {
        type: 'expense',
        categoryId: 'cat1',
        searchQuery: 'test',
        minAmount: 100,
        maxAmount: 500,
        currency: 'USD'
      };
      expect(component.activeFilterCount()).toBe(6);
    });
  });

  describe('onFilterChange', () => {
    it('should clear active quick filter', () => {
      component.setQuickFilter('today');
      expect(component.isQuickFilterActive('today')).toBe(true);

      component.onFilterChange();
      expect(component.isQuickFilterActive('today')).toBe(false);
    });

    it('should emit filters', () => {
      spyOn(component.filtersChanged, 'emit');

      component.onFilterChange();

      expect(component.filtersChanged.emit).toHaveBeenCalled();
    });
  });

  describe('search debounce', () => {
    // Fresh component inside the fakeAsync zone so the ngOnInit setTimeout
    // (initial filter emission) is consumed by tick() before spying.
    function createSettledComponent(): TransactionFiltersComponent {
      const freshFixture = TestBed.createComponent(TransactionFiltersComponent);
      const fresh = freshFixture.componentInstance;
      fresh.categories = mockCategories;
      fresh.incomeCategories = mockIncomeCategories;
      freshFixture.detectChanges();
      tick();
      return fresh;
    }

    it('emits once after typing pauses for 250ms', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.searchQuery = 'c';
      fresh.onSearchInput();
      tick(100);
      fresh.filters.searchQuery = 'co';
      fresh.onSearchInput();
      tick(100);
      fresh.filters.searchQuery = 'cof';
      fresh.onSearchInput();

      tick(249);
      expect(emitSpy).not.toHaveBeenCalled();

      tick(1);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.calls.mostRecent().args[0]?.searchQuery).toBe('cof');
    }));

    it('flushes immediately on Enter/blur without a later duplicate', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.searchQuery = 'coffee';
      fresh.onSearchInput();
      tick(50);
      fresh.flushSearch();
      expect(emitSpy).toHaveBeenCalledTimes(1);

      // The still-pending debounce tick sees the query already emitted.
      tick(300);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    }));

    it('absorbs a pending debounce when another filter emits first', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.searchQuery = 'abc';
      fresh.onSearchInput();
      tick(50);
      fresh.setQuickFilter('today');
      expect(emitSpy).toHaveBeenCalledTimes(1);

      tick(300);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    }));

    it('does not emit when the flushed query equals the last emitted one', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.flushSearch();
      expect(emitSpy).not.toHaveBeenCalled();
    }));

    it('keeps non-search filter changes synchronous', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.type = 'expense';
      fresh.onFilterChange();
      expect(emitSpy).toHaveBeenCalledTimes(1);
    }));

    it('ignores Enter pressed to confirm an IME composition', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.searchQuery = 'スタ';
      fresh.onSearchEnter(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      expect(emitSpy).not.toHaveBeenCalled();
      expect(mockSearchHistory.recordRecent).not.toHaveBeenCalled();

      fresh.onSearchEnter(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(emitSpy).toHaveBeenCalledTimes(1);

      flush();
    }));
  });

  describe('recent and saved searches', () => {
    it('loads the search history on init', () => {
      expect(mockSearchHistory.loadSearches).toHaveBeenCalled();
    });

    it('shows the panel only when focused, empty, and there is something to show', () => {
      expect(component.showSearchPanel()).toBeFalse();

      mockSearchHistory.recentSearches.set([savedSearch('r1', 'gym')]);
      component.onSearchFocus();
      expect(component.showSearchPanel()).toBeTrue();

      component.filters.searchQuery = 'gym';
      expect(component.showSearchPanel()).toBeFalse();
    });

    it('stays hidden with no history to show', () => {
      component.onSearchFocus();
      expect(component.showSearchPanel()).toBeFalse();
    });

    it('applies a remembered search in one tap', () => {
      spyOn(component.filtersChanged, 'emit');
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
      component.onSearchFocus();

      component.applySearch(savedSearch('r1', 'starbucks'));

      expect(component.filters.searchQuery).toBe('starbucks');
      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(emitted.searchQuery).toBe('starbucks');
      expect(mockSearchHistory.touch).toHaveBeenCalledWith('r1');
      expect(component.showSearchPanel()).toBeFalse();
    });

    it('records a committed query exactly once', fakeAsync(() => {
      component.filters.searchQuery = 'starbucks';
      component.flushSearch();
      component.flushSearch();
      tick();

      expect(mockSearchHistory.recordRecent).toHaveBeenCalledTimes(1);
      expect(mockSearchHistory.recordRecent).toHaveBeenCalledWith('starbucks');
    }));

    it('does not re-record a query applied from the panel', () => {
      component.applySearch(savedSearch('r1', 'starbucks'));
      component.flushSearch();

      expect(mockSearchHistory.recordRecent).not.toHaveBeenCalled();
    });

    it('removes an entry without emitting filters', () => {
      spyOn(component.filtersChanged, 'emit');
      const event = new Event('click');
      spyOn(event, 'stopPropagation');

      component.removeSearch(savedSearch('r1', 'gym'), event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(mockSearchHistory.deleteSearch).toHaveBeenCalledWith('r1');
      expect(component.filtersChanged.emit).not.toHaveBeenCalled();
    });

    it('saves the current query with a label', () => {
      component.filters.searchQuery = 'utilities';
      component.toggleSaveMode();
      expect(component.saveMode()).toBeTrue();
      expect(component.saveLabel).toBe('utilities');

      component.saveLabel = 'Bills';
      component.confirmSaveSearch();

      expect(mockSearchHistory.saveSearch).toHaveBeenCalledWith('utilities', 'Bills');
      expect(component.saveMode()).toBeFalse();
    });

    it('ignores save confirmation without a query', () => {
      component.filters.searchQuery = '';
      component.confirmSaveSearch();

      expect(mockSearchHistory.saveSearch).not.toHaveBeenCalled();
    });

    it('ignores an IME-composition Enter on the save-label input', () => {
      component.filters.searchQuery = 'utilities';
      component.toggleSaveMode();
      component.onSaveLabelEnter(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      expect(mockSearchHistory.saveSearch).not.toHaveBeenCalled();

      component.onSaveLabelEnter(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(mockSearchHistory.saveSearch).toHaveBeenCalled();
    });

    it('keeps the panel open while focus moves inside the search area', () => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'gym')]);
      component.onSearchFocus();
      expect(component.showSearchPanel()).toBeTrue();

      const wrapper = document.createElement('div');
      const inside = document.createElement('button');
      wrapper.appendChild(inside);
      const event = { currentTarget: wrapper, relatedTarget: inside } as unknown as FocusEvent;
      component.onSearchAreaFocusout(event);
      expect(component.showSearchPanel()).toBeTrue();

      const outsideEvent = { currentTarget: wrapper, relatedTarget: document.body } as unknown as FocusEvent;
      component.onSearchAreaFocusout(outsideEvent);
      expect(component.showSearchPanel()).toBeFalse();
    });

    it('closes the panel on Escape', () => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'gym')]);
      component.onSearchFocus();
      expect(component.showSearchPanel()).toBeTrue();

      component.onSearchEscape();
      expect(component.showSearchPanel()).toBeFalse();
    });

    it('regains panel visibility when typing resumes after a panel tap', () => {
      // applySearch drops the focused flag while real DOM focus stays on the
      // input; the next input event must resync it so clearing the query can
      // reopen the panel.
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'gym')]);
      component.applySearch(savedSearch('r1', 'gym'));
      expect(component.showSearchPanel()).toBeFalse();

      component.filters.searchQuery = '';
      component.onSearchInput();
      expect(component.showSearchPanel()).toBeTrue();
    });
  });

  describe('search template wiring', () => {
    function renderExpanded(): { input: HTMLInputElement; root: HTMLElement } {
      component.expanded.set(true);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const input = root.querySelector<HTMLInputElement>('.search-input')!;
      expect(input).withContext('search input').toBeTruthy();
      return { input, root };
    }

    it('debounces real input events into one emission', fakeAsync(() => {
      const { input } = renderExpanded();
      tick();
      const emitSpy = spyOn(component.filtersChanged, 'emit');

      input.value = 'cof';
      input.dispatchEvent(new Event('input'));
      input.value = 'coff';
      input.dispatchEvent(new Event('input'));

      tick(249);
      expect(emitSpy).not.toHaveBeenCalled();
      tick(1);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.calls.mostRecent().args[0]?.searchQuery).toBe('coff');
    }));

    it('renders the panel on focus and applies a suggestion on click', fakeAsync(() => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
      const { input, root } = renderExpanded();
      tick();
      const emitSpy = spyOn(component.filtersChanged, 'emit');

      input.dispatchEvent(new Event('focus'));
      fixture.detectChanges();

      const apply = root.querySelector<HTMLButtonElement>('.suggestion-apply');
      expect(apply).withContext('suggestion row').toBeTruthy();
      apply!.click();

      expect(emitSpy.calls.mostRecent().args[0]?.searchQuery).toBe('starbucks');
      expect(mockSearchHistory.touch).toHaveBeenCalledWith('r1');
      flush();
    }));

    it('moves focus into the panel on ArrowDown', fakeAsync(() => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
      const { input, root } = renderExpanded();
      tick();

      input.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(document.activeElement).toBe(root.querySelector('.suggestion-apply'));
      flush();
    }));

    it('does not flush on an IME-composition Enter dispatched to the input', fakeAsync(() => {
      const { input } = renderExpanded();
      tick();
      const emitSpy = spyOn(component.filtersChanged, 'emit');

      input.value = 'スタ';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      expect(emitSpy).not.toHaveBeenCalled();

      flush();
    }));
  });

  describe('clearFilters', () => {
    it('should clear all filters', () => {
      component.filters = {
        type: 'expense',
        categoryId: 'cat1',
        startDate: new Date(),
        endDate: new Date(),
        searchQuery: 'test',
        currency: 'USD'
      };

      component.clearFilters();

      expect(component.filters).toEqual({});
    });

    it('should clear active quick filter', () => {
      component.setQuickFilter('today');
      component.clearFilters();

      expect(component.isQuickFilterActive('today')).toBe(false);
    });

    it('should emit empty filters', () => {
      spyOn(component.filtersChanged, 'emit');

      component.clearFilters();

      expect(component.filtersChanged.emit).toHaveBeenCalledWith({});
    });
  });

  describe('isQuickFilterActive', () => {
    it('should return true for active filter', () => {
      component.setQuickFilter('thisMonth');
      expect(component.isQuickFilterActive('thisMonth')).toBe(true);
    });

    it('should return false for inactive filter', () => {
      component.setQuickFilter('today');
      expect(component.isQuickFilterActive('thisMonth')).toBe(false);
    });
  });

  describe('dateClass (calendar highlighting)', () => {
    it('should return empty string for date without transactions', () => {
      const date = new Date(2024, 5, 15);
      expect(component.dateClass(date)).toBe('');
    });

    it('should trigger loading for uncached months', () => {
      const date = new Date(2024, 5, 15);
      component.dateClass(date);

      expect(mockTransactionService.getTransactionDatesForMonth).toHaveBeenCalledWith(2024, 5);
    });

    it('should return has-income for income date', fakeAsync(() => {
      const transactionDates = new Map<string, 'income' | 'expense' | 'both'>();
      transactionDates.set('2024-5-15', 'income');

      mockTransactionService.getTransactionDatesForMonth.and.returnValue(of(transactionDates));

      // First call triggers loading
      const date = new Date(2024, 5, 15);
      component.dateClass(date);
      tick();

      // Second call should return the class
      expect(component.dateClass(date)).toBe('has-income');
    }));

    it('should return has-expense for expense date', fakeAsync(() => {
      const transactionDates = new Map<string, 'income' | 'expense' | 'both'>();
      transactionDates.set('2024-5-15', 'expense');

      mockTransactionService.getTransactionDatesForMonth.and.returnValue(of(transactionDates));

      const date = new Date(2024, 5, 15);
      component.dateClass(date);
      tick();

      expect(component.dateClass(date)).toBe('has-expense');
    }));

    it('should return has-both for date with both types', fakeAsync(() => {
      const transactionDates = new Map<string, 'income' | 'expense' | 'both'>();
      transactionDates.set('2024-5-15', 'both');

      mockTransactionService.getTransactionDatesForMonth.and.returnValue(of(transactionDates));

      const date = new Date(2024, 5, 15);
      component.dateClass(date);
      tick();

      expect(component.dateClass(date)).toBe('has-both');
    }));

    it('should cache month data and not reload', fakeAsync(() => {
      const transactionDates = new Map<string, 'income' | 'expense' | 'both'>();
      mockTransactionService.getTransactionDatesForMonth.and.returnValue(of(transactionDates));

      const date1 = new Date(2024, 5, 15);
      const date2 = new Date(2024, 5, 20);

      component.dateClass(date1);
      tick();
      component.dateClass(date2);
      tick();

      // Should only be called once for the same month
      expect(mockTransactionService.getTransactionDatesForMonth).toHaveBeenCalledTimes(1);
    }));
  });

  describe('expanded state', () => {
    it('should toggle expanded state', () => {
      expect(component.expanded()).toBe(false);

      component.expanded.set(true);
      expect(component.expanded()).toBe(true);

      component.expanded.set(false);
      expect(component.expanded()).toBe(false);
    });
  });

  describe('output events', () => {
    it('should emit filtersChanged with clean filters', () => {
      spyOn(component.filtersChanged, 'emit');

      component.filters = {
        type: 'expense',
        categoryId: undefined as unknown as string,
        startDate: new Date(),
        searchQuery: ''
      };

      component.onFilterChange();

      // Should only include defined, non-empty values
      const emittedFilters = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(emittedFilters.type).toBe('expense');
      expect(emittedFilters.startDate).toBeDefined();
      expect(emittedFilters.categoryId).toBeUndefined();
      expect(emittedFilters.searchQuery).toBeUndefined();
      expect(emittedFilters.currency).toBeUndefined();
    });

    it('should include currency in emitted filters', () => {
      spyOn(component.filtersChanged, 'emit');

      component.filters = { currency: 'EUR' };

      component.onFilterChange();

      const emittedFilters = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(emittedFilters.currency).toBe('EUR');
    });
  });

  describe('UI rendering', () => {
    it('should display quick filter buttons', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // Check for translation keys or translated text
      expect(compiled.textContent?.includes('Today') || compiled.textContent?.includes('transactions.today')).toBe(true);
      expect(compiled.textContent?.includes('Week') || compiled.textContent?.includes('transactions.week')).toBe(true);
      expect(compiled.textContent?.includes('Month') || compiled.textContent?.includes('transactions.month')).toBe(true);
    });

    it('should display filter toggle button', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // The filter toggle button should exist
      expect(compiled.querySelector('[mat-icon-button]') || compiled.querySelector('button')).toBeTruthy();
    });

    it('should show filter panel when expanded', () => {
      component.expanded.set(true);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const filterPanel = compiled.querySelector('.filter-panel');
      expect(filterPanel).toBeTruthy();
    });

    it('should render currency select in filter panel', () => {
      component.expanded.set(true);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const selects = compiled.querySelectorAll('.filter-grid mat-select');
      // Type + Category + Currency
      expect(selects.length).toBe(3);
    });

    it('should emit the chosen currency when an option is picked in the rendered dropdown', fakeAsync(() => {
      spyOn(component.filtersChanged, 'emit');
      component.expanded.set(true);
      fixture.detectChanges();

      // Currency is the third select in the filter grid (type, category,
      // currency); MatSelect opens on a click of its inner trigger.
      const compiled = fixture.nativeElement as HTMLElement;
      const triggers = compiled.querySelectorAll<HTMLElement>('.filter-grid mat-select .mat-mdc-select-trigger');
      const currencyTrigger = triggers[2];
      expect(currencyTrigger).withContext('currency select trigger').toBeTruthy();
      currencyTrigger.click();
      fixture.detectChanges();
      flush();

      // Options render into the overlay container, outside the fixture.
      const options = Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
      const eurOption = options.find(option => option.textContent?.trim() === 'EUR');
      expect(eurOption).withContext('EUR option from CurrencyService').toBeTruthy();
      eurOption!.click();
      fixture.detectChanges();
      flush();

      expect(component.filters.currency).toBe('EUR');
      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(emitted).toEqual(jasmine.objectContaining({ currency: 'EUR' }));
    }));

    it('should hide filter panel when collapsed', () => {
      component.expanded.set(false);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const filterPanel = compiled.querySelector('.filter-panel');
      expect(filterPanel).toBeFalsy();
    });
  });

  describe('presetFilters input', () => {
    const preset = (): TransactionFilters => ({
      type: 'expense',
      categoryId: 'cat1',
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2026, 6, 31, 23, 59, 59, 999),
    });

    function applyPreset(filters: TransactionFilters): void {
      component.presetFilters = filters;
      component.ngOnChanges({
        presetFilters: new SimpleChange(undefined, filters, false),
      });
    }

    it('replaces the current filters and emits them once', () => {
      const emitSpy = spyOn(component.filtersChanged, 'emit');
      component.filters = { searchQuery: 'old', minAmount: 5 };

      applyPreset(preset());

      expect(component.filters.categoryId).toBe('cat1');
      expect(component.filters.searchQuery).toBeUndefined();
      expect(component.filters.minAmount).toBeUndefined();
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
        type: 'expense',
        categoryId: 'cat1',
      }));
    });

    it('clears the active quick filter', () => {
      component.setQuickFilter('thisMonth');
      expect(component.activeQuickFilter()).toBe('thisMonth');

      applyPreset(preset());

      expect(component.activeQuickFilter()).toBeNull();
    });

    it('suppresses the delayed default month filter', fakeAsync(() => {
      const freshFixture = TestBed.createComponent(TransactionFiltersComponent);
      const freshComponent = freshFixture.componentInstance;
      freshComponent.categories = mockCategories;
      freshComponent.incomeCategories = mockIncomeCategories;
      const emitSpy = spyOn(freshComponent.filtersChanged, 'emit');
      freshFixture.detectChanges();

      freshComponent.presetFilters = preset();
      freshComponent.ngOnChanges({
        presetFilters: new SimpleChange(undefined, freshComponent.presetFilters, true),
      });
      tick();

      // Only the preset emission — the ngOnInit setTimeout default must not fire.
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
        categoryId: 'cat1',
      }));
      flush();
    }));

    it('re-emits when the same filter content arrives as a new reference', () => {
      const emitSpy = spyOn(component.filtersChanged, 'emit');

      applyPreset(preset());
      applyPreset(preset());

      expect(emitSpy).toHaveBeenCalledTimes(2);
    });
  });
});
