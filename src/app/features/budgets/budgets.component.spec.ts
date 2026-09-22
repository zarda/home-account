import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { TabStripScrollDirective } from '../../shared/directives/tab-strip-scroll.directive';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BUDGET_TABS, BudgetsComponent } from './budgets.component';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { BudgetFormComponent } from './budget-form/budget-form.component';
import { Budget } from '../../models';
import { createBudget, createCategory, createTranslationStub } from '../../core/services/testing';

/** Query params the sibling rendering describe re-points between cases. */
const budgetQueryParams: { value: Record<string, string> } = { value: {} };

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

  // Read lazily, so a test can set the params after TestBed is configured but
  // before the component reads them at construction.
  let queryParams: Record<string, string>;
  const activatedRouteStub = {
    get snapshot() {
      return { queryParamMap: convertToParamMap(queryParams) };
    }
  };

  function build() {
    return TestBed.createComponent(BudgetsComponent);
  }

  beforeEach(async () => {
    queryParams = {};
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
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: BudgetService, useValue: budgetService },
        { provide: CategoryService, useValue: categoryService },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info'])
        },
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

  it('confirmDelete reports a failed delete instead of swallowing it', fakeAsync(() => {
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    budgetService.deleteBudget.and.rejectWith(new Error('fail'));
    spyOn(console, 'error');

    build().componentInstance.confirmDelete(createBudget());
    tick();

    const notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
    expect(notifications.error).toHaveBeenCalledWith('common.error');
    expect(console.error).toHaveBeenCalled();
  }));

  it('ngOnDestroy cleans up', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });

  describe('?tab=', () => {
    it('opens the budgets tab by default', () => {
      expect(build().componentInstance.selectedTabIndex).toBe(0);
    });

    it('opens the tab the data hub links at', () => {
      queryParams = { tab: 'recurring' };

      expect(build().componentInstance.selectedTabIndex).toBe(BUDGET_TABS.indexOf('recurring'));
    });

    it('opens the first tab for a name it does not have', () => {
      queryParams = { tab: 'nonsense' };

      expect(build().componentInstance.selectedTabIndex).toBe(0);
    });

    // That BUDGET_TABS still describes the strip it names is asserted in
    // app.smoke.spec.ts, which is the only place the real template renders —
    // this spec stubs it out.
  });
});

/**
 * Every case above compiles the page with `{ imports: [], template: '' }`, so
 * the three-tab strip, the count badge, the three-way budget gate and the
 * add-budget control have never rendered. The badge in particular is a
 * template-only `@if` that nothing else evaluates.
 *
 * Partial render: the three feature children are left unresolved. Each has
 * its own spec, and none is asserted about here beyond existing.
 */
describe('BudgetsComponent, through its own template', () => {
  let fixture: ComponentFixture<BudgetsComponent>;
  let component: BudgetsComponent;
  let budgets: ReturnType<typeof signal<Budget[]>>;
  let dialogSpy: jasmine.SpyObj<MatDialog>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const tabHeaders = () => Array.from(el().querySelectorAll('.mdc-tab')) as HTMLElement[];

  function render(): void {
    fixture = TestBed.createComponent(BudgetsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    budgetQueryParams.value = {};
    budgets = signal<Budget[]>([createBudget()]);
    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    dialogSpy.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

    await TestBed.configureTestingModule({
      imports: [BudgetsComponent, NoopAnimationsModule],
      providers: [
        { provide: ActivatedRoute, useValue: { get snapshot() { return { queryParamMap: convertToParamMap(budgetQueryParams.value) }; } } },
        {
          provide: BudgetService,
          useValue: {
            budgets,
            getBudgets: jasmine.createSpy('getBudgets').and.returnValue(of([])),
            deleteBudget: jasmine.createSpy('deleteBudget').and.resolveTo(undefined),
          },
        },
        {
          provide: CategoryService,
          useValue: {
            categories: signal([createCategory({ id: 'c9' })]),
            loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: MatDialog, useValue: dialogSpy },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(BudgetsComponent, {
        set: {
          imports: [
            PageHeaderComponent,
            CommonModule,
            MatButtonModule,
            MatIconModule,
            MatTabsModule,
            TabStripScrollDirective,
            LoadingSpinnerComponent,
            EmptyStateComponent,
            TranslatePipe,
          ],
          // A standalone component's template is governed by its own schemas,
          // not the TestBed's. The budget overview, the recurring list and
          // the goals page each have their own spec and stay unrendered here.
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
  });

  it('offers all three tabs, labelled and in order', () => {
    render();

    expect(tabHeaders().length).toBe(BUDGET_TABS.length);
    expect(tabHeaders().map(h => h.textContent?.trim())).toEqual([
      'savingsbudget.budgets1',
      'repeatbudget.recurring',
      'flagbudget.goals',
    ]);
  });

  it('badges the budgets tab with its count, and drops the badge at zero', () => {
    render();
    expect(text('.tab-badge')).toBe('1');

    budgets.set([]);
    fixture.detectChanges();

    expect(el().querySelector('.tab-badge')).toBeNull();
  });

  it('shows the spinner while the first read is open', () => {
    render();
    component.isLoading.set(true);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).not.toBeNull();
    expect(el().querySelector('app-empty-state')).toBeNull();
    expect(el().querySelector('.budget-grid')).toBeNull();
  });

  it('offers a first budget from the empty state rather than a bare page', () => {
    render();
    component.isLoading.set(false);
    budgets.set([]);
    fixture.detectChanges();

    const empty = el().querySelector('app-empty-state') as HTMLElement;
    expect(empty.textContent).toContain('budget.noBudgets');
    expect(empty.textContent).toContain('budget.createBudget');

    (empty.querySelector('button') as HTMLButtonElement).click();

    expect(dialogSpy.open).toHaveBeenCalled();
  });

  it('shows the budget grid once there is a budget', () => {
    render();
    component.isLoading.set(false);
    fixture.detectChanges();

    expect(el().querySelector('.budget-grid')).not.toBeNull();
    expect(el().querySelector('app-empty-state')).toBeNull();
    expect(text('.tab-description')).toBe('budget.budgetsDescription');
  });

  it('opens the add dialog from the header button', () => {
    render();
    component.isLoading.set(false);
    fixture.detectChanges();

    (el().querySelector('.tab-header button') as HTMLButtonElement).click();

    expect(dialogSpy.open).toHaveBeenCalledWith(BudgetFormComponent, jasmine.anything());
  });

  it('opens on the tab the query parameter names', () => {
    budgetQueryParams.value = { tab: BUDGET_TABS[2] };
    render();

    expect(component.selectedTabIndex).toBe(2);
  });

  it('carries the accessibility tab-animation duration into the strip', () => {
    render();

    const group = el().querySelector('mat-tab-group') as HTMLElement;
    expect(group.style.getPropertyValue('--mat-tab-header-animation-duration').trim())
      .toBe(component.tabAnimationDuration());
  });
});
