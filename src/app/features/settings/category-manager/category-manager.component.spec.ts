import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { CategoryManagerComponent } from './category-manager.component';
import { CategoryService } from '../../../core/services/category.service';
import { Category } from '../../../models';

describe('CategoryManagerComponent', () => {
  let component: CategoryManagerComponent;
  let fixture: ComponentFixture<CategoryManagerComponent>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

  const mockCategories: Category[] = [
    {
      id: 'cat1',
      userId: 'user1',
      name: 'Food & Drinks',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: false
    },
    {
      id: 'cat2',
      userId: 'user1',
      name: 'Transportation',
      icon: 'directions_car',
      color: '#2196F3',
      type: 'expense',
      order: 2,
      isActive: true,
      isDefault: false
    },
    {
      id: 'cat3',
      userId: 'user1',
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      order: 1,
      isActive: true,
      isDefault: false
    },
    {
      id: 'cat4',
      userId: 'user1',
      name: 'Inactive Category',
      icon: 'block',
      color: '#9E9E9E',
      type: 'expense',
      order: 3,
      isActive: false,
      isDefault: false
    }
  ];

  beforeEach(async () => {
    mockCategoryService = jasmine.createSpyObj('CategoryService', [
      'loadCategories',
      'addCategory',
      'updateCategory',
      'deleteCategory',
      'reorderCategories'
    ]);
    mockCategoryService.loadCategories.and.returnValue(of(mockCategories));
    mockCategoryService.addCategory.and.returnValue(Promise.resolve('new-id'));
    mockCategoryService.updateCategory.and.returnValue(Promise.resolve());
    mockCategoryService.deleteCategory.and.returnValue(Promise.resolve());
    mockCategoryService.reorderCategories.and.returnValue(Promise.resolve());

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [CategoryManagerComponent, NoopAnimationsModule],
      providers: [
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(CategoryManagerComponent, {
        set: {
          template: '<div></div>',
          providers: [
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(CategoryManagerComponent);
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

    it('should set isLoading to false after loading', () => {
      expect(component.isLoading()).toBeFalse();
    });

    it('should store loaded categories', () => {
      expect(component.categories().length).toBe(4);
    });

    it('should default to expense type', () => {
      expect(component.selectedType).toBe('expense');
    });
  });

  describe('filteredCategories', () => {
    it('should filter by expense type', () => {
      component.selectedType = 'expense';
      const filtered = component.filteredCategories;

      expect(filtered.every(c => c.type === 'expense' || c.type === 'both')).toBeTrue();
    });

    it('should filter by income type', () => {
      component.selectedType = 'income';
      const filtered = component.filteredCategories;

      expect(filtered.every(c => c.type === 'income' || c.type === 'both')).toBeTrue();
    });

    it('should only include active categories', () => {
      const filtered = component.filteredCategories;
      expect(filtered.every(c => c.isActive)).toBeTrue();
    });

    it('should sort by order', () => {
      component.selectedType = 'expense';
      const filtered = component.filteredCategories;

      for (let i = 1; i < filtered.length; i++) {
        expect(filtered[i].order).toBeGreaterThanOrEqual(filtered[i - 1].order);
      }
    });
  });

  describe('openAddDialog', () => {
    it('should open dialog with type data', () => {
      const mockDialogRef = { afterClosed: () => of(null) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();

      expect(mockDialog.open).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({
          data: { type: 'expense' }
        })
      );
    });

    it('should add category on dialog close with result', fakeAsync(() => {
      const result = { name: 'New Category', icon: 'star', color: '#FF0000' };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();
      tick();

      expect(mockCategoryService.addCategory).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'New Category',
        icon: 'star',
        color: '#FF0000',
        type: 'expense'
      }));
    }));

    it('should show snackbar after adding category', fakeAsync(() => {
      const result = { name: 'New Category', icon: 'star', color: '#FF0000' };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();
      tick();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Category created', 'Close', { duration: 2000 });
    }));
  });

  describe('openEditDialog', () => {
    it('should open dialog with category data', () => {
      const mockDialogRef = { afterClosed: () => of(null) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openEditDialog(mockCategories[0]);

      expect(mockDialog.open).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({
          data: { category: mockCategories[0], type: 'expense' }
        })
      );
    });

    it('should update category on dialog close with result', fakeAsync(() => {
      const result = { name: 'Updated Name', icon: 'star', color: '#FF0000' };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openEditDialog(mockCategories[0]);
      tick();

      expect(mockCategoryService.updateCategory).toHaveBeenCalledWith('cat1', {
        name: 'Updated Name',
        icon: 'star',
        color: '#FF0000'
      });
    }));
  });

  describe('deleteCategory', () => {
    it('should open confirm dialog', () => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteCategory(mockCategories[0]);

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should delete category when confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(true) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteCategory(mockCategories[0]);
      tick();

      expect(mockCategoryService.deleteCategory).toHaveBeenCalledWith('cat1');
    }));

    it('should not delete category when not confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteCategory(mockCategories[0]);
      tick();

      expect(mockCategoryService.deleteCategory).not.toHaveBeenCalled();
    }));
  });
});
