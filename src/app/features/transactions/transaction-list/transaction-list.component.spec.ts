import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { BreakpointObserver } from '@angular/cdk/layout';
import { FocusMonitor } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { Sort } from '@angular/material/sort';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { TransactionListComponent } from './transaction-list.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TransactionWindowService } from '../../../core/services/transaction-window.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AuthService } from '../../../core/services/auth.service';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { ReceiptViewerDialogComponent } from '../receipt-viewer/receipt-viewer-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { FirestoreService } from '../../../core/services/firestore.service';
import { LedgerShareRefusal, LedgerShareService } from '../../../core/services/ledger-share.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { PwaService } from '../../../core/services/pwa.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { ShareDialogComponent, ShareDialogData } from '../sharing/share-dialog.component';
import { MAX_BULK_SHARE, Transaction } from '../../../models';
import {
  createTransaction,
  createUser,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  runAxe,
  settleAnimations,
  summarizeViolations,
  withTheme,
} from '../../../core/services/testing';

/** An account in no household: its index, as the share controls read it, is empty. */
const NO_HOUSEHOLDS = { subscribeToCollection: () => of([]) };

// Signal-based stand-in for the page-provided window source.
function createMockWindowSource() {
  const fetchingEdge = signal<'next' | 'prev' | null>(null);
  return {
    window: signal<Transaction[]>([]),
    visibleWindow: signal<Transaction[]>([]),
    isInitialLoading: signal(false),
    fetchingEdge,
    isFetching: computed(() => fetchingEdge() !== null),
    reachedStart: signal(true),
    reachedEnd: signal(true),
    totalCount: signal<number | null>(null),
    loadError: signal<'initial' | 'prev' | 'next' | null>(null),
    scrollTarget: signal<{ id: string; seq: number } | null>(null),
    resetSeq: signal(0),
    fetchNext: jasmine.createSpy('fetchNext').and.resolveTo(0),
    fetchPrev: jasmine.createSpy('fetchPrev').and.resolveTo(0),
    retry: jasmine.createSpy('retry').and.resolveTo(undefined),
    refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
    clearScrollTarget: jasmine.createSpy('clearScrollTarget'),
  };
}

describe('TransactionListComponent', () => {
  let component: TransactionListComponent;
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let translation: jasmine.SpyObj<TranslationService>;
  let windowSource: ReturnType<typeof createMockWindowSource>;
  let quickAdd: jasmine.SpyObj<QuickAddService>;

  const txns: Transaction[] = [
    createTransaction({ amount: 30, description: 'Banana', date: Timestamp.fromDate(new Date(2026, 0, 2)) }),
    createTransaction({ amount: 10, description: 'Apple', date: Timestamp.fromDate(new Date(2026, 0, 3)) }),
    createTransaction({ amount: 20, description: 'Cherry', date: Timestamp.fromDate(new Date(2026, 0, 1)) }),
  ];

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    windowSource = createMockWindowSource();
    quickAdd = jasmine.createSpyObj('QuickAddService', ['openAddTransaction']);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: windowSource },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sortedTransactions', () => {
    it('passes the server-ordered window through for the default date sort', () => {
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('emits dateSortChange instead of sorting locally when the date header toggles', () => {
      const spy = jasmine.createSpy('dateSortChange');
      component.dateSortChange.subscribe(spy);
      component.onSortChange({ active: 'date', direction: 'asc' } as Sort);
      expect(spy).toHaveBeenCalledWith('asc');
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('sorts by amount ascending', () => {
      component.onSortChange({ active: 'amount', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.amount)).toEqual([10, 20, 30]);
    });

    it('sorts by description ascending', () => {
      component.onSortChange({ active: 'description', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('falls back to the server order when direction is cleared', () => {
      const spy = jasmine.createSpy('dateSortChange');
      component.dateSortChange.subscribe(spy);
      component.onSortChange({ active: 'amount', direction: 'asc' } as Sort);
      component.onSortChange({ active: 'amount', direction: '' } as Sort);
      expect(spy).toHaveBeenCalledWith('desc');
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });
  });

  describe('window state', () => {
    it('treats a fully loaded window as sortable client-side', () => {
      expect(component.fullyLoaded()).toBeTrue();
      windowSource.reachedEnd.set(false);
      expect(component.fullyLoaded()).toBeFalse();
    });

    it('shows the empty state only for a settled, complete, empty window', () => {
      fixture.componentRef.setInput('transactions', []);
      expect(component.showEmptyState()).toBeTrue();

      windowSource.fetchingEdge.set('next');
      expect(component.showEmptyState()).toBeFalse();
      windowSource.fetchingEdge.set(null);

      windowSource.reachedEnd.set(false);
      expect(component.showEmptyState()).toBeFalse();
      windowSource.reachedEnd.set(true);

      windowSource.loadError.set('initial');
      expect(component.showEmptyState()).toBeFalse();
    });

    it('delegates retry to the window source', () => {
      component.onRetry();
      expect(windowSource.retry).toHaveBeenCalled();
    });

    it('hides both edge spinners: the row around each already carries the aria-hidden', () => {
      windowSource.fetchingEdge.set('prev');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('.edge-row mat-spinner').getAttribute('aria-hidden')
      ).toBe('true');

      windowSource.fetchingEdge.set('next');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('.edge-row mat-spinner').getAttribute('aria-hidden')
      ).toBe('true');
    });
  });

  describe('empty state CTA', () => {
    it('renders an add-transaction action and routes it through the quick-add seam', () => {
      fixture.componentRef.setInput('transactions', []);
      fixture.detectChanges();

      const emptyState = fixture.debugElement.query(By.directive(EmptyStateComponent));
      expect(emptyState).withContext('empty state renders once the window is settled and empty').toBeTruthy();

      const instance = emptyState.componentInstance as EmptyStateComponent;
      expect(instance.actionLabel).toBe('transactions.addTransaction');
      expect(instance.actionIcon).toBe('add');

      emptyState.triggerEventHandler('action', undefined);

      expect(quickAdd.openAddTransaction).toHaveBeenCalled();
    });
  });

  it('delegates category and formatting helpers', () => {
    expect(component.getCategoryName('c')).toBe('Cat');
    expect(component.getCategoryIcon('c')).toBe('icon');
    expect(component.getCategoryColor('c')).toBe('#000');
    expect(component.formatAmount(5, 'USD')).toBe('USD 5');
    expect(component.formatDate(Timestamp.now())).toBe('date');
    expect(component.formatRelativeDate(Timestamp.now())).toBe('rel');
  });

  describe('convertedAmount', () => {
    it('shows the base-currency value for foreign-currency rows', () => {
      const foreign = createTransaction({
        amount: 3800,
        currency: 'JPY',
        amountInBaseCurrency: 25.42
      });
      expect(component.convertedAmount(foreign)).toBe('≈ USD 25.42');
    });

    it('returns null for rows already in the base currency', () => {
      const usd = createTransaction({ amount: 10, currency: 'USD' });
      expect(component.convertedAmount(usd)).toBeNull();
    });
  });

  describe('mapsUrl', () => {
    it('links a location that carries coordinates', () => {
      const txn = createTransaction({ location: { name: 'Aoyama', lat: 35.66, lng: 139.71 } });
      expect(component.mapsUrl(txn)).toBe(
        'https://www.google.com/maps/search/?api=1&query=35.66,139.71'
      );
    });

    it('renders a country-only location without a maps link', () => {
      // 0068 lets a location exist with nothing but a country. It has no
      // coordinate to point at, so it takes the plain-text branch rather
      // than sending a country code to a maps search.
      const txn = createTransaction({ location: { country: 'KR' } });
      expect(component.mapsUrl(txn)).toBeNull();
    });

    it('renders a name-only location without a maps link', () => {
      const txn = createTransaction({ location: { name: 'Aoyama Market' } });
      expect(component.mapsUrl(txn)).toBeNull();
    });
  });

  describe('confirmDelete', () => {
    it('emits delete when confirmed', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).toHaveBeenCalledWith(txns[0]);
    });

    it('does not emit when cancelled', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('names a split part in the confirm message, not the whole-purchase wording', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      const part = createTransaction({ description: 'Groceries', splitGroupId: 'group-1' });

      component.confirmDelete(part);

      expect(translation.t).toHaveBeenCalledWith(
        'transactions.deleteSplitPartMessage',
        { description: 'Groceries' }
      );
      expect(translation.t).not.toHaveBeenCalledWith(
        'transactions.deleteConfirmMessage',
        jasmine.anything()
      );
      const [, splitOptions] = dialog.open.calls.mostRecent().args as [unknown, { data: ConfirmDialogData }];
      expect(splitOptions.data.message).toBe(
        translation.t('transactions.deleteSplitPartMessage', { description: 'Groceries' })
      );
    });

    it('keeps the whole-purchase wording for a row that is not a split part', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

      component.confirmDelete(txns[0]);

      expect(translation.t).toHaveBeenCalledWith(
        'transactions.deleteConfirmMessage',
        { description: txns[0].description }
      );
      expect(translation.t).not.toHaveBeenCalledWith(
        'transactions.deleteSplitPartMessage',
        jasmine.anything()
      );
      const [, plainOptions] = dialog.open.calls.mostRecent().args as [unknown, { data: ConfirmDialogData }];
      expect(plainOptions.data.message).toBe(
        translation.t('transactions.deleteConfirmMessage', { description: txns[0].description })
      );
    });
  });

  /**
   * Both scroll corrections register an afterNextRender AFTER an await or an
   * effect hop, so the component can be gone by the time they run. A
   * registration on a destroyed injector throws NG0911 (registrations made
   * while the view is alive are safe — Angular cancels those with it), which
   * surfaced as intermittent teardown noise in the suite.
   */
  describe('post-destroy render guards', () => {
    interface Internals {
      maybeFetch(): Promise<void>;
      scrollToTarget(id: string): void;
      isNearEdge(edge: 'top' | 'bottom'): boolean;
    }
    const internals = (c: TransactionListComponent) => c as unknown as Internals;

    it('lands a page fetch quietly when the view was destroyed mid-flight', async () => {
      windowSource.reachedEnd.set(false);

      // The anchor is measured before the fetch, so the correction path is
      // only entered when a row was measurable at that moment.
      const rows = fixture.nativeElement.querySelectorAll('[data-tx-id]');
      expect(rows.length).withContext('rows carry the anchor attribute').toBeGreaterThan(0);
      expect(rows[0].getBoundingClientRect().bottom)
        .withContext('the anchor row is measurable, so runAnchored keeps an anchorId')
        .toBeGreaterThan(0);

      // The real edge check reads sentinel geometry, which shifts with the
      // runner's viewport and fonts — near on one machine, out of margin on
      // another. The guard under test sits past that check, so the check is
      // pinned: the bottom edge stays "near" and the loop ends on its own
      // added === 0 break below.
      spyOn(internals(component), 'isNearEdge').and.callFake(
        (edge: 'top' | 'bottom') => edge === 'bottom'
      );

      let landFetch!: (added: number) => void;
      windowSource.fetchNext.and.returnValues(
        new Promise<number>((resolve) => { landFetch = resolve; }),
        // Consumed by the loop's post-destroy iteration: the pinned edge
        // check keeps it asking, the empty page ends it.
        Promise.resolve(0)
      );

      const pending = internals(component).maybeFetch();
      expect(windowSource.fetchNext)
        .withContext('the near-edge check started a page fetch')
        .toHaveBeenCalled();

      // The user navigates away while the page is still in flight.
      fixture.destroy();
      landFetch(1);

      await expectAsync(pending)
        .withContext('the late fetch must not throw NG0911 out of its own promise chain')
        .toBeResolved();
    });

    it('skips the scroll-into-view correction once the view is destroyed', () => {
      fixture.destroy();

      expect(() => internals(component).scrollToTarget(txns[0].id))
        .withContext('registering after destroy would throw NG0911')
        .not.toThrow();
    });

    // The correction is an afterNextRender hook, and render hooks run on an
    // application tick. Under zone change detection fixture.detectChanges()
    // checks the view without one; the tick that zone stability would bring
    // lands after a synchronous assertion whenever a microtask is still
    // pending, as it is on CI. TestBed.tick() runs it here.
    it('still runs the scroll-into-view correction while the view is alive', () => {
      internals(component).scrollToTarget(txns[0].id);
      TestBed.tick();

      expect(windowSource.clearScrollTarget)
        .withContext('the guard must not short-circuit the live path')
        .toHaveBeenCalled();
    });

    it('clears the scroll target when the row has not rendered yet', () => {
      // The `if (el)` false arm: the target is a real id the window has not
      // paged in, so there is nothing to scroll to and nothing to highlight —
      // but the target still has to be cleared, or every later page keeps
      // trying to reach a row that will never arrive.
      internals(component).scrollToTarget('not-in-the-dom');
      TestBed.tick();

      expect(fixture.nativeElement.querySelector('[data-tx-id="not-in-the-dom"]'))
        .withContext('the premise: that row really is not rendered')
        .toBeNull();
      expect(windowSource.clearScrollTarget).toHaveBeenCalled();
      expect(component.highlightedId())
        .withContext('nothing was scrolled to, so nothing may be highlighted')
        .toBeNull();
    });
  });
});

