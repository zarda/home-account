import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, NgZone, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { APP_BREAKPOINTS } from '../../core/layout/breakpoints';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { FitTextDirective } from '../../shared/directives/fit-text.directive';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of, Subject, BehaviorSubject, EMPTY } from 'rxjs';
import { TransactionsComponent } from './transactions.component';
import { TransactionService, TransactionMutation } from '../../core/services/transaction.service';
import { TransactionWindowService } from '../../core/services/transaction-window.service';
import { PeriodTotalsService, PeriodTotalsStatus } from '../../core/services/period-totals.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { UNDO_WINDOW_MS } from '../../core/services/pending-delete.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { TransactionListComponent } from './transaction-list/transaction-list.component';
import { Category, Transaction, TransactionFilters, User } from '../../models';
import { TypeTotals } from '../../core/utils/transaction-aggregation.utils';
import {
  FakeNotice,
  catalogTranslationStub,
  createTransaction,
  createCategory,
  createTranslationStub,
  keepThePageWhereFound,
  provideNoMotion,
} from '../../core/services/testing';

function createMockWindowSource() {
  return {
    window: signal<Transaction[]>([]),
    visibleWindow: signal<Transaction[]>([]),
    isInitialLoading: signal(false),
    reachedStart: signal(true),
    reachedEnd: signal(true),
    totalCount: signal<number | null>(null),
    resetSeq: signal(0),
    reset: jasmine.createSpy('reset').and.resolveTo(undefined),
    refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
    jumpTo: jasmine.createSpy('jumpTo').and.resolveTo(undefined),
    isInLoadedRange: jasmine.createSpy('isInLoadedRange').and.returnValue(true),
    requestScrollTo: jasmine.createSpy('requestScrollTo'),
  };
}

/**
 * The filters panel in the rendered describe: an empty template carrying the
 * inputs the page binds, so what the page hands the panel can be read back.
 */
@Component({ selector: 'app-transaction-filters', standalone: true, template: '' })
class TransactionFiltersStubComponent {
  categories = input<Category[]>([]);
  incomeCategories = input<Category[]>([]);
  initialDate = input<Date | undefined>(undefined);
  presetFilters = input<TransactionFilters | undefined>(undefined);
  showAll = input(false);
  floor = input<Date | null>(null);
  filtersChanged = output<TransactionFilters>();
}

function createMockPeriodTotals() {
  return {
    status: signal<PeriodTotalsStatus>({ kind: 'idle' }),
    totals: signal<TypeTotals | null>(null),
    exclude: signal<ReadonlySet<string>>(new Set()),
    reset: jasmine.createSpy('reset').and.resolveTo(undefined),
    refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
    calculate: jasmine.createSpy('calculate').and.resolveTo(true),
    retry: jasmine.createSpy('retry').and.resolveTo(true),
  };
}

