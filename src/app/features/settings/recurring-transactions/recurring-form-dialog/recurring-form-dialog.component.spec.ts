import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

import { RecurringFormDialogComponent } from './recurring-form-dialog.component';
import { CategoryService } from '../../../../core/services/category.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { Category, RecurringTransaction } from '../../../../models';

describe('RecurringFormDialogComponent', () => {
  let component: RecurringFormDialogComponent;
  let fixture: ComponentFixture<RecurringFormDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<RecurringFormDialogComponent>>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

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

  const mockCurrencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' }
  ];

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories']);
    mockCategoryService.loadCategories.and.returnValue(of(mockCategories));

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', [], {
      currencies: signal(mockCurrencies)
    });

    await TestBed.configureTestingModule({
      imports: [RecurringFormDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(RecurringFormDialogComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load categories on init', () => {
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should default to expense type', () => {
      expect(component.type).toBe('expense');
    });

    it('should default to monthly frequency', () => {
      expect(component.frequencyType).toBe('monthly');
    });

    it('should default interval to 1', () => {
      expect(component.interval).toBe(1);
    });

    it('should default currency to USD', () => {
      expect(component.currency).toBe('USD');
    });
  });

  describe('isEdit', () => {
    it('should return false when no recurring data', () => {
      expect(component.isEdit).toBeFalse();
    });

    it('should return true when recurring data provided', async () => {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: {
            recurring: {
              id: 'rec1',
              name: 'Test',
              type: 'expense',
              amount: 100,
              currency: 'USD',
              categoryId: 'cat1',
              description: '',
              frequency: { type: 'monthly', interval: 1 },
              startDate: Timestamp.now(),
              isActive: true
            } as RecurringTransaction
          }},
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService }
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      const editComponent = editFixture.componentInstance;
      editFixture.detectChanges();

      expect(editComponent.isEdit).toBeTrue();
    });
  });

  describe('title', () => {
    it('should show Add title when not editing', () => {
      expect(component.title).toBe('Add Recurring Transaction');
    });
  });

  describe('isValid', () => {
    it('should be invalid when name is empty', () => {
      component.name = '';
      component.amount = 100;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when amount is null', () => {
      component.name = 'Test';
      component.amount = null;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when amount is zero', () => {
      component.name = 'Test';
      component.amount = 0;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when categoryId is empty', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = '';
      expect(component.isValid).toBeFalse();
    });

    it('should be valid with required fields', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeTrue();
    });
  });

  describe('showDayOfWeek', () => {
    it('should be true for weekly frequency', () => {
      component.frequencyType = 'weekly';
      expect(component.showDayOfWeek).toBeTrue();
    });

    it('should be false for other frequencies', () => {
      component.frequencyType = 'monthly';
      expect(component.showDayOfWeek).toBeFalse();
    });
  });

  describe('showDayOfMonth', () => {
    it('should be true for monthly frequency', () => {
      component.frequencyType = 'monthly';
      expect(component.showDayOfMonth).toBeTrue();
    });

    it('should be true for yearly frequency', () => {
      component.frequencyType = 'yearly';
      expect(component.showDayOfMonth).toBeTrue();
    });

    it('should be false for daily frequency', () => {
      component.frequencyType = 'daily';
      expect(component.showDayOfMonth).toBeFalse();
    });
  });

  describe('frequencyPreview', () => {
    it('should show daily preview', () => {
      component.frequencyType = 'daily';
      component.interval = 1;
      expect(component.frequencyPreview).toBe('Every day');
    });

    it('should show daily preview with interval', () => {
      component.frequencyType = 'daily';
      component.interval = 3;
      expect(component.frequencyPreview).toBe('Every 3 days');
    });

    it('should show monthly preview', () => {
      component.frequencyType = 'monthly';
      component.interval = 1;
      component.dayOfMonth = 15;
      expect(component.frequencyPreview).toBe('Every month on the 15th');
    });

    it('should show yearly preview', () => {
      component.frequencyType = 'yearly';
      component.interval = 1;
      expect(component.frequencyPreview).toBe('Every year');
    });
  });

  describe('filteredCategories', () => {
    it('should filter expense categories', () => {
      component.type = 'expense';
      fixture.detectChanges();

      const filtered = component.filteredCategories();
      expect(filtered.every(c => c.type === 'expense' || c.type === 'both')).toBeTrue();
    });

    it('should filter income categories', () => {
      component.type = 'income';
      fixture.detectChanges();

      const filtered = component.filteredCategories();
      expect(filtered.every(c => c.type === 'income' || c.type === 'both')).toBeTrue();
    });
  });

  describe('onTypeChange', () => {
    it('should reset categoryId', () => {
      component.categoryId = 'cat1';
      component.onTypeChange();
      expect(component.categoryId).toBe('');
    });
  });

  describe('save', () => {
    it('should close dialog with result when valid', () => {
      component.name = 'Monthly Rent';
      component.amount = 1500;
      component.categoryId = 'cat1';
      component.type = 'expense';
      component.currency = 'USD';
      component.frequencyType = 'monthly';
      component.interval = 1;
      component.dayOfMonth = 1;
      component.startDate = new Date(2024, 0, 1);

      component.save();

      expect(mockDialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'Monthly Rent',
        amount: 1500,
        categoryId: 'cat1',
        type: 'expense',
        currency: 'USD'
      }));
    });

    it('should not close dialog when invalid', () => {
      component.name = '';
      component.amount = null;

      component.save();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should close dialog without result', () => {
      component.cancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith();
    });
  });
});
