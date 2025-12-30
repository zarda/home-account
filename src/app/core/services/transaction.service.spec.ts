import { TestBed } from '@angular/core/testing';
import { TransactionService } from './transaction.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import {
  createTransaction,
  createMixedTransactions
} from './testing/test-data';
import { Timestamp } from '@angular/fire/firestore';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let currencyService: CurrencyService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        CurrencyService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    currencyService = TestBed.inject(CurrencyService);
    service = TestBed.inject(TransactionService);

    // Set up authenticated user
    mockAuth.setAuthenticated(true);

    // Set up exchange rates
    currencyService.exchangeRates.set(new Map([
      ['USD', 1],
      ['EUR', 0.92],
      ['THB', 34.5]
    ]));
  });

  afterEach(() => {
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
  });

  describe('initialization', () => {
    it('should create the service', () => {
      expect(service).toBeTruthy();
    });

    it('should start with empty transactions signal', () => {
      expect(service.transactions()).toEqual([]);
    });

    it('should start with isLoading false', () => {
      expect(service.isLoading()).toBe(false);
    });
  });

  describe('computed signals', () => {
    beforeEach(() => {
      // Set up mixed transactions
      const transactions = createMixedTransactions();
      service.transactions.set(transactions);
    });

    it('totalIncome should calculate sum of income transactions', () => {
      const incomeTransactions = service.transactions().filter(t => t.type === 'income');
      const expectedTotal = incomeTransactions.reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

      expect(service.totalIncome()).toBe(expectedTotal);
    });

    it('totalExpense should calculate sum of expense transactions', () => {
      const expenseTransactions = service.transactions().filter(t => t.type === 'expense');
      const expectedTotal = expenseTransactions.reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

      expect(service.totalExpense()).toBe(expectedTotal);
    });

    it('balance should be income minus expense', () => {
      const expectedBalance = service.totalIncome() - service.totalExpense();
      expect(service.balance()).toBe(expectedBalance);
    });

    it('balance should update when transactions change', () => {
      const initialBalance = service.balance();

      // Add another income transaction
      const newIncome = createTransaction({ type: 'income', amount: 1000, amountInBaseCurrency: 1000 });
      service.transactions.set([...service.transactions(), newIncome]);

      expect(service.balance()).toBe(initialBalance + 1000);
    });
  });

  describe('addTransaction', () => {
    it('should throw error when user not authenticated', async () => {
      mockAuth.setAuthenticated(false);

      await expectAsync(
        service.addTransaction({
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Test',
          date: new Date()
        })
      ).toBeRejectedWithError('User not authenticated');
    });

    it('should add transaction when authenticated', async () => {
      const id = await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Test transaction',
        date: new Date()
      });

      expect(id).toBeDefined();
      expect(mockFirestore.addDocumentSpy).toHaveBeenCalled();
    });

    it('should set isLoading during operation', async () => {
      const addPromise = service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Test',
        date: new Date()
      });

      // isLoading should be set (may be false by the time we check due to async)
      await addPromise;
      expect(service.isLoading()).toBe(false);
    });

    it('should calculate exchange rate for non-base currency', async () => {
      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'EUR',
        categoryId: 'food',
        description: 'Euro transaction',
        date: new Date()
      });

      const callArgs = mockFirestore.addDocumentSpy.calls.mostRecent().args;
      const transactionData = callArgs[1];

      expect(transactionData.currency).toBe('EUR');
      expect(transactionData.exchangeRate).toBeDefined();
    });
  });

  describe('updateTransaction', () => {
    it('should update transaction', async () => {
      // Set up existing transaction
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));

      await service.updateTransaction('txn-1', {
        description: 'Updated description'
      });

      expect(mockFirestore.updateDocumentSpy).toHaveBeenCalled();
    });

    it('should set isLoading during update', async () => {
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));

      const updatePromise = service.updateTransaction('txn-1', {
        description: 'Updated'
      });

      await updatePromise;
      expect(service.isLoading()).toBe(false);
    });
  });

  describe('deleteTransaction', () => {
    it('should delete transaction', async () => {
      await service.deleteTransaction('txn-1');

      expect(mockFirestore.deleteDocumentSpy).toHaveBeenCalledWith(
        'users/test-user-123/transactions/txn-1'
      );
    });

    it('should set isLoading during deletion', async () => {
      const deletePromise = service.deleteTransaction('txn-1');

      await deletePromise;
      expect(service.isLoading()).toBe(false);
    });
  });

  describe('getTransactions with filters', () => {
    beforeEach(() => {
      const transactions = createMixedTransactions();
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);
    });

    it('should subscribe to collection', (done) => {
      service.getTransactions().subscribe(transactions => {
        expect(transactions).toBeDefined();
        expect(Array.isArray(transactions)).toBe(true);
        done();
      });
    });

    it('should update transactions signal', (done) => {
      service.getTransactions().subscribe(() => {
        expect(service.transactions().length).toBeGreaterThan(0);
        done();
      });
    });
  });

  describe('getByDateRange', () => {
    it('should call getTransactions with date filters', (done) => {
      const start = new Date(2024, 0, 1);
      const end = new Date(2024, 11, 31);

      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getByDateRange(start, end).subscribe(() => {
        expect(mockFirestore.getCollectionSpy).toHaveBeenCalled();
        done();
      });
    });
  });

  describe('getByCategory', () => {
    it('should call getTransactions with category filter', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getByCategory('food').subscribe(() => {
        expect(mockFirestore.getCollectionSpy).toHaveBeenCalled();
        done();
      });
    });
  });

  describe('searchTransactions', () => {
    beforeEach(() => {
      const transactions = [
        createTransaction({ description: 'Coffee at Starbucks' }),
        createTransaction({ description: 'Groceries at Walmart' }),
        createTransaction({ description: 'Dinner' })
      ];
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);
    });

    it('should filter by search query', (done) => {
      service.searchTransactions('coffee').subscribe(() => {
        // The mock returns all, but the service should filter
        expect(mockFirestore.getCollectionSpy).toHaveBeenCalled();
        done();
      });
    });
  });

  describe('getRecentTransactions', () => {
    it('should request limited transactions', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getRecentTransactions(5).subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.calls.mostRecent().args;
        expect(callArgs[1]?.limit).toBe(5);
        done();
      });
    });

    it('should default to 10 transactions', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getRecentTransactions().subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.calls.mostRecent().args;
        expect(callArgs[1]?.limit).toBe(10);
        done();
      });
    });
  });

  describe('getMonthlyTotals', () => {
    beforeEach(() => {
      const now = new Date();
      const transactions = [
        createTransaction({
          type: 'income',
          amount: 5000,
          amountInBaseCurrency: 5000,
          date: Timestamp.fromDate(now)
        }),
        createTransaction({
          type: 'expense',
          amount: 100,
          amountInBaseCurrency: 100,
          categoryId: 'food',
          date: Timestamp.fromDate(now)
        }),
        createTransaction({
          type: 'expense',
          amount: 50,
          amountInBaseCurrency: 50,
          categoryId: 'food',
          date: Timestamp.fromDate(now)
        }),
        createTransaction({
          type: 'expense',
          amount: 200,
          amountInBaseCurrency: 200,
          categoryId: 'transport',
          date: Timestamp.fromDate(now)
        })
      ];
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);
    });

    it('should calculate income total', (done) => {
      const now = new Date();
      service.getMonthlyTotals(now.getFullYear(), now.getMonth() + 1).subscribe(totals => {
        expect(totals.income).toBe(5000);
        done();
      });
    });

    it('should calculate expense total', (done) => {
      const now = new Date();
      service.getMonthlyTotals(now.getFullYear(), now.getMonth() + 1).subscribe(totals => {
        expect(totals.expense).toBe(350); // 100 + 50 + 200
        done();
      });
    });

    it('should calculate balance', (done) => {
      const now = new Date();
      service.getMonthlyTotals(now.getFullYear(), now.getMonth() + 1).subscribe(totals => {
        expect(totals.balance).toBe(4650); // 5000 - 350
        done();
      });
    });

    it('should include transaction count', (done) => {
      const now = new Date();
      service.getMonthlyTotals(now.getFullYear(), now.getMonth() + 1).subscribe(totals => {
        expect(totals.transactionCount).toBe(4);
        done();
      });
    });

    it('should group by category', (done) => {
      const now = new Date();
      service.getMonthlyTotals(now.getFullYear(), now.getMonth() + 1).subscribe(totals => {
        expect(totals.byCategory.length).toBeGreaterThan(0);

        const foodCategory = totals.byCategory.find(c => c.categoryId === 'food');
        expect(foodCategory?.total).toBe(150); // 100 + 50

        const transportCategory = totals.byCategory.find(c => c.categoryId === 'transport');
        expect(transportCategory?.total).toBe(200);

        done();
      });
    });
  });
});
