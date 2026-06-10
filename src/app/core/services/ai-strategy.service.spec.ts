import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { AIStrategyService } from './ai-strategy.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { NativeReceiptService } from './native-receipt.service';
import { ProcessingResult } from './ai-types';
import { ParsedReceipt, MultiImageExtractedTransaction } from './gemini.service';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

describe('AIStrategyService', () => {
  let cloudMock: jasmine.SpyObj<CloudLLMProviderService>;
  let pwaMock: jasmine.SpyObj<PwaService>;
  let authMock: jasmine.SpyObj<AuthService>;
  let visionMock: jasmine.SpyObj<VisionOcrService>;
  let appleMock: jasmine.SpyObj<AppleIntelligenceService>;
  let nativeMock: jasmine.SpyObj<NativeReceiptService>;

  const imageFile = () => new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

  const parsedReceipt: ParsedReceipt = {
    merchant: 'Coffee Corner',
    amount: 12.5,
    currency: 'USD',
    date: new Date('2026-01-15'),
    receiptDetails: 'Latte — USD 12.50',
    suggestedCategory: 'food_coffee_&_drinks',
    confidence: 0.85,
  };

  const nativeResult: ProcessingResult = {
    transactions: [{
      date: new Date('2026-01-15'),
      description: 'Coffee Corner',
      amount: 12.5,
      type: 'expense',
      currency: 'USD',
      confidence: 0.9,
      source: 'native',
    }],
    source: 'native',
    confidence: 0.9,
    processingTimeMs: 0,
  };

  beforeEach(() => {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);

    cloudMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'initializeFromUserPreferences',
      'hasAnyCloudProvider',
      'availableProviders',
      'providerStatus',
      'parseReceipt',
      'extractTransactionsFromMultipleImages',
      'reinitializeGemini',
      'updateProviderApiKey',
    ]);
    cloudMock.hasAnyCloudProvider.and.returnValue(true);
    cloudMock.availableProviders.and.returnValue(['gemini']);
    cloudMock.providerStatus.and.returnValue({ gemini: true, openai: false, claude: false });
    cloudMock.parseReceipt.and.resolveTo(parsedReceipt);

    pwaMock = jasmine.createSpyObj('PwaService', ['isOnline']);
    pwaMock.isOnline.and.returnValue(true);

    authMock = jasmine.createSpyObj('AuthService', ['currentUser']);
    authMock.currentUser.and.returnValue(null);

    visionMock = jasmine.createSpyObj('VisionOcrService', [
      'detectEnvironment',
      'isAvailable',
      'recognizeText',
      'isMacEnvironment',
    ]);
    visionMock.isMacEnvironment.and.returnValue(false);

    appleMock = jasmine.createSpyObj('AppleIntelligenceService', [
      'detectAvailability',
      'isModelAvailable',
      'parseReceiptText',
    ]);
    appleMock.isModelAvailable.and.returnValue(false);

    nativeMock = jasmine.createSpyObj('NativeReceiptService', ['processImage', 'processImages']);
    nativeMock.processImage.and.resolveTo(nativeResult);
    nativeMock.processImages.and.resolveTo(nativeResult);

    TestBed.configureTestingModule({
      providers: [
        AIStrategyService,
        { provide: CloudLLMProviderService, useValue: cloudMock },
        { provide: PwaService, useValue: pwaMock },
        { provide: AuthService, useValue: authMock },
        { provide: VisionOcrService, useValue: visionMock },
        { provide: AppleIntelligenceService, useValue: appleMock },
        { provide: NativeReceiptService, useValue: nativeMock },
      ],
    });
  });

  afterEach(() => {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  });

  function createService(platform: 'web' | 'ios'): AIStrategyService {
    spyOn(Capacitor, 'getPlatform').and.returnValue(platform);
    return TestBed.inject(AIStrategyService);
  }

  describe('routing', () => {
    it('should not use native OCR on the web', () => {
      const service = createService('web');
      expect(service.useNativeOCR()).toBeFalse();
    });

    it('should use native OCR on iPhone/iPad', () => {
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should prefer cloud on a Mac without Apple Intelligence', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeFalse();
    });

    it('should prefer the native pipeline on a Mac with Apple Intelligence', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      appleMock.isModelAvailable.and.returnValue(true);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should use native OCR on a Mac when no cloud provider is configured', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should probe native capabilities on iOS at startup', () => {
      createService('ios');
      expect(visionMock.detectEnvironment).toHaveBeenCalled();
      expect(appleMock.detectAvailability).toHaveBeenCalled();
    });

    it('should not probe native capabilities on the web', () => {
      createService('web');
      expect(visionMock.detectEnvironment).not.toHaveBeenCalled();
      expect(appleMock.detectAvailability).not.toHaveBeenCalled();
    });
  });

  describe('processReceipt', () => {
    it('should process with cloud AI on the web', async () => {
      const service = createService('web');
      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(nativeMock.processImage).not.toHaveBeenCalled();
      expect(result.source).toBe('cloud');
      expect(result.transactions[0].description).toBe('Coffee Corner');
      expect(result.transactions[0].suggestedCategoryId).toBe('food_coffee_&_drinks');
      expect(result.transactions[0].notes).toBe('Latte — USD 12.50');
    });

    it('should reject on the web when cloud AI is unavailable', async () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('web');

      await expectAsync(service.processReceipt(imageFile()))
        .toBeRejectedWithError(/Cloud AI is not available/);
    });

    it('should process with the native pipeline on iOS', async () => {
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(nativeMock.processImage).toHaveBeenCalled();
      expect(cloudMock.parseReceipt).not.toHaveBeenCalled();
      expect(result.source).toBe('native');
    });

    it('should fall back to cloud when native processing fails', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.source).toBe('cloud');
    });

    it('should rethrow native errors when cloud is unavailable', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');

      await expectAsync(service.processReceipt(imageFile()))
        .toBeRejectedWithError('OCR failed');
    });

    it('should fall back to native OCR when cloud fails on a Mac', async () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      cloudMock.parseReceipt.and.rejectWith(new Error('rate limited'));
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(nativeMock.processImage).toHaveBeenCalled();
      expect(result.source).toBe('native');
    });

    it('should record processing time and reset the processing flag', async () => {
      const service = createService('web');
      const result = await service.processReceipt(imageFile());

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(service.isProcessing()).toBeFalse();
      expect(service.lastProcessingTime()).toBe(result.processingTimeMs);
    });
  });

  describe('processMultipleImages', () => {
    it('should map cloud extractions to transactions', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', details: 'set menu', imageIndex: 0, positionInImage: 'top', confidence: 0.8,
        },
        {
          date: '2026-01-16', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, positionInImage: 'top', confidence: 0.6,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(2);
      expect(result.transactions[0].notes).toBe('set menu');
      expect(result.confidence).toBeCloseTo(0.7);
      expect(result.source).toBe('cloud');
    });

    it('should process with the native pipeline on iOS', async () => {
      const service = createService('ios');
      const result = await service.processMultipleImages([imageFile()]);

      expect(nativeMock.processImages).toHaveBeenCalled();
      expect(result.source).toBe('native');
    });
  });

  describe('preferences', () => {
    it('should start with default models', () => {
      const service = createService('web');
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
      expect(service.preferences().visionModel).toBe(DEFAULT_VISION_MODEL);
    });

    it('should persist updated preferences and reinitialize Gemini', () => {
      const service = createService('web');
      service.updatePreferences({ textModel: 'gemma-4-26b-a4b-it' });

      expect(service.preferences().textModel).toBe('gemma-4-26b-a4b-it');
      expect(cloudMock.reinitializeGemini).toHaveBeenCalledWith('gemma-4-26b-a4b-it', DEFAULT_VISION_MODEL);

      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!);
      expect(stored.textModel).toBe('gemma-4-26b-a4b-it');
    });

    it('should revert preferences when Gemini reinitialization fails', () => {
      cloudMock.reinitializeGemini.and.throwError('bad model');
      const service = createService('web');

      expect(() => service.updatePreferences({ visionModel: 'broken-model' }))
        .toThrowError(/Failed to switch AI models/);
      expect(service.preferences().visionModel).toBe(DEFAULT_VISION_MODEL);
    });

    it('should reset preferences to defaults', () => {
      const service = createService('web');
      service.updatePreferences({ autoSync: false });
      service.resetPreferences();

      expect(service.preferences().autoSync).toBeTrue();
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
    });

    it('should load stored preferences over defaults', () => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ autoSync: false }));
      const service = createService('web');

      expect(service.preferences().autoSync).toBeFalse();
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
    });
  });

  describe('getStatusInfo', () => {
    it('should report the full status snapshot', () => {
      appleMock.isModelAvailable.and.returnValue(true);
      visionMock.isMacEnvironment.and.returnValue(true);
      const service = createService('ios');

      const status = service.getStatusInfo();

      expect(status.cloudAvailable).toBeTrue();
      expect(status.nativeAvailable).toBeTrue();
      expect(status.appleIntelligenceAvailable).toBeTrue();
      expect(status.isMacEnvironment).toBeTrue();
      expect(status.isOnline).toBeTrue();
      expect(status.platform).toBe('ios');
      expect(status.availableProviders).toEqual(['gemini']);
    });
  });

  describe('updateCloudProviderApiKey', () => {
    it('should delegate to the cloud provider service', () => {
      const service = createService('web');
      service.updateCloudProviderApiKey('gemini', 'key-123');
      expect(cloudMock.updateProviderApiKey).toHaveBeenCalledWith('gemini', 'key-123');
    });
  });
});