describe('TransactionsComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    lastMutation: ReturnType<typeof signal<TransactionMutation | null>>;
    deleteTransaction: jasmine.Spy;
    getTransactionOnce: jasmine.Spy;
    getEarliestTransactionDateFromServer: jasmine.Spy;
  };
  let windowSource: ReturnType<typeof createMockWindowSource>;
  let periodTotals: ReturnType<typeof createMockPeriodTotals>;
  let authUser: ReturnType<typeof signal<User | null>>;
  let categoryService: {
    expenseCategories: ReturnType<typeof signal<unknown[]>>;
    incomeCategories: ReturnType<typeof signal<unknown[]>>;
    categories: ReturnType<typeof signal<ReturnType<typeof createCategory>[]>>;
    loadCategories: jasmine.Spy;
  };
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let quickAdd: jasmine.SpyObj<QuickAddService>;
  let router: jasmine.SpyObj<Router>;
  let queryParams$: Subject<Record<string, string>>;
  let routeSnapshotParams: Record<string, string>;
  let mutationSeq: number;
  let notifications: jasmine.SpyObj<NotificationService>;
  /** Every Undo notice the page's deletes opened, oldest first. */
  let notices: FakeNotice[];

  function build() {
    const fixture = TestBed.createComponent(TransactionsComponent);
    return fixture;
  }

  function emitMutation(mutation: Omit<TransactionMutation, 'seq'>): void {
    transactionService.lastMutation.set({ ...mutation, seq: ++mutationSeq });
  }

  beforeEach(async () => {
    transactionService = {
      transactions: signal<Transaction[]>([]),
      isLoading: signal(false),
      lastMutation: signal<TransactionMutation | null>(null),
      deleteTransaction: jasmine.createSpy('deleteTransaction').and.resolveTo(undefined),
      getTransactionOnce: jasmine.createSpy('getTransactionOnce').and.resolveTo(null),
      getEarliestTransactionDateFromServer: jasmine
        .createSpy('getEarliestTransactionDateFromServer')
        .and.resolveTo(null),
    };
    windowSource = createMockWindowSource();
    periodTotals = createMockPeriodTotals();
    authUser = signal<User | null>({ preferences: { baseCurrency: 'USD' } } as User);
    mutationSeq = 0;
    categoryService = {
      expenseCategories: signal<unknown[]>([]),
      incomeCategories: signal<unknown[]>([]),
      categories: signal([createCategory({ id: 'c1' })]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    notices = [];
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info', 'withAction']);
    notifications.withAction.and.callFake((message: string, action: string) => {
      const notice = new FakeNotice(message, action);
      notices.push(notice);
      return notice;
    });
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    quickAdd = jasmine.createSpyObj('QuickAddService', [
      'openAddTransaction',
      'openScanReceipt',
      'openImportPhotos',
    ]);
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    queryParams$ = new Subject<Record<string, string>>();
    routeSnapshotParams = {};

    const activatedRoute = {
      snapshot: { queryParamMap: { get: (k: string) => routeSnapshotParams[k] ?? null } },
      queryParams: queryParams$.asObservable(),
    };

    await TestBed.configureTestingModule({
      imports: [TransactionsComponent],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: AuthService, useValue: { currentUser: authUser, userId: signal<string | null>('user-1') } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (value: number, code: string) => `${code} ${value}` }
        },
        {
          provide: LocaleFormatService,
          useValue: { formatRange: jasmine.createSpy('formatRange').and.returnValue('RANGE') }
        },
        { provide: TranslationService, useValue: translation },
        { provide: NotificationService, useValue: notifications },
        { provide: AnnouncerService, useValue: announcer },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: Router, useValue: router },
      ],
    })
      .overrideComponent(TransactionsComponent, {
        set: {
          imports: [],
          template: '',
          // This override replaces the component's own providers array, so
          // every page-provided service needs its mock listed here.
          providers: [
            { provide: TransactionWindowService, useValue: windowSource },
            { provide: PeriodTotalsService, useValue: periodTotals },
          ],
        },
      })
      .compileComponents();
  });

  it('should create', () => {
    expect(build().componentInstance).toBeTruthy();
  });

  it('computes categories map', () => {
    const component = build().componentInstance;
    expect(component.categoriesMap().get('c1')?.id).toBe('c1');
  });

  describe('transactionCount', () => {
    it('prefers the exact server-side total', () => {
      const component = build().componentInstance;
      windowSource.totalCount.set(240);
      expect(component.transactionCount()).toBe('240');
    });

    it('marks the loaded count as partial while more pages remain', () => {
      const component = build().componentInstance;
      windowSource.visibleWindow.set([createTransaction(), createTransaction()]);
      windowSource.reachedEnd.set(false);
      expect(component.transactionCount()).toBe('2+');
    });

    it('uses the visible count for client-only filters', () => {
      const component = build().componentInstance;
      windowSource.totalCount.set(240);
      windowSource.visibleWindow.set([createTransaction()]);
      component.onFiltersChanged({ searchQuery: 'coffee' });
      expect(component.transactionCount()).toBe('1');
    });

    it('keeps the exact server total after an amount box is cleared', () => {
      // ngModel writes literal null for an emptied number input; that must
      // not flip the header to the client-side "N+" form.
      const component = build().componentInstance;
      windowSource.totalCount.set(240);
      component.onFiltersChanged({
        minAmount: null as unknown as number,
        maxAmount: null as unknown as number,
      });
      expect(component.transactionCount()).toBe('240');
    });

    it('treats a tag filter as client-only and marks a partial window', () => {
      // The server total counts rows the tag filter then hides; showing it
      // would contradict the list.
      const component = build().componentInstance;
      windowSource.totalCount.set(240);
      windowSource.visibleWindow.set([createTransaction()]);
      windowSource.reachedEnd.set(false);
      component.onFiltersChanged({ tags: ['travel'] });
      expect(component.transactionCount()).toBe('1+');
    });
  });

  it('ngOnInit loads categories', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(categoryService.loadCategories).toHaveBeenCalled();
  });

  it('ngOnInit honours the showAll and date query params', () => {
    routeSnapshotParams = { showAll: 'true', date: '2026-06-15' };
    const fixture = build();
    fixture.detectChanges();
    expect(fixture.componentInstance.showAll()).toBeTrue();
    expect(fixture.componentInstance.initialDate()).toEqual(jasmine.any(Date));
  });

  it('ngOnInit ignores an invalid date param', () => {
    routeSnapshotParams = { date: 'not-a-date' };
    const fixture = build();
    fixture.detectChanges();
    expect(fixture.componentInstance.initialDate()).toBeUndefined();
  });

  it('opens the add dialog when the action=add query param arrives', fakeAsync(() => {
    const fixture = build();
    fixture.detectChanges();
    queryParams$.next({ action: 'add' });
    tick(100);
    expect(quickAdd.openAddTransaction).toHaveBeenCalled();
  }));

  describe('the filters\' picker floor read', () => {
    it('reads the oldest row\'s date once on init, not again on a filter change', () => {
      const fixture = build();
      fixture.detectChanges();
      expect(transactionService.getEarliestTransactionDateFromServer).toHaveBeenCalledTimes(1);

      fixture.componentInstance.onFiltersChanged({ type: 'expense' });

      expect(transactionService.getEarliestTransactionDateFromServer).toHaveBeenCalledTimes(1);
    });
  });

  it('onFiltersChanged resets the window and the period totals with the same filters', () => {
    const component = build().componentInstance;
    component.onFiltersChanged({ type: 'expense' });
    expect(windowSource.reset).toHaveBeenCalledWith({ type: 'expense' }, 'desc');
    expect(periodTotals.reset).toHaveBeenCalledWith({ type: 'expense' });
  });

  describe('the tx query param', () => {
    it('opens, scrolls to and edits the transaction named by the tx query param after the first window seed', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-9' });
      transactionService.getTransactionOnce.and.resolveTo(txn);
      windowSource.isInLoadedRange.and.returnValue(false);
      routeSnapshotParams = { tx: 'tx-9' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(transactionService.getTransactionOnce).toHaveBeenCalledWith('tx-9');
      expect(windowSource.jumpTo).toHaveBeenCalledWith(txn.date);
      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-9');
      expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, jasmine.objectContaining({
        data: { mode: 'edit', transaction: txn },
      }));
    }));

    it('keeps the window in place when the target is already in range', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-5' });
      transactionService.getTransactionOnce.and.resolveTo(txn);
      windowSource.isInLoadedRange.and.returnValue(true);
      routeSnapshotParams = { tx: 'tx-5' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(windowSource.jumpTo).not.toHaveBeenCalled();
      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-5');
      expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, jasmine.objectContaining({
        data: { mode: 'edit', transaction: txn },
      }));
    }));

    it('toasts and opens nothing when the linked transaction is gone', fakeAsync(() => {
      transactionService.getTransactionOnce.and.resolveTo(null);
      routeSnapshotParams = { tx: 'tx-missing' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(notifications.info).toHaveBeenCalledWith('import.linkedTransactionGone');
      expect(dialog.open).not.toHaveBeenCalled();
      expect(windowSource.requestScrollTo).not.toHaveBeenCalled();
    }));

    it('toasts a generic error when the linked-transaction fetch rejects', fakeAsync(() => {
      transactionService.getTransactionOnce.and.rejectWith(new Error('offline'));
      routeSnapshotParams = { tx: 'tx-err' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(dialog.open).not.toHaveBeenCalled();
    }));

    it('consumes the tx param once', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-1' });
      transactionService.getTransactionOnce.and.resolveTo(txn);
      routeSnapshotParams = { tx: 'tx-1' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();
      expect(dialog.open).toHaveBeenCalledTimes(1);

      dialog.open.calls.reset();
      transactionService.getTransactionOnce.calls.reset();
      fixture.componentInstance.onFiltersChanged({ type: 'expense' });
      tick();

      expect(transactionService.getTransactionOnce).not.toHaveBeenCalled();
      expect(dialog.open).not.toHaveBeenCalled();
    }));

    it('resolves the tx target with no live listener to fall back to', fakeAsync(() => {
      // The mock stubs only the one-shot method; a regression to the
      // listener would call an undefined spy and throw before this settles.
      const txn = createTransaction({ id: 'tx-42' });
      transactionService.getTransactionOnce.and.resolveTo(txn);
      routeSnapshotParams = { tx: 'tx-42' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-42');
    }));

    it('widens to all dates when arriving with a tx target', () => {
      routeSnapshotParams = { tx: 'tx-9' };
      const fixture = build();
      fixture.detectChanges();
      expect(fixture.componentInstance.showAll()).toBeTrue();
    });

    it('the tx target wins over a date pre-filter', () => {
      routeSnapshotParams = { tx: 'tx-9', date: '2026-08-01' };
      const fixture = build();
      fixture.detectChanges();
      expect(fixture.componentInstance.showAll()).toBeTrue();
      expect(fixture.componentInstance.initialDate()).toBeUndefined();
    });
  });

  describe('stripping consumed params', () => {
    it('strips tx from the URL once captured', () => {
      routeSnapshotParams = { tx: 'tx-9' };
      const fixture = build();
      fixture.detectChanges();

      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { tx: null, action: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }));
    });

    it('strips action after scheduling the add dialog', fakeAsync(() => {
      const fixture = build();
      fixture.detectChanges();
      queryParams$.next({ action: 'add' });
      tick(100);

      expect(quickAdd.openAddTransaction).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
        queryParams: { tx: null, action: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }));
    }));

    it('a clean reload opens nothing and strips nothing', () => {
      const fixture = build();
      fixture.detectChanges();
      queryParams$.next({});

      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('leaves showAll and date alone', () => {
      routeSnapshotParams = { showAll: 'true' };
      const fixture = build();
      fixture.detectChanges();

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  it('onDateSortChange resets the window only when the direction changes', () => {
    const component = build().componentInstance;
    component.onDateSortChange('desc');
    expect(windowSource.reset).not.toHaveBeenCalled();

    component.onDateSortChange('asc');
    expect(windowSource.reset).toHaveBeenCalledWith({}, 'asc');
    // Sums are order-independent: a sort flip must not re-read the totals.
    expect(periodTotals.reset).not.toHaveBeenCalled();
  });

  describe('mutation handling', () => {
    it('refreshes in place for a mutation inside the loaded range', fakeAsync(() => {
      const fixture = build();
      fixture.detectChanges();

      windowSource.isInLoadedRange.and.returnValue(true);
      emitMutation({ kind: 'add', id: 'tx-1', date: Timestamp.now() });
      fixture.detectChanges();
      tick();

      expect(windowSource.refresh).toHaveBeenCalled();
      expect(windowSource.jumpTo).not.toHaveBeenCalled();
      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-1');
    }));

    it('jumps the window to a mutation outside the loaded range', fakeAsync(() => {
      const fixture = build();
      fixture.detectChanges();

      const date = Timestamp.now();
      windowSource.isInLoadedRange.and.returnValue(false);
      emitMutation({ kind: 'update', id: 'tx-2', date });
      fixture.detectChanges();
      tick();

      expect(windowSource.jumpTo).toHaveBeenCalledWith(date);
      expect(windowSource.refresh).not.toHaveBeenCalled();
      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-2');
    }));

    it('refreshes without scrolling for deletes', fakeAsync(() => {
      const fixture = build();
      fixture.detectChanges();

      emitMutation({ kind: 'delete', id: 'tx-3' });
      fixture.detectChanges();
      tick();

      expect(windowSource.refresh).toHaveBeenCalled();
      expect(windowSource.requestScrollTo).not.toHaveBeenCalled();
    }));

    it('ignores mutations recorded before the page was opened', fakeAsync(() => {
      emitMutation({ kind: 'add', id: 'tx-old', date: Timestamp.now() });
      const fixture = build();
      fixture.detectChanges();
      tick();

      expect(windowSource.refresh).not.toHaveBeenCalled();
      expect(windowSource.jumpTo).not.toHaveBeenCalled();
      expect(periodTotals.refresh).not.toHaveBeenCalled();
    }));

    it('refreshes the period totals for every mutation kind, jumped or not', fakeAsync(() => {
      const fixture = build();
      fixture.detectChanges();

      windowSource.isInLoadedRange.and.returnValue(true);
      emitMutation({ kind: 'add', id: 'tx-1', date: Timestamp.now() });
      fixture.detectChanges();
      tick();

      // A row that lands outside the loaded range still changes the totals.
      windowSource.isInLoadedRange.and.returnValue(false);
      emitMutation({ kind: 'update', id: 'tx-2', date: Timestamp.now() });
      fixture.detectChanges();
      tick();

      emitMutation({ kind: 'delete', id: 'tx-3' });
      fixture.detectChanges();
      tick();

      expect(periodTotals.refresh).toHaveBeenCalledTimes(3);
    }));
  });

  describe('period totals figures', () => {
    const settledTotals: TypeTotals = { income: 500, expense: 300, balance: 200, count: 8 };

    function settle(totals: TypeTotals = settledTotals): void {
      periodTotals.totals.set(totals);
      periodTotals.status.set({ kind: 'ready' });
    }

    it('shows Spent and Net when no type filter is active', () => {
      const component = build().componentInstance;
      settle();
      expect(component.totalsFigures()).toEqual([
        { labelKey: 'common.totalExpenses', value: 'USD 300' },
        { labelKey: 'common.netBalance', value: 'USD 200' },
      ]);
    });

    it('shows only Spent under an expense filter', () => {
      // Net would be identically minus Spent — a redundant figure that
      // reads like a defect.
      const component = build().componentInstance;
      component.onFiltersChanged({ type: 'expense' });
      settle();
      expect(component.totalsFigures()).toEqual([
        { labelKey: 'common.totalExpenses', value: 'USD 300' },
      ]);
    });

    it('shows only Income under an income filter', () => {
      // Spent would print a zero over a list of salary rows.
      const component = build().componentInstance;
      component.onFiltersChanged({ type: 'income' });
      settle();
      expect(component.totalsFigures()).toEqual([
        { labelKey: 'common.totalIncome', value: 'USD 500' },
      ]);
    });

    it('renders nothing while the sweep has not settled', () => {
      const component = build().componentInstance;
      expect(component.totalsState()).toBe('hidden');
      expect(component.totalsFigures()).toEqual([]);

      periodTotals.status.set({ kind: 'computing' });
      expect(component.totalsState()).toBe('computing');
      expect(component.totalsFigures()).toEqual([]);
    });

    it('snaps a sub-unit negative net to an unsigned zero', () => {
      // JPY has zero decimals: −0.4 would otherwise format as "−¥0".
      authUser.set({ preferences: { baseCurrency: 'JPY' } } as User);
      const component = build().componentInstance;
      settle({ income: 100, expense: 100.4, balance: -0.4, count: 2 });

      const net = component.totalsFigures()[1];
      expect(net.value).toBe('JPY 0');
      expect(net.value).not.toContain('-');
    });

    it('ignores the sliding window entirely', () => {
      // The acceptance criterion at unit level: scrolling moves the window,
      // and the figures must not move with it.
      const component = build().componentInstance;
      settle();
      const before = component.totalsFigures();

      windowSource.visibleWindow.set([createTransaction(), createTransaction()]);
      windowSource.reachedEnd.set(false);
      windowSource.reachedStart.set(false);

      expect(component.totalsFigures()).toEqual(before);
    });
  });

  // A result count and its totals are current state: the next filter or sort
  // change makes them stale, so each replaces any still waiting to be spoken.
  it('announces the plain result count when totals were never wired for the reset', fakeAsync(() => {
    // The idle branch (e.g. signed out): today's behavior, count only.
    const fixture = build();
    fixture.detectChanges();
    expect(announcer.announce).not.toHaveBeenCalled();

    windowSource.resetSeq.set(1);
    fixture.detectChanges();
    tick();
    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultCountAnnouncement', 'polite', 'replace');
  }));

  it('announces count and totals as one message, once per reset, after the sweep settles', fakeAsync(() => {
    const fixture = build();
    fixture.detectChanges();

    // Reset lands first: the sweep is still computing, so nothing announces.
    periodTotals.status.set({ kind: 'computing' });
    windowSource.resetSeq.set(1);
    fixture.detectChanges();
    tick();
    expect(announcer.announce).not.toHaveBeenCalled();

    // The sweep settles: exactly one combined message.
    periodTotals.totals.set({ income: 500, expense: 300, balance: 200, count: 8 });
    periodTotals.status.set({ kind: 'ready' });
    fixture.detectChanges();
    tick();
    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultWithTotalsAnnouncement', 'polite', 'replace');

    // A later refold (rates, language) changes the figures silently.
    periodTotals.totals.set({ income: 500, expense: 300, balance: 150, count: 8 });
    fixture.detectChanges();
    tick();
    expect(announcer.announce).toHaveBeenCalledTimes(1);
  }));

  it('announces the over-cap state as the reset outcome', fakeAsync(() => {
    const fixture = build();
    fixture.detectChanges();

    periodTotals.status.set({ kind: 'over-cap', serverCount: 1200 });
    windowSource.resetSeq.set(1);
    fixture.detectChanges();
    tick();

    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultWithTotalsAnnouncement', 'polite', 'replace');
  }));

  it('onCalculateTotals announces the totals once the explicit sweep lands', async () => {
    const component = build().componentInstance;
    periodTotals.status.set({ kind: 'over-cap', serverCount: 1200 });
    periodTotals.calculate.and.callFake(async () => {
      periodTotals.totals.set({ income: 500, expense: 300, balance: 200, count: 8 });
      periodTotals.status.set({ kind: 'ready' });
      return true;
    });

    await component.onCalculateTotals();

    expect(periodTotals.calculate).toHaveBeenCalled();
    expect(announcer.announce).toHaveBeenCalledWith('transactions.totalsAnnouncement', 'polite', 'replace');
  });

  it('onCalculateTotals stays silent when the sweep was superseded', async () => {
    const component = build().componentInstance;
    periodTotals.calculate.and.resolveTo(false);

    await component.onCalculateTotals();

    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it('openEditDialog opens the form in edit mode', () => {
    const component = build().componentInstance;
    const txn = createTransaction();
    component.openEditDialog(txn);
    expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, jasmine.objectContaining({
      data: { mode: 'edit', transaction: txn },
    }));
  });

  /**
   * A confirmed delete waits out its Undo window on the app's own clock
   * (PendingDeleteService, real here), so every case runs on fake timers and
   * ends with the window run out or the page gone: no timer outlives a case.
   */
  describe('a deleted row', () => {
    const coffee = createTransaction({ id: 'coffee', description: 'Coffee' });
    const rent = createTransaction({ id: 'rent', description: 'Rent' });
    const tea = createTransaction({ id: 'tea', description: 'Tea' });
    let list: jasmine.SpyObj<Pick<TransactionListComponent, 'deleteFailed' | 'deleteUndone'>>;
    let fixture: ComponentFixture<TransactionsComponent>;
    let component: TransactionsComponent;

    /** The rows as the window holds them, with no client-only filter between it and the list. */
    function load(rows: Transaction[]): void {
      windowSource.window.set(rows);
      windowSource.visibleWindow.set(rows);
      fixture.detectChanges();
    }

    const listed = (): string[] => component.transactions().map(row => row.id);

    beforeEach(() => {
      list = jasmine.createSpyObj('list', ['deleteFailed', 'deleteUndone']);
      fixture = build();
      component = fixture.componentInstance;
      windowSource.totalCount.set(3);
      load([coffee, rent, tea]);
    });

    it('leaves the list, the count and the totals the moment it is confirmed, and is not deleted yet', fakeAsync(() => {
      expect(component.transactionCount()).withContext('the count, before').toBe('3');

      void component.onDeleteTransaction(rent, list);

      expect(listed()).toEqual(['coffee', 'tea']);
      expect(component.transactionCount()).withContext('the server count, less the row it still holds').toBe('2');
      expect([...periodTotals.exclude()]).withContext('the rows the totals leave out').toEqual(['rent']);
      expect(notices.map(notice => [notice.message, notice.action])).toEqual([['transactions.deleted', 'common.undo']]);
      expect(transactionService.deleteTransaction).not.toHaveBeenCalled();

      tick(UNDO_WINDOW_MS);
    }));

    it('comes back on Undo, heard as restored, with focus offered to it, and is never deleted', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);

      notices[0].press();
      flushMicrotasks();

      expect(listed()).toEqual(['coffee', 'rent', 'tea']);
      expect(component.transactionCount()).toBe('3');
      expect(periodTotals.exclude().size).withContext('the rows the totals leave out').toBe(0);
      expect(announcer.announce).toHaveBeenCalledWith('transactions.restored', 'polite');
      expect(announcer.announce.calls.allArgs().filter(([message]) => message === 'transactions.restored').length)
        .withContext('heard once')
        .toBe(1);
      expect(list.deleteUndone).toHaveBeenCalledOnceWith('rent');
      expect(list.deleteFailed).not.toHaveBeenCalled();

      tick(UNDO_WINDOW_MS);
      expect(transactionService.deleteTransaction).not.toHaveBeenCalled();
    }));

    it('is deleted once, as the window runs out', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);

      tick(UNDO_WINDOW_MS - 1);
      expect(transactionService.deleteTransaction).not.toHaveBeenCalled();

      tick(1);
      flushMicrotasks();
      expect(transactionService.deleteTransaction).toHaveBeenCalledOnceWith('rent');
      expect(notices[0].dismissCalls).withContext('the notice, taken down').toBe(1);

      tick(UNDO_WINDOW_MS);
      expect(transactionService.deleteTransaction).toHaveBeenCalledTimes(1);
      expect(list.deleteUndone).not.toHaveBeenCalled();
      expect(list.deleteFailed).not.toHaveBeenCalled();
    }));

    it('leaves the count while its delete waits, even once the window has let it go', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);

      // A scroll trimmed the window past the row, or a jump re-seeded it
      // elsewhere: the row is still on the server, under the same filters.
      load([coffee, tea]);
      expect(component.transactionCount()).withContext('a server count that still holds it').toBe('2');

      tick(UNDO_WINDOW_MS);
    }));

    it('stays hidden while its delete waits, even through a window that left it out for a while', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);

      // Another filter, whose rows and server count do not hold the row.
      component.onFiltersChanged({ type: 'income' });
      windowSource.totalCount.set(2);
      load([coffee, tea]);
      expect(component.transactionCount()).withContext('a server count that never held it').toBe('2');

      // And back.
      component.onFiltersChanged({});
      windowSource.totalCount.set(3);
      load([coffee, rent, tea]);
      expect(listed()).toEqual(['coffee', 'tea']);
      expect([...periodTotals.exclude()]).toEqual(['rent']);
      expect(component.transactionCount()).toBe('2');

      tick(UNDO_WINDOW_MS);
    }));

    it('stays hidden after its delete through a refresh that failed, and is let go once the window lacks it', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);
      tick(UNDO_WINDOW_MS);
      flushMicrotasks();
      expect(transactionService.deleteTransaction).toHaveBeenCalledOnceWith('rent');

      // The refresh that would take the row out failed: the window and the
      // server count still hold it.
      emitMutation({ kind: 'delete', id: 'rent' });
      fixture.detectChanges();
      tick();
      expect(windowSource.refresh).toHaveBeenCalled();
      expect(listed()).toEqual(['coffee', 'tea']);
      expect(component.transactionCount()).toBe('2');
      expect([...periodTotals.exclude()]).toEqual(['rent']);

      // The next refresh lands without it.
      windowSource.totalCount.set(2);
      load([coffee, tea]);
      expect(periodTotals.exclude().size).withContext('the rows the totals leave out').toBe(0);
      expect(component.transactionCount()).toBe('2');

      // Nothing hides it any more: a window holding it again would list it.
      load([coffee, rent, tea]);
      expect(listed()).toEqual(['coffee', 'rent', 'tea']);
    }));

    it('is made real at once when the page goes', fakeAsync(() => {
      void component.onDeleteTransaction(rent, list);

      fixture.destroy();

      expect(transactionService.deleteTransaction).toHaveBeenCalledOnceWith('rent');
      expect(notices[0].dismissCalls).withContext('the notice, taken down with the page').toBe(1);
      tick(UNDO_WINDOW_MS);
      flushMicrotasks();
      expect(transactionService.deleteTransaction).toHaveBeenCalledTimes(1);
      expect(list.deleteUndone).not.toHaveBeenCalled();
      expect(list.deleteFailed).not.toHaveBeenCalled();
    }));

    it('is made real at once when the page is hidden, not when it shows', fakeAsync(() => {
      const visibility = spyOnProperty(document, 'visibilityState').and.returnValue('visible');
      void component.onDeleteTransaction(rent, list);

      document.dispatchEvent(new Event('visibilitychange'));
      expect(transactionService.deleteTransaction).withContext('shown').not.toHaveBeenCalled();

      visibility.and.returnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(transactionService.deleteTransaction).toHaveBeenCalledOnceWith('rent');

      tick(UNDO_WINDOW_MS);
      flushMicrotasks();
      expect(transactionService.deleteTransaction).toHaveBeenCalledTimes(1);
    }));

    it('comes back with the error notice naming it when its delete fails', fakeAsync(() => {
      transactionService.deleteTransaction.and.rejectWith(new Error('nope'));
      spyOn(console, 'error');
      void component.onDeleteTransaction(rent, list);

      tick(UNDO_WINDOW_MS);
      flushMicrotasks();

      expect(listed()).toEqual(['coffee', 'rent', 'tea']);
      expect(component.transactionCount()).toBe('3');
      expect(periodTotals.exclude().size).withContext('the rows the totals leave out').toBe(0);
      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.deleteFailed');
      expect(console.error).toHaveBeenCalled();
      expect(list.deleteFailed).withContext('the list, told the delete failed').toHaveBeenCalledOnceWith('rent');
      expect(list.deleteUndone).not.toHaveBeenCalled();
    }));

    it('comes back when its delete fails under the next row\'s Undo, which stays up and keeps its own window', fakeAsync(() => {
      transactionService.deleteTransaction.and.callFake((id: string) =>
        id === 'coffee' ? Promise.reject(new Error('nope')) : Promise.resolve()
      );
      spyOn(console, 'error');
      void component.onDeleteTransaction(coffee, list);
      void component.onDeleteTransaction(rent, list);
      flushMicrotasks();

      expect(listed()).withContext('the row whose delete failed, back').toEqual(['coffee', 'tea']);
      expect(list.deleteFailed).toHaveBeenCalledOnceWith('coffee');
      expect(notifications.error).withContext('while the next Undo is up').not.toHaveBeenCalled();
      expect(notices[1].dismissCalls).toBe(0);
      expect(transactionService.deleteTransaction).not.toHaveBeenCalledWith('rent');

      tick(UNDO_WINDOW_MS);
      flushMicrotasks();
      expect(transactionService.deleteTransaction).toHaveBeenCalledWith('rent');
      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.deleteFailed');
    }));
  });

  it('navigateToImportFile delegates to the quick-add service', () => {
    build().componentInstance.navigateToImportFile();
    expect(quickAdd.openImportPhotos).toHaveBeenCalled();
  });

  it('openCameraDialog delegates to the quick-add service', () => {
    build().componentInstance.openCameraDialog();
    expect(quickAdd.openScanReceipt).toHaveBeenCalled();
  });

  it('ngOnDestroy cleans up subscriptions', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});