/**
 * The mobile branch renders only below the table breakpoint, so this suite
 * pins the BreakpointObserver to "not desktop" and asserts the template
 * wiring between the list and its rows — the part the logic suite above
 * cannot see.
 */
describe('TransactionListComponent mobile row wiring', () => {
  let component: TransactionListComponent;
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let translation: jasmine.SpyObj<TranslationService>;

  const txns: Transaction[] = [
    createTransaction({
      id: 'a',
      amount: 30,
      description: 'Banana',
      note: 'Ripe by Friday\nfrom the corner stall',
      receiptUrl: 'https://storage.example.com/r.jpg',
    }),
    createTransaction({ id: 'b', amount: 10, description: 'Apple' }),
  ];

  /** Menu content is only instantiated once the overlay is open. */
  function menuItems(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]')
    );
  }

  function menuLabels(): string[] {
    return menuItems().map(item => item.textContent!.trim());
  }

  function openRowMenu(index: number): void {
    const triggers: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.row-menu-btn')
    );
    triggers[index].click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('opts every row into swipe actions', () => {
    const rows = fixture.debugElement.queryAll(By.directive(TransactionRowComponent));
    expect(rows.length).withContext('mobile rows rendered').toBe(2);
    for (const row of rows) {
      expect((row.componentInstance as TransactionRowComponent).swipeActions()).toBeTrue();
    }
  });

  it('routes a row delete through the confirm dialog, never around it', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    const deleteSpy = jasmine.createSpy('delete');
    component.delete.subscribe(deleteSpy);

    const row = fixture.debugElement.queryAll(By.directive(TransactionRowComponent))[0];
    row.triggerEventHandler('delete', txns[0]);

    expect(dialog.open).withContext('swipe delete still asks first').toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith(txns[0]);
  });

  // No positive tabindex anywhere in a row, so Tab follows document order;
  // a synthetic Tab key moves nothing, so the order is read off the DOM.
  // .row-actions is the surface's first child because the reserve rules
  // select forward from it with ~, which puts the menu ahead of the row.
  it("puts a row's menu and then the row itself in the tab order, and nothing else", () => {
    const row = fixture.nativeElement.querySelector('app-transaction-row') as HTMLElement;
    const stops = Array.from(
      row.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')
    ).filter(element => element.tabIndex >= 0 && !(element as HTMLButtonElement).disabled);

    expect(stops.map(element => element.className))
      .withContext('menu, then row')
      .toEqual([
        jasmine.stringContaining('row-menu-btn'),
        jasmine.stringContaining('row-activate'),
      ]);
  });

  it('names each row menu after the row it belongs to', () => {
    // The menu sits beside the row button, not inside a named row, so "More
    // actions" alone would leave a list of identical buttons.
    const menus: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.row-menu-btn'));
    expect(menus.map(menu => menu.getAttribute('aria-label')))
      .toEqual(['common.moreActionsFor', 'common.moreActionsFor']);
    expect(translation.t).toHaveBeenCalledWith('common.moreActionsFor', { description: 'Banana' });
    expect(translation.t).toHaveBeenCalledWith('common.moreActionsFor', { description: 'Apple' });
  });

  it('re-emits a row edit', () => {
    const editSpy = jasmine.createSpy('edit');
    component.edit.subscribe(editSpy);

    const row = fixture.debugElement.queryAll(By.directive(TransactionRowComponent))[0];
    row.triggerEventHandler('edit', txns[0]);

    expect(editSpy).toHaveBeenCalledWith(txns[0]);
  });

  // The tooltip the desktop table hangs the note on has no touch equivalent,
  // so on a phone the trailing menu is the only way to the note at all.
  it('offers the note in the trailing menu of a row that has one', () => {
    openRowMenu(0);

    expect(menuLabels().some(label => label.includes('transactions.viewNote')))
      .withContext('the phone route to the note')
      .toBeTrue();
  });

  it('leaves the note entry out of a row with nothing to read', () => {
    openRowMenu(1);

    expect(menuLabels().some(label => label.includes('transactions.viewNote'))).toBeFalse();
  });

  it('opens the note dialog from the trailing menu', () => {
    openRowMenu(0);
    menuItems().find(item => item.textContent!.includes('transactions.viewNote'))!.click();

    expect(dialog.open).toHaveBeenCalledWith(
      NoteDialogComponent,
      jasmine.objectContaining({
        data: { note: 'Ripe by Friday\nfrom the corner stall', description: 'Banana' },
      })
    );
  });

  // The desktop table's icon door has no touch equivalent either, so the
  // trailing menu is the receipt's only route on a phone too.
  it('offers the receipt in the trailing menu of a row that has one', () => {
    openRowMenu(0);

    expect(menuLabels().some(label => label.includes('transactions.viewReceipt')))
      .withContext('the phone route to the receipt')
      .toBeTrue();
  });

  it('leaves the receipt entry out of a row with nothing to view', () => {
    openRowMenu(1);

    expect(menuLabels().some(label => label.includes('transactions.viewReceipt'))).toBeFalse();
  });

  it('opens the receipt viewer from the trailing menu', () => {
    openRowMenu(0);
    menuItems().find(item => item.textContent!.includes('transactions.viewReceipt'))!.click();

    expect(dialog.open).toHaveBeenCalledWith(
      ReceiptViewerDialogComponent,
      jasmine.objectContaining({ data: jasmine.objectContaining({ transaction: txns[0] }) })
    );
  });
});

/**
 * The desktop table renders only above the breakpoint, and Karma's context
 * iframe sits just under it, so this suite pins the observer to "desktop" the
 * way the mobile suite above pins it the other way. What it covers is the
 * note's two desktop doors — the icon in the description cell and the actions
 * menu — and the one thing both must not do: open the editor instead.
 */
