import { TestBed } from '@angular/core/testing';
import {
  TransactionService,
  RECEIPT_IMAGE_LIMIT_ERROR,
  RECEIPT_ATTACH_FAILED
} from './transaction.service';
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
      'canAddImages', 'noteImagesAdded', 'noteImagesRemoved', 'invalidateCount',
    ]);
    mockQuota.canAddImages.and.resolveTo(true);

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

    it('writes the budget period the form chose', async () => {
      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Test transaction',
        date: new Date(),
        period: 'monthly'
      });

      const written = mockFirestore.addDocumentSpy.mostRecent()?.args[1] as Record<string, unknown>;
      expect(written['period']).toBe('monthly');
    });

    it('omits the period key entirely when none was chosen', async () => {
      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Test transaction',
        date: new Date()
      });

      // Not `period: undefined` — the SDK rejects the whole write for that.
      const written = mockFirestore.addDocumentSpy.mostRecent()?.args[1] as Record<string, unknown>;
      expect('period' in written).toBeFalse();
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

    it('uploads every receipt into consecutive slots and persists the array', async () => {
      const files = [0, 1, 2].map(
        i => new File([`receipt-${i}`], `receipt-${i}.jpg`, { type: 'image/jpeg' })
      );

      const id = await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'With receipts',
        date: new Date(),
        receiptFiles: files
      });

      // Each file lands in its own slot under the generated transaction id.
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(3);
      mockStorage.uploadReceiptSpy.calls.forEach((call, i) => {
        expect(call.args[0]).toBe('test-user-123');
        expect(call.args[1]).toBe(id);
        expect(call.args[2]).toBe(files[i]);
        expect(call.args[3]).toBe(i);
      });

      // Saved with setDocument (id pre-generated); the pointer is the first
      // entry of the array and the count matches.
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(1);
      const setArgs = mockFirestore.setDocumentSpy.mostRecent()?.args ?? [];
      const savedDoc = setArgs[1] as Record<string, unknown>;
      const urls = savedDoc['receiptUrls'] as string[];
      expect(urls.length).toBe(3);
      expect(savedDoc['receiptUrl']).toBe(urls[0]);
      expect(savedDoc['receiptCount']).toBe(3);

      // The new images are recorded against the quota.
      expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(3);
    });

    it('rejects a receipt upload when the image quota is exhausted', async () => {
      mockQuota.canAddImages.and.resolveTo(false);
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await expectAsync(service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Over quota',
        date: new Date(),
        receiptFiles: [receiptFile]
      })).toBeRejectedWithError(RECEIPT_IMAGE_LIMIT_ERROR);

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();
    });

    it('rejects a batch larger than the per-transaction cap before uploading', async () => {
      const files = Array.from(
        { length: 6 },
        (_, i) => new File([`r${i}`], `r${i}.jpg`, { type: 'image/jpeg' })
      );

      await expectAsync(service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Too many',
        date: new Date(),
        receiptFiles: files
      })).toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
    });

    it('writes nothing and rolls back landed uploads when one in the batch fails', async () => {
      // Slot 1 (and beyond) reject; slot 0 lands and must be swept.
      mockStorage.failFromSlot = 1;
      const files = [0, 1, 2].map(
        i => new File([`receipt-${i}`], `receipt-${i}.jpg`, { type: 'image/jpeg' })
      );

      await expectAsync(service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Partial failure',
        date: new Date(),
        receiptFiles: files
      })).toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

      // No document was created and the quota never moved.
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockFirestore.addDocumentSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();

      // The slot that landed was deleted best-effort.
      expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(1);
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args[2]).toEqual([0]);
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

    it('clears the stored location when the update carries an undefined one', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', location: { name: 'Aoyama Market' } })
      );

      await service.updateTransaction('txn-1', { location: undefined });

      const updateData = (mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // Key present but not a map: the deleteField() sentinel.
      expect('location' in updateData).toBeTrue();
      expect(updateData['location']).not.toEqual({ name: 'Aoyama Market' });
    });

    it('leaves the stored location alone when the update omits the key', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', location: { name: 'Aoyama Market' } })
      );

      await service.updateTransaction('txn-1', { note: 'updated' });

      const updateData = (mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect('location' in updateData).toBeFalse();
    });

    it('writes the budget period the update carries', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await service.updateTransaction('txn-1', { period: 'yearly' });

      const updateData = (mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['period']).toBe('yearly');
    });

    it('clears the stored budget period when the update carries an undefined one', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', period: 'monthly' })
      );

      await service.updateTransaction('txn-1', { period: undefined });

      const updateData = (mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // Key present but not a period string: the deleteField() sentinel.
      expect('period' in updateData).toBeTrue();
      expect(updateData['period']).not.toBe('monthly');
    });

    it('leaves the stored budget period alone when the update omits the key', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', period: 'monthly' })
      );

      await service.updateTransaction('txn-1', { note: 'updated' });

      const updateData = (mockFirestore.updateDocumentSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect('period' in updateData).toBeFalse();
    });

    it('appends an image to a receiptless transaction at slot 0', async () => {
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFiles: [receiptFile] });

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(1);
      const uploadArgs = mockStorage.uploadReceiptSpy.mostRecent()?.args ?? [];
      expect(uploadArgs[1]).toBe('txn-1');
      expect(uploadArgs[3]).toBe(0);

      // Appends commit through a transaction, not a blind update.
      const updateArgs = mockFirestore.txUpdateSpy.mostRecent()?.args ?? [];
      const updateData = updateArgs[1] as Record<string, unknown>;
      expect(updateData['receiptUrl']).toBe(mockStorage.uploadResult);
      expect(updateData['receiptUrls']).toEqual([mockStorage.uploadResult]);
      expect(updateData['receiptCount']).toBe(1);
      expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(1);
    });

    it('rejects an appended image when the quota is exhausted', async () => {
      mockQuota.canAddImages.and.resolveTo(false);
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', createTransaction({ id: 'txn-1' }));
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await expectAsync(service.updateTransaction('txn-1', { receiptFiles: [receiptFile] }))
        .toBeRejectedWithError(RECEIPT_IMAGE_LIMIT_ERROR);
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
    });

    it('appends after a legacy single-image row, keeping its stored URL', async () => {
      // A row written before receiptUrls existed: its one image is slot 0.
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'https://storage.example.com/old.jpg' })
      );
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFiles: [receiptFile] });

      // The new image lands at slot 1; slot 0's object is never touched.
      const uploadArgs = mockStorage.uploadReceiptSpy.mostRecent()?.args ?? [];
      expect(uploadArgs[3]).toBe(1);

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['receiptUrls']).toEqual([
        'https://storage.example.com/old.jpg',
        `${mockStorage.uploadResult}_1`
      ]);
      expect(updateData['receiptUrl']).toBe('https://storage.example.com/old.jpg');
      expect(updateData['receiptCount']).toBe(2);
      expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(1);
    });

    it('rejects an append that would exceed the per-transaction cap', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1', 'u2', 'u3'],
          receiptCount: 4
        })
      );
      const files = [0, 1].map(
        i => new File([`r${i}`], `r${i}.jpg`, { type: 'image/jpeg' })
      );

      await expectAsync(service.updateTransaction('txn-1', { receiptFiles: files }))
        .toBeRejectedWithError(RECEIPT_ATTACH_FAILED);
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
    });

    it('leaves the stored row untouched when an appended batch fails midway', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'https://storage.example.com/old.jpg',
          receiptUrls: ['https://storage.example.com/old.jpg'],
          receiptCount: 1
        })
      );
      // The append targets slots 1..2; slot 2 rejects.
      mockStorage.failFromSlot = 2;
      const files = [0, 1].map(
        i => new File([`r${i}`], `r${i}.jpg`, { type: 'image/jpeg' })
      );

      await expectAsync(service.updateTransaction('txn-1', { receiptFiles: files }))
        .toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

      // No update reached Firestore and the landed slot was swept.
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args[2]).toEqual([1]);
    });

    it('retries at fresh slots when a rival append claimed the optimistic ones', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'u0', receiptUrls: ['u0'], receiptCount: 1 })
      );
      // A rival appended at slot 1 after our optimistic read chose it.
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument(
          'users/test-user-123/transactions/txn-1',
          createTransaction({
            id: 'txn-1',
            receiptUrl: 'u0',
            receiptUrls: ['u0', 'rival'],
            receiptCount: 2
          })
        );
        mockFirestore.beforeTransaction = undefined;
      };
      const file = new File(['mine'], 'mine.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFiles: [file] });

      // First upload at the contested slot 1, retry at the fresh slot 2.
      expect(mockStorage.uploadReceiptSpy.calls.map(c => c.args[3])).toEqual([1, 2]);
      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['receiptUrls']).toEqual(['u0', 'rival', `${mockStorage.uploadResult}_2`]);
      expect(updateData['receiptCount']).toBe(3);
      // One image landed, counted once, after the commit.
      expect(mockQuota.noteImagesAdded).toHaveBeenCalledTimes(1);
      expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(1);
      // The contested slot belongs to the rival now — it is never swept.
      expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(0);
    });

    it('pads with tombstones when a removal truncated the array under the upload', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      );
      // A rival removed slot 1 (truncating the array) while our upload
      // targeted slot 2.
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument(
          'users/test-user-123/transactions/txn-1',
          createTransaction({ id: 'txn-1', receiptUrl: 'u0', receiptUrls: ['u0'], receiptCount: 1 })
        );
        mockFirestore.beforeTransaction = undefined;
      };
      const file = new File(['mine'], 'mine.jpg', { type: 'image/jpeg' });

      await service.updateTransaction('txn-1', { receiptFiles: [file] });

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // Slot 1 is padded back as a tombstone so index == storage slot holds
      // for the image uploaded at slot 2.
      expect(updateData['receiptUrls']).toEqual(['u0', '', `${mockStorage.uploadResult}_2`]);
      expect(updateData['receiptUrl']).toBe('u0');
      expect(updateData['receiptCount']).toBe(2);
    });

    it('sweeps its uploads and fails when the transaction vanished mid-append', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'u0', receiptUrls: ['u0'], receiptCount: 1 })
      );
      // The transaction was deleted between our read and our commit.
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', undefined);
      };
      const file = new File(['mine'], 'mine.jpg', { type: 'image/jpeg' });

      await expectAsync(service.updateTransaction('txn-1', { receiptFiles: [file] }))
        .toBeRejectedWithError(RECEIPT_ATTACH_FAILED);

      // Nothing committed, the orphaned upload at slot 1 was swept, and the
      // quota never counted an image that never landed.
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args[2]).toEqual([1]);
      expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();
    });
  });

  describe('removeReceiptAt', () => {
    it('tombstones a middle slot without touching its neighbours', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1', 'u2'],
          receiptCount: 3
        })
      );

      await service.removeReceiptAt('txn-1', 1);

      // Only slot 1's object is deleted.
      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(1);
      expect(mockStorage.deleteReceiptSpy.mostRecent()?.args).toEqual(['test-user-123', 'txn-1', 1]);

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['receiptUrls']).toEqual(['u0', '', 'u2']);
      expect(updateData['receiptUrl']).toBe('u0');
      expect(updateData['receiptCount']).toBe(2);
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(1);
    });

    it('promotes the next live image when the first is removed', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      );

      await service.removeReceiptAt('txn-1', 0);

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // The pointer follows the first live image so the quota query and the
      // single-image read sites keep resolving.
      expect(updateData['receiptUrl']).toBe('u1');
      expect(updateData['receiptUrls']).toEqual(['', 'u1']);
      expect(updateData['receiptCount']).toBe(1);
    });

    it('clears every receipt field when the last image is removed', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u2',
          receiptUrls: ['', '', 'u2'],
          receiptCount: 1
        })
      );

      await service.removeReceiptAt('txn-1', 2);

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // deleteField() sentinels, not empty strings — the row must drop out
      // of the receiptUrl > '' quota query.
      expect('receiptUrl' in updateData).toBeTrue();
      expect('receiptUrls' in updateData).toBeTrue();
      expect(updateData['receiptCount']).toBe(0);
      expect(typeof updateData['receiptUrl']).not.toBe('string');
    });

    it('removes a legacy single-image row via slot 0', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1', receiptUrl: 'https://storage.example.com/receipt.jpg' })
      );

      await service.removeReceiptAt('txn-1', 0);

      expect(mockStorage.deleteReceiptSpy.mostRecent()?.args).toEqual(['test-user-123', 'txn-1', 0]);
      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['receiptCount']).toBe(0);
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(1);
    });

    it('is a no-op for an empty or out-of-range slot', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', '', 'u2'],
          receiptCount: 2
        })
      );

      await service.removeReceiptAt('txn-1', 1);
      await service.removeReceiptAt('txn-1', 9);

      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesRemoved).not.toHaveBeenCalled();
    });

    it('tombstones against the transaction fresh read, not the stale one', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1', 'u2'],
          receiptCount: 3
        })
      );
      // A rival removed slot 2 (with truncation) between our pre-check read
      // and our transaction.
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument(
          'users/test-user-123/transactions/txn-1',
          createTransaction({
            id: 'txn-1',
            receiptUrl: 'u0',
            receiptUrls: ['u0', 'u1'],
            receiptCount: 2
          })
        );
      };

      await service.removeReceiptAt('txn-1', 1);

      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      // Committed against the rival's array: u2 is not resurrected.
      expect(updateData['receiptUrls']).toEqual(['u0']);
      expect(updateData['receiptCount']).toBe(1);
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(1);
    });

    it('skips the write and the quota decrement when a rival emptied the slot first', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      );
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument(
          'users/test-user-123/transactions/txn-1',
          createTransaction({
            id: 'txn-1',
            receiptUrl: 'u0',
            receiptUrls: ['u0'],
            receiptCount: 1
          })
        );
      };

      await service.removeReceiptAt('txn-1', 1);

      // The storage delete already happened (idempotent, object-not-found is
      // success), but the rival's commit owns the tombstone and its quota
      // decrement — ours must not double-count.
      expect(mockStorage.deleteReceiptSpy.calls.length).toBe(1);
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesRemoved).not.toHaveBeenCalled();
    });

    it('stamps updatedAt inside the transaction payload', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      );

      await service.removeReceiptAt('txn-1', 1);

      // tx.update bypasses the wrapper's automatic updatedAt injection, so
      // the transactional path has to stamp it itself.
      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['updatedAt'] instanceof Timestamp).toBeTrue();
    });
  });

  describe('removeAllReceipts', () => {
    it('sweeps every slot and clears the receipt fields', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', '', 'u2'],
          receiptCount: 2
        })
      );

      await service.removeAllReceipts('txn-1');

      // The sweep spans the whole array, tombstones included.
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
        'test-user-123', 'txn-1', [0, 1, 2]
      ]);

      const updateArgs = mockFirestore.txUpdateSpy.mostRecent()?.args ?? [];
      expect(updateArgs[0]).toBe('users/test-user-123/transactions/txn-1');
      const updateData = updateArgs[1] as Record<string, unknown>;
      expect(updateData['receiptCount']).toBe(0);

      // Two live images freed.
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(2);
    });

    it('is a no-op for a transaction without stored images', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await service.removeAllReceipts('txn-1');

      expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(0);
      expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockQuota.noteImagesRemoved).not.toHaveBeenCalled();
    });

    it('leaves a racing append\'s entries in place', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      );
      // A rival appended at slot 2 after our read chose the sweep span [0, 1].
      mockFirestore.beforeTransaction = () => {
        mockFirestore.setMockDocument(
          'users/test-user-123/transactions/txn-1',
          createTransaction({
            id: 'txn-1',
            receiptUrl: 'u0',
            receiptUrls: ['u0', 'u1', 'u2'],
            receiptCount: 3
          })
        );
      };

      await service.removeAllReceipts('txn-1');

      // The sweep stayed inside the span seen at read time, so the rival's
      // object at slot 2 was never deleted...
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
        'test-user-123', 'txn-1', [0, 1]
      ]);
      // ...and its committed entry survives the clear.
      const updateData = (mockFirestore.txUpdateSpy.mostRecent()?.args ?? [])[1] as Record<string, unknown>;
      expect(updateData['receiptUrls']).toEqual(['', '', 'u2']);
      expect(updateData['receiptUrl']).toBe('u2');
      expect(updateData['receiptCount']).toBe(1);
      // Only what this call actually tombstoned is decremented.
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(2);
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

      // A legacy row spans one slot.
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
        'test-user-123', 'txn-1', [0]
      ]);
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(1);
    });

    it('sweeps every slot of a multi-image transaction, gaps included', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', '', 'u2'],
          receiptCount: 2
        })
      );

      await service.deleteTransaction('txn-1');

      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
        'test-user-123', 'txn-1', [0, 1, 2]
      ]);
      // Only the live images count against the quota.
      expect(mockQuota.noteImagesRemoved).toHaveBeenCalledWith(2);
    });

    it('does not call storage cleanup when there is no receipt', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await service.deleteTransaction('txn-1');

      expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(0);
    });
  });

  describe('deleteAllTransactions', () => {
    const path = 'users/test-user-123/transactions';

    function seedCollection(count: number): void {
      mockFirestore.setMockCollection(
        path,
        Array.from({ length: count }, (_, i) => createTransaction({ id: `txn-${i}` }))
      );
    }

    // The regression. The `transactions` signal only ever holds whatever the
    // last live query published — usually the current month, and nothing at
    // all when the user deep-links to Settings without visiting the dashboard.
    // Enumerating it deleted a slice of the account and reported success.
    it('deletes the whole collection even when the signal is empty', async () => {
      seedCollection(6);
      expect(service.transactions().length).toBe(0);

      const deleted = await service.deleteAllTransactions();

      expect(deleted).toBe(6);
      expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(6);
    });

    it('deletes the whole collection when the signal holds only a window', async () => {
      seedCollection(6);
      service.transactions.set([
        createTransaction({ id: 'txn-0' }),
        createTransaction({ id: 'txn-1' })
      ]);

      const deleted = await service.deleteAllTransactions();

      expect(deleted).toBe(6);
      expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(6);
    });

    it('reads the collection rather than the signal', async () => {
      seedCollection(2);

      await service.deleteAllTransactions();

      expect(mockFirestore.getCollectionSpy.mostRecent()?.args[0]).toBe(path);
    });

    it('clears the in-memory signal and forces a quota recount', async () => {
      seedCollection(3);
      service.transactions.set([createTransaction({ id: 'txn-0' })]);

      await service.deleteAllTransactions();

      expect(service.transactions()).toEqual([]);
      expect(mockQuota.invalidateCount).toHaveBeenCalledTimes(1);
    });

    it('sweeps the receipt slots of every row that had images', async () => {
      mockFirestore.setMockCollection(path, [
        createTransaction({ id: 'txn-0' }),
        createTransaction({
          id: 'txn-1',
          receiptUrl: 'u0',
          receiptUrls: ['u0', 'u1'],
          receiptCount: 2
        })
      ]);

      await service.deleteAllTransactions();

      expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(1);
      expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
        'test-user-123', 'txn-1', [0, 1]
      ]);
    });

    // One refresh for the whole wipe, not one per row: the transactions page
    // reacts to every emission by refreshing its window.
    it('emits exactly one delete mutation for the whole wipe', async () => {
      seedCollection(4);

      await service.deleteAllTransactions();

      expect(service.lastMutation()?.kind).toBe('delete');
      expect(service.lastMutation()?.seq).toBe(1);
    });

    it('returns zero and emits nothing when there is nothing to delete', async () => {
      seedCollection(0);

      const deleted = await service.deleteAllTransactions();

      expect(deleted).toBe(0);
      expect(service.lastMutation()).toBeNull();
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

    it('leaves the shared transactions signal untouched', (done) => {
      service.getTransactions().subscribe(result => {
        expect(result.length).toBeGreaterThan(0);
        // Publishing belongs to getByDateRange alone; a bare query must not
        // move what the dashboard displays.
        expect(service.transactions()).toEqual([]);
        done();
      });
    });

    it('cannot repaint the dashboard from an importer-shaped narrow query', (done) => {
      // Duplicate detection and AI import both run getTransactions with their
      // own filters; neither may replace the published window. The min-amount
      // filter empties this result client-side, so a leaked write would blank
      // the signal and fail the equality below.
      service.getByDateRange(new Date(2020, 0, 1), new Date(2030, 11, 31)).subscribe(() => {
        const published = service.transactions();
        expect(published.length).toBeGreaterThan(0);

        service.getTransactions({ minAmount: 9_999_999 }).subscribe(result => {
          expect(result).toEqual([]);
          expect(service.transactions()).toEqual(published);
          done();
        });
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

    it('publishes the result to the shared transactions signal', (done) => {
      const transactions = createMixedTransactions();
      mockFirestore.setMockCollection('users/test-user-123/transactions', transactions);

      service.getByDateRange(new Date(2020, 0, 1), new Date(2030, 11, 31)).subscribe(result => {
        expect(result.length).toBeGreaterThan(0);
        expect(service.transactions()).toEqual(result);
        done();
      });
    });
  });

  describe('sign-out reset', () => {
    it('clears the published window and mutation marker on the signed-out edge', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', createMixedTransactions());

      service.getByDateRange(new Date(2020, 0, 1), new Date(2030, 11, 31)).subscribe(() => {
        expect(service.transactions().length).toBeGreaterThan(0);

        mockAuth.setMockUser(null);
        TestBed.tick();

        // The next account must never render this account's totals.
        expect(service.transactions()).toEqual([]);
        expect(service.lastMutation()).toBeNull();
        done();
      });
    });

    it('resets on the signed-out edge only, not on every account change', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', createMixedTransactions());

      service.getByDateRange(new Date(2020, 0, 1), new Date(2030, 11, 31)).subscribe(() => {
        const published = service.transactions();
        expect(published.length).toBeGreaterThan(0);

        // A direct non-null change (sign-in) must not blank a freshly
        // published window; Firebase always passes through null on the way
        // to a different account.
        mockAuth.setAuthenticated(true, 'another-user');
        TestBed.tick();

        expect(service.transactions()).toEqual(published);
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
