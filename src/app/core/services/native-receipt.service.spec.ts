import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { NativeReceiptService } from './native-receipt.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import { Category, VERIFY_FIELD_THRESHOLD } from '../../models';

describe('NativeReceiptService', () => {
  let service: NativeReceiptService;
  let visionMock: jasmine.SpyObj<VisionOcrService>;
  let appleMock: jasmine.SpyObj<AppleIntelligenceService>;

  // Exactly the shapes CategoryService builds (#270): a default entry stores
  // the i18n key as its name, its id keeps the key's camelCase tail, and a
  // category the user deleted stays in the merged list with isActive false.
  // A display-name fixture here is a catalog the app never produces, and it
  // is how the raw-key payload stayed green.
  const categories = [
    { id: 'food', name: 'categoryNames.food', isActive: true },
    { id: 'food_groceries', name: 'categoryNames.groceries', parentId: 'food', isActive: true },
    { id: 'food_coffeeAndDrinks', name: 'categoryNames.coffeeAndDrinks', parentId: 'food', isActive: true },
    { id: 'food_restaurants', name: 'categoryNames.restaurants', parentId: 'food', isActive: false },
  ] as Category[];

  // The active locale's bundle, as TranslationService would serve it. The
  // real service needs HttpClient for its bundle, so the spec stubs t() the
  // way production behaves: known key -> display name, unknown -> the key.
  const displayNames: Record<string, string> = {
    'categoryNames.food': 'Food & Drinks',
    'categoryNames.groceries': 'Groceries',
    'categoryNames.coffeeAndDrinks': 'Coffee & Drinks',
    'categoryNames.restaurants': 'Restaurants',
  };

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
        {
          provide: TranslationService,
          useValue: { t: (key: string) => displayNames[key] ?? key },
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
      // Vision read the characters at 0.9; the parser is less sure than that of
      // the transaction it pulled out of them, and the result says so.
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.9);

      const transaction = result.transactions[0];
      expect(transaction.description).toBe('Starbucks');
      expect(transaction.amount).toBe(12.5);
      expect(transaction.currency).toBe('USD');
      expect(transaction.type).toBe('expense');
      expect(transaction.source).toBe('native');
      // The recognized receipt text is recorded as the note so item details survive
      expect(transaction.notes).toBe(ocrResult.text);
    });

    /**
     * This parser reads figures and evidence tiers and never looks at what
     * was bought, so its rows reach the import with no category — but for a
     * different reason than a model answer the catalog could not place. The
     * seam grades the two apart, and this flag is how it tells them apart.
     * It matters at scale: on any iOS device without Apple Intelligence this
     * is the engine for every scan.
     */
    it('reports that nothing attempted to categorize the row', async () => {
      const result = await service.processImage(imageFile());

      const transaction = result.transactions[0];
      expect(transaction.suggestedCategoryId).toBeUndefined();
      expect(transaction.categoryAttempted).toBeFalse();
    });

    it('should pass the recognized image to Vision OCR as base64', async () => {
      await service.processImage(imageFile());

      const args = visionMock.recognizeText.calls.mostRecent().args[0];
      expect(args.image).toMatch(/^data:/);
      // Naming languages puts every language we did not name behind the ones we
      // did, so the pipeline names none and lets Vision detect the script.
      expect(args.languages).toBeUndefined();
    });

    it('should report no confidence when the parser found nothing in the text', async () => {
      visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: 'ありがとうございました' });

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].amount).toBe(0);
      // Vision read this perfectly well; there is just no transaction in it, and
      // the caller needs to see that so it can try an engine that can read more.
      expect(result.confidence).toBe(0);
    });

    it('the regex lane grades a missing date at zero, next to the amount confidence', async () => {
      visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: 'Shop\n$100\n$8\n$108' });

      const result = await service.processImage(imageFile());

      // No date in this text, so the date grade is honestly 0 rather than
      // simply absent.
      expect(result.transactions[0].fieldConfidence).toEqual({ amount: 0.8, date: 0 });
    });

    it('the regex lane reports both field confidences', async () => {
      visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: 'Shop\n2026-01-15\n$100\n$8\n$108' });

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].fieldConfidence).toEqual({ amount: 0.8, date: 0.9 });
    });

    it('should flag a demoted tendered read below the verify threshold', async () => {
      visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: 'Shop\n$481\n$500\n$19' });

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].fieldConfidence!.amount).toBe(0.6);
      expect(result.transactions[0].fieldConfidence!.amount).toBeLessThan(VERIFY_FIELD_THRESHOLD);
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

      // The model's vocabulary is the shared catalog rendering — translated
      // `id: Name` lines, one entry per line — never the stored i18n keys.
      expect(appleMock.parseReceiptText).toHaveBeenCalledWith({
        text: ocrResult.text,
        categories: [
          'food: Food & Drinks',
          'food_groceries: Food & Drinks / Groceries',
          'food_coffeeAndDrinks: Food & Drinks / Coffee & Drinks',
        ],
      });

      const transaction = result.transactions[0];
      expect(transaction.description).toBe('Cafe Tokyo');
      expect(transaction.amount).toBe(1200);
      expect(transaction.currency).toBe('JPY');
      expect(transaction.notes).toBe('Latte\nCroissant');
      expect(transaction.suggestedCategoryId).toBe('food_coffeeAndDrinks');
      // Local parts, not `new Date('2026-01-15')` — that is the parse under
      // test, so comparing against it holds in every zone and proves nothing.
      expect(transaction.date.getTime()).toBe(new Date(2026, 0, 15).getTime());
    });

    it('carries a printed location as the row slot, and nothing without one', async () => {
      const extraction = {
        merchant: 'Cafe Tokyo', date: '2026-01-15', amount: 1200, currency: 'JPY',
        category: 'Coffee & Drinks', details: '',
      };
      appleMock.parseReceiptText.and.resolveTo({ ...extraction, location: '渋谷店' });
      expect((await service.processImage(imageFile())).transactions[0].location)
        .toEqual({ name: '渋谷店' });

      appleMock.parseReceiptText.and.resolveTo({ ...extraction, location: '' });
      expect('location' in (await service.processImage(imageFile())).transactions[0]).toBeFalse();

      // A device still running the previous binary answers without the key at
      // all, which has to read the same as a receipt that printed no address.
      appleMock.parseReceiptText.and.resolveTo(extraction);
      expect('location' in (await service.processImage(imageFile())).transactions[0]).toBeFalse();
    });

    it('carries the on-device country as a mark and into a printed address', async () => {
      const extraction = {
        merchant: 'Cafe Tokyo', date: '2026-01-15', amount: 1200, currency: 'JPY',
        category: 'Coffee & Drinks', details: '',
      };
      appleMock.parseReceiptText.and.resolveTo({ ...extraction, location: '渋谷店', country: 'JP' });
      const row = (await service.processImage(imageFile())).transactions[0];
      expect(row.receiptCountry).toBe('JP');
      expect(row.location).toEqual({ name: '渋谷店', country: 'JP' });

      // An older binary answers without the key; a model that could not tell
      // answers ''. Both read as nobody looked.
      appleMock.parseReceiptText.and.resolveTo({ ...extraction, country: '' });
      expect('receiptCountry' in (await service.processImage(imageFile())).transactions[0]).toBeFalse();
      appleMock.parseReceiptText.and.resolveTo(extraction);
      expect('receiptCountry' in (await service.processImage(imageFile())).transactions[0]).toBeFalse();
    });

    it('sends no raw i18n key and no deactivated category to the model', async () => {
      await service.processImage(imageFile());

      const sent = appleMock.parseReceiptText.calls.mostRecent().args[0].categories!;
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter(line => line.includes('categoryNames.'))).toEqual([]);
      // The user deleted Restaurants; offering it would resurrect the category.
      expect(sent.filter(line => line.includes('Restaurants'))).toEqual([]);
    });

    /**
     * The resolver decides what a scan lands on. The prompt offers ids, but a
     * small on-device model may answer with a display name, and it answers in
     * the receipt's language however the catalog was rendered — so the id and
     * every shipped locale's name must all resolve (matchCategoryName's
     * contract, ADR 0046), and an answer we failed to understand must stay
     * distinguishable from a deliberate "Other".
     */
    describe('category resolution', () => {
      const suggestedFor = async (category: string) => {
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Shop', date: '2026-01-15', amount: 10, currency: 'USD', category, details: '',
        });
        return (await service.processImage(imageFile())).transactions[0].suggestedCategoryId;
      };

      it('resolves the catalog id the prompt offered', async () => {
        expect(await suggestedFor('food_groceries')).toBe('food_groceries');
      });

      it('resolves the English display name', async () => {
        expect(await suggestedFor('Groceries')).toBe('food_groceries');
      });

      it('resolves the Traditional Chinese display name', async () => {
        expect(await suggestedFor('雜貨')).toBe('food_groceries');
      });

      it('resolves the Japanese display name', async () => {
        expect(await suggestedFor('食料品')).toBe('food_groceries');
      });

      it('leaves an answer that matches nothing unset rather than picking a category', async () => {
        expect(await suggestedFor('Nonexistent')).toBeUndefined();
      });

      /**
       * The grade the import chip shows is derived at the seam from whether
       * the id resolved; the row's own confidence stays what Vision reported.
       * That separation is load-bearing: this number averages into the
       * envelope AIStrategyService compares against 0.4 when deciding whether
       * to hand the scan to a cloud provider, so lowering it here would
       * reroute a perfectly-read receipt whose category merely went
       * unrecognized.
       */
      it('leaves the row confidence at what Vision reported when the category matched nothing', async () => {
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Shop', date: '2026-01-15', amount: 10, currency: 'USD',
          category: 'Nonexistent', details: '',
        });

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.suggestedCategoryId).toBeUndefined();
        expect(transaction.confidence).toBe(ocrResult.confidence);
        // Absent, not false: the model was asked and answered — the catalog
        // is what failed to place it.
        expect(transaction.categoryAttempted).toBeUndefined();
      });
    });

    it('should default missing fields safely', async () => {
      appleMock.parseReceiptText.and.resolveTo({
        merchant: '', date: 'not-a-date', amount: -42, currency: '', category: '', details: '',
      });

      const result = await service.processImage(imageFile());
      const transaction = result.transactions[0];

      expect(transaction.description).toBe('Unknown Merchant');
      expect(transaction.amount).toBe(42);
      // This service reports what it read, not a guess. AIStrategyService
      // knows the account's base currency and substitutes it; inventing one
      // here is what made an unreadable currency land as USD regardless of
      // whose account it was.
      expect(transaction.currency).toBe('');
      expect(isNaN(transaction.date.getTime())).toBeFalse();
    });

    it('reports no currency when the model returns one it cannot read', async () => {
      appleMock.parseReceiptText.and.resolveTo({
        merchant: 'Cafe', date: '2026-06-01', amount: 10, currency: 'dollars',
        category: '', details: '',
      });

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].currency).toBe('');
    });

    /**
     * `AppleReceiptExtraction.date` is documented as `YYYY-MM-DD`, so the
     * on-device path carries the same UTC-midnight hazard as the cloud one.
     * It reached here by a different route — the #168 sweep never looked at
     * the Vision/foundation-model pipeline at all.
     */
    describe('dates', () => {
      const today = new Date(2026, 7, 20, 9, 30);

      const extractionDated = (date: string) =>
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Cafe', date, amount: 5, currency: 'USD', category: '', details: '',
        });

      beforeEach(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(today);
      });

      afterEach(() => jasmine.clock().uninstall());

      const dateFrom = async (raw: string): Promise<Date> => {
        extractionDated(raw);
        return (await service.processImage(imageFile())).transactions[0].date;
      };

      it('reads a date-only extraction as local midnight, not UTC midnight', async () => {
        const date = await dateFrom('2026-08-01');

        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(7);
        expect(date.getDate()).toBe(1);
        expect(date.getHours()).toBe(0);
      });

      it('falls back to today for a well-shaped date that does not exist', async () => {
        const date = await dateFrom('2026-02-31');

        expect(date.getMonth()).toBe(today.getMonth());
        expect(date.getDate()).toBe(today.getDate());
      });

      it('falls back to today when the model found no date', async () => {
        const date = await dateFrom('');

        expect(isNaN(date.getTime())).toBeFalse();
        expect(date.getDate()).toBe(today.getDate());
      });

      it('an unreadable Apple Intelligence date is graded 0', async () => {
        extractionDated('2026-02-31');

        const result = await service.processImage(imageFile());

        expect(result.transactions[0].fieldConfidence).toEqual({ date: 0 });
      });
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
      expect(result.source).toBe('native');

      const [first, second] = result.transactions;
      expect(first.confidence).toBeGreaterThan(second.confidence);
      expect(result.confidence).toBeCloseTo((first.confidence + second.confidence) / 2);
    });

    it('stamps which photo each transaction came from', async () => {
      // Native OCR reads one receipt per photo, so the mapping is the loop
      // index — without it the confirm step cannot attach the right photo.
      const result = await service.processImages([imageFile(), imageFile()]);

      expect(result.transactions.map(t => t.imageIndex)).toEqual([0, 1]);
    });

    it('should reject when Vision OCR is unavailable', async () => {
      visionMock.isAvailable.and.resolveTo({ available: false });

      await expectAsync(service.processImages([imageFile()]))
        .toBeRejectedWithError('Vision OCR is not available on this device.');
    });
  });
});