describe('TransactionListComponent desktop note doors', () => {
  let component: TransactionListComponent;
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;

  const withNote = createTransaction({
    id: 'a',
    amount: 30,
    description: 'Banana',
    note: 'Ripe by Friday\nfrom the corner stall',
    receiptUrl: 'https://storage.example.com/r.jpg',
  });
  const withoutNote = createTransaction({ id: 'b', amount: 10, description: 'Apple' });
  const txns: Transaction[] = [withNote, withoutNote];

  function noteButton(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.note-button');
  }

  function menuItems(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]')
    );
  }

  function openActionsMenu(index: number): void {
    const triggers: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.action-btn')
    );
    triggers[index].click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('makes the note a control a keyboard can reach, named for what it does', () => {
    const button = noteButton();

    expect(button).withContext('the note icon was a decoration nothing could open').not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    // Its visible content is one glyph, so the name has to come from the label.
    expect(button!.getAttribute('aria-label')).toBe('transactions.viewNote');
  });

  it('shows no note control on a row that has no note', () => {
    expect(fixture.nativeElement.querySelectorAll('.note-button').length).toBe(1);
  });

  it('opens the note dialog with the note and the row it belongs to', () => {
    noteButton()!.click();

    expect(dialog.open).toHaveBeenCalledWith(
      NoteDialogComponent,
      jasmine.objectContaining({
        width: '480px',
        maxWidth: '95vw',
        data: { note: 'Ripe by Friday\nfrom the corner stall', description: 'Banana' },
      })
    );
  });

  it('does not open the editor behind the note dialog', () => {
    const editSpy = jasmine.createSpy('edit');
    component.edit.subscribe(editSpy);

    // The button sits inside the row's own click target, so without
    // stopPropagation the editor opens under the dialog every time.
    noteButton()!.click();

    expect(editSpy).not.toHaveBeenCalled();
  });

  it('still opens the editor when the row itself is clicked', () => {
    const editSpy = jasmine.createSpy('edit');
    component.edit.subscribe(editSpy);

    (fixture.nativeElement.querySelector('tr.table-row') as HTMLElement).click();

    expect(editSpy).toHaveBeenCalledWith(withNote);
  });

  it('offers the note in the actions menu of a row that has one', () => {
    openActionsMenu(0);

    const item = menuItems().find(el => el.textContent!.includes('transactions.viewNote'));
    expect(item).withContext('the menu route to the note').toBeDefined();

    item!.click();

    expect(dialog.open).toHaveBeenCalledWith(NoteDialogComponent, jasmine.any(Object));
  });

  it('leaves the note entry out of a row with nothing to read', () => {
    openActionsMenu(1);

    expect(menuItems().some(el => el.textContent!.includes('transactions.viewNote'))).toBeFalse();
  });

  it('offers the receipt in the actions menu of a row that has one', () => {
    openActionsMenu(0);

    const item = menuItems().find(el => el.textContent!.includes('transactions.viewReceipt'));
    expect(item).withContext('the menu route to the receipt').toBeDefined();

    item!.click();

    expect(dialog.open).toHaveBeenCalledWith(ReceiptViewerDialogComponent, jasmine.any(Object));
  });

  it('leaves the receipt entry out of a row with nothing to view', () => {
    openActionsMenu(1);

    expect(menuItems().some(el => el.textContent!.includes('transactions.viewReceipt'))).toBeFalse();
  });
});

/**
 * The description cell's receipt icon — the desktop table's only route to a
 * stored photo, and the one door proved against the real template rather
 * than at method level (the form and manager specs blank theirs).
 */
describe('TransactionListComponent desktop receipt doors', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;

  const withReceipt = createTransaction({
    id: 'a',
    amount: 30,
    description: 'Banana',
    receiptUrl: 'https://storage.example.com/r0.jpg',
  });
  const withMultipleReceipts = createTransaction({
    id: 'b',
    amount: 20,
    description: 'Cherry',
    receiptUrl: 'https://storage.example.com/r1.jpg',
    receiptUrls: ['https://storage.example.com/r1.jpg', 'https://storage.example.com/r2.jpg'],
    receiptCount: 2,
  });
  const withoutReceipt = createTransaction({ id: 'c', amount: 10, description: 'Apple' });
  const txns: Transaction[] = [withReceipt, withMultipleReceipts, withoutReceipt];

  function receiptButtons(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.receipt-icon-button'));
  }

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('renders a real button for a row with a receipt, never a link', () => {
    const buttons = receiptButtons();
    expect(buttons.length).withContext('one button per row that has a receipt').toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-label')).toBe('transactions.viewReceipt');
    }
    expect(fixture.nativeElement.querySelector('a.receipt-icon-link')).toBeNull();
    expect(fixture.nativeElement.querySelector('.receipt-icon-button[target]')).toBeNull();
  });

  it('shows no receipt control on a row with nothing stored', () => {
    // Two of the three rows carry a receipt; a count past that would mean
    // the row with nothing stored grew a button of its own.
    expect(receiptButtons().length).toBe(2);
  });

  it('still renders the image count badge past one image', () => {
    const badges = fixture.nativeElement.querySelectorAll('.receipt-count-badge');
    expect(badges.length).withContext('only the multi-image row gets a badge').toBe(1);
    expect((badges[0] as HTMLElement).textContent!.trim()).toBe('2');
  });

  it('opens the receipt viewer with the row it belongs to', () => {
    receiptButtons()[0].click();

    expect(dialog.open).toHaveBeenCalledWith(
      ReceiptViewerDialogComponent,
      jasmine.objectContaining({ data: jasmine.objectContaining({ transaction: withReceipt }) })
    );
  });

  it('does not open the editor behind the receipt viewer', () => {
    const component = fixture.componentInstance;
    const editSpy = jasmine.createSpy('edit');
    component.edit.subscribe(editSpy);

    // Same hazard as the note button: it sits inside the row's own click
    // target, so without stopPropagation the editor opens under the viewer.
    receiptButtons()[0].click();

    expect(editSpy).not.toHaveBeenCalled();
  });
});

/**
 * The category cell — the desktop table's stand-in for the mobile row's
 * description badge — since no query backs the group, the badge is driven
 * purely by the field the row already carries.
 */
describe('TransactionListComponent desktop category cell', () => {
  let fixture: ComponentFixture<TransactionListComponent>;

  const part = createTransaction({ id: 'a', amount: 30, description: 'Banana', splitGroupId: 'group-1' });
  const whole = createTransaction({ id: 'b', amount: 10, description: 'Apple' });
  const txns: Transaction[] = [part, whole];

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('marks a split part in the category cell, and leaves a whole purchase unmarked', () => {
    const cells: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.category-cell'));
    expect(cells.length).toBe(2);

    const indicator = cells[0].querySelector('.split-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator!.getAttribute('role')).toBe('img');
    expect(indicator!.getAttribute('aria-label')).toBe('transactions.splitPart');
    // MatIcon hides itself from assistive technology unless the template
    // says otherwise; without a literal override the label above is never read.
    expect(indicator!.getAttribute('aria-hidden')).toBe('false');

    expect(cells[1].querySelector('.split-indicator')).toBeNull();
  });
});

/**
 * The three inline controls a table cell can carry are all glyph-sized (32,
 * 32, 18), too small on their own for the 40px floor. Each carries a
 * clamped `::after` overhang instead of fattening the glyph box itself — the
 * same idiom as transaction-preview-table.overflow.spec.ts, reconstructed
 * the same way, since a pseudo-element has no rect of its own to measure.
 * The fixture is attached to the document so the pseudo box has geometry;
 * detached elements never get layout.
 */
describe('TransactionListComponent desktop hit boxes', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let host: HTMLElement;

  const withNote = createTransaction({
    id: 'a',
    amount: 30,
    description: 'Banana',
    note: 'Ripe by Friday',
    receiptUrl: 'https://storage.example.com/r.jpg',
  });
  const withoutNote = createTransaction({ id: 'b', amount: 10, description: 'Apple' });
  const txns: Transaction[] = [withNote, withoutNote];

  function hitBox(el: HTMLElement): { width: number; height: number } {
    const rect = el.getBoundingClientRect();
    const after = getComputedStyle(el, '::after');
    return {
      width: rect.width
        - parseFloat(after.getPropertyValue('inset-inline-start'))
        - parseFloat(after.getPropertyValue('inset-inline-end')),
      height: rect.height - parseFloat(after.top) - parseFloat(after.bottom),
    };
  }

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('reaches 40px on the note button through the overhang while the glyph box stays 32', () => {
    const button = host.querySelector('.note-button') as HTMLElement;
    const box = button.getBoundingClientRect();
    expect(box.width).withContext('note button glyph box width unchanged').toBeCloseTo(32, 0);
    expect(box.height).withContext('note button glyph box height unchanged').toBeCloseTo(32, 0);

    const hit = hitBox(button);
    expect(hit.width).withContext('note button hit area width').toBeGreaterThanOrEqual(40);
    expect(hit.height).withContext('note button hit area height').toBeGreaterThanOrEqual(40);
  });

  it('reaches 40px on the receipt icon through the overhang while the visible box stays 32', () => {
    const button = host.querySelector('.receipt-icon-button') as HTMLElement;
    const box = button.getBoundingClientRect();
    expect(box.width).withContext('receipt icon visible box width unchanged').toBeCloseTo(32, 0);
    expect(box.height).withContext('receipt icon visible box height unchanged').toBeCloseTo(32, 0);

    const hit = hitBox(button);
    expect(hit.width).withContext('receipt icon hit area width').toBeGreaterThanOrEqual(40);
    expect(hit.height).withContext('receipt icon hit area height').toBeGreaterThanOrEqual(40);
  });

  it("keeps the receipt icon's overhang out of the note button's visible box", () => {
    const note = host.querySelector('.note-button') as HTMLElement;
    const receipt = host.querySelector('.receipt-icon-button') as HTMLElement;
    const noteRect = note.getBoundingClientRect();
    const receiptRect = receipt.getBoundingClientRect();
    const receiptAfter = getComputedStyle(receipt, '::after');
    const receiptHitLeft = receiptRect.left + parseFloat(receiptAfter.getPropertyValue('inset-inline-start'));

    expect(receiptHitLeft)
      .withContext("receipt hit box must not reach left of the note button's visible right edge")
      .toBeGreaterThanOrEqual(noteRect.right);
  });

  it('reaches 40px on the row actions trigger through the overhang while the glyph box stays 32', () => {
    const button = host.querySelectorAll('.action-btn')[0] as HTMLElement;
    const box = button.getBoundingClientRect();
    expect(box.width).withContext('action button glyph box width unchanged').toBeCloseTo(32, 0);
    expect(box.height).withContext('action button glyph box height unchanged').toBeCloseTo(32, 0);

    const hit = hitBox(button);
    expect(hit.width).withContext('action button hit area width').toBeGreaterThanOrEqual(40);
    expect(hit.height).withContext('action button hit area height').toBeGreaterThanOrEqual(40);
  });
});

