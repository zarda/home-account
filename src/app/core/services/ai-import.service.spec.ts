import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { NEVER, of, throwError } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import {
  AIImportService,
  AI_NO_PROVIDER,
  AI_QUEUED_OFFLINE,
  IMPORT_READBACK_FAILED,
  IMPORT_READBACK_TIMEOUT_MS,
} from './ai-import.service';
import {
  UNCATEGORIZED_CATEGORY_CONFIDENCE,
  UNRESOLVED_CATEGORY_CONFIDENCE,
} from '../utils/categorization.utils';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ExportService } from './export.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ImportHistoryService } from './import-history.service';
import { TransactionService, RECEIPT_ATTACH_FAILED, RECEIPT_IMAGE_LIMIT_ERROR } from './transaction.service';
import { BudgetService } from './budget.service';
import { AuthService } from './auth.service';
import { AIStrategyService } from './ai-strategy.service';
import { OfflineQueueService } from './offline-queue.service';
import { PwaService } from './pwa.service';
import { CategoryMemoryService } from './category-memory.service';
import { RagContextService } from './rag-context.service';
import { AnalyticsService } from './analytics.service';
import { createMockUser } from './testing/mock-auth.service';
import { REVIEW_AMOUNT_CONFIDENCE } from '../utils/receipt-consolidation';
import {
  CategorizedImportTransaction,
  DuplicateCheck,
  ImportHistory,
  User
} from '../../models';

