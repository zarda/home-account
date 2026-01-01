import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { MonthlyComparisonComponent } from './monthly-comparison.component';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';

describe('MonthlyComparisonComponent', () => {
  let component: MonthlyComparisonComponent;
  let fixture: ComponentFixture<MonthlyComparisonComponent>;

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount: 200,
      amountInBaseCurrency: 200,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Groceries',
      date: Timestamp.fromDate(new Date(2024, 5, 15)), // June
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    },
    {
      id: 't2',
      userId: 'user1',
      type: 'income',
      amount: 5000,
      amountInBaseCurrency: 5000,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat2',
      description: 'Salary June',
      date: Timestamp.fromDate(new Date(2024, 5, 1)), // June
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    },
    {
      id: 't3',
      userId: 'user1',
      type: 'expense',
      amount: 300,
      amountInBaseCurrency: 300,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'May expenses',
      date: Timestamp.fromDate(new Date(2024, 4, 15)), // May
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    },
    {
      id: 't4',
      userId: 'user1',
      type: 'income',
      amount: 4500,
      amountInBaseCurrency: 4500,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat2',
      description: 'Salary May',
      date: Timestamp.fromDate(new Date(2024, 4, 1)), // May
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    }
  ];

  beforeEach(async () => {
    const mockCurrencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      convert: (amount: number) => amount // 1:1 conversion for tests
    };

    await TestBed.configureTestingModule({
      imports: [MonthlyComparisonComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(MonthlyComparisonComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(MonthlyComparisonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('with no data', () => {
    beforeEach(() => {
      component.transactions = [];
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return false for hasData', () => {
      expect(component.hasData()).toBeFalse();
    });

    it('should compute averageIncome as 0', () => {
      expect(component.averageIncome()).toBe(0);
    });

    it('should compute averageExpense as 0', () => {
      expect(component.averageExpense()).toBe(0);
    });
  });

  describe('with transaction data', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return true for hasData', () => {
      expect(component.hasData()).toBeTrue();
    });

    it('should have 2 months of data', () => {
      const monthly = component.monthlyData();
      expect(monthly.length).toBe(2);
    });
  });

  describe('monthlyData computation', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should aggregate income per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.income).toBe(5000);
    });

    it('should aggregate expenses per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.expense).toBe(200);
    });

    it('should calculate balance per month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june?.balance).toBe(4800); // 5000 - 200
    });

    it('should calculate income change percentage', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      // (5000 - 4500) / 4500 * 100 = 11.11%
      expect(june?.incomeChange).toBeCloseTo(11.11, 1);
    });

    it('should calculate expense change percentage', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      // (200 - 300) / 300 * 100 = -33.33%
      expect(june?.expenseChange).toBeCloseTo(-33.33, 1);
    });

    it('should have null change for first month', () => {
      const monthly = component.monthlyData();
      const may = monthly.find(m => m.month.includes('May'));
      expect(may?.incomeChange).toBeNull();
      expect(may?.expenseChange).toBeNull();
    });
  });

  describe('summary statistics', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should calculate average income', () => {
      // (5000 + 4500) / 2 = 4750
      expect(component.averageIncome()).toBe(4750);
    });

    it('should calculate average expense', () => {
      // (200 + 300) / 2 = 250
      expect(component.averageExpense()).toBe(250);
    });

    it('should find best month', () => {
      const best = component.bestMonth();
      expect(best?.month).toContain('Jun'); // June has higher balance
    });

    it('should find worst month', () => {
      const worst = component.worstMonth();
      expect(worst?.month).toContain('May'); // May has lower balance
    });
  });

  describe('chartData', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.dateRange = { start: new Date(2024, 4, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should have labels for each month', () => {
      const data = component.chartData();
      expect(data.labels?.length).toBe(2);
    });

    it('should have income and expense datasets', () => {
      const data = component.chartData();
      expect(data.datasets.length).toBe(2);
      expect(data.datasets[0].label).toBe('Income');
      expect(data.datasets[1].label).toBe('Expenses');
    });

    it('should have correct data values', () => {
      const data = component.chartData();
      // First month is May
      expect(data.datasets[0].data[0]).toBe(4500); // May income
      expect(data.datasets[1].data[0]).toBe(300); // May expense
    });
  });
});
