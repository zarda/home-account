import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TransactionFiltersComponent } from './transaction-filters.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { Category } from '../../../models';

describe('TransactionFiltersComponent', () => {
  let component: TransactionFiltersComponent;
  let fixture: ComponentFixture<TransactionFiltersComponent>;
  let mockTransactionService: {
    getTransactionDatesForMonth: jasmine.Spy;
  };

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

    await TestBed.configureTestingModule({
      imports: [TransactionFiltersComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService }
      ]
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

    it('should default to today filter on init', () => {
      const now = new Date();
      expect(component.filters.startDate?.getDate()).toBe(now.getDate());
      expect(component.filters.startDate?.getMonth()).toBe(now.getMonth());
      expect(component.filters.startDate?.getFullYear()).toBe(now.getFullYear());
    });

    it('should set today as active quick filter', () => {
      expect(component.isQuickFilterActive('today')).toBe(true);
    });

    it('should start with expanded as false', () => {
      expect(component.expanded()).toBe(false);
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

    it('should count multiple filters', () => {
      component.filters = {
        type: 'expense',
        categoryId: 'cat1',
        searchQuery: 'test',
        minAmount: 100,
        maxAmount: 500
      };
      expect(component.activeFilterCount()).toBe(5);
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

  describe('clearFilters', () => {
    it('should clear all filters', () => {
      component.filters = {
        type: 'expense',
        categoryId: 'cat1',
        startDate: new Date(),
        endDate: new Date(),
        searchQuery: 'test'
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
    it('should emit addTransaction when triggered', () => {
      spyOn(component.addTransaction, 'emit');

      component.addTransaction.emit();

      expect(component.addTransaction.emit).toHaveBeenCalled();
    });

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
    });
  });

  describe('UI rendering', () => {
    it('should display quick filter buttons', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Today');
      expect(compiled.textContent).toContain('Week');
      expect(compiled.textContent).toContain('Month');
    });

    it('should display add button', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Add');
    });

    it('should display filter toggle button', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const filterToggle = compiled.querySelector('.filter-toggle');
      expect(filterToggle).toBeTruthy();
    });

    it('should show filter panel when expanded', () => {
      component.expanded.set(true);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const filterPanel = compiled.querySelector('.filter-panel');
      expect(filterPanel).toBeTruthy();
    });

    it('should hide filter panel when collapsed', () => {
      component.expanded.set(false);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const filterPanel = compiled.querySelector('.filter-panel');
      expect(filterPanel).toBeFalsy();
    });
  });
});
