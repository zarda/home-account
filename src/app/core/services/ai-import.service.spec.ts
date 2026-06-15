import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { AIImportService } from './ai-import.service';
import { GeminiService } from './gemini.service';
import { ExportService } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { AIStrategyService } from './ai-strategy.service';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { createMockUser } from './testing/mock-auth.service';
import {
  CategorizedImportTransaction,
  DuplicateCheck,
  ImportHistory,
  User
} from '../../models';

describe('AIImportService', () => {
  let service: AIImportService;
  let geminiService: jasmine.SpyObj<GeminiService>;
  let exportService: jasmine.SpyObj<ExportService>;
  let duplicateService: jasmine.SpyObj<DuplicateDetectionService>;
  let importHistoryService: jasmine.SpyObj<ImportHistoryService>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let authService: jasmine.SpyObj<AuthService>;
  let strategyService: jasmine.SpyObj<AIStrategyService>;
  let offlineQueue: jasmine.SpyObj<OfflineQueueService>;
  let pwaService: jasmine.SpyObj<PwaService>;
  let isOnlineSignal: WritableSignal<boolean>;

  const makeFile = (name: string, type: string, content = 'data'): File =>
    new File([content], name, { type });

  const noDuplicates = (txns: CategorizedImportTransaction[]): DuplicateCheck[] =>
    txns.map(t => ({ transactionId: t.id, isDuplicate: false, matchType: 'none' as const, confidence: 0 }));

  beforeEach(() => {
    geminiService = jasmine.createSpyObj('GeminiService', [
      'isAvailable',
      'extractTransactionsFromImage',
      'extractTransactionsFromPDF',
      'extractTransactionsFromMultipleImages',
      'categorizeTransactions'
    ]);
    exportService = jasmine.createSpyObj('ExportService', ['importFromCSV']);
    duplicateService = jasmine.createSpyObj('DuplicateDetectionService', ['checkDuplicates', 'markDuplicates']);
    importHistoryService = jasmine.createSpyObj('ImportHistoryService', [
      'createPendingImport',
      'completeImport',
      'failImport',
      'getImportById'
    ]);
    transactionService = jasmine.createSpyObj('TransactionService', ['addTransaction']);
    authService = jasmine.createSpyObj('AuthService', [], {
      currentUser: jasmine.createSpy('currentUser').and.returnValue(createMockUser('user123')),
      userId: jasmine.createSpy('userId').and.returnValue('user123')
    });
    strategyService = jasmine.createSpyObj('AIStrategyService', ['canUseCloud', 'canUseNative', 'processReceipt']);
    offlineQueue = jasmine.createSpyObj('OfflineQueueService', ['queueImage']);
    isOnlineSignal = signal(true);
    pwaService = jasmine.createSpyObj('PwaService', [], {
      isOnline: isOnlineSignal
    });

    // Sensible defaults
    geminiService.isAvailable.and.returnValue(true);
    geminiService.categorizeTransactions.and.callFake(async (raws) =>
      raws.map(r => ({ ...r, suggestedCategoryId: 'food', confidence: 0.8 }))
    );
    duplicateService.checkDuplicates.and.callFake(async (txns) => noDuplicates(txns));
    duplicateService.markDuplicates.and.callFake((txns) => txns);
    strategyService.canUseCloud.and.returnValue(true);
    strategyService.canUseNative.and.returnValue(false);
    offlineQueue.queueImage.and.returnValue(Promise.resolve('queued-id'));

    TestBed.configureTestingModule({
      providers: [
        AIImportService,
        { provide: GeminiService, useValue: geminiService },
        { provide: ExportService, useValue: exportService },
        { provide: DuplicateDetectionService, useValue: duplicateService },
        { provide: ImportHistoryService, useValue: importHistoryService },
        { provide: TransactionService, useValue: transactionService },
        { provide: AuthService, useValue: authService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: OfflineQueueService, useValue: offlineQueue },
        { provide: PwaService, useValue: pwaService }
      ]
    });

    service = TestBed.inject(AIImportService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start idle', () => {
      expect(service.isProcessing()).toBeFalse();
      expect(service.processingStatus()).toBe('');
      expect(service.processingProgress()).toBe(0);
      expect(service.processingSource()).toBeNull();
    });

    it('isOfflineMode should reflect the inverse of pwa online state', () => {
      isOnlineSignal.set(false);
      expect(service.isOfflineMode()).toBeTrue();

      isOnlineSignal.set(true);
      expect(service.isOfflineMode()).toBeFalse();
    });
  });

  describe('importFromFile routing', () => {
    it('should route image files to importFromImage', async () => {
      spyOn(service, 'importFromImage').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('receipt.png', 'image/png'));
      expect(service.importFromImage).toHaveBeenCalled();
    });

    it('should route pdf files to importFromPDF', async () => {
      spyOn(service, 'importFromPDF').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('statement.pdf', 'application/pdf'));
      expect(service.importFromPDF).toHaveBeenCalled();
    });

    it('should route csv files to importFromCSV', async () => {
      spyOn(service, 'importFromCSV').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('data.csv', 'text/csv'));
      expect(service.importFromCSV).toHaveBeenCalled();
    });

    it('should route json files to importFromJSON', async () => {
      spyOn(service, 'importFromJSON').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('backup.json', 'application/json'));
      expect(service.importFromJSON).toHaveBeenCalled();
    });

    it('should route unknown extensions to CSV via fallback file type', async () => {
      spyOn(service, 'importFromCSV').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('mystery.dat', ''));
      expect(service.importFromCSV).toHaveBeenCalled();
    });

    it('should route spreadsheet files to CSV source', async () => {
      spyOn(service, 'importFromCSV').and.returnValue(Promise.resolve({} as never));
      await service.importFromFile(makeFile('book.xlsx', ''));
      expect(service.importFromCSV).toHaveBeenCalled();
    });
  });

  describe('importFromImage', () => {
    it('should throw and queue the image when offline and no AI available', async () => {
      strategyService.canUseCloud.and.returnValue(false);
      strategyService.canUseNative.and.returnValue(false);
      isOnlineSignal.set(false);

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(/Offline/);
      expect(offlineQueue.queueImage).toHaveBeenCalled();
    });

    it('should throw a config error when online but no AI available', async () => {
      strategyService.canUseCloud.and.returnValue(false);
      strategyService.canUseNative.and.returnValue(false);
      isOnlineSignal.set(true);

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(/not available/);
      expect(offlineQueue.queueImage).not.toHaveBeenCalled();
    });

    it('should process via the strategy service and build a result', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'cloud',
        confidence: 0.9,
        processingTimeMs: 10,
        transactions: [{
          date: new Date(2024, 5, 1),
          description: 'Lunch',
          amount: 12,
          type: 'expense',
          currency: 'USD',
          confidence: 0.9,
          source: 'cloud'
        }]
      }));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(result.source).toBe('image');
      expect(result.transactions.length).toBe(1);
      expect(result.processingSource).toBe('cloud');
      expect(duplicateService.checkDuplicates).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });

    it('should map strategy transaction defaults (currency, category)', async () => {
      (authService.currentUser as jasmine.Spy).and.returnValue(
        createMockUser('user123', { preferences: { ...createMockUser().preferences, baseCurrency: 'EUR' } } as Partial<User>)
      );
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'native',
        confidence: 0.5,
        processingTimeMs: 5,
        transactions: [{
          date: new Date(2024, 5, 1),
          description: 'Item',
          amount: 3,
          type: 'expense',
          currency: '',
          confidence: 0.4,
          source: 'native'
        }]
      }));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(result.transactions[0].currency).toBe('EUR');
      expect(result.transactions[0].suggestedCategoryId).toBe('other_expense');
      expect(result.processingSource).toBe('native');
    });

    it('should re-throw non-retryable strategy errors without falling back', async () => {
      strategyService.processReceipt.and.returnValue(Promise.reject(new Error('401 unauthorized')));

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(/API key/);
      expect(geminiService.extractTransactionsFromImage).not.toHaveBeenCalled();
    });

    it('should fall back to gemini extraction on a retryable strategy error', async () => {
      strategyService.processReceipt.and.returnValue(Promise.reject(new Error('503 service unavailable')));
      geminiService.extractTransactionsFromImage.and.returnValue(Promise.resolve([{
        date: '2024-06-01',
        description: 'Fallback item',
        amount: 7,
        type: 'expense',
        currency: 'USD'
      }]));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(geminiService.extractTransactionsFromImage).toHaveBeenCalled();
      expect(result.processingSource).toBe('cloud');
      expect(result.transactions.length).toBe(1);
    });

    it('should fall back to gemini when the strategy returns zero transactions', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'cloud', confidence: 0, processingTimeMs: 1, transactions: []
      }));
      geminiService.extractTransactionsFromImage.and.returnValue(Promise.resolve([{
        date: '2024-06-02', description: 'Item', amount: 4, type: 'expense', currency: 'USD'
      }]));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(geminiService.extractTransactionsFromImage).toHaveBeenCalled();
      expect(result.transactions.length).toBe(1);
    });

    it('should throw when falling back but gemini is unavailable', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'cloud', confidence: 0, processingTimeMs: 1, transactions: []
      }));
      geminiService.isAvailable.and.returnValue(false);

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(/not available/);
    });
  });

  describe('importFromMultipleImages', () => {
    it('should throw for an empty file list', async () => {
      await expectAsync(service.importFromMultipleImages([])).toBeRejectedWithError(/No image files/);
    });

    it('should delegate to single image import for a single file', async () => {
      spyOn(service, 'importFromImage').and.returnValue(Promise.resolve({ source: 'image' } as never));
      await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);
      expect(service.importFromImage).toHaveBeenCalled();
    });

    it('should throw when gemini is unavailable', async () => {
      geminiService.isAvailable.and.returnValue(false);
      await expectAsync(
        service.importFromMultipleImages([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')])
      ).toBeRejectedWithError(/not available/);
    });

    it('should consolidate single-item receipts as standalone transactions', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Solo item', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 7 }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.source).toBe('image');
      expect(result.fileType).toBe('receipt_image');
      expect(result.transactions.length).toBe(1);
      expect(result.multiImageMetadata?.totalImages).toBe(2);
      expect(result.multiImageMetadata?.deduplicationMethod).toBe('ai');
    });

    it('should merge multiple items sharing a receiptId into one transaction', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Item A', amount: 100, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1, merchant: 'Shop' },
        { date: '2024-06-01', description: 'Item B', amount: 200, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'bottom', confidence: 0.7, receiptId: 1 }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      // Two items merged into a single receipt transaction (300 total)
      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].amount).toBe(300);
    });

    it('should count items the AI already flagged as merged', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Solo', amount: 10, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 4, wasMerged: true }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.multiImageMetadata?.itemsMerged).toBe(1);
    });

    it('should merge using AI-provided receipt details and a non-JPY currency', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Item A', amount: 1.5, type: 'expense', currency: 'USD',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 2,
          receiptDetails: 'Full receipt body' },
        { date: '2024-06-01', description: 'Item B', amount: 2.5, type: 'expense', currency: 'USD',
          imageIndex: 1, positionInImage: 'middle', confidence: 0.8, receiptId: 2 }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].amount).toBe(4);
      expect(result.transactions[0].notes).toContain('Full receipt body');
    });

    it('should fall back to defaults when AI categorization throws', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'X', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1 },
        { date: '2024-06-01', description: 'Y', amount: 6, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'top', confidence: 0.9, receiptId: 9 }
      ]));
      geminiService.categorizeTransactions.and.returnValue(Promise.reject(new Error('cat failed')));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      // Two distinct receiptIds → two standalone transactions, categorization defaulted
      expect(result.transactions.length).toBe(2);
      expect(result.warnings.some(w => w.type === 'low_confidence')).toBeTrue();
    });

    it('should add a duplicate warning when duplicates are detected', async () => {
      geminiService.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'X', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1 }
      ]));
      duplicateService.checkDuplicates.and.callFake(async (txns) =>
        txns.map(t => ({ transactionId: t.id, isDuplicate: true, matchType: 'exact' as const, confidence: 1 }))
      );

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.warnings.some(w => w.type === 'duplicate')).toBeTrue();
    });
  });

  describe('importFromPDF', () => {
    it('should throw when gemini is unavailable', async () => {
      geminiService.isAvailable.and.returnValue(false);
      await expectAsync(
        service.importFromPDF(makeFile('s.pdf', 'application/pdf'))
      ).toBeRejectedWithError(/not available/);
    });

    it('should extract, categorize and build a pdf result', async () => {
      geminiService.extractTransactionsFromPDF.and.returnValue(Promise.resolve([
        { description: 'Deposit', amount: 500, date: new Date(2024, 5, 1) },
        { description: 'Withdrawal', amount: -50, date: new Date(2024, 5, 2) }
      ]));

      const result = await service.importFromPDF(makeFile('s.pdf', 'application/pdf'));

      expect(result.source).toBe('pdf');
      expect(result.fileType).toBe('bank_pdf');
      expect(result.transactions.length).toBe(2);
      expect(service.isProcessing()).toBeFalse();
    });

    it('should default missing extracted dates to today', async () => {
      geminiService.extractTransactionsFromPDF.and.returnValue(Promise.resolve([
        { description: 'No date', amount: 10, date: undefined as unknown as Date }
      ]));

      const result = await service.importFromPDF(makeFile('s.pdf', 'application/pdf'));
      expect(result.transactions.length).toBe(1);
    });
  });

  describe('importFromCSV', () => {
    it('should parse, categorize and build a csv result', async () => {
      exportService.importFromCSV.and.returnValue(Promise.resolve([
        { description: 'Coffee', amount: -5, date: new Date(2024, 5, 1), type: 'expense', currency: 'USD' },
        { description: 'Refund', amount: 20, date: new Date(2024, 5, 2), type: 'income', currency: 'USD' }
      ] as never));

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      expect(result.source).toBe('csv');
      expect(result.fileType).toBe('generic_csv');
      expect(result.transactions.length).toBe(2);
      expect(service.isProcessing()).toBeFalse();
    });

    it('should default missing parsed dates to today', async () => {
      exportService.importFromCSV.and.returnValue(Promise.resolve([
        { description: 'No date', amount: 10, date: undefined as unknown as Date }
      ] as never));

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));
      expect(result.transactions.length).toBe(1);
    });
  });

  describe('importFromJSON', () => {
    it('should throw for an invalid backup format', async () => {
      const file = makeFile('bad.json', 'application/json', JSON.stringify({ foo: 'bar' }));
      await expectAsync(service.importFromJSON(file)).toBeRejectedWithError(/Invalid backup format/);
    });

    it('should parse backup transactions and build a json result', async () => {
      const backup = {
        transactions: [
          { description: 'Salary', amount: 5000, currency: 'USD', type: 'income',
            categoryId: 'employment_salary', date: { seconds: 1700000000 } },
          { description: 'Rent', amount: -1200, type: 'expense' }
        ]
      };
      const file = makeFile('backup.json', 'application/json', JSON.stringify(backup));

      const result = await service.importFromJSON(file);

      expect(result.source).toBe('json');
      expect(result.fileType).toBe('backup_json');
      expect(result.transactions.length).toBe(2);
      expect(result.transactions[0].amount).toBe(5000);
      expect(result.transactions[1].amount).toBe(1200);
      expect(result.transactions[1].suggestedCategoryId).toBe('other_expense');
    });
  });

  describe('categorizeTransactions', () => {
    it('should return an empty array for empty input', async () => {
      const result = await service.categorizeTransactions([]);
      expect(result).toEqual([]);
    });

    it('should use the extracted category when present', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Taxi', amount: 15, type: 'expense', currency: 'USD', category: 'transport' }
      ]);
      expect(result[0].suggestedCategoryId).toBe('transport');
      expect(result[0].categoryConfidence).toBe(0.8);
    });

    it('should default category, currency, type and date when missing', async () => {
      (authService.currentUser as jasmine.Spy).and.returnValue(null);

      const result = await service.categorizeTransactions([
        { date: '', description: 'Unknown', amount: -8, type: undefined as never, currency: '' }
      ]);

      expect(result[0].suggestedCategoryId).toBe('other_expense');
      expect(result[0].currency).toBe('USD'); // fallback base currency
      expect(result[0].type).toBe('expense');
      expect(result[0].date instanceof Date).toBeTrue();
    });

    it('should build originalText from merchant and details', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Burger', amount: 9, type: 'expense', currency: 'USD',
          merchant: 'Diner', details: 'fries, soda' }
      ]);
      expect(result[0].originalText).toContain('Diner');
      expect(result[0].originalText).toContain('Burger');
      // Comma-separated details become newline-separated notes
      expect(result[0].notes).toBe('fries\nsoda');
    });

    it('should keep multi-line details as-is in notes', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Order', amount: 9, type: 'expense', currency: 'USD',
          details: 'line one\nline two' }
      ]);
      expect(result[0].notes).toBe('line one\nline two');
    });
  });

  describe('confirmImport', () => {
    const completedHistory: ImportHistory = {
      id: 'hist-1',
      userId: 'user123',
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'r.png',
      fileSize: 10,
      transactionCount: 1,
      successCount: 1,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 5,
      status: 'completed',
      duplicatesSkipped: 0
    };

    const selected = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      id: 'imp-1',
      description: 'Coffee',
      amount: 5,
      currency: 'USD',
      date: new Date(2024, 5, 1),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides
    });

    beforeEach(() => {
      importHistoryService.createPendingImport.and.returnValue(Promise.resolve('hist-1'));
      importHistoryService.completeImport.and.returnValue(Promise.resolve());
      importHistoryService.failImport.and.returnValue(Promise.resolve());
      importHistoryService.getImportById.and.returnValue(of(completedHistory));
      transactionService.addTransaction.and.returnValue(Promise.resolve('txn-id'));
    });

    it('should throw when user is not authenticated', async () => {
      (authService.userId as jasmine.Spy).and.returnValue(null);

      await expectAsync(
        service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image')
      ).toBeRejectedWithError(/not authenticated/);
    });

    it('should save selected transactions and return the history record', async () => {
      const history = await service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image');

      expect(transactionService.addTransaction).toHaveBeenCalledTimes(1);
      expect(importHistoryService.completeImport).toHaveBeenCalled();
      expect(history).toEqual(completedHistory);
      expect(service.isProcessing()).toBeFalse();
    });

    it('should accumulate income and expense totals', async () => {
      await service.confirmImport(
        [selected({ id: 'a', type: 'income', amount: 100 }), selected({ id: 'b', type: 'expense', amount: 40 })],
        'r.png', 10, 'image', 'receipt_image'
      );

      const stats = importHistoryService.completeImport.calls.mostRecent().args[1];
      expect(stats.totalIncome).toBe(100);
      expect(stats.totalExpenses).toBe(40);
    });

    it('should skip unselected transactions and count skipped duplicates', async () => {
      await service.confirmImport(
        [selected({ id: 'a' }), selected({ id: 'b', selected: false, isDuplicate: true })],
        'r.png', 10, 'image', 'receipt_image'
      );

      expect(transactionService.addTransaction).toHaveBeenCalledTimes(1);
      const stats = importHistoryService.completeImport.calls.mostRecent().args[1];
      expect(stats.skippedCount).toBe(1);
      expect(stats.duplicatesSkipped).toBe(1);
    });

    it('should record per-transaction errors and continue', async () => {
      transactionService.addTransaction.and.returnValues(
        Promise.reject(new Error('save failed')),
        Promise.resolve('txn-2')
      );

      await service.confirmImport(
        [selected({ id: 'a' }), selected({ id: 'b' })],
        'r.png', 10, 'image', 'receipt_image'
      );

      const stats = importHistoryService.completeImport.calls.mostRecent().args[1];
      expect(stats.errorCount).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.errors?.length).toBe(1);
    });

    it('should coerce string and invalid dates to valid Date objects', async () => {
      await service.confirmImport(
        [
          selected({ id: 'a', date: '2024-06-01' as unknown as Date }),
          selected({ id: 'b', date: 'not-a-date' as unknown as Date }),
          selected({ id: 'c', date: undefined as unknown as Date })
        ],
        'r.png', 10, 'image', 'receipt_image'
      );

      const calls = transactionService.addTransaction.calls.all();
      for (const call of calls) {
        const dto = call.args[0];
        expect(dto.date instanceof Date).toBeTrue();
        expect(isNaN(dto.date.getTime())).toBeFalse();
      }
    });

    it('should apply fallbacks for missing category, description and currency', async () => {
      (authService.currentUser as jasmine.Spy).and.returnValue(
        createMockUser('user123', { preferences: { ...createMockUser().preferences, baseCurrency: 'GBP' } } as Partial<User>)
      );

      await service.confirmImport(
        [selected({ suggestedCategoryId: '', description: '', currency: '' })],
        'r.png', 10, 'image', 'receipt_image'
      );

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.categoryId).toBe('other_expense');
      expect(dto.description).toBe('Imported transaction');
      expect(dto.currency).toBe('GBP');
    });

    it('should fail the import and rethrow when completion throws', async () => {
      importHistoryService.completeImport.and.returnValue(Promise.reject(new Error('complete boom')));

      await expectAsync(
        service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image')
      ).toBeRejectedWithError(/complete boom/);
      expect(importHistoryService.failImport).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });
  });

  describe('parseAIError', () => {
    const cases: { input: string; type: string; retryable: boolean }[] = [
      { input: '429 too many requests', type: 'rate_limit', retryable: true },
      { input: 'RESOURCE_EXHAUSTED', type: 'rate_limit', retryable: true },
      { input: '401 unauthorized', type: 'auth', retryable: false },
      { input: 'API_KEY_INVALID', type: 'auth', retryable: false },
      { input: 'network failure: failed to fetch', type: 'network', retryable: true },
      { input: '402 payment required billing', type: 'quota', retryable: false },
      { input: '503 service unavailable', type: 'server', retryable: true },
      { input: 'request timed out', type: 'timeout', retryable: true }
    ];

    cases.forEach(({ input, type, retryable }) => {
      it(`should classify "${input}" as ${type}`, () => {
        const parsed = service.parseAIError(new Error(input));
        expect(parsed.type).toBe(type as never);
        expect(parsed.retryable).toBe(retryable);
        expect(parsed.message.length).toBeGreaterThan(0);
      });
    });

    it('should pass through our own user-friendly messages', () => {
      const parsed = service.parseAIError(new Error('Please configure your API key'));
      expect(parsed.type).toBe('unknown');
      expect(parsed.retryable).toBeFalse();
      expect(parsed.message).toContain('Please configure');
    });

    it('should classify unknown errors as retryable unknown', () => {
      const parsed = service.parseAIError(new Error('something weird happened'));
      expect(parsed.type).toBe('unknown');
      expect(parsed.retryable).toBeTrue();
      expect(parsed.message).toContain('something weird happened');
    });

    it('should handle non-Error inputs', () => {
      const parsed = service.parseAIError('plain string 429');
      expect(parsed.type).toBe('rate_limit');
    });
  });
});
