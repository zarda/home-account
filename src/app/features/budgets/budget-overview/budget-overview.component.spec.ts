import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetOverviewComponent } from './budget-overview.component';
import { Budget, Category } from '../../../models';

describe('BudgetOverviewComponent', () => {
  let component: BudgetOverviewComponent;
  let fixture: ComponentFixture<BudgetOverviewComponent>;

  const mockTimestamp = {
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => Date.now(),
    isEqual: () => false,
    toJSON: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })
  } as unknown as Timestamp;

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

  const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
    id: 'budget1',
    userId: 'user1',
    name: 'Food Budget',
    categoryId: 'cat1',
    amount: 1000,
    spent: 500,
    currency: 'USD',
    period: 'monthly',
    alertThreshold: 80,
    isActive: true,
    startDate: mockTimestamp,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    ...overrides
  });

  let categoriesMap: Map<string, Category>;

  beforeEach(async () => {
    categoriesMap = new Map<string, Category>();
    mockCategories.forEach(cat => categoriesMap.set(cat.id, cat));

    await TestBed.configureTestingModule({
      imports: [BudgetOverviewComponent, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetOverviewComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.budgets = [];
    component.categories = categoriesMap;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('inputs', () => {
    it('should accept budgets input', () => {
      const budgets = [createMockBudget()];
      component.budgets = budgets;
      expect(component.budgets).toEqual(budgets);
    });

    it('should accept categories input', () => {
      component.categories = categoriesMap;
      expect(component.categories).toEqual(categoriesMap);
    });
  });

  describe('getCategory', () => {
    beforeEach(() => {
      component.categories = categoriesMap;
    });

    it('should return category for valid id', () => {
      const category = component.getCategory('cat1');
      expect(category).toEqual(mockCategories[0]);
    });

    it('should return undefined for invalid id', () => {
      const category = component.getCategory('invalid');
      expect(category).toBeUndefined();
    });

    it('should return correct category for different ids', () => {
      expect(component.getCategory('cat1')?.name).toBe('Food & Drinks');
      expect(component.getCategory('cat2')?.name).toBe('Transportation');
    });
  });

  describe('event emitters', () => {
    const mockBudget = createMockBudget();

    beforeEach(() => {
      component.budgets = [mockBudget];
      component.categories = categoriesMap;
      fixture.detectChanges();
    });

    it('should emit edit event', () => {
      const editSpy = spyOn(component.edit, 'emit');
      component.edit.emit(mockBudget);
      expect(editSpy).toHaveBeenCalledWith(mockBudget);
    });

    it('should emit delete event', () => {
      const deleteSpy = spyOn(component.delete, 'emit');
      component.delete.emit(mockBudget);
      expect(deleteSpy).toHaveBeenCalledWith(mockBudget);
    });
  });

  describe('UI rendering', () => {
    it('should render budget progress cards for each budget', () => {
      component.budgets = [
        createMockBudget({ id: '1', name: 'Budget 1' }),
        createMockBudget({ id: '2', name: 'Budget 2' }),
        createMockBudget({ id: '3', name: 'Budget 3' })
      ];
      component.categories = categoriesMap;
      fixture.detectChanges();

      const cards = fixture.nativeElement.querySelectorAll('app-budget-progress-card');
      expect(cards.length).toBe(3);
    });

    it('should render no cards when budgets is empty', () => {
      component.budgets = [];
      component.categories = categoriesMap;
      fixture.detectChanges();

      const cards = fixture.nativeElement.querySelectorAll('app-budget-progress-card');
      expect(cards.length).toBe(0);
    });

    it('should pass budget to each card', () => {
      const budget = createMockBudget();
      component.budgets = [budget];
      component.categories = categoriesMap;
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('app-budget-progress-card');
      expect(card).toBeTruthy();
    });
  });

  describe('integration with budget progress card', () => {
    it('should pass correct category to child component', () => {
      const budget = createMockBudget({ categoryId: 'cat1' });
      component.budgets = [budget];
      component.categories = categoriesMap;

      const category = component.getCategory(budget.categoryId);
      expect(category).toEqual(mockCategories[0]);
    });

    it('should handle missing category gracefully', () => {
      const budget = createMockBudget({ categoryId: 'unknown' });
      component.budgets = [budget];
      component.categories = categoriesMap;

      const category = component.getCategory(budget.categoryId);
      expect(category).toBeUndefined();
    });
  });
});
