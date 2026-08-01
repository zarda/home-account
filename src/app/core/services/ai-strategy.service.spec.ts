import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { AIStrategyService, AI_CLOUD_UNAVAILABLE } from './ai-strategy.service';
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
      'setOpenAIModel',
      'setClaudeModel',
    ]);
    cloudMock.hasAnyCloudProvider.and.returnValue(true);
    cloudMock.availableProviders.and.returnValue(['gemini']);
    cloudMock.providerStatus.and.returnValue({ gemini: true, openai: false, claude: false });
    cloudMock.parseReceipt.and.resolveTo(parsedReceipt);

    pwaMock = jasmine.createSpyObj('PwaService', ['isOnline']);
    pwaMock.isOnline.and.returnValue(true);

    authMock = jasmine.createSpyObj('AuthService', ['currentUser'], {
      userId: signal<string | null>(null),
    });
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
        .toBeRejectedWithError(AI_CLOUD_UNAVAILABLE);
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

    it('carries the receipt count out, so the form can offer the multi-receipt review', async () => {
      // Every provider parses this field; nothing used to carry it past here,
      // so the chooser could not fire for anyone but Gemini.
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, receiptCount: 3 });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).receiptCount).toBe(3);
    });

    it('reports one receipt when the model did not say', async () => {
      const service = createService('web');
      expect((await service.processReceipt(imageFile())).receiptCount).toBe(1);
    });

    it('carries the per-field confidences out', async () => {
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        fieldConfidence: { amount: 0.42, date: 0.99 },
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].fieldConfidence).toEqual({ amount: 0.42, date: 0.99 });
    });

    it('falls back to the account base currency when the model read none', async () => {
      // The provider services used to invent one, and disagreed about which:
      // the same unreadable currency became CNY, JPY or USD depending only on
      // which extraction path had run.
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'KRW' } } as never
      );
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, currency: '' });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).transactions[0].currency).toBe('KRW');
    });

    it('falls back to USD only when the account has no base currency either', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, currency: '' });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).transactions[0].currency).toBe('USD');
    });

    it('builds the note from the item lines when the model reproduced no receipt body', async () => {
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        receiptDetails: undefined,
        items: [{ name: 'Latte', amount: 5 }, { name: 'Bagel', amount: 7 }],
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].notes).toBe('Latte — USD 5.00\nBagel — USD 7.00');
    });

    it('renders the itemized note in the fallback currency, not a blank one', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'KRW' } } as never
      );
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        currency: '',
        receiptDetails: undefined,
        items: [{ name: 'Latte', amount: 5 }],
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].notes).toContain('KRW');
    });

    // The native pipeline reports what OCR read and nothing more — it has no
    // access to the account. Substituting here is what keeps the on-device and
    // cloud paths agreeing about an unreadable currency.
    it('substitutes the base currency into a native row that read none', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImage.and.resolveTo({
        ...nativeResult,
        transactions: [{ ...nativeResult.transactions[0], currency: '' }],
      });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(result.transactions[0].currency).toBe('THB');
      expect(result.transactions[0].currencyFellBack).toBeTrue();
    });

    it('leaves a native row alone when OCR did read a currency', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImage.and.resolveTo({
        ...nativeResult,
        transactions: [{ ...nativeResult.transactions[0], currency: 'JPY' }],
      });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(result.transactions[0].currency).toBe('JPY');
      expect(result.transactions[0].currencyFellBack).toBeUndefined();
    });

    it('substitutes into a multi-image native result too', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImages.and.resolveTo({
        ...nativeResult,
        transactions: [
          { ...nativeResult.transactions[0], currency: '' },
          { ...nativeResult.transactions[0], currency: 'JPY' },
        ],
      });
      const service = createService('ios');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.map(t => t.currency)).toEqual(['THB', 'JPY']);
      expect(result.transactions.map(t => t.currencyFellBack)).toEqual([true, undefined]);
    });
  });

  describe('engine availability', () => {
    it('offers the receipt UI with a provider configured but no connection', () => {
      // Attaching and previewing images has to survive losing signal; only
      // issuing the scan needs a reachable engine.
      pwaMock.isOnline.and.returnValue(false);
      const service = createService('web');

      expect(service.hasAnyEngine()).toBeTrue();
      expect(service.canProcessNow()).toBeFalse();
    });

    it('offers the receipt UI on iOS with no cloud provider at all', () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');

      expect(service.hasAnyEngine()).toBeTrue();
    });

    it('offers nothing on the web with no provider configured', () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('web');

      expect(service.hasAnyEngine()).toBeFalse();
      expect(service.canProcessNow()).toBeFalse();
    });
  });

  describe('falling back on an unusable result', () => {
    /** What an engine handed a script it cannot read comes back with. */
    const unreadable: ProcessingResult = {
      ...nativeResult,
      transactions: [{ ...nativeResult.transactions[0], amount: 0, confidence: 0.1 }],
      confidence: 0.1,
    };

    it('tries the cloud when native OCR read too little to trust', async () => {
      // The case the old exception-only fallback could never catch: Vision
      // does not throw on an unfamiliar script, it just reads almost nothing.
      nativeMock.processImage.and.resolveTo(unreadable);
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(result.source).toBe('cloud');
      expect(result.transactions[0].description).toBe('Coffee Corner');
    });

    it('keeps the native result when the cloud reads it no better', async () => {
      nativeMock.processImage.and.resolveTo(unreadable);
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, amount: 0, confidence: 0.1 });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());
      expect(result.source).toBe('native');
    });

    it('keeps the native result when the cloud attempt throws', async () => {
      // A second engine failing must not turn a poor result into no result.
      nativeMock.processImage.and.resolveTo(unreadable);
      cloudMock.parseReceipt.and.rejectWith(new Error('offline'));
      const service = createService('ios');

      await expectAsync(service.processReceipt(imageFile())).toBeResolved();
      expect((await service.processReceipt(imageFile())).source).toBe('native');
    });

    it('does not spend a second engine on a result that read the receipt', async () => {
      const service = createService('ios');

      await service.processReceipt(imageFile());
      expect(cloudMock.parseReceipt).not.toHaveBeenCalled();
    });

    it('has nothing to fall back to on the web and returns what it got', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, amount: 0, confidence: 0.1 });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.source).toBe('cloud');
      expect(nativeMock.processImage).not.toHaveBeenCalled();
    });
  });

  describe('processMultipleImages', () => {
    it('should map cloud extractions to transactions, one per receipt', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', details: 'set menu', imageIndex: 0, positionInImage: 'top', confidence: 0.8,
          receiptId: 1,
        },
        {
          date: '2026-01-16', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, positionInImage: 'top', confidence: 0.6,
          receiptId: 2,
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

    it('should merge line items of one receipt and record them in the notes', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0, positionInImage: 'top',
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, positionInImage: 'bottom', confidence: 0.6,
          receiptId: 1,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].description).toBe('Diner');
      expect(result.transactions[0].amount).toBe(15);
      expect(result.transactions[0].notes).toBe('Lunch — USD 10.00\nSnack — USD 5.00');
    });

    it('should prefer the full receipt details from the AI for merged notes', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', imageIndex: 0, positionInImage: 'top', confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, positionInImage: 'bottom', confidence: 0.6, receiptId: 1,
          receiptDetails: 'Lunch — 10.00\nSnack — 5.00\nTax 1.20\nTotal 16.20',
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].notes).toBe('Lunch — 10.00\nSnack — 5.00\nTax 1.20\nTotal 16.20');
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
