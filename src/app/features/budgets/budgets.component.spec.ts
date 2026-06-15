import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { BudgetsComponent } from './budgets.component';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { TranslationService } from '../../core/services/translation.service';
import { BudgetFormComponent } from './budget-form/budget-form.component';
import { Budget } from '../../models';
import { createBudget, createCategory } from '../../core/services/testing';

describe('BudgetsComponent', () => {
  let budgetService: {
    budgets: ReturnType<typeof signal<Budget[]>>;
    getBudgets: jasmine.Spy;
    deleteBudget: jasmine.Spy;
  };
  let categoryService: {
    categories: ReturnType<typeof signal<ReturnType<typeof createCategory>[]>>;
    loadCategories: jasmine.Spy;
  };
  let dialog: jasmine.SpyObj<MatDialog>;

  function build() {
    return TestBed.createComponent(BudgetsComponent);
  }

  beforeEach(async () => {
    budgetService = {
      budgets: signal<Budget[]>([createBudget()]),
      getBudgets: jasmine.createSpy('getBudgets').and.returnValue(of([])),
      deleteBudget: jasmine.createSpy('deleteBudget').and.resolveTo(undefined),
    };
    categoryService = {
      categories: signal<ReturnType<typeof createCategory>[]>([]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    await TestBed.configureTestingModule({
      imports: [BudgetsComponent],
      providers: [
        { provide: BudgetService, useValue: budgetService },
        { provide: CategoryService, useValue: categoryService },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
      ],
    })
      .overrideComponent(BudgetsComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  it('should create', () => {
    expect(build().componentInstance).toBeTruthy();
  });

  it('computes the budget count and categories map', () => {
    categoryService.categories.set([createCategory({ id: 'c9' })]);
    const component = build().componentInstance;
    expect(component.budgetCount()).toBe(1);
    expect(component.categoriesMap().get('c9')?.id).toBe('c9');
  });

  it('ngOnInit loads categories when none are present and clears loading', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(categoryService.loadCategories).toHaveBeenCalled();
    expect(budgetService.getBudgets).toHaveBeenCalled();
    expect(fixture.componentInstance.isLoading()).toBeFalse();
  });

  it('ngOnInit skips loading categories when already present', () => {
    categoryService.categories.set([createCategory()]);
    const fixture = build();
    fixture.detectChanges();
    expect(categoryService.loadCategories).not.toHaveBeenCalled();
  });

  it('clears the loading flag when budget loading errors', () => {
    budgetService.getBudgets.and.returnValue(throwError(() => new Error('boom')));
    const fixture = build();
    fixture.detectChanges();
    expect(fixture.componentInstance.isLoading()).toBeFalse();
  });

  it('openAddDialog opens the budget form in add mode', () => {
    build().componentInstance.openAddDialog();
    expect(dialog.open).toHaveBeenCalledWith(BudgetFormComponent, jasmine.objectContaining({
      data: { mode: 'add' },
    }));
  });

  it('openEditDialog opens the budget form in edit mode', () => {
    const budget = createBudget();
    build().componentInstance.openEditDialog(budget);
    expect(dialog.open).toHaveBeenCalledWith(BudgetFormComponent, jasmine.objectContaining({
      data: { mode: 'edit', budget },
    }));
  });

  it('confirmDelete deletes when confirmed', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    const budget = createBudget({ id: 'b7' });
    build().componentInstance.confirmDelete(budget);
    expect(budgetService.deleteBudget).toHaveBeenCalledWith('b7');
  });

  it('confirmDelete does nothing when cancelled', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    build().componentInstance.confirmDelete(createBudget());
    expect(budgetService.deleteBudget).not.toHaveBeenCalled();
  });

  it('confirmDelete swallows delete errors', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    budgetService.deleteBudget.and.rejectWith(new Error('fail'));
    expect(() => build().componentInstance.confirmDelete(createBudget())).not.toThrow();
  });

  it('ngOnDestroy cleans up', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
