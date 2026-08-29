import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Subscription, firstValueFrom } from 'rxjs';
import { TransactionService, TransactionMutation } from '../../core/services/transaction.service';
import { TransactionWindowService, WindowSortDirection } from '../../core/services/transaction-window.service';
import { PeriodTotalsService } from '../../core/services/period-totals.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { Transaction, TransactionFilters, Category, baseCurrencyOf } from '../../models';
import { injectIsMobileViewport } from '../../core/layout/viewport';
import { parseDayKey } from '../../core/utils/transaction-date.utils';
import { pinLeadingMinus, snapDisplayZero } from '../../core/utils/money-display.utils';
import { FitTextDirective } from '../../shared/directives/fit-text.directive';
import { TransactionListComponent } from './transaction-list/transaction-list.component';
import { TransactionFiltersComponent } from './transaction-filters/transaction-filters.component';
import { InsightChipsComponent } from './insight-chips/insight-chips.component';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { QuickAddService } from '../../core/services/quick-add.service';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { AnnouncerService } from '../../core/services/announcer.service';

/** One header money figure: a catalog label over a formatted amount. */
export interface HeaderFigure {
  labelKey: string;
  value: string;
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    PageHeaderComponent,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TransactionListComponent,
    TransactionFiltersComponent,
    InsightChipsComponent,
    LoadingSpinnerComponent,
    FitTextDirective,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  // Page-scoped: window state (cursors, loaded range) and the swept totals
  // reset on every visit; the window is shared with the child list component
  // through the injector.
  providers: [TransactionWindowService, PeriodTotalsService],
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  readonly windowSource = inject(TransactionWindowService);
  readonly periodTotals = inject(PeriodTotalsService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private localeFormat = inject(LocaleFormatService);
  private dialog = inject(MatDialog);
  private quickAdd = inject(QuickAddService);
  private route = inject(ActivatedRoute);
  private translationService = inject(TranslationService);
  private notifications = inject(NotificationService);
  private announcer = inject(AnnouncerService);
  private pendingFilters = inject(PendingFiltersService);

  // The layout gate for both the add affordance and the totals. The
  // bottom-nav "+" that replaces the header FAB binds to this same query,
  // so exactly one of the two is on screen at every width.
  readonly isMobileViewport = injectIsMobileViewport();

  transactions = this.windowSource.visibleWindow;
  isInitialLoading = this.windowSource.isInitialLoading;

  // Header count: the server-side total of the filtered set when it is exact,
  // otherwise the loaded count with a "+" while more pages remain (client-only
  // filters shrink rows per fetched page, so no exact total exists for them).
  transactionCount = computed(() => {
    const filters = this.currentFilters();
    const hasClientOnlyFilter =
      // typeof: a cleared amount box arrives as null and is not a filter, so
      // the header keeps showing the exact server count.
      typeof filters.minAmount === 'number' ||
      typeof filters.maxAmount === 'number' ||
      !!filters.searchQuery ||
      !!filters.tags?.length;

    if (!hasClientOnlyFilter) {
      const total = this.windowSource.totalCount();
      if (total !== null) return `${total}`;
    }

    const loaded = this.transactions().length;
    const complete = this.windowSource.reachedStart() && this.windowSource.reachedEnd();
    return complete ? `${loaded}` : `${loaded}+`;
  });

  // Header totals render state. 'ready' additionally requires a non-null
  // fold, so a figure can never render from a sweep that was invalidated
  // between the status settling and the template reading it.
  readonly totalsState = computed<'hidden' | 'computing' | 'ready' | 'unavailable' | 'overCap'>(() => {
    switch (this.periodTotals.status().kind) {
      case 'idle':
        return 'hidden';
      case 'computing':
        return 'computing';
      case 'over-cap':
        return 'overCap';
      case 'unavailable':
        return 'unavailable';
      case 'ready':
        return this.periodTotals.totals() ? 'ready' : 'computing';
    }
  });

  // Under a type filter only the meaningful figure renders: with expenses
  // only, Net is identically minus Spent; with income only, Spent would
  // print a zero over a list of salary rows.
  readonly totalsFigures = computed<HeaderFigure[]>(() => {
    const totals = this.periodTotals.totals();
    if (this.totalsState() !== 'ready' || !totals) return [];
    const base = this.baseCurrency();
    const figure = (labelKey: string, raw: number): HeaderFigure => ({
      labelKey,
      value: pinLeadingMinus(this.currencyService.formatCurrency(snapDisplayZero(raw, base), base))
    });
    const type = this.currentFilters().type;
    if (type === 'expense') return [figure('common.totalExpenses', totals.expense)];
    if (type === 'income') return [figure('common.totalIncome', totals.income)];
    return [
      figure('common.totalExpenses', totals.expense),
      figure('common.netBalance', totals.balance)
    ];
  });

  private baseCurrency = computed(() => baseCurrencyOf(this.authService.currentUser()));

  // Which range the mobile figures describe. Rendered only when the filter
  // carries both bounds — an open-ended or show-all set has no honest range
  // caption, and the figures are still correct without one.
  readonly periodCaption = computed(() => {
    const { startDate, endDate } = this.currentFilters();
    return startDate && endDate ? this.localeFormat.formatRange(startDate, endDate, 'medium') : '';
  });

  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;
  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  private currentFilters = signal<TransactionFilters>({});
  sortDirection = signal<WindowSortDirection>('desc');
  private categoriesSub?: Subscription;
  private lastAnnouncedResetSeq = 0;
  // The transaction id named by ?tx=, read once at init and consumed after
  // the first window seed (see onFiltersChanged) — a later filter change
  // must not replay it.
  private pendingOpenTxId: string | null = null;

  initialDate = signal<Date | undefined>(undefined);
  showAll = signal<boolean>(false);

  // Filters pushed from outside the filters panel (insight chips, smart
  // search). Always set with a fresh object so the panel's ngOnChanges fires
  // even when the same filter set is applied twice.
  externalFilters = signal<TransactionFilters | undefined>(undefined);

  constructor() {
    // React to writes made anywhere in the app while this page is open
    // (form dialog, bottom-nav quick add, camera import): update the window
    // based on whether the mutated row falls inside the loaded range.
    const initialSeq = this.transactionService.lastMutation()?.seq ?? 0;
    effect(() => {
      const mutation = this.transactionService.lastMutation();
      if (!mutation || mutation.seq <= initialSeq) return;
      untracked(() => void this.onTransactionMutated(mutation));
    });

    // Announce the result count and the settled totals to assistive
    // technology as one combined message, once per filter/sort change
    // (resetSeq) — not per scrolled page, and not again when a later rates
    // or language change refolds the same figures. If the reset lands while
    // the sweep is still computing, the effect waits for the settled state;
    // if the sweep settles first, the seq bump fires it. Either ordering
    // announces exactly once, guarded by lastAnnouncedResetSeq.
    effect(() => {
      const seq = this.windowSource.resetSeq();
      const state = this.totalsState();
      if (seq === 0 || state === 'computing') return;
      if (seq === this.lastAnnouncedResetSeq) return;
      this.lastAnnouncedResetSeq = seq;
      untracked(() => {
        const countText = this.translationService.t('transactions.resultCountAnnouncement', {
          count: this.transactions().length
        });
        this.announcer.announce(
          state === 'hidden'
            ? countText // totals not wired for this reset (e.g. signed out)
            : this.translationService.t('transactions.resultWithTotalsAnnouncement', {
                countText,
                totalsText: this.totalsAnnouncementText()
              })
        );
      });
    });

    // Filters handed off from the smart-search dialog: works both when this
    // page is freshly created by the navigation and when it was already open.
    effect(() => {
      const pending = this.pendingFilters.pending();
      if (!pending) return;
      untracked(() => {
        const filters = this.pendingFilters.consume();
        if (filters) {
          this.applyExternalFilters(filters);
        }
      });
    });
  }

  ngOnInit(): void {
    // Check for a transaction to open (from the import-history shortcut).
    // A one-shot snapshot read, deliberately not the re-firing
    // route.queryParams subscription action=add uses below — replaying this
    // on every later filter change would reopen the dialog behind the user.
    // Read ahead of showAll/date below: the target may live outside any
    // default date box, and jumpTo seeds through the active filters, so the
    // window must carry none — tx forces show-all and skips the date
    // pre-filter entirely.
    this.pendingOpenTxId = this.route.snapshot.queryParamMap.get('tx');
    if (this.pendingOpenTxId) {
      this.showAll.set(true);
    }

    // Check for showAll query param (from "View All" link)
    const showAllParam = this.route.snapshot.queryParamMap.get('showAll');
    if (showAllParam === 'true') {
      this.showAll.set(true);
    }

    // Check for date query param to pre-filter
    // The producer writes a local day key; new Date() would read it back as
    // UTC, pre-filtering to the neighbouring day west of UTC. parseDayKey is
    // the exact inverse, and returns null rather than an Invalid Date.
    if (!this.pendingOpenTxId) {
      const dateParam = this.route.snapshot.queryParamMap.get('date');
      if (dateParam) {
        const date = parseDayKey(dateParam);
        if (date) {
          this.initialDate.set(date);
        }
      }
    }

    // Load categories (only once)
    this.categoriesSub = this.categoryService.loadCategories().subscribe();

    // No transaction load here: the filters component always emits its initial
    // filter set (thisMonth / cleared / initialDate) right after init, and
    // onFiltersChanged seeds the window from it. isInitialLoading starts true
    // so the spinner covers the gap.

    // Check for add action in query params
    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'add') {
        setTimeout(() => this.openAddDialog(), 100);
      }
    });
  }

  ngOnDestroy(): void {
    this.categoriesSub?.unsubscribe();
  }

  onFiltersChanged(filters: TransactionFilters): void {
    this.currentFilters.set(filters);
    const reset = this.windowSource.reset(filters, this.sortDirection());
    void this.periodTotals.reset(filters);
    this.scrollToTop();

    // Consumed on the FIRST window seed only: cleared before the reset
    // settles, so a filter change fired while it is still pending cannot
    // pick it up again.
    const pending = this.pendingOpenTxId;
    if (pending) {
      this.pendingOpenTxId = null;
      void reset
        .then(() => this.openLinkedTransaction(pending))
        .catch(() => this.notifications.error(this.translationService.t('common.error')));
    }
  }

  applyExternalFilters(filters: TransactionFilters): void {
    this.externalFilters.set({ ...filters });
  }

  onDateSortChange(direction: WindowSortDirection): void {
    if (direction === this.sortDirection()) return;
    this.sortDirection.set(direction);
    // Deliberately no periodTotals reset: sums are order-independent.
    void this.windowSource.reset(this.currentFilters(), direction);
    this.scrollToTop();
  }

  async onCalculateTotals(): Promise<void> {
    // False means superseded or failed — either way another path owns the
    // next announcement, so this one stays silent.
    if (!(await this.periodTotals.calculate())) return;
    this.announcer.announce(this.totalsAnnouncementText());
  }

  // The totals as translated prose. Amounts are spoken without the WORD
  // JOINER, and a negative value becomes a translated word rather than a
  // '−' glyph, which screen readers drop at default punctuation verbosity.
  private totalsAnnouncementText(): string {
    const state = this.totalsState();
    if (state === 'overCap') {
      return this.translationService.t('transactions.totalsOverCapAnnouncement');
    }
    if (state === 'unavailable') {
      return this.translationService.t('transactions.totalsUnavailable');
    }
    const totals = this.periodTotals.totals();
    if (state !== 'ready' || !totals) return '';

    const base = this.baseCurrency();
    const spoken = (raw: number): string => {
      const snapped = snapDisplayZero(raw, base);
      const amount = this.currencyService.formatCurrency(Math.abs(snapped), base);
      return snapped < 0
        ? this.translationService.t('transactions.negativeAmount', { amount })
        : amount;
    };

    const type = this.currentFilters().type;
    if (type === 'expense' || type === 'income') {
      return this.translationService.t('transactions.totalsAnnouncementSingle', {
        label: this.translationService.t(
          type === 'expense' ? 'common.totalExpenses' : 'common.totalIncome'
        ),
        value: spoken(type === 'expense' ? totals.expense : totals.income)
      });
    }
    return this.translationService.t('transactions.totalsAnnouncement', {
      spent: spoken(totals.expense),
      net: spoken(totals.balance)
    });
  }

  private async onTransactionMutated(mutation: TransactionMutation): Promise<void> {
    const { kind, id, date } = mutation;

    // Unconditionally: a row jumped to outside the loaded range still
    // changes the period's totals.
    void this.periodTotals.refresh();

    if ((kind === 'add' || kind === 'update') && date && !this.windowSource.isInLoadedRange(date)) {
      // The row landed outside the loaded range: jump the window to it.
      await this.windowSource.jumpTo(date);
    } else {
      await this.windowSource.refresh();
    }

    if (kind !== 'delete') {
      this.windowSource.requestScrollTo(id);
    }
  }

  // Opens the transaction named by the tx query param (the import-history
  // shortcut) once the window it lands in is settled. getTransactionById
  // emits null for a deleted doc — an explicit tap earns an explicit toast,
  // unlike the silent-skip precedent for passive lists.
  private async openLinkedTransaction(id: string): Promise<void> {
    const transaction = await firstValueFrom(this.transactionService.getTransactionById(id));
    if (!transaction) {
      this.notifications.info(this.translationService.t('import.linkedTransactionGone'));
      return;
    }
    if (!this.windowSource.isInLoadedRange(transaction.date)) {
      await this.windowSource.jumpTo(transaction.date);
    }
    this.windowSource.requestScrollTo(id);
    this.openEditDialog(transaction);
  }

  private scrollToTop(): void {
    // The app scrolls inside .main-container (see main-layout), not the window.
    document.querySelector('.main-container')?.scrollTo({ top: 0 });
  }

  openAddDialog(): void {
    // The window updates via the service's lastMutation signal on save.
    this.quickAdd.openAddTransaction();
  }

  openEditDialog(transaction: Transaction): void {
    this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'edit', transaction },
    });
  }

  async onDeleteTransaction(transaction: Transaction): Promise<void> {
    try {
      await this.transactionService.deleteTransaction(transaction.id);
      // The lastMutation effect refreshes the window.
    } catch (error) {
      // The row never left the list — no rollback needed, but the user has
      // to be told the delete did not happen.
      console.error('[Transactions] Delete failed:', error);
      this.notifications.error(this.translationService.t('common.error'));
    }
  }

  navigateToImportFile(): void {
    this.quickAdd.openImportPhotos();
  }

  openCameraDialog(): void {
    this.quickAdd.openScanReceipt();
  }
}
