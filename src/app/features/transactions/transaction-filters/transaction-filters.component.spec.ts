import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionFiltersComponent } from './transaction-filters.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { GoalService } from '../../../core/services/goal.service';
import { Category, Goal, SavedSearch, TransactionFilters } from '../../../models';
import {
  channels,
  chooseOption,
  hoverValue,
  paintedBackground,
  paintedColor,
  provideNoMotion,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../core/services/testing';

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
  let mockGoalService: {
    goals: ReturnType<typeof signal<Goal[]>>;
    activeGoals: ReturnType<typeof signal<Goal[]>>;
    getGoals: jasmine.Spy;
  };

  const goal = (id: string, overrides: Partial<Goal> = {}): Goal => ({
    id,
    userId: 'user123',
    kind: 'saving',
    name: `Goal ${id}`,
    targetAmount: 1000,
    contributedAmount: 0,
    currency: 'USD',
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  });

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
        'transactions.week': 'Week',
        'transactions.month': 'Month',
        'transactions.addTransaction': 'Add',
        'transactions.type': 'Type',
        'transactions.category': 'Category',
        'transactions.search': 'Search',
        'transactions.minAmount': 'Min Amount',
        'transactions.maxAmount': 'Max Amount',
        'transactions.clearFilters': 'Clear Filters',
        'transactions.filters': 'Filters',
        'common.income': 'Income',
        'common.expense': 'Expense'
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

    mockGoalService = {
      goals: signal<Goal[]>([]),
      activeGoals: signal<Goal[]>([]),
      getGoals: jasmine.createSpy('getGoals').and.returnValue(of([]))
    };

    await TestBed.configureTestingModule({
      imports: [TransactionFiltersComponent],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: SearchHistoryService, useValue: mockSearchHistory },
        { provide: GoalService, useValue: mockGoalService },
        provideNoMotion()
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

  describe('tag filter chips', () => {
    const chipInput = () => ({ clear: jasmine.createSpy('clear') });

    it('adds a normalized chip and emits filters carrying it', () => {
      spyOn(component.filtersChanged, 'emit');

      component.addTagFilter({ value: '  Travel ', chipInput: chipInput() } as never);

      expect(component.filters.tags).toEqual(['travel']);
      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent()
        .args[0] as { tags?: string[] };
      expect(emitted.tags).toEqual(['travel']);
    });

    it('ignores duplicates and blank input', () => {
      component.filters.tags = ['travel'];
      spyOn(component.filtersChanged, 'emit');

      component.addTagFilter({ value: 'TRAVEL', chipInput: chipInput() } as never);
      component.addTagFilter({ value: '   ', chipInput: chipInput() } as never);

      expect(component.filters.tags).toEqual(['travel']);
      expect(component.filtersChanged.emit).not.toHaveBeenCalled();
    });

    it('removing the last chip drops tags from the emitted filters', () => {
      component.filters.tags = ['travel'];
      spyOn(component.filtersChanged, 'emit');

      component.removeTagFilter('travel');

      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent()
        .args[0] as { tags?: string[] };
      expect(emitted.tags).toBeUndefined();
      expect(component.filters.tags).toBeUndefined();
    });

    it('clearFilters clears the chips too', () => {
      component.filters.tags = ['travel'];
      component.clearFilters();
      expect(component.filters.tags).toBeUndefined();
    });
  });

  describe('goal filter', () => {
    it('owns a goals subscription: the signal is only warm if a page subscribed', () => {
      expect(mockGoalService.getGoals).toHaveBeenCalled();
    });

    it('offers the active goals', () => {
      mockGoalService.activeGoals.set([goal('g1'), goal('g2')]);
      expect(component.goalOptions.map(g => g.id)).toEqual(['g1', 'g2']);
    });

    it('offers nothing when the account has no goals, so the field hides', () => {
      expect(component.goalOptions).toEqual([]);
    });

    it('keeps a since-deactivated goal the filter already names', () => {
      // A goal card can hand off a filter, then the goal is deactivated: the
      // select must still render the value so it can be cleared.
      const retired = goal('g9', { isActive: false });
      mockGoalService.goals.set([retired]);
      mockGoalService.activeGoals.set([goal('g1')]);
      component.filters = { goalId: 'g9' };

      expect(component.goalOptions.map(g => g.id)).toEqual(['g1', 'g9']);
    });

    it('does not duplicate a filtered goal that is still active', () => {
      const active = goal('g1');
      mockGoalService.goals.set([active]);
      mockGoalService.activeGoals.set([active]);
      component.filters = { goalId: 'g1' };

      expect(component.goalOptions.map(g => g.id)).toEqual(['g1']);
    });

    it('emits the goal filter and drops it once cleared', () => {
      const emitted: TransactionFilters[] = [];
      component.filtersChanged.subscribe(filters => emitted.push(filters));

      component.filters = { goalId: 'g1' };
      component.onFilterChange();
      expect(emitted[0].goalId).toBe('g1');

      component.filters = { goalId: undefined };
      component.onFilterChange();
      expect('goalId' in emitted[1]).toBeFalse();
    });

    it('arrives from a preset and lands in the panel unwindowed', () => {
      // The goal-card hand-off passes only { goalId }: replacing the whole
      // filter set is what clears the default this-month window, so every
      // linked transaction shows regardless of date.
      const emitted: TransactionFilters[] = [];
      component.filtersChanged.subscribe(filters => emitted.push(filters));

      component.presetFilters = { goalId: 'g1' };
      component.ngOnChanges({
        presetFilters: new SimpleChange(undefined, { goalId: 'g1' }, true)
      });

      expect(component.filters.goalId).toBe('g1');
      expect(emitted[0]).toEqual({ goalId: 'g1' });
      expect(component.activeQuickFilter()).toBeNull();
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

    it('counts the tag filter once regardless of chip count', () => {
      component.filters = { tags: ['travel', 'reimbursable'] };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('does not count a cleared amount box, which ngModel leaves as null', () => {
      component.filters = {
        minAmount: null as unknown as number,
        maxAmount: null as unknown as number,
      };
      expect(component.activeFilterCount()).toBe(0);
    });

    it('should count currency filter', () => {
      component.filters = { currency: 'USD' };
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count goal filter', () => {
      component.filters = { goalId: 'g1' };
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

  describe('cleared amount inputs', () => {
    // A bare type="number" input writes literal null through ngModel when
    // emptied. That null used to pass the !== undefined guards and reach
    // applyClientTransactionFilters, where `amount <= null` coerces to
    // `<= 0` and hides every transaction.
    it('emits neither bound after both boxes are cleared', () => {
      spyOn(component.filtersChanged, 'emit');
      component.filters = {
        minAmount: null as unknown as number,
        maxAmount: null as unknown as number,
      };

      component.onFilterChange();

      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent()
        .args[0] as Record<string, unknown>;
      expect('minAmount' in emitted).toBeFalse();
      expect('maxAmount' in emitted).toBeFalse();
    });

    it('still emits a genuine zero bound', () => {
      spyOn(component.filtersChanged, 'emit');
      component.filters = { minAmount: 0 };

      component.onFilterChange();

      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent()
        .args[0] as Record<string, unknown>;
      expect(emitted['minAmount']).toBe(0);
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

  describe('amount debounce', () => {
    // Same shape as the search-debounce block above: the component has to be
    // created inside the fakeAsync zone so ngOnInit's setTimeout is consumed
    // by tick() before anything is spied on.
    function createSettledComponent(): TransactionFiltersComponent {
      const freshFixture = TestBed.createComponent(TransactionFiltersComponent);
      const fresh = freshFixture.componentInstance;
      fresh.categories = mockCategories;
      fresh.incomeCategories = mockIncomeCategories;
      freshFixture.detectChanges();
      tick();
      return fresh;
    }

    it('emits once for a multi-digit amount, not once per digit', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      // Each of these used to be a window reset: a count aggregation, a page
      // fetch, and a scroll to top, on bounds of 1, 15 and 150.
      for (const value of [1, 15, 150, 1500]) {
        fresh.filters.minAmount = value;
        fresh.onAmountInput();
        tick(100);
      }
      expect(emitSpy).not.toHaveBeenCalled();

      tick(250);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(jasmine.objectContaining({ minAmount: 1500 }));
    }));

    it('commits immediately when the box loses focus', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.maxAmount = 20;
      fresh.onAmountInput();
      fresh.flushAmounts();

      expect(emitSpy).toHaveBeenCalledTimes(1);

      // The debounce tick still pending has nothing left to say.
      flush();
      expect(emitSpy).toHaveBeenCalledTimes(1);
    }));

    it('emits when a bound is cleared', fakeAsync(() => {
      const fresh = createSettledComponent();
      fresh.filters.minAmount = 50;
      fresh.onAmountInput();
      tick(250);

      const emitSpy = spyOn(fresh.filtersChanged, 'emit');
      // ngModel writes literal null into a cleared number input, which is why
      // the guard compares a key rather than the raw values.
      fresh.filters.minAmount = null as unknown as undefined;
      fresh.onAmountInput();
      tick(250);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy.calls.mostRecent().args[0]?.minAmount).toBeUndefined();
    }));

    it('absorbs a pending tick when another filter has already emitted', fakeAsync(() => {
      const fresh = createSettledComponent();
      const emitSpy = spyOn(fresh.filtersChanged, 'emit');

      fresh.filters.minAmount = 30;
      fresh.onAmountInput();
      fresh.filters.type = 'expense';
      fresh.onFilterChange();
      expect(emitSpy).toHaveBeenCalledTimes(1);

      tick(250);
      expect(emitSpy).toHaveBeenCalledTimes(1);
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
      // Type + Category + Currency + Country. The goal select is conditional
      // on there being goals to link against, so it is absent here.
      expect(selects.length).toBe(4);
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

    it('gives the quick-filters strip a gutter for its kept scrollbar', () => {
      const host = fixture.nativeElement as HTMLElement;
      document.body.appendChild(host);

      const strip = host.querySelector('.quick-filters') as HTMLElement;
      expect(getComputedStyle(strip).paddingBlockEnd)
        .withContext('.quick-filters: padding-block-end — the gutter the kept scrollbar is drawn in')
        .toBe('12px');

      host.remove();
    });

    describe('the month and year pickers\' bounds', () => {
      const year = new Date().getFullYear();
      const endOfNextYear = new Date(year + 1, 11, 31, 23, 59, 59, 999);

      const boundedInputs = () => [component.monthPicker, component.yearPicker]
        .map(picker => picker.datepickerInput);

      it('gives both the floor\'s month and 31 December next year', () => {
        fixture.componentRef.setInput('floor', new Date(year - 2, 5, 15, 9));
        fixture.detectChanges();

        for (const input of boundedInputs()) {
          expect(input.min).toEqual(new Date(year - 2, 5, 1));
          expect(input.max).toEqual(endOfNextYear);
        }
      });

      it('caps both and leaves the floor open with no floor input', () => {
        for (const input of boundedInputs()) {
          expect(input.min).toBeNull();
          expect(input.max).toEqual(endOfNextYear);
        }
      });
    });
  });

  // Material reads an option whose value is null or undefined as a reset
  // option unless the select sets `canSelectNullableOptions`: a filter holding
  // undefined then shows an empty trigger with its label resting where the
  // value belongs. Each select's first option, All, is bound to undefined, and
  // it is a real choice: the one every filter starts on.
  describe("a filter's All option", () => {
    /** Renders, then lets ngModel hand each select its value, which it does a microtask later. */
    const render = () => {
      fixture.detectChanges();
      flush();
      fixture.detectChanges();
    };

    /** What the field labelled `label` shows: its select's trigger text and whether its label floats. */
    function shown(label: string): { text: string | undefined; floated: boolean } {
      const field = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.filter-grid mat-form-field'))
        .find(each => each.querySelector('mat-label')?.textContent?.trim() === label);
      expect(field).withContext(`the ${label} field`).toBeTruthy();
      return {
        text: field!.querySelector('.mat-mdc-select-value')?.textContent?.trim(),
        floated: field!.querySelector('.mdc-floating-label--float-above') !== null
      };
    }

    const selectIn = (label: string): MatSelect =>
      fixture.debugElement
        .queryAll(By.directive(MatSelect))
        .find(node => (node.nativeElement as HTMLElement).closest('mat-form-field')
          ?.querySelector('mat-label')?.textContent?.trim() === label)!
        .injector.get(MatSelect);

    it('shows All in Type, Category, Currency and Country with no filter set', fakeAsync(() => {
      component.expanded.set(true);
      render();

      for (const label of ['Type', 'Category', 'settings.currency', 'transactions.countryFilter']) {
        expect(shown(label)).withContext(label).toEqual({ text: 'transactions.all', floated: true });
      }
    }));

    it('shows All in Goal too once there is a goal to filter by', fakeAsync(() => {
      mockGoalService.activeGoals.set([goal('g1')]);
      component.expanded.set(true);
      render();

      expect(component.goalOptions.map(each => each.id)).toEqual(['g1']);
      expect(shown('transactions.goalFilter')).toEqual({ text: 'transactions.all', floated: true });
    }));

    it('writes undefined, emits no type and shows All once All is picked after Income', fakeAsync(() => {
      const emit = spyOn(component.filtersChanged, 'emit');
      component.expanded.set(true);
      render();

      chooseOption(selectIn('Type'), 'income', render);
      expect(component.filters.type).toBe('income');
      expect(shown('Type').text).toBe('Income');
      const emitted = emit.calls.count();

      chooseOption(selectIn('Type'), undefined, render);

      expect(component.filters.type).toBeUndefined();
      expect(emit).toHaveBeenCalledTimes(emitted + 1);
      expect('type' in emit.calls.mostRecent().args[0]!).toBeFalse();
      expect(shown('Type')).toEqual({ text: 'transactions.all', floated: true });
    }));

    it('shows All again once Clear all empties the filters', fakeAsync(() => {
      component.expanded.set(true);
      render();
      chooseOption(selectIn('Type'), 'income', render);
      expect(shown('Type').text).toBe('Income');

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.clear-btn')!.click();
      render();

      expect(component.filters).toEqual({});
      expect(shown('Type')).toEqual({ text: 'transactions.all', floated: true });
    }));

    it('shows the type, currency and country a preset names (pin)', fakeAsync(() => {
      component.expanded.set(true);
      fixture.componentRef.setInput('presetFilters', { type: 'expense', currency: 'EUR', country: 'JP' });
      render();

      expect(shown('Type')).toEqual({ text: 'Expense', floated: true });
      expect(shown('settings.currency')).toEqual({ text: 'EUR', floated: true });
      expect(shown('transactions.countryFilter')).toEqual({ text: 'Japan', floated: true });
    }));
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

  describe('the country filter', () => {
    it('lists the countries the bundled table knows, named and ordered by name', () => {
      const options = component.countryOptions;

      expect(options.length).toBeGreaterThan(50);
      expect(options.map(o => o.code)).toContain('KR');
      const names = options.map(o => o.name);
      expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    });

    it('keeps a selected country that the table does not cover', () => {
      // readCountryCode admits any region CLDR names, so a receipt can store
      // one the bounding-box table has no box for. An arriving filter must
      // still render its value and stay clearable.
      component.filters.country = 'VA';

      expect(component.countryOptions.map(o => o.code)).toContain('VA');
    });

    it('counts an active country as a filter and emits it', () => {
      spyOn(component.filtersChanged, 'emit');
      component.filters.country = 'KR';

      component.onFilterChange();

      expect(component.filtersChanged.emit).toHaveBeenCalledWith(
        jasmine.objectContaining({ country: 'KR' })
      );
    });

    it('drops the country from the emitted filters once cleared', () => {
      spyOn(component.filtersChanged, 'emit');
      component.filters.country = undefined;

      component.onFilterChange();

      const emitted = (component.filtersChanged.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect('country' in emitted).toBeFalse();
    });
  });

  // A compact field's box is 40 px tall. Material rests a label at half the
  // container-height token and floats it by the same token, so the token has
  // to say 40 px too, or every empty field's label rests low in its box.
  describe("a compact field's label", () => {
    /** Renders, lets ngModel hand each select its value a microtask later, then settles the label's float. */
    const render = () => {
      fixture.detectChanges();
      flush();
      fixture.detectChanges();
      settleAnimations(document);
    };

    function field(label: string): { label: DOMRect; box: DOMRect; floated: boolean } {
      const found = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.filter-grid mat-form-field'))
        .find(each => each.querySelector('mat-label')?.textContent?.trim() === label);
      expect(found).withContext(`the ${label} field`).toBeTruthy();
      const floating = found!.querySelector('.mdc-floating-label')!;
      return {
        label: floating.getBoundingClientRect(),
        box: found!.querySelector('.mat-mdc-text-field-wrapper')!.getBoundingClientRect(),
        floated: floating.classList.contains('mdc-floating-label--float-above')
      };
    }

    const centre = (rect: DOMRect) => rect.top + rect.height / 2;

    it("rests an empty field's label at the centre of its box", fakeAsync(() => {
      component.expanded.set(true);
      render();

      const minAmount = field('Min Amount');
      expect(minAmount.floated).withContext('the empty Min Amount label rests').toBeFalse();
      expect(minAmount.box.height).withContext('the compact box, px').toBeCloseTo(40, 0);
      expect(Math.abs(centre(minAmount.label) - centre(minAmount.box)))
        .withContext('resting label centre off the box centre, px')
        .toBeLessThanOrEqual(2);
    }));

    // Pin: a floated label already sat centred on the box's top edge (0 px
    // off it, measured before the token moved); the fix must not shift it.
    it('floats a filled field\'s label onto the top edge of its box, where it already sat (pin)', fakeAsync(() => {
      component.expanded.set(true);
      render();

      const type = field('Type');
      expect(type.floated).withContext('Type reads All, so its label floats').toBeTrue();
      expect(Math.abs(centre(type.label) - type.box.top))
        .withContext('floated label centre off the box top edge, px')
        .toBeLessThanOrEqual(1);
    }));
  });

  // Material caps an outlined select's notch at the field's width less 60 px,
  // the room a resting label leaves beside the arrow, and lifts the cap only
  // under a class its form field no longer sets. A floated label sits on the
  // top border, above the arrow, so the cap cut it short in any field narrower
  // than the label plus 60 px: the filter grid's selects, 108 px wide at a
  // 1024 px pane, drew "Categor" and "Currenc". styles.scss lifts the cap on
  // the class that is set; Karma bundles styles.scss, so the rule is in force
  // here as it is in the app.
  describe("a select's label in a narrow compact field", () => {
    const FIELD_WIDTH_PX = 108;

    beforeEach(() => {
      // The stub would render the currency label as its raw key, a word far
      // longer than the field however it is cut.
      const labels: Record<string, string> = {
        'transactions.category': 'Category',
        'settings.currency': 'Currency'
      };
      mockTranslationService.t.and.callFake((key: string) => labels[key] ?? key);
    });

    /** Renders at a pinned width and face, lets ngModel hand each select its value, then settles the label's float. */
    function render(): void {
      const host = fixture.nativeElement as HTMLElement;
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material's fields take their face from the
      // --mat-sys tokens rather than from the host.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      component.expanded.set(true);
      fixture.detectChanges();
      for (const each of Array.from(host.querySelectorAll<HTMLElement>('.filter-grid mat-form-field'))) {
        each.style.width = `${FIELD_WIDTH_PX}px`;
      }
      flush();
      fixture.detectChanges();
      settleAnimations(document);
    }

    function selectField(label: string): HTMLElement {
      const found = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.filter-grid mat-form-field'))
        .find(each => each.querySelector('mat-label')?.textContent?.trim() === label);
      expect(found).withContext(`the ${label} field`).toBeTruthy();
      expect(found!.querySelector('mat-select')).withContext(`the ${label} field holds a select`).toBeTruthy();
      return found!;
    }

    it('shows the whole of a floated label, however narrow the field', fakeAsync(() => {
      render();

      for (const label of ['Category', 'Currency']) {
        const field = selectField(label);
        const floating = field.querySelector<HTMLElement>('.mdc-floating-label')!;
        expect(field.getBoundingClientRect().width).withContext(`${label} field width, px`).toBeCloseTo(FIELD_WIDTH_PX, 0);
        expect(floating.classList.contains('mdc-floating-label--float-above'))
          .withContext(`${label} reads All, so its label floats`)
          .toBeTrue();
        expect(floating.scrollWidth).withContext(`${label} label: laid-out width, px`).toBeGreaterThan(0);
        expect(floating.scrollWidth)
          .withContext(`${label} label: width of the text, px, against the width left to draw it in`)
          .toBeLessThanOrEqual(floating.clientWidth);
      }
    }));

    // Pin: a resting label sits beside the arrow and keeps the room Material
    // set aside for it; the lift is for a floated label only.
    it("keeps the arrow's room for a resting label (pin)", fakeAsync(() => {
      // Every filter starts on All, which floats its label, so a value that no
      // option carries empties the trigger instead: the label rests.
      component.filters.currency = 'ZZZ';
      render();

      const field = selectField('Currency');
      expect(field.querySelector('.mdc-floating-label')!.classList.contains('mdc-floating-label--float-above'))
        .withContext('an empty select rests its label')
        .toBeFalse();
      expect(field.querySelector('.mdc-notched-outline')!.classList.contains('mdc-notched-outline--notched'))
        .withContext('a resting label leaves no notch cut in the border')
        .toBeFalse();
      expect(getComputedStyle(field.querySelector('.mdc-notched-outline__notch')!).maxWidth)
        .withContext('the notch of a resting label: max-width')
        .toBe('calc(100% - 60px)');
    }));
  });

  // A date field's input gets what is left of the field after its 12 px start
  // padding and the 44 px calendar button. The grid's fixed tracks, six to a
  // row at a 1024 px pane, left 40 px of it for a date 86 px wide, and a
  // 375 px phone's two cut one by 2 px. The widths below are the grid's own,
  // the panel's inner width, near what three panes leave it rather than each
  // one measured: 312 px was read on a 375 px phone, 257 px takes that
  // phone's chrome from a 320 px one, and 702 px is a little wide of the
  // 696 px at most that a 1024 px pane leaves beside its sidebar. Karma's
  // window renders no media rule from 1024 px up, so a case below reads the
  // stylesheet to hold that none sets the tracks: the grid's own width lays
  // them out at every pane.
  describe('a filter date beside its calendar button', () => {
    const GRID_WIDTHS_PX = [702, 312, 257] as const;
    // Karma serves none of the app's fonts, so the face is pinned as in the
    // narrow-select cases above: the Linux runner's DejaVu Sans has Verdana's
    // digit widths, and Material's fields read their face from the tokens.
    const FACE = "Verdana, 'DejaVu Sans', sans-serif";

    const host = () => fixture.nativeElement as HTMLElement;

    /** Opens the panel on 10/10/2026 to 10/10/2026, then lets ngModel hand each date input its value. */
    function render(): void {
      host().style.display = 'block';
      host().style.fontFamily = FACE;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host().style.setProperty(token, FACE);
      }
      const filters: TransactionFilters = { startDate: new Date(2026, 9, 10), endDate: new Date(2026, 9, 10) };
      component.presetFilters = filters;
      component.ngOnChanges({ presetFilters: new SimpleChange(undefined, filters, false) });
      component.expanded.set(true);
      fixture.detectChanges();
      flush();
      fixture.detectChanges();
      settleAnimations(document);
    }

    /** Constrains the component's host so the grid inside the panel's padding is `width` px wide. */
    function layOut(width: number): HTMLElement {
      const panel = getComputedStyle(host().querySelector('.filter-panel')!);
      host().style.width = `${width + parseFloat(panel.paddingInlineStart) + parseFloat(panel.paddingInlineEnd)}px`;
      const grid = host().querySelector<HTMLElement>('.filter-grid')!;
      expect(grid.getBoundingClientRect().width).withContext('the grid width, px').toBeCloseTo(width, 0);
      return grid;
    }

    function dateInputs(): HTMLInputElement[] {
      const inputs = Array.from(host().querySelectorAll<HTMLInputElement>('.filter-grid input.mat-datepicker-input'));
      expect(inputs.length).withContext('the From and To inputs').toBe(2);
      return inputs;
    }

    function wrapperOf(element: Element): HTMLElement {
      return element.closest('mat-form-field')!.querySelector<HTMLElement>('.mat-mdc-text-field-wrapper')!;
    }

    function columnsOf(grid: HTMLElement): number {
      return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    }

    /** What a date field needs, read off the page: its start padding, its calendar button and ten digits of the input's own font. */
    function dateFieldNeedPx(input: HTMLInputElement): number {
      const start = parseFloat(getComputedStyle(wrapperOf(input)).paddingInlineStart);
      const button = input.closest('mat-form-field')!.querySelector('.mat-mdc-form-field-icon-suffix')!.getBoundingClientRect().width;
      expect(start + button).withContext('start padding and calendar button, px').toBeCloseTo(56, 0);
      const probe = document.createElement('span');
      probe.style.cssText = 'position: absolute; visibility: hidden; width: 10ch';
      input.parentElement!.appendChild(probe);
      const tenDigits = probe.getBoundingClientRect().width;
      probe.remove();
      expect(tenDigits).withContext("ten digits of the input's font, px").toBeGreaterThan(0);
      return start + button + tenDigits;
    }

    // The tracks follow the grid's width and nothing else. A rule keyed to the
    // viewport from 1024 px up is what set six of them at a 1024 px pane, and
    // Karma's 756 px window renders no such rule, so the stylesheet is read
    // instead: no media query sets the tracks, and exactly one rule does, the
    // floored auto-fit list the cases around this one lay out.
    it('sets the tracks in one rule that no media query overrides', () => {
      const unconditional: string[] = [];
      const underMedia: string[] = [];
      const visit = (rules: CSSRuleList, media: string | null): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && /\.filter-grid(?![\w-])/.test(rule.selectorText) && rule.style.gridTemplateColumns) {
            if (media === null) {
              unconditional.push(rule.style.gridTemplateColumns);
            } else {
              underMedia.push(`@media ${media} { ${rule.style.gridTemplateColumns} }`);
            }
          }
          if (rule instanceof CSSGroupingRule) {
            visit(rule.cssRules, rule instanceof CSSMediaRule ? rule.conditionText : media);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // a cross-origin sheet; nothing this app injects is one
        }
        visit(rules, null);
      }

      expect(underMedia)
        .withContext('.filter-grid tracks set under a media query, which reads the viewport, not the grid')
        .toEqual([]);
      expect(unconditional)
        .withContext('.filter-grid tracks set outside any media query')
        .toEqual([jasmine.stringMatching(/^repeat\(auto-fit, minmax\(min\(100%, .+\), 1fr\)\)$/)]);
    });

    it('shows the whole of a ten-character date beside its calendar button, at a 1024 px pane and on both phones', fakeAsync(() => {
      render();

      for (const width of GRID_WIDTHS_PX) {
        layOut(width);
        dateInputs().forEach((input, index) => {
          const which = `${index === 0 ? 'From' : 'To'} in a ${width} px grid`;
          expect(input.value).withContext(`${which}: the date shown`).toBe('10/10/2026');
          expect(input.clientWidth).withContext(`${which}: the input's laid-out width, px`).toBeGreaterThan(0);
          expect(input.scrollWidth)
            .withContext(`${which}: width of the date, px, against the input's`)
            .toBeLessThanOrEqual(input.clientWidth);
        });
      }
    }));

    it("gives a date field's end padding to its date, as Material does beside an icon suffix", fakeAsync(() => {
      render();
      layOut(GRID_WIDTHS_PX[0]);

      for (const input of dateInputs()) {
        const wrapper = getComputedStyle(wrapperOf(input));
        expect(wrapper.paddingInlineStart).withContext('a date field: start padding').toBe('12px');
        expect(wrapper.paddingInlineEnd).withContext('a date field: end padding, beside the calendar button').toBe('0px');
      }
    }));

    // Pin: the compact padding stays on every field without a button.
    it('keeps the end padding of a compact field with no calendar button (pin)', fakeAsync(() => {
      render();
      layOut(GRID_WIDTHS_PX[0]);

      const minAmount = Array.from(host().querySelectorAll('.filter-grid mat-form-field'))
        .find(each => each.querySelector('mat-label')?.textContent?.trim() === 'Min Amount');
      expect(minAmount).withContext('the Min Amount field').toBeTruthy();
      expect(minAmount!.querySelector('.mat-mdc-form-field-icon-suffix')).withContext('Min Amount has no suffix').toBeNull();
      const wrapper = getComputedStyle(wrapperOf(minAmount!));
      expect(wrapper.paddingInlineStart).withContext('Min Amount: start padding').toBe('12px');
      expect(wrapper.paddingInlineEnd).withContext('Min Amount: end padding').toBe('12px');
    }));

    // Pin: a 1024 px pane's grid still sets fields side by side, and none of
    // them is narrower than the start padding, the button and ten digits of
    // the input's own font. Its tracks stretch well past the floor, so this
    // bounds the floor only from far below; the next case lays one out at it.
    it('lays a 702 px grid out in more than one column, no field narrower than a date needs (pin)', fakeAsync(() => {
      render();
      const grid = layOut(GRID_WIDTHS_PX[0]);

      expect(columnsOf(grid)).withContext('columns in a 702 px grid').toBeGreaterThan(1);

      const need = dateFieldNeedPx(dateInputs()[0]);
      for (const field of Array.from(grid.querySelectorAll('mat-form-field'))) {
        const label = field.querySelector('mat-label')?.textContent?.trim();
        expect(field.getBoundingClientRect().width)
          .withContext(`${label} field width, px, against what a date needs`)
          .toBeGreaterThanOrEqual(need - 0.5);
      }
    }));

    // Pin: the narrowest grid that still sets two fields side by side lays
    // each track out at its floor, so it is where 56 px and 10ch are put to
    // the test. The step is searched for rather than worked out from the
    // floor, since tracks stretch to fill whatever width they are given and
    // a floor too small would pass at any width computed from the right one.
    // Every digit of the pinned face is as wide as any other, so 10/10/2026
    // is as wide as any ten-character date.
    it('shows the whole of a date in the narrowest grid that holds two columns (pin)', fakeAsync(() => {
      const SEARCH_FROM_PX = 400;
      const SEARCH_DOWN_TO_PX = 200;
      render();

      expect(columnsOf(layOut(SEARCH_FROM_PX)))
        .withContext(`columns in a ${SEARCH_FROM_PX} px grid, where the search starts`)
        .toBe(2);
      let width = SEARCH_FROM_PX;
      while (width > SEARCH_DOWN_TO_PX && columnsOf(layOut(width - 1)) === 2) {
        width--;
      }
      expect(columnsOf(layOut(width - 1)))
        .withContext(`columns in a ${width - 1} px grid, the widest that no longer holds two`)
        .toBe(1);
      const grid = layOut(width);
      expect(columnsOf(grid)).withContext(`columns in a ${width} px grid, 1 px wider`).toBe(2);

      const inputs = dateInputs();
      const need = dateFieldNeedPx(inputs[0]);
      inputs.forEach((input, index) => {
        const which = `${index === 0 ? 'From' : 'To'} in a ${width} px grid`;
        expect(input.value).withContext(`${which}: the date shown`).toBe('10/10/2026');
        expect(input.clientWidth).withContext(`${which}: the input's laid-out width, px`).toBeGreaterThan(0);
        expect(input.scrollWidth)
          .withContext(`${which}: width of the date, px, against the input's`)
          .toBeLessThanOrEqual(input.clientWidth);
        expect(input.closest('mat-form-field')!.getBoundingClientRect().width)
          .withContext(`${which}: field width, px, against what a date needs`)
          .toBeGreaterThanOrEqual(need - 0.5);
      });
    }));
  });

  describe('grid tracks (#450)', () => {
    it('lays the filter grid out in more than one column once expanded', () => {
      // How many follows the grid's width and the input's font, which the
      // date cases above pin; what this case holds is that the declaration
      // parses. A dropped one leaves the grid a single column.
      component.expanded.set(true);
      fixture.detectChanges();

      const grid = fixture.nativeElement.querySelector('.filter-grid') as HTMLElement;
      expect(grid.getBoundingClientRect().width)
        .withContext("the grid in Karma's window, px: room for two date fields")
        .toBeGreaterThan(400);
      expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
        .withContext('.filter-grid computed column count')
        .toBeGreaterThan(1);
    });
  });

  // Not the calendar's income and expense marks, which are the type colours.
  describe('colours', () => {
    /** What `color: var(token)` computes to under the theme on <html> now. */
    function tokenColour(token: string): string {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
    }

    function expectAA(el: Element, label: string): void {
      expect(ratio(paintedColor(el), paintedBackground(el)))
        .withContext(`${label} at AA on what is under it`)
        .toBeGreaterThanOrEqual(4.5);
    }

    it('paints the toolbar and the search box in their tokens, at AA, in both themes', () => {
      component.expanded.set(true);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const quick = root.querySelector('.quick-btn:not(.active)') as HTMLElement;
      const toggle = root.querySelector('.filter-toggle') as HTMLElement;
      const panel = root.querySelector('.filter-panel') as HTMLElement;
      const input = root.querySelector('.search-input') as HTMLInputElement;
      const icon = root.querySelector('.search-icon') as HTMLElement;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          // The quick filters carry `transition: all`, which would hold the
          // other theme's colours for as long as the spec runs.
          settleAnimations(document);
          const border = tokenColour('--border-primary');
          expect(getComputedStyle(quick).color).withContext(`${theme} quick filter`).toBe(tokenColour('--text-muted'));
          expectAA(quick, `${theme} quick filter`);
          expect(getComputedStyle(quick).borderBlockStartColor).withContext(`${theme} quick filter border`).toBe(border);
          expect(getComputedStyle(toggle).borderBlockStartColor).withContext(`${theme} toggle border`).toBe(border);
          expect(getComputedStyle(panel).borderBlockStartColor).withContext(`${theme} panel rule`).toBe(border);

          expect(getComputedStyle(input).color).withContext(`${theme} query`).toBe(tokenColour('--text-primary'));
          expectAA(input, `${theme} query`);
          const placeholder = getComputedStyle(input, '::placeholder').color;
          expect(placeholder).withContext(`${theme} placeholder`).toBe(tokenColour('--text-muted'));
          expect(ratio(channels(placeholder).rgb, paintedBackground(input)))
            .withContext(`${theme} placeholder at AA on the search box`)
            .toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(icon).color).withContext(`${theme} search icon`).toBe(tokenColour('--text-muted'));
          expectAA(icon, `${theme} search icon`);
        });
      }
    });

    it("strengthens a quick filter's border on hover to --border-strong, in both themes", () => {
      const quick = (fixture.nativeElement as HTMLElement).querySelector('.quick-btn:not(.active)') as HTMLElement;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          try {
            quick.style.borderColor = hoverValue(quick, '.quick-btn', 'border-color');
            settleAnimations(document);
            expect(getComputedStyle(quick).borderBlockStartColor)
              .withContext(`${theme} hovered border`)
              .toBe(tokenColour('--border-strong'));
          } finally {
            quick.style.removeProperty('border-color');
          }
        });
      }
    });

    it('paints the suggestion heading and its icons in --text-muted, at AA, in both themes', fakeAsync(() => {
      mockSearchHistory.savedSearches.set([savedSearch('s1', 'coffee')]);
      component.expanded.set(true);
      fixture.detectChanges();
      tick();
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLInputElement>('.search-input')!.dispatchEvent(new Event('focus'));
      fixture.detectChanges();

      const heading = root.querySelector('.suggestion-heading') as HTMLElement;
      const icon = root.querySelector('.suggestion-icon') as HTMLElement;
      expect(heading).withContext('the saved-search heading').toBeTruthy();
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          settleAnimations(document);
          for (const [label, el] of [['heading', heading], ['icon', icon]] as const) {
            expect(getComputedStyle(el).color).withContext(`${theme} ${label}`).toBe(tokenColour('--text-muted'));
            expectAA(el, `${theme} ${label}`);
          }
        });
      }
      flush();
    }));
  });
});
