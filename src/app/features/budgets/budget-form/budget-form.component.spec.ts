import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetFormComponent, BudgetFormDialogData } from './budget-form.component';
import { BudgetService } from '../../../core/services/budget.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { Budget, Category, User } from '../../../models';
import { of } from 'rxjs';

describe('BudgetFormComponent', () => {
  let component: BudgetFormComponent;
  let fixture: ComponentFixture<BudgetFormComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<BudgetFormComponent>>;
  let mockBudgetService: jasmine.SpyObj<BudgetService>;
  let mockCategoryService: {
    categories: ReturnType<typeof signal>;
    expenseCategories: ReturnType<typeof signal>;
    loadCategories: jasmine.Spy;
  };
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockAuthService: {
    currentUser: ReturnType<typeof signal>;
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

  const mockCurrencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$' }
  ];

  const mockTimestamp = {
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => Date.now(),
    isEqual: () => false,
    toJSON: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })
  } as unknown as Timestamp;

  const mockUser: User = {
    id: 'user1',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://example.com/photo.jpg',
    preferences: {
      baseCurrency: 'USD',
      theme: 'light',
      language: 'en',
      dateFormat: 'MM/DD/YYYY',
      defaultCategories: []
    },
    createdAt: mockTimestamp,
    lastLoginAt: mockTimestamp
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

  const setupTestBed = (dialogData: BudgetFormDialogData) => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    mockBudgetService = jasmine.createSpyObj('BudgetService', ['createBudget', 'updateBudget']);
    mockBudgetService.createBudget.and.returnValue(Promise.resolve('newBudgetId'));
    mockBudgetService.updateBudget.and.returnValue(Promise.resolve());

    mockCategoryService = {
      categories: signal(mockCategories),
      expenseCategories: signal(mockCategories),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([]))
    };

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies']);
    mockCurrencyService.getSupportedCurrencies.and.returnValue(mockCurrencies);

    mockAuthService = {
      currentUser: signal(mockUser)
    };

    return TestBed.configureTestingModule({
      imports: [BudgetFormComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: AuthService, useValue: mockAuthService }
      ]
    }).compileComponents();
  };

  describe('Add Mode', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize form with empty values', () => {
      expect(component.form.get('name')?.value).toBe('');
      expect(component.form.get('categoryId')?.value).toBe('');
      expect(component.form.get('amount')?.value).toBe('');
      expect(component.form.get('startDate')?.value).toBeNull();
    });

    it('should use default currency from user preferences', () => {
      expect(component.form.get('currency')?.value).toBe('USD');
    });

    it('should use default period as monthly', () => {
      expect(component.form.get('period')?.value).toBe('monthly');
    });

    it('should use default alert threshold of 80', () => {
      expect(component.form.get('alertThreshold')?.value).toBe(80);
    });

    it('should have expense categories available', () => {
      expect(component.expenseCategories()).toEqual(mockCategories);
    });

    it('should have currencies available', () => {
      expect(component.currencies).toEqual(mockCurrencies);
    });

    it('should have periods available', () => {
      expect(component.periods.length).toBe(3);
      expect(component.periods.map(p => p.value)).toEqual(['weekly', 'monthly', 'yearly']);
    });
  });

  describe('Edit Mode', () => {
    const existingBudget = createMockBudget({
      name: 'Existing Budget',
      categoryId: 'cat2',
      amount: 2000,
      currency: 'EUR',
      period: 'yearly',
      alertThreshold: 90
    });

    beforeEach(async () => {
      await setupTestBed({ mode: 'edit', budget: existingBudget });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should initialize form with budget values', () => {
      expect(component.form.get('name')?.value).toBe('Existing Budget');
      expect(component.form.get('categoryId')?.value).toBe('cat2');
      expect(component.form.get('amount')?.value).toBe(2000);
      expect(component.form.get('currency')?.value).toBe('EUR');
      expect(component.form.get('period')?.value).toBe('yearly');
      expect(component.form.get('alertThreshold')?.value).toBe(90);
    });

    it('should load startDate from existing budget', () => {
      const startDateValue = component.form.get('startDate')?.value;
      expect(startDateValue).toBeInstanceOf(Date);
    });
  });

  describe('Form Validation', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should require name', () => {
      const nameControl = component.form.get('name');
      expect(nameControl?.hasError('required')).toBe(true);

      nameControl?.setValue('Test Budget');
      expect(nameControl?.hasError('required')).toBe(false);
    });

    it('should require categoryId', () => {
      const categoryControl = component.form.get('categoryId');
      expect(categoryControl?.hasError('required')).toBe(true);

      categoryControl?.setValue('cat1');
      expect(categoryControl?.hasError('required')).toBe(false);
    });

    it('should require amount', () => {
      const amountControl = component.form.get('amount');
      expect(amountControl?.hasError('required')).toBe(true);

      amountControl?.setValue(100);
      expect(amountControl?.hasError('required')).toBe(false);
    });

    it('should require amount to be at least 0.01', () => {
      const amountControl = component.form.get('amount');
      amountControl?.setValue(0);
      expect(amountControl?.hasError('min')).toBe(true);

      amountControl?.setValue(0.01);
      expect(amountControl?.hasError('min')).toBe(false);
    });

    it('should be invalid when form is incomplete', () => {
      expect(component.form.valid).toBe(false);
    });

    it('should be valid when all required fields are filled', () => {
      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly'
      });
      expect(component.form.valid).toBe(true);
    });
  });

  describe('formatThreshold', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should format threshold as percentage', () => {
      expect(component.formatThreshold(80)).toBe('80%');
      expect(component.formatThreshold(50)).toBe('50%');
      expect(component.formatThreshold(100)).toBe('100%');
    });
  });

  describe('onSubmit in Add Mode', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should not submit if form is invalid', async () => {
      await component.onSubmit();
      expect(mockBudgetService.createBudget).not.toHaveBeenCalled();
    });

    it('should not submit if already submitting', async () => {
      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100
      });
      component.isSubmitting.set(true);

      await component.onSubmit();
      expect(mockBudgetService.createBudget).not.toHaveBeenCalled();
    });

    it('should call createBudget in add mode', async () => {
      component.form.patchValue({
        name: '  Test Budget  ',
        categoryId: 'cat1',
        amount: '100',
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80
      });

      await component.onSubmit();

      expect(mockBudgetService.createBudget).toHaveBeenCalledWith({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80
      });
    });

    it('should close dialog with true on success', async () => {
      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100
      });

      await component.onSubmit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should set isSubmitting during submission', fakeAsync(() => {
      mockBudgetService.createBudget.and.returnValue(
        new Promise(resolve => setTimeout(() => resolve('id'), 100))
      );

      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100
      });

      const submitPromise = component.onSubmit();
      expect(component.isSubmitting()).toBe(true);

      tick(100);
      submitPromise.then(() => {
        expect(component.isSubmitting()).toBe(false);
      });
    }));

    it('should reset isSubmitting on error', async () => {
      mockBudgetService.createBudget.and.returnValue(Promise.reject(new Error('Failed')));

      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100
      });

      await component.onSubmit();

      expect(component.isSubmitting()).toBe(false);
    });

    it('should include startDate in createBudget when provided', async () => {
      const customStartDate = new Date(2024, 0, 15); // Jan 15, 2024
      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80,
        startDate: customStartDate
      });

      await component.onSubmit();

      expect(mockBudgetService.createBudget).toHaveBeenCalledWith({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80,
        startDate: customStartDate
      });
    });

    it('should not include startDate in createBudget when null', async () => {
      component.form.patchValue({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80,
        startDate: null
      });

      await component.onSubmit();

      expect(mockBudgetService.createBudget).toHaveBeenCalledWith({
        name: 'Test Budget',
        categoryId: 'cat1',
        amount: 100,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80
      });
    });
  });

  describe('onSubmit in Edit Mode', () => {
    const existingBudget = createMockBudget();

    beforeEach(async () => {
      await setupTestBed({ mode: 'edit', budget: existingBudget });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should call updateBudget in edit mode', async () => {
      component.form.patchValue({
        name: 'Updated Budget',
        categoryId: 'cat2',
        amount: 2000
      });

      await component.onSubmit();

      expect(mockBudgetService.updateBudget).toHaveBeenCalledWith(
        'budget1',
        jasmine.objectContaining({
          name: 'Updated Budget',
          categoryId: 'cat2',
          amount: 2000
        })
      );
    });
  });

  describe('onCancel', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should close dialog with false', () => {
      component.onCancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });
  });

  describe('UI rendering', () => {
    beforeEach(async () => {
      await setupTestBed({ mode: 'add' });
      fixture = TestBed.createComponent(BudgetFormComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should display dialog title for add mode', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Create Budget');
    });

    it('should display form fields', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('input[formControlName="name"]')).toBeTruthy();
      expect(compiled.querySelector('mat-select[formControlName="categoryId"]')).toBeTruthy();
      expect(compiled.querySelector('input[formControlName="amount"]')).toBeTruthy();
      expect(compiled.querySelector('mat-select[formControlName="currency"]')).toBeTruthy();
      expect(compiled.querySelector('mat-select[formControlName="period"]')).toBeTruthy();
    });

    it('should display cancel and create buttons', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Cancel');
      expect(compiled.textContent).toContain('Create Budget');
    });
  });
});
