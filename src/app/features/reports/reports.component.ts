import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
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
import { MonthlyComparisonComponent } from './monthly-comparison/monthly-comparison.component';
import { InsightsTabComponent } from './insights/insights-tab.component';
import { ExportDialogComponent } from './export-dialog/export-dialog.component';
import { Category, Transaction } from '../../models';
import { tabAnimationDuration } from '../../core/layout/motion';
import {
  groupExpensesByCategory,
  sumByType,
} from '../../core/utils/transaction-aggregation.utils';

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
    MonthlyComparisonComponent,
    InsightsTabComponent,
    TranslatePipe,
  ],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);
  private dialog = inject(MatDialog);

  isLoading = signal(true);
  selectedTabIndex = 0;

  // 0ms under prefers-reduced-motion (tab slide bypasses the CSS switch).
  readonly tabAnimationDuration = tabAnimationDuration();

  // User info
  baseCurrency = computed(() => {
    return this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
  });

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
    this.loadData();
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.selectedPeriod.set(selection);
    this.loadData();
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

    this.transactionService.getByDateRange(range.start, range.end).subscribe({
      next: () => this.isLoading.set(false),
      error: () => this.isLoading.set(false)
    });

    this.categoryService.loadCategories().subscribe();
  }
}
