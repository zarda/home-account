import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { ReportsComponent } from './reports.component';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';

import {
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';

function selection(option: PeriodSelection['option'], start: Date, end: Date): PeriodSelection {
  return { option, start, end, label: '' };
}


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
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) =>
        t.amountInBaseCurrency ?? t.amount
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
    it('should start on the default This Month range', () => {
      const expected = defaultPeriodSelection();
      expect(component.dateRange().start.getTime()).toBe(expected.start.getTime());
      expect(component.dateRange().end.getTime()).toBe(expected.end.getTime());
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
    it('should update the date range and reload from a selector emission', () => {
      mockTransactionService.getByDateRange.calls.reset();
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, end));

      expect(component.dateRange()).toEqual({ start, end });
      expect(mockTransactionService.getByDateRange).toHaveBeenCalledWith(start, end);
    });

    it('should retain the selected option, which the insights tab needs', () => {
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, end));

      // dateRange used to be the only thing kept, which dropped the option the
      // trailing insight window is derived from.
      expect(component.selectedPeriod().option).toBe('custom');
      expect(component.selectedPeriod().start).toBe(start);
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

});
