import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RecurringTransactionsComponent } from './recurring-transactions.component';
import { RecurringService } from '../../../core/services/recurring.service';
import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RecurringTransaction, Category } from '../../../models';

describe('RecurringTransactionsComponent', () => {
  let component: RecurringTransactionsComponent;
  let fixture: ComponentFixture<RecurringTransactionsComponent>;
  let mockRecurringService: jasmine.SpyObj<RecurringService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

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
    }
  ];

  const mockRecurring: RecurringTransaction[] = [
    {
      id: 'rec1',
      userId: 'user1',
      name: 'Monthly Rent',
      type: 'expense',
      amount: 1500,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Apartment rent',
      frequency: { type: 'monthly', interval: 1, dayOfMonth: 1 },
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      isActive: true,
      lastProcessed: Timestamp.fromDate(new Date(2024, 5, 1)),
      nextOccurrence: Timestamp.fromDate(new Date(2024, 6, 1)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }
  ];

  beforeEach(async () => {
    mockRecurringService = jasmine.createSpyObj('RecurringService', [
      'getRecurring',
      'createRecurring',
      'deleteRecurring',
      'pauseRecurring',
      'resumeRecurring',
      'getFrequencyText'
    ]);
    mockRecurringService.getRecurring.and.returnValue(of(mockRecurring));
    mockRecurringService.createRecurring.and.returnValue(Promise.resolve('new-id'));
    mockRecurringService.deleteRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.pauseRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.resumeRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.getFrequencyText.and.returnValue('Every month on the 1st');

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories']);
    mockCategoryService.loadCategories.and.returnValue(of(mockCategories));

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'settings.recurringPaused': 'Recurring transaction paused',
        'settings.recurringResumed': 'Recurring transaction resumed',
        'settings.recurringCreated': 'Recurring transaction created',
        'settings.recurringDeleted': 'Recurring transaction deleted',
        'settings.deleteRecurringTitle': 'Delete Recurring Transaction',
        'settings.deleteRecurringMessage': 'Are you sure?',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'Food & Drinks': 'Food & Drinks'
      };
      return translations[key] || key;
    });

    await TestBed.configureTestingModule({
      imports: [RecurringTransactionsComponent, NoopAnimationsModule],
      providers: [
        { provide: RecurringService, useValue: mockRecurringService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(RecurringTransactionsComponent, {
        set: {
          template: '<div></div>',
          providers: [
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar },
            { provide: TranslationService, useValue: mockTranslationService }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringTransactionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load recurring transactions on init', () => {
      expect(mockRecurringService.getRecurring).toHaveBeenCalled();
    });

    it('should load categories on init', () => {
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should set isLoading to false after loading', () => {
      expect(component.isLoading()).toBeFalse();
    });

    it('should store loaded recurring transactions', () => {
      expect(component.recurringTransactions().length).toBe(1);
    });
  });

  describe('category helpers', () => {
    it('should get category name', () => {
      const name = component.getCategoryName('cat1');
      expect(name).toBe('Food & Drinks');
    });

    it('should return Unknown for missing category', () => {
      const name = component.getCategoryName('nonexistent');
      expect(name).toBe('Unknown');
    });

    it('should get category icon', () => {
      const icon = component.getCategoryIcon('cat1');
      expect(icon).toBe('restaurant');
    });

    it('should return default icon for missing category', () => {
      const icon = component.getCategoryIcon('nonexistent');
      expect(icon).toBe('category');
    });

    it('should get category color', () => {
      const color = component.getCategoryColor('cat1');
      expect(color).toBe('#FF5722');
    });

    it('should return default color for missing category', () => {
      const color = component.getCategoryColor('nonexistent');
      expect(color).toBe('#9E9E9E');
    });
  });

  describe('getFrequencyText', () => {
    it('should call service to get frequency text', () => {
      const text = component.getFrequencyText(mockRecurring[0]);
      expect(mockRecurringService.getFrequencyText).toHaveBeenCalledWith(mockRecurring[0].frequency);
      expect(text).toBe('Every month on the 1st');
    });
  });

  describe('toggleActive', () => {
    it('should pause active recurring transaction', fakeAsync(() => {
      const activeRecurring = { ...mockRecurring[0], isActive: true };

      component.toggleActive(activeRecurring);
      tick();

      expect(mockRecurringService.pauseRecurring).toHaveBeenCalledWith('rec1');
      expect(mockSnackBar.open).toHaveBeenCalledWith('Recurring transaction paused', 'Close', { duration: 2000 });
    }));

    it('should resume paused recurring transaction', fakeAsync(() => {
      const pausedRecurring = { ...mockRecurring[0], isActive: false };

      component.toggleActive(pausedRecurring);
      tick();

      expect(mockRecurringService.resumeRecurring).toHaveBeenCalledWith('rec1');
      expect(mockSnackBar.open).toHaveBeenCalledWith('Recurring transaction resumed', 'Close', { duration: 2000 });
    }));
  });

  describe('deleteRecurring', () => {
    it('should open confirm dialog', () => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should delete when confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(true) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);
      tick();

      expect(mockRecurringService.deleteRecurring).toHaveBeenCalledWith('rec1');
    }));

    it('should not delete when not confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);
      tick();

      expect(mockRecurringService.deleteRecurring).not.toHaveBeenCalled();
    }));
  });

  describe('openAddDialog', () => {
    it('should open add dialog', () => {
      const mockDialogRef = { afterClosed: () => of(null) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should create recurring when dialog returns result', fakeAsync(() => {
      const result = {
        name: 'New Recurring',
        type: 'expense' as const,
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: 'Test',
        frequency: { type: 'monthly' as const, interval: 1 },
        startDate: new Date()
      };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();
      tick();

      expect(mockRecurringService.createRecurring).toHaveBeenCalledWith(result);
      expect(mockSnackBar.open).toHaveBeenCalledWith('Recurring transaction created', 'Close', { duration: 2000 });
    }));
  });
});
