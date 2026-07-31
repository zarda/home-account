import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category, receiptImageCount, baseCurrencyOf} from '../../../models';
import {
  TransactionWindowService,
  WindowSortDirection
} from '../../../core/services/transaction-window.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';

// How far outside the scroll container an edge may be and still trigger a
// prefetch (matches the IntersectionObserver rootMargin).
const PREFETCH_MARGIN_PX = 600;
// Auto-fill cap per trigger: bounds how much history one search that matches
// almost nothing can scan.
const MAX_AUTO_FETCHES = 10;
const HIGHLIGHT_MS = 2000;

@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [
    AmountDisplayComponent,
    CategoryChipComponent,
    TransactionRowComponent,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    EmptyStateComponent,
    TranslatePipe
  ],
  templateUrl: './transaction-list.component.html',
  styleUrl: './transaction-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionListComponent {
  // Modern Angular 21: signal-based inputs/outputs
  transactions = input<Transaction[]>([]);
  categories = input<Map<string, Category>>(new Map());
  dateSortDirection = input<WindowSortDirection>('desc');
  edit = output<Transaction>();
  delete = output<Transaction>();
  dateSortChange = output<WindowSortDirection>();

  readonly windowSource = inject(TransactionWindowService);
  private breakpointObserver = inject(BreakpointObserver);
  private host = inject(ElementRef) as ElementRef<HTMLElement>;
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);

  displayedColumns = ['date', 'category', 'description', 'amount', 'actions'];

  // Templates cannot call module functions, so the model helper is exposed
  // through the component.
  receiptCount(transaction: Transaction): number {
    return receiptImageCount(transaction);
  }

  // At most three tag chips in the description cell; the rest fold into "+N".
  visibleTags(transaction: Transaction): string[] {
    return transaction.tags?.slice(0, 3) ?? [];
  }

  overflowTagCount(transaction: Transaction): number {
    return Math.max(0, (transaction.tags?.length ?? 0) - 3);
  }

  /**
   * Maps link for the location — only when coordinates exist. A name-only
   * location stays plain text: linking a typed name would send a typo to a
   * confidently wrong destination.
   */
  mapsUrl(transaction: Transaction): string | null {
    const location = transaction.location;
    if (location?.lat === undefined || location?.lng === undefined) return null;
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
  }

  // Only one of the two views is instantiated; previously both were rendered
  // and the inactive one merely hidden with CSS, doubling the DOM.
  isDesktopTable = toSignal(
    this.breakpointObserver.observe('(min-width: 768px)').pipe(map(result => result.matches)),
    { initialValue: false }
  );

  // The whole filtered result set is loaded; client-side column sorts are only
  // honest in this state.
  fullyLoaded = computed(
    () => this.windowSource.reachedStart() && this.windowSource.reachedEnd()
  );

  showEmptyState = computed(
    () =>
      this.transactions().length === 0 &&
      this.fullyLoaded() &&
      !this.windowSource.isFetching() &&
      this.windowSource.loadError() === null
  );

  highlightedId = signal<string | null>(null);

  private topSentinel = viewChild<ElementRef<HTMLElement>>('topSentinel');
  private bottomSentinel = viewChild<ElementRef<HTMLElement>>('bottomSentinel');

  private scrollParent: HTMLElement | null = null;
  private fetching = false;
  private fetchCheckScheduled = false;

  // Sort state: 'date' delegates to the server-ordered window (pass-through);
  // amount/description sort the loaded rows client-side and are enabled only
  // when the window holds the complete result set.
  private sortActive = signal<string>('date');
  private clientSortDirection = signal<'asc' | 'desc'>('desc');

  sortedTransactions = computed(() => {
    const transactions = this.transactions();
    const active = this.sortActive();
    if (active === 'date') return transactions;

    const dir = this.clientSortDirection() === 'asc' ? 1 : -1;
    return [...transactions].sort((a, b) => {
      switch (active) {
        case 'amount':
          return (a.amount - b.amount) * dir;
        case 'description':
          return a.description.localeCompare(b.description) * dir;
        default:
          return 0;
      }
    });
  });

  trackById = (_: number, transaction: Transaction): string => transaction.id;

  constructor() {
    afterNextRender(() => this.setupEdgeObserver());

    // Window data changed (page fetched, filters reset, mutation applied):
    // re-check the edges once the DOM reflects it, since a sentinel that
    // stayed continuously visible never re-fires the IntersectionObserver.
    effect(() => {
      this.windowSource.window();
      this.windowSource.reachedStart();
      this.windowSource.reachedEnd();
      untracked(() => this.scheduleFetchCheck());
    });

    // Scroll a freshly mutated row into view and flash it.
    effect(() => {
      const target = this.windowSource.scrollTarget();
      if (!target) return;
      untracked(() => this.scrollToTarget(target.id));
    });
  }

  onSortChange(sort: Sort): void {
    // MatSort cycles asc → desc → none; "none" falls back to the default
    // server order.
    if (!sort.direction || sort.active === 'date') {
      this.sortActive.set('date');
      this.dateSortChange.emit((sort.direction || 'desc') as WindowSortDirection);
      return;
    }
    this.sortActive.set(sort.active);
    this.clientSortDirection.set(sort.direction as 'asc' | 'desc');
  }

  onRetry(): void {
    void this.windowSource.retry();
  }

  // Helper methods - these are called from template, so they're fine as methods
  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories());
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories());
  }

  formatAmount(amount: number, currency: string): string {
    return this.currencyService.formatCurrency(amount, currency);
  }

  // Secondary line for foreign-currency rows: what the row counts as in the
  // user's base currency (write-time snapshot; live conversion for legacy
  // rows). Null for rows already in the base currency.
  convertedAmount(transaction: Transaction): string | null {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    if (transaction.currency === baseCurrency) return null;
    const inBase = this.currencyService.amountInBase(transaction, baseCurrency);
    return `≈ ${this.currencyService.formatCurrency(inBase, baseCurrency)}`;
  }

  formatDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatDate(date);
  }

  formatRelativeDate(date: Date | Timestamp): string {
    return this.dateFormatService.formatRelativeDate(date);
  }

  confirmDelete(transaction: Transaction): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translationService.t('transactions.deleteTransaction'),
        message: this.translationService.t('transactions.deleteConfirmMessage', { description: transaction.description }),
        confirmLabel: this.translationService.t('common.delete'),
        cancelLabel: this.translationService.t('common.cancel'),
        confirmColor: 'warn',
        icon: 'delete',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.delete.emit(transaction);
      }
    });
  }

  // === Sliding-window scroll integration ===

  private setupEdgeObserver(): void {
    this.scrollParent = this.findScrollParent(this.host.nativeElement);

    // The observer only wakes the loop; the loop itself re-measures geometry,
    // so stale intersection state can never wedge or over-fetch it.
    const observer = new IntersectionObserver(() => void this.maybeFetch(), {
      root: this.scrollParent,
      rootMargin: `${PREFETCH_MARGIN_PX}px 0px`
    });

    const top = this.topSentinel()?.nativeElement;
    const bottom = this.bottomSentinel()?.nativeElement;
    if (top) observer.observe(top);
    if (bottom) observer.observe(bottom);
    this.destroyRef.onDestroy(() => observer.disconnect());

    void this.maybeFetch();
  }

  private findScrollParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return parent;
      parent = parent.parentElement;
    }
    // null = the viewport scrolls (also what IntersectionObserver expects).
    return null;
  }

  private get scrollEl(): HTMLElement {
    return this.scrollParent ?? ((document.scrollingElement as HTMLElement) ?? document.documentElement);
  }

  private scheduleFetchCheck(): void {
    if (this.fetchCheckScheduled) return;
    this.fetchCheckScheduled = true;
    afterNextRender(
      () => {
        this.fetchCheckScheduled = false;
        void this.maybeFetch();
      },
      { injector: this.injector }
    );
  }

  // Keep pulling pages while an edge is inside the prefetch margin. Covers
  // fast flings (a batch lands, the edge is still near, fetch again) and
  // batches emptied entirely by client-only filters (no height change, so the
  // observer alone would never re-fire).
  private async maybeFetch(): Promise<void> {
    if (this.fetching || this.windowSource.isInitialLoading()) return;
    this.fetching = true;
    try {
      for (let i = 0; i < MAX_AUTO_FETCHES; i++) {
        const source = this.windowSource;
        if (source.loadError()) break; // wait for the retry button

        if (this.isNearEdge('bottom') && !source.reachedEnd()) {
          if ((await this.runAnchored(() => source.fetchNext())) === 0) break;
        } else if (this.isNearEdge('top') && !source.reachedStart()) {
          if ((await this.runAnchored(() => source.fetchPrev())) === 0) break;
        } else {
          break;
        }
      }
    } finally {
      this.fetching = false;
    }
  }

  private isNearEdge(edge: 'top' | 'bottom'): boolean {
    const sentinel = edge === 'top' ? this.topSentinel() : this.bottomSentinel();
    const el = sentinel?.nativeElement;
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    let rootTop = 0;
    let rootBottom = window.innerHeight;
    if (this.scrollParent) {
      const rootRect = this.scrollParent.getBoundingClientRect();
      rootTop = rootRect.top;
      rootBottom = rootRect.bottom;
    }
    return (
      rect.bottom >= rootTop - PREFETCH_MARGIN_PX &&
      rect.top <= rootBottom + PREFETCH_MARGIN_PX
    );
  }

  // Scroll-anchor compensation: measure the first row visible at the container
  // top before the window mutates, re-measure it after render but before
  // paint, and shift scrollTop by the drift. Handles prepend (positive delta),
  // head-trim (negative) and append/tail-trim (zero) uniformly, with no
  // fixed-row-height assumption. Trims always happen far outside the viewport
  // (see TRIM_THRESHOLD math), so the anchor row itself is never removed.
  private async runAnchored(fetch: () => Promise<number>): Promise<number> {
    const containerTop = this.scrollParent
      ? this.scrollParent.getBoundingClientRect().top
      : 0;

    let anchorId: string | null = null;
    let anchorTop = 0;
    const rows = this.host.nativeElement.querySelectorAll<HTMLElement>('[data-tx-id]');
    for (const row of Array.from(rows)) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        anchorId = row.dataset['txId'] ?? null;
        anchorTop = rect.top;
        break;
      }
    }

    const added = await fetch();
    if (added === 0 || !anchorId) return added;
    const stableAnchorId = anchorId;

    await new Promise<void>(resolve => {
      // afterNextRender runs post-layout, pre-paint: the correction is never
      // visible as a jump.
      afterNextRender(
        () => {
          const el = this.host.nativeElement.querySelector<HTMLElement>(
            `[data-tx-id="${CSS.escape(stableAnchorId)}"]`
          );
          if (el) {
            const delta = el.getBoundingClientRect().top - anchorTop;
            if (delta !== 0) this.scrollEl.scrollTop += delta;
          }
          resolve();
        },
        { injector: this.injector }
      );
    });
    return added;
  }

  private scrollToTarget(id: string): void {
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-tx-id="${CSS.escape(id)}"]`
        );
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          this.highlightedId.set(id);
          setTimeout(() => {
            if (this.highlightedId() === id) this.highlightedId.set(null);
          }, HIGHLIGHT_MS);
        }
        this.windowSource.clearScrollTarget();
      },
      { injector: this.injector }
    );
  }
}
