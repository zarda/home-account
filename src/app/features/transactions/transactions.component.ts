import { Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { TransactionService, TransactionMutation } from '../../core/services/transaction.service';
import { TransactionWindowService, WindowSortDirection } from '../../core/services/transaction-window.service';
import { CategoryService } from '../../core/services/category.service';
import { DeviceService } from '../../core/services/device.service';
import { Transaction, TransactionFilters, Category } from '../../models';
import { TransactionListComponent } from './transaction-list/transaction-list.component';
import { TransactionFiltersComponent } from './transaction-filters/transaction-filters.component';
import { InsightChipsComponent } from './insight-chips/insight-chips.component';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { CameraCaptureComponent } from './camera-capture/camera-capture.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { TranslationService } from '../../core/services/translation.service';
import { AnnouncerService } from '../../core/services/announcer.service';

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
    TranslatePipe
  ],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  // Page-scoped: window state (cursors, loaded range) resets on every visit
  // and is shared with the child list component through the injector.
  providers: [TransactionWindowService],
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  readonly windowSource = inject(TransactionWindowService);
  private categoryService = inject(CategoryService);
  readonly deviceService = inject(DeviceService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translationService = inject(TranslationService);
  private announcer = inject(AnnouncerService);

  transactions = this.windowSource.visibleWindow;
  isInitialLoading = this.windowSource.isInitialLoading;

  // Header count: the server-side total of the filtered set when it is exact,
  // otherwise the loaded count with a "+" while more pages remain (client-only
  // filters shrink rows per fetched page, so no exact total exists for them).
  transactionCount = computed(() => {
    const filters = this.currentFilters();
    const hasClientOnlyFilter =
      filters.minAmount !== undefined || filters.maxAmount !== undefined || !!filters.searchQuery;

    if (!hasClientOnlyFilter) {
      const total = this.windowSource.totalCount();
      if (total !== null) return `${total}`;
    }

    const loaded = this.transactions().length;
    const complete = this.windowSource.reachedStart() && this.windowSource.reachedEnd();
    return complete ? `${loaded}` : `${loaded}+`;
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

    // Announce result counts to assistive technology once per filter/sort
    // change (resetSeq), not per scrolled page.
    effect(() => {
      const seq = this.windowSource.resetSeq();
      if (seq === 0) return;
      untracked(() => {
        const count = this.transactions().length;
        this.announcer.announce(
          this.translationService.t('transactions.resultCountAnnouncement', { count })
        );
      });
    });
  }

  ngOnInit(): void {
    // Check for showAll query param (from "View All" link)
    const showAllParam = this.route.snapshot.queryParamMap.get('showAll');
    if (showAllParam === 'true') {
      this.showAll.set(true);
    }

    // Check for date query param to pre-filter
    const dateParam = this.route.snapshot.queryParamMap.get('date');
    if (dateParam) {
      const date = new Date(dateParam);
      if (!isNaN(date.getTime())) {
        this.initialDate.set(date);
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
    void this.windowSource.reset(filters, this.sortDirection());
    this.scrollToTop();
  }

  applyExternalFilters(filters: TransactionFilters): void {
    this.externalFilters.set({ ...filters });
  }

  onDateSortChange(direction: WindowSortDirection): void {
    if (direction === this.sortDirection()) return;
    this.sortDirection.set(direction);
    void this.windowSource.reset(this.currentFilters(), direction);
    this.scrollToTop();
  }

  private async onTransactionMutated(mutation: TransactionMutation): Promise<void> {
    const { kind, id, date } = mutation;

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

  private scrollToTop(): void {
    // The app scrolls inside .main-container (see main-layout), not the window.
    document.querySelector('.main-container')?.scrollTo({ top: 0 });
  }

  openAddDialog(): void {
    // The window updates via the service's lastMutation signal on save.
    this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });
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
    } catch {
      // Error handled silently - snackbar could be added here
    }
  }

  navigateToImportFile(): void {
    this.router.navigate(['/import/file']);
  }

  openCameraDialog(): void {
    this.dialog.open(CameraCaptureComponent, {
      width: '500px',
      maxWidth: '95vw',
    });
  }
}
