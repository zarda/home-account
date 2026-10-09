import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

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
import { WidgetSnapshotService } from '../../core/services/widget-snapshot.service';
import { CloudLLMProviderService } from '../../core/services/cloud-llm-provider.service';
import { WeeklyRecapService } from '../../core/services/weekly-recap.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import {
  Transaction,
  Category,
  CategoryTotal,
  UpcomingSchedule,
  RAG_TIER_CONFIGS,
  effectiveRagLevel,
  baseCurrencyOf,
  DashboardCardId,
  weeklyRecapEnabled,
} from '../../models';
import { roundMoney, sumByType } from '../../core/utils/transaction-aggregation.utils';
import {
  DateWindow,
  clampWindowToNow,
  monthWindow,
  previousPeriodWindow,
  yearWindow,
} from '../../core/utils/transaction-date.utils';
import { APP_BREAKPOINTS } from '../../core/layout/breakpoints';
import { DASHBOARD_MAIN_COLUMN, dashboardGridAreas } from './dashboard-layout.utils';
import { DashboardLayoutService } from './dashboard-layout.service';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { RuleFocusOutcome, UpcomingBillsComponent } from './upcoming-bills/upcoming-bills.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { BudgetAlertBannerComponent } from './budget-alert-banner/budget-alert-banner.component';
import { WeeklyRecapComponent } from './weekly-recap/weekly-recap.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { DashboardCardMenuComponent } from './dashboard-card-menu/dashboard-card-menu.component';
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
    RouterLink,
    MatProgressBarModule,
    MatButtonModule,
    MatIconModule,
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
    DashboardCardMenuComponent,
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
  private widgetSnapshots = inject(WidgetSnapshotService);
  private cloudLLM = inject(CloudLLMProviderService);
  private recap = inject(WeeklyRecapService);
  private announcer = inject(AnnouncerService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);

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

  // The oldest month the selector's pickers offer; null until read, and for
  // good when the read fails.
  pickerFloor = signal<Date | null>(null);

  // Every stream below wraps a Firestore onSnapshot that never completes, so
  // each period change must supersede the previous listener or they stack —
  // and a write matching an old period would repaint the current one (the
  // reports page holds priorYearSub for exactly this reason). takeUntilDestroyed
  // covers leaving the page; these fields cover staying on it.
  private periodSub?: Subscription;
  private prevPeriodSub?: Subscription;
  private baselineSub?: Subscription;
  // These two follow no period. They are held so that a hidden card's
  // listener can be closed when nothing else on the page reads it.
  private recentSub?: Subscription;
  private upcomingSub?: Subscription;

  // The period the loaded rows actually belong to — not the one the selector is
  // on. It feeds the AI summary's cache key and prompt context, and the two have
  // to name the same window: currentPeriod flips synchronously on click while
  // `transactions` only flips when getByDateRange's snapshot lands, so binding
  // the selection paired a new label with the previous period's rows for one
  // change-detection pass. Long enough for the summary to describe last month
  // using this month's data, and to cache the answer under the new key.
  publishedPeriodOption = signal<string>(defaultPeriodSelection().option);

  // Counts this-month paints of the window above, and only those — not the
  // shared transactions signal, which other code can write and which must
  // not trigger a publish to the widget. publishedPeriodOption alone cannot
  // gate the publishing effect below: it already starts at 'thisMonth', so a
  // change to it can't be told apart from the initial, still-unloaded state.
  private thisMonthPaints = signal(0);

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

  // The account's own arrangement of the five grid cards (#87). Absent
  // preferences resolve to today's fixed order, so an account that has never
  // opened the editor sees nothing different. Held while a change is saving,
  // so a hidden card leaves the page at once rather than when its write lands.
  private layout = inject(DashboardLayoutService).layout;

  // The cards actually rendered: the account's order, minus anything hidden,
  // minus budgets when there is nothing to show it — the same condition the
  // fixed layout applied via *ngIf today, now folded into one list so the
  // desktop area math and the DOM agree on what exists.
  arrangedCards = computed<DashboardCardId[]>(() => {
    const layout = this.layout();
    const hasBudgets = this.activeBudgets().length > 0;
    return layout.order.filter(id => !layout.hidden.includes(id) && (id !== 'budgets' || hasBudgets));
  });

  insightsShown = computed(() => this.arrangedCards().includes('insights'));

  // The insights card renders nothing without a provider, so it carries no
  // menu then, and a move steps over it as over any card that renders
  // nothing.
  insightsHasContent = computed(() => this.cloudLLM.hasAnyCloudProvider());

  /** The cards that carry a menu, in page order. */
  menuCards = computed(() =>
    this.arrangedCards().filter(id => id !== 'insights' || this.insightsHasContent())
  );

  // The width at which the grid draws its two columns (dashboard.component.scss).
  private isDesktop = toSignal(
    inject(BreakpointObserver).observe(APP_BREAKPOINTS.desktop).pipe(map(result => result.matches)),
    { initialValue: false }
  );

  // What each menu moves and counts over: the column its card is drawn in
  // where the grid draws two (dashboardGridAreas), the page where it draws
  // one. A step across columns would change nothing on screen.
  private menuColumns = computed(() => {
    const cards = this.menuCards();
    if (!this.isDesktop()) return { main: cards, rail: cards };
    return {
      main: cards.filter(id => DASHBOARD_MAIN_COLUMN.includes(id)),
      rail: cards.filter(id => !DASHBOARD_MAIN_COLUMN.includes(id)),
    };
  });

  /** The cards `card`'s menu moves and counts over, in the order drawn. */
  menuCardsFor(card: DashboardCardId): readonly DashboardCardId[] {
    const columns = this.menuColumns();
    return DASHBOARD_MAIN_COLUMN.includes(card) ? columns.main : columns.rail;
  }

  // Booleans, so a change to another card or another preference never
  // reopens a listener. The recent rows are read by their card alone. The
  // upcoming window also feeds the recap and, on a build with the widget
  // plugin, the widget.
  private recentWanted = computed(() => !this.layout().hidden.includes('recent'));
  private upcomingWanted = computed(() =>
    !this.layout().hidden.includes('upcoming') ||
    weeklyRecapEnabled(this.authService.currentUser()?.preferences) ||
    this.widgetSnapshots.available
  );

  gridAreas = computed(() => dashboardGridAreas(this.arrangedCards()));

  // Scheduled money for the next UPCOMING_WINDOW_DAYS, with the count of the
  // occurrences that fell behind the window's floor. Occurrences dated before
  // today are kept as far back as that floor: they are due but not yet
  // posted, and dropping them would hide money about to move on exactly the
  // occasion — a failed catch-up — when the user most needs to see it
  // (ADR 0091). Older than the floor is a rule that stalled long ago, which
  // the card names rather than lists (ADR 0141).
  upcomingSchedule = signal<UpcomingSchedule>({ occurrences: [], olderCount: 0 });

  // A bill link (#446) waits here for the upcoming listener's first emission:
  // the signal's initial empty schedule would have the card answer "absent"
  // for every rule. Reset whenever a listener is opened or closed.
  private requestedBill: string | null = null;
  private upcomingArrived = false;
  // The rule the server listed after the card first said "absent": a second
  // "absent" for it is final, so the two never ask each other in a loop.
  private billOnServer: string | null = null;
  // Counts the links followed, so a server answer can tell that a later link
  // has overtaken the one it was asked for.
  private linksFollowed = 0;

  /** The rule the upcoming card is asked to bring into view; cleared once it answers. */
  billInFocus = signal<string | null>(null);

  upcomingOccurrences = computed(() => this.upcomingSchedule().occurrences);

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

    // Keep the anomaly-baseline window in sync with the selected period, the
    // RAG tier and whether insights is even on the page (#87: a hidden card
    // composes nothing), so a mid-session change refetches or drops the
    // right thing (the ai-summary cache key includes the tier, so insights
    // regenerate immediately and must not ground on a stale window).
    effect(() => {
      this.currentPeriod();
      const months = this.baselineWindowMonths();
      const insightsShown = this.insightsShown();
      if (months === 0 || !insightsShown) {
        // A tier downgrade or a hidden card must also release the in-flight
        // baseline listener, not just blank the data it fed.
        this.baselineSub?.unsubscribe();
        this.historicalExpenses.set(null);
        return;
      }
      untracked(() => this.loadHistoricalBaseline(months));
    });

    // The same rule for the two streams that follow no period: each is
    // opened once while something reads it, and closed, with the data it fed,
    // when nothing does. A period change touches neither.
    effect(() => {
      if (!this.recentWanted()) {
        this.recentSub?.unsubscribe();
        this.recentSub = undefined;
        this.recentTransactions.set([]);
        return;
      }
      untracked(() => this.loadRecentTransactions());
    });

    effect(() => {
      if (!this.upcomingWanted()) {
        this.upcomingSub?.unsubscribe();
        this.upcomingSub = undefined;
        this.upcomingArrived = false;
        this.upcomingSchedule.set({ occurrences: [], olderCount: 0 });
        return;
      }
      untracked(() => this.loadUpcomingSchedule());
    });

    // Hands the widget the figures this page already holds, each time it
    // repaints for this month — the dashboard is the landing route, so this
    // is every app open and every live change. Keyed on the paint counter,
    // not publishedPeriodOption — see its declaration above for why.
    effect(() => {
      const paints = this.thisMonthPaints();
      this.activeBudgets();
      this.upcomingOccurrences();
      if (paints === 0 || untracked(() => this.publishedPeriodOption()) !== 'thisMonth') return;
      untracked(() => this.widgetSnapshots.publish({
        spent: this.totalExpenses(),
        net: this.balance(),
        baseCurrency: this.baseCurrency(),
        budgets: this.activeBudgets(),
        upcoming: this.upcomingOccurrences(),
      }));
    });
  }

  ngOnInit(): void {
    // Load budgets once; the derived budgetAlerts signal feeds the inline
    // alert banner declaratively. Deliberately outside loadData():
    // getBudgets is an infinite live stream, so period changes must not
    // stack extra subscriptions, and takeUntilDestroyed stops destroyed
    // dashboard instances from reacting to later budget writes made
    // elsewhere in the app. Not gated on the budgets card: the banner, which
    // cannot be hidden, the recap's alerts, insights, the widget and the
    // reminder sweep all read the list.
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
    this.loadPickerFloor();
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

    // Every emission, not the snapshot: a second reminder tapped while the
    // page is open changes only the query.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => this.followLink(params));
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.currentPeriod.set(selection);
    this.loadData();
  }

  // Read once: a period change does not move the oldest row. An account with
  // no rows still gets this year, so the pickers are not left without a floor.
  private loadPickerFloor(): void {
    this.transactionService.getEarliestTransactionDateFromServer().then(
      earliest => this.pickerFloor.set(earliest ?? yearWindow(new Date().getFullYear()).start),
      // Offline or refused: no floor, rather than one read from a partial cache.
      () => undefined,
    );
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
          // Only a this-month paint feeds the widget; a switch to another
          // period must not republish it with rows that belong elsewhere.
          if (this.currentPeriod().option === 'thisMonth') {
            this.thisMonthPaints.update(count => count + 1);
          }
        },
        error: () => {
          this.isLoading.set(false);
          this.hasLoadedOnce.set(true);
          // Deliberately not published: the previous period's rows are still on
          // screen, so the summary should keep describing them.
        }
      });

    // Load previous period data for AI comparison. (The trailing historical
    // window for the anomaly baseline is loaded by the constructor effect,
    // which also reacts to period changes via currentPeriod. Categories are
    // period-independent and loaded once in ngOnInit; the recent rows and the
    // upcoming window by their own constructor effects.)
    this.loadPreviousPeriodData();
  }

  // The latest rows, whatever the selected period.
  private loadRecentTransactions(): void {
    this.recentSub?.unsubscribe();
    this.recentSub = this.transactionService.getRecentTransactions(5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transactions) => {
          this.recentTransactions.set(transactions);
        }
      });
  }

  // Anchored to today, not to the selected period.
  private loadUpcomingSchedule(): void {
    this.upcomingSub?.unsubscribe();
    this.upcomingArrived = false;
    this.upcomingSub = this.recurringService.getUpcomingSchedule(UPCOMING_WINDOW_DAYS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(schedule => {
        this.upcomingSchedule.set(schedule);
        this.upcomingArrived = true;
        this.bindRequestedBill();
      });
  }

  /**
   * A reminder's link (#446): `?bill=<rule id>` brings that rule's row into
   * view on the upcoming card, `?recap=<week key>` the weekly recap. Each
   * names something to do once, so both leave the URL as soon as they are
   * read (ADR 0082); the stripped URL comes back through here and does
   * nothing.
   */
  private followLink(params: ParamMap): void {
    if (!params.has('bill') && !params.has('recap')) return;
    this.linksFollowed++;
    const bill = params.get('bill');
    const week = params.get('recap');

    if (bill && this.layout().hidden.includes('upcoming')) {
      this.showRecurringRules(this.translationService.t('dashboard.billLinkCardHidden'));
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { bill: null, recap: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    if (bill) {
      this.billOnServer = null;
      this.requestedBill = bill;
      this.bindRequestedBill();
    }
    if (week) void this.focusRecap(week);
  }

  private bindRequestedBill(): void {
    if (this.requestedBill === null || !this.upcomingArrived) return;
    this.billInFocus.set(this.requestedBill);
    this.requestedBill = null;
  }

  /**
   * The upcoming card's answer to `billInFocus`. A rule with no row on the
   * card — due past the fortnight, already posted, or deleted — is sent to
   * the recurring rules, which list every rule that still exists.
   */
  onBillFocus(outcome: RuleFocusOutcome): void {
    const ruleId = this.billInFocus();
    this.billInFocus.set(null);
    if (outcome === 'absent' && ruleId !== null) void this.confirmBillAbsent(ruleId);
  }

  // The card answers from whatever the listener holds, and its first emission
  // can be this device's cache from before the rule was made or moved into
  // the fortnight. Sending the user away is done once, so "absent" is asked
  // of the server before it is acted on (ADR 0139). Offline the read rejects
  // and the rules page, which lists every rule there is, is still the answer.
  private async confirmBillAbsent(ruleId: string): Promise<void> {
    if (this.billOnServer !== ruleId) {
      const link = this.linksFollowed;
      let listed = false;
      try {
        const schedule = await this.recurringService.getUpcomingScheduleFromServer(UPCOMING_WINDOW_DAYS);
        listed = schedule.occurrences.some(occurrence => occurrence.recurringId === ruleId);
      } catch {
        listed = false;
      }
      // A link followed during the read is the one that counts: acting on
      // this answer would take the user away from it or move focus off it.
      if (this.destroyRef.destroyed || link !== this.linksFollowed) return;
      if (listed) {
        this.billOnServer = ruleId;
        this.requestedBill = ruleId;
        // Caught up during the read: ask the card now.
        if (this.upcomingOccurrences().some(occurrence => occurrence.recurringId === ruleId)) {
          this.bindRequestedBill();
        } else if (this.upcomingWanted()) {
          // The listener walks the fortnight from the day it last emitted, and
          // it emits only when a rule changes, so a page open since an earlier
          // day can wait on it forever. A new listener walks from today, over
          // the cache the read has just refreshed, and its first emission asks
          // the card. A closed one is left closed: the effect re-opens it with
          // the card, and the rule is asked of that one.
          this.loadUpcomingSchedule();
        }
        return;
      }
    }
    this.showRecurringRules(this.translationService.t('dashboard.billLinkNotUpcoming'));
  }

  // Replacing the entry, so Back from the rules does not land on the link
  // again and come straight back.
  private showRecurringRules(reason: string): void {
    this.announcer.announce(reason);
    void this.router.navigate(['/budgets'], { queryParams: { tab: 'recurring' }, replaceUrl: true });
  }

  /**
   * The card's own load is the same single-flight composition, so this waits
   * for it rather than starting another. A link to another week, or to a week
   * the card does not show, has nothing to bring into view.
   */
  private async focusRecap(week: string): Promise<void> {
    await this.recap.load();
    if (this.destroyRef.destroyed) return;
    if (this.recap.weekKey() !== week || !this.recap.visible()) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('app-weekly-recap [role="region"]')?.focus(),
      { injector: this.injector }
    );
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
   * A hidden card takes its menu with it, so focus would fall to the page.
   * It goes on to the next card with a menu in page order, which is the
   * focus order whichever column a card is drawn in, or, past the last of
   * them, to the editor's link.
   */
  focusAfterHide(card: DashboardCardId): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => {
      const order = this.layout().order;
      const successor = this.menuCards().find(id => order.indexOf(id) > order.indexOf(card));
      const page = this.host.nativeElement;
      const trigger = successor
        ? page.querySelector<HTMLElement>(`.dashboard-grid > .area-${successor} .card-menu-trigger`)
        : null;
      (trigger ?? page.querySelector<HTMLElement>('.customize-link'))?.focus();
    }, { injector: this.injector });
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
