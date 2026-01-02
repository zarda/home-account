import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { SpendingAnalysisComponent } from './spending-analysis.component';
import { Transaction, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';

describe('SpendingAnalysisComponent', () => {
  let component: SpendingAnalysisComponent;
  let fixture: ComponentFixture<SpendingAnalysisComponent>;

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
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      order: 1,
      isActive: true,
      isDefault: true
    }
  ];

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount: 100,
      amountInBaseCurrency: 100,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Groceries',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
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
      description: 'Monthly Salary',
      date: Timestamp.fromDate(new Date(2024, 5, 1)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    }
  ];

  const mockCurrencyService = {
    currencies: signal([
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' }
    ]),
    getCurrencyInfo: (code: string) => {
      const currencies = [
        { code: 'USD', name: 'US Dollar', symbol: '$' },
        { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' }
      ];
      return currencies.find(c => c.code === code);
    },
    convert: (amount: number) => amount // 1:1 conversion for tests
  };

  const mockTranslationService = {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common.income': 'Income',
        'common.totalExpenses': 'Expenses'
      };
      return translations[key] || key;
    },
    getIntlLocale: () => 'en-US'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpendingAnalysisComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(SpendingAnalysisComponent, {
        set: {
          template: '<div></div>',
          providers: [{ provide: CurrencyService, useValue: mockCurrencyService }]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SpendingAnalysisComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('with no data', () => {
    beforeEach(() => {
      component.transactions = [];
      component.categories = [];
      component.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return false for hasData', () => {
      expect(component.hasData()).toBeFalse();
    });

    it('should compute totalIncome as 0', () => {
      expect(component.totalIncome()).toBe(0);
    });

    it('should compute totalExpenses as 0', () => {
      expect(component.totalExpenses()).toBe(0);
    });

    it('should compute savingsRate as 0', () => {
      expect(component.savingsRate()).toBe(0);
    });
  });

  describe('with transaction data', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return true for hasData', () => {
      expect(component.hasData()).toBeTrue();
    });

    it('should compute totalIncome correctly', () => {
      expect(component.totalIncome()).toBe(5000);
    });

    it('should compute totalExpenses correctly', () => {
      expect(component.totalExpenses()).toBe(100);
    });

    it('should compute netSavings correctly', () => {
      expect(component.netSavings()).toBe(4900);
    });

    it('should compute savingsRate correctly', () => {
      expect(component.savingsRate()).toBe(98); // 4900/5000 * 100
    });
  });

  describe('topCategories', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should return top expense categories', () => {
      const top = component.topCategories();
      expect(top.length).toBeGreaterThan(0);
      expect(top[0].categoryId).toBe('cat1');
    });

    it('should calculate percentage correctly', () => {
      const top = component.topCategories();
      expect(top[0].percentage).toBe(100); // Only one expense category
    });

    it('should include category name and color', () => {
      const top = component.topCategories();
      expect(top[0].name).toBe('Food & Drinks');
      expect(top[0].color).toBe('#FF5722');
    });
  });

  describe('chartData', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should have labels', () => {
      const data = component.chartData();
      expect(data.labels).toBeDefined();
      expect(data.labels!.length).toBeGreaterThan(0);
    });

    it('should have income and expense datasets', () => {
      const data = component.chartData();
      expect(data.datasets.length).toBe(2);
      expect(data.datasets[0].label).toBe('Income');
      expect(data.datasets[1].label).toBe('Expenses');
    });
  });

  describe('monthlyData', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
      fixture.detectChanges();
    });

    it('should aggregate monthly income and expenses', () => {
      const monthly = component.monthlyData();
      expect(monthly.length).toBeGreaterThan(0);

      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june).toBeDefined();
      expect(june!.income).toBe(5000);
      expect(june!.expense).toBe(100);
    });

    it('should calculate balance for each month', () => {
      const monthly = component.monthlyData();
      const june = monthly.find(m => m.month.includes('Jun'));
      expect(june!.balance).toBe(4900);
    });
  });
});
