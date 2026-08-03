import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { of, firstValueFrom } from 'rxjs';
import { BudgetService } from './budget.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { CurrencyService } from './currency.service';
import { Budget, Transaction } from '../../models';
import { dayKey } from '../utils/transaction-date.utils';

describe('BudgetService', () => {
  let service: BudgetService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;

  // All three budgets anchor on day 1, so "fresh" means stamped with the
  // first of the current real month — the freshen path then passes them
  // through untouched, as it would for a live, up-to-date document.
  const freshStamp = dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const mockBudgets: Budget[] = [
    {
      id: 'budget1',
      userId: 'user123',
      categoryId: 'cat1',
      name: 'Food Budget',
      amount: 500,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      spent: 250,
      spentPeriod: freshStamp,
      isActive: true,
      alertThreshold: 80,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date())
    },
    {
      id: 'budget2',
      userId: 'user123',
      categoryId: 'cat2',
      name: 'Transport Budget',
      amount: 200,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      spent: 180,
      spentPeriod: freshStamp,
      isActive: true,
      alertThreshold: 80,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date())
    },
    {
      id: 'budget3',
      userId: 'user123',
      categoryId: 'cat3',
      name: 'Inactive Budget',
      amount: 100,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      spent: 50,
      spentPeriod: freshStamp,
      isActive: false,
      alertThreshold: 80,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date())
    }
  ];

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'subscribeToDocument',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getDocument',
      'dateToTimestamp',
      'getTimestamp'
    ]);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: jasmine.createSpy().and.returnValue('user123'),
      currentUser: jasmine.createSpy().and.returnValue({
        id: 'user123',
        preferences: { baseCurrency: 'USD' }
      })
    });

    mockTransactionService = jasmine.createSpyObj('TransactionService', [
      'getTransactions',
      'getExpensesInRange'
    ]);

    // Default mock returns
    mockFirestoreService.subscribeToCollection.and.returnValue(of(mockBudgets));
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.now());
    mockFirestoreService.dateToTimestamp.and.callFake((date: Date) => Timestamp.fromDate(date));

    TestBed.configureTestingModule({
      providers: [
        BudgetService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: TransactionService, useValue: mockTransactionService }
      ]
    });

    service = TestBed.inject(BudgetService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('sign-out reset', () => {
    it('clears the cached budgets on the signed-out edge', () => {
      // Fresh injector with a signal-backed auth stub: the reset effect
      // tracks userId() reactively, which a jasmine spy cannot express.
      TestBed.resetTestingModule();
      const userId = signal<string | null>('user-1');
      TestBed.configureTestingModule({
        providers: [
          BudgetService,
          { provide: FirestoreService, useValue: {} },
          { provide: TransactionService, useValue: {} },
          { provide: CurrencyService, useValue: {} },
          { provide: AuthService, useValue: { userId } },
        ],
      });
      const fresh = TestBed.inject(BudgetService);
      fresh.budgets.set([{ id: 'b1' } as Budget]);
      TestBed.tick();
      expect(fresh.budgets().length).toBe(1);

      userId.set(null);
      TestBed.tick();

      expect(fresh.budgets()).toEqual([]);
    });
  });

  describe('initial state', () => {
    it('should start with empty budgets array', () => {
      expect(service.budgets()).toEqual([]);
    });

    it('should start with isLoading false', () => {
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('computed signals', () => {
    beforeEach(() => {
      service.budgets.set(mockBudgets);
    });

    it('should compute activeBudgets correctly', () => {
      const active = service.activeBudgets();
      expect(active.length).toBe(2);
      expect(active.every(b => b.isActive)).toBeTrue();
    });

    it('should compute totalBudgetAmount from active budgets', () => {
      expect(service.totalBudgetAmount()).toBe(700); // 500 + 200
    });

    it('should compute totalSpent from active budgets', () => {
      expect(service.totalSpent()).toBe(430); // 250 + 180
    });
  });

  describe('getBudgets', () => {
    it('should return empty array if user not authenticated', (done) => {
      // Need to recreate service with new mock
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          BudgetService,
          { provide: FirestoreService, useValue: mockFirestoreService },
          { provide: AuthService, useValue: { userId: () => null } },
          { provide: TransactionService, useValue: mockTransactionService }
        ]
      });

      const newService = TestBed.inject(BudgetService);

      newService.getBudgets().subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should call firestore with correct path', () => {
      service.getBudgets().subscribe();

      expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(
        'users/user123/budgets',
        { orderBy: [{ field: 'name', direction: 'asc' }] }
      );
    });

    it('should update budgets signal with received data', (done) => {
      service.getBudgets().subscribe(() => {
        expect(service.budgets()).toEqual(mockBudgets);
        done();
      });
    });
  });

  describe('createBudget', () => {
    it('should set isLoading to true during creation', async () => {
      mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-budget-id'));

      const createPromise = service.createBudget({
        categoryId: 'cat1',
        name: 'New Budget',
        amount: 300,
        currency: 'USD',
        period: 'monthly'
      });

      // isLoading should be true during the operation
      // Note: This is hard to test in practice due to timing

      await createPromise;
      expect(service.isLoading()).toBeFalse();
    });

    it('should call firestore addDocument with correct data', async () => {
      mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-budget-id'));

      await service.createBudget({
        categoryId: 'cat1',
        name: 'New Budget',
        amount: 300,
        currency: 'USD',
        period: 'monthly'
      });

      expect(mockFirestoreService.addDocument).toHaveBeenCalled();
      const callArgs = mockFirestoreService.addDocument.calls.mostRecent();
      const [path, data] = callArgs.args;
      expect(path).toBe('users/user123/budgets');
      expect(data['categoryId']).toBe('cat1');
      expect(data['name']).toBe('New Budget');
      expect(data['amount']).toBe(300);
      expect(data['spent']).toBe(0);
      expect(data['isActive']).toBeTrue();
    });

    it('should return the new budget id', async () => {
      mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-budget-id'));

      const id = await service.createBudget({
        categoryId: 'cat1',
        name: 'New Budget',
        amount: 300,
        currency: 'USD',
        period: 'monthly'
      });

      expect(id).toBe('new-budget-id');
    });
  });

  describe('updateBudget', () => {
    it('should call firestore updateDocument with correct path', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.updateBudget('budget1', { amount: 600 });

      expect(mockFirestoreService.updateDocument).toHaveBeenCalled();
      const callArgs = mockFirestoreService.updateDocument.calls.mostRecent();
      const [path] = callArgs.args;
      expect(path).toBe('users/user123/budgets/budget1');
    });

    it('should only include changed fields in update', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.updateBudget('budget1', { amount: 600, name: 'Updated Budget' });

      const callArgs = mockFirestoreService.updateDocument.calls.mostRecent();
      const [, data] = callArgs.args;
      expect(data['amount']).toBe(600);
      expect(data['name']).toBe('Updated Budget');
    });
  });

  describe('deleteBudget', () => {
    it('should call firestore deleteDocument with correct path', async () => {
      mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());

      await service.deleteBudget('budget1');

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1'
      );
    });

    it('should set isLoading to false after deletion', async () => {
      mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());

      await service.deleteBudget('budget1');

      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('deactivateBudget', () => {
    it('should call updateDocument with isActive false', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.deactivateBudget('budget1');

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { isActive: false }
      );
    });
  });

  describe('activateBudget', () => {
    it('should call updateDocument with isActive true', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.activateBudget('budget1');

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { isActive: true }
      );
    });
  });

  describe('checkBudgetAlerts', () => {
    it('should return alerts for budgets over threshold', (done) => {
      const budgetsWithAlerts: Budget[] = [
        {
          ...mockBudgets[0],
          spent: 450 // 90% of 500
        },
        {
          ...mockBudgets[1],
          spent: 210 // 105% of 200
        }
      ];

      mockFirestoreService.subscribeToCollection.and.returnValue(of(budgetsWithAlerts));

      service.checkBudgetAlerts().subscribe(alerts => {
        expect(alerts.length).toBe(2);
        expect(alerts[0].severity).toBe('exceeded');
        expect(alerts[1].severity).toBe('critical');
        done();
      });
    });

    it('should sort alerts by percentUsed descending', (done) => {
      const budgetsWithAlerts: Budget[] = [
        {
          ...mockBudgets[0],
          spent: 400 // 80%
        },
        {
          ...mockBudgets[1],
          spent: 180 // 90%
        }
      ];

      mockFirestoreService.subscribeToCollection.and.returnValue(of(budgetsWithAlerts));

      service.checkBudgetAlerts().subscribe(alerts => {
        expect(alerts.length).toBe(2);
        expect(alerts[0].percentUsed).toBeGreaterThan(alerts[1].percentUsed);
        done();
      });
    });

    it('should not include inactive budgets in alerts', (done) => {
      mockFirestoreService.subscribeToCollection.and.returnValue(of(mockBudgets));

      service.checkBudgetAlerts().subscribe(alerts => {
        // Only the transport budget (90% spent) should trigger alert
        const inactiveAlert = alerts.find(a => a.budgetId === 'budget3');
        expect(inactiveAlert).toBeUndefined();
        done();
      });
    });
  });

  describe('budgetAlerts', () => {
    it('should return no alerts when spending is under the threshold', () => {
      service.budgets.set([{ ...mockBudgets[0], spent: 250 }]); // 50% of 500
      expect(service.budgetAlerts()).toEqual([]);
    });

    it('should return a warning alert at the budget alertThreshold', () => {
      service.budgets.set([{ ...mockBudgets[0], spent: 400 }]); // 80% of 500
      const alerts = service.budgetAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].budgetId).toBe('budget1');
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].remaining).toBe(100);
      expect(alerts[0].percentUsed).toBe(80);
    });

    it('should return a critical alert at 90%', () => {
      service.budgets.set([{ ...mockBudgets[0], spent: 450 }]); // 90% of 500
      expect(service.budgetAlerts()[0].severity).toBe('critical');
    });

    it('should return an exceeded alert with zero remaining when over budget', () => {
      service.budgets.set([{ ...mockBudgets[0], spent: 550 }]); // 110% of 500
      const alerts = service.budgetAlerts();
      expect(alerts[0].severity).toBe('exceeded');
      expect(alerts[0].remaining).toBe(0);
      expect(alerts[0].percentUsed).toBeCloseTo(110, 5);
    });

    it('should exclude inactive budgets', () => {
      service.budgets.set([
        { ...mockBudgets[0], spent: 250 },
        { ...mockBudgets[2], spent: 95 } // 95% of 100 but inactive
      ]);
      expect(service.budgetAlerts()).toEqual([]);
    });

    it('should sort alerts by percentUsed descending', () => {
      service.budgets.set([
        { ...mockBudgets[0], spent: 425 }, // 85% of 500
        { ...mockBudgets[1], spent: 210 } // 105% of 200
      ]);
      const alerts = service.budgetAlerts();
      expect(alerts.length).toBe(2);
      expect(alerts[0].budgetId).toBe('budget2');
      expect(alerts[1].budgetId).toBe('budget1');
    });
  });

  describe('updateBudgetSpent', () => {
    it('should call updateDocument with spent amount', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.updateBudgetSpent('budget1', 350);

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { spent: 350 }
      );
    });

    it('should persist the period stamp beside spent when given', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.updateBudgetSpent('budget1', 350, '2026-08-01');

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { spent: 350, spentPeriod: '2026-08-01' }
      );
    });
  });

  describe('recalculateBudgetSpent', () => {
    beforeEach(() => {
      const currencyService = TestBed.inject(CurrencyService);
      spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
      spyOn(currencyService, 'convert').and.callFake((amount: number) => amount);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(mockBudgets[0]));
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
      mockTransactionService.getExpensesInRange.and.returnValue(of([
        { amount: 100, currency: 'USD' } as Transaction,
        { amount: 50, currency: 'USD' } as Transaction
      ]));
    });

    it('should sum expenses from the non-mutating query and persist spent', async () => {
      await service.recalculateBudgetSpent('budget1');

      expect(mockTransactionService.getExpensesInRange).toHaveBeenCalledWith(
        jasmine.any(Date),
        jasmine.any(Date),
        'cat1'
      );
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { spent: 150, spentPeriod: jasmine.any(String) }
      );
    });

    it('should never run the signal-mutating getTransactions query', async () => {
      // Regression: recalculation used to run getTransactions, whose map()
      // overwrites the shared transactions signal the dashboard summary
      // binds to, leaving it holding one category's budget-period expenses.
      const shared = signal<Transaction[]>([{ id: 'txn-1' } as Transaction]);
      (mockTransactionService as unknown as { transactions: typeof shared }).transactions = shared;

      await service.recalculateBudgetSpent('budget1');

      expect(mockTransactionService.getTransactions).not.toHaveBeenCalled();
      expect(shared()).toEqual([{ id: 'txn-1' } as Transaction]);
    });

    it('should do nothing when the budget does not exist', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      await service.recalculateBudgetSpent('missing');

      expect(mockTransactionService.getExpensesInRange).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    describe('currency of the summed spend', () => {
      const yen = {
        amount: 5000, currency: 'JPY',
        amountInBaseCurrency: 33, exchangeRate: 0.0066, baseCurrency: 'USD'
      } as Transaction;
      const euro = {
        amount: 95, currency: 'EUR',
        amountInBaseCurrency: 103, exchangeRate: 1.0842, baseCurrency: 'USD'
      } as Transaction;

      beforeEach(() => {
        mockTransactionService.getExpensesInRange.and.returnValue(of([yen, euro]));
      });

      it('sums the write-time snapshots when the budget is in the base currency', async () => {
        const convert = TestBed.inject(CurrencyService).convert as jasmine.Spy;
        convert.calls.reset();

        await service.recalculateBudgetSpent('budget1');

        expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
          'users/user123/budgets/budget1',
          { spent: 136, spentPeriod: jasmine.any(String) }
        );
        expect(convert).not.toHaveBeenCalled();
      });

      it('keeps spent stable when live rates move between recalculations', async () => {
        const convert = TestBed.inject(CurrencyService).convert as jasmine.Spy;

        await service.recalculateBudgetSpent('budget1');
        convert.and.callFake((amount: number) => amount * 2);
        await service.recalculateBudgetSpent('budget1');

        const spents = mockFirestoreService.updateDocument.calls.allArgs()
          .map(args => (args[1] as { spent: number }).spent);
        expect(spents).toEqual([136, 136]);
      });

      it('converts once from the snapshot base for a cross-currency budget', async () => {
        const convert = TestBed.inject(CurrencyService).convert as jasmine.Spy;
        convert.and.callFake((amount: number) => amount * 0.9);
        mockFirestoreService.getDocument.and.returnValue(
          Promise.resolve({ ...mockBudgets[0], currency: 'EUR' })
        );
        convert.calls.reset();

        await service.recalculateBudgetSpent('budget1');

        expect(convert).toHaveBeenCalledWith(33, 'USD', 'EUR');
        expect(convert).toHaveBeenCalledWith(103, 'USD', 'EUR');
        expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
          'users/user123/budgets/budget1',
          { spent: 122.4, spentPeriod: jasmine.any(String) }
        );
      });

      it('rounds the persisted spend to cents', async () => {
        mockTransactionService.getExpensesInRange.and.returnValue(of([
          { ...yen, amountInBaseCurrency: 10.111 } as Transaction,
          { ...yen, amountInBaseCurrency: 10.112 } as Transaction
        ]));

        await service.recalculateBudgetSpent('budget1');

        expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
          'users/user123/budgets/budget1',
          { spent: 20.22, spentPeriod: jasmine.any(String) }
        );
      });
    });
  });

  describe('stale spent on period rollover', () => {
    const flush = async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    };

    beforeEach(() => {
      jasmine.clock().install();
      const currencyService = TestBed.inject(CurrencyService);
      spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
      mockTransactionService.getExpensesInRange.and.returnValue(of([
        {
          amount: 25, currency: 'USD',
          amountInBaseCurrency: 25, exchangeRate: 1, baseCurrency: 'USD'
        } as Transaction
      ]));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('shows 0 and recalculates when spent belongs to a previous period', async () => {
      jasmine.clock().mockDate(new Date(2026, 7, 1, 9, 0));
      const stale: Budget = { ...mockBudgets[0], spent: 450, spentPeriod: '2026-07-01' };
      mockFirestoreService.subscribeToCollection.and.returnValue(of([stale]));
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(stale));

      const emitted = await firstValueFrom(service.getBudgets());

      expect(emitted[0].spent).toBe(0);
      expect(service.budgetAlerts()).toEqual([]);

      await flush();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { spent: 25, spentPeriod: '2026-08-01' }
      );
    });

    it('passes spent through untouched inside the stamped period', async () => {
      jasmine.clock().mockDate(new Date(2026, 6, 31, 23, 0));
      const fresh: Budget = { ...mockBudgets[0], spent: 450, spentPeriod: '2026-07-01' };
      mockFirestoreService.subscribeToCollection.and.returnValue(of([fresh]));

      const emitted = await firstValueFrom(service.getBudgets());
      await flush();

      expect(emitted[0].spent).toBe(450);
      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
      expect(service.budgetAlerts().length).toBe(1);
    });

    it('treats a document without a stamp as stale', async () => {
      jasmine.clock().mockDate(new Date(2026, 7, 1, 9, 0));
      const legacy: Budget = { ...mockBudgets[0], spent: 450, spentPeriod: undefined };
      mockFirestoreService.subscribeToCollection.and.returnValue(of([legacy]));
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(legacy));

      const emitted = await firstValueFrom(service.getBudgets());

      expect(emitted[0].spent).toBe(0);
      await flush();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        jasmine.objectContaining({ spentPeriod: '2026-08-01' })
      );
    });

    it('queues one recalculation for rapid consecutive emissions', async () => {
      jasmine.clock().mockDate(new Date(2026, 7, 1, 9, 0));
      const stale: Budget = { ...mockBudgets[0], spent: 450, spentPeriod: '2026-07-01' };
      mockFirestoreService.subscribeToCollection.and.returnValue(of([stale], [stale]));
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(stale));

      const sub = service.getBudgets().subscribe();
      await flush();
      sub.unsubscribe();

      expect(mockFirestoreService.getDocument).toHaveBeenCalledTimes(1);
    });

    it('freshens a single budget read through getBudgetById', async () => {
      jasmine.clock().mockDate(new Date(2026, 7, 1, 9, 0));
      const stale: Budget = { ...mockBudgets[0], spent: 450, spentPeriod: '2026-07-01' };
      mockFirestoreService.subscribeToDocument.and.returnValue(of(stale));
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(stale));

      const emitted = await firstValueFrom(service.getBudgetById('budget1'));

      expect(emitted!.spent).toBe(0);
    });
  });

  describe('budget period boundaries (short-month anchors)', () => {
    const anchor31Budget: Budget = {
      ...mockBudgets[0],
      id: 'budget31',
      startDate: Timestamp.fromDate(new Date(2026, 0, 31))
    };

    beforeEach(() => {
      jasmine.clock().install();
      const currencyService = TestBed.inject(CurrencyService);
      spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
      spyOn(currencyService, 'convert').and.callFake((amount: number) => amount);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(anchor31Budget));
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
      mockTransactionService.getExpensesInRange.and.returnValue(of([]));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    async function recalcWindowAt(today: Date): Promise<{ start: Date; end: Date }> {
      jasmine.clock().mockDate(today);
      mockTransactionService.getExpensesInRange.calls.reset();
      await service.recalculateBudgetSpent('budget31');
      const [start, end] = mockTransactionService.getExpensesInRange.calls.mostRecent().args;
      return { start: start as Date, end: end as Date };
    }

    it('starts a new period on the last day of a short month for a day-31 anchor', async () => {
      const { start, end } = await recalcWindowAt(new Date(2026, 1, 28, 12, 0));

      expect(start).toEqual(new Date(2026, 1, 28));
      expect(end).toEqual(new Date(2026, 2, 30, 23, 59, 59, 999));
    });

    it('keeps the day before the clamped anchor in the previous period', async () => {
      const { start, end } = await recalcWindowAt(new Date(2026, 1, 27, 12, 0));

      expect(start).toEqual(new Date(2026, 0, 31));
      expect(end).toEqual(new Date(2026, 1, 27, 23, 59, 59, 999));
    });

    it('makes period N+1 start exactly 1 ms after period N ends across a short month', async () => {
      const previous = await recalcWindowAt(new Date(2026, 1, 27, 12, 0));
      const next = await recalcWindowAt(new Date(2026, 1, 28, 12, 0));

      expect(next.start.getTime()).toBe(previous.end.getTime() + 1);
    });

    it('leaves a day-1 anchor unchanged mid-month', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(mockBudgets[0]));

      const { start, end } = await recalcWindowAt(new Date(2026, 7, 10, 12, 0));

      expect(start).toEqual(new Date(2026, 7, 1));
      expect(end).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    });
  });

  describe('recalculateBudgetsForCategory', () => {
    it('should recalculate each active budget in the category', async () => {
      const currencyService = TestBed.inject(CurrencyService);
      spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
      spyOn(currencyService, 'convert').and.callFake((amount: number) => amount);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(mockBudgets[0]));
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
      mockTransactionService.getExpensesInRange.and.returnValue(of([]));
      service.budgets.set(mockBudgets);

      await service.recalculateBudgetsForCategory('cat1');

      expect(mockFirestoreService.getDocument).toHaveBeenCalledWith('users/user123/budgets/budget1');
      expect(mockTransactionService.getExpensesInRange).toHaveBeenCalledTimes(1);
    });
  });
});
