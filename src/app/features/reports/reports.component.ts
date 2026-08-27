import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import {
  PeriodSelectorComponent,
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';
import { SpendingAnalysisComponent } from './spending-analysis/spending-analysis.component';
import { CategoryBreakdownComponent } from './category-breakdown/category-breakdown.component';
import { RecurringBreakdownComponent } from './recurring-breakdown/recurring-breakdown.component';
import { CountryBreakdownComponent } from './country-breakdown/country-breakdown.component';
import { MonthlyComparisonComponent } from './monthly-comparison/monthly-comparison.component';
import { InsightsTabComponent } from './insights/insights-tab.component';
import { ForecastComponent } from './forecast/forecast.component';
import { ExportDialogComponent } from './export-dialog/export-dialog.component';
import { Category, Transaction, baseCurrencyOf} from '../../models';
import { AccessibilityService } from '../../core/services/accessibility.service';
import {
  groupExpensesByCategory,
  sumByType,
} from '../../core/utils/transaction-aggregation.utils';
import { addMonths, clampToEndOfToday } from '../../core/utils/transaction-date.utils';
import { tabIndexFromParam } from '../../core/utils/tab-query-param.utils';

/** The tab strip's sections, in the order the template lays them out. */
export const REPORT_TABS = ['analysis', 'categories', 'monthly', 'insights', 'forecast'] as const;

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    PageHeaderComponent,
    PeriodSelectorComponent,
    CommonModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    LoadingSpinnerComponent,
    SpendingAnalysisComponent,
    CategoryBreakdownComponent,
    RecurringBreakdownComponent,
    CountryBreakdownComponent,
    MonthlyComparisonComponent,
    InsightsTabComponent,
    ForecastComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);
  private dialog = inject(MatDialog);
  private analytics = inject(AnalyticsService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private accessibility = inject(AccessibilityService);

  isLoading = signal(true);

  /**
   * Which tab a ?tab= link opens on. Read once at construction rather than
   * bound to the param stream: after that the tab strip owns the selection,
   * and re-reading would drag the user back on every param change.
   */
  selectedTabIndex = tabIndexFromParam(
    inject(ActivatedRoute).snapshot.queryParamMap.get('tab'),
    REPORT_TABS
  );

  // 0ms under prefers-reduced-motion (tab slide bypasses the CSS switch).
  readonly tabAnimationDuration = this.accessibility.tabAnimationDuration;

  // User info
  baseCurrency = computed(() => baseCurrencyOf(this.authService.currentUser()));

  /**
   * The whole selection, not just its dates. The insights tab derives a trailing
   * window from it, which needs the option to know how far back to look.
   */
  selectedPeriod = signal<PeriodSelection>(defaultPeriodSelection());

  // Date range for child components; the shared period selector drives it.
  dateRange = computed<{ start: Date; end: Date }>(() => {
    const selection = this.selectedPeriod();
    return { start: selection.start, end: selection.end };
  });

  // Transaction data
  transactions = this.transactionService.transactions;
  categories = this.categoryService.categories;

  /**
   * The selected window shifted back a year, for the monthly comparison's
   * year-over-year figures. Kept apart from `transactions` on purpose: that
   * signal is what all four tabs render, so the prior-year rows must never
   * reach it.
   */
  priorYearTransactions = signal<Transaction[]>([]);
  private priorYearSub?: Subscription;
  // The current-window and category streams never complete either; held for
  // the same supersede-on-reload and release-on-destroy treatment.
  private rangeSub?: Subscription;
  private categoriesSub?: Subscription;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  // Base-currency value: write-time snapshot first (deterministic), live
  // conversion only as a legacy fallback.
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.amountInBase(t, this.baseCurrency());
  }

  // Computed totals (using dynamic conversion)
  private typeTotals = computed(
    () => sumByType(this.transactions(), t => this.toBaseCurrency(t)));

  totalIncome = computed(() => this.typeTotals().income);
  totalExpenses = computed(() => this.typeTotals().expense);
  balance = computed(() => this.typeTotals().balance);

  categoryTotals = computed(
    () => groupExpensesByCategory(this.transactions(), t => this.toBaseCurrency(t)));

  ngOnInit(): void {
    // Categories are period-independent: one live subscription for the page's
    // lifetime, not one per period change inside loadData().
    this.categoriesSub = this.categoryService.loadCategories().subscribe();
    this.loadData();
  }

  ngOnDestroy(): void {
    // The Firestore wrappers behind these windows never complete, so dropping
    // the page without this leaves listeners running for the rest of the
    // session.
    this.priorYearSub?.unsubscribe();
    this.rangeSub?.unsubscribe();
    this.categoriesSub?.unsubscribe();
  }

  /**
   * Which report each tab index is, for reporting.
   *
   * The tabs carry no identifier of their own — they are ordered mat-tab
   * elements — so the mapping has to live somewhere, and somewhere that will
   * be noticed if a tab is inserted. Reordering the tabs without updating this
   * list silently relabels the data in GA4.
   */
  private static readonly REPORT_TYPES = [
    'spending_analysis',
    'category_breakdown',
    'monthly_comparison',
    'insights',
    'forecast',
  ] as const;

  /**
   * Tabs already reported for this component instance.
   *
   * The tab group lives inside the @else of an isLoading() guard, so changing
   * the period destroys and recreates it. MatTabGroup does not emit
   * selectedTabChange on creation, so without this the landing tab would go
   * unreported on entry — and with a naive fix it would be reported again
   * after every period change.
   */
  private reportedTabs = new Set<number>();

  onTabChange(index: number): void {
    this.reportTab(index);
  }

  private reportTab(index: number): void {
    if (this.reportedTabs.has(index)) return;
    const reportType = ReportsComponent.REPORT_TYPES[index];
    if (!reportType) return;
    this.reportedTabs.add(index);
    this.analytics.trackReportView({ report_type: reportType });
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.selectedPeriod.set(selection);
    this.loadData();
  }

  /**
   * A category picked in the breakdown donut: open the transaction list on the
   * rows behind it. Handing the set over as live filters (rather than a query
   * param) is what makes it arrive visible and clearable in the filter surface.
   * The type travels with the event because the tab's toggle decides which
   * side of the ledger the donut is showing.
   */
  onCategoryDrillDown(event: { categoryId: string; type: 'expense' | 'income' }): void {
    const range = this.dateRange();
    this.pendingFilters.apply({
      categoryId: event.categoryId,
      type: event.type,
      startDate: range.start,
      endDate: range.end,
    });
    void this.router.navigate(['/transactions']);
  }

  openExportDialog(): void {
    this.dialog.open(ExportDialogComponent, {
      width: '100%',
      maxWidth: '500px',
      data: {
        transactions: this.transactions(),
        categories: this.categories(),
        dateRange: this.dateRange(),
        currency: this.baseCurrency()
      }
    });
  }

  private loadData(): void {
    this.isLoading.set(true);
    const range = this.dateRange();

    // The period selector hands out whole calendar bounds, so "This Month" on
    // the 15th runs to the 31st. Shifting that end back a year unchanged would
    // weigh a month-to-date window against a complete one — roughly -50% read
    // as an improvement — and would give months that have not happened yet a
    // full year-ago figure to be "-100%" against. Clamping first makes the
    // comparison month-to-date vs month-to-date, the same semantic the
    // dashboard's getPeriodDates() documents.
    const clampedEnd = clampToEndOfToday(range.end, new Date());

    // Same window a year back, through the non-mutating reader: getByDateRange
    // would publish these rows to the shared `transactions` signal and every
    // tab would start showing last year's figures. Cleared first so a period
    // change cannot flash the old year's comparison against the new period,
    // and deliberately outside the isLoading gate — the page renders as soon
    // as the current window is in, and the comparison fills in behind it.
    this.priorYearSub?.unsubscribe();
    this.priorYearTransactions.set([]);
    this.priorYearSub = this.transactionService
      .getTransactionsInRange(addMonths(range.start, -12), addMonths(clampedEnd, -12))
      .subscribe({
        next: rows => this.priorYearTransactions.set(rows),
        // A prior-year window that fails to load is not a page failure: the
        // comparison just has nothing to compare against.
        error: () => this.priorYearTransactions.set([]),
      });

    this.rangeSub?.unsubscribe();
    this.rangeSub = this.transactionService.getByDateRange(range.start, range.end).subscribe({
      next: () => this.finishLoading(),
      error: () => this.finishLoading()
    });
  }

  private finishLoading(): void {
    this.isLoading.set(false);
    // The tab group only exists once loading finishes, and it does not emit a
    // change for the tab it opens on. Without this the landing report — the
    // most-viewed one — would look like the least-viewed.
    this.reportTab(this.selectedTabIndex);
  }
}
