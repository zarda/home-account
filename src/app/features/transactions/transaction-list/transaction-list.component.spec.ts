import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
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
import { ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { Transaction } from '../../../models';
import { createTransaction, createUser } from '../../../core/services/testing';

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

    it('still runs the scroll-into-view correction while the view is alive', () => {
      internals(component).scrollToTarget(txns[0].id);
      fixture.detectChanges();

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
      fixture.detectChanges();

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
