import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { NativeReceiptService } from './native-receipt.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import { Category } from '../../models';

describe('NativeReceiptService', () => {
  let service: NativeReceiptService;
  let visionMock: jasmine.SpyObj<VisionOcrService>;
  let appleMock: jasmine.SpyObj<AppleIntelligenceService>;

  const categories = [
    { id: 'food_coffee_&_drinks', name: 'Coffee & Drinks' },
    { id: 'food_groceries', name: 'Groceries' },
  ] as Category[];

  const ocrResult: VisionOCRResult = {
    text: 'Starbucks\n01/15/2026\nTotal: $12.50',
    blocks: [],
    confidence: 0.9,
    blockCount: 3,
  };

  const imageFile = () => new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

  beforeEach(() => {
    visionMock = jasmine.createSpyObj('VisionOcrService', [
      'detectEnvironment',
      'isAvailable',
      'recognizeText',
      'isMacEnvironment',
    ]);
    visionMock.isAvailable.and.resolveTo({ available: true });
    visionMock.recognizeText.and.resolveTo(ocrResult);

    appleMock = jasmine.createSpyObj('AppleIntelligenceService', [
      'detectAvailability',
      'isModelAvailable',
      'parseReceiptText',
    ]);
    appleMock.isModelAvailable.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        NativeReceiptService,
        { provide: VisionOcrService, useValue: visionMock },
        { provide: AppleIntelligenceService, useValue: appleMock },
        {
          provide: CategoryService,
          useValue: jasmine.createSpyObj('CategoryService', ['loadCategories'], {
            categories: signal(categories),
          }),
        },
      ],
    });

    service = TestBed.inject(NativeReceiptService);
  });

  it('should reject when Vision OCR is unavailable', async () => {
    visionMock.isAvailable.and.resolveTo({ available: false });

    await expectAsync(service.processImage(imageFile()))
      .toBeRejectedWithError('Vision OCR is not available on this device.');
  });

  describe('regex fallback parsing', () => {
    it('should structure OCR text with the basic parser when Apple Intelligence is unavailable', async () => {
      const result = await service.processImage(imageFile());

      expect(appleMock.parseReceiptText).not.toHaveBeenCalled();
      expect(result.source).toBe('native');
      expect(result.confidence).toBe(0.9);

      const transaction = result.transactions[0];
      expect(transaction.description).toBe('Starbucks');
      expect(transaction.amount).toBe(12.5);
      expect(transaction.currency).toBe('USD');
      expect(transaction.type).toBe('expense');
      expect(transaction.source).toBe('native');
    });

    it('should pass the recognized image to Vision OCR as base64', async () => {
      await service.processImage(imageFile());

      const args = visionMock.recognizeText.calls.mostRecent().args[0];
      expect(args.image).toMatch(/^data:/);
      expect(args.languages).toContain('ja-JP');
    });
  });

  describe('Apple Intelligence parsing', () => {
    beforeEach(() => {
      appleMock.isModelAvailable.and.returnValue(true);
      appleMock.parseReceiptText.and.resolveTo({
        merchant: 'Cafe Tokyo',
        date: '2026-01-15',
        amount: 1200,
        currency: 'JPY',
        category: 'Coffee & Drinks',
        details: 'Latte\nCroissant',
      });
    });

    it('should structure OCR text with the on-device model', async () => {
      const result = await service.processImage(imageFile());

      expect(appleMock.parseReceiptText).toHaveBeenCalledWith({
        text: ocrResult.text,
        categories: ['Coffee & Drinks', 'Groceries'],
      });

      const transaction = result.transactions[0];
      expect(transaction.description).toBe('Cafe Tokyo');
      expect(transaction.amount).toBe(1200);
      expect(transaction.currency).toBe('JPY');
      expect(transaction.notes).toBe('Latte\nCroissant');
      expect(transaction.suggestedCategoryId).toBe('food_coffee_&_drinks');
      expect(transaction.date.getTime()).toBe(new Date('2026-01-15').getTime());
    });

    it('should leave the category unset when the model picks an unknown name', async () => {
      appleMock.parseReceiptText.and.resolveTo({
        merchant: 'Cafe', date: '', amount: 5, currency: 'USD', category: 'Nonexistent', details: '',
      });

      const result = await service.processImage(imageFile());
      expect(result.transactions[0].suggestedCategoryId).toBeUndefined();
    });

    it('should default missing fields safely', async () => {
      appleMock.parseReceiptText.and.resolveTo({
        merchant: '', date: 'not-a-date', amount: -42, currency: '', category: '', details: '',
      });

      const result = await service.processImage(imageFile());
      const transaction = result.transactions[0];

      expect(transaction.description).toBe('Unknown Merchant');
      expect(transaction.amount).toBe(42);
      expect(transaction.currency).toBe('USD');
      expect(isNaN(transaction.date.getTime())).toBeFalse();
    });

    it('should fall back to the regex parser when the model fails', async () => {
      appleMock.parseReceiptText.and.rejectWith(new Error('model busy'));

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].description).toBe('Starbucks');
      expect(result.transactions[0].amount).toBe(12.5);
    });
  });

  describe('processImages', () => {
    it('should produce one transaction per image and average confidence', async () => {
      visionMock.recognizeText.and.returnValues(
        Promise.resolve({ ...ocrResult, confidence: 0.8 }),
        Promise.resolve({ ...ocrResult, confidence: 0.6 }),
      );

      const result = await service.processImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(2);
      expect(result.confidence).toBeCloseTo(0.7);
      expect(result.source).toBe('native');
    });

    it('should reject when Vision OCR is unavailable', async () => {
      visionMock.isAvailable.and.resolveTo({ available: false });

      await expectAsync(service.processImages([imageFile()]))
        .toBeRejectedWithError('Vision OCR is not available on this device.');
    });
  });
});
