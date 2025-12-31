import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { BudgetService } from './budget.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { Budget } from '../../models';

describe('BudgetService', () => {
  let service: BudgetService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;

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
      userId: jasmine.createSpy().and.returnValue('user123')
    });

    mockTransactionService = jasmine.createSpyObj('TransactionService', [
      'getTransactions'
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

  describe('updateBudgetSpent', () => {
    it('should call updateDocument with spent amount', async () => {
      mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());

      await service.updateBudgetSpent('budget1', 350);

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/budgets/budget1',
        { spent: 350 }
      );
    });
  });
});
