import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { NativeReceiptService } from './native-receipt.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import { AppleReceiptExtraction } from '../plugins/apple-intelligence.plugin';
import { Category, VERIFY_FIELD_THRESHOLD } from '../../models';
import { REVIEW_AMOUNT_CONFIDENCE } from '../utils/receipt-consolidation';

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
    { id: 'food', name: 'categoryNames.food', type: 'expense', isActive: true },
    { id: 'food_groceries', name: 'categoryNames.groceries', type: 'expense', parentId: 'food', isActive: true },
    { id: 'food_coffeeAndDrinks', name: 'categoryNames.coffeeAndDrinks', type: 'expense', parentId: 'food', isActive: true },
    { id: 'food_restaurants', name: 'categoryNames.restaurants', type: 'expense', parentId: 'food', isActive: false },
    // The model is offered the expense side alone, even for a refund, whose
    // slip lists the goods going back — this entry exists only to prove the
    // model is never offered it, and that an answer naming it does not
    // resolve.
    { id: 'employment_salary', name: 'categoryNames.salary', type: 'income', isActive: true },
  ] as Category[];

  // The active locale's bundle, as TranslationService would serve it. The
  // real service needs HttpClient for its bundle, so the spec stubs t() the
  // way production behaves: known key -> display name, unknown -> the key.
  const displayNames: Record<string, string> = {
    'categoryNames.food': 'Food & Drinks',
    'categoryNames.groceries': 'Groceries',
    'categoryNames.coffeeAndDrinks': 'Coffee & Drinks',
    'categoryNames.restaurants': 'Restaurants',
    'categoryNames.salary': 'Salary',
  };

  const ocrResult: VisionOCRResult = {
    text: 'Starbucks\n01/15/2026\nTotal: $12.50',
    blocks: [],
    confidence: 0.9,
    blockCount: 3,
  };

  const imageFile = () => new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

  // A refund slip's total printed as a negative, and a purchase whose total
  // is printed again, marked, on the card line beneath it.
  const REFUND_TEXT = 'Harbour Supplies\n2026-01-15\nTotal -$14.03';
  const TWIN_TEXT = 'Shop\n2026-01-15\nTotal $14.03\nVISA -$14.03';

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
      // Nothing on this receipt prints its total as a negative, so it is the
      // purchase every receipt is by default, with no type grade to flag.
      expect(transaction.fieldConfidence?.type).toBeUndefined();
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

    it('grades an unreadable amount and an unreadable date, through the parser\'s own grades', async () => {
      visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: 'ありがとうございました' });

      const result = await service.processImage(imageFile());

      expect(result.transactions[0].fieldConfidence).toEqual({ amount: 0, date: 0 });
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

    /**
     * A refund slip prints its total as a negative, and this lane has no
     * model to read the words around it, so the mark on the total is all it
     * can go on (ADR 0008: marks, never words). A mark is typography, not a
     * measurement, so whatever it decides is flagged for review: income
     * always, and an expense the print argued with.
     */
    describe('which way the money moved', () => {
      it('files a total printed as a negative as income, graded for review', async () => {
        visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('income');
        expect(transaction.amount).toBe(14.03);
        expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.9, type: 0.5 });
        expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
      });

      it('keeps a total printed both marked and unmarked an expense, graded for review', async () => {
        visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: TWIN_TEXT });

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('expense');
        expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.9, type: 0.3 });
      });

      it('keeps a purchase whose coupon prints a minus an expense with no type grade', async () => {
        // Guard: the mark sits on the coupon, not the total, so it says
        // nothing about which way the money moved.
        visionMock.recognizeText.and.resolveTo({
          ...ocrResult,
          text: 'Shop\nCoffee $3.20\nCake $2.30\nCoupon -$1.00\nTotal $4.50',
        });

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('expense');
        expect(transaction.amount).toBe(4.5);
        expect('type' in transaction.fieldConfidence!).toBeFalse();
      });
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

    /**
     * The plugin itself reports no confidence at all — the model answers with
     * a bare guess and nothing else. The only corroboration available is
     * running the same OCR text through the regex reader and comparing its
     * total against the model's, so this lane's grade comes from that
     * cross-check rather than from the plugin.
     */
    describe('field confidence', () => {
      it('grades an unreadable amount 0', async () => {
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Cafe', date: '2026-01-15', amount: 0, currency: 'USD', category: '', details: '',
        });

        const result = await service.processImage(imageFile());

        expect(result.transactions[0].fieldConfidence?.amount).toBe(0);
      });

      it("takes the text parser's grade when it read the same total", async () => {
        // The default OCR text ('Starbucks... Total: $12.50') parses to the
        // same 12.50 the model answers below.
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Cafe', date: '2026-01-15', amount: 12.5, currency: 'USD', category: '', details: '',
        });

        const result = await service.processImage(imageFile());

        expect(result.transactions[0].fieldConfidence?.amount).toBe(0.8);
      });

      it('flags a total the text parser read differently', async () => {
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Cafe', date: '2026-01-15', amount: 999, currency: 'USD', category: '', details: '',
        });

        const result = await service.processImage(imageFile());

        expect(result.transactions[0].fieldConfidence?.amount).toBe(REVIEW_AMOUNT_CONFIDENCE);
        expect(result.transactions[0].fieldConfidence?.amount).toBeLessThan(VERIFY_FIELD_THRESHOLD);
      });

      it('grades a read date 0.8', async () => {
        const result = await service.processImage(imageFile());

        // Never below VERIFY_FIELD_THRESHOLD: a lower grade makes
        // resolveImportDate replace a read date with today.
        expect(result.transactions[0].fieldConfidence?.date).toBe(0.8);
        expect(result.transactions[0].fieldConfidence?.date).toBeGreaterThanOrEqual(VERIFY_FIELD_THRESHOLD);
      });
    });

    /**
     * The model answers a magnitude and, from the receipt's words, its own
     * verdict on which way the money moved. The print is the second witness:
     * the same OCR text runs through the text reader, and its reading of the
     * marks counts only when it read the same total the model did. A mark on
     * some other figure says nothing about this one. Neither witness is a
     * measurement, so an income verdict is always flagged for review, and so
     * is a purchase the print argued with.
     */
    describe('which way the money moved', () => {
      // An answer with no verdict on it: the print alone decides, as on the
      // regex lane.
      const answering = (amount: number) =>
        appleMock.parseReceiptText.and.resolveTo({
          merchant: 'Harbour Supplies', date: '2026-01-15', amount, currency: 'USD',
          category: '', details: '',
        });

      // The same answer, with the model's verdict on it.
      const withKind = (kind: AppleReceiptExtraction['kind'], over: Partial<AppleReceiptExtraction> = {}) =>
        appleMock.parseReceiptText.and.resolveTo({
          kind, merchant: 'Harbour Supplies', date: '2026-01-15', amount: 14.03, currency: 'USD',
          category: '', details: '', ...over,
        });

      describe('when the model says which way', () => {
        it('keeps a purchase the model read an expense when its total prints as a negative, graded for review', async () => {
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
          withKind('purchase');

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('expense');
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.3 });
        });

        it('files a refund the model read as income over a total printed plain, graded for review', async () => {
          // The default OCR text prints the same 12.50 with no mark at all.
          withKind('refund', { amount: 12.5 });

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('income');
          expect(transaction.amount).toBe(12.5);
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.5 });
          expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
        });

        it('grades a refund higher when the print agrees, still under review, and keeps the category it named', async () => {
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
          withKind('refund', { category: 'food_groceries' });

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('income');
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.6 });
          expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
          // The goods going back are an expense entry; the import doors move
          // it onto the income side's catch-all, not this service.
          expect(transaction.suggestedCategoryId).toBe('food_groceries');
        });

        it('files a refund the model read as income when its total prints both marked and unmarked', async () => {
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: TWIN_TEXT });
          withKind('refund');

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('income');
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.5 });
          expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
        });

        it('keeps a purchase the model read an expense when its total prints both marked and unmarked, graded for review', async () => {
          // Guard: the print argued with itself, so the purchase stays flagged.
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: TWIN_TEXT });
          withKind('purchase');

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('expense');
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.3 });
        });

        it('leaves a purchase nothing contradicts ungraded', async () => {
          // Guard: the model and the print agree on the plain case.
          withKind('purchase', { amount: 12.5 });

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('expense');
          expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8 });
        });

        it('reads a verdict outside the two it was offered as no verdict at all', async () => {
          // Guard: the bridge is typed, the value crossing it is not. Strict
          // comparison keeps an out-of-contract word from reading as a refund,
          // and leaves the print to decide as it does when no verdict comes.
          const answer = {
            kind: 'return', merchant: 'Harbour Supplies', date: '2026-01-15', amount: 12.5,
            currency: 'USD', category: '', details: '',
          } as unknown as AppleReceiptExtraction;
          appleMock.parseReceiptText.and.resolveTo(answer);

          const plain = (await service.processImage(imageFile())).transactions[0];

          expect(plain.type).toBe('expense');
          expect(plain.fieldConfidence).toEqual({ amount: 0.8, date: 0.8 });

          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
          appleMock.parseReceiptText.and.resolveTo({ ...answer, amount: 14.03 });

          const marked = (await service.processImage(imageFile())).transactions[0];

          expect(marked.type).toBe('income');
          expect(marked.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.5 });
        });

        it('leaves a purchase the model read unflagged when the negative prints on another total', async () => {
          // Guard: the known gap ADR 0162 records. The mark is on a figure the
          // model did not answer, so it says nothing about this one, and the
          // purchase stands as the model read it; only its amount is flagged.
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
          withKind('purchase', { amount: 99 });

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('expense');
          expect(transaction.fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE, date: 0.8 });
        });

        it('grades a refund the model read as one the print is silent on when the negative prints on another total', async () => {
          // Guard: the same mark on another figure does not back the refund.
          visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
          withKind('refund', { amount: 99 });

          const transaction = (await service.processImage(imageFile())).transactions[0];

          expect(transaction.type).toBe('income');
          expect(transaction.fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE, date: 0.8, type: 0.5 });
          expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
        });
      });

      it('files the same total printed as a negative as income, graded for review', async () => {
        visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
        answering(14.03);

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('income');
        expect(transaction.amount).toBe(14.03);
        expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.5 });
        expect(transaction.fieldConfidence!.type).toBeLessThan(VERIFY_FIELD_THRESHOLD);
      });

      it('keeps the same total printed both marked and unmarked an expense, graded for review', async () => {
        visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: TWIN_TEXT });
        answering(14.03);

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('expense');
        expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8, type: 0.3 });
      });

      it('reads nothing from a mark printed on a total other than the one the model read', async () => {
        // Guard: the print speaks of another figure, so the row is the
        // purchase it would be anyway, and only its amount is flagged.
        visionMock.recognizeText.and.resolveTo({ ...ocrResult, text: REFUND_TEXT });
        answering(99);

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.type).toBe('expense');
        expect(transaction.fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE, date: 0.8 });
      });

      it('reads no verdict from a minus the model left on its amount', async () => {
        // Guard: a stray sign is not a verdict (ADR 0147). The default OCR
        // text prints the same 12.50 unmarked.
        answering(-12.5);

        const transaction = (await service.processImage(imageFile())).transactions[0];

        expect(transaction.amount).toBe(12.5);
        expect(transaction.type).toBe('expense');
        expect(transaction.fieldConfidence).toEqual({ amount: 0.8, date: 0.8 });
      });
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

    it('sends the on-device model no income category', async () => {
      // Even a refund is read against the expense side alone: its slip lists
      // the goods going back, which only expense entries name.
      await service.processImage(imageFile());

      const sent = appleMock.parseReceiptText.calls.mostRecent().args[0].categories!;
      expect(sent.filter(line => line.startsWith('employment_salary:'))).toEqual([]);
    });

    it("does not resolve the model's answer to an income category", async () => {
      appleMock.parseReceiptText.and.resolveTo({
        merchant: 'Shop', date: '2026-01-15', amount: 10, currency: 'USD',
        category: 'Salary', details: '',
      });

      const transaction = (await service.processImage(imageFile())).transactions[0];

      // The catalog handed to the resolver excluded this answer entirely, so
      // it comes back unresolved rather than filed under a category the model
      // was never offered.
      expect(transaction.suggestedCategoryId).toBeUndefined();
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
      // A stray sign is not a verdict (ADR 0147): the model's -42 is read as
      // a magnitude, nothing prints the total as a negative, and the row stays
      // an expense with no type grade.
      expect(transaction.type).toBe('expense');
      expect(transaction.fieldConfidence?.type).toBeUndefined();
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

        // The date extraction fails on this fixture, but the amount is still
        // graded through the usual cross-check against the OCR text.
        expect(result.transactions[0].fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE, date: 0 });
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