/**
 * 704px is the floor .desktop-table's own comment derives: 720 (the content
 * width at the 768px breakpoint) less up to 16px a classic scrollbar takes
 * from .main-container. Below that floor the table would need its own
 * horizontal scrollbar just to clear a scrollbar one level up.
 */
describe('TransactionListComponent desktop table width floor', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let host: HTMLElement;

  const txns: Transaction[] = [createTransaction({ id: 'a', amount: 10, description: 'Apple' })];

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    // Real header text, not the raw keys the other suites in this file get
    // away with: table-layout is auto, so an unrealistically long header
    // string (the key itself) stretches a column past what real English
    // ever asks of it, and the floor this measures would come out wrong.
    const HEADER_LABELS: Record<string, string> = {
      'transactions.date': 'Date',
      'transactions.category': 'Category',
      'transactions.description': 'Description',
      'transactions.amount': 'Amount',
      'common.moreActions': 'More actions',
    };
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => HEADER_LABELS[k] ?? k);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: createMockWindowSource() },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true, breakpoints: {} }) } },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = '704px';
    document.body.appendChild(host);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('fits the desktop table at its floor width without a sideways scrollbar', () => {
    const scroll = host.querySelector('.table-scroll') as HTMLElement;
    expect(scroll.scrollWidth)
      .withContext('table-scroll scrollWidth vs clientWidth at the 704px floor')
      .toBeLessThanOrEqual(scroll.clientWidth + 1);
  });
});

/**
 * The row menu's door to sharing, on both views. The memberships come from
 * the account's own index (FirestoreService stands in for it); the shares
 * change through the sharing code, reached lazily, which LedgerShareService
 * stands in for.
 */
describe('TransactionListComponent sharing', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let index: Record<string, unknown>[];
  let ledger: jasmine.SpyObj<Pick<LedgerShareService, 'share' | 'unshare'>>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let windowSource: ReturnType<typeof createMockWindowSource>;
  let desktop: boolean;
  let online: ReturnType<typeof signal<boolean>>;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  const joined = Timestamp.fromMillis(1_000);
  const HOME = { id: 'h1', name: 'Home', role: 'owner', since: joined, joinedAt: joined };
  const OFFICE = { id: 'h2', name: 'Office', role: 'member', since: joined, joinedAt: Timestamp.fromMillis(2_000) };

  const txns: Transaction[] = [
    createTransaction({ id: 'a', amount: 30, description: 'Banana', sharedWith: ['households/h1'] }),
    createTransaction({ id: 'b', amount: 10, description: 'Apple' }),
    // Its only key is for a household the account has left: nothing to stop.
    createTransaction({ id: 'c', amount: 20, description: 'Cherry', sharedWith: ['households/h9'] }),
    createTransaction({
      id: 'd', amount: 40, description: 'Dates', sharedWith: ['households/h2', 'households/h9', 'households/h1'],
    }),
  ];

  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
  }

  function shareItem(): HTMLElement | undefined {
    return menuItems().find(item => item.textContent!.includes('transactions.share.menu'));
  }

  function stopItem(): HTMLElement | undefined {
    return menuItems().find(item => item.textContent!.includes('transactions.share.stop'));
  }

  /** The confirm Stop sharing opened, as the dialog was asked for it. */
  function stopConfirm(): ConfirmDialogData {
    const call = dialog.open.calls.all().find(each => each.args[0] === ConfirmDialogComponent);
    expect(call).withContext('the confirm opened').toBeDefined();
    return (call!.args[1] as { data: ConfirmDialogData }).data;
  }

  function openRowMenu(index: number): void {
    const triggers: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll(desktop ? '.action-btn' : '.row-menu-btn')
    );
    triggers[index].click();
    fixture.detectChanges();
  }

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: windowSource },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: desktop, breakpoints: {} }) } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (a: number, c: string) => `${c} ${a}`, amountInBase: (t: { amount: number }) => t.amount },
        },
        { provide: AuthService, useValue: { currentUser: signal(createUser({ id: 'u1' })) } },
        { provide: DateFormatService, useValue: { formatDate: () => 'date', formatRelativeDate: () => 'rel' } },
        {
          provide: CategoryHelperService,
          useValue: { getCategoryName: () => 'Cat', getCategoryIcon: () => 'icon', getCategoryColor: () => '#000' },
        },
        {
          provide: TranslationService,
          useValue: { t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) },
        },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: { subscribeToCollection: () => of(index) } },
        { provide: LedgerShareService, useValue: ledger },
        { provide: NotificationService, useValue: notifications },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  }

  /** Lets the lazily loaded sharing code resolve and its calls settle. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve));
    fixture.detectChanges();
  }

  beforeEach(() => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    index = [HOME, OFFICE];
    ledger = jasmine.createSpyObj('LedgerShareService', ['share', 'unshare']);
    ledger.share.and.resolveTo(undefined);
    ledger.unshare.and.resolveTo(undefined);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    windowSource = createMockWindowSource();
    desktop = false;
    online = signal(true);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
  });

  describe('on a phone', () => {
    it('offers no Share entry while the account belongs to no household', async () => {
      index = [];
      await render();

      openRowMenu(0);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(shareItem()).toBeUndefined();
    });

    it("hands each row the names of the account's live households", async () => {
      await render();

      const rows = fixture.debugElement.queryAll(By.directive(TransactionRowComponent));
      const names = (rows[0].componentInstance as TransactionRowComponent).householdNames();
      expect([...names]).toEqual([['h1', 'Home'], ['h2', 'Office']]);
    });

    it('opens the share dialog pre-set from the row', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
      await render();

      openRowMenu(0);
      shareItem()!.click();

      expect(dialog.open).toHaveBeenCalledWith(
        ShareDialogComponent,
        jasmine.objectContaining({
          data: {
            description: 'Banana',
            targets: [{ householdId: 'h1', name: 'Home' }, { householdId: 'h2', name: 'Office' }],
            shared: ['h1'],
          },
        })
      );
    });

    it('turns the choice into exactly the shares and unshares it differs by', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(['h2']) } as never);
      await render();

      openRowMenu(0);
      shareItem()!.click();
      await settle();

      expect(ledger.share).toHaveBeenCalledOnceWith(['a'], 'h2');
      expect(ledger.unshare).toHaveBeenCalledOnceWith(['a'], 'h1');
      // The window reads the row again, so its chip shows the new shares.
      expect(windowSource.refresh).toHaveBeenCalled();
    });

    it('changes nothing when the dialog is dismissed', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
      await render();

      openRowMenu(0);
      shareItem()!.click();
      await settle();

      expect(ledger.share).not.toHaveBeenCalled();
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(windowSource.refresh).not.toHaveBeenCalled();
    });

    it('says which household refused a share when the membership has ended', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('notMember', 'not a member'));
      dialog.open.and.returnValue({ afterClosed: () => of(['h2']) } as never);
      await render();

      openRowMenu(1);
      shareItem()!.click();
      await settle();

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.share.notMember:{"name":"Office"}');
    });

    it('offers Stop sharing on a row shared with a live household', async () => {
      await render();

      openRowMenu(0);

      expect(stopItem()).toBeDefined();
    });

    it('offers no Stop sharing on a private row', async () => {
      await render();

      openRowMenu(1);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(stopItem()).toBeUndefined();
    });

    it('offers no Stop sharing on a row whose only key is for a household the account has left', async () => {
      await render();

      openRowMenu(2);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(stopItem()).toBeUndefined();
    });

    it('stops sharing with every live household the row names, once confirmed', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      await render();

      openRowMenu(3);
      stopItem()!.click();
      await settle();

      const data = stopConfirm();
      expect(data.title).toContain('transactions.share.stopTitle');
      expect(data.title).toContain('Office');
      expect(data.title).toContain('Home');
      expect(data.message).toBe('transactions.share.stopMessage:{"description":"Dates"}');
      expect(data.confirmLabel).toBe('transactions.share.stop');
      expect(data.icon).toBe('group_remove');
      expect(ledger.unshare).toHaveBeenCalledTimes(2);
      expect(ledger.unshare).toHaveBeenCalledWith(['d'], 'h1');
      expect(ledger.unshare).toHaveBeenCalledWith(['d'], 'h2');
      expect(ledger.share).not.toHaveBeenCalled();
      // The window reads the row again, so its chip goes.
      expect(windowSource.refresh).toHaveBeenCalled();
    });

    it('stops nothing when the confirm is dismissed', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      await render();

      openRowMenu(0);
      stopItem()!.click();
      await settle();

      expect(dialog.open).toHaveBeenCalled();
      expect(ledger.unshare).not.toHaveBeenCalled();
    });

    it('says, offline, that the household keeps seeing the row until the device reconnects', async () => {
      online.set(false);
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      await render();

      openRowMenu(0);
      stopItem()!.click();
      await settle();

      expect(stopConfirm().message).toBe('transactions.share.stopMessageOffline:{"description":"Banana"}');
      expect(ledger.unshare).toHaveBeenCalledOnceWith(['a'], 'h1');
    });

    /**
     * One event per kind the menu's change went through for, however many
     * households it touched: a household id or a count would say more
     * than the action.
     */
    describe('household_action', () => {
      it('reports one share and one unshare for a row moved between households', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(['h2']) } as never);
        await render();

        openRowMenu(0);
        shareItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction.calls.allArgs()).toEqual([[{ action: 'share' }], [{ action: 'unshare' }]]);
      });

      it('reports nothing when the share dialog is dismissed', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
        await render();

        openRowMenu(0);
        shareItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports nothing when the only share is refused', async () => {
        ledger.share.and.rejectWith(new LedgerShareRefusal('notMember', 'not a member'));
        dialog.open.and.returnValue({ afterClosed: () => of(['h2']) } as never);
        await render();

        openRowMenu(1);
        shareItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports one unshare for Stop sharing with two households, once confirmed', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        await render();

        openRowMenu(3);
        stopItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'unshare' });
      });

      it('reports nothing when Stop sharing is not confirmed', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
        await render();

        openRowMenu(0);
        stopItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports nothing when Stop sharing fails', async () => {
        ledger.unshare.and.rejectWith(new Error('unavailable'));
        spyOn(console, 'warn');
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        await render();

        openRowMenu(0);
        stopItem()!.click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });
    });
  });

  describe('on a desktop', () => {
    beforeEach(() => {
      desktop = true;
    });

    it('offers Stop sharing in the actions menu of a shared row, and stops sharing once confirmed', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      await render();

      openRowMenu(0);
      stopItem()!.click();
      await settle();

      expect(stopConfirm().message).toBe('transactions.share.stopMessage:{"description":"Banana"}');
      expect(ledger.unshare).toHaveBeenCalledOnceWith(['a'], 'h1');
    });

    it('offers no Stop sharing on a private row', async () => {
      await render();

      openRowMenu(1);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(stopItem()).toBeUndefined();
    });

    it('offers no Stop sharing on a row whose only key is for a household the account has left', async () => {
      await render();

      openRowMenu(2);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(stopItem()).toBeUndefined();
    });

    it('offers Share with… in the actions menu', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(['h1', 'h2']) } as never);
      await render();

      openRowMenu(1);
      shareItem()!.click();
      await settle();

      expect(ledger.share).toHaveBeenCalledWith(['b'], 'h1');
      expect(ledger.share).toHaveBeenCalledWith(['b'], 'h2');
      expect(ledger.unshare).not.toHaveBeenCalled();
    });

    it('offers no Share entry while the account belongs to no household', async () => {
      index = [];
      await render();

      openRowMenu(0);

      expect(menuItems().length).withContext('the menu opened').toBeGreaterThan(0);
      expect(shareItem()).toBeUndefined();
    });

    it('marks a shared row in its description cell, named for its households', async () => {
      await render();

      const cells: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('td.col-description'));
      const shared = cells[0].querySelector('.shared-chip');
      expect(shared?.querySelector('.shared-chip-text')?.textContent?.trim()).toBe('transactions.share.chip:{"name":"Home"}');
      expect(shared?.getAttribute('role')).toBe('img');
      expect(shared?.getAttribute('aria-label')).toContain('transactions.share.chipLabel');
      expect(cells[1].querySelector('.shared-chip')).withContext('a private row').toBeNull();
    });
  });
});

