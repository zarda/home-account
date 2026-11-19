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
  linkedSignal,
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import {
  Transaction,
  Category,
  MAX_BULK_SHARE,
  receiptImageCount,
  baseCurrencyOf,
  normalizeShares,
  sharedChipLabel,
  sharedHouseholdNames,
  signedAmountText
} from '../../../models';
import {
  TransactionWindowService,
  WindowSortDirection
} from '../../../core/services/transaction-window.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { NoteDialogComponent, NoteDialogData } from '../note-dialog/note-dialog.component';
import { ShareDialogComponent, ShareDialogData } from '../sharing/share-dialog.component';
import { BulkShareKind, RowSharingService, ShareOutcome } from '../../../core/services/row-sharing.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { PwaService } from '../../../core/services/pwa.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { focusDropped } from '../../../core/utils/focus.utils';
import { FocusContext, focusWhenRendered } from '../../../shared/utils/focus-when-rendered';
import { ShareTarget, landedKinds, shareChange } from '../../../core/utils/share-change.utils';
import { isUntitled, quotedTransactionName, transactionDisplayName } from '../../../core/utils/transaction-display.utils';
import { openReceiptViewer } from '../receipt-viewer/receipt-viewer-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LocationLabelPipe } from '../../../shared/pipes/location-label.pipe';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { FitTextDirective } from '../../../shared/directives/fit-text.directive';

// How far outside the scroll container an edge may be and still trigger a
// prefetch (matches the IntersectionObserver rootMargin).
const PREFETCH_MARGIN_PX = 600;
// Auto-fill cap per trigger: bounds how much history one search that matches
// almost nothing can scan.
const MAX_AUTO_FETCHES = 10;
const HIGHLIGHT_MS = 2000;
const TABLE_COLUMNS = ['date', 'category', 'description', 'amount', 'actions'];

