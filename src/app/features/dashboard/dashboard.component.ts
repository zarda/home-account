import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { Transaction, Category, CategoryTotal, RecurringOccurrence, RAG_TIER_CONFIGS, effectiveRagLevel, baseCurrencyOf} from '../../models';
import { roundMoney, sumByType } from '../../core/utils/transaction-aggregation.utils';
import {
  DateWindow,
  clampWindowToNow,
  monthWindow,
  previousPeriodWindow,
} from '../../core/utils/transaction-date.utils';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { UpcomingBillsComponent } from './upcoming-bills/upcoming-bills.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { WeeklyRecapComponent } from './weekly-recap/weekly-recap.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import {
  PeriodSelectorComponent,
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';

/**
 * How far ahead the upcoming-bills card looks. A fortnight is short enough
 * that everything in it is close enough to act on, and it is deliberately
 * independent of the selected period: the card answers "what is about to
 * move", not "what happened in the window I am looking at".
 */
const UPCOMING_WINDOW_DAYS = 14;

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
    UpcomingBillsComponent,
    BudgetProgressComponent,
    BudgetAlertBannerComponent,
    WeeklyRecapComponent,
    AiSummaryComponent,
    LoadingSpinnerComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  // The period the loaded rows actually belong to — not the one the selector is
  // on. It feeds the AI summary's cache key and prompt context, and the two have
  // to name the same window: currentPeriod flips synchronously on click while
  // `transactions` only flips when getByDateRange's snapshot lands, so binding
  // the selection paired a new label with the previous period's rows for one
  // change-detection pass. Long enough for the summary to describe last month
  // using this month's data, and to cache the answer under the new key.
  publishedPeriodOption = signal<string>(defaultPeriodSelection().option);

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
  // loads), falling back to live conversion only for legacy rows. One fold —
  // sumByType through amountInBase — shared with reports and the
  // transactions header, so the surfaces cannot disagree.
  private typeTotals = computed(() =>
    sumByType(this.transactions(), t => this.currencyService.amountInBase(t, this.baseCurrency()))
  );

  totalIncome = computed(() => this.typeTotals().income);

  totalExpenses = computed(() => this.typeTotals().expense);

  balance = computed(() => this.typeTotals().balance);

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
  // The banner injects BudgetService and reads this for itself; the recap card
  // is dumb like the rest of the page's children and takes it as an input.
  budgetAlerts = this.budgetService.budgetAlerts;
  activeGoals = this.goalService.activeGoals;

  // Scheduled money for the next UPCOMING_WINDOW_DAYS. Occurrences dated
  // before today are kept: they are due but not yet posted, and dropping them
  // would hide money about to move on exactly the occasion — a failed
  // catch-up — when the user most needs to see it (ADR 0091).
  upcomingOccurrences = signal<RecurringOccurrence[]>([]);

  // Live conversion, unlike every other total on this page: a scheduled
  // occurrence has not been written yet, so there is no amountInBaseCurrency
  // snapshot to prefer. Same idiom as the reports forecast, which projects
  // the same stream.
  upcomingNet = computed(() => {
    const baseCurrency = this.baseCurrency();
    const net = this.upcomingOccurrences().reduce((sum, occurrence) => {
      const amount = this.currencyService.convert(
        occurrence.amount, occurrence.currency, baseCurrency);
      return occurrence.type === 'income' ? sum + amount : sum - amount;
    }, 0);
    return roundMoney(net);
  });

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

    // The upcoming window is anchored to today, not to the selected period,
    // so it belongs here beside budgets rather than in loadData() — and, like
    // them, it is an onSnapshot that never completes, so a period change must
    // not stack a second listener on it.
    this.recurringService.getNextOccurrences(UPCOMING_WINDOW_DAYS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(occurrences => this.upcomingOccurrences.set(occurrences));

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
          // Published with the rows, in the same synchronous emission that
          // getByDateRange's tap writes the shared signal in, so the AI summary
          // sees a matching pair and runs once per period change.
          this.publishedPeriodOption.set(this.currentPeriod().option);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasLoadedOnce.set(true);
          // Deliberately not published: the previous period's rows are still on
          // screen, so the summary should keep describing them.
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
  private getBaselineWindowDates(months: number): DateWindow {
    const { start: periodStart, end } = this.getPeriodDates();
    const windowStart = monthWindow(
      { year: end.getFullYear(), month: end.getMonth() - months }).start;
    return {
      start: windowStart < periodStart ? windowStart : periodStart,
      end
    };
  }

  private getPreviousPeriodDates(): DateWindow | null {
    return previousPeriodWindow(this.currentPeriod(), new Date());
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
  private getPeriodDates(): DateWindow {
    return clampWindowToNow(this.currentPeriod(), new Date());
  }
}
