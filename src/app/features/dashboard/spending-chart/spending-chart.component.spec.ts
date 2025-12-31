import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { SpendingChartComponent } from './spending-chart.component';
import { Category } from '../../../models';

describe('SpendingChartComponent', () => {
  let component: SpendingChartComponent;
  let fixture: ComponentFixture<SpendingChartComponent>;

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
    { categoryId: 'cat1', total: 500 },
    { categoryId: 'cat2', total: 300 },
    { categoryId: 'cat3', total: 200 }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpendingChartComponent, NoopAnimationsModule],
      providers: [provideCharts(withDefaultRegisterables())]
    }).compileComponents();

    fixture = TestBed.createComponent(SpendingChartComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('categoryTotals input', () => {
    it('should set category totals via setter', () => {
      component.categoryTotals = mockCategoryTotals;
      expect(component.categoryTotals).toEqual(mockCategoryTotals);
    });

    it('should handle empty array', () => {
      component.categoryTotals = [];
      expect(component.categoryTotals).toEqual([]);
    });
  });

  describe('categories input', () => {
    it('should set categories via setter', () => {
      component.categories = mockCategories;
      expect(component.categories).toEqual(mockCategories);
    });

    it('should handle empty array', () => {
      component.categories = [];
      expect(component.categories).toEqual([]);
    });
  });

  describe('topCategories', () => {
    it('should return first 6 categories', () => {
      const manyTotals = [
        { categoryId: 'cat1', total: 100 },
        { categoryId: 'cat2', total: 90 },
        { categoryId: 'cat3', total: 80 },
        { categoryId: 'cat4', total: 70 },
        { categoryId: 'cat5', total: 60 },
        { categoryId: 'cat6', total: 50 },
        { categoryId: 'cat7', total: 40 }
      ];
      component.categoryTotals = manyTotals;

      expect(component.topCategories().length).toBe(6);
      expect(component.topCategories()[0].categoryId).toBe('cat1');
      expect(component.topCategories()[5].categoryId).toBe('cat6');
    });

    it('should return all if less than 6', () => {
      component.categoryTotals = mockCategoryTotals;
      expect(component.topCategories().length).toBe(3);
    });
  });

  describe('totalSpending', () => {
    it('should calculate total spending', () => {
      component.categoryTotals = mockCategoryTotals;
      expect(component.totalSpending()).toBe(1000);
    });

    it('should return 0 for empty array', () => {
      component.categoryTotals = [];
      expect(component.totalSpending()).toBe(0);
    });
  });

  describe('chartData', () => {
    beforeEach(() => {
      component.categoryTotals = mockCategoryTotals;
      component.categories = mockCategories;
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
      component.categoryTotals = [{ categoryId: 'unknown', total: 100 }];
      const data = component.chartData();
      expect(data.labels).toContain('Unknown');
    });

    it('should use default color for missing category', () => {
      component.categoryTotals = [{ categoryId: 'unknown', total: 100 }];
      const data = component.chartData();
      expect(data.datasets[0].backgroundColor).toContain('#9E9E9E');
    });
  });

  describe('getCategoryName', () => {
    it('should return category name for valid id', () => {
      component.categories = mockCategories;
      expect(component.getCategoryName('cat1')).toBe('Food & Drinks');
    });

    it('should return Unknown for invalid id', () => {
      component.categories = mockCategories;
      expect(component.getCategoryName('invalid')).toBe('Unknown');
    });

    it('should return Unknown for empty categories', () => {
      component.categories = [];
      expect(component.getCategoryName('cat1')).toBe('Unknown');
    });
  });

  describe('getCategoryColor', () => {
    it('should return category color for valid id', () => {
      component.categories = mockCategories;
      expect(component.getCategoryColor('cat1')).toBe('#FF5722');
    });

    it('should return default gray for invalid id', () => {
      component.categories = mockCategories;
      expect(component.getCategoryColor('invalid')).toBe('#9E9E9E');
    });

    it('should return default gray for empty categories', () => {
      component.categories = [];
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
      component.categoryTotals = [];
      fixture.detectChanges();

      const emptyState = fixture.nativeElement.querySelector('app-empty-state');
      expect(emptyState).toBeTruthy();
    });

    it('should show chart when data exists', () => {
      component.categoryTotals = mockCategoryTotals;
      component.categories = mockCategories;
      fixture.detectChanges();

      const canvas = fixture.nativeElement.querySelector('canvas');
      expect(canvas).toBeTruthy();
    });

    it('should display title', () => {
      component.categoryTotals = mockCategoryTotals;
      component.categories = mockCategories;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Spending by Category');
    });

    it('should display legend items', () => {
      component.categoryTotals = mockCategoryTotals;
      component.categories = mockCategories;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Food & Drinks');
      expect(compiled.textContent).toContain('Transportation');
      expect(compiled.textContent).toContain('Shopping');
    });

    it('should display percentage in legend', () => {
      component.categoryTotals = mockCategoryTotals;
      component.categories = mockCategories;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('50.0%'); // 500/1000
      expect(compiled.textContent).toContain('30.0%'); // 300/1000
      expect(compiled.textContent).toContain('20.0%'); // 200/1000
    });
  });
});
