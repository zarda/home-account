import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { ReportsComponent } from './reports.component';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';

describe('ReportsComponent', () => {
  let component: ReportsComponent;
  let fixture: ComponentFixture<ReportsComponent>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    mockTransactionService = jasmine.createSpyObj('TransactionService', ['getByDateRange'], {
      transactions: signal([])
    });
    mockTransactionService.getByDateRange.and.returnValue(of([]));

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories'], {
      categories: signal([])
    });
    mockCategoryService.loadCategories.and.returnValue(of([]));

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({ preferences: { baseCurrency: 'USD' } })
    });

    const mockCurrencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' })
    };

    await TestBed.configureTestingModule({
      imports: [ReportsComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(ReportsComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ReportsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should start with thisMonth as selected period', () => {
      expect(component.selectedPeriod).toBe('thisMonth');
    });

    it('should load data on init', () => {
      expect(mockTransactionService.getByDateRange).toHaveBeenCalled();
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should have default tab index of 0', () => {
      expect(component.selectedTabIndex).toBe(0);
    });
  });

  describe('period selection', () => {
    it('should update date range when period changes', () => {
      const initialRange = component.dateRange();

      component.selectedPeriod = 'lastMonth';
      component.onPeriodChange();

      expect(component.dateRange()).not.toEqual(initialRange);
    });

    it('should clear custom period when changing to preset period', () => {
      component.customPeriod.set({ type: 'month', year: 2024, month: 5 });
      component.selectedPeriod = 'thisMonth';
      component.onPeriodChange();

      expect(component.customPeriod()).toBeNull();
    });

    it('should reload data when period changes', () => {
      mockTransactionService.getByDateRange.calls.reset();

      component.selectedPeriod = 'thisYear';
      component.onPeriodChange();

      expect(mockTransactionService.getByDateRange).toHaveBeenCalled();
    });
  });

  describe('computed values', () => {
    it('should return baseCurrency from user preferences', () => {
      expect(component.baseCurrency()).toBe('USD');
    });

    it('should compute totalIncome as 0 with no transactions', () => {
      expect(component.totalIncome()).toBe(0);
    });

    it('should compute totalExpenses as 0 with no transactions', () => {
      expect(component.totalExpenses()).toBe(0);
    });

    it('should compute balance as 0 with no transactions', () => {
      expect(component.balance()).toBe(0);
    });
  });

  describe('custom period', () => {
    it('should compute empty label when no custom period', () => {
      expect(component.customPeriodLabel()).toBe('');
    });

    it('should compute year label for year custom period', () => {
      component.customPeriod.set({ type: 'year', year: 2024 });
      expect(component.customPeriodLabel()).toBe('2024');
    });

    it('should compute month/year label for month custom period', () => {
      component.customPeriod.set({ type: 'month', year: 2024, month: 5 });
      expect(component.customPeriodLabel()).toBe('Jun 2024');
    });

    it('should clear custom period correctly', () => {
      component.customPeriod.set({ type: 'year', year: 2024 });
      component.clearCustomPeriod();

      expect(component.customPeriod()).toBeNull();
      expect(component.selectedPeriod).toBe('thisMonth');
    });
  });
});
