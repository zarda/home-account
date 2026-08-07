import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { GoalService } from '../../core/services/goal.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { RecurringService } from '../../core/services/recurring.service';
import { InsightSnapshotService } from '../../core/services/insight-snapshot.service';
import { TranslationService } from '../../core/services/translation.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { Transaction, Category, CategoryTotal, RAG_TIER_CONFIGS, effectiveRagLevel, baseCurrencyOf} from '../../models';
import { addMonths } from '../../core/utils/transaction-date.utils';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import {
  PeriodSelectorComponent,
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    MatProgressBarModule,
    PageHeaderComponent,
    PeriodSelectorComponent,
    FinancialSummaryComponent,
    SpendingChartComponent,
    RecentTransactionsComponent,
    BudgetProgressComponent,
    BudgetAlertBannerComponent,
    AiSummaryComponent,
    LoadingSpinnerComponent,
    TranslatePipe
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private budgetService = inject(BudgetService);
  private goalService = inject(GoalService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private recurringService = inject(RecurringService);
  private insightSnapshots = inject(InsightSnapshotService);
  private translationService = inject(TranslationService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  isLoading = signal(true);
  // True once the first load has painted; keeps period-change refetches
  // from tearing the whole page down to a spinner.
  private hasLoadedOnce = signal(false);

  /** Full-page spinner only on the very first load. */
  showInitialSpinner = computed(() => this.isLoading() && !this.hasLoadedOnce());
  /** Subtle indicator while refetching after content is already painted. */
  isRefetching = computed(() => this.isLoading() && this.hasLoadedOnce());

  // Current selection from the shared period selector (calendar bounds).
  private currentPeriod = signal<PeriodSelection>(defaultPeriodSelection());

  // Every stream below wraps a Firestore onSnapshot that never completes, so
  // each period change must supersede the previous listener or they stack —
  // and a write matching an old period would repaint the current one (the
  // reports page holds priorYearSub for exactly this reason). takeUntilDestroyed
  // covers leaving the page; these fields cover staying on it.
  private periodSub?: Subscription;
  private recentSub?: Subscription;
  private prevPeriodSub?: Subscription;
  private baselineSub?: Subscription;

  // The option string feeds the AI summary's cache key / prompt context.
  selectedPeriodOption = computed(() => this.currentPeriod().option);

  // User info
  userName = computed(() => {
    const user = this.authService.currentUser();
    return user?.displayName?.split(' ')[0] || 'User';
  });

  baseCurrency = computed(() => baseCurrencyOf(this.authService.currentUser()));

  // Transaction data
  transactions = this.transactionService.transactions;
  recentTransactions = signal<Transaction[]>([]);
  previousPeriodData = signal<{ income: number; expense: number } | null>(null);
  previousPeriodByCategory = signal<CategoryTotal[] | null>(null);
  // Trailing-window expenses feeding the AI anomaly baseline (window sized by tier)
  historicalExpenses = signal<Transaction[] | null>(null);

  // RAG grounding depth; sizes the anomaly-baseline window below.
  private ragLevel = computed(() => effectiveRagLevel(this.authService.currentUser()?.preferences));

  // Trailing window (in months) for the AI spending-anomaly baseline. 0 means
  // the tier needs no history (off has no grounding; light has no anomaly
  // section), so the Firestore query is skipped entirely.
  private baselineWindowMonths = computed(() => {
    const level = this.ragLevel();
    return level === 'off' ? 0 : RAG_TIER_CONFIGS[level].baselineWindowMonths;
  });

  // Totals use the write-time base-currency snapshot (deterministic across
  // loads), falling back to live conversion only for legacy rows.
  totalIncome = computed(() => {
    const baseCurrency = this.baseCurrency();
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.currencyService.amountInBase(t, baseCurrency), 0);
  });

  totalExpenses = computed(() => {
    const baseCurrency = this.baseCurrency();
    return this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + this.currencyService.amountInBase(t, baseCurrency), 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpenses());

  categoryTotals = computed(() => {
    const baseCurrency = this.baseCurrency();
    const transactions = this.transactions();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');

    const totals = new Map<string, { total: number; count: number }>();
    for (const t of expenseTransactions) {
      const current = totals.get(t.categoryId) || { total: 0, count: 0 };
      const convertedAmount = this.currencyService.amountInBase(t, baseCurrency);
      totals.set(t.categoryId, { total: current.total + convertedAmount, count: current.count + 1 });
    }

    return Array.from(totals.entries())
      .map(([categoryId, data]) => ({ categoryId, total: data.total, count: data.count }))
      .sort((a, b) => b.total - a.total);
  });

  // Category data
  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  // Budget data
  activeBudgets = this.budgetService.activeBudgets;
  activeGoals = this.goalService.activeGoals;

  constructor() {
    // Loading state is owned by the getByDateRange subscription callbacks in
    // loadData(): the first snapshot (or error) of the published window is
    // the real "first paint" moment. The effect that used to live here fired
    // at construction — TransactionService.isLoading only tracks CRUD writes
    // and `length >= 0` is always true — so it cleared the spinner before any
    // data existed, and any foreign write to the shared signal re-ran it.

    // Keep the anomaly-baseline window in sync with both the selected period
    // and the RAG tier, so a mid-session tier change refetches the right
    // span (the ai-summary cache key includes the tier, so insights
    // regenerate immediately and must not ground on a stale window).
    effect(() => {
      this.currentPeriod();
      const months = this.baselineWindowMonths();
      if (months === 0) {
        // A tier downgrade must also release the in-flight baseline listener,
        // not just blank the data it fed.
        this.baselineSub?.unsubscribe();
        this.historicalExpenses.set(null);
        return;
      }
      untracked(() => this.loadHistoricalBaseline(months));
    });
  }

  ngOnInit(): void {
    // Load budgets once; the derived budgetAlerts signal feeds the inline
    // alert banner declaratively. Deliberately outside loadData():
    // getBudgets is an infinite live stream, so period changes must not
    // stack extra subscriptions, and takeUntilDestroyed stops destroyed
    // dashboard instances from reacting to later budget writes made
    // elsewhere in the app.
    this.budgetService.getBudgets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    // Goals feed the AI summary prompt; same live-stream reasoning as budgets.
    this.goalService.getGoals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    // Categories are period-independent, so like budgets they are subscribed
    // once here rather than re-subscribed on every period change in loadData().
    this.categoryService.loadCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    this.loadData();
    // Post recurring occurrences that came due since the app was last open.
    // Deliberately outside loadData(): period toggles must not re-run it.
    // The live subscriptions above surface newly posted docs automatically.
    this.recurringService.catchUpRecurringTransactions().catch(() => {
      // Non-fatal: the dashboard still renders with existing data.
    });

    // Write insight snapshots for any month that closed while the app was shut.
    // Also outside loadData() for the same reason, and hooked here rather than in
    // an app initializer because onAuthStateChanged resolves asynchronously — at
    // bootstrap there is no uid yet to build a path from. The dashboard is the
    // landing route, so history accumulates even for a user who never opens
    // Reports. The service shares one in-flight run, so the insights tab calling
    // it too is free.
    this.insightSnapshots.generateClosedMonths().catch(() => {
      // Non-fatal: snapshots are history, not a precondition for anything.
    });
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.currentPeriod.set(selection);
    this.loadData();
  }

  private loadData(): void {
    this.isLoading.set(true);
    const { start, end } = this.getPeriodDates();

    // Load transactions for the period
    this.periodSub?.unsubscribe();
    this.periodSub = this.transactionService.getByDateRange(start, end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.hasLoadedOnce.set(true);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasLoadedOnce.set(true);
        }
      });

    // Load recent transactions
    this.recentSub?.unsubscribe();
    this.recentSub = this.transactionService.getRecentTransactions(5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transactions) => {
          this.recentTransactions.set(transactions);
        }
      });

    // Load previous period data for AI comparison. (The trailing historical
    // window for the anomaly baseline is loaded by the constructor effect,
    // which also reacts to period changes via currentPeriod. Categories are
    // period-independent and loaded once in ngOnInit.)
    this.loadPreviousPeriodData();
  }

  private loadPreviousPeriodData(): void {
    // Superseded even on the no-comparison branch: a custom range has no
    // previous period, and the old period's listener must not keep feeding
    // the comparison it replaced.
    this.prevPeriodSub?.unsubscribe();

    const prevDates = this.getPreviousPeriodDates();
    if (!prevDates) {
      this.previousPeriodData.set(null);
      this.previousPeriodByCategory.set(null);
      return;
    }

    // Use getPeriodCategoryTotals which doesn't update the main transactions
    // signal; the per-category breakdown feeds the RAG grounding for insights
    this.prevPeriodSub = this.transactionService.getPeriodCategoryTotals(prevDates.start, prevDates.end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (totals) => {
          this.previousPeriodData.set({ income: totals.income, expense: totals.expense });
          this.previousPeriodByCategory.set(totals.byCategory);
        },
        error: () => {
          this.previousPeriodData.set(null);
          this.previousPeriodByCategory.set(null);
        }
      });
  }

  private loadHistoricalBaseline(months: number): void {
    const { start, end } = this.getBaselineWindowDates(months);

    // Non-mutating query so the current-period transactions signal is untouched;
    // the trailing window only feeds the RAG anomaly baseline for insights.
    this.baselineSub?.unsubscribe();
    this.baselineSub = this.transactionService.getExpensesInRange(start, end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (expenses) => {
          this.historicalExpenses.set(expenses);
        },
        error: () => {
          this.historicalExpenses.set(null);
        }
      });
  }

  // Trailing baseline window: from `months` before the current period's end up
  // to that end, but never starting after the current period's start — so the
  // window always covers the whole current period.
  private getBaselineWindowDates(months: number): { start: Date; end: Date } {
    const { start: periodStart, end } = this.getPeriodDates();
    const windowStart = new Date(end.getFullYear(), end.getMonth() - months, 1);
    return {
      start: windowStart < periodStart ? windowStart : periodStart,
      end
    };
  }

  private getPreviousPeriodDates(): { start: Date; end: Date } | null {
    const now = new Date();
    const selection = this.currentPeriod();

    // The current window is clamped to end-of-today (getPeriodDates), so a
    // still-running period compares against the same elapsed span of the
    // previous one — part of a month against all of the previous month
    // would read as a large false decline for most of every month, and the
    // AI summary would assert it. Complete past windows keep their whole
    // calendar bounds.
    const truncated = (wholeEnd: Date, monthSpan: number): Date =>
      selection.end > now ? addMonths(this.getPeriodDates().end, -monthSpan) : wholeEnd;

    switch (selection.option) {
      case 'thisMonth':
        // Compare with last month
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: truncated(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59), 1)
        };

      case 'lastMonth':
        // Compare with 2 months ago
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59)
        };

      case 'last3Months':
        // Compare with previous 3 months (months -5 to -3)
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
          end: truncated(new Date(now.getFullYear(), now.getMonth() - 2, 0, 23, 59, 59), 3)
        };

      case 'thisYear':
        // Compare with last year
        return {
          start: new Date(now.getFullYear() - 1, 0, 1),
          end: truncated(new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59), 12)
        };

      case 'custom': {
        const { start, end } = selection;
        const isFullYear =
          start.getMonth() === 0 &&
          start.getDate() === 1 &&
          end.getMonth() === 11 &&
          end.getDate() === 31;
        if (isFullYear) {
          const prevYear = start.getFullYear() - 1;
          return {
            start: new Date(prevYear, 0, 1),
            end: truncated(new Date(prevYear, 11, 31, 23, 59, 59), 12)
          };
        }
        // Custom month: compare with the month before it.
        const year = start.getFullYear();
        const month = start.getMonth();
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        return {
          start: new Date(prevYear, prevMonth, 1),
          end: truncated(new Date(prevYear, prevMonth + 1, 0, 23, 59, 59), 1)
        };
      }

      default:
        return null;
    }
  }

  /**
   * A category picked in the spending chart: open the transaction list on
   * exactly the rows that slice was computed from. The pending-filters
   * channel hands the set over as live filters, so it lands in the filter
   * surface visible and clearable rather than as an invisible query param.
   */
  onCategoryActivated(categoryId: string): void {
    const dates = this.getPeriodDates();
    this.pendingFilters.apply({
      categoryId,
      type: 'expense',
      startDate: dates.start,
      endDate: dates.end,
    });
    void this.router.navigate(['/transactions']);
  }

  // The selector emits full calendar bounds; the dashboard clamps periods
  // that extend into the future to end-of-today so period-over-period
  // deltas compare like-for-like month-to-date windows.
  private getPeriodDates(): { start: Date; end: Date } {
    const { start, end } = this.currentPeriod();
    const now = new Date();
    if (end > now) {
      return {
        start,
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
      };
    }
    return { start, end };
  }
}
