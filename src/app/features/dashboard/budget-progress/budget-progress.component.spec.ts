import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressComponent } from './budget-progress.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { Budget, Category, Transaction } from '../../../models';

describe('BudgetProgressComponent', () => {
  let component: BudgetProgressComponent;
  let fixture: ComponentFixture<BudgetProgressComponent>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockCategoryHelperService: jasmine.SpyObj<CategoryHelperService>;

  const mockTimestamp = {
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => Date.now(),
    isEqual: () => false,
    toJSON: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })
  } as unknown as Timestamp;

  const mockCategory: Category = {
    id: 'cat1',
    userId: null,
    name: 'Food & Drinks',
    icon: 'restaurant',
    color: '#FF5722',
    type: 'expense',
    order: 1,
    isActive: true,
    isDefault: true
  };

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

  const createMockTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'tx1',
    userId: 'user1',
    type: 'expense',
    amount: 100,
    amountInBaseCurrency: 100,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'Test transaction',
    date: mockTimestamp,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    isRecurring: false,
    ...overrides
  });

  beforeEach(async () => {
    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'convert']);
    mockCurrencyService.formatCurrency.and.callFake((amount: number, currency: string) =>
      `${currency} ${amount.toFixed(2)}`
    );
    // Default conversion: USD to EUR at rate 0.92
    mockCurrencyService.convert.and.callFake((amount: number, from: string, to: string) => {
      if (from === to) return amount;
      if (from === 'USD' && to === 'EUR') return amount * 0.92;
      if (from === 'EUR' && to === 'USD') return amount / 0.92;
      return amount;
    });

    mockCategoryHelperService = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor'
    ]);
    mockCategoryHelperService.getCategoryName.and.returnValue('Food & Drinks');
    mockCategoryHelperService.getCategoryIcon.and.returnValue('restaurant');
    mockCategoryHelperService.getCategoryColor.and.returnValue('#FF5722');

    await TestBed.configureTestingModule({
      imports: [BudgetProgressComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: CategoryHelperService, useValue: mockCategoryHelperService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetProgressComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('getCategoryName', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      component.categories = categories;

      const result = component.getCategoryName('cat1');

      expect(mockCategoryHelperService.getCategoryName).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('Food & Drinks');
    });
  });

  describe('getCategoryIcon', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      component.categories = categories;

      const result = component.getCategoryIcon('cat1');

      expect(mockCategoryHelperService.getCategoryIcon).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('restaurant');
    });
  });

  describe('getCategoryColor', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      component.categories = categories;

      const result = component.getCategoryColor('cat1');

      expect(mockCategoryHelperService.getCategoryColor).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('#FF5722');
    });
  });

  describe('formatAmount', () => {
    it('should delegate to CurrencyService', () => {
      const result = component.formatAmount(1234.56, 'USD');

      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(1234.56, 'USD');
      expect(result).toBe('USD 1234.56');
    });
  });

  describe('getBudgetSpent', () => {
    it('should calculate spent from transactions', () => {
      const budget = createMockBudget({ categoryId: 'cat1', currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 100, currency: 'USD' }),
        createMockTransaction({ categoryId: 'cat1', amount: 200, currency: 'USD' }),
        createMockTransaction({ categoryId: 'cat2', amount: 50, currency: 'USD' }) // different category
      ];

      expect(component.getBudgetSpent(budget)).toBe(300);
    });

    it('should only count expense transactions', () => {
      const budget = createMockBudget({ categoryId: 'cat1', currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', type: 'expense', amount: 100, currency: 'USD' }),
        createMockTransaction({ categoryId: 'cat1', type: 'income', amount: 500, currency: 'USD' })
      ];

      expect(component.getBudgetSpent(budget)).toBe(100);
    });

    it('should return 0 when no matching transactions', () => {
      const budget = createMockBudget({ categoryId: 'cat1' });
      component.transactions = [];

      expect(component.getBudgetSpent(budget)).toBe(0);
    });

    it('should convert spent to budget currency when different from transaction currency', () => {
      // Budget is in EUR, transactions are in USD
      const budget = createMockBudget({ categoryId: 'cat1', currency: 'EUR' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 100, currency: 'USD' })
      ];

      // 100 USD * 0.92 = 92 EUR
      expect(component.getBudgetSpent(budget)).toBe(92);
      expect(mockCurrencyService.convert).toHaveBeenCalledWith(100, 'USD', 'EUR');
    });

    it('should not convert when transaction currency matches budget currency', () => {
      const budget = createMockBudget({ categoryId: 'cat1', currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 100, currency: 'USD' })
      ];

      expect(component.getBudgetSpent(budget)).toBe(100);
      // convert is still called but returns same amount (from === to)
      expect(mockCurrencyService.convert).toHaveBeenCalledWith(100, 'USD', 'USD');
    });
  });

  describe('getPercentage', () => {
    it('should calculate correct percentage', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 1000, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 500, currency: 'USD' })
      ];
      expect(component.getPercentage(budget)).toBe(50);
    });

    it('should return 0 when amount is 0', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 0, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 100, currency: 'USD' })
      ];
      expect(component.getPercentage(budget)).toBe(0);
    });

    it('should cap at 100', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 200, currency: 'USD' })
      ];
      expect(component.getPercentage(budget)).toBe(100);
    });
  });

  describe('getProgressColor', () => {
    it('should return primary for under 80%', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 50, currency: 'USD' })
      ];
      expect(component.getProgressColor(budget)).toBe('primary');
    });

    it('should return accent for 80-99%', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 85, currency: 'USD' })
      ];
      expect(component.getProgressColor(budget)).toBe('accent');
    });

    it('should return warn for 100% and over', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 110, currency: 'USD' })
      ];
      expect(component.getProgressColor(budget)).toBe('warn');
    });
  });

  describe('getRemainingText', () => {
    it('should show remaining when under budget', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 1000, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 300, currency: 'USD' })
      ];
      const text = component.getRemainingText(budget);
      expect(text).toContain('left');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(700, 'USD');
    });

    it('should show over when over budget', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 150, currency: 'USD' })
      ];
      const text = component.getRemainingText(budget);
      expect(text).toContain('over');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(50, 'USD');
    });
  });

  describe('getPercentageClass', () => {
    it('should return green for under 80%', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 50, currency: 'USD' })
      ];
      expect(component.getPercentageClass(budget)).toBe('text-green-600');
    });

    it('should return yellow for 80-99%', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 85, currency: 'USD' })
      ];
      expect(component.getPercentageClass(budget)).toBe('text-yellow-600');
    });

    it('should return red for 100% and over', () => {
      const budget = createMockBudget({ categoryId: 'cat1', amount: 100, currency: 'USD' });
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 110, currency: 'USD' })
      ];
      expect(component.getPercentageClass(budget)).toBe('text-red-600');
    });
  });

  describe('UI rendering', () => {
    beforeEach(() => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      component.categories = categories;
      component.budgets = [createMockBudget({ categoryId: 'cat1', currency: 'USD' })];
      component.transactions = [
        createMockTransaction({ categoryId: 'cat1', amount: 500, currency: 'USD' })
      ];
      fixture.detectChanges();
    });

    it('should display budget progress card', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('mat-card')).toBeTruthy();
    });

    it('should display title', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // Check for translation key or translated text
      expect(compiled.textContent?.includes('Budget Progress') || compiled.textContent?.includes('dashboard.budgetProgress')).toBe(true);
    });

    it('should display manage link', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // Check for translation key or translated text
      expect(compiled.textContent?.includes('Manage') || compiled.textContent?.includes('budget.manage')).toBe(true);
    });

    it('should display budget name', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Food Budget');
    });

    it('should display progress bar', () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar).toBeTruthy();
    });

    it('should render multiple budgets', () => {
      component.budgets = [
        createMockBudget({ id: '1', name: 'Budget 1' }),
        createMockBudget({ id: '2', name: 'Budget 2' })
      ];
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Budget 1');
      expect(compiled.textContent).toContain('Budget 2');
    });
  });
});
