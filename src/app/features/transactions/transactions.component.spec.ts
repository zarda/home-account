import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { TransactionsComponent } from './transactions.component';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { DeviceService } from '../../core/services/device.service';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { CameraCaptureComponent } from './camera-capture/camera-capture.component';
import { Transaction } from '../../models';
import { createTransaction, createCategory } from '../../core/services/testing';

describe('TransactionsComponent', () => {
  let transactionService: {
    transactions: ReturnType<typeof signal<Transaction[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    getTransactions: jasmine.Spy;
    deleteTransaction: jasmine.Spy;
  };
  let categoryService: {
    expenseCategories: ReturnType<typeof signal<unknown[]>>;
    incomeCategories: ReturnType<typeof signal<unknown[]>>;
    categories: ReturnType<typeof signal<ReturnType<typeof createCategory>[]>>;
    loadCategories: jasmine.Spy;
  };
  let dialog: jasmine.SpyObj<MatDialog>;
  let router: jasmine.SpyObj<Router>;
  let queryParams$: Subject<Record<string, string>>;
  let routeSnapshotParams: Record<string, string>;

  function build() {
    const fixture = TestBed.createComponent(TransactionsComponent);
    return fixture;
  }

  beforeEach(async () => {
    transactionService = {
      transactions: signal<Transaction[]>([]),
      isLoading: signal(false),
      getTransactions: jasmine.createSpy('getTransactions').and.returnValue(of([])),
      deleteTransaction: jasmine.createSpy('deleteTransaction').and.resolveTo(undefined),
    };
    categoryService = {
      expenseCategories: signal<unknown[]>([]),
      incomeCategories: signal<unknown[]>([]),
      categories: signal([createCategory({ id: 'c1' })]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
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
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: activatedRoute },
      ],
    })
      .overrideComponent(TransactionsComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  it('should create', () => {
    expect(build().componentInstance).toBeTruthy();
  });

  it('computes transaction count and categories map', () => {
    const component = build().componentInstance;
    transactionService.transactions.set([createTransaction(), createTransaction()]);
    expect(component.transactionCount()).toBe(2);
    expect(component.categoriesMap().get('c1')?.id).toBe('c1');
  });

  it('ngOnInit loads categories and transactions', () => {
    const fixture = build();
    fixture.detectChanges();
    expect(categoryService.loadCategories).toHaveBeenCalled();
    expect(transactionService.getTransactions).toHaveBeenCalled();
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

  it('onFiltersChanged re-subscribes with the new filters', () => {
    const component = build().componentInstance;
    transactionService.getTransactions.calls.reset();
    component.onFiltersChanged({ type: 'expense' });
    expect(transactionService.getTransactions).toHaveBeenCalledWith({ type: 'expense' });
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
