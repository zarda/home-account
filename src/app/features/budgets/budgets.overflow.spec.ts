import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { BUDGET_TABS, BudgetsComponent } from './budgets.component';
import { BudgetOverviewComponent } from './budget-overview/budget-overview.component';
import { GoalsComponent } from './goals/goals.component';
import { RecurringTransactionsComponent } from './recurring-transactions/recurring-transactions.component';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { AccessibilityService } from '../../core/services/accessibility.service';
import { Budget } from '../../models';
import { createBudget } from '../../core/services/testing';

/**
 * The budgets tab strip, which holds more than it can show.
 *
 * budgets.component.spec.ts blanks the template, so the page's own layout has
 * nowhere to be asserted there; this file renders the real one. The three tab
 * bodies are dropped from the component's imports — each reaches Firestore
 * through a service this probe has no business standing up — and the strip
 * itself, which is the whole subject, is untouched.
 *
 * Nothing here provides the directive: whether the page's own imports carry
 * it is exactly what is under test.
 */
const PHONE_PAGE_WIDTH_PX = 343;

/** The real `budget.*` strings the strip renders — not their keys. */
const BUDGET_LABELS: Record<string, string> = {
  'budget.title': 'Budget',
  'budget.budgets': 'Budgets',
  'budget.recurring': 'Recurring',
  'budget.goals': 'Goals',
};

@Component({
  standalone: true,
  imports: [BudgetsComponent],
  template: `<div class="phone" [style.width.px]="width"><app-budgets /></div>`,
})
class BudgetsStripOverflowProbeComponent {
  width = PHONE_PAGE_WIDTH_PX;
}

describe('overflow guard: the budgets tab strip', () => {
  let fixture: ComponentFixture<BudgetsStripOverflowProbeComponent>;
  let host: HTMLElement;

  /**
   * `selectedTabIndex` is a plain field read once at construction, so the
   * param has to be in place before the component exists.
   */
  async function setUp(tab?: string): Promise<void> {
    const budgetService = {
      budgets: signal<Budget[]>([createBudget()]),
      getBudgets: jasmine.createSpy('getBudgets').and.returnValue(of([])),
      deleteBudget: jasmine.createSpy('deleteBudget').and.resolveTo(undefined),
    };
    const categoryService = {
      categories: signal([]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    const dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

    const translation = jasmine.createSpyObj('TranslationService', ['t'], {
      currentLocale: signal('en'),
    });
    translation.t.and.callFake((key: string) => BUDGET_LABELS[key] ?? key);

    const accessibility = { tabAnimationDuration: signal('0ms') };

    await TestBed.configureTestingModule({
      imports: [BudgetsStripOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(tab ? { tab } : {}) } },
        },
        { provide: BudgetService, useValue: budgetService },
        { provide: CategoryService, useValue: categoryService },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        { provide: AccessibilityService, useValue: accessibility },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']),
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(BudgetsComponent, {
        remove: {
          imports: [BudgetOverviewComponent, RecurringTransactionsComponent, GoalsComponent],
        },
      })
      // A standalone component carries its own schemas; the testing module's
      // never reach it, and the three tab bodies are unknown elements now.
      .overrideComponent(BudgetsComponent, { set: { schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();

    fixture = TestBed.createComponent(BudgetsStripOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    host?.remove();
  });

  function container(): HTMLElement {
    return host.querySelector('.mat-mdc-tab-label-container') as HTMLElement;
  }

  function tabs(): HTMLElement[] {
    return Array.from(host.querySelectorAll('.mat-mdc-tab')) as HTMLElement[];
  }

  function expectStripOverflows(): void {
    const strip = container();
    expect(strip.scrollWidth)
      .withContext(`${BUDGET_TABS.length} tabs in ${PHONE_PAGE_WIDTH_PX}px: scrollWidth vs clientWidth`)
      .toBeGreaterThan(strip.clientWidth + 1);
  }

  it('never falls back to the pagination chevrons', async () => {
    expect(window.innerWidth)
      .withContext("below the md breakpoint, so the page's phone gutter (p-4) is what this measures")
      .toBeLessThan(768);

    await setUp();
    expectStripOverflows();

    const header = host.querySelector('.mat-mdc-tab-header') as HTMLElement;
    expect(header.classList.contains('mat-mdc-tab-header-pagination-controls-enabled'))
      .withContext('pagination controls enabled on an overflowing strip')
      .toBeFalse();
  });

  it("rests the active tab's underline on the divider, below the scrollbar's gutter", async () => {
    await setUp();
    expectStripOverflows();

    const listStyle = getComputedStyle(host.querySelector('.mat-mdc-tab-list') as HTMLElement);
    expect(listStyle.borderBlockEndWidth)
      .withContext('the tab list: border-block-end-width — the divider the underline rests on')
      .toBe('1px');

    const header = host.querySelector('.mat-mdc-tab-header') as HTMLElement;
    expect(getComputedStyle(header).borderBottomWidth)
      .withContext('the tab header: border-bottom-width — the page no longer draws its own divider here')
      .toBe('0px');
  });

  it('opens on the tab a ?tab= link names, in view', async () => {
    await setUp('goals');
    expectStripOverflows();

    const index = BUDGET_TABS.indexOf('goals');
    // The rect on its own proves nothing: Material's pagination puts the same
    // tab in view by translating the list, leaving the scroller at rest.
    expect(container().scrollLeft)
      .withContext("the strip's scroll offset after opening on the third tab")
      .toBeGreaterThan(0);

    const strip = container().getBoundingClientRect();
    const tab = tabs()[index].getBoundingClientRect();
    expect(tab.x)
      .withContext(`the "${BUDGET_LABELS['budget.goals']}" tab: start edge vs the scroller's`)
      .toBeGreaterThanOrEqual(strip.x - 1);
    expect(tab.x + tab.width)
      .withContext(`the "${BUDGET_LABELS['budget.goals']}" tab: end edge vs the scroller's`)
      .toBeLessThanOrEqual(strip.x + strip.width + 1);
  });
});
