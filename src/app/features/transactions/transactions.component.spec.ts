import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of, throwError, Subject } from 'rxjs';
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
import { AnnouncerService } from '../../core/services/announcer.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { Transaction, User } from '../../models';
import { TypeTotals } from '../../core/utils/transaction-aggregation.utils';
import { createTransaction, createCategory } from '../../core/services/testing';

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

function createMockPeriodTotals() {
  return {
    status: signal<PeriodTotalsStatus>({ kind: 'idle' }),
    totals: signal<TypeTotals | null>(null),
    reset: jasmine.createSpy('reset').and.resolveTo(undefined),
    refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
    calculate: jasmine.createSpy('calculate').and.resolveTo(true),
  };
}

describe('TransactionsComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    lastMutation: ReturnType<typeof signal<TransactionMutation | null>>;
    deleteTransaction: jasmine.Spy;
    getTransactionById: jasmine.Spy;
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
  let queryParams$: Subject<Record<string, string>>;
  let routeSnapshotParams: Record<string, string>;
  let mutationSeq: number;

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
      getTransactionById: jasmine.createSpy('getTransactionById').and.returnValue(of(null)),
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
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    quickAdd = jasmine.createSpyObj('QuickAddService', [
      'openAddTransaction',
      'openScanReceipt',
      'openImportPhotos',
    ]);
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
        { provide: AuthService, useValue: { currentUser: authUser } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (value: number, code: string) => `${code} ${value}` }
        },
        {
          provide: LocaleFormatService,
          useValue: { formatRange: jasmine.createSpy('formatRange').and.returnValue('RANGE') }
        },
        { provide: TranslationService, useValue: translation },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info'])
        },
        { provide: AnnouncerService, useValue: announcer },
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: ActivatedRoute, useValue: activatedRoute },
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

  it('onFiltersChanged resets the window and the period totals with the same filters', () => {
    const component = build().componentInstance;
    component.onFiltersChanged({ type: 'expense' });
    expect(windowSource.reset).toHaveBeenCalledWith({ type: 'expense' }, 'desc');
    expect(periodTotals.reset).toHaveBeenCalledWith({ type: 'expense' });
  });

  describe('the tx query param', () => {
    it('opens, scrolls to and edits the transaction named by the tx query param after the first window seed', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-9' });
      transactionService.getTransactionById.and.returnValue(of(txn));
      windowSource.isInLoadedRange.and.returnValue(false);
      routeSnapshotParams = { tx: 'tx-9' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      expect(transactionService.getTransactionById).toHaveBeenCalledWith('tx-9');
      expect(windowSource.jumpTo).toHaveBeenCalledWith(txn.date);
      expect(windowSource.requestScrollTo).toHaveBeenCalledWith('tx-9');
      expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, jasmine.objectContaining({
        data: { mode: 'edit', transaction: txn },
      }));
    }));

    it('keeps the window in place when the target is already in range', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-5' });
      transactionService.getTransactionById.and.returnValue(of(txn));
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
      transactionService.getTransactionById.and.returnValue(of(null));
      routeSnapshotParams = { tx: 'tx-missing' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      const notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
      expect(notifications.info).toHaveBeenCalledWith('import.linkedTransactionGone');
      expect(dialog.open).not.toHaveBeenCalled();
      expect(windowSource.requestScrollTo).not.toHaveBeenCalled();
    }));

    it('toasts a generic error when the linked-transaction fetch rejects', fakeAsync(() => {
      transactionService.getTransactionById.and.returnValue(throwError(() => new Error('offline')));
      routeSnapshotParams = { tx: 'tx-err' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();

      const notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(dialog.open).not.toHaveBeenCalled();
    }));

    it('consumes the tx param once', fakeAsync(() => {
      const txn = createTransaction({ id: 'tx-1' });
      transactionService.getTransactionById.and.returnValue(of(txn));
      routeSnapshotParams = { tx: 'tx-1' };

      const fixture = build();
      fixture.detectChanges();
      fixture.componentInstance.onFiltersChanged({});
      tick();
      expect(dialog.open).toHaveBeenCalledTimes(1);

      dialog.open.calls.reset();
      transactionService.getTransactionById.calls.reset();
      fixture.componentInstance.onFiltersChanged({ type: 'expense' });
      tick();

      expect(transactionService.getTransactionById).not.toHaveBeenCalled();
      expect(dialog.open).not.toHaveBeenCalled();
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

  it('announces the plain result count when totals were never wired for the reset', fakeAsync(() => {
    // The idle branch (e.g. signed out): today's behavior, count only.
    const fixture = build();
    fixture.detectChanges();
    expect(announcer.announce).not.toHaveBeenCalled();

    windowSource.resetSeq.set(1);
    fixture.detectChanges();
    tick();
    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultCountAnnouncement');
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
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultWithTotalsAnnouncement');

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
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultWithTotalsAnnouncement');
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
    expect(announcer.announce).toHaveBeenCalledWith('transactions.totalsAnnouncement');
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

  it('onDeleteTransaction deletes via the service', async () => {
    const component = build().componentInstance;
    await component.onDeleteTransaction(createTransaction({ id: 'x' }));
    expect(transactionService.deleteTransaction).toHaveBeenCalledWith('x');
  });

  it('onDeleteTransaction reports a failed delete instead of swallowing it', async () => {
    transactionService.deleteTransaction.and.rejectWith(new Error('nope'));
    spyOn(console, 'error');
    const component = build().componentInstance;

    await expectAsync(component.onDeleteTransaction(createTransaction())).toBeResolved();

    const notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
    expect(notifications.error).toHaveBeenCalledWith('common.error');
    expect(console.error).toHaveBeenCalled();
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
