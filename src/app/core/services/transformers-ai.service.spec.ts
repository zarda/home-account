import { TestBed } from '@angular/core/testing';
import { TransformersAIService } from './transformers-ai.service';
import { MLWorkerService } from './ml-worker.service';

describe('TransformersAIService', () => {
  let service: TransformersAIService;
  let mlWorkerServiceMock: jasmine.SpyObj<MLWorkerService>;

  beforeEach(() => {
    mlWorkerServiceMock = jasmine.createSpyObj('MLWorkerService', [
      'isReady',
      'isLoading',
      'progress',
      'status',
      'error',
      'isSupported',
      'modelSize',
      'initialize',
      'parseReceipt',
      'terminate',
    ], {
      MODEL_SIZE_MB: 65,
    });

    // Default mock returns
    mlWorkerServiceMock.isReady.and.returnValue(false);
    mlWorkerServiceMock.isLoading.and.returnValue(false);
    mlWorkerServiceMock.progress.and.returnValue(0);
    mlWorkerServiceMock.status.and.returnValue('');
    mlWorkerServiceMock.error.and.returnValue(null);
    mlWorkerServiceMock.isSupported.and.returnValue(true);
    mlWorkerServiceMock.modelSize.and.returnValue(65 * 1024 * 1024);

    TestBed.configureTestingModule({
      providers: [
        TransformersAIService,
        { provide: MLWorkerService, useValue: mlWorkerServiceMock },
      ],
    });

    service = TestBed.inject(TransformersAIService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should be ready (rule-based parsing always available)', () => {
      expect(service.isReady()).toBeTrue();
    });

    it('should not have ML model ready initially', () => {
      expect(service.mlModelReady()).toBeFalse();
    });

    it('should support ML if worker is supported', () => {
      expect(service.mlModelSupported()).toBeTrue();
    });

    it('should return ML model size', () => {
      expect(service.getMLModelSizeFormatted()).toBe('65 MB');
    });
  });

  describe('detectRegion', () => {
    it('should detect Taiwan region from Traditional Chinese text', async () => {
      const result = await service.parseReceiptText('統一發票 民國113年 總計 NT$500');
      expect(result.currency).toBe('TWD');
    });

    it('should detect Japan region from Japanese text', async () => {
      const result = await service.parseReceiptText('レシート 合計 ¥1000');
      expect(result.currency).toBe('JPY');
    });

    it('should detect Hong Kong region from HK patterns', async () => {
      const result = await service.parseReceiptText('收據 總數 HK$100');
      expect(result.currency).toBe('HKD');
    });

    it('should default to international for English text', async () => {
      const result = await service.parseReceiptText('RECEIPT Total $50.00');
      expect(result.currency).toBe('USD');
    });
  });

  describe('parseReceiptText (rule-based)', () => {
    it('should extract merchant from header lines', async () => {
      const text = `COSTCO WHOLESALE
123 Main Street
Date: 2024-01-15
ITEM 1    $10.00
ITEM 2    $20.00
TOTAL     $30.00`;

      const result = await service.parseReceiptText(text);
      expect(result.merchant.toUpperCase()).toContain('COSTCO');
    });

    it('should extract date from various formats', async () => {
      const text = `Store Name
Date: 2024-01-15
Total: $50.00`;

      const result = await service.parseReceiptText(text);
      expect(result.date).toBe('2024-01-15');
    });

    it('should extract total amount', async () => {
      const text = `Item 1 $10.00
Item 2 $15.00
TOTAL: $25.00`;

      const result = await service.parseReceiptText(text);
      expect(result.total).toBe(25);
    });

    it('should extract items with prices', async () => {
      const text = `Coffee    $5.00
Sandwich  $12.00
Cookie    $3.00
Total     $20.00`;

      const result = await service.parseReceiptText(text);
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should handle ROC/Minguo date format', async () => {
      const text = `統一發票
民國113年01月15日
金額 NT$500`;

      const result = await service.parseReceiptText(text);
      // 113 + 1911 = 2024
      expect(result.date).toBe('2024-01-15');
    });

    it('should calculate overall confidence', async () => {
      const text = `Store Name
2024-01-15
Total $50.00`;

      const result = await service.parseReceiptText(text);
      expect(result.overallConfidence).toBeGreaterThan(0);
      expect(result.overallConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('ML model integration', () => {
    it('should download ML model when requested', async () => {
      mlWorkerServiceMock.initialize.and.returnValue(Promise.resolve());

      await service.downloadMLModel();

      expect(mlWorkerServiceMock.initialize).toHaveBeenCalled();
    });

    it('should throw error if Web Workers not supported', async () => {
      mlWorkerServiceMock.isSupported.and.returnValue(false);

      await expectAsync(service.downloadMLModel()).toBeRejectedWithError('Web Workers not supported in this browser');
    });

    it('should use ML when model is ready', async () => {
      mlWorkerServiceMock.isReady.and.returnValue(true);
      mlWorkerServiceMock.parseReceipt.and.returnValue(Promise.resolve({
        merchant: 'ML Store',
        merchantConfidence: 0.9,
        date: '2024-01-15',
        dateConfidence: 0.85,
        total: 100,
        totalConfidence: 0.95,
        currency: 'USD',
        rawAnswers: {},
      }));

      const result = await service.parseReceiptText('Test receipt');

      expect(mlWorkerServiceMock.parseReceipt).toHaveBeenCalled();
      expect(result.merchant).toBe('ML Store');
    });

    it('should fall back to rule-based if ML fails', async () => {
      mlWorkerServiceMock.isReady.and.returnValue(true);
      mlWorkerServiceMock.parseReceipt.and.returnValue(Promise.reject(new Error('ML failed')));

      // Should not throw, should fall back
      const result = await service.parseReceiptText(`Store Name
Total $50.00`);

      expect(result).toBeDefined();
      expect(result.total).toBe(50);
    });
  });

  describe('terminate', () => {
    it('should terminate ML worker', async () => {
      mlWorkerServiceMock.terminate.and.returnValue();

      await service.terminate();

      expect(mlWorkerServiceMock.terminate).toHaveBeenCalled();
    });
  });
});
