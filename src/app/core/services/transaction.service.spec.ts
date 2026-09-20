import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  TransactionService,
  RECEIPT_IMAGE_LIMIT_ERROR,
  RECEIPT_ATTACH_FAILED,
  GOAL_LINK_INVALID,
  SPLIT_REFUSED
} from './transaction.service';
import { CreateTransactionDTO, Goal, Transaction, TransactionFilters } from '../../models';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { BudgetService } from './budget.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import { MockStorageService } from './testing/mock-storage.service';
import {
  createBudget,
  createTransaction,
  createMixedTransactions
} from './testing/test-data';
import { Timestamp, deleteField } from '@angular/fire/firestore';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let mockStorage: MockStorageService;
  let mockQuota: jasmine.SpyObj<ReceiptQuotaService>;
  let currencyService: CurrencyService;

  beforeEach(() => {
    // A rates cache leaked from another spec file would win over the
    // constants under the initialization ladder and clobber the seeded
    // table below a microtask after the seed. Start clean.
    localStorage.removeItem('home-account.exchangeRates');

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

    // A restore rebuilds a stored row's DTO field by field (recurringId's
    // shape) rather than sourcing this from a split write, so the composer
    // has to carry it through the plain path too.
    it('carries splitGroupId onto the row the way recurringId does', async () => {
      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Restored split part',
        date: new Date(),
        splitGroupId: 'g1'
      });

      const written = mockFirestore.addDocumentSpy.mostRecent()?.args[1] as Record<string, unknown>;
      expect(written['splitGroupId']).toBe('g1');
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

    it('carries why the upload failed alongside the sentinel', async () => {
      // The sentinel is what every caller matches on, so it must not change;
      // the cause is what makes the next failure diagnosable instead of
      // reaching the user as "could not be saved" with no reason (#334).
      mockStorage.failFromSlot = 0;
      const files = [new File(['r0'], 'r0.jpg', { type: 'image/jpeg' })];

      const thrown = await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Upload refused',
        date: new Date(),
        receiptFiles: files
      }).then(() => null, (error: unknown) => error as Error);

      expect(thrown?.message).toBe(RECEIPT_ATTACH_FAILED);
      expect(thrown?.cause).toBeDefined();
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

    // A restore writes over rows that are still there, and a replacing write
    // erased the receipt fields they carried. Storage objects are reachable
    // only through the transaction that names them, so those bytes could
    // never be reclaimed by any delete path afterwards.
    it('merges at the caller-supplied id when the caller asks for it', async () => {
      await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Restored row',
          date: new Date()
        },
        { id: 'txn-42', merge: true }
      );

      expect(mockFirestore.setDocumentSpy.mostRecent()?.args[2]).toBeTrue();
    });

    it('replaces at the caller-supplied id by default', async () => {
      await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Replayed row',
          date: new Date()
        },
        { id: 'txn-42' }
      );

      expect(mockFirestore.setDocumentSpy.mostRecent()?.args[2]).toBeFalse();
    });

    // Without an id the write goes through addDocument, which has no merge to
    // pass — the flag would be dropped in silence, and silence is how the
    // receipt erasure survived a spec suite in the first place.
    it('refuses a merge with no id to merge into', async () => {
      await expectAsync(service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Nowhere to merge',
          date: new Date()
        },
        { merge: true }
      )).toBeRejected();

      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
      expect(mockFirestore.addDocumentSpy.calls.length).toBe(0);
    });

    // A goal link routes through createWithGoalLink, whose set() inside
    // runTransaction replaces the document outright — the merge would be
    // dropped and the row rewritten, which is the write being fixed.
    it('refuses a merge combined with a goal link', async () => {
      await expectAsync(service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Merge into a link',
          date: new Date(),
          goalId: 'g-1'
        },
        { id: 'txn-42', merge: true }
      )).toBeRejected();

      expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
    });

    // Stamping today restamped every pre-existing row, so restoring one file
    // twice produced different documents each time.
    it('writes a caller-supplied createdAt instead of stamping now', async () => {
      const stored = Timestamp.fromDate(new Date('2026-06-15T00:00:00Z'));

      await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Restored row',
          date: new Date()
        },
        { id: 'txn-42', merge: true, createdAt: stored }
      );

      const written = mockFirestore.setDocumentSpy.mostRecent()
        ?.args[1] as Record<string, unknown>;
      expect(written['createdAt']).toEqual(stored);
    });

    it('stamps createdAt when the caller supplies none', async () => {
      const before = Timestamp.now().toMillis();

      await service.addTransaction({
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'A fresh row',
        date: new Date()
      });

      const written = mockFirestore.addDocumentSpy.mostRecent()
        ?.args[1] as Record<string, unknown>;
      expect((written['createdAt'] as Timestamp).toMillis()).toBeGreaterThanOrEqual(before);
    });

    it('writes receipts under the caller-chosen id', async () => {
      spyOn(mockFirestore, 'generateId').and.callThrough();
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Receipt at a chosen id',
          date: new Date(),
          receiptFiles: [receiptFile]
        },
        { id: 'img_1-0' }
      );

      // The caller's id is as good a storage-slot key as a generated one —
      // the object path is the id either way — so a replayed queue row
      // re-uploads into the same slot instead of a fresh, orphaned one.
      expect(mockStorage.uploadReceiptSpy.mostRecent()?.args[1]).toBe('img_1-0');
      expect(mockFirestore.setDocumentSpy.mostRecent()?.args[0]).toMatch(/\/img_1-0$/);
      const written = mockFirestore.setDocumentSpy.mostRecent()
        ?.args[1] as Record<string, unknown>;
      expect((written['receiptUrls'] as string[]).length).toBe(1);
      expect(mockFirestore.generateId).not.toHaveBeenCalled();
    });

    it('refuses a merge write with receipt files', async () => {
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

      await expectAsync(service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Receipt at a chosen id, merged',
          date: new Date(),
          receiptFiles: [receiptFile]
        },
        { id: 'img_1-0', merge: true }
      )).toBeRejectedWithError('A merge write cannot be combined with receipt files');

      // A merge is a restore's write and carries URLs, never files; honouring
      // it here would re-point receiptUrls at slot 0 over stale keys.
      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
      expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);
    });

    it('a replay uploads into the same slot', async () => {
      const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });
      const dto: CreateTransactionDTO = {
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'food',
        description: 'Replayed queue row',
        date: new Date(),
        receiptFiles: [receiptFile]
      };

      await service.addTransaction(dto, { id: 'img_1-0' });
      await service.addTransaction(dto, { id: 'img_1-0' });

      expect(mockStorage.uploadReceiptSpy.calls.length).toBe(2);
      expect(mockStorage.uploadReceiptSpy.calls[0].args[1]).toBe('img_1-0');
      expect(mockStorage.uploadReceiptSpy.calls[1].args[1]).toBe('img_1-0');
      expect(mockStorage.uploadReceiptSpy.calls[0].args[3]).toBe(0);
      expect(mockStorage.uploadReceiptSpy.calls[1].args[3]).toBe(0);
    });

    it('recalculates affected budgets after posting an expense', async () => {
      // Seed only the collection: the recalculation enumerates it, so an
      // empty budgets signal (a session that never mounted the dashboard)
      // must not stop the spent update.
      const budget = createBudget({ id: 'b1', categoryId: 'food' });
      mockFirestore.setMockCollection('users/test-user-123/budgets', [budget]);
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

    it('leaves the recalculation to the caller when skipBudgetRecalc is set', async () => {
      const budget = createBudget({ id: 'b1', categoryId: 'food' });
      mockFirestore.setMockCollection('users/test-user-123/budgets', [budget]);
      mockFirestore.setMockDocument('users/test-user-123/budgets/b1', budget);

      await service.addTransaction(
        {
          type: 'expense',
          amount: 100,
          currency: 'USD',
          categoryId: 'food',
          description: 'Groceries',
          date: new Date()
        },
        { skipBudgetRecalc: true }
      );

      const budgetUpdate = mockFirestore.updateDocumentSpy.calls.find(
        c => c.args[0] === 'users/test-user-123/budgets/b1'
      );
      expect(budgetUpdate).toBeUndefined();
    });
  });

  describe('hasTransaction', () => {
    it('reports whether a document exists at the id', async () => {
      mockFirestore.setMockDocument(
        'users/test-user-123/transactions/txn-1',
        createTransaction({ id: 'txn-1' })
      );

      await expectAsync(service.hasTransaction('txn-1')).toBeResolvedTo(true);
      await expectAsync(service.hasTransaction('txn-404')).toBeResolvedTo(false);
    });
  });

  describe('getTransactionOnce', () => {
    it('reads through getDocument at the transaction path, never subscribeToDocument', async () => {
      const txn = createTransaction({ id: 'txn-1' });
      mockFirestore.setMockDocument('users/test-user-123/transactions/txn-1', txn);

      const result = await service.getTransactionOnce('txn-1');

      expect(result).toEqual(txn);
      expect(mockFirestore.getDocumentSpy.mostRecent()?.args[0])
        .toBe('users/test-user-123/transactions/txn-1');
      expect(mockFirestore.subscribeToDocumentSpy.calls.length).toBe(0);
    });

    it('maps a missing document to null', async () => {
      const result = await service.getTransactionOnce('txn-404');

      expect(result).toBeNull();
    });

    it('resolves null signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.getTransactionOnce('txn-1');

      expect(result).toBeNull();
      expect(mockFirestore.getDocumentSpy.calls.length).toBe(0);
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

      // First call: the wipe's enumeration (the goal-counter sweep queries
      // the goals collection afterwards).
      expect(mockFirestore.getCollectionSpy.calls[0]?.args[0]).toBe(path);
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

    it('zeroes every goal counter the wipe orphaned', async () => {
      seedCollection(1);
      mockFirestore.setMockCollection('users/test-user-123/goals', [
        { id: 'g1', linkedAmount: 50 },
        { id: 'g2', linkedAmount: 0 },
        { id: 'g3' } // pre-link document: nothing to zero
      ]);

      await service.deleteAllTransactions();

      const goalWrites = mockFirestore.updateDocumentSpy.calls
        .filter(c => (c.args[0] as string).startsWith('users/test-user-123/goals/'));
      expect(goalWrites.map(c => c.args[0])).toEqual(['users/test-user-123/goals/g1']);
      expect(goalWrites[0].args[1]).toEqual({ linkedAmount: 0 });
    });
  });

  describe('exportAll', () => {
    const path = 'users/test-user-123/transactions';

    it('returns every row through the server-only read, newest first', async () => {
      const transactions = createMixedTransactions();
      mockFirestore.setMockCollection(path, transactions);

      const result = await service.exportAll();

      expect(result).toEqual(transactions);
      const call = mockFirestore.getCollectionFromServerSpy.mostRecent();
      expect(call?.args[0]).toBe(path);
      expect(call?.args[1]).toEqual({ orderBy: [{ field: 'date', direction: 'desc' }] });
      // The export used to take a live listener's first emission, which a
      // warm cache serves as whatever subset the session browsed. It must
      // never open a listener at all.
      expect(mockFirestore.subscribeToCollectionSpy.calls.length).toBe(0);
    });

    it('is immune to a live source that would emit a partial window first', async () => {
      const all = createMixedTransactions();
      mockFirestore.setMockCollection(path, all);
      // A warm cache's listener raises a partial snapshot before the server
      // one; prove the export never consults any listener.
      const listener = spyOn(mockFirestore, 'subscribeToCollection')
        .and.returnValue(of(all.slice(0, 1)));

      const result = await service.exportAll();

      expect(result).toEqual(all);
      expect(listener).not.toHaveBeenCalled();
    });

    it('resolves empty signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.exportAll();

      expect(result).toEqual([]);
      expect(mockFirestore.getCollectionFromServerSpy.calls.length).toBe(0);
    });

    it('propagates a server-read failure instead of resolving a subset', async () => {
      // Offline, getDocsFromServer rejects; the export must surface that so
      // the backup reports failure rather than success on partial data.
      spyOn(mockFirestore, 'getCollectionFromServer')
        .and.rejectWith(new Error('unavailable'));

      await expectAsync(service.exportAll()).toBeRejected();
    });
  });

  describe('getTransactionsInRangeOnce', () => {
    const path = 'users/test-user-123/transactions';
    const start = new Date(2026, 7, 1);
    const end = new Date(2026, 7, 31);

    // The smart-search aggregate is computed from these rows and then
    // persisted — recordAnswer on a live search, refreshAnswer on a Refresh.
    // It used to await one emission of the live listener, which a warm cache
    // serves as whatever window the session browsed; on a page that never
    // browsed this range that is empty, so Refresh wrote a zeroed answer back
    // over a good one. See docs/one-shot-reads.md.
    it('enumerates the collection without opening a listener', async () => {
      const rows = [
        createTransaction({ id: 'txn-a', date: Timestamp.fromDate(new Date(2026, 7, 3)) }),
        createTransaction({ id: 'txn-b', date: Timestamp.fromDate(new Date(2026, 7, 9)) }),
      ];
      mockFirestore.setMockCollection(path, rows);

      const result = await service.getTransactionsInRangeOnce(start, end);

      expect(result).toEqual(rows);
      expect(mockFirestore.getCollectionSpy.mostRecent()?.args[0]).toBe(path);
      expect(mockFirestore.subscribeToCollectionSpy.calls.length).toBe(0);
    });

    // Plain getCollection, not the server-only variant: a stored answer is a
    // snapshot the user can refresh again, so nothing here gates an
    // irreversible action and an offline replay may answer from the cache.
    it('reads through getCollection rather than the server-only variant', async () => {
      mockFirestore.setMockCollection(path, []);

      await service.getTransactionsInRangeOnce(start, end);

      expect(mockFirestore.getCollectionSpy.calls.length).toBe(1);
      expect(mockFirestore.getCollectionFromServerSpy.calls.length).toBe(0);
    });

    // One options builder feeds both variants so the queries cannot drift.
    it('queries the same window as the live variant', async () => {
      mockFirestore.setMockCollection(path, []);

      await service.getTransactionsInRangeOnce(start, end);
      service.getTransactionsInRange(start, end).subscribe().unsubscribe();

      expect(mockFirestore.getCollectionSpy.mostRecent()?.args[1])
        .toEqual(mockFirestore.subscribeToCollectionSpy.mostRecent()?.args[1]);
    });

    it('resolves empty signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.getTransactionsInRangeOnce(start, end);

      expect(result).toEqual([]);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });
  });

  describe('getTransactionsInRangeFromServer', () => {
    const path = 'users/test-user-123/transactions';
    const start = new Date(2026, 7, 1);
    const end = new Date(2026, 7, 31);

    it('reads through the server-only variant, never getCollection', async () => {
      const rows = [createTransaction({ id: 'txn-a' })];
      mockFirestore.setMockCollection(path, rows);

      const result = await service.getTransactionsInRangeFromServer(start, end);

      expect(result).toEqual(rows);
      expect(mockFirestore.getCollectionFromServerSpy.calls.length).toBe(1);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });

    // One options builder feeds the listener and both one-shot variants so
    // none of the three queries can drift apart.
    it('queries the same window as the live listener and the cache-tolerant one-shot', async () => {
      mockFirestore.setMockCollection(path, []);

      await service.getTransactionsInRangeFromServer(start, end);
      await service.getTransactionsInRangeOnce(start, end);
      service.getTransactionsInRange(start, end).subscribe().unsubscribe();

      const serverOptions = mockFirestore.getCollectionFromServerSpy.mostRecent()?.args[1];
      expect(serverOptions).toEqual(mockFirestore.getCollectionSpy.mostRecent()?.args[1]);
      expect(serverOptions).toEqual(mockFirestore.subscribeToCollectionSpy.mostRecent()?.args[1]);
    });

    it('resolves empty signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.getTransactionsInRangeFromServer(start, end);

      expect(result).toEqual([]);
      expect(mockFirestore.getCollectionFromServerSpy.calls.length).toBe(0);
    });
  });

  describe('goal links', () => {
    const TX = 'users/test-user-123/transactions';
    const GOALS = 'users/test-user-123/goals';

    function seedGoal(id: string, overrides: Partial<Goal> = {}): void {
      mockFirestore.setMockDocument(`${GOALS}/${id}`, {
        id,
        userId: 'test-user-123',
        kind: 'saving',
        name: 'Emergency fund',
        targetAmount: 1000,
        contributedAmount: 0,
        linkedAmount: 0,
        currency: 'EUR',
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...overrides
      });
    }

    async function goalDoc(id: string): Promise<Record<string, unknown> | null> {
      return mockFirestore.getDocument<Record<string, unknown>>(`${GOALS}/${id}`);
    }

    const dto = (goalId?: string) => ({
      type: 'expense' as const,
      amount: 100,
      currency: 'USD',
      categoryId: 'food_restaurants',
      description: 'Transfer to savings',
      date: new Date(),
      ...(goalId ? { goalId } : {})
    });

    describe('addTransaction', () => {
      it('commits the linked row and the converted counter in one transaction', async () => {
        seedGoal('g1', { linkedAmount: 10 });

        const id = await service.addTransaction(dto('g1'));

        // The linked path never uses the plain writes.
        expect(mockFirestore.addDocumentSpy.calls.length).toBe(0);
        expect(mockFirestore.setDocumentSpy.calls.length).toBe(0);

        const [rowPath, written] =
          (mockFirestore.txSetSpy.mostRecent()?.args ?? []) as [string, Record<string, unknown>];
        expect(rowPath).toBe(`${TX}/${id}`);
        expect(written['goalId']).toBe('g1');
        // 100 USD into a EUR goal at the seeded 0.92.
        expect(written['goalAmount']).toBe(92);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(102);
      });

      it('rejects a link to a goal that does not exist, writing nothing', async () => {
        await expectAsync(service.addTransaction(dto('missing')))
          .toBeRejectedWithError(GOAL_LINK_INVALID);
        expect(mockFirestore.txSetSpy.calls.length).toBe(0);
        expect(service.isLoading()).toBeFalse();
      });

      it('rejects a link to a deactivated goal', async () => {
        seedGoal('g1', { isActive: false });

        await expectAsync(service.addTransaction(dto('g1')))
          .toBeRejectedWithError(GOAL_LINK_INVALID);
        expect(mockFirestore.txSetSpy.calls.length).toBe(0);
      });

      it('writes a goal snapshot verbatim without touching any counter', async () => {
        seedGoal('g1', { linkedAmount: 10 });

        await service.addTransaction(dto(), {
          id: 'restored-1',
          goalSnapshot: { goalId: 'g1', goalAmount: 55 }
        });

        // The verbatim path is a plain set — no transaction, no counter.
        expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
        const written =
          mockFirestore.setDocumentSpy.mostRecent()?.args[1] as Record<string, unknown>;
        expect(written['goalId']).toBe('g1');
        expect(written['goalAmount']).toBe(55);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(10);
      });

      it('refuses a goal snapshot alongside a live link', async () => {
        seedGoal('g1');

        await expectAsync(
          service.addTransaction(dto('g1'), {
            id: 'restored-1',
            goalSnapshot: { goalId: 'g1', goalAmount: 55 }
          })
        ).toBeRejected();
      });
    });

    describe('updateTransaction', () => {
      function seedRow(overrides: Partial<Transaction> = {}): void {
        mockFirestore.setMockDocument(
          `${TX}/txn-1`,
          createTransaction({ id: 'txn-1', ...overrides })
        );
      }

      function rowUpdatePayload(): Record<string, unknown> {
        const call = mockFirestore.txUpdateSpy.calls
          .find(c => c.args[0] === `${TX}/txn-1`);
        return (call?.args[1] ?? {}) as Record<string, unknown>;
      }

      function goalUpdatePayload(goalId: string): Record<string, unknown> | undefined {
        const call = mockFirestore.txUpdateSpy.calls
          .find(c => c.args[0] === `${GOALS}/${goalId}`);
        return call?.args[1] as Record<string, unknown> | undefined;
      }

      it('links an existing row, converting at the goal currency', async () => {
        seedRow();
        seedGoal('g1', { linkedAmount: 8 });

        await service.updateTransaction('txn-1', { goalId: 'g1' });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toBe('g1');
        expect(payload['goalAmount']).toBe(92);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(100);
      });

      it('unlinks by clearing the pair and backing the stored figure out', async () => {
        seedRow({ goalId: 'g1', goalAmount: 92 });
        seedGoal('g1', { linkedAmount: 100 });

        await service.updateTransaction('txn-1', { goalId: undefined });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toEqual(deleteField());
        expect(payload['goalAmount']).toEqual(deleteField());
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(8);
      });

      it('re-snapshots the stored figure when the amount changes', async () => {
        seedRow({ goalId: 'g1', goalAmount: 92 });
        seedGoal('g1', { linkedAmount: 92 });

        await service.updateTransaction('txn-1', { amount: 200 });

        expect(rowUpdatePayload()['goalAmount']).toBe(184);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(184);
      });

      it('leaves the stored figure alone when the edit touches neither amount nor currency', async () => {
        seedRow({ goalId: 'g1', goalAmount: 92 });
        seedGoal('g1', { linkedAmount: 92 });

        await service.updateTransaction('txn-1', { note: 'monthly top-up' });

        // A conversion at today's rates would move a counter the user never
        // touched; the link must ride along unchanged.
        expect('goalAmount' in rowUpdatePayload()).toBeFalse();
        expect(goalUpdatePayload('g1')).toBeUndefined();
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(92);
      });

      it('moves the figure between goals on a switch, each in its own currency', async () => {
        seedRow({ goalId: 'g1', goalAmount: 92 });
        seedGoal('g1', { linkedAmount: 92 });
        seedGoal('g2', { currency: 'USD', linkedAmount: 5 });

        await service.updateTransaction('txn-1', { goalId: 'g2' });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toBe('g2');
        expect(payload['goalAmount']).toBe(100);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(0);
        expect((await goalDoc('g2'))?.['linkedAmount']).toBe(105);
      });

      it('rejects a new link to a missing or inactive goal and commits nothing', async () => {
        seedRow();
        seedGoal('g1', { isActive: false });

        await expectAsync(service.updateTransaction('txn-1', { goalId: 'g1' }))
          .toBeRejectedWithError(GOAL_LINK_INVALID);
        // The aborted transaction committed nothing to the row either.
        const row = await mockFirestore.getDocument<Transaction>(`${TX}/txn-1`);
        expect(row?.goalId).toBeUndefined();
      });

      it('clamps a back-out at zero rather than blocking the edit', async () => {
        seedRow({ goalId: 'g1', goalAmount: 92 });
        seedGoal('g1', { linkedAmount: 50 }); // drifted below the stored figure

        await service.updateTransaction('txn-1', { goalId: undefined });

        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(0);
      });

      it('tolerates unlinking from a goal that no longer exists', async () => {
        seedRow({ goalId: 'gone', goalAmount: 92 });

        await service.updateTransaction('txn-1', { goalId: undefined });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toEqual(deleteField());
        expect(payload['goalAmount']).toEqual(deleteField());
      });

      it('finishes a raced deleteGoal sweep instead of resurrecting the link', async () => {
        seedRow({ goalId: 'gone', goalAmount: 92 });

        await service.updateTransaction('txn-1', { amount: 200 });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toEqual(deleteField());
        expect(payload['goalAmount']).toEqual(deleteField());
      });

      it('carries a link transition through a receipt append in the same commit', async () => {
        seedRow();
        seedGoal('g1', { linkedAmount: 8 });
        const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

        await service.updateTransaction('txn-1', {
          goalId: 'g1',
          receiptFiles: [receiptFile]
        });

        const payload = rowUpdatePayload();
        expect(payload['goalId']).toBe('g1');
        expect(payload['goalAmount']).toBe(92);
        expect(payload['receiptCount']).toBe(1);
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(100);
      });

      it('sweeps uploaded receipts when the link in the same update is invalid', async () => {
        seedRow();
        const receiptFile = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });

        await expectAsync(
          service.updateTransaction('txn-1', {
            goalId: 'missing',
            receiptFiles: [receiptFile]
          })
        ).toBeRejectedWithError(GOAL_LINK_INVALID);

        // The upload landed before the aborted transaction; nothing
        // references it, so it must be swept like any failed attach.
        expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(1);
        expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args).toEqual([
          'test-user-123', 'txn-1', [0]
        ]);
        expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();
      });
    });

    describe('deleteTransaction', () => {
      it('backs the stored figure out in the same commit as the delete', async () => {
        mockFirestore.setMockDocument(
          `${TX}/txn-1`,
          createTransaction({ id: 'txn-1', goalId: 'g1', goalAmount: 92 })
        );
        seedGoal('g1', { linkedAmount: 100 });

        await service.deleteTransaction('txn-1');

        expect(await mockFirestore.getDocument(`${TX}/txn-1`)).toBeNull();
        expect((await goalDoc('g1'))?.['linkedAmount']).toBe(8);
        // The linked path deletes inside the transaction, not via the
        // plain (offline-capable) helper.
        expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(0);
      });

      it('deletes a linked row even when its goal is already gone', async () => {
        mockFirestore.setMockDocument(
          `${TX}/txn-1`,
          createTransaction({ id: 'txn-1', goalId: 'gone', goalAmount: 92 })
        );

        await service.deleteTransaction('txn-1');

        expect(await mockFirestore.getDocument(`${TX}/txn-1`)).toBeNull();
      });

      it('keeps the plain delete path for unlinked rows', async () => {
        mockFirestore.setMockDocument(`${TX}/txn-1`, createTransaction({ id: 'txn-1' }));

        await service.deleteTransaction('txn-1');

        expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(1);
        expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
      });
    });
  });

  /**
   * The guards in updateTransaction ask "did this change?" and the answer has
   * to come from the stored row, because the only editor the app ships sends
   * every key on every edit. Specs that call updateTransaction with a narrow
   * object ({ note }) prove the guards against a shape the app never produces.
   * Everything here drives the literal DTO TransactionForm.onSubmit builds.
   */
  describe('the edit DTO the transaction form actually sends', () => {
    const TX = 'users/test-user-123/transactions';
    const GOALS = 'users/test-user-123/goals';

    /**
     * TransactionForm.onSubmit, edit branch: type/amount/currency/categoryId/
     * description/date always, and period, goalId, tags and location always
     * travelling too — an omitted key would leave a cleared select at its old
     * value, so the form installs them even when they are empty.
     */
    function formEditDto(
      overrides: Partial<CreateTransactionDTO> = {}
    ): CreateTransactionDTO {
      return {
        type: 'expense',
        amount: 100,
        currency: 'EUR',
        categoryId: 'food_restaurants',
        description: 'Dinner in Lisbon, with Ana',
        date: new Date(),
        period: undefined,
        goalId: undefined,
        tags: [],
        location: undefined,
        ...overrides
      };
    }

    /** A row written in March, when EUR bought 1.08 dollars. */
    function seedMarchRow(overrides: Partial<Transaction> = {}): void {
      mockFirestore.setMockDocument(
        `${TX}/txn-1`,
        createTransaction({
          id: 'txn-1',
          amount: 100,
          currency: 'EUR',
          exchangeRate: 1.08,
          amountInBaseCurrency: 108,
          baseCurrency: 'USD',
          description: 'Dinner in Lisbon',
          ...overrides
        })
      );
    }

    function seedGoal(id: string, overrides: Partial<Goal> = {}): void {
      mockFirestore.setMockDocument(`${GOALS}/${id}`, {
        id,
        userId: 'test-user-123',
        kind: 'saving',
        name: 'Emergency fund',
        targetAmount: 1000,
        contributedAmount: 0,
        linkedAmount: 0,
        currency: 'USD',
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...overrides
      });
    }

    function plainUpdatePayload(): Record<string, unknown> {
      const call = mockFirestore.updateDocumentSpy.calls
        .find(c => c.args[0] === `${TX}/txn-1`);
      return (call?.args[1] ?? {}) as Record<string, unknown>;
    }

    function rowUpdatePayload(): Record<string, unknown> {
      const call = mockFirestore.txUpdateSpy.calls
        .find(c => c.args[0] === `${TX}/txn-1`);
      return (call?.args[1] ?? {}) as Record<string, unknown>;
    }

    function goalUpdatePayload(goalId: string): Record<string, unknown> | undefined {
      const call = mockFirestore.txUpdateSpy.calls
        .find(c => c.args[0] === `${GOALS}/${goalId}`);
      return call?.args[1] as Record<string, unknown> | undefined;
    }

    async function goalDoc(id: string): Promise<Record<string, unknown> | null> {
      return mockFirestore.getDocument<Record<string, unknown>>(`${GOALS}/${id}`);
    }

    beforeEach(async () => {
      // The constructor starts a rates refresh; its stubbed fetch rejects and
      // the fallback writes the compiled-in table on a later microtask. Let
      // that land before seeding, or it overwrites the rates below — the
      // blocks above only survive it because 0.92 is also the compiled-in EUR.
      await new Promise(resolve => setTimeout(resolve, 0));
      // Rates have moved since the row was written: EUR now buys 1.25 dollars,
      // so any recomputation shows up rather than reproducing the stored figure.
      currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.8]]));
    });

    it('leaves the money snapshot alone when only the description changed', async () => {
      seedMarchRow();

      await service.updateTransaction('txn-1', formEditDto());

      const payload = plainUpdatePayload();
      expect(payload['description']).toBe('Dinner in Lisbon, with Ana');
      // The five fields the snapshot is made of, none of them this edit's business.
      expect('exchangeRate' in payload).toBeFalse();
      expect('amountInBaseCurrency' in payload).toBeFalse();
      expect('baseCurrency' in payload).toBeFalse();
      expect('amount' in payload).toBeFalse();
      expect('currency' in payload).toBeFalse();
    });

    it('leaves the goal counter alone when only the description changed', async () => {
      seedMarchRow({ goalId: 'g1', goalAmount: 108 });
      seedGoal('g1', { linkedAmount: 108 });

      await service.updateTransaction('txn-1', formEditDto({ goalId: 'g1' }));

      expect('goalAmount' in rowUpdatePayload()).toBeFalse();
      expect(goalUpdatePayload('g1')).toBeUndefined();
      expect((await goalDoc('g1'))?.['linkedAmount']).toBe(108);
    });

    it('re-snapshots both figures when the amount really changed', async () => {
      seedMarchRow({ goalId: 'g1', goalAmount: 108 });
      seedGoal('g1', { linkedAmount: 108 });

      await service.updateTransaction('txn-1', formEditDto({ amount: 200, goalId: 'g1' }));

      const payload = rowUpdatePayload();
      expect(payload['amount']).toBe(200);
      expect(payload['currency']).toBe('EUR');
      expect(payload['exchangeRate']).toBe(1.25);
      expect(payload['amountInBaseCurrency']).toBe(250);
      expect(payload['baseCurrency']).toBe('USD');
      expect(payload['goalAmount']).toBe(250);
      expect((await goalDoc('g1'))?.['linkedAmount']).toBe(250);
    });

    it('re-snapshots when only the currency changed', async () => {
      seedMarchRow();

      await service.updateTransaction('txn-1', formEditDto({ currency: 'USD' }));

      const payload = plainUpdatePayload();
      expect(payload['currency']).toBe('USD');
      expect(payload['exchangeRate']).toBe(1);
      expect(payload['amountInBaseCurrency']).toBe(100);
    });

    it('keeps an unlinked edit on the offline-capable write', async () => {
      seedMarchRow();

      await service.updateTransaction('txn-1', formEditDto());

      // runTransaction rejects while offline; an edit that cannot move a
      // counter has no business needing the network. Staying off it is also
      // what makes the save one document read instead of two — the second
      // read only exists to re-read the row inside the transaction.
      expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(1);
    });

    it('still routes a linked edit through the transaction', async () => {
      seedMarchRow({ goalId: 'g1', goalAmount: 108 });
      seedGoal('g1', { linkedAmount: 108 });

      await service.updateTransaction('txn-1', formEditDto({ amount: 200, goalId: 'g1' }));

      expect(mockFirestore.runTransactionSpy.calls.length).toBe(1);
      expect(mockFirestore.updateDocumentSpy.calls.length).toBe(0);
    });

    it('still unlinks when the goal select is cleared', async () => {
      seedMarchRow({ goalId: 'g1', goalAmount: 108 });
      seedGoal('g1', { linkedAmount: 108 });

      await service.updateTransaction('txn-1', formEditDto({ goalId: undefined }));

      const payload = rowUpdatePayload();
      expect(payload['goalId']).toEqual(deleteField());
      expect(payload['goalAmount']).toEqual(deleteField());
      expect((await goalDoc('g1'))?.['linkedAmount']).toBe(0);
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
        const callArgs = mockFirestore.subscribeToCollectionSpy.mostRecent()?.args ?? [];
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

  describe('getTransactionsOnce', () => {
    const path = 'users/test-user-123/transactions';

    // One options builder feeds getTransactions and this one-shot sibling,
    // so a caller that persists or counts the result reads exactly the query
    // the listener would have opened.
    it('queries the same path and options as the live listener', async () => {
      mockFirestore.setMockCollection(path, []);
      const filters: TransactionFilters = {
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 7, 31),
        type: 'expense',
        categoryId: 'food_restaurants'
      };

      await service.getTransactionsOnce(filters);
      service.getTransactions(filters).subscribe().unsubscribe();

      const onceCall = mockFirestore.getCollectionSpy.mostRecent();
      const liveCall = mockFirestore.subscribeToCollectionSpy.mostRecent();
      expect(onceCall?.args[0]).toBe(path);
      expect(onceCall?.args).toEqual(liveCall?.args);
    });

    it('applies the same client-side filters as the live listener', async () => {
      const rows = [
        createTransaction({ id: 'txn-a', amount: 10 }),
        createTransaction({ id: 'txn-b', amount: 500 })
      ];
      mockFirestore.setMockCollection(path, rows);

      const result = await service.getTransactionsOnce({ minAmount: 100 });

      // The amount filter is client-side (applyClientTransactionFilters);
      // the low-amount row must be dropped, not just excluded server-side.
      expect(result).toEqual([rows[1]]);
    });

    it('resolves empty signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.getTransactionsOnce();

      expect(result).toEqual([]);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });
  });

  describe('getByDateRange', () => {
    it('should call getTransactions with date filters', (done) => {
      const start = new Date(2024, 0, 1);
      const end = new Date(2024, 11, 31);

      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getByDateRange(start, end).subscribe(() => {
        expect(mockFirestore.subscribeToCollectionSpy.calls.length).toBeGreaterThan(0);
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
        const callArgs = mockFirestore.subscribeToCollectionSpy.mostRecent()?.args ?? [];
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

  describe('getTransactionsWithReceiptsOnce', () => {
    const path = 'users/test-user-123/transactions';

    it('queries the same where clause as the live listener', async () => {
      mockFirestore.setMockCollection(path, []);

      await service.getTransactionsWithReceiptsOnce();
      service.getTransactionsWithReceipts().subscribe().unsubscribe();

      expect(mockFirestore.getCollectionSpy.mostRecent()?.args[1])
        .toEqual(mockFirestore.subscribeToCollectionSpy.mostRecent()?.args[1]);
    });

    it('sorts newest first like the listener, regardless of storage order', async () => {
      const older = createTransaction({
        id: 'txn-old',
        date: Timestamp.fromDate(new Date(2026, 0, 1)),
        receiptUrl: 'https://storage.example.com/old.jpg'
      });
      const newer = createTransaction({
        id: 'txn-new',
        date: Timestamp.fromDate(new Date(2026, 5, 1)),
        receiptUrl: 'https://storage.example.com/new.jpg'
      });
      // Seeded oldest-first, out of the order the read must return.
      mockFirestore.setMockCollection(path, [older, newer]);

      const result = await service.getTransactionsWithReceiptsOnce();

      expect(result).toEqual([newer, older]);
    });

    it('resolves empty signed out without touching the database', async () => {
      mockAuth.setMockUser(null);

      const result = await service.getTransactionsWithReceiptsOnce();

      expect(result).toEqual([]);
      expect(mockFirestore.getCollectionSpy.calls.length).toBe(0);
    });
  });

  describe('getByCategory', () => {
    it('should call getTransactions with category filter', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getByCategory('food').subscribe(() => {
        expect(mockFirestore.subscribeToCollectionSpy.calls.length).toBeGreaterThan(0);
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
        const callArgs = mockFirestore.subscribeToCollectionSpy.mostRecent()?.args ?? [];
        const options = callArgs[1] as Record<string, unknown> | undefined;
        expect(options?.['limit']).toBe(5);
        done();
      });
    });

    it('should default to 10 transactions', (done) => {
      mockFirestore.setMockCollection('users/test-user-123/transactions', []);

      service.getRecentTransactions().subscribe(() => {
        const callArgs = mockFirestore.subscribeToCollectionSpy.mostRecent()?.args ?? [];
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

// Sibling block on purpose: the block above stubs ensureRatesLoaded away and
// hand-seeds the rate table, and both would hide exactly the defect these
// specs pin down — the write path's guard resolving onto an unusable table
// when the rates API answers HTTP 200 with an error body. Here the real
// CurrencyService runs its whole initialization chain.
describe('TransactionService when the rates API answers with an error body', () => {
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const TX = 'users/test-user-123/transactions';
  const GOALS = 'users/test-user-123/goals';

  let service: TransactionService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let mockStorage: MockStorageService;
  let mockQuota: jasmine.SpyObj<ReceiptQuotaService>;

  beforeEach(() => {
    // No cache on the device: the ladder must end on the compiled-in
    // constants (JPY at 149.5), which the conversions below assert against.
    localStorage.removeItem(RATES_CACHE_KEY);

    // The in-band failure shape open.er-api.com actually produces. A fresh
    // Response per call, since json() is single-use.
    spyOn(window, 'fetch').and.callFake(async () =>
      new Response(
        JSON.stringify({ result: 'error', 'error-type': 'rate-limited' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    mockQuota = jasmine.createSpyObj<ReceiptQuotaService>('ReceiptQuotaService', [
      'canAddImages', 'noteImagesAdded', 'noteImagesRemoved', 'invalidateCount',
    ]);
    mockQuota.canAddImages.and.resolveTo(true);

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
    service = TestBed.inject(TransactionService);

    mockAuth.setAuthenticated(true);
  });

  afterEach(() => {
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
    mockStorage.clearMocks();
    localStorage.removeItem(RATES_CACHE_KEY);
  });

  it('persists a JPY row converted through the fallback table, not 1:1', async () => {
    await service.addTransaction({
      type: 'expense',
      amount: 1000,
      currency: 'JPY',
      categoryId: 'food_restaurants',
      description: 'Ramen',
      date: new Date()
    });

    const written =
      mockFirestore.addDocumentSpy.mostRecent()?.args[1] as Record<string, unknown>;
    expect(written['exchangeRate']).toBeCloseTo(1 / 149.5, 6);
    expect(written['exchangeRate']).not.toBe(1);
    expect(written['amountInBaseCurrency']).toBeCloseTo(1000 / 149.5, 2);
    expect(written['amountInBaseCurrency']).not.toBe(1000);
    expect(written['baseCurrency']).toBe('USD');
  });

  it('moves a USD goal counter by the converted figure for a JPY link', async () => {
    mockFirestore.setMockDocument(`${GOALS}/g1`, {
      id: 'g1',
      userId: 'test-user-123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 1000,
      contributedAmount: 0,
      linkedAmount: 0,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    const id = await service.addTransaction({
      type: 'expense',
      amount: 1000,
      currency: 'JPY',
      categoryId: 'food_restaurants',
      description: 'Transfer to savings',
      date: new Date(),
      goalId: 'g1'
    });

    const [rowPath, row] =
      (mockFirestore.txSetSpy.mostRecent()?.args ?? []) as [string, Record<string, unknown>];
    expect(rowPath).toBe(`${TX}/${id}`);
    // roundMoney(1000 × 1/149.5): the converted figure, not the raw JPY —
    // the raw figure is the ~150x goal overstatement this path used to write.
    expect(row['goalAmount']).toBeCloseTo(6.69, 2);
    expect(row['goalAmount']).not.toBe(1000);

    const goal = await mockFirestore.getDocument<Record<string, unknown>>(`${GOALS}/g1`);
    expect(goal?.['linkedAmount']).toBeCloseTo(6.69, 2);
    expect(goal?.['linkedAmount']).not.toBe(1000);
  });
});

// Its own top-level harness (the JPY describe's own precedent above): the
// main suite's budget case lets the real BudgetService run against the
// mock and asserts on the budget document that produces, so a spy there
// would silently stop proving what that case exists to prove.
describe('TransactionService addSplitTransaction', () => {
  const TX = 'users/test-user-123/transactions';

  let service: TransactionService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;
  let mockStorage: MockStorageService;
  let mockQuota: jasmine.SpyObj<ReceiptQuotaService>;
  let mockBudget: jasmine.SpyObj<BudgetService>;
  let currencyService: CurrencyService;

  function dto(
    amount: number,
    categoryId: string,
    overrides: Partial<CreateTransactionDTO> = {}
  ): CreateTransactionDTO {
    return {
      type: 'expense',
      amount,
      currency: 'USD',
      categoryId,
      description: 'Weekend shopping',
      date: new Date('2026-06-01'),
      note: 'Paid by card',
      tags: ['errand'],
      period: 'monthly',
      location: { name: 'Costco' },
      ...overrides
    };
  }

  beforeEach(() => {
    localStorage.removeItem('home-account.exchangeRates');

    mockQuota = jasmine.createSpyObj<ReceiptQuotaService>('ReceiptQuotaService', [
      'canAddImages', 'noteImagesAdded', 'noteImagesRemoved', 'invalidateCount',
    ]);
    mockQuota.canAddImages.and.resolveTo(true);
    mockBudget = jasmine.createSpyObj<BudgetService>('BudgetService', ['recalculateBudgetsForCategory']);
    mockBudget.recalculateBudgetsForCategory.and.resolveTo();

    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        CurrencyService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService },
        { provide: StorageService, useClass: MockStorageService },
        { provide: ReceiptQuotaService, useValue: mockQuota },
        { provide: BudgetService, useValue: mockBudget }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    mockStorage = TestBed.inject(StorageService) as unknown as MockStorageService;
    currencyService = TestBed.inject(CurrencyService);
    service = TestBed.inject(TransactionService);

    mockAuth.setAuthenticated(true);
    currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.92], ['THB', 34.5]]));
    spyOn(currencyService, 'ensureRatesLoaded').and.resolveTo();
  });

  afterEach(() => {
    mockFirestore.clearMocks();
    mockAuth.clearMocks();
    mockStorage.clearMocks();
  });

  it("writes the remainder and each part as sibling rows sharing the first row's id, in one transaction", async () => {
    await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 30 }]);

    expect(mockFirestore.runTransactionSpy.calls.length).toBe(1);
    expect(mockFirestore.txSetSpy.calls.length).toBe(2);

    const [firstPath, firstRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
    const [, secondRow] = mockFirestore.txSetSpy.calls[1].args as [string, Record<string, unknown>];
    const firstId = firstPath.split('/').pop();

    expect(firstRow['amount']).toBe(70);
    expect(firstRow['categoryId']).toBe('cat-food');
    expect(firstRow['splitGroupId']).toBe(firstId);
    expect(firstRow['note']).toBe('Paid by card');

    expect(secondRow['amount']).toBe(30);
    expect(secondRow['categoryId']).toBe('cat-home');
    expect(secondRow['splitGroupId']).toBe(firstId);
    expect('note' in secondRow).toBeFalse();

    for (const field of
      ['type', 'currency', 'exchangeRate', 'baseCurrency', 'description', 'date', 'tags', 'location', 'period'] as const
    ) {
      expect(secondRow[field]).toEqual(firstRow[field]);
    }
  });

  it('returns the ids in write order, first row first', async () => {
    const ids = await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 30 }]);

    const paths = mockFirestore.txSetSpy.calls.map(call => (call.args[0] as string));
    expect(ids).toEqual(paths.map(path => path.split('/').pop() as string));
    expect(ids.length).toBe(2);
  });

  it("converts each row's amount into the base currency at the purchase's own rate", async () => {
    // The mock account's base currency is USD by default; switch it so the
    // seeded USD rate below is not the trivial 1:1 case.
    const user = mockAuth.currentUser();
    mockAuth.setMockUser({ ...user!, preferences: { ...user!.preferences, baseCurrency: 'EUR' } });
    currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 1.5]]));

    await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 30 }]);

    const [, firstRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
    const [, secondRow] = mockFirestore.txSetSpy.calls[1].args as [string, Record<string, unknown>];
    expect(firstRow['amountInBaseCurrency']).toBe(105);
    expect(secondRow['amountInBaseCurrency']).toBe(45);
  });

  it("rounds a part to its currency's minor unit, matching what splitRemainder already subtracted", async () => {
    await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 10.005 }]);

    const [, firstRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
    const [, secondRow] = mockFirestore.txSetSpy.calls[1].args as [string, Record<string, unknown>];
    expect(secondRow['amount']).toBe(10.01);
    expect(firstRow['amount']).toBe(89.99);
  });

  it('recalculates budgets once per distinct expense category', async () => {
    await service.addSplitTransaction(dto(100, 'cat-food'), [
      { categoryId: 'cat-home', amount: 30 },
      { categoryId: 'cat-transport', amount: 10 },
      // Duplicates the first row's own category: four category ids across
      // the rows, but only three distinct ones.
      { categoryId: 'cat-food', amount: 5 }
    ]);

    expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledTimes(3);
    expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-food');
    expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-home');
    expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-transport');
  });

  it('does not recalculate budgets for an income split', async () => {
    await service.addSplitTransaction(
      dto(100, 'cat-salary', { type: 'income' }),
      [{ categoryId: 'cat-bonus', amount: 30 }]
    );

    expect(mockBudget.recalculateBudgetsForCategory).not.toHaveBeenCalled();
  });

  it('notes the receipt quota after the rows commit even when the budget recompute rejects', async () => {
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });
    mockBudget.recalculateBudgetsForCategory.and.rejectWith(new Error('budget recompute failed'));

    await expectAsync(
      service.addSplitTransaction(
        { ...dto(100, 'cat-food'), receiptFiles: [file] },
        [{ categoryId: 'cat-home', amount: 30 }]
      )
    ).toBeRejectedWithError('budget recompute failed');

    expect(mockFirestore.runTransactionSpy.calls.length).toBe(1);
    expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(1);
  });

  it("uploads receipts to the first row's id, leaves the parts clean, and notes the quota after commit", async () => {
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

    const ids = await service.addSplitTransaction(
      { ...dto(100, 'cat-food'), receiptFiles: [file] },
      [{ categoryId: 'cat-home', amount: 30 }]
    );

    expect(mockStorage.uploadReceiptSpy.calls.length).toBe(1);
    expect(mockStorage.uploadReceiptSpy.calls[0].args).toEqual(['test-user-123', ids[0], file, 0]);

    const [, firstRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
    const [, secondRow] = mockFirestore.txSetSpy.calls[1].args as [string, Record<string, unknown>];
    expect(firstRow['receiptCount']).toBe(1);
    expect(firstRow['receiptUrl']).toBeDefined();
    expect(firstRow['receiptUrls']).toEqual([firstRow['receiptUrl']]);
    expect('receiptUrl' in secondRow).toBeFalse();
    expect('receiptUrls' in secondRow).toBeFalse();
    expect('receiptCount' in secondRow).toBeFalse();

    expect(mockQuota.noteImagesAdded).toHaveBeenCalledWith(1);
  });

  it('rejects over the receipt quota and writes nothing', async () => {
    mockQuota.canAddImages.and.resolveTo(false);
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

    await expectAsync(
      service.addSplitTransaction(
        { ...dto(100, 'cat-food'), receiptFiles: [file] },
        [{ categoryId: 'cat-home', amount: 30 }]
      )
    ).toBeRejectedWithError(RECEIPT_IMAGE_LIMIT_ERROR);

    expect(mockStorage.uploadReceiptSpy.calls.length).toBe(0);
    expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
  });

  it('refuses a split naming a goal, before any write', async () => {
    await expectAsync(
      service.addSplitTransaction(
        dto(100, 'cat-food', { goalId: 'g1' }),
        [{ categoryId: 'cat-home', amount: 30 }]
      )
    ).toBeRejectedWithError(SPLIT_REFUSED);

    expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
  });

  it('refuses parts that leave no positive remainder', async () => {
    await expectAsync(
      service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 100 }])
    ).toBeRejectedWithError(SPLIT_REFUSED);

    expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
  });

  it('refuses a part with no category, before any write', async () => {
    await expectAsync(
      service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: '', amount: 30 }])
    ).toBeRejectedWithError(SPLIT_REFUSED);

    expect(mockFirestore.runTransactionSpy.calls.length).toBe(0);
  });

  it('deletes uploaded slots best-effort when the commit fails after a successful upload', async () => {
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });
    spyOn(mockFirestore, 'runTransaction').and.rejectWith(new Error('offline'));

    await expectAsync(
      service.addSplitTransaction(
        { ...dto(100, 'cat-food'), receiptFiles: [file] },
        [{ categoryId: 'cat-home', amount: 30 }]
      )
    ).toBeRejectedWithError('offline');

    expect(mockQuota.noteImagesAdded).not.toHaveBeenCalled();
    expect(mockStorage.deleteReceiptSlotsSpy.calls.length).toBe(1);
    expect(mockStorage.deleteReceiptSlotsSpy.mostRecent()?.args[2]).toEqual([0]);
  });

  it('marks every part as not itself the posting of a rule, whatever the purchase was', async () => {
    await service.addSplitTransaction(
      dto(100, 'cat-food', { isRecurring: true, recurringId: 'rule-1' }),
      [{ categoryId: 'cat-home', amount: 30 }]
    );

    const [, firstRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
    const [, secondRow] = mockFirestore.txSetSpy.calls[1].args as [string, Record<string, unknown>];
    expect(firstRow['isRecurring']).toBe(true);
    expect(secondRow['isRecurring']).toBe(false);
    expect('recurringId' in secondRow).toBeFalse();
  });

  it("records one add mutation at the first row's id", async () => {
    const ids = await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 30 }]);

    expect(service.lastMutation()).toEqual(jasmine.objectContaining({
      kind: 'add',
      id: ids[0],
      date: Timestamp.fromDate(new Date('2026-06-01'))
    }));
  });

  it('writes at the expected document paths', async () => {
    const ids = await service.addSplitTransaction(dto(100, 'cat-food'), [{ categoryId: 'cat-home', amount: 30 }]);

    const paths = mockFirestore.txSetSpy.calls.map(call => call.args[0]);
    expect(paths).toEqual([`${TX}/${ids[0]}`, `${TX}/${ids[1]}`]);
  });

  describe('splitTransaction', () => {
    function seedRow(overrides: Partial<Transaction> = {}): void {
      mockFirestore.setMockDocument(`${TX}/tx-1`, createTransaction({
        amount: 100,
        currency: 'USD',
        exchangeRate: 1.5,
        amountInBaseCurrency: 150,
        categoryId: 'cat-food',
        note: 'n',
        tags: ['t'],
        ...overrides
      }));
    }

    it("shrinks the stored row to its remainder and creates each part, in one transaction", async () => {
      const date = Timestamp.fromDate(new Date('2026-06-01'));
      seedRow({
        location: { name: 'Market' },
        period: 'monthly',
        baseCurrency: 'EUR',
        date,
        description: 'Weekend market run'
      });

      const ids = await service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 30 }]);

      expect(mockFirestore.runTransactionSpy.calls.length).toBe(1);
      expect(mockFirestore.txUpdateSpy.calls.length).toBe(1);
      expect(mockFirestore.txSetSpy.calls.length).toBe(1);

      const [updatePath, updateData] =
        mockFirestore.txUpdateSpy.calls[0].args as [string, Record<string, unknown>];
      expect(updatePath).toBe(`${TX}/tx-1`);
      expect(Object.keys(updateData).sort())
        .toEqual(['amount', 'amountInBaseCurrency', 'splitGroupId', 'updatedAt'].sort());
      expect(updateData['amount']).toBe(70);
      expect(updateData['amountInBaseCurrency']).toBe(105);
      expect(updateData['splitGroupId']).toBe('tx-1');

      const [partPath, partRow] =
        mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
      expect(partRow['amount']).toBe(30);
      expect(partRow['amountInBaseCurrency']).toBe(45);
      expect(partRow['categoryId']).toBe('cat-home');
      expect(partRow['splitGroupId']).toBe('tx-1');
      expect(partRow['isRecurring']).toBe(false);
      expect('note' in partRow).toBeFalse();
      expect('receiptUrl' in partRow).toBeFalse();
      expect('receiptUrls' in partRow).toBeFalse();
      expect('goalId' in partRow).toBeFalse();
      expect('recurringId' in partRow).toBeFalse();

      // Identity copies from the row being split, never re-derived: type,
      // currency, rate, base currency, description, date, tags, location,
      // period (the exclusions above cover note/receipts/goal/recurring).
      expect(partRow['type']).toBe('expense');
      expect(partRow['currency']).toBe('USD');
      expect(partRow['exchangeRate']).toBe(1.5);
      expect(partRow['baseCurrency']).toBe('EUR');
      expect(partRow['description']).toBe('Weekend market run');
      expect((partRow['date'] as Timestamp).toMillis()).toBe(date.toMillis());
      expect(partRow['tags']).toEqual(['t']);
      expect(partRow['location']).toEqual({ name: 'Market' });
      expect(partRow['period']).toBe('monthly');

      expect(ids).toEqual([partPath.split('/').pop() as string]);
    });

    it("rounds a part to its currency's minor unit, matching what splitRemainder already subtracted", async () => {
      seedRow();

      await service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 10.005 }]);

      const [, updateData] = mockFirestore.txUpdateSpy.calls[0].args as [string, Record<string, unknown>];
      const [, partRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
      expect(partRow['amount']).toBe(10.01);
      expect(updateData['amount']).toBe(89.99);
    });

    it('joins the group a row is already part of, without rewriting the field', async () => {
      seedRow({ splitGroupId: 'tx-0' });

      await service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 30 }]);

      const [, updateData] = mockFirestore.txUpdateSpy.calls[0].args as [string, Record<string, unknown>];
      expect('splitGroupId' in updateData).toBeFalse();

      const [, partRow] = mockFirestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
      expect(partRow['splitGroupId']).toBe('tx-0');
    });

    it('computes the remainder from a fresh read, not the caller\'s stale view', async () => {
      seedRow();
      mockFirestore.beforeTransaction = () => seedRow({ amount: 40, amountInBaseCurrency: 60 });

      await service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 30 }]);

      const [, updateData] = mockFirestore.txUpdateSpy.calls[0].args as [string, Record<string, unknown>];
      expect(updateData['amount']).toBe(10);
    });

    it('refuses a fresh-read amount the parts cannot fit under, even though the stale view had room', async () => {
      seedRow();
      mockFirestore.beforeTransaction = () => seedRow({ amount: 40, amountInBaseCurrency: 60 });

      await expectAsync(
        service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 50 }])
      ).toBeRejectedWithError(SPLIT_REFUSED);

      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockFirestore.txSetSpy.calls.length).toBe(0);
    });

    it('refuses to split a row linked to a goal, before any write', async () => {
      seedRow({ goalId: 'g1', goalAmount: 92 });

      await expectAsync(
        service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 30 }])
      ).toBeRejectedWithError(SPLIT_REFUSED);

      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockFirestore.txSetSpy.calls.length).toBe(0);
    });

    it('rejects a row that no longer exists', async () => {
      await expectAsync(
        service.splitTransaction('does-not-exist', [{ categoryId: 'cat-home', amount: 30 }])
      ).toBeRejectedWithError('Transaction not found');

      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockFirestore.txSetSpy.calls.length).toBe(0);
    });

    it('refuses parts that leave no positive remainder', async () => {
      seedRow();

      await expectAsync(
        service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 100 }])
      ).toBeRejectedWithError(SPLIT_REFUSED);

      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockFirestore.txSetSpy.calls.length).toBe(0);
    });

    it('refuses a part with no category, before any write', async () => {
      seedRow();

      await expectAsync(
        service.splitTransaction('tx-1', [{ categoryId: '', amount: 30 }])
      ).toBeRejectedWithError(SPLIT_REFUSED);

      expect(mockFirestore.txUpdateSpy.calls.length).toBe(0);
      expect(mockFirestore.txSetSpy.calls.length).toBe(0);
    });

    it('recalculates budgets once per distinct expense category', async () => {
      seedRow();

      await service.splitTransaction('tx-1', [
        { categoryId: 'cat-home', amount: 20 },
        { categoryId: 'cat-transport', amount: 10 },
        // Duplicates the row's own category: four category ids across the
        // update and its parts, but only three distinct ones.
        { categoryId: 'cat-food', amount: 5 }
      ]);

      expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledTimes(3);
      expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-food');
      expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-home');
      expect(mockBudget.recalculateBudgetsForCategory).toHaveBeenCalledWith('cat-transport');
    });

    it('does not recalculate budgets for an income row', async () => {
      mockFirestore.setMockDocument(`${TX}/tx-1`, createTransaction({
        type: 'income',
        amount: 100,
        currency: 'USD',
        exchangeRate: 1.5,
        amountInBaseCurrency: 150,
        categoryId: 'cat-salary'
      }));

      await service.splitTransaction('tx-1', [{ categoryId: 'cat-bonus', amount: 30 }]);

      expect(mockBudget.recalculateBudgetsForCategory).not.toHaveBeenCalled();
    });

    it('records one update mutation at the split row\'s id', async () => {
      const date = Timestamp.fromDate(new Date('2026-06-01'));
      seedRow({ date });

      await service.splitTransaction('tx-1', [{ categoryId: 'cat-home', amount: 30 }]);

      expect(service.lastMutation()).toEqual(jasmine.objectContaining({
        kind: 'update',
        id: 'tx-1',
        date
      }));
    });
  });
});