/**
 * The select mode: many rows chosen at once, then shared into or taken out
 * of the account's households together. The memberships come from the
 * account's own index (FirestoreService stands in for it); the shares change
 * through the sharing code, reached lazily, which LedgerShareService stands
 * in for.
 */
describe('TransactionListComponent select mode', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let host: HTMLElement;
  let dialog: jasmine.SpyObj<MatDialog>;
  let index: Record<string, unknown>[];
  let ledger: jasmine.SpyObj<Pick<LedgerShareService, 'share' | 'unshare'>>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let windowSource: ReturnType<typeof createMockWindowSource>;
  let desktop: boolean;
  let online: ReturnType<typeof signal<boolean>>;
  let rows: Transaction[];
  let edited: jasmine.Spy;
  let labels: Record<string, string>;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  const joined = Timestamp.fromMillis(1_000);
  const HOME = { id: 'h1', name: 'Home', role: 'owner', since: joined, joinedAt: joined };
  const OFFICE = { id: 'h2', name: 'Office', role: 'member', since: joined, joinedAt: Timestamp.fromMillis(2_000) };

  const toggle = () => host.querySelector<HTMLButtonElement>('button.select-toggle');
  /** The toggle's words, without its icon's ligature. */
  const toggleText = () => toggle()?.querySelector('.mdc-button__label')?.textContent?.trim();
  const bar = () => host.querySelector<HTMLElement>('.select-bar');
  const count = () => host.querySelector('.select-count')?.textContent?.trim();
  const barButton = (name: string) => host.querySelector<HTMLButtonElement>(`.select-bar button.${name}`)!;
  const progress = () => host.querySelector<HTMLElement>('.select-bar mat-progress-bar');
  const capped = () => host.querySelector('.select-capped')?.textContent?.trim();
  const rowOf = (id: string) => host.querySelector<HTMLElement>(`[data-tx-id="${id}"]`)!;
  const boxOf = (id: string) => rowOf(id).querySelector<HTMLInputElement>('.row-select input[type="checkbox"]')!;
  const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('.row-select input[type="checkbox"]'));

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: windowSource },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: desktop, breakpoints: {} }) } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (a: number, c: string) => `${c} ${a}`, amountInBase: (t: { amount: number }) => t.amount },
        },
        { provide: AuthService, useValue: { currentUser: signal(createUser({ id: 'u1' })) } },
        { provide: DateFormatService, useValue: { formatDate: () => 'date', formatRelativeDate: () => 'rel' } },
        {
          provide: CategoryHelperService,
          useValue: { getCategoryName: () => 'Cat', getCategoryIcon: () => 'icon', getCategoryColor: () => '#000' },
        },
        {
          provide: TranslationService,
          useValue: {
            t: (k: string, p?: Record<string, unknown>) => labels[k] ?? (p ? `${k}:${JSON.stringify(p)}` : k),
          },
        },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: { subscribeToCollection: () => of(index) } },
        { provide: LedgerShareService, useValue: ledger },
        { provide: NotificationService, useValue: notifications },
        { provide: AnnouncerService, useValue: announcer },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.componentInstance.edit.subscribe(edited);
    fixture.componentRef.setInput('transactions', rows);
    fixture.detectChanges();
  }

  /**
   * Lets the lazily loaded sharing code resolve and its calls settle. The
   * first test to load it waits on the module's fetch, which no zone tracks,
   * so this waits in real time rather than a count of turns.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges();
  }

  function enter(): void {
    toggle()!.focus();
    toggle()!.click();
    fixture.detectChanges();
  }

  function pick(...ids: string[]): void {
    for (const id of ids) boxOf(id).click();
    fixture.detectChanges();
  }

  /** The dialog the bulk bar opened, as it was asked for it. */
  function dialogData(): ShareDialogData {
    const call = dialog.open.calls.all().find(each => each.args[0] === ShareDialogComponent);
    expect(call).withContext('the share dialog opened').toBeDefined();
    return (call!.args[1] as { data: ShareDialogData }).data;
  }

  const closesWith = (chosen: string[] | undefined) =>
    dialog.open.and.returnValue({ afterClosed: () => of(chosen) } as never);

  beforeEach(() => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    index = [HOME, OFFICE];
    ledger = jasmine.createSpyObj('LedgerShareService', ['share', 'unshare']);
    ledger.share.and.resolveTo(undefined);
    ledger.unshare.and.resolveTo(undefined);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    windowSource = createMockWindowSource();
    desktop = false;
    online = signal(true);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
    edited = jasmine.createSpy('edit');
    labels = { 'transactions.share.separator': ', ' };
    rows = [
      createTransaction({ id: 'a', amount: 30, description: 'Banana', sharedWith: ['households/h1'] }),
      createTransaction({ id: 'b', amount: 10, description: 'Apple' }),
      // Its other key is for a household the account has left.
      createTransaction({ id: 'c', amount: 20, description: 'Cherry', sharedWith: ['households/h2', 'households/h9'] }),
    ];
  });

  afterEach(() => host?.remove());

  describe('on a phone', () => {
    it('offers no Select while the account belongs to no household', async () => {
      index = [];
      await render();

      expect(toggle()).toBeNull();
      expect(bar()).toBeNull();
      expect(boxes()).toEqual([]);
    });

    it('offers Select, a 40px control, in a labelled region', async () => {
      await render();

      expect(toggleText()).toBe('transactions.select.start');
      expect(bar()?.getAttribute('role')).toBe('region');
      expect(bar()?.getAttribute('aria-label')).toBe('transactions.select.barLabel');
      expect(toggle()!.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      expect(boxes()).withContext('rows open, not select, until the mode is on').toEqual([]);
    });

    it('offers no Select over an empty list', async () => {
      rows = [];
      await render();

      expect(toggle()).toBeNull();
    });

    it("enters the mode with focus kept on the toggle, each row's menu becoming a checkbox named for the row", async () => {
      await render();

      enter();

      expect(toggleText()).toBe('transactions.select.done');
      expect(document.activeElement).withContext('focus stays on the toggle').toBe(toggle());
      expect(count()).toBe('transactions.select.count:{"count":0}');
      expect(host.querySelector('.row-menu-btn')).withContext('the row menus give way').toBeNull();
      expect(boxes().length).toBe(3);
      const name = boxOf('a').getAttribute('aria-label')!;
      expect(name).toContain('transactions.rowLabel');
      expect(name).toContain('Banana');
      expect(boxes().every(box => !box.checked)).toBeTrue();
      const row = fixture.debugElement.queryAll(By.directive(TransactionRowComponent))[0];
      expect((row.componentInstance as TransactionRowComponent).swipeActions()).withContext('no swipe drawer').toBeFalse();
    });

    it("names each checkbox exactly as its row's own button is named", async () => {
      rows = [
        createTransaction({ id: 'in', type: 'income', amount: 5, currency: 'EUR', description: 'Refund' }),
        createTransaction({ id: 'out', type: 'expense', amount: 7, currency: 'USD', description: 'Lunch' }),
      ];
      await render();
      enter();

      for (const id of ['in', 'out']) {
        const button = rowOf(id).querySelector('.row-activate')!.getAttribute('aria-label');
        expect(button).withContext(`${id}: the row button is named`).toBeTruthy();
        expect(boxOf(id).getAttribute('aria-label')).withContext(id).toBe(button);
      }
    });

    it('gives each row checkbox a 40px target', async () => {
      await render();
      enter();

      const box = rowOf('a').querySelector<HTMLElement>('mat-checkbox .mdc-checkbox')!.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    });

    it('selects a row on its own click instead of opening it, and deselects it on a second', async () => {
      await render();
      enter();

      rowOf('b').click();
      fixture.detectChanges();
      expect(boxOf('b').checked).toBeTrue();
      expect(rowOf('b').classList).toContain('row-selected');
      expect(getComputedStyle(rowOf('b'), '::before').width).withContext('the leading bar').toBe('3px');
      expect(count()).toBe('transactions.select.count:{"count":1}');

      // Enter on the row's button arrives as the button's click.
      rowOf('b').querySelector<HTMLButtonElement>('.row-activate')!.click();
      fixture.detectChanges();
      expect(boxOf('b').checked).toBeFalse();
      expect(count()).toBe('transactions.select.count:{"count":0}');
      expect(edited).not.toHaveBeenCalled();
    });

    it('selects a row from its checkbox once, never twice through the row behind it', async () => {
      await render();
      enter();

      pick('a');

      expect(boxOf('a').checked).toBeTrue();
      expect(count()).toBe('transactions.select.count:{"count":1}');
      expect(edited).not.toHaveBeenCalled();
    });

    it('selects a row with Enter on its checkbox', async () => {
      await render();
      enter();

      boxOf('c').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(boxOf('c').checked).toBeTrue();
      expect(edited).not.toHaveBeenCalled();
    });

    it('still opens a row outside the mode', async () => {
      await render();

      rowOf('b').click();

      expect(edited).toHaveBeenCalledOnceWith(rows[1]);
    });

    it('announces the count as it changes, each one replacing a count not yet spoken', async () => {
      await render();
      enter();
      announcer.announce.calls.reset();

      pick('a', 'b');

      expect(announcer.announce.calls.allArgs()).toEqual([
        ['transactions.select.count:{"count":1}', 'polite', 'replace'],
        ['transactions.select.count:{"count":2}', 'polite', 'replace'],
      ]);
    });

    it('leaves with Done: the selection cleared, the menus back, focus still on the toggle', async () => {
      await render();
      enter();
      pick('a');

      toggle()!.click();
      fixture.detectChanges();

      expect(toggleText()).toBe('transactions.select.start');
      expect(document.activeElement).toBe(toggle());
      expect(boxes()).toEqual([]);
      expect(host.querySelectorAll('.row-menu-btn').length).toBe(3);

      enter();
      expect(count()).withContext('the selection went with the mode').toBe('transactions.select.count:{"count":0}');
    });

    it('leaves on Escape from anywhere in the list, focus returning to the toggle', async () => {
      await render();
      enter();
      pick('a');
      boxOf('a').focus();

      boxOf('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(boxes()).toEqual([]);
      expect(toggleText()).toBe('transactions.select.start');
      expect(document.activeElement).toBe(toggle());
    });

    it('keeps the toggle, and focus on it, when the mode is left over a list with no rows', async () => {
      await render();
      enter();
      fixture.componentRef.setInput('transactions', []);
      fixture.detectChanges();
      expect(toggleText()).withContext('the mode holds the bar').toBe('transactions.select.done');

      toggle()!.click();
      fixture.detectChanges();

      expect(toggleText()).toBe('transactions.select.start');
      expect(document.activeElement).withContext('focus is not dropped to the page').toBe(toggle());

      enter();
      toggle()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(document.activeElement).withContext('nor by Escape').toBe(toggle());

      fixture.componentRef.setInput('transactions', rows);
      fixture.detectChanges();
      fixture.componentRef.setInput('transactions', []);
      fixture.detectChanges();
      expect(toggle()).withContext('an empty list offers no Select once rows have come and gone').toBeNull();
    });

    it('selects every row shown with Select all shown', async () => {
      await render();
      enter();
      pick('b');

      barButton('select-all').click();
      fixture.detectChanges();

      expect(boxes().every(box => box.checked)).toBeTrue();
      expect(count()).toBe('transactions.select.count:{"count":3}');
      expect(capped()).withContext('nothing was left out').toBeUndefined();
    });

    it(`selects at most ${MAX_BULK_SHARE} with Select all shown, saying how many were left out`, async () => {
      rows = Array.from({ length: MAX_BULK_SHARE + 3 }, (_, i) =>
        createTransaction({ id: `t${i}`, amount: i + 1, description: `Row ${i}` }));
      await render();
      enter();
      announcer.announce.calls.reset();

      barButton('select-all').click();
      fixture.detectChanges();

      expect(count()).toBe(`transactions.select.count:{"count":${MAX_BULK_SHARE}}`);
      expect(boxes().filter(box => box.checked).length).toBe(MAX_BULK_SHARE);
      expect(boxOf(`t${MAX_BULK_SHARE}`).checked).withContext('the first rows shown are the ones taken').toBeFalse();
      expect(capped()).toBe(`transactions.select.capped:{"max":${MAX_BULK_SHARE},"count":3}`);
      // The count and the note are one message, so a later state replaces
      // both rather than a note per refused choice piling up behind it.
      expect(announcer.announce.calls.allArgs()).toEqual([[
        `transactions.select.count:{"count":${MAX_BULK_SHARE}}` +
          ` transactions.select.capped:{"max":${MAX_BULK_SHARE},"count":3}`,
        'polite',
        'replace',
      ]]);

      // One more past the cap is refused the same way, and says why again.
      announcer.announce.calls.reset();
      boxOf(`t${MAX_BULK_SHARE + 1}`).click();
      fixture.detectChanges();
      expect(boxOf(`t${MAX_BULK_SHARE + 1}`).checked).toBeFalse();
      expect(count()).toBe(`transactions.select.count:{"count":${MAX_BULK_SHARE}}`);
      expect(capped()).toBe(`transactions.select.capped:{"max":${MAX_BULK_SHARE},"count":1}`);
      expect(announcer.announce.calls.allArgs()).toEqual([[
        `transactions.select.count:{"count":${MAX_BULK_SHARE}}` +
          ` transactions.select.capped:{"max":${MAX_BULK_SHARE},"count":1}`,
        'polite',
        'replace',
      ]]);
    });

    it('holds Share with… and Stop sharing, still focusable, until a row is selected', async () => {
      await render();
      enter();

      for (const name of ['select-share', 'select-stop']) {
        const button = barButton(name);
        expect(button.getAttribute('aria-disabled')).withContext(name).toBe('true');
        expect(button.disabled).withContext(`${name} stays in the tab order`).toBeFalse();
        button.click();
      }
      expect(dialog.open).not.toHaveBeenCalled();

      pick('a');
      expect(barButton('select-share').getAttribute('aria-disabled')).toBeNull();
      expect(barButton('select-stop').getAttribute('aria-disabled')).toBeNull();
    });

    it('shares the selected rows into each household chosen: one call per household, exactly those rows', async () => {
      closesWith(['h1', 'h2']);
      await render();
      enter();
      pick('b', 'a');

      barButton('select-share').click();
      await settle();

      expect(dialogData()).toEqual({
        description: 'transactions.select.dialogRows:{"count":2}',
        targets: [{ householdId: 'h1', name: 'Home' }, { householdId: 'h2', name: 'Office' }],
        shared: [],
        mode: 'share',
      });
      expect(ledger.share.calls.allArgs().map(([ids, hid]) => [ids, hid])).toEqual([[['b', 'a'], 'h1'], [['b', 'a'], 'h2']]);
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledOnceWith(
        'transactions.select.shared:{"count":2,"names":"Home, Office"}'
      );
    });

    it('offers the only household already chosen when the account belongs to one', async () => {
      index = [HOME];
      closesWith(undefined);
      await render();
      enter();
      pick('b');

      barButton('select-share').click();
      await settle();

      expect(dialogData().shared).toEqual(['h1']);
      expect(ledger.share).not.toHaveBeenCalled();
    });

    it('stops sharing the selected rows with each household chosen, pre-set from the rows', async () => {
      closesWith(['h1']);
      await render();
      enter();
      pick('a', 'c');

      barButton('select-stop').click();
      await settle();

      expect(dialogData()).toEqual({
        description: 'transactions.select.dialogRows:{"count":2}',
        targets: [{ householdId: 'h1', name: 'Home' }, { householdId: 'h2', name: 'Office' }],
        // The live households the rows name, never a key for one the account has left.
        shared: ['h1', 'h2'],
        mode: 'unshare',
      });
      expect(ledger.unshare.calls.allArgs().map(([ids, hid]) => [ids, hid])).toEqual([[['a', 'c'], 'h1']]);
      expect(ledger.share).not.toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledOnceWith('transactions.select.unshared:{"count":2,"names":"Home"}');
    });

    it('changes nothing when the dialog is dismissed or closes with no household', async () => {
      await render();
      enter();
      pick('a');

      closesWith(undefined);
      barButton('select-share').click();
      closesWith([]);
      barButton('select-stop').click();
      await settle();

      expect(ledger.share).not.toHaveBeenCalled();
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(count()).toBe('transactions.select.count:{"count":1}');
    });

    it('shows determinate progress while the shares run, holding the actions, and clears the selection after', async () => {
      let finish!: () => void;
      ledger.share.and.callFake((_ids, _hid, report) => {
        report?.(1, 4);
        return new Promise<void>(resolve => (finish = resolve));
      });
      closesWith(['h1']);
      await render();
      enter();
      pick('a', 'b');

      barButton('select-share').focus();
      barButton('select-share').click();
      await settle();

      const meter = progress()!;
      expect(meter).withContext('progress shows while the shares run').not.toBeNull();
      expect(meter.getAttribute('mode')).toBe('determinate');
      expect(meter.getAttribute('aria-valuenow')).toBe('25');
      expect(meter.getAttribute('aria-label')).toBe('transactions.select.progress');
      expect(barButton('select-share').getAttribute('aria-disabled')).toBe('true');
      expect(barButton('select-stop').getAttribute('aria-disabled')).toBe('true');

      finish();
      await settle();

      expect(progress()).toBeNull();
      expect(count()).withContext('the selection clears once it went through').toBe('transactions.select.count:{"count":0}');
      expect(boxes().some(box => box.checked)).toBeFalse();
      expect(toggleText()).withContext('still selecting').toBe('transactions.select.done');
      expect(meter.isConnected).toBeFalse();
      expect(bar()!.contains(document.activeElement)).withContext('focus stays in the bar').toBeTrue();
      // The window reads the rows again, so their chips show the shares as changed.
      expect(windowSource.refresh).toHaveBeenCalled();
      // The result is announced once, by the notification alone.
      expect(notifications.success).toHaveBeenCalledTimes(1);
      expect(announcer.announce).not.toHaveBeenCalledWith(jasmine.stringMatching('transactions.select.shared'), jasmine.anything(), jasmine.anything());
      expect(announcer.announce).not.toHaveBeenCalledWith(jasmine.stringMatching('transactions.select.shared'));
    });

    it('hands focus lost during a run to the bar\'s first control, and leaves focus the reader moved alone', async () => {
      let finish!: () => void;
      ledger.share.and.callFake(() => new Promise<void>(resolve => (finish = resolve)));
      closesWith(['h1']);
      await render();
      enter();
      pick('a');
      barButton('select-share').click();
      await settle();

      (document.activeElement as HTMLElement | null)?.blur();
      finish();
      await settle();
      expect(document.activeElement).toBe(toggle());

      pick('b');
      barButton('select-share').click();
      await settle();
      boxOf('c').focus();
      finish();
      await settle();
      expect(document.activeElement).toBe(boxOf('c'));
    });

    it('leaves a selection made after leaving and re-entering the mode alone when an earlier run finishes', async () => {
      let finish!: () => void;
      ledger.share.and.callFake(() => new Promise<void>(resolve => (finish = resolve)));
      closesWith(['h1']);
      await render();
      enter();
      pick('a', 'b');
      barButton('select-share').click();
      await settle();
      expect(progress()).withContext('a run under way').not.toBeNull();

      // Done, then Select again: a fresh selection, one of the run's rows among it.
      toggle()!.click();
      fixture.detectChanges();
      enter();
      pick('a');
      expect(count()).toBe('transactions.select.count:{"count":1}');

      finish();
      await settle();

      expect(count()).withContext('the new choice is not the run\'s to clear').toBe('transactions.select.count:{"count":1}');
      expect(boxOf('a').checked).toBeTrue();
      expect(notifications.success).toHaveBeenCalledTimes(1);
    });

    it('keeps the selection when too many rows are refused, saying so in its own words', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('tooMany', 'too many'));
      closesWith(['h1']);
      await render();
      enter();
      pick('a', 'b');

      barButton('select-share').click();
      await settle();

      expect(notifications.error).toHaveBeenCalledOnceWith(`transactions.select.tooMany:{"max":${MAX_BULK_SHARE}}`);
      expect(count()).toBe('transactions.select.count:{"count":2}');
      expect(progress()).toBeNull();
    });

    it('names the household that refused the rows because the membership has ended', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('notMember', 'not a member'));
      closesWith(['h2']);
      await render();
      enter();
      pick('b');

      barButton('select-share').click();
      await settle();

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.notMember:{"name":"Office"}');
      expect(count()).toBe('transactions.select.count:{"count":1}');
    });

    it('says, offline, that the households see the rows once the device is back online', async () => {
      online.set(false);
      closesWith(['h1']);
      await render();
      enter();
      pick('a', 'b');

      barButton('select-share').click();
      await settle();

      expect(ledger.share).toHaveBeenCalledTimes(1);
      expect(notifications.info).toHaveBeenCalledOnceWith(
        'transactions.select.sharedOffline:{"count":2,"names":"Home"}'
      );
    });

    it('stops sharing offline, saying the households keep seeing the rows until the device reconnects', async () => {
      online.set(false);
      closesWith(['h2']);
      await render();
      enter();
      pick('c');

      barButton('select-stop').click();
      await settle();

      expect(ledger.unshare).toHaveBeenCalledTimes(1);
      expect(notifications.success).toHaveBeenCalledOnceWith(
        'transactions.select.unsharedOffline:{"count":1,"names":"Office"}'
      );
    });

    /**
     * A run of the bar is one action however many rows and households it
     * covers, and is reported only once it went through for at least one
     * household: a count or a household id would say more than the action.
     */
    describe('household_action', () => {
      it('reports one share for rows shared into two households', async () => {
        closesWith(['h1', 'h2']);
        await render();
        enter();
        pick('b', 'a');

        barButton('select-share').click();
        await settle();

        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'share' });
      });

      it('reports one unshare for rows taken out of a household', async () => {
        closesWith(['h1']);
        await render();
        enter();
        pick('a', 'c');

        barButton('select-stop').click();
        await settle();

        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'unshare' });
      });

      it('reports one share when only one of the households took the rows', async () => {
        ledger.share.and.callFake((_ids, householdId) => householdId === 'h2'
          ? Promise.reject(new LedgerShareRefusal('notMember', 'not a member'))
          : Promise.resolve());
        closesWith(['h1', 'h2']);
        await render();
        enter();
        pick('b');

        barButton('select-share').click();
        await settle();

        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'share' });
      });

      it('reports nothing when the dialog is dismissed or closes with no household', async () => {
        await render();
        enter();
        pick('a');

        closesWith(undefined);
        barButton('select-share').click();
        closesWith([]);
        barButton('select-stop').click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports nothing when the rows are refused', async () => {
        ledger.share.and.rejectWith(new LedgerShareRefusal('tooMany', 'too many'));
        closesWith(['h1']);
        await render();
        enter();
        pick('a', 'b');

        barButton('select-share').click();
        await settle();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });
    });
  });

  describe('under the axe sweep', () => {
    /** A share of the chosen rows that has reported half its rows and never finishes. */
    function runStalls(): void {
      ledger.share.and.callFake((_ids, _hid, report) => {
        report?.(1, 2);
        return new Promise<void>(() => undefined);
      });
      closesWith(['h1']);
    }

    /** The mode with rows chosen and a run under way. */
    async function busyMode(): Promise<void> {
      runStalls();
      await render();
      enter();
      pick('a', 'c');
      barButton('select-share').click();
      await settle();
      expect(progress()).withContext('a run under way').not.toBeNull();
    }

    it('finds nothing on a phone', async () => {
      await busyMode();

      expect(summarizeViolations(await runAxe(host))).toEqual([]);
    });

    it("finds nothing on a desktop, the select column's header included", async () => {
      desktop = true;
      await busyMode();

      expect(host.querySelector('th.col-select')).withContext('the swept table has the select column').not.toBeNull();
      expect(summarizeViolations(await runAxe(host))).toEqual([]);
    });

    it("finds nothing in the bar with the cap's note beside a run under way", async () => {
      rows = Array.from({ length: MAX_BULK_SHARE + 1 }, (_, i) =>
        createTransaction({ id: `t${i}`, amount: i + 1, description: `Row ${i}` }));
      runStalls();
      await render();
      enter();
      barButton('select-all').click();
      fixture.detectChanges();
      expect(capped()).withContext('the note shows').toBeDefined();
      barButton('select-share').click();
      await settle();
      expect(progress()).withContext('a run under way').not.toBeNull();
      expect(capped()).withContext('the note still shows').toBeDefined();

      // The bar alone: the rows are swept above, and five hundred of them
      // would only slow the pass.
      expect(summarizeViolations(await runAxe(bar()!))).toEqual([]);
    });
  });

  describe('on a desktop', () => {
    beforeEach(() => {
      desktop = true;
    });

    it('adds a checkbox column named for each row, and a row click selects instead of opening', async () => {
      await render();
      expect(host.querySelector('th.col-select')).withContext('no column outside the mode').toBeNull();

      enter();

      expect(host.querySelector('th.col-select')?.textContent?.trim()).toBe('transactions.select.start');
      expect(boxOf('a').getAttribute('aria-label')).toContain('Banana');
      rowOf('b').click();
      fixture.detectChanges();
      expect(boxOf('b').checked).toBeTrue();
      expect(rowOf('b').classList).toContain('row-selected');
      pick('b');
      expect(boxOf('b').checked).withContext('the checkbox alone, once').toBeFalse();
      expect(edited).not.toHaveBeenCalled();

      boxOf('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(host.querySelector('th.col-select')).toBeNull();
      rowOf('b').click();
      expect(edited).toHaveBeenCalledOnceWith(rows[1]);
    });

    it('lets Escape close a note\'s tooltip without leaving the mode or dropping the selection', async () => {
      rows[0] = createTransaction({ id: 'a', amount: 30, description: 'Banana', note: 'Paid in cash', sharedWith: ['households/h1'] });
      await render();
      enter();
      pick('a', 'b');
      const note = rowOf('a').querySelector<HTMLButtonElement>('button.note-button')!;
      const tip = fixture.debugElement.query(By.css('button.note-button')).injector.get(MatTooltip);
      /** Escape as a keyboard sends it: the overlay reads its key code. */
      const escape = () => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        Object.defineProperty(event, 'keyCode', { get: () => 27 });
        return event;
      };

      TestBed.inject(FocusMonitor).focusVia(note, 'keyboard');
      await settle();
      expect(tip._isTooltipVisible()).withContext('the tooltip shows for keyboard focus').toBeTrue();

      note.dispatchEvent(escape());
      await settle();

      expect(tip._isTooltipVisible()).withContext('Escape closed it').toBeFalse();
      expect(toggleText()).toBe('transactions.select.done');
      expect(count()).toBe('transactions.select.count:{"count":2}');

      // With no tooltip showing, Escape leaves the mode as it does anywhere in the list.
      note.dispatchEvent(escape());
      fixture.detectChanges();
      expect(toggleText()).toBe('transactions.select.start');
    });

    it('fits the table and its checkbox column at the 704px floor without a sideways scrollbar', async () => {
      labels = {
        ...labels,
        'transactions.date': 'Date',
        'transactions.category': 'Category',
        'transactions.description': 'Description',
        'transactions.amount': 'Amount',
        'common.moreActions': 'More actions',
        'transactions.select.start': 'Select',
        'transactions.select.done': 'Done',
      };
      await render();
      host.style.display = 'block';
      host.style.width = '704px';
      enter();

      const scroll = host.querySelector('.table-scroll') as HTMLElement;
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
    });
  });

  describe('at a phone width', () => {
    const face = "Verdana, 'DejaVu Sans', sans-serif";
    const within = (inner: DOMRect, outer: DOMRect) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;

    beforeEach(() => {
      const long = (letter: string) => letter.repeat(100);
      index = [{ ...HOME, name: long('H') }, { ...OFFICE, name: long('O') }];
      labels = {
        ...labels,
        'transactions.select.start': 'Select',
        'transactions.select.done': 'Done',
        'transactions.select.selectAll': 'Select all shown',
        'transactions.share.menu': 'Share with…',
        'transactions.share.stop': 'Stop sharing',
      };
    });

    async function renderNarrow(): Promise<void> {
      await render();
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.display = 'block';
      host.style.width = '311px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material's buttons take their face from the
      // --mat-sys tokens rather than from the host.
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      fixture.detectChanges();
    }

    it('keeps the bar, the count, the note and every control inside 311px, with long household names', async () => {
      rows = Array.from({ length: MAX_BULK_SHARE + 12 }, (_, i) => createTransaction({
        id: `t${i}`,
        amount: 1_234_567.89,
        description: `Row ${i}`,
        sharedWith: ['households/h1', 'households/h2'],
      }));
      labels['transactions.select.count'] = `${MAX_BULK_SHARE} transactions selected`;
      labels['transactions.select.capped'] = `Only ${MAX_BULK_SHARE} can be selected at once, so 12 shown transactions weren't selected.`;
      await renderNarrow();
      enter();
      barButton('select-all').click();
      fixture.detectChanges();

      const region = bar()!.getBoundingClientRect();
      expect(region.width).toBeLessThanOrEqual(311.5);
      const parts = Array.from(bar()!.querySelectorAll<HTMLElement>('.select-count, .select-capped, button'));
      expect(parts.length).withContext('the count, the note and four buttons').toBe(6);
      for (const part of parts) {
        const box = part.getBoundingClientRect();
        expect(within(box, region)).withContext(`${part.className} inside the bar`).toBeTrue();
        if (part.tagName === 'BUTTON') {
          expect(box.height).withContext(`${part.className} target height`).toBeGreaterThanOrEqual(40);
        }
      }
      expect(host.scrollWidth).withContext('no sideways scroll').toBeLessThanOrEqual(host.clientWidth + 1);
      const firstRow = rowOf('t0').getBoundingClientRect();
      expect(within(firstRow, host.getBoundingClientRect())).withContext('a row with long shares').toBeTrue();
    });
  });
});

