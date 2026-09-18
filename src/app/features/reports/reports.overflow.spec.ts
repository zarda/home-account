import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { EMPTY, of } from 'rxjs';

import { REPORT_TABS, ReportsComponent } from './reports.component';
import { CategoryBreakdownComponent } from './category-breakdown/category-breakdown.component';
import { CountryBreakdownComponent } from './country-breakdown/country-breakdown.component';
import { ForecastComponent } from './forecast/forecast.component';
import { InsightsTabComponent } from './insights/insights-tab.component';
import { MonthlyComparisonComponent } from './monthly-comparison/monthly-comparison.component';
import { RecurringBreakdownComponent } from './recurring-breakdown/recurring-breakdown.component';
import { SpendingAnalysisComponent } from './spending-analysis/spending-analysis.component';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { TranslationService } from '../../core/services/translation.service';
import { AccessibilityService } from '../../core/services/accessibility.service';
import { Transaction } from '../../models';

/**
 * The reports tab strip: five tabs, more than a phone can show even after the
 * phone rules drop the 120px floor and swap in the short labels.
 *
 * reports.component.spec.ts blanks the template, so the page's own layout has
 * nowhere to be asserted there; this file renders the real one. The five tab
 * bodies are dropped from the component's imports — charts and live Firestore
 * listeners, none of which the strip depends on — and the strip itself is
 * untouched.
 *
 * Nothing here provides the directive: whether the page's own imports carry
 * it is exactly what is under test.
 */
const PHONE_PAGE_WIDTH_PX = 343;

/**
 * The real `reports.*` strings the strip renders — not their keys. Each tab
 * carries both spellings and the stylesheet shows one; below the tablet
 * breakpoint, which is where Karma's window sits, it is the short one.
 */
const REPORT_LABELS: Record<string, string> = {
  'reports.title': 'Reports',
  'reports.subtitle': 'Analyze your financial data',
  'reports.spendingAnalysis': 'Spending Analysis',
  'reports.categoryBreakdown': 'Category Breakdown',
  'reports.monthlyComparison': 'Monthly Comparison',
  'reports.insights': 'Spending Patterns',
  'reports.forecast': 'Cash-flow Forecast',
  'reports.tabAnalysis': 'Trends',
  'reports.tabCategories': 'Categories',
  'reports.tabMonthly': 'Monthly',
  'reports.tabInsights': 'Patterns',
  'reports.tabForecast': 'Forecast',
  'common.export': 'Export',
};

@Component({
  standalone: true,
  imports: [ReportsComponent],
  template: `<div class="phone" [style.width.px]="width"><app-reports /></div>`,
})
class ReportsStripOverflowProbeComponent {
  width = PHONE_PAGE_WIDTH_PX;
}

describe('overflow guard: the reports tab strip', () => {
  let fixture: ComponentFixture<ReportsStripOverflowProbeComponent>;
  let host: HTMLElement;

  /**
   * `selectedTabIndex` is a plain field read once at construction, so the
   * param has to be in place before the component exists.
   */
  async function setUp(tab?: string): Promise<void> {
    const transactionService = jasmine.createSpyObj(
      'TransactionService',
      ['getByDateRange', 'getTransactionsInRange'],
      { transactions: signal<Transaction[]>([]) }
    );
    transactionService.getByDateRange.and.returnValue(of([]));
    transactionService.getTransactionsInRange.and.returnValue(of([]));

    const categoryService = jasmine.createSpyObj('CategoryService', ['loadCategories'], {
      categories: signal([]),
    });
    categoryService.loadCategories.and.returnValue(of([]));

    const authService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({ preferences: { baseCurrency: 'USD' } }),
    });

    const currencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) =>
        t.amountInBaseCurrency ?? t.amount,
    };

    const router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    router.navigate.and.returnValue(Promise.resolve(true));

    const translation = jasmine.createSpyObj('TranslationService', ['t'], {
      currentLocale: signal('en'),
    });
    translation.t.and.callFake((key: string) => REPORT_LABELS[key] ?? key);

    const accessibility = { tabAnimationDuration: signal('0ms') };

    await TestBed.configureTestingModule({
      imports: [ReportsStripOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: AuthService, useValue: authService },
        { provide: CurrencyService, useValue: currencyService },
        {
          provide: PendingFiltersService,
          useValue: jasmine.createSpyObj('PendingFiltersService', ['apply', 'consume']),
        },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(tab ? { tab } : {}) } },
        },
        { provide: TranslationService, useValue: translation },
        { provide: AccessibilityService, useValue: accessibility },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(ReportsComponent, {
        remove: {
          imports: [
            SpendingAnalysisComponent,
            CategoryBreakdownComponent,
            RecurringBreakdownComponent,
            CountryBreakdownComponent,
            MonthlyComparisonComponent,
            InsightsTabComponent,
            ForecastComponent,
          ],
        },
      })
      // A standalone component carries its own schemas; the testing module's
      // never reach it, and the five tab bodies are unknown elements now.
      .overrideComponent(ReportsComponent, { set: { schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();

    fixture = TestBed.createComponent(ReportsStripOverflowProbeComponent);
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
      .withContext(`${REPORT_TABS.length} tabs in ${PHONE_PAGE_WIDTH_PX}px: scrollWidth vs clientWidth`)
      .toBeGreaterThan(strip.clientWidth + 1);
  }

  it('is a scroller rather than a paginated transform', async () => {
    expect(window.innerWidth)
      .withContext('below the tablet breakpoint, so the strip carries its short labels and no 120px floor')
      .toBeLessThan(768);

    await setUp();
    expectStripOverflows();

    const header = host.querySelector('.mat-mdc-tab-header') as HTMLElement;
    expect(header.classList.contains('mat-mdc-tab-header-pagination-controls-enabled'))
      .withContext('pagination controls enabled on an overflowing strip')
      .toBeFalse();

    expect(getComputedStyle(container()).overflowX)
      .withContext('the label container: overflow-x')
      .toBe('auto');
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
    await setUp('forecast');
    expectStripOverflows();

    const index = REPORT_TABS.indexOf('forecast');
    // The rect on its own proves nothing: Material's pagination puts the same
    // tab in view by translating the list, leaving the scroller at rest.
    expect(container().scrollLeft)
      .withContext("the strip's scroll offset after opening on the fifth tab")
      .toBeGreaterThan(0);

    const strip = container().getBoundingClientRect();
    const tab = tabs()[index].getBoundingClientRect();
    expect(tab.x)
      .withContext(`the "${REPORT_LABELS['reports.tabForecast']}" tab: start edge vs the scroller's`)
      .toBeGreaterThanOrEqual(strip.x - 1);
    expect(tab.x + tab.width)
      .withContext(`the "${REPORT_LABELS['reports.tabForecast']}" tab: end edge vs the scroller's`)
      .toBeLessThanOrEqual(strip.x + strip.width + 1);
  });
});
