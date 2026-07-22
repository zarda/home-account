import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of, Subject } from 'rxjs';
import { TransactionsComponent } from './transactions.component';
import { TransactionService, TransactionMutation } from '../../core/services/transaction.service';
import { TransactionWindowService } from '../../core/services/transaction-window.service';
import { CategoryService } from '../../core/services/category.service';
import { DeviceService } from '../../core/services/device.service';
import { TranslationService } from '../../core/services/translation.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { CameraCaptureComponent } from './camera-capture/camera-capture.component';
import { Transaction } from '../../models';
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

describe('TransactionsComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    lastMutation: ReturnType<typeof signal<TransactionMutation | null>>;
    deleteTransaction: jasmine.Spy;
  };
  let windowSource: ReturnType<typeof createMockWindowSource>;
  let categoryService: {
    expenseCategories: ReturnType<typeof signal<unknown[]>>;
    incomeCategories: ReturnType<typeof signal<unknown[]>>;
    categories: ReturnType<typeof signal<ReturnType<typeof createCategory>[]>>;
    loadCategories: jasmine.Spy;
  };
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let router: jasmine.SpyObj<Router>;
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
    };
    windowSource = createMockWindowSource();
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
    router = jasmine.createSpyObj('Router', ['navigate']);
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
        { provide: DeviceService, useValue: {} },
        { provide: TranslationService, useValue: translation },
        { provide: AnnouncerService, useValue: announcer },
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: activatedRoute },
      ],
    })
      .overrideComponent(TransactionsComponent, {
        set: {
          imports: [],
          template: '',
          providers: [{ provide: TransactionWindowService, useValue: windowSource }],
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
    expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, jasmine.objectContaining({
      data: { mode: 'add' },
    }));
  }));

  it('onFiltersChanged resets the window with the new filters', () => {
    const component = build().componentInstance;
    component.onFiltersChanged({ type: 'expense' });
    expect(windowSource.reset).toHaveBeenCalledWith({ type: 'expense' }, 'desc');
  });

  it('onDateSortChange resets the window only when the direction changes', () => {
    const component = build().componentInstance;
    component.onDateSortChange('desc');
    expect(windowSource.reset).not.toHaveBeenCalled();

    component.onDateSortChange('asc');
    expect(windowSource.reset).toHaveBeenCalledWith({}, 'asc');
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
    }));
  });

  it('announces the result count once per completed window reset', fakeAsync(() => {
    const fixture = build();
    fixture.detectChanges();
    expect(announcer.announce).not.toHaveBeenCalled();

    windowSource.resetSeq.set(1);
    fixture.detectChanges();
    tick();
    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('transactions.resultCountAnnouncement');
  }));

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

  it('onDeleteTransaction swallows errors', async () => {
    transactionService.deleteTransaction.and.rejectWith(new Error('nope'));
    const component = build().componentInstance;
    await expectAsync(component.onDeleteTransaction(createTransaction())).toBeResolved();
  });

  it('navigateToImportFile routes to the import wizard', () => {
    build().componentInstance.navigateToImportFile();
    expect(router.navigate).toHaveBeenCalledWith(['/import/file']);
  });

  it('openCameraDialog opens the camera capture dialog', () => {
    build().componentInstance.openCameraDialog();
    expect(dialog.open).toHaveBeenCalledWith(CameraCaptureComponent, jasmine.any(Object));
  });

  it('ngOnDestroy cleans up subscriptions', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