/**
 * Every case above compiles the page with `{ imports: [], template: '' }`, so
 * the whole header — the part this page is unusual for — has never rendered.
 * The totals are a five-arm `@switch` rendered twice, once for the desktop
 * actions row and once for the mobile subtitle line, behind a viewport gate
 * whose contract is stated in the template itself: *never both, never
 * neither* (`transactions.component.html:65-68`). Nothing has ever checked
 * that contract holds.
 *
 * Partial render: the list and the insight chips are left unresolved, and
 * the filters are a stub that only carries their inputs. Each has its own
 * spec; of the three, only what the page hands the filters is asserted here.
 */
describe('TransactionsComponent, through its own template', () => {
  let fixture: ComponentFixture<TransactionsComponent>;
  let component: TransactionsComponent;
  let totals: ReturnType<typeof createMockPeriodTotals>;
  let windowMock: ReturnType<typeof createMockWindowSource>;
  let quickAddSpy: jasmine.SpyObj<QuickAddService>;
  let viewport$: BehaviorSubject<BreakpointState>;
  let earliestRead: jasmine.Spy;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const mobile = (matches: boolean) => {
    viewport$.next({ matches, breakpoints: { [APP_BREAKPOINTS.mobile]: matches } });
    fixture.detectChanges();
  };

  function render(): void {
    fixture = TestBed.createComponent(TransactionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** The add menu renders into the CDK overlay, outside the fixture. */
  function openAddMenu(): HTMLElement {
    (el().querySelector('.add-fab') as HTMLButtonElement).click();
    fixture.detectChanges();
    return document.querySelector('.mat-mdc-menu-panel') as HTMLElement;
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  beforeEach(async () => {
    windowMock = createMockWindowSource();
    totals = createMockPeriodTotals();
    viewport$ = new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} });
    quickAddSpy = jasmine.createSpyObj('QuickAddService', [
      'openAddTransaction', 'openScanReceipt', 'openImportPhotos',
    ]);
    earliestRead = jasmine.createSpy('getEarliestTransactionDateFromServer').and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [TransactionsComponent],
      providers: [
        {
          provide: TransactionService,
          useValue: {
            transactions: signal<Transaction[]>([]),
            isLoading: signal(false),
            lastMutation: signal<TransactionMutation | null>(null),
            deleteTransaction: jasmine.createSpy('deleteTransaction').and.resolveTo(undefined),
            getTransactionOnce: jasmine.createSpy('getTransactionOnce').and.resolveTo(null),
            getEarliestTransactionDateFromServer: earliestRead,
          },
        },
        {
          provide: CategoryService,
          useValue: {
            expenseCategories: signal<unknown[]>([]),
            incomeCategories: signal<unknown[]>([]),
            categories: signal([createCategory({ id: 'c1' })]),
            loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
          },
        },
        { provide: AuthService, useValue: { currentUser: signal<User | null>({ preferences: { baseCurrency: 'USD' } } as User) } },
        { provide: CurrencyService, useValue: { formatCurrency: (value: number, code: string) => `${code} ${value}` } },
        {
          provide: LocaleFormatService,
          useValue: { formatRange: jasmine.createSpy('formatRange').and.returnValue('RANGE') },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', { open: { afterClosed: () => of(undefined) } }) },
        { provide: QuickAddService, useValue: quickAddSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: { get: () => null } },
            queryParams: new Subject<Record<string, string>>().asObservable(),
          },
        },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY }) },
        { provide: BreakpointObserver, useValue: { observe: () => viewport$.asObservable() } },
        provideNoMotion(),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(TransactionsComponent, {
        set: {
          imports: [
            PageHeaderComponent,
            MatButtonModule,
            MatIconModule,
            MatMenuModule,
            LoadingSpinnerComponent,
            FitTextDirective,
            TranslatePipe,
            TransactionFiltersStubComponent,
          ],
          // A standalone component's template is governed by its own schemas,
          // not the TestBed's: the list and the insight chips are left
          // unresolved and are never asserted about here.
          schemas: [NO_ERRORS_SCHEMA],
          // This override replaces the component's own providers array, so
          // every page-provided service needs its mock listed here.
          providers: [
            { provide: TransactionWindowService, useValue: windowMock },
            { provide: PeriodTotalsService, useValue: totals },
          ],
        },
      })
      .compileComponents();
  });

  it('counts the transactions beside the page title', () => {
    windowMock.totalCount.set(37);
    render();

    expect(text('[header-title-suffix]')).toBe(`(${component.transactionCount()})`);
    // The count clears AA on --text-muted; a Tailwind gray utility measured
    // under it on both themes' page-header background.
    expect(el().querySelector('[header-title-suffix]')?.classList.contains('transaction-count'))
      .toBeTrue();
  });

  it('shows the spinner instead of the list while the first window loads', () => {
    windowMock.isInitialLoading.set(true);
    render();

    expect(el().querySelector('app-loading-spinner')).not.toBeNull();
    expect(el().querySelector('app-transaction-list')).toBeNull();

    windowMock.isInitialLoading.set(false);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).toBeNull();
    expect(el().querySelector('app-transaction-list')).not.toBeNull();
  });

  it('puts the add affordance in exactly one place at each width', () => {
    // The template's own contract: the desktop FAB and the mobile subtitle
    // line are the two halves of one viewport gate — never both, never
    // neither. The bottom-nav FAB covers add below 600px.
    render();
    expect(el().querySelector('.add-fab')).not.toBeNull();

    mobile(true);

    expect(el().querySelector('.add-fab')).toBeNull();
  });

  it('shows nothing where the totals go while they are idle', () => {
    render();

    expect(el().querySelector('.period-totals')).toBeNull();
    expect(el().querySelector('.period-totals-placeholder')).toBeNull();
    expect(el().querySelector('.period-totals-note')).toBeNull();
    expect(el().querySelector('.period-totals-calc')).toBeNull();
  });

  it('holds a placeholder rather than a stale figure while computing', () => {
    render();
    totals.status.set({ kind: 'computing' });
    fixture.detectChanges();

    const placeholder = el().querySelector('.period-totals-placeholder') as HTMLElement;
    expect(placeholder).not.toBeNull();
    // Decorative: a screen reader is told nothing rather than "blank".
    expect(placeholder.getAttribute('aria-hidden')).toBe('true');
    expect(el().querySelector('.period-totals')).toBeNull();
  });

  it('renders the exact figures once a fold is ready', () => {
    render();
    totals.totals.set({ expense: 120, income: 400, balance: 280 } as TypeTotals);
    totals.status.set({ kind: 'ready' });
    fixture.detectChanges();

    const figures = Array.from(el().querySelectorAll('.period-totals-figure')) as HTMLElement[];
    expect(figures.length).toBe(2);
    expect(figures.map(f => f.querySelector('dt')?.textContent?.trim()))
      .toEqual(['common.totalExpenses', 'common.netBalance']);
    expect(figures[0].querySelector('dd')?.textContent?.trim()).toBe('USD 120');
  });

  it('stays on the placeholder when a ready status carries no fold', () => {
    // A sweep invalidated between the status settling and the template
    // reading it must never print a figure.
    render();
    totals.totals.set(null);
    totals.status.set({ kind: 'ready' });
    fixture.detectChanges();

    expect(el().querySelector('.period-totals')).toBeNull();
    expect(el().querySelector('.period-totals-placeholder')).not.toBeNull();
  });

  it('says the totals are unavailable rather than printing a zero', () => {
    render();
    totals.status.set({ kind: 'unavailable' });
    fixture.detectChanges();

    expect(text('.period-totals-note')).toBe('transactions.totalsUnavailable');
    expect(el().querySelector('.period-totals')).toBeNull();
  });

  it('asks before sweeping when the range is over the cap', () => {
    render();
    totals.status.set({ kind: 'over-cap' } as PeriodTotalsStatus);
    fixture.detectChanges();

    const ask = el().querySelector('.period-totals-calc') as HTMLButtonElement;
    expect(ask.textContent?.trim()).toBe('transactions.calculateTotals');

    const calculate = spyOn(component, 'onCalculateTotals');
    ask.click();
    expect(calculate).toHaveBeenCalled();
  });

  it('moves the figures onto the subtitle line on a phone', () => {
    render();
    totals.totals.set({ expense: 120, income: 400, balance: 280 } as TypeTotals);
    totals.status.set({ kind: 'ready' });
    mobile(true);

    expect(el().querySelector('.period-totals')).toBeNull();
    const line = el().querySelector('.period-totals-line') as HTMLElement;
    expect(line).not.toBeNull();
    expect(Array.from(line.querySelectorAll('.period-figure-label')).map(n => n.textContent?.trim()))
      .toEqual(['common.totalExpenses', 'common.netBalance']);
  });

  it('captions the phone figures only when the filter carries both bounds', () => {
    // An open-ended or show-all set has no honest range caption, and the
    // figures are still correct without one.
    render();
    totals.totals.set({ expense: 120, income: 400, balance: 280 } as TypeTotals);
    totals.status.set({ kind: 'ready' });
    mobile(true);
    expect(el().querySelector('.period-caption')).toBeNull();

    component.onFiltersChanged({
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-03-31'),
    } as never);
    fixture.detectChanges();

    expect(text('.period-caption')).toBe('RANGE');
  });

  it('keeps the subtitle line out entirely while the totals are hidden', () => {
    render();
    mobile(true);

    expect(el().querySelector('.period-totals-line')).toBeNull();
  });

  /**
   * The phone's line wraps between its parts, and a dot separates each part
   * from the next. Each dot was a part of its own, so a wrap could fall
   * before it: at 320px the second line read "· Net Balance". The line is
   * read here as a reader sees it: a dot that shows stands after a part on
   * its own line, never first on one, and nothing runs past the line's end.
   * A dot drawn outside the line's box, where the line clips it, shows
   * nowhere. The face is pinned, as Karma serves none.
   *
   * What the clip cuts is read by hit testing, which Chrome clips where it
   * clips painting: a clip margin the browser does not apply still reads
   * back from getComputedStyle, so a declared value proves nothing.
   */
  describe("the phone's totals line, wrapped", () => {
    const RANGES = { en: 'Mar 1 – 31, 2026', ja: '2026年3月1日～31日', tc: '2026年3月1日至31日' } as const;
    /** A 320px screen's page: less the main container's 8px scrollbar and the layout's 16px gutter a side. */
    const PHONE_PAGE_PX = 320 - 8 - 2 * 16;
    /** The app's focus outline at its widest, under high contrast: 2px out and 3px wide. */
    const OUTLINE_OFFSET_PX = 2;
    const OUTLINE_WIDTH_PX = 3;

    /** The page laid out as on a phone, its gutter kept, so the room before the line is inside the window. */
    function phonePage(): HTMLElement {
      const host = el();
      host.style.display = 'block';
      host.style.width = `${PHONE_PAGE_PX}px`;
      host.style.marginInlineStart = '16px';
      host.style.fontFamily = "Verdana, 'DejaVu Sans', sans-serif";
      return host;
    }

    /**
     * Brings the page's host to the window's top, or as near as the page
     * scrolls, once its line is laid out. A full run stands jasmine's report
     * above the fixture, as tall as the specs before made it, and leaves the
     * page wherever they scrolled it; this file alone stands it near the top.
     * Each case puts the page's scroll back where it found it.
     */
    function intoTheWindow(): void {
      el().scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }
    keepThePageWhereFound();

    /**
     * Runs `body` with `px` of page standing above the fixture, as a full run
     * stands jasmine's report there, which this file alone does not. The
     * spacer goes on the page before `body` renders, so the fixture lands
     * below it, and comes off when `body` ends.
     */
    function withPageAbove(px: number, body: () => void): void {
      const spacer = document.body.appendChild(document.createElement('div'));
      spacer.style.height = `${px}px`;
      try {
        body();
      } finally {
        spacer.remove();
      }
    }

    /** The element a pointer reaches at a point inside the window. */
    function reached(x: number, y: number): Element | null {
      expect(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)
        .withContext(`the point (${Math.round(x)}, ${Math.round(y)}), inside the window`)
        .toBeTrue();
      return document.elementFromPoint(x, y);
    }

    function renderLine(l: 'en' | 'ja' | 'tc', captioned: boolean): HTMLElement {
      TestBed.overrideProvider(TranslationService, { useValue: catalogTranslationStub(l) });
      render();
      phonePage();
      totals.totals.set({ expense: 1234.56, income: 4000, balance: 2765.44 } as TypeTotals);
      totals.status.set({ kind: 'ready' });
      if (captioned) {
        (TestBed.inject(LocaleFormatService).formatRange as jasmine.Spy).and.returnValue(RANGES[l]);
        component.onFiltersChanged({ startDate: new Date('2026-03-01'), endDate: new Date('2026-03-31') } as never);
      }
      mobile(true);
      const line = el().querySelector('.period-totals-line') as HTMLElement;
      expect(line).withContext('the subtitle line').not.toBeNull();
      return line;
    }

    /** Whether two boxes stand on one line: they share most of their height. */
    const oneLine = (a: DOMRect, b: DOMRect) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;

    function expectNoDotLeads(line: HTMLElement, where: string): void {
      intoTheWindow();
      const edges = line.getBoundingClientRect();
      const parts = Array.from(line.querySelectorAll<HTMLElement>('.period-caption, .period-figure')).map(part => part.getBoundingClientRect());
      const dotEls = Array.from(line.querySelectorAll<HTMLElement>('.period-sep'));
      const dots = dotEls.map(dot => dot.getBoundingClientRect());
      expect(dots.length).withContext(`${where}: dots, one between each two parts at least`).toBeGreaterThanOrEqual(parts.length - 1);

      const lineTops = parts.map(part => part.top).sort((a, b) => a - b).filter((top, i, all) => i === 0 || top - all[i - 1] > 4);
      expect(lineTops.length).withContext(`${where}: the lines the parts stand on, so the line does wrap`).toBeGreaterThan(1);

      for (const [i, part] of parts.entries()) {
        expect(part.right).withContext(`${where}: part ${i + 1}'s end against the line's`).toBeLessThanOrEqual(edges.right + 0.5);
        expect(part.left).withContext(`${where}: part ${i + 1}'s start against the line's`).toBeGreaterThanOrEqual(edges.left - 0.5);
      }
      for (const [i, dot] of dots.entries()) {
        const middle = (dot.top + dot.bottom) / 2;
        const shown = dot.right > edges.left + 0.5 && dot.left < edges.right - 0.5;
        if (!shown) {
          // Its edge nearest the line, where a clip that let any of it show would.
          const nearest = dot.right <= edges.left + 0.5 ? dot.right - 0.5 : dot.left + 0.5;
          const hit = reached(nearest, middle);
          expect(hit !== null && dotEls[i].contains(hit))
            .withContext(`${where}: dot ${i + 1}, outside the line, reached at its edge nearest the line`)
            .toBeFalse();
          continue;
        }
        const hit = reached((dot.left + dot.right) / 2, middle);
        expect(hit !== null && dotEls[i].contains(hit)).withContext(`${where}: dot ${i + 1}, shown, reached at its middle`).toBeTrue();
        expect(dot.right).withContext(`${where}: dot ${i + 1}'s end against the line's`).toBeLessThanOrEqual(edges.right + 0.5);
        expect(parts.some(part => oneLine(part, dot) && part.right <= dot.left + 0.5))
          .withContext(`${where}: dot ${i + 1}, shown at [${Math.round(dot.left)}, ${Math.round(dot.top)}], after a part on its line`)
          .toBeTrue();
      }
    }

    for (const l of ['en', 'ja', 'tc'] as const) {
      it(`starts no line with a dot at a 320px page, the range before the figures, in ${l}`, () => {
        const line = renderLine(l, true);
        // Narrow enough at 320px that the range and the figures take more than one line.
        expectNoDotLeads(line, `${l} at 320px`);
      });

      // The width at which a part fits its line and the dot after it does
      // not: the line is the first figure's width and 6px more, under the
      // 8px gap and the dot that follow it.
      it(`starts no line with a dot where the first figure fills its line, in ${l}`, () => {
        const line = renderLine(l, false);
        const first = line.querySelector('.period-figure') as HTMLElement;
        line.style.width = `${first.getBoundingClientRect().width + 6}px`;
        expectNoDotLeads(line, `${l}, the line as wide as the first figure`);
      });
    }

    it('reads its line inside the window with 3000px of page above the fixture', () => {
      withPageAbove(3000, () => expectNoDotLeads(renderLine('en', true), 'en at 320px, 3000px down the page'));
    });

    /**
     * A line clips what stands outside it, so an action at either end of a
     * line must keep the app's focus outline inside the clip. An outline is
     * not hit-tested, so a probe laid over the band it is drawn in stands in
     * for it: reached at the band's outer edge, the outline is painted whole
     * on that side.
     */
    function expectOutlineBandReached(action: HTMLElement, side: 'start' | 'end', where: string): void {
      const band = document.createElement('span');
      band.style.position = 'absolute';
      band.style.insetBlock = '0';
      band.style.setProperty(`inset-inline-${side}`, `-${OUTLINE_OFFSET_PX + OUTLINE_WIDTH_PX}px`);
      band.style.inlineSize = `${OUTLINE_WIDTH_PX}px`;
      band.style.zIndex = '1';
      action.appendChild(band);
      const box = action.getBoundingClientRect();
      const outer = side === 'start'
        ? box.left - OUTLINE_OFFSET_PX - OUTLINE_WIDTH_PX + 0.5
        : box.right + OUTLINE_OFFSET_PX + OUTLINE_WIDTH_PX - 0.5;
      expect(reached(outer, (box.top + box.bottom) / 2))
        .withContext(`${where}: the outline's ${side} side, reached at its outer edge`)
        .toBe(band);
      band.remove();
    }

    // Each outline case runs as this file stands its fixture, near the top,
    // and again with 3000px of page above it, where only the case's own
    // scroll brings its points inside the window.
    for (const above of [0, 3000] as const) {
      const where = above ? `, with ${above}px of page above the fixture` : '';

      // With no range, Calculate is the line's one part, so it starts the line.
      it(`keeps the whole focus outline of an action that starts the line, and its tap overhang${where}`, () => {
        withPageAbove(above, () => {
          TestBed.overrideProvider(TranslationService, { useValue: catalogTranslationStub('en') });
          render();
          phonePage();
          totals.status.set({ kind: 'over-cap', serverCount: 1200 } as PeriodTotalsStatus);
          mobile(true);

          const line = el().querySelector('.period-totals-line') as HTMLElement;
          const action = line.querySelector('.period-totals-calc-link') as HTMLElement;
          intoTheWindow();
          const box = action.getBoundingClientRect();
          expect(box.left).withContext('Calculate, first on the line').toBeCloseTo(line.getBoundingClientRect().left, 0);
          expectOutlineBandReached(action, 'start', 'Calculate, first on the line');

          // The 40px tap target overhangs the line above and below: the clip
          // leaves it whole.
          const overhang = (40 - box.height) / 2;
          const middle = (box.left + box.right) / 2;
          for (const [what, y] of [['above', box.top - overhang + 0.5], ['below', box.bottom + overhang - 0.5]] as const) {
            const hit = reached(middle, y);
            expect(hit !== null && action.contains(hit)).withContext(`Calculate's tap target, reached ${what} the line`).toBeTrue();
          }
        });
      });

      // Retry ends the unavailable part, and a line as wide as that part ends with it.
      it(`keeps the whole focus outline of an action that ends the line${where}`, () => {
        withPageAbove(above, () => {
          TestBed.overrideProvider(TranslationService, { useValue: catalogTranslationStub('en') });
          render();
          phonePage();
          totals.status.set({ kind: 'unavailable' });
          mobile(true);

          const line = el().querySelector('.period-totals-line') as HTMLElement;
          const action = line.querySelector('.period-totals-retry-link') as HTMLElement;
          line.style.width = `${Math.ceil(action.getBoundingClientRect().right - line.getBoundingClientRect().left)}px`;
          intoTheWindow();
          const box = action.getBoundingClientRect();
          const edges = line.getBoundingClientRect();
          expect(edges.right - box.right).withContext('Retry, last on the line, px before its end').toBeLessThan(1);
          expect(box.top).withContext('Retry, still on the first line').toBeLessThan(edges.top + box.height / 2);
          expectOutlineBandReached(action, 'end', 'Retry, last on the line');
        });
      });
    }
  });

  // The phone's two actions read as words in the subtitle line, so their box
  // is the text's, about 21 px tall; a tap needs the app's 40 px floor.
  const inlineActions: [PeriodTotalsStatus, string][] = [
    [{ kind: 'unavailable' }, '.period-totals-retry-link'],
    [{ kind: 'over-cap', serverCount: 1200 }, '.period-totals-calc-link'],
  ];
  for (const [status, selector] of inlineActions) {
    it(`gives the phone's ${selector} a 40 px tap target without growing the line`, () => {
      render();
      totals.status.set(status);
      mobile(true);

      const action = el().querySelector(selector) as HTMLElement;
      const box = action.getBoundingClientRect();
      const overhang = getComputedStyle(action, '::after');
      const px = (value: string) => parseFloat(value) || 0;
      expect(overhang.position).withContext('an overhang laid over the link').toBe('absolute');
      expect(box.height - px(overhang.top) - px(overhang.bottom)).toBeGreaterThanOrEqual(40);
      expect(box.width - px(overhang.left) - px(overhang.right)).toBeGreaterThanOrEqual(40);
      expect(box.height).withContext('the visible box stays the text\'s').toBeLessThan(40);
    });
  }

  // A failed count or sweep is not the last word: Retry recounts in place, in
  // whichever placement the width puts the totals.
  for (const placement of ['desktop', 'phone'] as const) {
    describe(`Retry on unavailable totals (${placement})`, () => {
      const retryButton = () =>
        el().querySelector(
          placement === 'phone' ? '.period-totals-retry-link' : '.period-totals-retry'
        ) as HTMLButtonElement | null;
      const totalsLine = () =>
        el().querySelector(
          placement === 'phone' ? '.period-totals-line' : '.period-totals-slot'
        ) as HTMLElement | null;
      const announcer = () => TestBed.inject(AnnouncerService) as jasmine.SpyObj<AnnouncerService>;

      function renderUnavailable(): void {
        render();
        totals.status.set({ kind: 'unavailable' });
        mobile(placement === 'phone');
      }

      function settleReadyOnRetry(): void {
        totals.retry.and.callFake(async () => {
          totals.totals.set({ expense: 120, income: 400, balance: 280 } as TypeTotals);
          totals.status.set({ kind: 'ready' });
          return true;
        });
      }

      // The page's effects run in the Angular zone. Ticked from outside it,
      // leaving their run empties the zone and the zone scheduler starts a
      // tick inside this one (NG0101, only logged); tickInZone in
      // core/services/testing/axe.ts says the same.
      const tickInZone = () => TestBed.inject(NgZone).run(() => TestBed.tick());

      afterEach(() => (document.activeElement as HTMLElement | null)?.blur());

      it('offers Retry beside the unavailable note', () => {
        renderUnavailable();

        expect(retryButton()?.textContent?.trim()).toBe('common.retry');
        expect(totalsLine()?.textContent).toContain('transactions.totalsUnavailable');
      });

      it('calls onRetryTotals on a click', () => {
        renderUnavailable();
        const retry = spyOn(component, 'onRetryTotals');

        retryButton()!.click();

        expect(retry).toHaveBeenCalled();
      });

      it('announces the settled line once the recount lands', async () => {
        renderUnavailable();
        settleReadyOnRetry();

        await component.onRetryTotals();

        expect(totals.retry).toHaveBeenCalled();
        expect(announcer().announce).toHaveBeenCalledOnceWith(
          'transactions.totalsAnnouncement:{"spent":"USD 120","net":"USD 280"}',
          'polite',
          'replace'
        );
      });

      it('moves focus to the totals line once the settled line renders', async () => {
        renderUnavailable();
        settleReadyOnRetry();
        // The button the viewer pressed leaves with the unavailable state.
        retryButton()!.focus();

        await component.onRetryTotals();
        tickInZone();

        expect(retryButton()).toBeNull();
        const line = totalsLine()!;
        expect(line.getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement).toBe(line);
      });

      it('leaves focus where the viewer put it while the recount was out', async () => {
        renderUnavailable();
        settleReadyOnRetry();
        const elsewhere = document.body.appendChild(document.createElement('button'));
        try {
          elsewhere.focus();

          await component.onRetryTotals();
          tickInZone();

          expect(document.activeElement).toBe(elsewhere);
        } finally {
          elsewhere.remove();
        }
      });

      it('stays silent and leaves focus alone when the recount was superseded', async () => {
        renderUnavailable();
        totals.retry.and.resolveTo(false);

        await component.onRetryTotals();
        tickInZone();

        expect(announcer().announce).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(totalsLine());
      });
    });
  }

  it('says the totals are still unavailable when the recount fails again', async () => {
    render();
    totals.status.set({ kind: 'unavailable' });
    fixture.detectChanges();
    totals.retry.and.resolveTo(true);

    await component.onRetryTotals();

    expect((TestBed.inject(AnnouncerService) as jasmine.SpyObj<AnnouncerService>).announce)
      .toHaveBeenCalledOnceWith('transactions.totalsUnavailable', 'polite', 'replace');
  });

  it('neither announces nor throws when the page goes before the recount lands', async () => {
    render();
    totals.status.set({ kind: 'unavailable' });
    fixture.detectChanges();
    let land!: (landed: boolean) => void;
    totals.retry.and.returnValue(new Promise<boolean>(resolve => (land = resolve)));

    const pending = component.onRetryTotals();
    fixture.destroy();
    land(true);

    await expectAsync(pending).toBeResolved();
    expect((TestBed.inject(AnnouncerService) as jasmine.SpyObj<AnnouncerService>).announce)
      .not.toHaveBeenCalled();
  });

  describe('the filters\' picker floor', () => {
    const filtersFloor = async () => {
      render();
      await fixture.whenStable();
      fixture.detectChanges();
      const filters = fixture.debugElement.query(By.directive(TransactionFiltersStubComponent))
        .componentInstance as TransactionFiltersStubComponent;
      return filters.floor();
    };

    it('hands the filters the date of the oldest row', async () => {
      const oldest = new Date(2024, 11, 5, 12);
      earliestRead.and.resolveTo(oldest);

      expect(await filtersFloor()).toEqual(oldest);
    });

    it('floors an account with no rows at the current year', async () => {
      earliestRead.and.resolveTo(null);

      expect(await filtersFloor()).toEqual(new Date(new Date().getFullYear(), 0, 1));
    });

    it('gives the filters no floor when the read fails', async () => {
      // A pin: null is also the floor the page and the stub hold before any
      // read lands, so this only catches an error path that sets a floor.
      earliestRead.and.rejectWith(new Error('unavailable'));

      expect(await filtersFloor()).toBeNull();
    });
  });

  it('offers all three add entries from the desktop menu', () => {
    render();

    const panel = openAddMenu();
    const items = Array.from(panel.querySelectorAll('button[mat-menu-item]')) as HTMLButtonElement[];
    expect(items.map(b => b.textContent?.trim())).toEqual([
      'addtransactions.addTransaction',
      'photo_cameraimport.importFromCamera',
      'upload_fileimport.importFromFile',
    ]);

    items[1].click();
    expect(quickAddSpy.openScanReceipt).toHaveBeenCalled();
  });
});
