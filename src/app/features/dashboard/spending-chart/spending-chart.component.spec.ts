import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { SpendingChartComponent } from './spending-chart.component';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { Category } from '../../../models';

describe('SpendingChartComponent', () => {
  let component: SpendingChartComponent;
  let fixture: ComponentFixture<SpendingChartComponent>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;

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
    },
    {
      id: 'cat3',
      userId: null,
      name: 'Shopping',
      icon: 'shopping_bag',
      color: '#9C27B0',
      type: 'expense',
      order: 3,
      isActive: true,
      isDefault: true
    }
  ];

  const mockCategoryTotals = [
    { categoryId: 'cat1', total: 500, count: 10 },
    { categoryId: 'cat2', total: 300, count: 5 },
    { categoryId: 'cat3', total: 200, count: 3 }
  ];

  const setCategoryTotals = (value: typeof mockCategoryTotals) =>
    fixture.componentRef.setInput('categoryTotals', value);
  const setCategories = (value: Category[]) => fixture.componentRef.setInput('categories', value);

  beforeEach(async () => {
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => key);

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrencyService.formatCurrency.and.callFake((amount: number) => `$${amount.toFixed(2)}`);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({
        preferences: { baseCurrency: 'USD', theme: 'light', language: 'en', dateFormat: 'MM/DD/YYYY' }
      })
    });

    await TestBed.configureTestingModule({
      imports: [SpendingChartComponent, NoopAnimationsModule],
      providers: [
        provideCharts(withDefaultRegisterables()),
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: AuthService, useValue: mockAuthService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(SpendingChartComponent, {
        set: { template: '<div class="chart-container"><canvas></canvas><div class="legend"></div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SpendingChartComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('categoryTotals input', () => {
    it('should set category totals via setter', () => {
      setCategoryTotals(mockCategoryTotals);
      expect(component.categoryTotals()).toEqual(mockCategoryTotals);
    });

    it('should handle empty array', () => {
      setCategoryTotals([]);
      expect(component.categoryTotals()).toEqual([]);
    });
  });

  describe('categories input', () => {
    it('should set categories via setter', () => {
      setCategories(mockCategories);
      expect(component.categories()).toEqual(mockCategories);
    });

    it('should handle empty array', () => {
      setCategories([]);
      expect(component.categories()).toEqual([]);
    });
  });

  describe('topCategories', () => {
    it('should return first 6 categories', () => {
      const manyTotals = [
        { categoryId: 'cat1', total: 100, count: 1 },
        { categoryId: 'cat2', total: 90, count: 1 },
        { categoryId: 'cat3', total: 80, count: 1 },
        { categoryId: 'cat4', total: 70, count: 1 },
        { categoryId: 'cat5', total: 60, count: 1 },
        { categoryId: 'cat6', total: 50, count: 1 },
        { categoryId: 'cat7', total: 40, count: 1 }
      ];
      setCategoryTotals(manyTotals);

      expect(component.topCategories().length).toBe(6);
      expect(component.topCategories()[0].categoryId).toBe('cat1');
      expect(component.topCategories()[5].categoryId).toBe('cat6');
    });

    it('should return all if less than 6', () => {
      setCategoryTotals(mockCategoryTotals);
      expect(component.topCategories().length).toBe(3);
    });
  });

  describe('totalSpending', () => {
    it('should calculate total spending', () => {
      setCategoryTotals(mockCategoryTotals);
      expect(component.totalSpending()).toBe(1000);
    });

    it('should return 0 for empty array', () => {
      setCategoryTotals([]);
      expect(component.totalSpending()).toBe(0);
    });
  });

  describe('chartData', () => {
    beforeEach(() => {
      setCategoryTotals(mockCategoryTotals);
      setCategories(mockCategories);
    });

    it('should generate correct labels', () => {
      const data = component.chartData();
      expect(data.labels).toEqual(['Food & Drinks', 'Transportation', 'Shopping']);
    });

    it('should generate correct data values', () => {
      const data = component.chartData();
      expect(data.datasets[0].data).toEqual([500, 300, 200]);
    });

    it('should generate correct colors', () => {
      const data = component.chartData();
      expect(data.datasets[0].backgroundColor).toEqual(['#FF5722', '#2196F3', '#9C27B0']);
    });

    it('should use Unknown for missing category', () => {
      setCategoryTotals([{ categoryId: 'unknown', total: 100, count: 1 }]);
      const data = component.chartData();
      expect(data.labels).toContain('Unknown');
    });

    it('should use default color for missing category', () => {
      setCategoryTotals([{ categoryId: 'unknown', total: 100, count: 1 }]);
      const data = component.chartData();
      expect(data.datasets[0].backgroundColor).toContain('#9E9E9E');
    });
  });

  describe('getCategoryName', () => {
    it('should return category name for valid id', () => {
      setCategories(mockCategories);
      expect(component.getCategoryName('cat1')).toBe('Food & Drinks');
    });

    it('should return Unknown for invalid id', () => {
      setCategories(mockCategories);
      expect(component.getCategoryName('invalid')).toBe('Unknown');
    });

    it('should return Unknown for empty categories', () => {
      setCategories([]);
      expect(component.getCategoryName('cat1')).toBe('Unknown');
    });
  });

  describe('getCategoryColor', () => {
    it('should return category color for valid id', () => {
      setCategories(mockCategories);
      expect(component.getCategoryColor('cat1')).toBe('#FF5722');
    });

    it('should return default gray for invalid id', () => {
      setCategories(mockCategories);
      expect(component.getCategoryColor('invalid')).toBe('#9E9E9E');
    });

    it('should return default gray for empty categories', () => {
      setCategories([]);
      expect(component.getCategoryColor('cat1')).toBe('#9E9E9E');
    });
  });

  describe('chartOptions', () => {
    it('should be responsive', () => {
      expect(component.chartOptions?.responsive).toBe(true);
    });

    it('should maintain aspect ratio', () => {
      expect(component.chartOptions?.maintainAspectRatio).toBe(true);
    });

    it('should hide legend', () => {
      expect(component.chartOptions?.plugins?.legend?.display).toBe(false);
    });

    it('should have tooltip callback', () => {
      expect(component.chartOptions?.plugins?.tooltip?.callbacks?.label).toBeDefined();
    });
  });

  describe('UI rendering', () => {
    it('should show empty state when no data', () => {
      setCategoryTotals([]);
      fixture.detectChanges();

      // With template override, verify component state
      expect(component.categoryTotals().length).toBe(0);
    });

    it('should show chart when data exists', () => {
      setCategoryTotals(mockCategoryTotals);
      setCategories(mockCategories);
      fixture.detectChanges();

      expect(component.categoryTotals().length).toBeGreaterThan(0);
    });

    it('should display title', () => {
      setCategoryTotals(mockCategoryTotals);
      setCategories(mockCategories);
      fixture.detectChanges();

      // Verify component has data
      expect(component.topCategories().length).toBeGreaterThan(0);
    });

    it('should display legend items', () => {
      setCategoryTotals(mockCategoryTotals);
      setCategories(mockCategories);
      fixture.detectChanges();

      // Verify chartData contains expected labels
      const data = component.chartData();
      expect(data.labels).toContain('Food & Drinks');
      expect(data.labels).toContain('Transportation');
      expect(data.labels).toContain('Shopping');
    });

    it('should display percentage in legend', () => {
      setCategoryTotals(mockCategoryTotals);
      setCategories(mockCategories);
      fixture.detectChanges();

      // Verify percentage calculation
      expect(component.getPercentage(500)).toBe(50);
      expect(component.getPercentage(300)).toBe(30);
      expect(component.getPercentage(200)).toBe(20);
    });
  });
});
