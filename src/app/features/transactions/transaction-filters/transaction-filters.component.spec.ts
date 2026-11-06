import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange, WritableSignal, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { DateAdapter } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { MatSelect } from '@angular/material/select';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionFiltersComponent } from './transaction-filters.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { SupportedLocale, TranslationService } from '../../../core/services/translation.service';
import { DATE_FORMAT_AUTO } from '../../../core/services/date-format.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { GoalService } from '../../../core/services/goal.service';
import { Category, Goal, SavedSearch, TransactionFilters } from '../../../models';
import {
  accessibleName,
  catalogTranslator,
  channels,
  chooseOption,
  contentWidthPx,
  hoverValue,
  paintedBackground,
  paintedColor,
  placeholderWidthPx,
  pressKey,
  provideAppDatepickerForTests,
  provideNoMotion,
  ratio,
  settleAnimations,
  styleRules,
  withTheme,
} from '../../../core/services/testing';

describe('TransactionFiltersComponent', () => {
  let component: TransactionFiltersComponent;
  let fixture: ComponentFixture<TransactionFiltersComponent>;
  let mockTransactionService: {
    getTransactionDatesForMonth: jasmine.Spy;
  };
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  // The reader the pickers follow: their language and the account's format.
  let locale: WritableSignal<SupportedLocale>;
  let dateFormat: WritableSignal<string>;
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

    locale = signal<SupportedLocale>('en');
    dateFormat = signal(DATE_FORMAT_AUTO);

    await TestBed.configureTestingModule({
      imports: [TransactionFiltersComponent],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: SearchHistoryService, useValue: mockSearchHistory },
        { provide: GoalService, useValue: mockGoalService },
        provideNoMotion(),
        // What the app's root hands every picker: its adapter, over a reader
        // this spec can turn, and labels this spec can tell apart from
        // Material's own. A fresh instance per case. The TranslationService
        // is the helper's, its labels this spec's.
        provideAppDatepickerForTests({ dateFormat, locale, t: mockTranslationService.t }),
        { provide: MatDatepickerIntl, useValue: Object.assign(new MatDatepickerIntl(), { openCalendarLabel: 'root' }) }
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

    /**
     * Each suggestion's remove names the search it removes, in the words its
     * row shows: a saved search by its label, or by its query when it has
     * none, and a recent search by its query.
     */
    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`names each suggestion's remove by its search in ${l}`, fakeAsync(() => {
        const t = catalogTranslator(l, { strict: true });
        mockTranslationService.t.and.callFake(catalogTranslator(l));
        locale.set(l);
        mockSearchHistory.savedSearches.set([
          savedSearch('s1', 'utilities', { label: 'Bills' }),
          savedSearch('s2', 'gym'),
        ]);
        mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
        const { input, root } = renderExpanded();
        tick();

        input.dispatchEvent(new Event('focus'));
        fixture.detectChanges();

        expect(Array.from(root.querySelectorAll('.suggestion-remove')).map(accessibleName)).toEqual([
          t('transactions.removeSavedSearch', { name: 'Bills' }),
          t('transactions.removeSavedSearch', { name: 'gym' }),
          t('transactions.removeRecentSearch', { query: 'starbucks' }),
        ]);
        flush();
      }));
    }

    /**
     * The panel scrolls down once its rows outgrow it, never sideways. A
     * row's remove is its last item, flush with the panel's end, and
     * Material centres a 48 px touch target on the 40 px button, 4 px past
     * it on every side: past the panel's end, which then scrolled 4 px, over
     * the end of its own row's apply, and up over the bottom of the remove
     * above it, so a tap there removed the wrong search. Read at the 712 px
     * host a 1024 px pane gives (a 686 px panel) and at the 336 px a 375 px
     * phone gives: the 312 px grid the filter-date cases read, and the
     * filter panel's 12 px padding on each side. A scroll width or height
     * sees only what reaches past a box's end or bottom, so each touch
     * target is also read against its row on every side. The headings are
     * raw keys here, one unbroken word each and part of the panel's scroll
     * width, so the face is pinned.
     */
    it('keeps each 40px suggestion remove and its touch target on its own row, and the panel never scrolls sideways', fakeAsync(() => {
      mockSearchHistory.savedSearches.set([
        savedSearch('s1', 'utilities', { label: 'Bills' }),
        savedSearch('s2', 'gym'),
      ]);
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
      const { input, root } = renderExpanded();
      tick();
      input.dispatchEvent(new Event('focus'));
      fixture.detectChanges();

      const panel = root.querySelector<HTMLElement>('.search-suggestions');
      expect(panel).withContext('the suggestions panel').not.toBeNull();
      const rows = Array.from(panel!.querySelectorAll<HTMLElement>('.suggestion-row'));
      expect(rows.length).withContext('two saved rows and one recent').toBe(3);

      root.style.display = 'block';
      pinFieldFace();
      for (const width of [712, 336]) {
        root.style.width = `${width}px`;
        const at = `a ${width} px host`;
        expect(panel!.scrollWidth)
          .withContext(`${at}: the panel's scroll width against its client width, px`)
          .toBeLessThanOrEqual(panel!.clientWidth);
        rows.forEach((row, i) => {
          const shown = `${at}: row ${i + 1}`;
          const remove = row.querySelector('.suggestion-remove')!;
          const box = remove.getBoundingClientRect();
          expect([box.width, box.height]).withContext(`${shown}'s remove, px`).toEqual([40, 40]);
          expect(row.scrollWidth)
            .withContext(`${shown}'s scroll width against its client width, px`)
            .toBeLessThanOrEqual(row.clientWidth);
          expect(row.scrollHeight)
            .withContext(`${shown}'s scroll height against its client height, px`)
            .toBeLessThanOrEqual(row.clientHeight);
          const own = row.getBoundingClientRect();
          const apply = row.querySelector('.suggestion-apply')!.getBoundingClientRect();
          const target = remove.querySelector('.mat-mdc-button-touch-target')!.getBoundingClientRect();
          const room: readonly [string, number][] = [
            ["top, inside the row's", target.top - own.top],
            ["bottom, inside the row's", own.bottom - target.bottom],
            ["start, clear of the apply's end", target.left - apply.right],
            ["end, inside the row's", own.right - target.right],
          ];
          for (const [edge, px] of room) {
            expect(px).withContext(`${shown}'s remove, its touch target's ${edge}, px`).toBeGreaterThanOrEqual(-0.5);
          }
        });
      }
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

  /**
   * The filter toggle shows an icon and, while any filter is set, a badge
   * with how many. Its name says what it opens in the reader's language, and
   * how many filters are set when any are, so the badge's number is not the
   * whole name; and it says whether the panel is open.
   */
  describe('the filter toggle (real template)', () => {
    function toggleIn(root: HTMLElement): HTMLButtonElement {
      const toggle = root.querySelector<HTMLButtonElement>('.filter-toggle');
      expect(toggle).withContext('the filter toggle').not.toBeNull();
      return toggle!;
    }

    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`is named by the filters it opens, and how many are set, in ${l}`, () => {
        const t = catalogTranslator(l, { strict: true });
        mockTranslationService.t.and.callFake(catalogTranslator(l));
        // The translate pipe memoises on the locale and the catalog version;
        // the bump is what a catalog's arrival does, so en is read again too.
        locale.set(l);
        TestBed.inject(TranslationService).translationsVersion.update(version => version + 1);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const toggle = toggleIn(root);

        expect(accessibleName(toggle)).withContext('no filter set').toBe(t('transactions.filtersToggle'));

        // Today sets a start and an end date: two filters.
        root.querySelector<HTMLButtonElement>('.quick-btn')!.click();
        fixture.detectChanges();
        expect(component.activeFilterCount()).withContext('the filters Today sets').toBe(2);
        expect(accessibleName(toggle))
          .withContext('two filters set')
          .toBe(t('transactions.filtersToggleActive', { active: 2 }));
        const badge = toggle.querySelector('.filter-badge');
        expect(badge?.textContent?.trim()).withContext('the badge still shows the number').toBe('2');
        expect(badge?.getAttribute('aria-hidden'))
          .withContext('the badge, whose number the name already reads')
          .toBe('true');
      });
    }

    it('says whether the panel is open, before and after a click', () => {
      const root = fixture.nativeElement as HTMLElement;
      const toggle = toggleIn(root);
      expect(toggle.getAttribute('aria-expanded')).withContext('before a click').toBe('false');

      toggle.click();
      fixture.detectChanges();
      expect(root.querySelector('.filter-panel')).withContext('the panel the click opens').not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).withContext('after a click').toBe('true');

      toggle.click();
      fixture.detectChanges();
      expect(root.querySelector('.filter-panel')).withContext('the panel the second click closes').toBeNull();
      expect(toggle.getAttribute('aria-expanded')).withContext('after a second click').toBe('false');
    });
  });

  /**
   * Clear all, a suggestion applied from the keyboard and the save-search
   * box each take the control holding focus off the page, and focus fell to
   * the page with it. Clear all hands focus to the filter toggle, which
   * stays, heads the panel and then reads Filters with no count; a
   * suggestion leaves it in the search box it fills; and the box hands it
   * back to Save search, which opened it, or to the search box once an
   * emptied query has taken Save search away too. A press focuses its button
   * first, as a key or Chrome's pointer does, and focus is read after the
   * render hooks the press asks for.
   */
  describe('focus after Clear all, a suggestion or the save-search box takes the pressed control away (real template)', () => {
    const root = () => fixture.nativeElement as HTMLElement;

    /** The render a press asks for, then its render hooks, where a focus request lands. */
    function render(): void {
      fixture.detectChanges();
      TestBed.tick();
    }

    function find<T extends HTMLElement>(selector: string, what: string): T {
      const found = root().querySelector<T>(selector);
      expect(found).withContext(what).not.toBeNull();
      return found!;
    }

    /** A scripted click focuses nothing, so a press is focus() then click(), as a key or Chrome's pointer gives one. */
    function press(button: HTMLButtonElement): void {
      button.focus();
      expect(document.activeElement).withContext('the button, focused before the press').toBe(button);
      button.click();
      render();
    }

    /** The panel open over `query`, and the Save search beside it. */
    function openOver(query: string): HTMLButtonElement {
      // filters is a plain object, so it is set before the signal that renders it.
      component.filters.searchQuery = query;
      component.expanded.set(true);
      render();
      return find<HTMLButtonElement>('.save-search-button', 'Save search, beside a query');
    }

    /** The open box's Save and Cancel, in that order. */
    function rowButtons(): HTMLButtonElement[] {
      const buttons = Array.from(root().querySelectorAll<HTMLButtonElement>('.save-search-row button'));
      expect(buttons.length).withContext("the row's Save and Cancel").toBe(2);
      return buttons;
    }

    /** A key as the box's own listener reads it, cancelable as a real keydown is. */
    function keydown(box: HTMLInputElement, init: KeyboardEventInit): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
      box.dispatchEvent(event);
      render();
      return event;
    }

    it('hands focus to the filter toggle when Clear all clears the last filter', () => {
      component.expanded.set(true);
      render();
      // Today sets a start and an end date: two filters, so Clear all shows.
      find<HTMLButtonElement>('.quick-btn', 'Today').click();
      render();

      press(find<HTMLButtonElement>('.clear-btn', 'Clear all, with two filters set'));

      expect(root().querySelector('.clear-btn')).withContext('Clear all, with nothing left to clear').toBeNull();
      expect(root().querySelector('.filter-panel')).withContext('the panel, still open').not.toBeNull();
      expect(document.activeElement)
        .withContext('focus, after Clear all')
        .toBe(find('.filter-toggle', 'the filter toggle'));
    });

    /**
     * A held Enter's repeats go to whatever holds focus by then, and a
     * focused button presses itself on each. Focus handed on from the control
     * pressed had the next repeat press the control it landed on: the filter
     * toggle folded and unfolded the panel Clear all left open, and Save
     * search opened the box a close had just shut.
     */
    describe('an Enter held down through the hand-off', () => {
      function clearAllByEnter(): HTMLButtonElement {
        component.expanded.set(true);
        render();
        find<HTMLButtonElement>('.quick-btn', 'Today').click();
        render();
        const clear = find<HTMLButtonElement>('.clear-btn', 'Clear all, with two filters set');
        clear.focus();
        pressKey(clear, 'Enter');
        render();
        const toggle = find<HTMLButtonElement>('.filter-toggle', 'the filter toggle');
        expect(document.activeElement).withContext('focus, after Clear all').toBe(toggle);
        return toggle;
      }

      it('keeps the panel open through the repeats of an Enter held down on Clear all', () => {
        const toggle = clearAllByEnter();

        for (const n of [1, 2, 3]) {
          const repeat = pressKey(document.activeElement!, 'Enter', { repeat: true });
          render();
          expect(repeat.defaultPrevented).withContext(`repeat ${n}, cancelled`).toBeTrue();
          expect(root().querySelector('.filter-panel')).withContext(`the panel, after repeat ${n}`).not.toBeNull();
          // A held Space's repeat presses nothing itself, but it arms the
          // button it reaches for the keyup that ends the hold.
          expect(pressKey(document.activeElement!, ' ', { repeat: true }).defaultPrevented)
            .withContext(`a held Space's repeat ${n}, cancelled`)
            .toBeTrue();
        }
        expect(toggle.getAttribute('aria-expanded')).withContext('the toggle, after the repeats').toBe('true');
      });

      // A pin. Mutation: the guard never lets go, so it cancels a fresh Enter
      // as it does a repeat.
      it('closes the panel on a fresh Enter on the toggle once the Enter held on Clear all is let go (pin)', () => {
        const toggle = clearAllByEnter();
        toggle.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

        const fresh = pressKey(toggle, 'Enter');
        render();

        expect(fresh.defaultPrevented).withContext('a fresh Enter, cancelled').toBeFalse();
        expect(root().querySelector('.filter-panel')).withContext('the panel, after a fresh Enter').toBeNull();
      });

      // A pin. Mutation: the guard stands until the component goes, so every
      // held key's repeats on the page are lost after one hand-off.
      it('lets a held key repeat again once the Enter held on Clear all is let go (pin)', () => {
        const toggle = clearAllByEnter();
        toggle.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

        const later = pressKey(toggle, ' ', { repeat: true });

        expect(later.defaultPrevented).withContext('a repeat after the key is let go').toBeFalse();
      });

      const heldCloses = [
        { where: 'in the box', key: (box: HTMLInputElement): HTMLElement => box, saves: 1 },
        { where: "on the row's Save", key: (): HTMLElement => rowButtons()[0], saves: 1 },
        { where: "on the row's Cancel", key: (): HTMLElement => rowButtons()[1], saves: 0 },
      ] as const;
      for (const { where, key, saves } of heldCloses) {
        it(`keeps the box shut through the repeats of an Enter held down ${where}`, fakeAsync(() => {
          const bookmark = openOver('utilities');
          press(bookmark);
          flush(); // NgModel hands the box its value a microtask after it renders
          const held = key(find<HTMLInputElement>('.save-label-input', 'the save-search box'));
          held.focus();
          pressKey(held, 'Enter');
          render();
          flush();
          expect(root().querySelector('.save-search-row')).withContext(`the box, after an Enter ${where}`).toBeNull();
          expect(document.activeElement).withContext(`focus, after an Enter ${where}`).toBe(bookmark);

          for (const n of [1, 2, 3]) {
            const repeat = pressKey(document.activeElement!, 'Enter', { repeat: true });
            render();
            flush();
            expect(repeat.defaultPrevented).withContext(`repeat ${n}, cancelled`).toBeTrue();
            expect(root().querySelector('.save-search-row')).withContext(`the box, after repeat ${n}`).toBeNull();
          }
          expect(mockSearchHistory.saveSearch).withContext('saves').toHaveBeenCalledTimes(saves);
          flush();
        }));
      }
    });

    // ngOnInit clears the filters itself under showAll, on load, where no
    // press took focus anywhere and none may move.
    it('leaves focus where it is when the panel clears itself to show every transaction (pin)', fakeAsync(() => {
      const elsewhere = document.body.appendChild(document.createElement('button'));
      try {
        elsewhere.focus();
        const shown = TestBed.createComponent(TransactionFiltersComponent);
        const clear = spyOn(shown.componentInstance, 'clearFilters').and.callThrough();
        shown.componentInstance.showAll = true;
        shown.detectChanges();
        tick(); // ngOnInit's start, a timeout
        shown.detectChanges();
        TestBed.tick();

        expect(clear).withContext('the showAll start').toHaveBeenCalled();
        expect(document.activeElement).withContext('focus, after the panel cleared itself').toBe(elsewhere);
      } finally {
        elsewhere.remove();
      }
    }));

    it('keeps focus in the search box once a suggestion reached by ArrowDown applies', fakeAsync(() => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'starbucks')]);
      component.expanded.set(true);
      render();
      const search = find<HTMLInputElement>('.search-input', 'the search box');
      search.focus();
      search.dispatchEvent(new Event('focus'));
      render();
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      const apply = find<HTMLButtonElement>('.suggestion-apply', 'the suggestion');
      expect(document.activeElement).withContext('focus, on the suggestion').toBe(apply);

      // Enter on a focused button clicks it. A scripted click fires no
      // mousedown, so the row's preventDefault keeps nothing, as for Enter.
      apply.click();
      render();

      expect(component.filters.searchQuery).withContext('the query the suggestion applies').toBe('starbucks');
      expect(root().querySelector('.search-suggestions')).withContext('the suggestions, once one applies').toBeNull();
      expect(document.activeElement).withContext('focus, once the suggestion applies').toBe(search);
      flush();
    }));

    const enter = (box: HTMLInputElement) => {
      keydown(box, { key: 'Enter' });
    };
    const closes: readonly {
      how: string;
      /** What the box holds before the close: a typed name, or null for the query it opened with. */
      typed: string | null;
      close: (box: HTMLInputElement) => void;
      saved: readonly [query: string, label: string] | null;
    }[] = [
      { how: 'Enter in the box', typed: 'Bills', close: enter, saved: ['utilities', 'Bills'] },
      { how: 'Enter in the box, its suggested name kept', typed: null, close: enter, saved: ['utilities', 'utilities'] },
      // An emptied name saves under the query.
      { how: 'Enter in the box, its name emptied', typed: '', close: enter, saved: ['utilities', 'utilities'] },
      { how: "the row's Save", typed: 'Bills', close: () => press(rowButtons()[0]), saved: ['utilities', 'Bills'] },
      { how: "the row's Cancel", typed: 'Bills', close: () => press(rowButtons()[1]), saved: null },
      { how: 'Escape in the box', typed: 'Bills', close: box => keydown(box, { key: 'Escape' }), saved: null },
    ];
    for (const { how, typed, close, saved } of closes) {
      it(`gives focus back to Save search once ${how} closes the box`, fakeAsync(() => {
        const bookmark = openOver('utilities');
        press(bookmark);
        flush(); // NgModel hands the box its value a microtask after it renders
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');
        box.focus(); // where a click into the box leaves focus, so the case reads the close alone
        expect(document.activeElement).withContext('the box, focused before the close').toBe(box);
        if (typed === null) {
          expect(box.value).withContext('the box, holding the query as its name').toBe('utilities');
        } else {
          box.value = typed;
          box.dispatchEvent(new Event('input'));
        }

        close(box);

        expect(root().querySelector('.save-search-row')).withContext(`the box, after ${how}`).toBeNull();
        if (saved) expect(mockSearchHistory.saveSearch).toHaveBeenCalledOnceWith(...saved);
        else expect(mockSearchHistory.saveSearch).not.toHaveBeenCalled();
        expect(document.activeElement).withContext(`focus, after ${how}`).toBe(bookmark);
        flush();
      }));
    }

    // The search box's focus opens its suggestions under an empty query: the
    // reader was just in that box, and the suggestions are what it offers.
    it('gives focus to the search box, which opens its suggestions, once Cancel closes the box over an emptied query', fakeAsync(() => {
      mockSearchHistory.recentSearches.set([savedSearch('r1', 'gym')]);
      press(openOver('utilities'));
      flush();
      const search = find<HTMLInputElement>('.search-input', 'the search box');
      search.focus();
      search.value = '';
      search.dispatchEvent(new Event('input'));
      render();
      expect(root().querySelector('.save-search-button')).withContext('Save search, with no query to save').toBeNull();

      press(rowButtons()[1]);
      fixture.detectChanges();

      expect(root().querySelector('.save-search-row')).withContext('the box, after Cancel').toBeNull();
      expect(document.activeElement).withContext('focus, after Cancel').toBe(search);
      expect(root().querySelector('.search-suggestions'))
        .withContext('the suggestions, under the emptied search box')
        .not.toBeNull();
      flush(); // the search box's typing debounce
    }));

    // A button presses itself on Enter's keypress, which goes to whatever
    // holds focus once the keydown is done, unless the keydown was cancelled.
    // The Enter that saves hands focus to Save search, so it is cancelled.
    it('cancels the Enter that saves, and leaves an Enter that ends a composition to the IME', fakeAsync(() => {
      press(openOver('utilities'));
      flush();
      const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

      const composing = keydown(box, { key: 'Enter', isComposing: true });
      expect(mockSearchHistory.saveSearch).withContext('a save, on an Enter that ends a composition').not.toHaveBeenCalled();
      expect(composing.defaultPrevented).withContext('an Enter that ends a composition, cancelled').toBeFalse();

      const plain = keydown(box, { key: 'Enter' });
      expect(mockSearchHistory.saveSearch).withContext('a save, on a plain Enter').toHaveBeenCalledTimes(1);
      expect(plain.defaultPrevented).withContext('the Enter that saves, cancelled').toBeTrue();
      flush();
    }));

    /**
     * Save search opens a box whose one job is the name, so focus goes into
     * it, with the query it offers as the name selected: a typed name
     * replaces it, and Enter alone keeps it. Escape closes the box, unless it
     * ends a composition, which is the IME's.
     */
    describe('the save-search box, as it opens', () => {
      it('takes focus, its suggested name selected', fakeAsync(() => {
        press(openOver('utilities'));
        flush(); // NgModel hands the box its value a microtask after it renders
        fixture.detectChanges();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

        expect(document.activeElement).withContext('focus, as the box opens').toBe(box);
        expect(box.value).withContext('the box, holding the query as its name').toBe('utilities');
        expect([box.selectionStart, box.selectionEnd])
          .withContext('the selection, over the whole name')
          .toEqual([0, 'utilities'.length]);
      }));

      it('takes a typed name in place of its suggested one, and saves under it', fakeAsync(() => {
        const bookmark = openOver('utilities');
        press(bookmark);
        flush();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

        // The browser's own typing: into whatever holds focus, over whatever is selected there.
        document.execCommand('insertText', false, 'Bills');
        expect(box.value).withContext('the box, after typing').toBe('Bills');
        keydown(box, { key: 'Enter' });

        expect(mockSearchHistory.saveSearch).toHaveBeenCalledOnceWith('utilities', 'Bills');
        expect(document.activeElement).withContext('focus, after Enter').toBe(bookmark);
        flush();
      }));

      it('stays open through an Escape that ends a composition, and closes on a plain one', fakeAsync(() => {
        press(openOver('utilities'));
        flush();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

        keydown(box, { key: 'Escape', isComposing: true });
        expect(root().querySelector('.save-search-row'))
          .withContext('the box, after an Escape that ends a composition')
          .not.toBeNull();

        keydown(box, { key: 'Escape' });
        expect(root().querySelector('.save-search-row')).withContext('the box, after a plain Escape').toBeNull();
        flush();
      }));

      // A tap focuses nothing in WebKit, so a second tap on Save search finds
      // focus still in the box it takes away, as a scripted click does here.
      it('gives focus back to Save search once a second press on it closes the box, focus still in the box', fakeAsync(() => {
        const bookmark = openOver('utilities');
        press(bookmark);
        flush();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');
        expect(document.activeElement).withContext('the box, focused before the second press').toBe(box);

        bookmark.click();
        render();

        expect(root().querySelector('.save-search-row')).withContext('the box, after the second press').toBeNull();
        expect(mockSearchHistory.saveSearch).not.toHaveBeenCalled();
        expect(document.activeElement).withContext('focus, after the second press').toBe(bookmark);
        flush();
      }));

      // The press that closes the box hands focus to Save search itself, so
      // a held Enter's next repeat pressed it and opened the box again.
      it('stays shut through the repeats of an Enter held down on Save search to close the box', fakeAsync(() => {
        const bookmark = openOver('utilities');
        press(bookmark);
        flush();
        bookmark.focus(); // where Shift+Tab from the box lands

        pressKey(bookmark, 'Enter');
        render();
        flush();
        expect(root().querySelector('.save-search-row')).withContext('the box, after the press that closes it').toBeNull();

        for (const n of [1, 2, 3]) {
          const repeat = pressKey(document.activeElement!, 'Enter', { repeat: true });
          render();
          flush();
          expect(repeat.defaultPrevented).withContext(`repeat ${n}, cancelled`).toBeTrue();
          expect(root().querySelector('.save-search-row')).withContext(`the box, after repeat ${n}`).toBeNull();
        }
        expect(document.activeElement).withContext('focus, after the repeats').toBe(bookmark);
        expect(mockSearchHistory.saveSearch).not.toHaveBeenCalled();
      }));

      // A pin. Mutation: a fresh keydown leaves the guard standing, so a key
      // held in the box after a tap opened it types once and no more.
      it('lets a key held in the box repeat after a tap opened it (pin)', fakeAsync(() => {
        press(openOver('utilities'));
        flush();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

        keydown(box, { key: ' ' });
        const held = keydown(box, { key: ' ', repeat: true });

        expect(held.defaultPrevented).withContext('a held Space typed in the box').toBeFalse();
        flush();
      }));

      // A held Enter on Save search opens the box, and its repeats then reach
      // the box, which holds focus by then. A repeat that saved would hand
      // focus back to Save search, whose next repeat opens the box again, for
      // as long as the key is held. focusWhenRendered drops them, since the
      // press that opened the box handed focus into it.
      it('saves nothing on the repeat of an Enter held down from Save search', fakeAsync(() => {
        press(openOver('utilities'));
        flush();
        const box = find<HTMLInputElement>('.save-label-input', 'the save-search box');

        keydown(box, { key: 'Enter', repeat: true });

        expect(mockSearchHistory.saveSearch).withContext("a save, on a held Enter's repeat").not.toHaveBeenCalled();
        expect(root().querySelector('.save-search-row')).withContext('the box, after the repeat').not.toBeNull();
        flush();
      }));
    });

    /**
     * While the box was open, Save search and the box's own button both read
     * Save search, and the first closes the box unsaved. Save search keeps
     * its name and says with aria-expanded whether its box is open, as the
     * filter toggle says it of the panel; the box's own button reads Save.
     */
    describe('Save search and the box it opens, told apart', () => {
      it('says whether its box is open, through a press, a second press and the Enter that saves', fakeAsync(() => {
        const bookmark = openOver('utilities');
        expect(bookmark.getAttribute('aria-expanded')).withContext('before a press').toBe('false');

        press(bookmark);
        flush(); // NgModel hands the box its value a microtask after it renders
        expect(root().querySelector('.save-search-row')).withContext('the box a press opens').not.toBeNull();
        expect(bookmark.getAttribute('aria-expanded')).withContext('the box open').toBe('true');

        press(bookmark);
        expect(root().querySelector('.save-search-row')).withContext('the box a second press closes').toBeNull();
        expect(bookmark.getAttribute('aria-expanded')).withContext('after a second press').toBe('false');

        press(bookmark);
        flush();
        keydown(find<HTMLInputElement>('.save-label-input', 'the box, open again'), { key: 'Enter' });
        expect(mockSearchHistory.saveSearch).toHaveBeenCalledOnceWith('utilities', 'utilities');
        expect(bookmark.getAttribute('aria-expanded')).withContext('after the Enter that saves').toBe('false');
        flush();
      }));

      for (const l of ['en', 'ja', 'tc'] as const) {
        it(`names the box's Save apart from Save search, which keeps its name open or closed, in ${l}`, fakeAsync(() => {
          const t = catalogTranslator(l, { strict: true });
          mockTranslationService.t.and.callFake(catalogTranslator(l));
          // The translate pipe memoises on the locale and the catalog version;
          // the bump is what a catalog's arrival does, so en is read again too.
          locale.set(l);
          TestBed.inject(TranslationService).translationsVersion.update(version => version + 1);
          const bookmark = openOver('utilities');
          expect(accessibleName(bookmark)).withContext('Save search, the box closed').toBe(t('transactions.saveSearch'));

          press(bookmark);
          flush();
          const [save, cancel] = rowButtons();
          expect(accessibleName(bookmark)).withContext('Save search, the box open').toBe(t('transactions.saveSearch'));
          expect(accessibleName(save)).withContext("the box's Save").toBe(t('common.save'));
          expect(accessibleName(cancel)).withContext("the box's Cancel").toBe(t('common.cancel'));
          expect(new Set([bookmark, save, cancel].map(accessibleName)).size)
            .withContext('Save search, Save and Cancel, each its own name')
            .toBe(3);
        }));
      }
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

  // Karma serves none of the app's fonts, so each platform measures in its
  // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
  // to within a few pixels. Material's fields take their face from the
  // --mat-sys tokens rather than from the host. The width cases below pin it.
  function pinFieldFace(): void {
    const host = fixture.nativeElement as HTMLElement;
    const face = "Verdana, 'DejaVu Sans', sans-serif";
    host.style.fontFamily = face;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
      host.style.setProperty(token, face);
    }
  }

  /** Constrains the component's host so the grid inside the panel's padding is `width` px wide. */
  function layOutGrid(width: number): HTMLElement {
    const host = fixture.nativeElement as HTMLElement;
    const panel = getComputedStyle(host.querySelector('.filter-panel')!);
    host.style.width = `${width + parseFloat(panel.paddingInlineStart) + parseFloat(panel.paddingInlineEnd)}px`;
    const grid = host.querySelector<HTMLElement>('.filter-grid')!;
    expect(grid.getBoundingClientRect().width).withContext('the grid width, px').toBeCloseTo(width, 0);
    return grid;
  }

  function gridColumns(grid: HTMLElement): number {
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  }

  /**
   * Lays the grid out at the narrowest width that still sets two fields side
   * by side, where each track is at its floor, and returns that width. It is
   * searched for rather than worked out from the floor, since tracks stretch
   * to fill whatever width they are given and a floor too small would pass at
   * any width computed from the right one.
   */
  function layOutNarrowestTwoColumnGrid(): number {
    const SEARCH_FROM_PX = 400;
    const SEARCH_DOWN_TO_PX = 200;
    expect(gridColumns(layOutGrid(SEARCH_FROM_PX)))
      .withContext(`columns in a ${SEARCH_FROM_PX} px grid, where the search starts`)
      .toBe(2);
    let width = SEARCH_FROM_PX;
    while (width > SEARCH_DOWN_TO_PX && gridColumns(layOutGrid(width - 1)) === 2) {
      width--;
    }
    expect(gridColumns(layOutGrid(width - 1)))
      .withContext(`columns in a ${width - 1} px grid, the widest that no longer holds two`)
      .toBe(1);
    expect(gridColumns(layOutGrid(width))).withContext(`columns in a ${width} px grid, 1 px wider`).toBe(2);
    return width;
  }

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
      pinFieldFace();
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

  // The pickers read the root's adapter and the root's labels; no page brings
  // its own (#500).
  describe("the pickers' adapter and labels", () => {
    it('the From picker reads the root adapter and the root labels', () => {
      component.expanded.set(true);
      fixture.detectChanges();

      const from = fixture.debugElement.query(By.css('.filter-grid input.mat-datepicker-input'));
      expect(from).withContext('the From input').not.toBeNull();
      expect(from.injector.get(DateAdapter) === TestBed.inject(DateAdapter))
        .withContext("the From input's adapter is the root's")
        .toBeTrue();

      const toggles = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.filter-grid mat-datepicker-toggle button')
      );
      expect(toggles.length).withContext('the From and To calendar buttons').toBe(2);
      toggles.forEach((toggle, index) =>
        expect(toggle.getAttribute('aria-label'))
          .withContext(`the ${index === 0 ? 'From' : 'To'} calendar button's name`)
          .toBe('root')
      );
    });
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

    // 12 October 2026 as each of the reader's settings shows it. A two-digit
    // month and day, so every one is ten characters: eight digits and two
    // separators.
    const RENDERINGS: readonly { name: string; language: SupportedLocale; format: string; shown: string }[] = [
      { name: 'auto in English', language: 'en', format: DATE_FORMAT_AUTO, shown: '10/12/2026' },
      { name: 'auto in Japanese', language: 'ja', format: DATE_FORMAT_AUTO, shown: '2026/10/12' },
      { name: 'MM/DD/YYYY', language: 'en', format: 'MM/DD/YYYY', shown: '10/12/2026' },
      { name: 'DD/MM/YYYY', language: 'en', format: 'DD/MM/YYYY', shown: '12/10/2026' },
      { name: 'YYYY-MM-DD', language: 'en', format: 'YYYY-MM-DD', shown: '2026-10-12' }
    ];

    const host = () => fixture.nativeElement as HTMLElement;

    /** Opens the panel on 12 October 2026 to 12 October 2026, then lets ngModel hand each date input its value. */
    function render(): void {
      host().style.display = 'block';
      pinFieldFace();
      const filters: TransactionFilters = { startDate: new Date(2026, 9, 12), endDate: new Date(2026, 9, 12) };
      component.presetFilters = filters;
      component.ngOnChanges({ presetFilters: new SimpleChange(undefined, filters, false) });
      component.expanded.set(true);
      fixture.detectChanges();
      flush();
      fixture.detectChanges();
      settleAnimations(document);
    }

    /**
     * Turns the reader to a rendering's language and format, and lets the date
     * inputs follow. The pickers built the adapter inside the Angular zone, so
     * its effect is flushed there, by fixture.detectChanges().
     */
    function readAs(rendering: (typeof RENDERINGS)[number]): void {
      locale.set(rendering.language);
      dateFormat.set(rendering.format);
      fixture.detectChanges();
    }

    function dateInputs(): HTMLInputElement[] {
      const inputs = Array.from(host().querySelectorAll<HTMLInputElement>('.filter-grid input.mat-datepicker-input'));
      expect(inputs.length).withContext('the From and To inputs').toBe(2);
      return inputs;
    }

    function wrapperOf(element: Element): HTMLElement {
      return element.closest('mat-form-field')!.querySelector<HTMLElement>('.mat-mdc-text-field-wrapper')!;
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
      for (const { media, rule } of styleRules()) {
        if (!/\.filter-grid(?![\w-])/.test(rule.selectorText) || !rule.style.gridTemplateColumns) continue;
        if (media === null) {
          unconditional.push(rule.style.gridTemplateColumns);
        } else {
          underMedia.push(`@media ${media} { ${rule.style.gridTemplateColumns} }`);
        }
      }

      expect(underMedia)
        .withContext('.filter-grid tracks set under a media query, which reads the viewport, not the grid')
        .toEqual([]);
      expect(unconditional)
        .withContext('.filter-grid tracks set outside any media query')
        .toEqual([jasmine.stringMatching(/^repeat\(auto-fit, minmax\(min\(100%, .+\), 1fr\)\)$/)]);
    });

    it('shows From in Japanese once the reader turns to it, without a reload', fakeAsync(() => {
      render();
      const [from] = dateInputs();
      expect(from.value).withContext('in English').toBe('10/12/2026');

      locale.set('ja');
      fixture.detectChanges();

      expect(from.value).withContext('in Japanese').toBe('2026/10/12');
    }));

    it('shows From in the date format the reader chose', fakeAsync(() => {
      render();

      dateFormat.set('DD/MM/YYYY');
      fixture.detectChanges();

      expect(dateInputs()[0].value).toBe('12/10/2026');
    }));

    it("reads a date typed into From in the order the reader's format names its fields", fakeAsync(() => {
      render();
      dateFormat.set('DD/MM/YYYY');
      fixture.detectChanges();
      const emitted = spyOn(component.filtersChanged, 'emit');
      const [from] = dateInputs();

      from.value = '19/08/2026';
      from.dispatchEvent(new Event('input'));
      from.dispatchEvent(new Event('change'));

      expect(emitted).withContext('filters emitted').toHaveBeenCalledTimes(1);
      expect(emitted.calls.mostRecent().args[0]?.startDate).withContext('the start date').toEqual(new Date(2026, 7, 19));
    }));

    // The dates are what each rendering shows; the widths are pins. Bites
    // when the track's floor drops to calc(56px + 9ch): every rendering
    // then overflows its input.
    it('shows the whole of a ten-character date beside its calendar button in every rendering, at a 1024 px pane and on both phones', fakeAsync(() => {
      render();

      for (const rendering of RENDERINGS) {
        readAs(rendering);
        for (const width of GRID_WIDTHS_PX) {
          layOutGrid(width);
          dateInputs().forEach((input, index) => {
            const which = `${index === 0 ? 'From' : 'To'}, ${rendering.name}, in a ${width} px grid`;
            expect(input.value).withContext(`${which}: the date shown`).toBe(rendering.shown);
            expect(input.clientWidth).withContext(`${which}: the input's laid-out width, px`).toBeGreaterThan(0);
            expect(input.scrollWidth)
              .withContext(`${which}: width of the date, px, against the input's`)
              .toBeLessThanOrEqual(input.clientWidth);
          });
        }
      }
    }));

    it("gives a date field's end padding to its date, as Material does beside an icon suffix", fakeAsync(() => {
      render();
      layOutGrid(GRID_WIDTHS_PX[0]);

      for (const input of dateInputs()) {
        const wrapper = getComputedStyle(wrapperOf(input));
        expect(wrapper.paddingInlineStart).withContext('a date field: start padding').toBe('12px');
        expect(wrapper.paddingInlineEnd).withContext('a date field: end padding, beside the calendar button').toBe('0px');
      }
    }));

    // Pin: the compact padding stays on every field without a button.
    it('keeps the end padding of a compact field with no calendar button (pin)', fakeAsync(() => {
      render();
      layOutGrid(GRID_WIDTHS_PX[0]);

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
      const grid = layOutGrid(GRID_WIDTHS_PX[0]);

      expect(gridColumns(grid)).withContext('columns in a 702 px grid').toBeGreaterThan(1);

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
    // the test. Every digit of the pinned face is as wide as any other, so
    // each rendering is as wide as any date with its two separators.
    it('shows the whole of a date in every rendering in the narrowest grid that holds two columns (pin)', fakeAsync(() => {
      render();
      const width = layOutNarrowestTwoColumnGrid();

      const need = dateFieldNeedPx(dateInputs()[0]);
      for (const rendering of RENDERINGS) {
        readAs(rendering);
        dateInputs().forEach((input, index) => {
          const which = `${index === 0 ? 'From' : 'To'}, ${rendering.name}, in a ${width} px grid`;
          expect(input.value).withContext(`${which}: the date shown`).toBe(rendering.shown);
          expect(input.clientWidth).withContext(`${which}: the input's laid-out width, px`).toBeGreaterThan(0);
          expect(input.scrollWidth)
            .withContext(`${which}: width of the date, px, against the input's`)
            .toBeLessThanOrEqual(input.clientWidth);
          expect(input.closest('mat-form-field')!.getBoundingClientRect().width)
            .withContext(`${which}: field width, px, against what a date needs`)
            .toBeGreaterThanOrEqual(need - 0.5);
        });
      }
    }));
  });

  // The Tags field's hint shows once the field has focus, on an input's one
  // line, so it cannot wrap: it has to fit the room its input gives it. That
  // room is the input's content box as far as its field's infix reaches.
  // Material sets a chip input at 150 px or wider, so in a track under 174 px
  // the input runs past the infix, over the field's end padding and outline.
  // The widths are the grid's own, as in the date cases above: 312 px, read on
  // a 375 px phone, and 944 px, what a 1280 px pane leaves it (1280 less the
  // docked 256 px sidebar, an 8 px scrollbar, the page's two 24 px gutters and
  // the panel's two 12 px). Verdana's digits are wider than the app's own
  // face's, so in the pinned face 312 px holds one column where the phone
  // showed two; the narrowest grid that holds two is that phone's layout at
  // its tightest, and no track is narrower.
  describe("the Tags field's hint", () => {
    const GRID_WIDTHS_PX = [312, 944] as const;
    const host = () => fixture.nativeElement as HTMLElement;

    /** Opens the panel in a language, with the face pinned, and returns the Tags input. */
    function render(l: SupportedLocale): HTMLInputElement {
      mockTranslationService.t.and.callFake(catalogTranslator(l));
      // The translate pipe memoises on the locale and the catalog version.
      locale.set(l);
      TestBed.inject(TranslationService).translationsVersion.update(version => version + 1);
      host().style.display = 'block';
      pinFieldFace();
      component.expanded.set(true);
      fixture.detectChanges();
      flush();
      fixture.detectChanges();
      settleAnimations(document);
      const input = host().querySelector<HTMLInputElement>('.tags-field input.mat-mdc-chip-input');
      expect(input).withContext('the Tags input').not.toBeNull();
      return input!;
    }

    /** Where the hint is drawn, px: the input's content box, as far as its field's infix reaches. */
    const roomPx = (input: HTMLInputElement) => contentWidthPx(input, input.closest('.mat-mdc-form-field-infix')!);

    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`fits its input on a 375 px phone, in a 1280 px pane and in the narrowest two-column grid, in ${l}`, fakeAsync(() => {
        const input = render(l);
        expect(input.placeholder)
          .withContext("the hint, in the catalog's words")
          .toBe(catalogTranslator(l, { strict: true })('transactions.tagsPlaceholderShort'));
        const hint = placeholderWidthPx(input);
        expect(hint).withContext('the hint, px').toBeGreaterThan(0);

        for (const width of [...GRID_WIDTHS_PX, layOutNarrowestTwoColumnGrid()]) {
          layOutGrid(width);
          const room = roomPx(input);
          expect(room).withContext(`in a ${width} px grid: the room, px`).toBeGreaterThan(0);
          expect(hint)
            .withContext(`in a ${width} px grid: "${input.placeholder}", px, against its room`)
            .toBeLessThanOrEqual(room);
        }
      }));
    }
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