/**
 * The colours the list paints itself, read where Chrome paints them, in both
 * themes. Not the category tile: it paints the category's own colour.
 */
describe('TransactionListComponent colours', () => {
  let fixture: ComponentFixture<TransactionListComponent>;
  let host: HTMLElement;
  let windowSource: ReturnType<typeof createMockWindowSource>;

  const txns: Transaction[] = [
    createTransaction({
      id: 'a',
      amount: 30,
      description: 'Banana',
      note: 'Ripe by Friday',
      receiptUrl: 'https://storage.example.com/r1.jpg',
      receiptUrls: ['https://storage.example.com/r1.jpg', 'https://storage.example.com/r2.jpg'],
      receiptCount: 2,
    }),
    createTransaction({ id: 'b', amount: 10, description: 'Apple' }),
  ];

  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
  }

  /** What `color: var(token)` computes to under the theme on <html> now. */
  function tokenColour(token: string): string {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    try {
      settleAnimations(document);
      return getComputedStyle(probe).color;
    } finally {
      probe.remove();
    }
  }

  /** The element whose own text node holds `text`: the one that paints it. */
  function paintedTextOf(root: Element, text: string): HTMLElement {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent!.includes(text)) return node.parentElement!;
    }
    throw new Error(`no text node holds "${text}"`);
  }

  async function render(desktop: boolean): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionWindowService, useValue: windowSource },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: desktop, breakpoints: {} }) } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (a: number, c: string) => `${c} ${a}`, amountInBase: (t: { amount: number }) => t.amount },
        },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: { formatDate: () => 'date', formatRelativeDate: () => 'rel' } },
        {
          provide: CategoryHelperService,
          useValue: { getCategoryName: () => 'Cat', getCategoryIcon: () => 'icon', getCategoryColor: () => '#000' },
        },
        { provide: TranslationService, useValue: { t: (k: string) => k } },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: QuickAddService, useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction']) },
        { provide: FirestoreService, useValue: NO_HOUSEHOLDS },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  }

  beforeEach(() => {
    windowSource = createMockWindowSource();
  });

  afterEach(() => {
    host?.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  for (const [view, desktop, trigger] of [
    ['phone', false, '.row-menu-btn'],
    ['desktop', true, '.action-btn'],
  ] as const) {
    // Material colours a menu item's label and icon in rules that outrank a
    // utility on the item, so both are read where they are painted.
    it(`paints Delete's label and icon on the ${view} menu in --color-error-text, at AA, in both themes`, async () => {
      await render(desktop);
      (host.querySelector(trigger) as HTMLElement).click();
      fixture.detectChanges();

      const item = menuItems().find(el => el.textContent!.includes('common.delete'));
      expect(item).withContext('the delete item').toBeDefined();
      const label = paintedTextOf(item!, 'common.delete');
      const icon = item!.querySelector('mat-icon') as HTMLElement;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          const expected = tokenColour('--color-error-text');
          expect(getComputedStyle(label).color).withContext(`${theme} label`).toBe(expected);
          expect(getComputedStyle(icon).color).withContext(`${theme} icon`).toBe(expected);
          expect(ratio(paintedColor(label), paintedBackground(label)))
            .withContext(`${theme} label on the menu`)
            .toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  // A plain button has no state layer, so its hover needs a fill of its own;
  // and it can only be hovered inside a hovered row, so that fill has to
  // differ from the row's.
  it('paints the receipt icon at AA at rest, and gives its button a hover fill of its own, in both themes', async () => {
    await render(true);
    const button = host.querySelector('.receipt-icon-button') as HTMLElement;
    const icon = button.querySelector('.receipt-icon') as HTMLElement;
    const row = button.closest('tr') as HTMLElement;

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        expect(ratio(paintedColor(icon), paintedBackground(icon)))
          .withContext(`${theme} icon at rest`)
          .toBeGreaterThanOrEqual(4.5);
        try {
          row.style.background = hoverValue(row, '.desktop-table .mat-mdc-row', 'background');
          button.style.backgroundColor = hoverValue(button, '.receipt-icon-button', 'background-color');
          icon.style.color = hoverValue(icon, '.receipt-icon-button', 'color');
          expect(paintedBackground(button))
            .withContext(`${theme} the hover fill against the hovered row`)
            .not.toEqual(paintedBackground(row));
          expect(ratio(paintedColor(icon), paintedBackground(icon)))
            .withContext(`${theme} icon hovered`)
            .toBeGreaterThanOrEqual(4.5);
        } finally {
          row.style.removeProperty('background');
          button.style.removeProperty('background-color');
          icon.style.removeProperty('color');
        }
      });
    }
  });

  it("paints the table's lines in their text tokens at AA, and its rules in --border-primary, in both themes", async () => {
    await render(true);
    const lines = [
      ['date', '.date-text', '--text-muted'],
      ['category name', '.category-name', '--text-secondary'],
      ['description', '.description-text', '--text-primary'],
      ['note icon', '.note-icon', '--text-muted'],
      ['receipt icon', '.receipt-icon', '--text-muted'],
      ['receipt count', '.receipt-count-badge', '--text-muted'],
    ] as const;
    const rules = [
      ['header cell', 'th.mat-mdc-header-cell'],
      ['body cell', 'td.mat-mdc-cell'],
    ] as const;

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        settleAnimations(document);
        for (const [label, selector, token] of lines) {
          const el = host.querySelector(selector) as HTMLElement;
          expect(el).withContext(label).toBeTruthy();
          expect(getComputedStyle(el).color).withContext(`${theme} ${label}`).toBe(tokenColour(token));
          expect(ratio(paintedColor(el), paintedBackground(el)))
            .withContext(`${theme} ${label} on the table`)
            .toBeGreaterThanOrEqual(4.5);
        }
        const border = tokenColour('--border-primary');
        for (const [label, selector] of rules) {
          const cell = getComputedStyle(host.querySelector(selector) as HTMLElement);
          expect(cell.borderBlockEndStyle).withContext(`${theme} ${label} rule is drawn`).toBe('solid');
          expect(cell.borderBlockEndColor).withContext(`${theme} ${label} rule`).toBe(border);
        }
      });
    }
  });

  it('paints the failed-load line in --text-muted, at AA, in both themes', async () => {
    windowSource.loadError.set('initial');
    await render(true);
    const line = host.querySelector('.initial-error > span') as HTMLElement;
    expect(line).withContext('the failed-load line').toBeTruthy();

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        settleAnimations(document);
        expect(getComputedStyle(line).color).withContext(theme).toBe(tokenColour('--text-muted'));
        expect(ratio(paintedColor(line), paintedBackground(line)))
          .withContext(`${theme} on the page`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
