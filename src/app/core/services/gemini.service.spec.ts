import { TestBed } from '@angular/core/testing';
import { GeminiService, isRateLimitMessage } from './gemini.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService, SupportedLocale } from './translation.service';
import { Category, Transaction, MonthlyTotal, Budget } from '../../models';
import { createTransaction, createCategory } from './testing/test-data';

/**
 * A fake generative model that records the request it was called with and
 * returns a caller-supplied response. Keeps every test fully offline — no
 * real @google/generative-ai network traffic is ever generated.
 */
interface FakeModel {
  generateContent: jasmine.Spy;
}

function makeResult(text: string, finishReason?: string) {
  return {
    response: {
      text: () => text,
      candidates: finishReason
        ? [{ finishReason }]
        : [{ finishReason: 'STOP' }],
    },
  };
}

describe('GeminiService', () => {
  let service: GeminiService;
  let categoryService: jasmine.SpyObj<CategoryService>;
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let translationService: jasmine.SpyObj<TranslationService>;

  let textModel: FakeModel;
  let visionModel: FakeModel;

  const categories: Category[] = [
    createCategory({ id: 'food_groceries', name: 'Groceries', type: 'expense' }),
    createCategory({ id: 'food_restaurants', name: 'Restaurants', type: 'expense' }),
    createCategory({ id: 'transport_fuel_&_gas', name: 'Fuel & Gas', type: 'expense' }),
    createCategory({ id: 'inactive_cat', name: 'Inactive', type: 'expense', isActive: false }),
    createCategory({ id: 'child_cat', name: 'Child', type: 'expense', parentId: 'food_groceries' }),
  ];

  /** Inject fake spy models so generateContent never hits the network. */
  function installFakeModels(s: GeminiService): { text: FakeModel; vision: FakeModel } {
    const text: FakeModel = { generateContent: jasmine.createSpy('textGenerate') };
    const vision: FakeModel = { generateContent: jasmine.createSpy('visionGenerate') };
    // The SDK client and models are private; assign them directly so we
    // exercise the public methods with deterministic, offline responses.
    const internal = s as unknown as {
      genAI: unknown;
      textModel: FakeModel | null;
      visionModel: FakeModel | null;
    };
    internal.genAI = {};
    internal.textModel = text;
    internal.visionModel = vision;
    return { text, vision };
  }

  beforeEach(() => {
    categoryService = jasmine.createSpyObj<CategoryService>('CategoryService', ['categories']);
    categoryService.categories.and.returnValue(categories);

    currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', ['convert']);
    // Identity conversion keeps amounts predictable in assertions.
    currencyService.convert.and.callFake((amount: number) => amount);

    translationService = jasmine.createSpyObj<TranslationService>(
      'TranslationService',
      ['t', 'currentLocale']
    );
    // Echo i18n keys back so prompt content is deterministic.
    translationService.t.and.callFake((key: string) => key);
    translationService.currentLocale.and.returnValue('en');

    TestBed.configureTestingModule({
      providers: [
        GeminiService,
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
      ],
    });

    service = TestBed.inject(GeminiService);
    const fakes = installFakeModels(service);
    textModel = fakes.text;
    visionModel = fakes.vision;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ----------------------------------------------------------------
  // isRateLimitMessage (exported helper)
  // ----------------------------------------------------------------
  describe('isRateLimitMessage', () => {
    it('returns true for known rate-limit phrasings', () => {
      expect(isRateLimitMessage('Error 429: too much')).toBeTrue();
      expect(isRateLimitMessage('RESOURCE_EXHAUSTED')).toBeTrue();
      expect(isRateLimitMessage('hit the rate limit')).toBeTrue();
      expect(isRateLimitMessage('quota exceeded for project')).toBeTrue();
      expect(isRateLimitMessage('Too Many Requests')).toBeTrue();
    });

    it('returns false for unrelated errors', () => {
      expect(isRateLimitMessage('network unreachable')).toBeFalse();
      expect(isRateLimitMessage('')).toBeFalse();
    });
  });

  // ----------------------------------------------------------------
  // initializeGemini / reinitialize / isAvailable
  // ----------------------------------------------------------------
  describe('initialization', () => {
    it('isAvailable reflects whether a client and text model exist', () => {
      expect(service.isAvailable()).toBeTrue();
      const internal = service as unknown as { genAI: unknown; textModel: unknown };
      internal.textModel = null;
      expect(service.isAvailable()).toBeFalse();
      internal.genAI = null;
      expect(service.isAvailable()).toBeFalse();
    });

    it('does not initialize when no API key is provided', async () => {
      const fresh = TestBed.inject(GeminiService);
      await fresh.reinitialize(undefined);
      expect(fresh.isAvailable()).toBeFalse();
      expect(fresh.isAvailableSignal()).toBeFalse();
    });

    it('treats an unresolved ${...} placeholder key as missing', async () => {
      await service.reinitialize('${GEMINI_API_KEY}');
      expect(service.isAvailable()).toBeFalse();
    });

    it('initializes a real client when given a key (offline, no network)', async () => {
      await service.reinitialize('fake-api-key-123');
      expect(service.isAvailable()).toBeTrue();
      expect(service.isAvailableSignal()).toBeTrue();
    });

    it('switches models when the same key is reused with new model ids', async () => {
      await service.reinitialize('same-key');
      const internal = service as unknown as { textModel: { model?: unknown } };
      const firstModel = internal.textModel;
      await service.reinitialize('same-key', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it');
      expect(service.isAvailable()).toBeTrue();
      // A model switch replaces the underlying model instance.
      expect(internal.textModel).not.toBe(firstModel);
    });

    it('keeps the same models when the same key and model ids are reused', async () => {
      await service.reinitialize('same-key-2', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite-preview');
      const internal = service as unknown as { textModel: unknown };
      const firstModel = internal.textModel;
      await service.reinitialize('same-key-2', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite-preview');
      expect(internal.textModel).toBe(firstModel);
    });

    it('only switches models, not the client, when the same key is reused', async () => {
      await service.reinitialize('key-stable');
      const internal = service as unknown as { genAI: unknown };
      const client = internal.genAI;
      // Re-running with the same key keeps the same client instance.
      await service.reinitialize('key-stable', 'gemma-4-26b-a4b-it');
      expect(internal.genAI).toBe(client);
    });
  });

  // ----------------------------------------------------------------
  // parseReceipt
  // ----------------------------------------------------------------
  describe('parseReceipt', () => {
    it('throws when no model is available', async () => {
      const internal = service as unknown as { textModel: unknown; visionModel: unknown };
      internal.textModel = null;
      internal.visionModel = null;
      await expectAsync(service.parseReceipt('data:image/jpeg;base64,abc'))
        .toBeRejectedWithError('Gemini model not available');
    });

    it('parses a receipt and maps the suggested category', async () => {
      textModel.generateContent.and.resolveTo(makeResult(JSON.stringify({
        merchant: 'Store A',
        amount: 42.5,
        currency: 'EUR',
        date: '2024-03-01',
        items: [{ name: 'Milk', amount: 2.5 }],
        receiptDetails: 'Milk 2.5',
        suggestedCategory: 'Groceries',
      })));

      const result = await service.parseReceipt('data:image/jpeg;base64,abc123');

      expect(result.merchant).toBe('Store A');
      expect(result.amount).toBe(42.5);
      expect(result.currency).toBe('EUR');
      expect(result.date).toEqual(new Date('2024-03-01'));
      expect(result.suggestedCategory).toBe('food_groceries');
      expect(result.confidence).toBe(0.85);
      expect(service.isProcessing()).toBeFalse();
      // The data: prefix must be stripped before sending.
      const sent = textModel.generateContent.calls.mostRecent().args[0];
      expect(sent.contents[0].parts[1].inlineData.data).toBe('abc123');
    });

    it('applies defaults for missing fields and lower confidence', async () => {
      textModel.generateContent.and.resolveTo(makeResult(JSON.stringify({
        suggestedCategory: 'Groceries',
      })));

      const result = await service.parseReceipt('abc');
      expect(result.merchant).toBe('Unknown');
      expect(result.amount).toBe(0);
      expect(result.currency).toBe('USD');
      expect(result.date instanceof Date).toBeTrue();
      expect(result.items).toEqual([]);
      expect(result.confidence).toBe(0.5);
    });

    it('falls back to the vision model on a rate-limit error', async () => {
      textModel.generateContent.and.rejectWith(new Error('429 rate limit'));
      visionModel.generateContent.and.resolveTo(makeResult(JSON.stringify({
        merchant: 'Fallback Store',
        amount: 10,
        currency: 'USD',
        suggestedCategory: 'Restaurants',
      })));

      const result = await service.parseReceipt('abc');
      expect(result.merchant).toBe('Fallback Store');
      expect(visionModel.generateContent).toHaveBeenCalled();
    });

    it('does not fall back on a non-rate-limit error and rethrows', async () => {
      textModel.generateContent.and.rejectWith(new Error('invalid request'));
      await expectAsync(service.parseReceipt('abc')).toBeRejectedWithError('invalid request');
      expect(visionModel.generateContent).not.toHaveBeenCalled();
      expect(service.lastError()).toBe('invalid request');
    });

    it('rethrows a non-Error rejection with an Unknown error message', async () => {
      const internal = service as unknown as { textModel: unknown; visionModel: unknown };
      internal.visionModel = null;
      textModel.generateContent.and.callFake(() => Promise.reject('weird'));
      await expectAsync(service.parseReceipt('abc')).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  // ----------------------------------------------------------------
  // suggestCategory
  // ----------------------------------------------------------------
  describe('suggestCategory', () => {
    it('throws when the text model is not available', async () => {
      (service as unknown as { textModel: unknown }).textModel = null;
      await expectAsync(service.suggestCategory('coffee', categories))
        .toBeRejectedWithError('Gemini text model not available');
    });

    it('returns a valid category id suggested by the model', async () => {
      textModel.generateContent.and.resolveTo(makeResult('food_groceries'));
      const id = await service.suggestCategory('milk and bread', categories);
      expect(id).toBe('food_groceries');
      expect(service.isProcessing()).toBeFalse();
    });

    it('falls back to other_expense when the suggested id is unknown', async () => {
      textModel.generateContent.and.resolveTo(makeResult('not_a_real_id'));
      const id = await service.suggestCategory('mystery', categories);
      expect(id).toBe('other_expense');
    });

    it('returns other_expense on error', async () => {
      textModel.generateContent.and.rejectWith(new Error('boom'));
      const id = await service.suggestCategory('x', categories);
      expect(id).toBe('other_expense');
    });
  });

  // ----------------------------------------------------------------
  // categorizeTransactions
  // ----------------------------------------------------------------
  describe('categorizeTransactions', () => {
    it('throws when the text model is not available', async () => {
      (service as unknown as { textModel: unknown }).textModel = null;
      await expectAsync(service.categorizeTransactions([]))
        .toBeRejectedWithError('Gemini text model not available');
    });

    it('maps categorizations back onto transactions', async () => {
      textModel.generateContent.and.resolveTo(makeResult(JSON.stringify([
        { index: 0, categoryId: 'food_groceries' },
      ])));

      const txns = [
        { description: 'Milk', amount: 3, date: new Date() },
        { description: 'Unknown thing', amount: 9, date: new Date() },
      ];
      const result = await service.categorizeTransactions(txns);

      expect(result[0].suggestedCategoryId).toBe('food_groceries');
      expect(result[0].confidence).toBe(0.8);
      // No match for index 1 -> default with low confidence.
      expect(result[1].suggestedCategoryId).toBe('other_expense');
      expect(result[1].confidence).toBe(0.3);
    });

    it('returns defaults for every transaction on error', async () => {
      textModel.generateContent.and.rejectWith(new Error('boom'));
      const txns = [{ description: 'A', amount: 1, date: new Date() }];
      const result = await service.categorizeTransactions(txns);
      expect(result[0].suggestedCategoryId).toBe('other_expense');
      expect(result[0].confidence).toBe(0.1);
    });
  });

  // ----------------------------------------------------------------
  // generateSpendingSummary
  // ----------------------------------------------------------------
  describe('generateSpendingSummary', () => {
    const txns: Transaction[] = [
      createTransaction({ type: 'expense', amount: 100, currency: 'USD', categoryId: 'food_groceries', description: 'Big shop' }),
      createTransaction({ type: 'expense', amount: 50, currency: 'USD', categoryId: 'food_restaurants', description: 'Dinner' }),
      createTransaction({ type: 'income', amount: 1000, currency: 'USD', categoryId: 'employment_salary', description: 'Pay' }),
    ];

    it('throws when the text model is not available', async () => {
      (service as unknown as { textModel: unknown }).textModel = null;
      await expectAsync(service.generateSpendingSummary(txns, 'June'))
        .toBeRejectedWithError('Gemini text model not available');
    });

    it('generates a summary from transactions', async () => {
      textModel.generateContent.and.resolveTo(makeResult('## Spending Pattern\nYou spent a lot.'));
      const result = await service.generateSpendingSummary(txns, 'June 2024', 'USD');
      expect(result).toContain('Spending Pattern');
      expect(service.isProcessing()).toBeFalse();
    });

    it('includes historical, budget and RAG sections when provided', async () => {
      textModel.generateContent.and.resolveTo(makeResult('## Spending Pattern\nDetails here.'));
      const budgets: Budget[] = [{
        id: 'b1', userId: 'u', categoryId: 'food_groceries', name: 'Groceries Budget',
        amount: 80, currency: 'USD', period: 'monthly',
        startDate: { toDate: () => new Date() } as unknown as Budget['startDate'],
        spent: 0, isActive: true, alertThreshold: 80,
        createdAt: { toDate: () => new Date() } as unknown as Budget['createdAt'],
        updatedAt: { toDate: () => new Date() } as unknown as Budget['updatedAt'],
      }];
      await service.generateSpendingSummary(
        txns, 'June', 'USD',
        { income: 800, expense: 120 },
        budgets,
        'Notable: a big grocery run'
      );
      const prompt = textModel.generateContent.calls.mostRecent().args[0].contents[0].parts[0].text;
      expect(prompt).toContain('Previous period comparison');
      expect(prompt).toContain('Active budgets status');
      expect(prompt).toContain('Notable activity');
    });

    it('handles zero previous-period values without dividing by zero', async () => {
      textModel.generateContent.and.resolveTo(makeResult('## Spending Pattern\nText.'));
      await service.generateSpendingSummary(
        txns, 'June', 'USD',
        { income: 0, expense: 0 }
      );
      const prompt = textModel.generateContent.calls.mostRecent().args[0].contents[0].parts[0].text;
      // income/expense both 0 -> the historical block is skipped entirely.
      expect(prompt).not.toContain('Previous period comparison');
    });

    it('uses N/A for change when a previous value is zero', async () => {
      textModel.generateContent.and.resolveTo(makeResult('## Spending Pattern\nText.'));
      await service.generateSpendingSummary(
        txns, 'June', 'USD',
        { income: 0, expense: 100 }
      );
      const prompt = textModel.generateContent.calls.mostRecent().args[0].contents[0].parts[0].text;
      expect(prompt).toContain('Income change: N/A%');
    });

    it('drops a truncated trailing line when the token limit was hit', async () => {
      textModel.generateContent.and.resolveTo(makeResult(
        '## Spending Pattern\n- Complete point.\n- Truncated mid sen',
        'MAX_TOKENS'
      ));
      const result = await service.generateSpendingSummary(txns, 'June', 'USD');
      expect(result).not.toContain('Truncated mid sen');
    });

    it('applies Gemma 4 reasoning filtering for gemma models', async () => {
      (service as unknown as { currentTextModelId: string }).currentTextModelId = 'gemma-4-26b-a4b-it';
      textModel.generateContent.and.resolveTo(makeResult(
        'Reasoning: let me think about this draft.\n## Spending Pattern\nFinal text.'
      ));
      const result = await service.generateSpendingSummary(txns, 'June', 'USD');
      expect(result).toContain('Spending Pattern');
      expect(result).not.toContain('Reasoning: let me think');
    });

    it('rethrows errors from the model', async () => {
      textModel.generateContent.and.rejectWith(new Error('summary failed'));
      await expectAsync(service.generateSpendingSummary(txns, 'June'))
        .toBeRejectedWithError('summary failed');
    });
  });

  // ----------------------------------------------------------------
  // getFinancialAdvice
  // ----------------------------------------------------------------
  describe('getFinancialAdvice', () => {
    const summary: MonthlyTotal = {
      income: 1000, expense: 600, balance: 400, transactionCount: 5, byCategory: [],
    };

    it('throws when the text model is not available', async () => {
      (service as unknown as { textModel: unknown }).textModel = null;
      await expectAsync(service.getFinancialAdvice(summary))
        .toBeRejectedWithError('Gemini text model not available');
    });

    it('generates advice for a healthy savings rate', async () => {
      textModel.generateContent.and.resolveTo(makeResult('You are doing well. Keep saving.'));
      const result = await service.getFinancialAdvice(summary, 'USD', 'this month');
      expect(result).toContain('Keep saving');
    });

    it('generates advice for a deficit (low savings) scenario', async () => {
      const deficit: MonthlyTotal = {
        income: 500, expense: 700, balance: -200, transactionCount: 3, byCategory: [],
      };
      textModel.generateContent.and.resolveTo(makeResult('Cut spending now. Find more income.'));
      const result = await service.getFinancialAdvice(deficit, 'USD');
      expect(result).toContain('Cut spending');
      const prompt = textModel.generateContent.calls.mostRecent().args[0].contents[0].parts[0].text;
      expect(prompt).toContain('stop deficit spending');
    });

    it('handles zero income (savings rate 0)', async () => {
      const noIncome: MonthlyTotal = {
        income: 0, expense: 100, balance: -100, transactionCount: 1, byCategory: [],
      };
      textModel.generateContent.and.resolveTo(makeResult('Find income sources today.'));
      const result = await service.getFinancialAdvice(noIncome);
      expect(result).toBeTruthy();
    });

    it('drops non-CJK draft sentences in Japanese locale', async () => {
      translationService.currentLocale.and.returnValue('ja');
      textModel.generateContent.and.resolveTo(makeResult(
        'Let me try to keep it tight. 支出を減らしましょう。貯蓄を増やしてください。'
      ));
      const result = await service.getFinancialAdvice(summary, 'USD');
      expect(result).toContain('支出を減らしましょう');
      expect(result).not.toContain('Let me try');
    });

    it('applies Gemma 4 advice filtering for gemma models', async () => {
      (service as unknown as { currentTextModelId: string }).currentTextModelId = 'gemma-4-26b-a4b-it';
      textModel.generateContent.and.resolveTo(makeResult(
        'Draft 1: blah blah. Prioritize building an emergency fund now. Keep going steadily.'
      ));
      const result = await service.getFinancialAdvice(summary, 'USD');
      expect(result).toContain('Prioritize');
    });

    it('rethrows errors from the model', async () => {
      textModel.generateContent.and.rejectWith(new Error('advice failed'));
      await expectAsync(service.getFinancialAdvice(summary))
        .toBeRejectedWithError('advice failed');
    });
  });

  // ----------------------------------------------------------------
  // extractTransactionsFromImage
  // ----------------------------------------------------------------
  describe('extractTransactionsFromImage', () => {
    it('throws when the vision model is not available', async () => {
      (service as unknown as { visionModel: unknown }).visionModel = null;
      await expectAsync(service.extractTransactionsFromImage('abc'))
        .toBeRejectedWithError('Gemini Vision model not available');
    });

    it('extracts a single transaction from a receipt image', async () => {
      visionModel.generateContent.and.resolveTo(makeResult(JSON.stringify({
        date: '2024-05-10',
        merchant: 'Cafe',
        totalAmount: -25.5,
        currency: 'JPY',
        receiptDetails: 'Coffee 25.5',
        suggestedCategory: 'Restaurants',
      })));

      const result = await service.extractTransactionsFromImage('data:image/png;base64,xyz');
      expect(result.length).toBe(1);
      expect(result[0].description).toBe('Cafe');
      expect(result[0].amount).toBe(25.5);
      expect(result[0].currency).toBe('JPY');
      expect(result[0].type).toBe('expense');
      expect(result[0].category).toBe('food_restaurants');
      expect(result[0].details).toBe('Coffee 25.5');
    });

    it('applies defaults when fields are missing', async () => {
      visionModel.generateContent.and.resolveTo(makeResult('{}'));
      const result = await service.extractTransactionsFromImage('abc');
      expect(result[0].description).toBe('Receipt');
      expect(result[0].amount).toBe(0);
      expect(result[0].currency).toBe('CNY');
      expect(result[0].category).toBeUndefined();
    });

    it('rethrows on error and records lastError', async () => {
      visionModel.generateContent.and.rejectWith(new Error('vision boom'));
      await expectAsync(service.extractTransactionsFromImage('abc'))
        .toBeRejectedWithError('vision boom');
      expect(service.lastError()).toBe('vision boom');
    });

    it('records an Unknown error for non-Error rejections', async () => {
      visionModel.generateContent.and.callFake(() => Promise.reject('nope'));
      await expectAsync(service.extractTransactionsFromImage('abc')).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  // ----------------------------------------------------------------
  // extractTransactionsFromPDF
  // ----------------------------------------------------------------
  describe('extractTransactionsFromPDF', () => {
    it('throws when the vision model is not available', async () => {
      (service as unknown as { visionModel: unknown }).visionModel = null;
      await expectAsync(service.extractTransactionsFromPDF('abc'))
        .toBeRejectedWithError('Gemini Vision model not available');
    });

    it('converts extracted rows to signed RawTransactions', async () => {
      visionModel.generateContent.and.resolveTo(makeResult(JSON.stringify([
        { date: '2024-01-15', description: 'Salary', amount: 3500, type: 'income', currency: 'USD' },
        { date: '2024-01-16', description: 'Walmart', amount: 125, type: 'expense', currency: 'USD' },
        { description: 'No date', amount: 10, type: 'expense', currency: 'USD' },
      ])));

      const result = await service.extractTransactionsFromPDF('data:application/pdf;base64,zzz');
      expect(result.length).toBe(3);
      expect(result[0].amount).toBe(3500);
      expect(result[1].amount).toBe(-125);
      expect(result[2].description).toBe('No date');
      expect(result[2].date instanceof Date).toBeTrue();
    });

    it('rethrows on error and records lastError', async () => {
      visionModel.generateContent.and.rejectWith(new Error('pdf boom'));
      await expectAsync(service.extractTransactionsFromPDF('abc'))
        .toBeRejectedWithError('pdf boom');
      expect(service.lastError()).toBe('pdf boom');
    });

    it('records an Unknown error for non-Error rejections', async () => {
      visionModel.generateContent.and.callFake(() => Promise.reject(42));
      await expectAsync(service.extractTransactionsFromPDF('abc')).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  // ----------------------------------------------------------------
  // extractTransactionsFromMultipleImages (+ extractWithPositionMetadata)
  // ----------------------------------------------------------------
  describe('extractTransactionsFromMultipleImages', () => {
    it('throws when no model is available', async () => {
      const internal = service as unknown as { textModel: unknown; visionModel: unknown };
      internal.textModel = null;
      internal.visionModel = null;
      await expectAsync(service.extractTransactionsFromMultipleImages(['a']))
        .toBeRejectedWithError('Gemini model not available');
    });

    it('returns an empty array for no images', async () => {
      const result = await service.extractTransactionsFromMultipleImages([]);
      expect(result).toEqual([]);
    });

    it('uses single-image position extraction for one image', async () => {
      visionModel.generateContent.and.resolveTo(makeResult(JSON.stringify([
        { date: '2024-04-11', description: 'Onigiri', amount: 151, type: 'expense', currency: 'JPY', positionInImage: 'middle', confidence: 0.95, category: 'Groceries' },
        { description: 'Coffee', amount: 330 },
      ])));

      const result = await service.extractTransactionsFromMultipleImages(['data:image/jpeg;base64,one']);
      expect(result.length).toBe(2);
      expect(result[0].imageIndex).toBe(0);
      expect(result[0].category).toBe('food_groceries');
      expect(result[0].positionInImage).toBe('middle');
      // Defaults filled in for the sparse second item.
      expect(result[1].description).toBe('Coffee');
      expect(result[1].amount).toBe(330);
      expect(result[1].currency).toBe('USD');
      expect(result[1].confidence).toBe(0.7);
      expect(result[1].wasMerged).toBeFalse();
    });

    it('extracts and normalizes items from multiple images', async () => {
      textModel.generateContent.and.resolveTo(makeResult(JSON.stringify([
        { date: '2024-01-15', description: 'Item A', amount: -100, type: 'expense', currency: 'JPY', receiptId: 1, imageIndex: 0, positionInImage: 'top', confidence: 0.9, category: 'Groceries', wasMerged: true, mergedFromImages: [0, 1] },
        { description: 'Item B', amount: 50 },
      ])));

      const result = await service.extractTransactionsFromMultipleImages([
        'data:image/jpeg;base64,one',
        'data:image/jpeg;base64,two',
      ]);
      expect(result.length).toBe(2);
      expect(result[0].amount).toBe(100);
      expect(result[0].category).toBe('food_groceries');
      expect(result[0].wasMerged).toBeTrue();
      expect(result[0].mergedFromImages).toEqual([0, 1]);
      // Defaults for sparse item.
      expect(result[1].receiptId).toBe(1);
      expect(result[1].imageIndex).toBe(0);
      expect(result[1].currency).toBe('USD');
      expect(result[1].category).toBeUndefined();
    });

    it('falls back to the vision model on a rate-limit error for multi-image', async () => {
      textModel.generateContent.and.rejectWith(new Error('429 too many requests'));
      visionModel.generateContent.and.resolveTo(makeResult(JSON.stringify([
        { description: 'Fallback item', amount: 5, currency: 'USD' },
      ])));

      const result = await service.extractTransactionsFromMultipleImages([
        'a', 'b',
      ]);
      expect(result[0].description).toBe('Fallback item');
      expect(visionModel.generateContent).toHaveBeenCalled();
    });

    it('rethrows a non-rate-limit error for multi-image', async () => {
      textModel.generateContent.and.rejectWith(new Error('bad input'));
      await expectAsync(service.extractTransactionsFromMultipleImages(['a', 'b']))
        .toBeRejectedWithError('bad input');
      expect(visionModel.generateContent).not.toHaveBeenCalled();
      expect(service.lastError()).toBe('bad input');
    });

    it('records an Unknown error for non-Error multi-image rejection', async () => {
      const internal = service as unknown as { visionModel: unknown };
      internal.visionModel = null;
      textModel.generateContent.and.callFake(() => Promise.reject('weird'));
      await expectAsync(service.extractTransactionsFromMultipleImages(['a', 'b'])).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });

    // extractWithPositionMetadata error path (single image)
    it('rethrows when single-image position extraction fails', async () => {
      visionModel.generateContent.and.rejectWith(new Error('single boom'));
      await expectAsync(service.extractTransactionsFromMultipleImages(['only']))
        .toBeRejectedWithError('single boom');
      expect(service.lastError()).toBe('single boom');
    });

    it('throws from single-image path when vision model is missing', async () => {
      // textModel present (so models.length>0) but vision model gone:
      // the single-image branch requires the vision model specifically.
      (service as unknown as { visionModel: unknown }).visionModel = null;
      await expectAsync(service.extractTransactionsFromMultipleImages(['only']))
        .toBeRejectedWithError('Gemini Vision model not available');
    });
  });

  // ----------------------------------------------------------------
  // detectCSVMapping
  // ----------------------------------------------------------------
  describe('detectCSVMapping', () => {
    it('throws when the text model is not available', async () => {
      (service as unknown as { textModel: unknown }).textModel = null;
      await expectAsync(service.detectCSVMapping(['Date'], [['2024-01-01']]))
        .toBeRejectedWithError('Gemini text model not available');
    });

    it('returns the parsed mapping from the model', async () => {
      textModel.generateContent.and.resolveTo(makeResult(JSON.stringify({
        dateColumn: 'Date',
        descriptionColumn: 'Memo',
        amountColumn: 'Amount',
        dateFormat: 'YYYY-MM-DD',
        hasHeader: true,
      })));

      const result = await service.detectCSVMapping(
        ['Date', 'Memo', 'Amount'],
        [['2024-01-01', 'Coffee', '3.50'], ['2024-01-02', 'Lunch', '12']]
      );
      expect(result.dateColumn).toBe('Date');
      expect(result.descriptionColumn).toBe('Memo');
    });

    it('returns a default mapping on error', async () => {
      textModel.generateContent.and.rejectWith(new Error('boom'));
      const result = await service.detectCSVMapping(
        ['ColA', 'ColB', 'ColC'],
        [['x', 'y', 'z']]
      );
      expect(result.dateColumn).toBe('ColA');
      expect(result.descriptionColumn).toBe('ColB');
      expect(result.amountColumn).toBe('ColC');
      expect(result.dateFormat).toBe('MM/DD/YYYY');
      expect(result.hasHeader).toBeTrue();
    });

    it('uses literal fallbacks when headers are empty on error', async () => {
      textModel.generateContent.and.rejectWith(new Error('boom'));
      const result = await service.detectCSVMapping([], []);
      expect(result.dateColumn).toBe('date');
      expect(result.descriptionColumn).toBe('description');
      expect(result.amountColumn).toBe('amount');
    });
  });

  // ----------------------------------------------------------------
  // generateTextWithRetry (exercised via summary/advice) - retry path
  // ----------------------------------------------------------------
  describe('generateTextWithRetry', () => {
    const summary: MonthlyTotal = {
      income: 1000, expense: 600, balance: 400, transactionCount: 5, byCategory: [],
    };

    it('retries once after a rate-limit error then succeeds', async () => {
      let calls = 0;
      textModel.generateContent.and.callFake(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('429 rate limit'));
        }
        return Promise.resolve(makeResult('Recovered advice. All good.'));
      });
      // Skip the real 2.5s wait so the test stays fast and deterministic.
      spyOn(window, 'setTimeout').and.callFake(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

      const result = await service.getFinancialAdvice(summary, 'USD');
      expect(result).toContain('Recovered advice');
      expect(calls).toBe(2);
    });

    it('rethrows immediately on a non-rate-limit error (no retry)', async () => {
      let calls = 0;
      textModel.generateContent.and.callFake(() => {
        calls += 1;
        return Promise.reject(new Error('fatal'));
      });
      await expectAsync(service.getFinancialAdvice(summary, 'USD'))
        .toBeRejectedWithError('fatal');
      expect(calls).toBe(1);
    });

    it('throws when the text model disappears before retry', async () => {
      // Directly exercise the guard inside generateTextWithRetry.
      const internal = service as unknown as {
        generateTextWithRetry: (req: unknown) => Promise<unknown>;
        textModel: unknown;
      };
      internal.textModel = null;
      await expectAsync(internal.generateTextWithRetry({ contents: [] }))
        .toBeRejectedWithError('Gemini text model not available');
    });
  });

  // ----------------------------------------------------------------
  // Private helpers exercised directly for full branch coverage
  // ----------------------------------------------------------------
  describe('private helpers', () => {
    interface Internal {
      getLanguageInstruction: () => string;
      extractJson: (t: string) => string;
      extractJsonStrict: (t: string) => string;
      filterReasoningContext: (t: string) => string;
      filterReasoningContextForAdvice: (t: string) => string;
      translateCategoryName: (n?: string) => string;
      mapCategoryNameToId: (n: string) => string;
      hitTokenLimit: (r: unknown) => boolean;
      currentTextModelId: string;
    }
    let api: Internal;

    beforeEach(() => {
      api = service as unknown as Internal;
    });

    describe('getLanguageInstruction', () => {
      it('returns the instruction for each supported locale', () => {
        translationService.currentLocale.and.returnValue('en');
        expect(api.getLanguageInstruction()).toContain('English');
        translationService.currentLocale.and.returnValue('tc');
        expect(api.getLanguageInstruction()).toContain('Traditional Chinese');
        translationService.currentLocale.and.returnValue('ja');
        expect(api.getLanguageInstruction()).toContain('Japanese');
      });

      it('falls back to English for an unknown locale', () => {
        translationService.currentLocale.and.returnValue('xx' as SupportedLocale);
        expect(api.getLanguageInstruction()).toContain('English');
      });
    });

    describe('extractJson', () => {
      it('extracts a plain JSON object', () => {
        expect(api.extractJson('{"a":1}')).toBe('{"a":1}');
      });

      it('strips markdown code fences', () => {
        expect(api.extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
      });

      it('extracts an array with nested objects', () => {
        const input = 'noise [{"x":[1,2]}] trailing';
        expect(api.extractJson(input)).toBe('[{"x":[1,2]}]');
      });

      it('handles strings containing brackets', () => {
        const input = '{"text":"a [bracket] and \\"quote\\""}';
        expect(JSON.parse(api.extractJson(input)).text).toBe('a [bracket] and "quote"');
      });

      it('returns trimmed text when no JSON bracket is present', () => {
        expect(api.extractJson('  no json here  ')).toBe('no json here');
      });

      it('falls back to a greedy match for unbalanced brackets', () => {
        // Opening object never balances; greedy regex grabs a span ending in ]
        const input = '{"a": [1, 2]';
        const out = api.extractJson(input);
        expect(out).toContain('[1, 2]');
      });

      it('applies aggressive Gemma 4 filtering when selected', () => {
        api.currentTextModelId = 'gemma-4-26b-a4b-it';
        const input = '<thought>thinking</thought>{"a":1}';
        expect(api.extractJson(input)).toBe('{"a":1}');
      });

      it('strips thinking tokens for non-gemma models', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = '<|think|>secret<|/think|>{"a":1}';
        expect(api.extractJson(input)).toBe('{"a":1}');
      });
    });

    describe('extractJsonStrict', () => {
      it('extracts an object and strips fences and thinking tokens', () => {
        const input = '```json\n<thought>x</thought>{"a":1}\n```';
        expect(api.extractJsonStrict(input)).toBe('{"a":1}');
      });

      it('throws when no JSON is found', () => {
        expect(() => api.extractJsonStrict('totally not json')).toThrowError('No JSON found in response');
      });

      it('throws when brackets are never closed', () => {
        expect(() => api.extractJsonStrict('{"a": 1')).toThrowError(/Malformed JSON/);
      });

      it('handles escaped characters inside strings', () => {
        const input = '{"a":"line\\nbreak [x]"}';
        expect(JSON.parse(api.extractJsonStrict(input)).a).toBe('line\nbreak [x]');
      });
    });

    describe('filterReasoningContext', () => {
      it('strips reasoning before the first markdown header', () => {
        const input = 'Some reasoning here\nmore drafting\n## Spending Pattern\nReal content.';
        const out = api.filterReasoningContext(input);
        expect(out.startsWith('## Spending Pattern')).toBeTrue();
      });

      it('removes thinking tokens', () => {
        const input = '<|think|>secret<|/think|>## Header\nBody.';
        expect(api.filterReasoningContext(input)).not.toContain('secret');
      });

      it('applies aggressive filtering when no markdown header exists', () => {
        const input = 'Reasoning: I will think first.\n\nActual sentence stands on its own here.';
        const out = api.filterReasoningContext(input);
        expect(out.length).toBeGreaterThan(0);
      });

      it('falls back to original text when filtering empties the result', () => {
        const input = '## ';
        const out = api.filterReasoningContext(input);
        expect(out).toBe('##');
      });

      it('strips trailing check markers', () => {
        const input = '## Header\nGood content here.\nCheck:* verifying things';
        const out = api.filterReasoningContext(input);
        expect(out).not.toContain('verifying things');
      });
    });

    describe('filterReasoningContextForAdvice', () => {
      it('light-filters Gemini output', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = 'Save more money now. Build an emergency fund.';
        const out = api.filterReasoningContextForAdvice(input);
        expect(out).toContain('Save more money');
      });

      it('extracts advice from the last marker for Gemma 4', () => {
        api.currentTextModelId = 'gemma-4-26b-a4b-it';
        const input = 'Draft 1: something. Prioritize cutting subscriptions. Then save the rest.';
        const out = api.filterReasoningContextForAdvice(input);
        expect(out).toContain('Prioritize');
      });

      it('deduplicates near-identical repeated sentences', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = 'You should save more money. You should save more money. Build a fund.';
        const out = api.filterReasoningContextForAdvice(input);
        const occurrences = out.split('save more money').length - 1;
        expect(occurrences).toBe(1);
      });

      it('caps the result at three sentences', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = 'One sentence here. Two sentence here. Three sentence here. Four sentence here.';
        const out = api.filterReasoningContextForAdvice(input);
        expect(out).not.toContain('Four sentence');
      });

      it('protects decimal points so amounts are not split', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = 'Your balance is 16,875.00 TWD this month and growing nicely overall here.';
        const out = api.filterReasoningContextForAdvice(input);
        expect(out).toContain('16,875.00');
      });

      it('falls back to original text when no full sentences remain', () => {
        api.currentTextModelId = 'gemini-3.1-flash-lite-preview';
        const input = 'no terminator just a short fragment';
        const out = api.filterReasoningContextForAdvice(input);
        expect(out).toBe('no terminator just a short fragment');
      });
    });

    describe('translateCategoryName', () => {
      it('translates a provided name', () => {
        translationService.t.and.returnValue('Groceries');
        expect(api.translateCategoryName('categoryNames.groceries')).toBe('Groceries');
      });

      it('returns Other for an undefined name', () => {
        expect(api.translateCategoryName(undefined)).toBe('Other');
      });
    });

    describe('hitTokenLimit', () => {
      it('is true when finishReason is MAX_TOKENS', () => {
        expect(api.hitTokenLimit(makeResult('x', 'MAX_TOKENS'))).toBeTrue();
      });

      it('is false otherwise', () => {
        expect(api.hitTokenLimit(makeResult('x', 'STOP'))).toBeFalse();
      });
    });

    describe('mapCategoryNameToId', () => {
      it('matches by exact (translated) name', () => {
        expect(api.mapCategoryNameToId('Groceries')).toBe('food_groceries');
      });

      it('matches by partial name', () => {
        // "Fuel" is contained in the "Fuel & Gas" category name.
        expect(api.mapCategoryNameToId('Fuel')).toBe('transport_fuel_&_gas');
      });

      it('maps known keywords when no category matches', () => {
        categoryService.categories.and.returnValue([]);
        expect(api.mapCategoryNameToId('some coffee shop')).toBe('food_coffee_&_drinks');
        expect(api.mapCategoryNameToId('gas station')).toBe('transport_fuel_&_gas');
        expect(api.mapCategoryNameToId('pharmacy run')).toBe('health_pharmacy_&_medicine');
      });

      it('returns other_expense when nothing matches', () => {
        categoryService.categories.and.returnValue([]);
        expect(api.mapCategoryNameToId('zzz unmatched zzz')).toBe('other_expense');
      });
    });
  });
});
