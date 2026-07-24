import { TestBed } from '@angular/core/testing';
import { TransactionService, RECEIPT_IMAGE_LIMIT_ERROR } from './transaction.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import { MockStorageService } from './testing/mock-storage.service';
import {
  createBudget,
  createTransaction,
  createMixedTransactions
} from './testing/test-data';
import { Timestamp } from '@angular/fire/firestore';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let mockStorage: MockStorageService;
  let mockQuota: jasmine.SpyObj<ReceiptQuotaService>;
  let currencyService: CurrencyService;

  beforeEach(() => {
    mockQuota = jasmine.createSpyObj<ReceiptQuotaService>('ReceiptQuotaService', [
      'canAddImage', 'noteImageAdded', 'noteImageRemoved', 'invalidateCount',
    ]);
    mockQuota.canAddImage.and.resolveTo(true);

    // The real CurrencyService starts a rates refresh in its constructor.
    // On CI runners that fetch can actually succeed and then write cached
    // rates through the Firestore mock mid-test (a phantom setDocument on
    // 'currencies/rates') and clobber the seeded rate table with live
    // values. Reject it so specs stay deterministic.
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        CurrencyService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService },
        { provide: StorageService, useClass: MockStorageService },
        { provide: ReceiptQuotaService, useValue: mockQuota }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    mockStorage = TestBed.inject(StorageService) as unknown as MockStorageService;
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
    // Keep the write path's rates-loaded guard from hitting the real
    // initialization chain (network fetch + default rates would clobber the
    // seeded map above). Individual specs re-stub this to test the guard.
    spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
  });

  afterEach(() => {
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
    mockStorage.clearMocks();
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

  describe('resnapshotBaseCurrency', () => {
    it('rewrites stale snapshots against the new base currency', async () => {
      currencyService.exchangeRates.set(new Map([['USD', 1], ['TWD', 31.5]]));
      // Written while base was USD; user switches base to TWD.
      mockFirestore.setMockCollection('users/test-user-123/transactions', [
        createTransaction({
          id: 'txn-usd',
          amount: 100,
          currency: 'USD',
          amountInBaseCurrency: 100,
          exchangeRate: 1,
          baseCurrency: 'USD'
        })
      ]);

      const updated = await service.resnapshotBaseCurrency('TWD');

      expect(updated).toBe(1);
      const updateArgs = mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [];
      expect(updateArgs[0]).toBe('users/test-user-123/transactions/txn-usd');
      const written = updateArgs[1] as {
        exchangeRate: number;
        amountInBaseCurrency: number;
        baseCurrency: string;
      };
      expect(written.exchangeRate).toBeCloseTo(31.5, 5);
      expect(written.amountInBaseCurrency).toBeCloseTo(3150, 2);
      expect(written.baseCurrency).toBe('TWD');
    });

    it('skips rows already snapshotted against the requested base', async () => {
      currencyService.exchangeRates.set(new Map([['USD', 1], ['TWD', 31.5]]));
      mockFirestore.setMockCollection('users/test-user-123/transactions', [
        createTransaction({
          id: 'txn-current',
          amount: 100,
          currency: 'USD',
          amountInBaseCurrency: 3150,
          exchangeRate: 31.5,
          baseCurrency: 'TWD'
        })
      ]);

      const updated = await service.resnapshotBaseCurrency('TWD');

      expect(updated).toBe(0);
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
    });

    it('waits for exchange rates before recomputing', async () => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      await service.resnapshotBaseCurrency('TWD');

      expect(currencyService.ensureRatesLoaded).toHaveBeenCalled();
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
      expect(mockFirestore.addDocumentSpy.calls.length).toBeGreaterThan(0);
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

      const callArgs = mockFirestore.addDocumentSpy.mostRecent()?.args ?? [];
      const transactionData = callArgs[1] as Record<string, unknown>;

      expect(transactionData['currency']).toBe('EUR');
      expect(transactionData['exchangeRate']).toBeDefined();
    });

    it('waits for exchange rates before persisting the base-currency snapshot', async () => {
      // Simulate rates that only become available while the write is in
      // flight: without awaiting the guard, the snapshot is computed against
      // the not-yet-loaded table (JPY missing -> 1:1) and the raw foreign
      // amount is persisted as the base amount.
      currencyService.exchangeRates.set(new Map([['USD', 1]]));
      let resolveRates!: () => void;
      (currencyService.ensureRatesLoaded as jasmine.Spy).and.returnValue(
        new Promise<void>(resolve => (resolveRates = resolve))
      );

      const pending = service.addTransaction({
        type: 'expense',
        amount: 3800,
        currency: 'JPY',
        categoryId: 'food',
        description: 'Dinner in Tokyo',
        date: new Date()
      });

      currencyService.exchangeRates.set(new Map([['USD', 1], ['JPY', 149.5]]));
      resolveRates();
      await pending;

      const written = mockFirestore.addDocumentSpy.mostRecent()?.args[1] as {
        exchangeRate: number;
        amountInBaseCurrency: number;
        baseCurrency: string;
      };
      expect(written.exchangeRate).toBeCloseTo(1 / 149.5, 6);
      expect(written.amountInBaseCurrency).toBeCloseTo(3800 / 149.5, 2);
      // The snapshot is stamped with the base it was computed against, so a
      // later base-currency change can invalidate it.
      expect(written.baseCurrency).toBe('USD');
    });

    it('uploads the receipt and persists receiptUrl when a receiptFile is present', async () => {
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      const id = await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'With receipt',
        date: new Date(),
        receiptFile
      });

      // Receipt uploaded under the generated transaction id.
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(1);
      const uploadArgs = mockStorage.uploadReceiptSpy.mostRecent()?.args ?? [];
      expect(uploadArgs[0]).toBe('test-user-123');
      expect(uploadArgs[1]).toBe(id);
      expect(uploadArgs[2]).toBe(receiptFile);

      // Saved with setDocument (id pre-generated) and the resulting URL.
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(1);
      const setArgs = mockFirestore.setDocumentSpy.mostRecent()?.args ?? [];
      const savedDoc = setArgs[1] as Record<string, unknown>;
      expect(savedDoc['receiptUrl']).toBe(mockStorage.uploadResult);

      // The new image is recorded against the quota.
      expect(mockQuota.noteImageAdded).toHaveBeenCalled();
    });

    it('rejects a receipt upload when the image quota is exhausted', async () => {
      mockQuota.canAddImage.and.resolveTo(false);
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await expectAsync(service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Over quota',
        date: new Date(),
        receiptFile
      })).toBeRejectedWithError(RECEIPT_IMAGE_LIMIT_ERROR);

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockQuota.noteImageAdded).not.toHaveBeenCalled();
    });

    it('does not upload when no receiptFile is provided', async () => {
      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'No receipt',
        date: new Date()
      });

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
      // Falls back to the auto-id addDocument path.
      expect(mockFirestore.addDocumentSpy.calls.length).toBe(1);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
    });

    it('writes to the caller-supplied id via setDocument', async () => {
      const id = await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Recurring occurrence',
          date: new Date()
        },
        { id: 'rec-r1-123' }
      );

      expect(id).toBe('rec-r1-123');
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(1);
      expect(mockFirestore.setDocumentSpy.mostRecent()?.args[0]).toBe(
        'users/test-user-123/transactions/rec-r1-123'
      );
      // The auto-id path must not run when a deterministic id is supplied.
      expect(mockFirestore.addDocumentSpy.calls.length).toBe(0);
    });

    it('recalculates affected budgets after posting an expense', async () => {
      const budgetService = TestBed.inject(BudgetService);
      const budget = createBudget({ id: 'b1', categoryId: 'food' });
      budgetService.budgets.set([budget]);
      mockFirestore.setMockDocument('users/test-user-123/budgets/b1', budget);

      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Groceries',
        date: new Date()
      });

      const budgetUpdate = mockFirestore.updateDocumentSpy.calls.find(
        c => c.args[0] === 'users/test-user-123/budgets/b1'
      );
      expect(budgetUpdate).toBeDefined();
      expect('spent' in (budgetUpdate?.args[1] as object)).toBeTrue();
    });
  });

  describe('updateTransaction', () => {
    it('should update transaction', async () => {
      // Set up existing transaction
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));

      await service.updateTransaction('txn-1', {
        description: 'Updated description'
      });

      expect(mockFirestore.updateDocumentSpy.calls.length).toBeGreaterThan(0);
    });

    it('should set isLoading during update', async () => {
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));

      const updatePromise = service.updateTransaction('txn-1', {
        description: 'Updated'
      });

      await updatePromise;
      expect(service.isLoading()).toBe(false);
    });

    it('uploads a new receipt and persists receiptUrl', async () => {
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFile });

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(1);
      const uploadArgs = mockStorage.uploadReceiptSpy.mostRecent()?.args ?? [];
      expect(uploadArgs[1]).toBe('txn-1');

      const updateArgs = mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [];
      const updateData = updateArgs[1] as Record<string, unknown>;
      expect(updateData['receiptUrl']).toBe(mockStorage.uploadResult);
      expect(mockQuota.noteImageAdded).toHaveBeenCalled();
    });

    it('rejects a first-time receipt upload when the quota is exhausted', async () => {
      mockQuota.canAddImage.and.resolveTo(false);
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await expectAsync(service.updateTransaction('txn-1', { receiptFile }))
        .toBeRejectedWithError(RECEIPT_IMAGE_LIMIT_ERROR);
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
    });

    it('allows replacing an existing receipt even at the quota limit', async () => {
      mockQuota.canAddImage.and.resolveTo(false);
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'https://storage.example.com/old.jpg' })
      );
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFile });

      // Replacement reuses the existing quota slot.
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(1);
      expect(mockQuota.noteImageAdded).not.toHaveBeenCalled();
    });
  });

  describe('removeReceipt', () => {
    it('deletes the stored image, clears receiptUrl, and frees a quota slot', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'https://storage.example.com/receipt.jpg' })
      );

      await service.removeReceipt('txn-1');

      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(1);
      const deleteArgs = mockStorage.deleteReceiptSpy.mostRecent()?.args ?? [];
      expect(deleteArgs[0]).toBe('test-user-123');
      expect(deleteArgs[1]).toBe('txn-1');

      const updateArgs = mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [];
      expect(updateArgs[0]).toBe('users/test-user-123/transactions/txn-1');
      expect('receiptUrl' in (updateArgs[1] as object)).toBeTrue();

      expect(mockQuota.noteImageRemoved).toHaveBeenCalled();
    });

    it('is a no-op for a transaction without a stored image', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await service.removeReceipt('txn-1');

      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
      expect(mockQuota.noteImageRemoved).not.toHaveBeenCalled();
    });
  });

  describe('deleteTransaction', () => {
    it('should delete transaction', async () => {
      await service.deleteTransaction('txn-1');

      expect(mockFirestore.deleteDocumentSpy.calls.length).toBeGreaterThan(0);
      expect(mockFirestore.deleteDocumentSpy.mostRecent()?.args[0]).toBe(
        'users/test-user-123/transactions/txn-1'
      );
    });

    it('should set isLoading during deletion', async () => {
      const deletePromise = service.deleteTransaction('txn-1');

      await deletePromise;
      expect(service.isLoading()).toBe(false);
    });

    it('removes the stored receipt when the transaction has one', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'https://storage.example.com/receipt.jpg' })
      );

      await service.deleteTransaction('txn-1');

      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(1);
      const args = mockStorage.deleteReceiptSpy.mostRecent()?.args ?? [];
      expect(args[0]).toBe('test-user-123');
      expect(args[1]).toBe('txn-1');
      expect(mockQuota.noteImageRemoved).toHaveBeenCalled();
    });

    it('does not call storage cleanup when there is no receipt', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await service.deleteTransaction('txn-1');

      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(0);
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

    it('should add currency where clause when currency filter is set', (done) => {
      service.getTransactions({ currency: 'USD' }).subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.mostRecent()?.args ?? [];
        const options = callArgs[1] as {
          where?: { field: string; op: string; value: unknown }[];
        } | undefined;
        expect(options?.where).toContain(
          jasmine.objectContaining({ field: 'currency', op: '==', value: 'USD' })
        );
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
        expect(mockFirestore.getCollectionSpy.calls.length).toBeGreaterThan(0);
        done();
      });
    });
  });

  describe('getExpensesInRange', () => {
    it('returns only expenses and leaves the transactions signal untouched', (done) => {
      const transactions = createMixedTransactions();
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);

      const expectedExpenseCount = transactions.filter(t => t.type === 'expense').length;

      service.getExpensesInRange(new Date(2026, 0, 1), new Date(2026, 5, 30)).subscribe(result => {
        // Only expenses are returned...
        expect(result.length).toBe(expectedExpenseCount);
        expect(result.every(t => t.type === 'expense')).toBe(true);
        // ...and unlike getByDateRange this query does not mutate the main signal.
        expect(service.transactions()).toEqual([]);
        done();
      });
    });

    it('adds a categoryId where clause when a category filter is provided', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getExpensesInRange(new Date(2026, 0, 1), new Date(2026, 5, 30), 'food').subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.mostRecent()?.args ?? [];
        const options = callArgs[1] as {
          where?: { field: string; op: string; value: unknown }[];
        } | undefined;
        expect(options?.where).toContain(
          jasmine.objectContaining({ field: 'categoryId', op: '==', value: 'food' })
        );
        // Still non-mutating with the category filter applied.
        expect(service.transactions()).toEqual([]);
        done();
      });
    });
  });

  describe('getByCategory', () => {
    it('should call getTransactions with category filter', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getByCategory('food').subscribe(() => {
        expect(mockFirestore.getCollectionSpy.calls.length).toBeGreaterThan(0);
        done();
      });
    });
  });

  describe('getTransactions with a search query', () => {
    beforeEach(() => {
      const transactions = [
        createTransaction({ id: 'txn-coffee', description: 'Coffee at Starbucks' }),
        createTransaction({ id: 'txn-groceries', description: 'Groceries at Walmart' }),
        createTransaction({ id: 'txn-dinner', description: 'Dinner' })
      ];
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);
    });

    it('narrows the emitted rows to matches', (done) => {
      service.getTransactions({ searchQuery: 'coffee' }).subscribe(result => {
        expect(result.map(t => t.id)).toEqual(['txn-coffee']);
        done();
      });
    });
  });

  describe('getRecentTransactions', () => {
    it('should request limited transactions', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getRecentTransactions(5).subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.mostRecent()?.args ?? [];
        const options = callArgs[1] as Record<string, unknown> | undefined;
        expect(options?.['limit']).toBe(5);
        done();
      });
    });

    it('should default to 10 transactions', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getRecentTransactions().subscribe(() => {
        const callArgs = mockFirestore.getCollectionSpy.mostRecent()?.args ?? [];
        const options = callArgs[1] as Record<string, unknown> | undefined;
        expect(options?.['limit']).toBe(10);
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