@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [
    AmountDisplayComponent,
    CategoryChipComponent,
    TransactionRowComponent,
    FitTextDirective,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    EmptyStateComponent,
    TranslatePipe,
    LocationLabelPipe
  ],
  templateUrl: './transaction-list.component.html',
  styleUrl: './transaction-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // On the document, so Escape leaves the select mode from wherever focus is
  // in the list (the toggle, the bar, a row or its checkbox), and only once
  // an overlay has passed on it: a tooltip open on a row's button takes its
  // Escape at the body and stops it there.
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
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
  private localeFormat = inject(LocaleFormatService);
  private dialog = inject(MatDialog);
  private quickAdd = inject(QuickAddService);
  private rowSharing = inject(RowSharingService);
  private pwa = inject(PwaService);
  private announcer = inject(AnnouncerService);
  private analytics = inject(AnalyticsService);

  // Where focus goes once a confirmed delete's row has left the list and
  // taken the control that held focus with it (focusWhenRendered).
  private readonly focus: FocusContext = {
    host: this.host.nativeElement,
    injector: this.injector,
    destroyRef: this.destroyRef,
  };

  /**
   * The row of a confirmed delete until it leaves the list: its id, and its
   * place in the list, kept up to date while rows load or go above it.
   */
  private readonly deletedRow = signal<{ readonly id: string; index: number } | null>(null);

  /** The account's live households, which the row menus offer to share into. */
  readonly shareTargets = toSignal(this.rowSharing.targets(), { initialValue: [] });

  /** Id to name, for the rows' share chips. */
  readonly householdNames = computed(
    () => new Map(this.shareTargets().map(target => [target.householdId, target.name]))
  );

  // === Select mode ===
  // Many rows chosen at once, then shared into or taken out of households
  // together. Offered only to an account that belongs to a household.

  readonly maxBulkShare = MAX_BULK_SHARE;

  /** True while the reader is choosing rows; see `inSelectMode`. */
  private readonly selecting = signal(false);

  /**
   * The mode as the page shows it: on only while the account belongs to a
   * household, so leaving the last one ends it wherever that happened.
   */
  readonly inSelectMode = computed(() => this.selecting() && this.shareTargets().length > 0);

  /**
   * Kept after the mode is left over a list with no rows, so the toggle, and
   * the focus on it, stay; let go once the list has rows again, or loses
   * them after that.
   */
  private readonly keepBar = linkedSignal({
    source: () => this.sortedTransactions().length > 0,
    computation: () => false,
  });

  /** Offered with a household to share into and a row to choose, or while on, so it can always be left. */
  readonly showSelectBar = computed(
    () => this.shareTargets().length > 0 &&
      (this.inSelectMode() || this.sortedTransactions().length > 0 || this.keepBar())
  );

  /**
   * The chosen rows' ids in the order they were chosen. Ids rather than
   * rows: a chosen row may leave the loaded window as it scrolls, and is
   * still chosen.
   */
  private readonly selection = signal<readonly string[]>([]);
  private readonly selectedIds = computed(() => new Set(this.selection()));
  readonly selectedCount = computed(() => this.selection().length);

  /**
   * Moves each time the mode is entered or left. A run clears the rows it
   * applied only from the selection it was started from, never from one
   * made after the mode was left and entered again.
   */
  private selectSession = 0;

  /** How many rows the last choice left out for the cap; 0 hides the note. */
  readonly cappedCount = signal(0);

  /** A share or unshare of the chosen rows is running. */
  readonly bulkRunning = signal(false);

  /** How far it has got, 0 to 100. */
  readonly bulkProgress = signal(0);

  /** Share with… and Stop sharing wait for a row, and for a run to finish. */
  readonly bulkHeld = computed(() => this.selectedCount() === 0 || this.bulkRunning());

  // `read`, because the toggle is a MatButton host, whose reference is the
  // component rather than the element.
  private selectToggle = viewChild('selectToggle', { read: ElementRef<HTMLElement> });

  readonly displayedColumns = computed(() => this.inSelectMode() ? ['select', ...TABLE_COLUMNS] : TABLE_COLUMNS);

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
          return this.localeFormat.compare(a.description, b.description) * dir;
        default:
          return 0;
      }
    });
  });

  trackById = (_: number, transaction: Transaction): string => transaction.id;

  constructor() {
    afterNextRender(() => this.setupEdgeObserver());

    // A row whose shares changed is read again, so its chip follows: the
    // window reads rows once, and an edit's shares land after the edit's
    // own refresh may already have read the row.
    const sharedAt = this.rowSharing.revision();
    effect(() => {
      if (this.rowSharing.revision() === sharedAt) return;
      untracked(() => void this.windowSource.refresh());
    });

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

    // A confirmed delete's row leaves the moment the confirm closes, since
    // the page hides it while its delete waits out the Undo window, and takes
    // the control that held focus with it. Until it has gone the row's place
    // is followed; then focus goes to the row now in that place
    // (focusAfterDelete). A list left with no row and no empty state is still
    // loading past a filter only the loaded rows are matched against: the
    // hand-off waits for either.
    effect(() => {
      const deleted = this.deletedRow();
      if (!deleted) return;
      const rows = this.sortedTransactions();
      const index = rows.findIndex(row => row.id === deleted.id);
      if (index >= 0) {
        deleted.index = index;
        return;
      }
      if (rows.length === 0 && !this.showEmptyState()) return;
      untracked(() => {
        this.deletedRow.set(null);
        this.focusAfterDelete(deleted.index, rows);
      });
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

  // The empty-state CTA (shown both for a genuinely empty list and for
  // filters that match nothing) opens the same quick-add seam as the bottom
  // nav and the page's own add button.
  onAddFromEmptyState(): void {
    this.quickAdd.openAddTransaction();
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

  /**
   * Open the note at full length.
   *
   * One handler behind three doors — the icon in the description cell, the
   * desktop actions menu and the phone's trailing menu — because the note is
   * the same note from all three and only the tooltip was ever desktop-only.
   */
  openNote(transaction: Transaction): void {
    this.dialog.open(NoteDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: {
        note: transaction.note ?? '',
        description: transaction.description,
      } as NoteDialogData,
    });
  }

  /**
   * Open the receipt viewer for one transaction.
   *
   * One handler behind three doors — the icon in the description cell, the
   * desktop actions menu and the phone's trailing menu — same as `openNote`.
   * `slot` is only ever passed by a caller that already knows which image it
   * means; the icon and both menus mean "the transaction", not one image.
   */
  openReceipt(transaction: Transaction, slot?: number): void {
    openReceiptViewer(this.dialog, { transaction, slot });
  }

  /** The live households a row is shared with, by name; null for a private row. */
  sharedNames(transaction: Transaction): string[] | null {
    return sharedHouseholdNames(transaction.sharedWith, this.householdNames());
  }

  /** A share chip's name: every household, where the chip shows only the first. */
  sharedLabel(names: readonly string[]): string {
    return sharedChipLabel(names, (key, params) => this.translationService.t(key, params));
  }

  /**
   * Who one row is shared with, chosen in a dialog set from the row. The
   * difference becomes one share per household added and one unshare per
   * household taken off, as the transaction form's chips do; a failure is
   * reported by RowSharingService.
   */
  openShare(transaction: Transaction): void {
    const targets = this.shareTargets();
    const shared = normalizeShares(transaction.sharedWith);
    this.dialog
      .open<ShareDialogComponent, ShareDialogData, string[]>(ShareDialogComponent, {
        width: '400px',
        maxWidth: '95vw',
        data: { description: transaction.description, targets, shared },
      })
      .afterClosed()
      .subscribe(chosen => {
        if (!chosen) return;
        const change = shareChange(shared, chosen, targets.map(target => target.householdId));
        void this.rowSharing.apply(transaction.id, change, targets).then(outcome => this.reportShares(outcome));
      });
  }

  /**
   * Stops sharing one row with every live household it names, once
   * confirmed. The confirm says what an unshare takes away: the household's
   * view of the row and any of its goals counting it; offline, that the
   * household keeps seeing the row until the device reconnects. A key for a
   * membership that has ended is left alone, as the share dialog leaves it.
   */
  stopSharing(transaction: Transaction): void {
    const targets = this.shareTargets();
    const names = this.sharedNames(transaction);
    const change = shareChange(normalizeShares(transaction.sharedWith), [], targets.map(target => target.householdId));
    if (!names || change.unshare.length === 0) return;
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        width: '400px',
        maxWidth: '95vw',
        data: {
          title: this.translationService.t('transactions.share.stopTitle', {
            names: names.join(this.translationService.t('transactions.share.separator')),
          }),
          message: this.stopSharingMessage(transaction),
          confirmLabel: this.translationService.t('transactions.share.stop'),
          cancelLabel: this.translationService.t('common.cancel'),
          icon: 'group_remove',
        },
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) void this.rowSharing.apply(transaction.id, change, targets).then(outcome => this.reportShares(outcome));
      });
  }

  /**
   * What a stop-sharing confirm says the household loses, online or
   * offline. A row with a description is quoted by it; an untitled row is
   * "this untitled transaction", since the catalog's words for one, in
   * quotes, would read as the row's own name.
   */
  private stopSharingMessage(transaction: Transaction): string {
    const online = this.pwa.isOnline();
    if (isUntitled(transaction.description)) {
      return this.translationService.t(
        online ? 'transactions.share.stopUntitledMessage' : 'transactions.share.stopUntitledMessageOffline'
      );
    }
    return this.translationService.t(online ? 'transactions.share.stopMessage' : 'transactions.share.stopMessageOffline', {
      description: this.transactionName(transaction),
    });
  }

  private reportShares({ landed }: ShareOutcome): void {
    for (const action of landedKinds(landed)) this.analytics.trackHouseholdAction({ action });
  }

  // === Select mode ===

  /**
   * Enters the mode or, from Done, leaves it. The toggle is one element in
   * both states, so focus stays on it either way.
   */
  toggleSelectMode(): void {
    if (this.inSelectMode()) {
      this.leaveSelectMode();
      return;
    }
    this.selectSession++;
    this.selecting.set(true);
    this.selection.set([]);
    this.cappedCount.set(0);
    this.announceCount();
  }

  /**
   * Escape leaves the mode, from anywhere in the list, and hands focus back
   * to the toggle. An Escape from outside the list, or one an overlay has
   * already taken, is not the list's.
   */
  onEscape(event: Event): void {
    if (!this.inSelectMode() || event.defaultPrevented) return;
    if (!this.host.nativeElement.contains(event.target as Node | null)) return;
    this.leaveSelectMode();
    this.selectToggle()?.nativeElement.focus();
  }

  private leaveSelectMode(): void {
    this.selectSession++;
    this.selecting.set(false);
    this.selection.set([]);
    this.cappedCount.set(0);
    this.keepBar.set(this.sortedTransactions().length === 0);
  }

  isSelected(transaction: Transaction): boolean {
    return this.selectedIds().has(transaction.id);
  }

  /** A row's click, and Enter on its button: it opens the row, or in the mode chooses it. */
  onRowActivate(transaction: Transaction): void {
    if (this.inSelectMode()) this.toggleRow(transaction);
    else this.edit.emit(transaction);
  }

  /**
   * A row's checkbox. A row past the cap is refused, and the box is set
   * back, since its binding has not changed and would leave it checked.
   */
  onRowChecked(transaction: Transaction, event: MatCheckboxChange): void {
    if (event.checked === this.isSelected(transaction)) return;
    if (!this.toggleRow(transaction)) event.source.checked = false;
  }

  /** Chooses a row or lets it go; false when the cap refused it. */
  toggleRow(transaction: Transaction): boolean {
    if (this.isSelected(transaction)) {
      this.selection.update(ids => ids.filter(id => id !== transaction.id));
      this.cappedCount.set(0);
      this.announceCount();
      return true;
    }
    if (this.selectedCount() >= MAX_BULK_SHARE) {
      this.cappedCount.set(1);
      this.announceCount();
      return false;
    }
    this.selection.update(ids => [...ids, transaction.id]);
    this.cappedCount.set(0);
    this.announceCount();
    return true;
  }

  /**
   * Chooses every row the loaded window holds, after those already chosen,
   * up to MAX_BULK_SHARE; the note says how many it left out.
   */
  selectAllShown(): void {
    const held = this.selection();
    const chosen = new Set(held);
    const shown = this.sortedTransactions().map(row => row.id).filter(id => !chosen.has(id));
    const room = Math.max(0, MAX_BULK_SHARE - held.length);
    this.selection.set([...held, ...shown.slice(0, room)]);
    this.cappedCount.set(Math.max(0, shown.length - room));
    this.announceCount();
  }

  /**
   * The count, followed by the cap's note when a choice was refused, as one
   * message that replaces any not yet spoken: each refused choice still says
   * why, and a run of them never piles up notes behind the count. Only a
   * reader's own change is announced: the result of a run is told by its
   * notification.
   */
  private announceCount(): void {
    const count = this.translationService.t('transactions.select.count', { count: this.selectedCount() });
    const capped = this.cappedCount();
    const message = capped > 0
      ? `${count} ${this.translationService.t('transactions.select.capped', { max: MAX_BULK_SHARE, count: capped })}`
      : count;
    this.announcer.announce(message, 'polite', 'replace');
  }

  /** Share with…: the households to share the chosen rows into; the only one is offered checked. */
  shareSelected(): void {
    if (this.bulkHeld()) return;
    const targets = this.shareTargets();
    this.chooseHouseholds('share', targets.length === 1 ? [targets[0].householdId] : []);
  }

  /**
   * Stop sharing: the households to take the chosen rows out of, checked
   * where a chosen row the list holds is shared with them. The dialog says
   * what that takes away, and offline that it waits for the device.
   */
  stopSharingSelected(): void {
    if (this.bulkHeld()) return;
    const offered = new Set(this.shareTargets().map(target => target.householdId));
    const chosen = this.selectedIds();
    const named = new Set(this.transactions()
      .filter(row => chosen.has(row.id))
      .flatMap(row => normalizeShares(row.sharedWith)));
    this.chooseHouseholds('unshare', [...offered].filter(id => named.has(id)));
  }

  private chooseHouseholds(kind: BulkShareKind, suggested: string[]): void {
    const targets = this.shareTargets();
    const ids = [...this.selection()];
    // The dialog is modal: nothing leaves or enters the mode while it is open.
    const session = this.selectSession;
    this.dialog
      .open<ShareDialogComponent, ShareDialogData, string[]>(ShareDialogComponent, {
        width: '400px',
        maxWidth: '95vw',
        data: {
          description: this.translationService.t('transactions.select.dialogRows', { count: ids.length }),
          targets,
          shared: suggested,
          mode: kind,
        },
      })
      .afterClosed()
      .subscribe(households => {
        if (households?.length) void this.runBulk(kind, ids, households, targets, session);
      });
  }

  /**
   * Runs the change for the rows chosen when the dialog opened. The rows it
   * went through for leave the selection; a row chosen meanwhile stays, and
   * so does a whole selection made after the mode was left and entered
   * again. A failure keeps them all, to be tried again. Focus stays in the
   * bar: the held buttons keep it (disabledInteractive), and if it was lost
   * anyway it goes to the bar's first control, the toggle. Focus the reader
   * moved elsewhere meanwhile is left where it is.
   */
  private async runBulk(
    kind: BulkShareKind,
    ids: string[],
    households: string[],
    targets: ShareTarget[],
    session: number
  ): Promise<void> {
    if (this.bulkRunning()) return;
    this.bulkRunning.set(true);
    this.bulkProgress.set(0);
    try {
      const outcome = await this.rowSharing.applyToRows(kind, ids, households, targets, fraction =>
        this.bulkProgress.set(Math.round(Math.min(1, Math.max(0, fraction)) * 100)));
      // One action for the run, however many rows: see landedKinds.
      if (outcome.landed.length > 0) this.analytics.trackHouseholdAction({ action: kind });
      if (!outcome.failed && session === this.selectSession) {
        const applied = new Set(ids);
        this.selection.update(held => held.filter(id => !applied.has(id)));
        this.cappedCount.set(0);
      }
    } finally {
      this.bulkRunning.set(false);
    }
    if (this.destroyRef.destroyed || !this.inSelectMode()) return;
    afterNextRender(() => {
      if (focusDropped()) this.selectToggle()?.nativeElement.focus();
    }, { injector: this.injector });
  }

  /**
   * The transaction a row's menu trigger and checkbox name: its
   * description, or the catalog's words for an untitled one, through the
   * one rule every control that names its transaction reads. Its note and
   * receipt buttons name it the same way, in the reader's own quotation
   * marks (quotedName). The delete and stop-sharing confirms quote it only
   * when it has a description (isUntitled); an untitled row's confirm has a
   * sentence of its own. The note and share dialogs are handed the
   * description as stored, and the receipt viewer the transaction; each
   * names it by the same rule in its own template, so the name follows a
   * language switch made while it is open. The template reads it, which is
   * why it is protected.
   */
  protected transactionName(transaction: Transaction): string {
    return transactionDisplayName(transaction.description, key => this.translationService.t(key));
  }

  /**
   * The transaction as its note and receipt buttons name it, whose keys only
   * tc quotes: its description in the reader's own quotation marks, or the
   * catalog's words for an untitled one, bare (quotedTransactionName). The
   * template reads it, which is why it is protected.
   */
  protected quotedName(transaction: Transaction): string {
    return quotedTransactionName(transaction.description, (key, params) => this.translationService.t(key, params));
  }

  /** The row's name for its checkbox: what, how much and when, as the row's own button says it. */
  rowLabel(transaction: Transaction): string {
    return this.translationService.t('transactions.rowLabel', {
      description: this.transactionName(transaction),
      amount: signedAmountText(transaction, (amount, currency) => this.formatAmount(amount, currency)),
      date: this.formatRelativeDate(transaction.date),
    });
  }

  /**
   * Asks before a row is deleted, from any of its three doors: the desktop
   * actions menu, the phone's trailing menu and the swipe drawer. Once
   * confirmed, the row is followed until it leaves the list, which the page
   * makes it do at once, so focus can be handed on then (focusAfterDelete);
   * where it stood is read as the confirm opens, in case the row goes while
   * it is open. If it comes back (its Undo, or a delete that failed), the
   * page says so (deleteUndone, deleteFailed).
   *
   * The drawer shuts as its Delete is pressed, which hides that button and
   * moves it off-canvas, so a confirm the drawer opened, cancelled or not,
   * gives focus to the row's menu button instead, where the menus' confirms
   * give it back. A selector, read as the confirm closes: the view the list
   * shows can change while it is open, and a row gone by then is passed over.
   */
  confirmDelete(transaction: Transaction, from: 'menu' | 'drawer' = 'menu'): void {
    const index = this.sortedTransactions().findIndex(row => row.id === transaction.id);
    // A split part deletes just that row — the group is never queried, so
    // the confirm can only say so because the field rides the row itself.
    // A row with a description is quoted by it; an untitled one is asked
    // about as "this untitled transaction", or a split part as "this untitled
    // part", never as the catalog's words for one in quotes, which would read
    // as its name.
    const part = !!transaction.splitGroupId;
    const message = isUntitled(transaction.description)
      ? this.translationService.t(
          part ? 'transactions.deleteUntitledSplitPartMessage' : 'transactions.deleteUntitledMessage'
        )
      : this.translationService.t(part ? 'transactions.deleteSplitPartMessage' : 'transactions.deleteConfirmMessage', {
          description: this.transactionName(transaction),
        });
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      ...(from === 'drawer' ? { restoreFocus: this.menuButtonsOf(transaction.id).join(', ') } : {}),
      data: {
        title: this.translationService.t('transactions.deleteTransaction'),
        message,
        confirmLabel: this.translationService.t('common.delete'),
        cancelLabel: this.translationService.t('common.cancel'),
        confirmColor: 'warn',
        icon: 'delete',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.deletedRow.set({ id: transaction.id, index });
      this.delete.emit(transaction);
    });
  }

  /**
   * The page's word that the delete of row `id` did not happen: the page
   * lists the row again (rowBack). If it is the one being followed it is
   * followed no more, so a later reason for it to leave, such as a filter or
   * the window trimming it as the reader scrolls, hands no focus on.
   */
  deleteFailed(id: string): void {
    this.rowBack(id);
  }

  /**
   * The page's word that row `id`'s delete was taken back by its Undo: the
   * page lists the row again (rowBack).
   */
  deleteUndone(id: string): void {
    this.rowBack(id);
  }

  /**
   * A row whose delete was confirmed is listed again: the page hid it the
   * moment the confirm closed, and it is back. It is followed no more; it is
   * scrolled to, and focus goes to its menu button if focus dropped, or was
   * left in a notice on its way out, such as the Undo notice just pressed,
   * which keeps focus while it plays its way out and then drops it. Focus the
   * reader has put anywhere else stays there, a notice still up included: a
   * failure arrives late, when the notice up is the next row's, whose Undo
   * the reader may be about to press.
   *
   * While another row's delete, confirmed since, waits to hand focus on, that
   * hand-off, the reader's latest, decides where focus goes, and the view is
   * left where it is.
   */
  private rowBack(id: string): void {
    const followed = this.deletedRow();
    if (followed && followed.id !== id) return;
    this.deletedRow.set(null);
    this.windowSource.requestScrollTo(id);
    // Material marks a notice that has started to leave with mat-exit.
    const leaving = this.host.nativeElement.ownerDocument.activeElement
      ?.closest('.mat-mdc-snack-bar-container[mat-exit]');
    focusWhenRendered(this.focus, this.menuButtonsOf(id), { onlyIfDropped: true, from: leaving ?? null });
  }

  /**
   * Hands focus on once a deleted row has left the list: to the menu button
   * of the row now in its place, else of the row before it, else to the
   * empty state's button. The confirm gives focus back to the row's menu
   * button, from the drawer too (confirmDelete), and that button leaves with
   * the row, which drops focus to the document. Only then does it move: focus
   * the reader has put anywhere else stays there.
   *
   * The menu button rather than the drawer's own Delete, which is shut by
   * then, so a swipe lands where a menu does. Both views' buttons are named,
   * since only one renders and the view the list shows can change between
   * the confirm and the refresh. There is no list heading to fall back on,
   * and the select toggle shows only for an account in a household, so
   * neither is a landing.
   */
  private focusAfterDelete(index: number, rows: readonly Transaction[]): void {
    const after = rows[index];
    const before = rows[Math.min(index, rows.length) - 1];
    focusWhenRendered(
      this.focus,
      [...this.menuButtonsOf(after?.id), ...this.menuButtonsOf(before?.id), 'app-empty-state button'],
      { onlyIfDropped: true }
    );
  }

  /** The menu button of the row with this id, in the desktop table and in the phone list. */
  private menuButtonsOf(id: string | undefined): string[] {
    if (id === undefined) return [];
    const scope = `[data-tx-id="${CSS.escape(id)}"]`;
    return [`${scope} .action-btn`, `${scope} .row-menu-btn`];
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
    // The page can land after the view is gone (navigation mid-fetch): the
    // afterNextRender registration below would throw NG0911 on the destroyed
    // injector, and there is no longer a scroll position to correct.
    if (this.destroyRef.destroyed) return added;
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
    // Same hazard as the anchored correction: a target that arrives as the
    // view tears down has nothing to scroll to, and registering on the dead
    // injector throws NG0911.
    if (this.destroyRef.destroyed) return;
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
