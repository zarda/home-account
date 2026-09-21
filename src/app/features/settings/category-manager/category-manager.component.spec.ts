import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { CategoryManagerComponent } from './category-manager.component';
import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { Category } from '../../../models';
import { NotificationService } from '../../../core/services/notification.service';
import { createTranslationStub } from '../../../core/services/testing';

const mockCategoryList: Category[] = [
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

describe('CategoryManagerComponent', () => {
  let component: CategoryManagerComponent;
  let fixture: ComponentFixture<CategoryManagerComponent>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;

  const mockCategories = mockCategoryList;

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
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'settings.categoryCreated': 'Category created',
        'settings.categoryUpdated': 'Category updated',
        'settings.categoryDeleted': 'Category deleted',
        'settings.categoriesReordered': 'Categories reordered',
        'settings.categoryCreateFailed': 'Failed to create category',
        'settings.categoryUpdateFailed': 'Failed to update category',
        'settings.categoryDeleteFailed': 'Failed to delete category',
        'settings.categoriesReorderFailed': 'Failed to reorder categories',
        'settings.deleteCategory': 'Delete Category',
        'settings.deleteCategoryConfirm': 'Are you sure you want to delete this category?',
        'common.close': 'Close',
        'common.delete': 'Delete'
      };
      return translations[key] || key;
    });

    await TestBed.configureTestingModule({
      imports: [CategoryManagerComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: AnnouncerService, useValue: mockAnnouncer }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(CategoryManagerComponent, {
        set: {
          template: '<div></div>',
          providers: [
        { provide: NotificationService, useValue: notifications },
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar },
            { provide: TranslationService, useValue: mockTranslationService }
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

  describe('category stream lifecycle', () => {
    it('keeps the single live subscription across a full mutate cycle', fakeAsync(() => {
      const formResult = { name: 'X', icon: 'star', color: '#ffffff' };
      mockDialog.open.and.returnValue({ afterClosed: () => of(formResult) } as never);
      component.openAddDialog();
      tick();
      component.openEditDialog(mockCategories[0]);
      tick();
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      component.deleteCategory(mockCategories[0]);
      tick();
      component.onDrop({ previousIndex: 0, currentIndex: 1 } as never);
      tick();

      // The held onSnapshot stream carries every refresh; re-subscribing per
      // mutation used to stack a fresh listener on each action.
      expect(mockCategoryService.loadCategories).toHaveBeenCalledTimes(1);
    }));

    it('updates the list from later emissions and releases the stream on destroy', () => {
      const stream = new Subject<Category[]>();
      mockCategoryService.loadCategories.and.returnValue(stream);
      const freshFixture = TestBed.createComponent(CategoryManagerComponent);
      freshFixture.detectChanges();
      expect(stream.observed).toBeTrue();

      stream.next([mockCategories[0]]);
      expect(freshFixture.componentInstance.categories()).toEqual([mockCategories[0]]);

      freshFixture.destroy();
      expect(stream.observed).toBeFalse();
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

      expect(notifications.success).toHaveBeenCalledWith('Category created');
    }));

    // A rejected write used to vanish: no catch, so the dialog just closed and
    // the category never appeared.
    it('reports a failed create instead of closing silently', fakeAsync(() => {
      const result = { name: 'New Category', icon: 'star', color: '#FF0000' };
      mockDialog.open.and.returnValue({ afterClosed: () => of(result) } as never);
      mockCategoryService.addCategory.and.returnValue(Promise.reject(new Error('boom')));

      component.openAddDialog();
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to create category');
      expect(notifications.success).not.toHaveBeenCalled();
    }));
  });

  describe('openEditDialog', () => {
    it('pre-fills the dialog with the translated name for a built-in', () => {
      mockTranslationService.t.and.callFake((key: string) =>
        key === 'categoryNames.groceries' ? 'Groceries' : key);
      mockDialog.open.and.returnValue({ afterClosed: () => of(null) } as never);
      const builtIn = {
        ...mockCategories[0],
        name: 'categoryNames.groceries',
        isDefault: true,
        userId: null,
      } as Category;

      component.openEditDialog(builtIn);

      const data = (mockDialog.open.calls.mostRecent().args[1] as {
        data: { category: Category };
      }).data;
      // The user edits what they read on screen, not the raw i18n key.
      expect(data.category.name).toBe('Groceries');
    });

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

    it('reports a failed update instead of closing silently', fakeAsync(() => {
      const result = { name: 'Updated Name', icon: 'star', color: '#FF0000' };
      mockDialog.open.and.returnValue({ afterClosed: () => of(result) } as never);
      mockCategoryService.updateCategory.and.returnValue(Promise.reject(new Error('boom')));

      component.openEditDialog(mockCategories[0]);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to update category');
      expect(notifications.success).not.toHaveBeenCalled();
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

    it('reports a failed delete instead of closing silently', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      mockCategoryService.deleteCategory.and.returnValue(Promise.reject(new Error('boom')));

      component.deleteCategory(mockCategories[0]);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to delete category');
      expect(notifications.success).not.toHaveBeenCalled();
    }));
  });

  describe('onDrop', () => {
    it('reports a failed reorder instead of leaving the new order unsaved', fakeAsync(() => {
      mockCategoryService.reorderCategories.and.returnValue(Promise.reject(new Error('boom')));

      component.onDrop({ previousIndex: 0, currentIndex: 1 } as never);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to reorder categories');
      expect(notifications.success).not.toHaveBeenCalled();
    }));
  });
});

/**
 * The cases above override the template to `<div></div>` and drive the
 * component by calling its methods, so the manager's own chrome is unproven
 * by them: the type toggle that decides which categories the list shows, the
 * per-row overflow menu (where edit and delete actually live), the
 * default-category badge that also hides delete, and the empty state that
 * only appears once loading has finished.
 */
describe('CategoryManagerComponent, through its own template', () => {
  let fixture: ComponentFixture<CategoryManagerComponent>;
  let categories: jasmine.SpyObj<CategoryService>;
  let dialog: jasmine.SpyObj<MatDialog>;

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el().querySelectorAll('.category-item')) as HTMLElement[];
  const names = () =>
    Array.from(el().querySelectorAll('.category-name')).map(n => n.textContent?.trim());
  const toggle = (value: string) =>
    el().querySelector(`mat-button-toggle[value="${value}"] button`) as HTMLButtonElement;

  /**
   * The overflow menu renders into the CDK overlay, outside the fixture, so
   * a case that opened one closes it again.
   */
  function openMenu(index: number): HTMLElement {
    (rows()[index].querySelector('[aria-label="common.moreActions"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    return document.querySelector('.mat-mdc-menu-panel') as HTMLElement;
  }
  const menuItem = (panel: HTMLElement, label: string): HTMLButtonElement | undefined =>
    (Array.from(panel.querySelectorAll('button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  function setUp(list: Category[]): void {
    categories.loadCategories.and.returnValue(of(list));
    fixture = TestBed.createComponent(CategoryManagerComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    categories = jasmine.createSpyObj('CategoryService', [
      'loadCategories', 'addCategory', 'updateCategory', 'deleteCategory', 'reorderCategories',
    ]);
    categories.addCategory.and.resolveTo('new-id');
    categories.updateCategory.and.resolveTo();
    categories.deleteCategory.and.resolveTo();
    categories.reorderCategories.and.resolveTo();
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [CategoryManagerComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: CategoryService, useValue: categories },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
      ],
    }).compileComponents();
  });

  it('lists the expense categories it starts on, active ones only', () => {
    setUp(mockCategoryList);

    expect(names()).toEqual(['Food & Drinks', 'Transportation']);
    expect(el().querySelector('app-empty-state')).toBeNull();
  });

  it('swaps the list when the income toggle is chosen', () => {
    setUp(mockCategoryList);

    toggle('income').click();
    fixture.detectChanges();

    expect(names()).toEqual(['Salary']);
  });

  it('shows the spinner only while the first load is open', () => {
    const pending = new Subject<Category[]>();
    categories.loadCategories.and.returnValue(pending.asObservable());
    fixture = TestBed.createComponent(CategoryManagerComponent);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).not.toBeNull();
    expect(el().querySelector('app-empty-state')).toBeNull();

    pending.next([]);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).toBeNull();
    expect(el().querySelector('app-empty-state')).not.toBeNull();
  });

  it('offers the add dialog from the header and from the empty state', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    setUp([]);

    (el().querySelector('.manager-header button[mat-flat-button]') as HTMLButtonElement).click();
    expect(dialog.open).toHaveBeenCalledTimes(1);

    (el().querySelector('app-empty-state button') as HTMLButtonElement).click();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('badges a default category and refuses to offer its delete', () => {
    setUp([
      mockCategoryList[0],
      { ...mockCategoryList[1], id: 'built-in', name: 'Groceries', isDefault: true },
    ]);

    expect(rows()[0].querySelector('.default-badge')).toBeNull();
    expect(rows()[1].querySelector('.default-badge')?.textContent?.trim()).toBe('settings.default');

    const panel = openMenu(1);
    expect(menuItem(panel, 'common.edit')).toBeDefined();
    expect(menuItem(panel, 'common.delete')).toBeUndefined();
  });

  it('reaches the edit dialog through the row\'s own overflow menu', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    setUp(mockCategoryList);

    menuItem(openMenu(0), 'common.edit')?.click();

    expect(dialog.open).toHaveBeenCalled();
    const data = (dialog.open.calls.mostRecent().args[1] as { data: { category: Category } }).data;
    expect(data.category.id).toBe('cat1');
  });

  it('reaches the delete confirmation through the same menu', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    setUp(mockCategoryList);

    menuItem(openMenu(0), 'common.delete')?.click();

    expect(dialog.open).toHaveBeenCalled();
  });

  it('gives each row a drag handle so the order can be changed at all', () => {
    setUp(mockCategoryList);

    expect(el().querySelectorAll('.drag-handle').length).toBe(2);
    expect(el().querySelector('.categories-list')).not.toBeNull();
  });
});