describe('AIImportService', () => {
  let service: AIImportService;
  let cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService>;
  let exportService: jasmine.SpyObj<ExportService>;
  let duplicateService: jasmine.SpyObj<DuplicateDetectionService>;
  let importHistoryService: jasmine.SpyObj<ImportHistoryService>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let budgetService: jasmine.SpyObj<BudgetService>;
  let authService: jasmine.SpyObj<AuthService>;
  let strategyService: jasmine.SpyObj<AIStrategyService>;
  let offlineQueue: jasmine.SpyObj<OfflineQueueService>;
  let pwaService: jasmine.SpyObj<PwaService>;
  let categoryMemory: jasmine.SpyObj<CategoryMemoryService>;
  let ragContext: jasmine.SpyObj<RagContextService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let rasterize: jasmine.Spy;
  let isOnlineSignal: WritableSignal<boolean>;

  const makeFile = (name: string, type: string, content = 'data'): File =>
    new File([content], name, { type });

  const noDuplicates = (txns: CategorizedImportTransaction[]): DuplicateCheck[] =>
    txns.map(t => ({ transactionId: t.id, isDuplicate: false, matchType: 'none' as const, confidence: 0 }));

  beforeEach(() => {
    cloudLLMProvider = jasmine.createSpyObj('CloudLLMProviderService', [
      'hasAnyCloudProvider',
      'categorizeTransactions',
      'extractStatementTransactions',
      'extractTransactionsFromImage',
      'extractTransactionsFromMultipleImages'
    ]);
    exportService = jasmine.createSpyObj('ExportService', ['importFromCSV']);
    duplicateService = jasmine.createSpyObj('DuplicateDetectionService', ['checkDuplicates', 'markDuplicates']);
    importHistoryService = jasmine.createSpyObj('ImportHistoryService', [
      'createPendingImport',
      'completeImport',
      'failImport',
      'getImportById'
    ]);
    transactionService = jasmine.createSpyObj('TransactionService', ['addTransaction', 'getTransactions']);
    budgetService = jasmine.createSpyObj('BudgetService', ['recalculateBudgetsForCategory']);
    budgetService.recalculateBudgetsForCategory.and.resolveTo();
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

    categoryMemory = jasmine.createSpyObj<CategoryMemoryService>('CategoryMemoryService', [
      'ensureLoaded',
      'lookup',
      'remember',
      'rememberAll',
    ]);

    ragContext = jasmine.createSpyObj<RagContextService>('RagContextService', [
      'buildCategorizationGrounding',
    ]);
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', [
      'trackAiAssistUsed',
    ]);

    // Sensible defaults
        cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
    cloudLLMProvider.categorizeTransactions.and.callFake(async (raws) =>
      raws.map(r => ({ ...r, suggestedCategoryId: 'food', confidence: 0.8 }))
    );
    duplicateService.checkDuplicates.and.callFake(async (txns) => noDuplicates(txns));
    duplicateService.markDuplicates.and.callFake((txns) => txns);
    strategyService.canUseCloud.and.returnValue(true);
    strategyService.canUseNative.and.returnValue(false);
    offlineQueue.queueImage.and.returnValue(Promise.resolve('queued-id'));
    categoryMemory.ensureLoaded.and.resolveTo(undefined);
    categoryMemory.lookup.and.returnValue(null);
    categoryMemory.rememberAll.and.resolveTo(undefined);
    transactionService.getTransactions.and.returnValue(of([]));
    ragContext.buildCategorizationGrounding.and.returnValue('');

    TestBed.configureTestingModule({
      providers: [
        AIImportService,
        { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
        { provide: ExportService, useValue: exportService },
        { provide: DuplicateDetectionService, useValue: duplicateService },
        { provide: ImportHistoryService, useValue: importHistoryService },
        { provide: TransactionService, useValue: transactionService },
        { provide: BudgetService, useValue: budgetService },
        { provide: AuthService, useValue: authService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: OfflineQueueService, useValue: offlineQueue },
        { provide: PwaService, useValue: pwaService },
        { provide: CategoryMemoryService, useValue: categoryMemory },
        { provide: RagContextService, useValue: ragContext },
        { provide: AnalyticsService, useValue: analytics }
      ]
    });

    service = TestBed.inject(AIImportService);
    // The pdfjs import is behind a protected seam so specs never need a canvas.
    rasterize = spyOn(
      service as unknown as { rasterizePdf: (d: ArrayBuffer) => Promise<unknown> },
      'rasterizePdf'
    );
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
      ).toBeRejectedWithError(AI_QUEUED_OFFLINE);
      expect(offlineQueue.queueImage).toHaveBeenCalled();
    });

    it('should throw a config error when online but no AI available', async () => {
      strategyService.canUseCloud.and.returnValue(false);
      strategyService.canUseNative.and.returnValue(false);
      isOnlineSignal.set(true);

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(AI_NO_PROVIDER);
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
      // Coerced to the catch-all for display, but graded for review rather
      // than wearing the 0.4 the extraction reported about something else.
      expect(result.transactions[0].categoryConfidence).toBe(UNRESOLVED_CATEGORY_CONFIDENCE);
      expect(result.processingSource).toBe('native');
    });

    it('keeps the extraction confidence on a row whose category resolved', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'native',
        confidence: 0.88,
        processingTimeMs: 5,
        transactions: [{
          date: new Date(2024, 5, 1),
          description: 'Item',
          amount: 3,
          type: 'expense',
          currency: 'EUR',
          confidence: 0.88,
          source: 'native',
          suggestedCategoryId: 'food_groceries'
        }]
      }));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(result.transactions[0].suggestedCategoryId).toBe('food_groceries');
      expect(result.transactions[0].categoryConfidence).toBe(0.88);
    });

    it('grades a row nothing attempted to categorize at the floor, not the review grade', async () => {
      // The regex reader's shape: no category, and it says so of itself.
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'native',
        confidence: 0.77,
        processingTimeMs: 5,
        transactions: [{
          date: new Date(2024, 5, 1),
          description: 'Item',
          amount: 3,
          type: 'expense',
          currency: 'EUR',
          confidence: 0.77,
          source: 'native',
          categoryAttempted: false
        }]
      }));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(result.transactions[0].suggestedCategoryId).toBe('other_expense');
      expect(result.transactions[0].categoryConfidence).toBe(UNCATEGORIZED_CATEGORY_CONFIDENCE);
    });

    it('should re-throw non-retryable strategy errors without falling back', async () => {
      strategyService.processReceipt.and.returnValue(Promise.reject(new Error('401 unauthorized')));

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(/API key/);
      expect(cloudLLMProvider.extractTransactionsFromImage).not.toHaveBeenCalled();
    });

    it('should fall back to provider extraction on a retryable strategy error', async () => {
      strategyService.processReceipt.and.returnValue(Promise.reject(new Error('503 service unavailable')));
      cloudLLMProvider.extractTransactionsFromImage.and.returnValue(Promise.resolve([{
        date: '2024-06-01',
        description: 'Fallback item',
        amount: 7,
        type: 'expense',
        currency: 'USD'
      }]));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(cloudLLMProvider.extractTransactionsFromImage).toHaveBeenCalled();
      expect(result.processingSource).toBe('cloud');
      expect(result.transactions.length).toBe(1);
    });

    it('should fall back to provider extraction when the strategy returns zero transactions', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'cloud', confidence: 0, processingTimeMs: 1, transactions: []
      }));
      cloudLLMProvider.extractTransactionsFromImage.and.returnValue(Promise.resolve([{
        date: '2024-06-02', description: 'Item', amount: 4, type: 'expense', currency: 'USD'
      }]));

      const result = await service.importFromImage(makeFile('r.png', 'image/png'));

      expect(cloudLLMProvider.extractTransactionsFromImage).toHaveBeenCalled();
      expect(result.transactions.length).toBe(1);
    });

    it('should throw when falling back but no provider is configured', async () => {
      strategyService.processReceipt.and.returnValue(Promise.resolve({
        source: 'cloud', confidence: 0, processingTimeMs: 1, transactions: []
      }));
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(false);

      await expectAsync(
        service.importFromImage(makeFile('r.png', 'image/png'))
      ).toBeRejectedWithError(AI_NO_PROVIDER);
    });
  });

  describe('remembered categories', () => {
    const oneItem = () => [
      { date: '2024-06-01', description: 'STARBUCKS', amount: 5, type: 'expense' as const,
        currency: 'JPY', imageIndex: 0, positionInImage: 'top' as const, confidence: 0.9, receiptId: 1 },
    ];

    it('uses a remembered category without asking the model', async () => {
      // The whole point: a merchant the user has already corrected costs no
      // tokens and gets the same answer every time.
      categoryMemory.lookup.and.returnValue('food_coffee');
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(cloudLLMProvider.categorizeTransactions).not.toHaveBeenCalled();
      expect(result.transactions[0].suggestedCategoryId).toBe('food_coffee');
    });

    it('stamps a remembered category just below certainty', async () => {
      // 1.0 means "the user confirmed this row". A remembered category is
      // strong evidence about the merchant, not agreement about this row, so a
      // wrong memory still reads as a suggestion worth scanning.
      categoryMemory.lookup.and.returnValue('food_coffee');
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(result.transactions[0].categoryConfidence).toBe(0.95);
      expect(result.transactions[0].categoryConfidence).toBeLessThan(1);
    });

    it('asks the model only about the merchants it does not know', async () => {
      categoryMemory.lookup.and.callFake((d: string) =>
        d === 'STARBUCKS' ? 'food_coffee' : null
      );
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo([
        ...oneItem(),
        { date: '2024-06-01', description: 'NEW PLACE', amount: 9, type: 'expense' as const,
          currency: 'JPY', imageIndex: 0, positionInImage: 'bottom' as const, confidence: 0.9, receiptId: 2 },
      ]);

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      const asked = cloudLLMProvider.categorizeTransactions.calls.mostRecent().args[0];
      expect(asked.length).toBe(1);
      expect(asked[0].description).toBe('NEW PLACE');
      // The model's answers must land back on the rows it was asked about.
      const starbucks = result.transactions.find(t => t.description === 'STARBUCKS');
      const newPlace = result.transactions.find(t => t.description === 'NEW PLACE');
      expect(starbucks?.suggestedCategoryId).toBe('food_coffee');
      expect(newPlace?.suggestedCategoryId).toBe('food');
    });

    it('grounds categorization in the user\'s history when RAG is on', async () => {
      authService.currentUser.and.returnValue({
        preferences: { baseCurrency: 'JPY', ragInsightsLevel: 'standard' },
      } as never);
      ragContext.buildCategorizationGrounding.and.returnValue(
        'How this user usually categorizes these merchants:\n- STARBUCKS → Coffee (food_coffee)'
      );
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      const grounding = cloudLLMProvider.categorizeTransactions.calls.mostRecent().args[1];
      expect(grounding).toContain('STARBUCKS → Coffee');
    });

    it('sends no grounding when RAG is off', async () => {
      // Off must leave the prompt exactly as it was before grounding existed,
      // and no transaction history leaves the device.
      authService.currentUser.and.returnValue({
        preferences: { baseCurrency: 'JPY', ragInsightsLevel: 'off' },
      } as never);
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(cloudLLMProvider.categorizeTransactions.calls.mostRecent().args[1]).toBeUndefined();
      expect(ragContext.buildCategorizationGrounding).not.toHaveBeenCalled();
    });

    it('categorizes unaided when the grounding cannot be built', async () => {
      spyOn(console, 'warn');
      authService.currentUser.and.returnValue({
        preferences: { baseCurrency: 'JPY', ragInsightsLevel: 'standard' },
      } as never);
      transactionService.getTransactions.and.returnValue(throwError(() => new Error('offline')));
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(cloudLLMProvider.categorizeTransactions).toHaveBeenCalled();
      expect(result.transactions.length).toBe(1);
    });

    it('skips the model entirely when every merchant is remembered', async () => {
      categoryMemory.lookup.and.returnValue('food_coffee');
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(oneItem());

      await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(cloudLLMProvider.categorizeTransactions).not.toHaveBeenCalled();
    });
  });

  describe('importFromStatementImages', () => {
    const statementRows = () => [
      { date: '2024-06-01', description: 'AMAZON', amount: 45.99, type: 'expense' as const, currency: 'USD' },
      { date: '2024-06-02', description: 'SALARY', amount: 3500, type: 'income' as const, currency: 'USD' },
      { date: '2024-06-03', description: 'WALMART', amount: 125.43, type: 'expense' as const, currency: 'USD' },
    ];

    beforeEach(() => {
      cloudLLMProvider.extractStatementTransactions.and.callFake(async () => statementRows());
    });

    it('keeps one transaction per statement row', async () => {
      // The receipt pipeline would have merged all three into one: rows the
      // model does not group share a receiptId and get consolidated.
      const result = await service.importFromStatementImages([makeFile('stmt.png', 'image/png')]);

      expect(result.transactions.length).toBe(3);
      expect(result.transactions.map(t => t.description)).toEqual(['AMAZON', 'SALARY', 'WALMART']);
    });

    it('preserves each row\'s own type and amount', async () => {
      const result = await service.importFromStatementImages([makeFile('stmt.png', 'image/png')]);

      const salary = result.transactions.find(t => t.description === 'SALARY');
      expect(salary?.type).toBe('income');
      expect(salary?.amount).toBe(3500);
    });

    it('reads every page of a multi-page statement', async () => {
      const result = await service.importFromStatementImages([
        makeFile('p1.png', 'image/png'),
        makeFile('p2.png', 'image/png'),
      ]);

      expect(cloudLLMProvider.extractStatementTransactions).toHaveBeenCalledTimes(2);
      expect(result.transactions.length).toBe(6);
    });

    it('never runs receipt consolidation', async () => {
      // Consolidation is what collapses a statement; the statement path must
      // not reach it at all.
      const result = await service.importFromStatementImages([makeFile('stmt.png', 'image/png')]);
      expect(result.transactions.every(t => t.imageMetadata === undefined)).toBeTrue();
    });

    it('rejects an empty file list', async () => {
      await expectAsync(service.importFromStatementImages([]))
        .toBeRejectedWithError(/No image files/);
    });

    it('records a statement batch as a screenshot, not a receipt', async () => {
      // fileType exists precisely to tell these apart; both used to say
      // receipt_image, so Import History could not distinguish them.
      const result = await service.importFromStatementImages([makeFile('stmt.png', 'image/png')]);

      expect(result.source).toBe('image');
      expect(result.fileType).toBe('screenshot');
    });
  });

  describe('importFromMultipleImages', () => {
    it('should throw for an empty file list', async () => {
      await expectAsync(service.importFromMultipleImages([])).toBeRejectedWithError(/No image files/);
    });

    it('should run a single file through the receipt-aware extraction, not importFromImage', async () => {
      spyOn(service, 'importFromImage');
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Solo item', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1 }
      ]));

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(service.importFromImage).not.toHaveBeenCalled();
      expect(cloudLLMProvider.extractTransactionsFromMultipleImages).toHaveBeenCalled();
      expect(result.transactions.length).toBe(1);
    });

    it('should split one photo containing two receipts into two transactions with their groups', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Item A', amount: 100, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1, merchant: 'Shop A' },
        { date: '2024-06-01', description: 'Item B', amount: 200, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'bottom', confidence: 0.8, receiptId: 2, merchant: 'Shop B' }
      ]));

      const result = await service.importFromMultipleImages([makeFile('a.png', 'image/png')]);

      expect(result.transactions.length).toBe(2);
      expect(result.transactions.map(t => t.imageMetadata?.receiptId)).toEqual([1, 2]);
    });

    it('should throw when no provider is configured', async () => {
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(false);
      await expectAsync(
        service.importFromMultipleImages([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')])
      ).toBeRejectedWithError(AI_NO_PROVIDER);
    });

    it('should consolidate single-item receipts as standalone transactions', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
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
      expect(result.transactions[0].fieldConfidence?.amount).toBe(REVIEW_AMOUNT_CONFIDENCE);
    });

    it('should merge multiple items sharing a receiptId into one transaction', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
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
      expect(result.transactions[0].fieldConfidence?.amount).toBe(REVIEW_AMOUNT_CONFIDENCE);
    });

    it('carries the merchant onto the reviewed row', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Item A', amount: 100, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1, merchant: 'Shop' },
        { date: '2024-06-01', description: 'Mystery', amount: 4, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'top', confidence: 0.9, receiptId: 2 }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.transactions[0].merchant).toBe('Shop');
      expect('merchant' in result.transactions[1]).toBeFalse();
    });

    it('should prefer the reported receipt total for a merged receipt', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Item A', amount: 100, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1, merchant: 'Shop' },
        { date: '2024-06-01', description: 'Item B', amount: 200, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'bottom', confidence: 0.7, receiptId: 1, receiptTotal: 330.9 }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].amount).toBe(330.9);
      expect(result.transactions[0].fieldConfidence).toBeUndefined();
    });

    it('should count items the AI already flagged as merged', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'Solo', amount: 10, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 4, wasMerged: true }
      ]));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      expect(result.multiImageMetadata?.itemsMerged).toBe(1);
    });

    it('should merge using AI-provided receipt details and a non-JPY currency', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
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
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
        { date: '2024-06-01', description: 'X', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1 },
        { date: '2024-06-01', description: 'Y', amount: 6, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'top', confidence: 0.9, receiptId: 9 }
      ]));
      cloudLLMProvider.categorizeTransactions.and.returnValue(Promise.reject(new Error('cat failed')));

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      // Two distinct receiptIds → two standalone transactions, categorization defaulted
      expect(result.transactions.length).toBe(2);
      expect(result.warnings.some(w => w.type === 'low_confidence')).toBeTrue();
    });

    it('lets a resolved extraction category override the ladder', async () => {
      // Providers emit `category` only when the model's name resolved to a
      // catalog id; that id wins over the ladder's answer (the documented
      // precedence), while an unresolved name arrives as undefined and the
      // ladder's answer stands.
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo([
        { date: '2024-06-01', description: 'X', amount: 5, type: 'expense', currency: 'JPY',
          imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1, category: 'transport' },
        { date: '2024-06-01', description: 'Y', amount: 6, type: 'expense', currency: 'JPY',
          imageIndex: 1, positionInImage: 'top', confidence: 0.9, receiptId: 9 },
      ]);

      const result = await service.importFromMultipleImages([
        makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')
      ]);

      const resolved = result.transactions.find(t => t.description === 'X');
      const unresolved = result.transactions.find(t => t.description === 'Y');
      expect(resolved?.suggestedCategoryId).toBe('transport');
      expect(unresolved?.suggestedCategoryId).toBe('food');
    });

    it('should add a duplicate warning when duplicates are detected', async () => {
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.returnValue(Promise.resolve([
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
    const pdfFile = () => {
      const file = makeFile('s.pdf', 'application/pdf');
      // jsdom's File has no arrayBuffer in this harness.
      (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
        () => Promise.resolve(new ArrayBuffer(8));
      return file;
    };

    beforeEach(() => {
      rasterize.and.resolveTo({
        pages: ['data:image/jpeg;base64,page1'],
        totalPages: 1,
        truncated: false,
      });
      cloudLLMProvider.extractStatementTransactions.and.resolveTo([
        { date: '2024-06-01', description: 'Deposit', amount: 500, type: 'income', currency: 'USD' },
        { date: '2024-06-02', description: 'Withdrawal', amount: 50, type: 'expense', currency: 'USD' },
      ]);
    });

    it('reads a PDF without Gemini configured', async () => {
      // The whole point of #55: this used to refuse outright, naming a
      // provider the user may never have chosen.
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(false);

      const result = await service.importFromPDF(pdfFile());

      expect(result.source).toBe('pdf');
      expect(result.fileType).toBe('bank_pdf');
      expect(result.transactions.length).toBe(2);
    });

    it('sends every rasterized page to the provider', async () => {
      rasterize.and.resolveTo({
        pages: ['page1', 'page2', 'page3'],
        totalPages: 3,
        truncated: false,
      });

      const result = await service.importFromPDF(pdfFile());

      expect(cloudLLMProvider.extractStatementTransactions).toHaveBeenCalledTimes(3);
      expect(result.transactions.length).toBe(6);
    });

    it('warns rather than silently dropping pages past the cap', async () => {
      rasterize.and.resolveTo({ pages: ['p1', 'p2'], totalPages: 40, truncated: true });

      const result = await service.importFromPDF(pdfFile());

      expect(result.warnings.some(w => w.message.includes('40'))).toBeTrue();
    });

    it('reports one analytics event, not two', async () => {
      // Routing through the sibling image import would tag receipt_scan as
      // well, and one PDF import would report twice.
      await service.importFromPDF(pdfFile());

      expect(analytics.trackAiAssistUsed).toHaveBeenCalledOnceWith({ feature: 'pdf_import' });
    });

    it('fails clearly when no page could be read', async () => {
      rasterize.and.resolveTo({ pages: [], totalPages: 0, truncated: false });

      await expectAsync(service.importFromPDF(pdfFile()))
        .toBeRejectedWithError(/No pages could be read/);
      expect(service.isProcessing()).toBeFalse();
    });

    it('surfaces a provider with no vision as a usable message', async () => {
      cloudLLMProvider.extractStatementTransactions.and.rejectWith(
        new Error('Reading a statement image needs a vision-capable provider')
      );

      await expectAsync(service.importFromPDF(pdfFile()))
        .toBeRejectedWithError(/vision-capable provider/);
    });
  });

  /**
   * Driven through the PDF path because it is the one extraction route that
   * reaches the timeout without a FileReader in the way: the rasterized pages
   * arrive on promises alone, so the request exists after a few microtasks and
   * the clock can be moved past it.
   */
  describe('extraction timeout', () => {
    const pdfFile = (): File => {
      const file = makeFile('s.pdf', 'application/pdf');
      (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
        () => Promise.resolve(new ArrayBuffer(8));
      return file;
    };

    /** Yield until the provider has been called, without needing a timer. */
    /**
     * Spin the microtask queue until the request has actually been issued.
     *
     * The clock is mocked by the time this runs, so a timer-based wait would
     * never fire — only microtasks make progress. The bound is generous
     * because how many of them the import path takes to reach the provider
     * depends on how many awaits sit in front of it, and a helper that gives
     * up early turns into an intermittent failure rather than a clear one.
     */
    const untilRequested = async (issued: () => boolean): Promise<void> => {
      for (let i = 0; i < 500 && !issued(); i++) {
        await Promise.resolve();
      }
    };

    beforeEach(() => {
      rasterize.and.resolveTo({ pages: ['page1'], totalPages: 1, truncated: false });
    });

    it('aborts the request it has stopped waiting for', async () => {
      // The failure this exists for: the UI reported a timeout while the
      // upload and download ran on to completion in the background, spending
      // the user's data on a result nobody was waiting for any more.
      let seen: AbortSignal | undefined;
      cloudLLMProvider.extractStatementTransactions.and.callFake((_page, options) => {
        seen = options?.signal;
        return new Promise<never>(() => undefined);
      });

      jasmine.clock().install();
      try {
        const pending = service.importFromPDF(pdfFile());
        await untilRequested(() => seen !== undefined);

        jasmine.clock().tick(60000);

        await expectAsync(pending).toBeRejectedWithError(/timed out/);
      } finally {
        jasmine.clock().uninstall();
      }

      expect(seen?.aborted).toBeTrue();
    });

    it('leaves a request that answered in time alone', async () => {
      let seen: AbortSignal | undefined;
      cloudLLMProvider.extractStatementTransactions.and.callFake((_page, options) => {
        seen = options?.signal;
        return Promise.resolve([
          { date: '2024-06-01', description: 'Deposit', amount: 500, type: 'income' as const,
            currency: 'USD' },
        ]);
      });

      const result = await service.importFromPDF(pdfFile());

      expect(result.transactions.length).toBe(1);
      expect(seen?.aborted).toBeFalse();
    });
  });

  describe('importFromCSV', () => {
    it('should parse, categorize and build a csv result', async () => {
      // Parser-real rows: parseCSV emits absolute amounts with the type
      // resolved separately. Signed fixtures here hid the mapper re-deriving
      // the type from a sign that is always positive.
      exportService.importFromCSV.and.returnValue(Promise.resolve([
        { description: 'Coffee', amount: 5, date: new Date(2024, 5, 1), type: 'expense', currency: 'USD' },
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

    // The CSV path climbs the same ladder the image paths do: memory, then
    // the model, then the review-flagged floor. A CSV row never carries an
    // extraction category, so every suggestion below is the ladder's.
    const csvRows = () => Promise.resolve([
      { description: 'Coffee', amount: 5, date: new Date(2024, 5, 1), type: 'expense', currency: 'USD' },
      { description: 'Refund', amount: 20, date: new Date(2024, 5, 2), type: 'income', currency: 'USD' }
    ] as never);

    it('keeps a parsed expense an expense', async () => {
      // parseCSV pushes Math.abs(amount) alongside the resolved type, so a
      // mapper that re-derives the type from the sign turns every real CSV
      // row into income.
      exportService.importFromCSV.and.returnValue(csvRows());

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      expect(result.transactions.map(t => t.type)).toEqual(['expense', 'income']);
    });

    it('derives the type from the sign only when the parser resolved none', async () => {
      exportService.importFromCSV.and.returnValue(Promise.resolve([
        { description: 'Legacy', amount: -8, date: new Date(2024, 5, 1) }
      ] as never));

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      expect(result.transactions[0].type).toBe('expense');
    });

    it('carries period, recurrence, tags, location and note onto the reviewed rows', async () => {
      // The same file imported through the data hub keeps all five; the
      // wizard used to drop them at this mapper.
      exportService.importFromCSV.and.returnValue(Promise.resolve([
        { description: 'Rent', amount: 1200, date: new Date(2024, 5, 1), type: 'expense', currency: 'USD',
          period: 'monthly', isRecurring: true, tags: ['home'], location: { name: 'Berlin' }, note: 'June' }
      ] as never));

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      const row = result.transactions[0];
      expect(row.period).toBe('monthly');
      expect(row.isRecurring).toBeTrue();
      expect(row.tags).toEqual(['home']);
      expect(row.location).toEqual({ name: 'Berlin' });
      expect(row.notes).toBe('June');
    });

    it('sends csv rows through the model with signed amounts and grounding', async () => {
      authService.currentUser.and.returnValue({
        preferences: { baseCurrency: 'USD', ragInsightsLevel: 'standard' },
      } as never);
      ragContext.buildCategorizationGrounding.and.returnValue(
        'How this user usually categorizes these merchants:\n- Coffee → Coffee (food_coffee)'
      );
      exportService.importFromCSV.and.returnValue(csvRows());

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      const [asked, grounding] = cloudLLMProvider.categorizeTransactions.calls.mostRecent().args;
      expect(asked.map(r => r.description)).toEqual(['Coffee', 'Refund']);
      // Signed the way the multi-image ladder signs: expenses negative.
      expect(asked.map(r => r.amount)).toEqual([-5, 20]);
      expect(grounding).toContain('food_coffee');
      // The model's answers land on the rows with their real confidences.
      expect(result.transactions.map(t => t.suggestedCategoryId)).toEqual(['food', 'food']);
      expect(result.transactions.map(t => t.categoryConfidence)).toEqual([0.8, 0.8]);
    });

    it('keeps the floor and warns when no provider is configured', async () => {
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(false);
      exportService.importFromCSV.and.returnValue(csvRows());

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      expect(cloudLLMProvider.categorizeTransactions).not.toHaveBeenCalled();
      expect(result.transactions.every(t => t.suggestedCategoryId === 'other_expense')).toBeTrue();
      expect(result.transactions.every(t => t.categoryConfidence === 0.1)).toBeTrue();
      expect(result.warnings.some(w => w.type === 'low_confidence')).toBeTrue();
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('defaults to the floor and warns when the model fails', async () => {
      spyOn(console, 'warn');
      cloudLLMProvider.categorizeTransactions.and.rejectWith(new Error('cat failed'));
      exportService.importFromCSV.and.returnValue(csvRows());

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      expect(result.transactions.every(t => t.categoryConfidence === 0.1)).toBeTrue();
      expect(result.warnings.some(w => w.type === 'low_confidence')).toBeTrue();
    });

    it('answers a remembered merchant from memory without asking the model about it', async () => {
      categoryMemory.lookup.and.callFake((d: string) => (d === 'Coffee' ? 'food_coffee' : null));
      exportService.importFromCSV.and.returnValue(csvRows());

      const result = await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      const asked = cloudLLMProvider.categorizeTransactions.calls.mostRecent().args[0];
      expect(asked.map(r => r.description)).toEqual(['Refund']);
      const coffee = result.transactions.find(t => t.description === 'Coffee');
      expect(coffee?.suggestedCategoryId).toBe('food_coffee');
      expect(coffee?.categoryConfidence).toBe(0.95);
    });

    it('names the categorization step for what it does', async () => {
      const setSpy = spyOn(service.processingStatus, 'set').and.callThrough();
      exportService.importFromCSV.and.returnValue(csvRows());

      await service.importFromCSV(makeFile('data.csv', 'text/csv'));

      const statuses = setSpy.calls.allArgs().map(([status]) => status);
      // Whichever rung answers — memory, model or the flagged floor — the
      // step is categorization; the old string claimed an AI call the path
      // never made.
      expect(statuses).toContain('Categorizing transactions...');
      expect(statuses).not.toContain('Categorizing with AI...');
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

    it('carries the optional fields a backup row holds', async () => {
      const backup = {
        transactions: [
          { description: 'Rent', amount: -1200, type: 'expense', categoryId: 'housing',
            date: { seconds: 1700000000 }, note: 'June', tags: ['home'],
            location: { name: 'Berlin' }, period: 'monthly', isRecurring: true },
          { description: 'Bare', amount: -5, type: 'expense', date: { seconds: 1700000000 } }
        ]
      };
      const file = makeFile('backup.json', 'application/json', JSON.stringify(backup));

      const result = await service.importFromJSON(file);

      const row = result.transactions[0];
      expect(row.notes).toBe('June');
      expect(row.tags).toEqual(['home']);
      expect(row.location).toEqual({ name: 'Berlin' });
      expect(row.period).toBe('monthly');
      expect(row.isRecurring).toBeTrue();
      expect('tags' in result.transactions[1]).toBeFalse();
      expect('isRecurring' in result.transactions[1]).toBeFalse();
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

    it('grades a category-bearing row above a category-less one', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Taxi', amount: 15, type: 'expense', currency: 'USD', category: 'transport' },
        { date: '2024-06-01', description: 'Mystery', amount: 4, type: 'expense', currency: 'USD' }
      ]);

      // The grade follows the evidence: 0.8 is reserved for a row whose
      // extraction actually named a category; a defaulted row sits under the
      // 0.5 review band instead of wearing a high chip it never earned.
      expect(result[0].categoryConfidence).toBe(0.8);
      expect(result[1].suggestedCategoryId).toBe('other_expense');
      expect(result[1].categoryConfidence).toBe(0.3);
    });

    it('should default category, currency, type and date when missing', async () => {
      (authService.currentUser as jasmine.Spy).and.returnValue(null);

      const result = await service.categorizeTransactions([
        { date: '', description: 'Unknown', amount: -8, type: undefined as never, currency: '' }
      ]);

      expect(result[0].suggestedCategoryId).toBe('other_expense');
      expect(result[0].categoryConfidence).toBe(0.3);
      expect(result[0].currency).toBe('USD'); // fallback base currency
      expect(result[0].type).toBe('expense');
      expect(result[0].date instanceof Date).toBeTrue();
    });

    it('flags an unreadable date with zero confidence instead of silently dating it today', async () => {
      const result = await service.categorizeTransactions([
        // A day that does not exist: parseDateInput rejects it rather than
        // letting V8 roll it into 3 March.
        { date: '2024-06-31', description: 'Ghost', amount: 5, type: 'expense', currency: 'USD',
          dateConfidence: 0.95 },
        { date: '2024-06-01', description: 'Real', amount: 5, type: 'expense', currency: 'USD',
          dateConfidence: 0.95 },
      ]);

      // Defaulted to a valid date so the row cannot poison a query...
      expect(result[0].date instanceof Date).toBeTrue();
      expect(Number.isFinite(result[0].date.getTime())).toBeTrue();
      // ...but flagged for verification, overriding the model's own optimism.
      expect(result[0].fieldConfidence?.date).toBe(0);
      expect(result[1].fieldConfidence?.date).toBe(0.95);
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

    it('copies the merchant the extraction named, and only then', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Burger', amount: 9, type: 'expense', currency: 'USD',
          merchant: 'Diner' },
        { date: '2024-06-01', description: 'Mystery', amount: 4, type: 'expense', currency: 'USD' }
      ]);

      // The slot was declared and never assigned; the value reached this
      // method and died inside originalText, where nothing can query it.
      expect(result[0].merchant).toBe('Diner');
      expect('merchant' in result[1]).toBeFalse();
    });

    it('carries the optional fields the source answered, and invents none', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Rent', amount: 1200, type: 'expense', currency: 'USD',
          tags: ['home'], location: { name: 'Berlin' }, period: 'monthly', isRecurring: true },
        { date: '2024-06-01', description: 'Bare', amount: 4, type: 'expense', currency: 'USD' }
      ]);

      expect(result[0].tags).toEqual(['home']);
      expect(result[0].location).toEqual({ name: 'Berlin' });
      expect(result[0].period).toBe('monthly');
      expect(result[0].isRecurring).toBeTrue();
      // Absent must keep meaning "nobody looked" — no empty arrays, no
      // defaulted flags.
      expect('tags' in result[1]).toBeFalse();
      expect('location' in result[1]).toBeFalse();
      expect('period' in result[1]).toBeFalse();
      expect('isRecurring' in result[1]).toBeFalse();
    });

    it('prefers a row note over formatted details', async () => {
      const result = await service.categorizeTransactions([
        { date: '2024-06-01', description: 'Rent', amount: 1200, type: 'expense', currency: 'USD',
          note: 'June, paid early', details: 'a, b' }
      ]);

      // A CSV note is content, not an item list — formatItemNotes would
      // split its commas into newlines.
      expect(result[0].notes).toBe('June, paid early');
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

    describe('history read-back', () => {
      it('skips a null first emission and resolves on the record', async () => {
        // subscribeToDocument emits null while the write is still landing;
        // the read-back must wait for the document, not resolve on nothing.
        importHistoryService.getImportById.and.returnValue(of(null, completedHistory));

        const history = await service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image');

        expect(history).toEqual(completedHistory);
      });

      it('rejects with the read-back constant when the stream errors, without failing the import', async () => {
        spyOn(console, 'error');
        importHistoryService.getImportById.and.returnValue(throwError(() => new Error('permission-denied')));

        await expectAsync(
          service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image')
        ).toBeRejectedWithError(IMPORT_READBACK_FAILED);

        // Every row was written and completeImport ran; a failing read must
        // not stamp the completed import as failed.
        expect(importHistoryService.completeImport).toHaveBeenCalled();
        expect(importHistoryService.failImport).not.toHaveBeenCalled();
        expect(service.isProcessing()).toBeFalse();
      });

      it('times out a read-back that never emits instead of hanging the wizard', fakeAsync(() => {
        spyOn(console, 'error');
        importHistoryService.getImportById.and.returnValue(NEVER);

        let rejection: Error | undefined;
        service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image')
          .catch((e: Error) => { rejection = e; });

        tick();
        expect(rejection).toBeUndefined();

        tick(IMPORT_READBACK_TIMEOUT_MS + 1);
        expect(rejection?.message).toBe(IMPORT_READBACK_FAILED);
        expect(importHistoryService.failImport).not.toHaveBeenCalled();
      }));
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

    describe('budget recalculation', () => {
      it('recalculates each distinct expense category once, after the loop', async () => {
        const order: string[] = [];
        transactionService.addTransaction.and.callFake(async () => {
          order.push('save');
          return 'txn-id';
        });
        budgetService.recalculateBudgetsForCategory.and.callFake(async (categoryId: string) => {
          order.push(`recalc:${categoryId}`);
        });

        await service.confirmImport(
          [
            selected({ id: 'a', suggestedCategoryId: 'food' }),
            selected({ id: 'b', suggestedCategoryId: 'food' }),
            selected({ id: 'c', suggestedCategoryId: 'transport' }),
            selected({ id: 'd', type: 'income', suggestedCategoryId: 'salary' })
          ],
          'r.png', 10, 'image', 'receipt_image'
        );

        // Every row defers the recalculation to the deduped pass below.
        for (const args of transactionService.addTransaction.calls.allArgs()) {
          expect(args[1]).toEqual({ skipBudgetRecalc: true });
        }
        // One recalculation per distinct expense category, after every save.
        expect(order).toEqual(['save', 'save', 'save', 'save', 'recalc:food', 'recalc:transport']);
      });

      it('does not recalculate a category whose only row failed to save', async () => {
        transactionService.addTransaction.and.returnValues(
          Promise.reject(new Error('save failed')),
          Promise.resolve('txn-2')
        );

        await service.confirmImport(
          [
            selected({ id: 'a', suggestedCategoryId: 'doomed' }),
            selected({ id: 'b', suggestedCategoryId: 'food' })
          ],
          'r.png', 10, 'image', 'receipt_image'
        );

        expect(budgetService.recalculateBudgetsForCategory.calls.allArgs()).toEqual([['food']]);
      });

      it('recalculates nothing for an income-only import', async () => {
        await service.confirmImport(
          [selected({ id: 'a', type: 'income' })],
          'r.png', 10, 'image', 'receipt_image'
        );

        expect(budgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
      });

      it('completes the import even when a recalculation fails', async () => {
        // The rows are saved; a lagging spent counter is recovered by the
        // next recalculation, so it must not stamp the import as failed.
        spyOn(console, 'warn');
        budgetService.recalculateBudgetsForCategory.and.rejectWith(new Error('offline'));

        const history = await service.confirmImport(
          [selected()], 'r.png', 10, 'image', 'receipt_image'
        );

        expect(history).toEqual(completedHistory);
        expect(importHistoryService.failImport).not.toHaveBeenCalled();
      });
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

    it('passes every supported field through to addTransaction', async () => {
      // The spec #313 demands: a row carrying the optional fields is stored
      // with all of them. The old hand-written DTO named six fields, so a
      // field added upstream was dropped here without failing anything.
      await service.confirmImport(
        [selected({
          notes: 'team lunch',
          tags: ['work', 'reimbursable'],
          location: { name: 'Berlin Mitte' },
          period: 'monthly',
          isRecurring: true
        })],
        'r.png', 10, 'image', 'receipt_image'
      );

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto).toEqual({
        type: 'expense',
        amount: 5,
        currency: 'USD',
        categoryId: 'food',
        description: 'Coffee',
        date: new Date(2024, 5, 1),
        note: 'team lunch',
        tags: ['work', 'reimbursable'],
        location: { name: 'Berlin Mitte' },
        period: 'monthly',
        isRecurring: true
      });
    });

    it('sends a bare row as exactly the six required keys', async () => {
      // No undefined-valued key may ride toward Firestore, and no optional
      // may be invented for a row nobody answered.
      await service.confirmImport([selected()], 'r.png', 10, 'image', 'receipt_image');

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(Object.keys(dto).sort()).toEqual(
        ['amount', 'categoryId', 'currency', 'date', 'description', 'type'].sort()
      );
    });

    const withMeta = (overrides: Partial<CategorizedImportTransaction>, meta: Partial<CategorizedImportTransaction['imageMetadata'] & object>) =>
      selected({
        ...overrides,
        imageMetadata: {
          imageIndex: 0,
          imageId: 'image_0',
          positionInImage: 'middle',
          confidenceScore: 0.9,
          ...meta
        }
      });

    it('attaches each receipt its own photos, in photo order', async () => {
      const fileA = new File(['a'], 'a.png', { type: 'image/png' });
      const fileB = new File(['b'], 'b.png', { type: 'image/png' });
      const fileC = new File(['c'], 'c.png', { type: 'image/png' });

      await service.confirmImport(
        [
          withMeta({ id: 'a' }, { imageIndex: 0, receiptId: 1, mergedFromImages: [1, 0] }),
          withMeta({ id: 'b' }, { imageIndex: 2, receiptId: 2 })
        ],
        'r.png', 10, 'image', 'receipt_image',
        [fileA, fileB, fileC]
      );

      const dtos = transactionService.addTransaction.calls.all().map(c => c.args[0]);
      // The merged receipt keeps every photo it was read from, in photo
      // order; the second receipt gets its own and nobody else's.
      expect(dtos[0].receiptFiles).toEqual([fileA, fileB]);
      expect(dtos[1].receiptFiles).toEqual([fileC]);
    });

    it('attaches a receipt group on its first row only', async () => {
      const fileA = new File(['a'], 'a.png', { type: 'image/png' });

      await service.confirmImport(
        [
          withMeta({ id: 'a' }, { imageIndex: 0, receiptId: 1 }),
          withMeta({ id: 'b' }, { imageIndex: 0, receiptId: 1 })
        ],
        'r.png', 10, 'image', 'receipt_image',
        [fileA]
      );

      const dtos = transactionService.addTransaction.calls.all().map(c => c.args[0]);
      expect(dtos[0].receiptFiles).toEqual([fileA]);
      expect('receiptFiles' in dtos[1]).toBeFalse();
    });

    it('attaches nothing to rows without image metadata even when files ride along', async () => {
      // A CSV, PDF or JSON row has no idea which photo it came from, because
      // it came from none.
      await service.confirmImport(
        [selected()],
        'r.png', 10, 'image', 'receipt_image',
        [new File(['a'], 'a.png', { type: 'image/png' })]
      );

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect('receiptFiles' in dto).toBeFalse();
    });

    it('saves the row without its photo when the image quota refuses, and reports that distinctly', async () => {
      const fileA = new File(['a'], 'a.png', { type: 'image/png' });
      transactionService.addTransaction.and.callFake(dto =>
        dto.receiptFiles?.length
          ? Promise.reject(new Error(RECEIPT_IMAGE_LIMIT_ERROR))
          : Promise.resolve('txn-id')
      );

      await service.confirmImport(
        [withMeta({}, { imageIndex: 0, receiptId: 1 })],
        'r.png', 10, 'image', 'receipt_image',
        [fileA]
      );

      // Retried without the photo: the transaction is still worth saving,
      // and the quota refusal happens before any upload or write.
      const dtos = transactionService.addTransaction.calls.all().map(c => c.args[0]);
      expect(dtos.length).toBe(2);
      expect(dtos[0].receiptFiles).toEqual([fileA]);
      expect('receiptFiles' in dtos[1]).toBeFalse();

      // A skipped photo is not a failed row. Routing it through the error
      // list would re-offer a saved row for a second import.
      const stats = importHistoryService.completeImport.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(stats['successCount']).toBe(1);
      expect(stats['errorCount']).toBe(0);
      expect(stats['receiptsSkipped']).toBe(1);
      expect('errors' in stats).toBeFalse();
    });

    it('keeps an upload failure a failed row, with no skip recorded', async () => {
      transactionService.addTransaction.and.callFake(dto =>
        dto.receiptFiles?.length
          ? Promise.reject(new Error(RECEIPT_ATTACH_FAILED))
          : Promise.resolve('txn-id')
      );

      await service.confirmImport(
        [withMeta({}, { imageIndex: 0, receiptId: 1 })],
        'r.png', 10, 'image', 'receipt_image',
        [new File(['a'], 'a.png', { type: 'image/png' })]
      );

      // A failed upload is not a quota refusal: retrying photo-less here
      // would silently drop photos on a flaky network.
      const stats = importHistoryService.completeImport.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(stats['errorCount']).toBe(1);
      expect(stats['successCount']).toBe(0);
      expect('receiptsSkipped' in stats).toBeFalse();
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
      { input: 'request timed out', type: 'timeout', retryable: true },
      { input: 'Request was aborted.', type: 'timeout', retryable: true }
    ];

    cases.forEach(({ input, type, retryable }) => {
      it(`should classify "${input}" as ${type}`, () => {
        const parsed = service.parseAIError(new Error(input));
        expect(parsed.type).toBe(type as never);
        expect(parsed.retryable).toBe(retryable);
        expect(parsed.message.length).toBeGreaterThan(0);
      });
    });

    it('should read a cancelled request as the timeout that caused it', () => {
      // Our own timeout is what fires the abort, but the SDKs report it in
      // whatever words they like — 'AI processing failed: …' would tell the
      // user nothing about the minute they had just spent waiting.
      const cancelled = new Error('The operation was cancelled');
      cancelled.name = 'AbortError';

      const parsed = service.parseAIError(cancelled);

      expect(parsed.type).toBe('timeout');
      expect(parsed.message).toContain('timed out');
    });

    it('hands our own throws to the screen as a key, not as English', () => {
      // These used to be matched by substring against English prose, so they
      // could never be translated and rewording one silently reclassified it.
      const parsed = service.parseAIError(new Error(AI_NO_PROVIDER));
      expect(parsed.type).toBe('auth');
      expect(parsed.retryable).toBeFalse();
      expect(parsed.messageKey).toBe('import.errorNoProvider');
    });

    it('classifies a queued-offline throw as a network condition', () => {
      const parsed = service.parseAIError(new Error(AI_QUEUED_OFFLINE));
      expect(parsed.type).toBe('network');
      expect(parsed.messageKey).toBe('import.errorQueuedOffline');
    });

    it('leaves a provider its own wording, which cannot be translated', () => {
      const parsed = service.parseAIError(new Error('something weird happened'));
      expect(parsed.messageKey).toBeUndefined();
      expect(parsed.message).toContain('something weird happened');
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
