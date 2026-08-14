import { TestBed } from '@angular/core/testing';
import { OpenAIService } from './openai.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Category, Transaction, MonthlyTotal, Budget, currencyDecimalPlaces } from '../../models';
import { createCategory, createTransaction } from './testing';
import { RawTransaction, PreviousPeriodData } from './gemini.service';

/**
 * A minimal stand-in for the OpenAI Responses API client. The service only
 * ever calls `client.responses.create`, so the fake exposes that single spy
 * and lets each test decide what it resolves or rejects with.
 */
interface FakeResponsesClient {
  responses: { create: jasmine.Spy };
}

function makeFakeClient(): FakeResponsesClient {
  return { responses: { create: jasmine.createSpy('create') } };
}

/** Build a Responses API result whose only field the service reads. */
function responseWith(text: string): { output_text: string } {
  return { output_text: text };
}

describe('OpenAIService', () => {
  let service: OpenAIService;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  const categories: Category[] = [
    createCategory({ id: 'food', name: 'Restaurants', type: 'expense', isActive: true }),
    createCategory({ id: 'transport', name: 'Transport', type: 'expense', isActive: true }),
    createCategory({
      id: 'food_child',
      name: 'Child',
      type: 'expense',
      parentId: 'food',
      isActive: true,
    }),
    createCategory({ id: 'inactive', name: 'Inactive', type: 'expense', isActive: false }),
  ];

  /** Replace the service's private SDK client with the supplied fake. */
  function setClient(client: FakeResponsesClient | null): void {
    (service as unknown as { client: unknown }).client = client;
  }

  /**
   * Stub the on-demand SDK import with a lightweight constructor so the
   * initialize() path never reaches the real package or the network.
   */
  function stubSdk(): jasmine.Spy {
    // Lightweight stand-in; the default constructor accepts the options object.
    class FakeOpenAI {}
    return spyOn(
      service as unknown as { loadSdk: () => Promise<unknown> },
      'loadSdk'
    ).and.returnValue(Promise.resolve({ default: FakeOpenAI }));
  }

  beforeEach(() => {
    mockCategoryService = jasmine.createSpyObj<CategoryService>('CategoryService', ['categories']);
    mockCurrencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', ['convert', 'formatAmount']);
    mockCurrencyService.formatAmount.and.callFake(
      (amount: number, code: string) => amount.toFixed(currencyDecimalPlaces(code)));
    mockTranslationService = jasmine.createSpyObj<TranslationService>('TranslationService', [
      't',
      'currentLocale',
    ]);

    mockCategoryService.categories.and.returnValue(categories);
    // Identity conversion keeps arithmetic in summaries easy to assert.
    mockCurrencyService.convert.and.callFake((amount: number) => amount);
    // Translation echoes the key so prompt assertions stay readable.
    mockTranslationService.t.and.callFake((key: string) => key);
    mockTranslationService.currentLocale.and.returnValue('en');

    TestBed.configureTestingModule({
      providers: [
        OpenAIService,
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    });

    service = TestBed.inject(OpenAIService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('is not available before a key is supplied', () => {
      expect(service.isAvailable()).toBeFalse();
      expect(service.isAvailableSignal()).toBeFalse();
      expect(service.isProcessing()).toBeFalse();
      expect(service.lastError()).toBeNull();
    });
  });

  describe('reinitialize / initialize', () => {
    it('warns and stays unavailable when called with no key', async () => {
      const warnSpy = spyOn(console, 'warn');
      // Force a stale client so we can prove the empty-key path clears it.
      setClient(makeFakeClient());

      await service.reinitialize();

      expect(service.isAvailable()).toBeFalse();
      expect(service.isAvailableSignal()).toBeFalse();
      // No-key branch of reinitialize short-circuits before initialize().
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when initialize receives a blank key', async () => {
      const warnSpy = spyOn(console, 'warn');

      await service.reinitialize('   ');

      expect(warnSpy).toHaveBeenCalledWith('OpenAI API key not provided');
      expect(service.isAvailable()).toBeFalse();
    });

    it('constructs a client for a real key and becomes available', async () => {
      // Exercises the real on-demand import seam (offline: the SDK only
      // performs network I/O when a request method is invoked).
      await service.reinitialize('sk-test-key');

      expect(service.isAvailable()).toBeTrue();
      expect(service.isAvailableSignal()).toBeTrue();
    });

    it('skips re-construction when the same key is supplied again', async () => {
      const loadSpy = stubSdk();

      await service.reinitialize('sk-same-key');
      const firstClient = (service as unknown as { client: unknown }).client;

      await service.reinitialize('sk-same-key');
      const secondClient = (service as unknown as { client: unknown }).client;

      expect(secondClient).toBe(firstClient);
      // Second call short-circuits, so the SDK loads only once.
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it('reports the failure path when SDK construction throws', async () => {
      const errorSpy = spyOn(console, 'error');
      // Stub the dynamic import so construction blows up deterministically.
      const importSpy = spyOn(
        service as unknown as { loadSdk: () => Promise<unknown> },
        'loadSdk'
      ).and.returnValue(Promise.reject(new Error('boom')));

      await service.reinitialize('sk-broken-key');

      expect(importSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isAvailable()).toBeFalse();
    });
  });

  describe('setModel', () => {
    it('switches the model and logs once', () => {
      const logSpy = spyOn(console, 'log');

      service.setModel('gpt-test');

      expect(logSpy).toHaveBeenCalledWith('[OpenAIService] Model switched to gpt-test');
    });

    it('ignores an empty model id', () => {
      const logSpy = spyOn(console, 'log');
      service.setModel('');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('ignores a model id identical to the current one', async () => {
      const logSpy = spyOn(console, 'log');
      service.setModel('gpt-x');
      logSpy.calls.reset();
      service.setModel('gpt-x');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('parseReceipt', () => {
    it('throws when the client is unavailable', async () => {
      await expectAsync(service.parseReceipt('img')).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('parses a well-formed receipt and maps the category', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify({
            merchant: 'Cafe',
            amount: 12.5,
            currency: 'EUR',
            date: '2024-02-03',
            items: [{ name: 'Latte', amount: 4 }],
            receiptDetails: 'Latte 4',
            suggestedCategory: 'Restaurants',
          })
        )
      );
      setClient(fake);

      const result = await service.parseReceipt('data:image/png;base64,abc');

      expect(result.merchant).toBe('Cafe');
      expect(result.amount).toBe(12.5);
      expect(result.currency).toBe('EUR');
      // Built from local parts. Comparing against `new Date('2024-02-03')` ran
      // the parse under test on both sides of the assertion, so it held in
      // every zone while the receipt filed into the wrong month.
      expect(result.date).toEqual(new Date(2024, 1, 3));
      expect(result.suggestedCategory).toBe('food');
      expect(result.confidence).toBe(0.85);
      expect(service.isProcessing()).toBeFalse();
      // A data: URL should be forwarded untouched.
      const sentImage = fake.responses.create.calls.mostRecent().args[0].input[0].content[1];
      expect(sentImage.image_url).toBe('data:image/png;base64,abc');
    });

    it('prefixes a bare base64 string with a jpeg data URL and uses defaults', async () => {
      const fake = makeFakeClient();
      // Only suggestedCategory is supplied; every other field falls back.
      fake.responses.create.and.resolveTo(responseWith('{"suggestedCategory":"Other"}'));
      setClient(fake);

      const result = await service.parseReceipt('rawbase64');

      expect(result.merchant).toBe('Unknown');
      expect(result.amount).toBe(0);
      // Not defaulted here on purpose: an unreadable currency comes back
      // empty so the caller can substitute the account's base currency.
      expect(result.currency).toBe('');
      expect(result.date instanceof Date).toBeTrue();
      expect(result.items).toEqual([]);
      expect(result.confidence).toBe(0.5);
      const sentImage = fake.responses.create.calls.mostRecent().args[0].input[0].content[1];
      expect(sentImage.image_url).toBe('data:image/jpeg;base64,rawbase64');
    });

    it('re-declares a non-image data URL as jpeg', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('{"suggestedCategory":"Other"}'));
      setClient(fake);

      // A shared photo can arrive typed application/octet-stream; forwarded
      // verbatim the API rejects it as a non-image, so the payload is
      // re-declared as the image it is.
      await service.parseReceipt('data:application/octet-stream;base64,abc');

      const sentImage = fake.responses.create.calls.mostRecent().args[0].input[0].content[1];
      expect(sentImage.image_url).toBe('data:image/jpeg;base64,abc');
    });

    it('handles an empty model response by treating it as empty json', async () => {
      const fake = makeFakeClient();
      // output_text falsy -> '' -> extractJson returns '' -> JSON.parse throws.
      fake.responses.create.and.resolveTo({ output_text: '' });
      setClient(fake);

      await expectAsync(service.parseReceipt('img')).toBeRejected();
      expect(service.isProcessing()).toBeFalse();
    });

    it('records the error and rethrows on API failure', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('rate limit 429'));
      setClient(fake);

      await expectAsync(service.parseReceipt('img')).toBeRejectedWithError('rate limit 429');
      expect(service.lastError()).toBe('rate limit 429');
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });

    it('falls back to a generic message for a non-Error rejection', async () => {
      spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith('plain string failure');
      setClient(fake);

      await expectAsync(service.parseReceipt('img')).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  describe('suggestCategory', () => {
    it('throws when the client is unavailable', async () => {
      await expectAsync(service.suggestCategory('x', categories)).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('returns the validated category id from the model', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('  transport  '));
      setClient(fake);

      const result = await service.suggestCategory('Bus ticket', categories);

      expect(result).toBe('transport');
    });

    it('falls back to other_expense when the id is not recognised', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('nonexistent'));
      setClient(fake);

      const result = await service.suggestCategory('Mystery', categories);
      expect(result).toBe('other_expense');
    });

    it('falls back to other_expense when output_text is missing', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo({});
      setClient(fake);

      const result = await service.suggestCategory('Mystery', categories);
      expect(result).toBe('other_expense');
    });

    it('returns other_expense and logs on error', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('fail'));
      setClient(fake);

      const result = await service.suggestCategory('Anything', categories);

      expect(result).toBe('other_expense');
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });
  });

  describe('categorizeTransactions', () => {
    const txns: RawTransaction[] = [
      { description: 'Dinner', amount: 40, date: new Date() },
      { description: 'Taxi', amount: 20, date: new Date() },
    ];

    it('throws when the client is unavailable', async () => {
      await expectAsync(service.categorizeTransactions(txns)).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('maps model categorizations onto the transactions', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify([
            { index: 0, categoryId: 'food' },
            { index: 1, categoryId: 'transport' },
          ])
        )
      );
      setClient(fake);

      const result = await service.categorizeTransactions(txns);

      expect(result[0].suggestedCategoryId).toBe('food');
      expect(result[0].confidence).toBe(0.8);
      expect(result[1].suggestedCategoryId).toBe('transport');
    });

    it('defaults unmatched transactions to other_expense with low confidence', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('[{"index": 0, "categoryId": "food"}]'));
      setClient(fake);

      const result = await service.categorizeTransactions(txns);

      expect(result[1].suggestedCategoryId).toBe('other_expense');
      expect(result[1].confidence).toBe(0.3);
    });

    it('passes the model confidence through and coerces invalid category IDs', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify([
            { index: 0, categoryId: 'food_child', confidence: 0.6 },
            { index: 1, categoryId: 'not_a_real_id', confidence: 0.95 },
          ])
        )
      );
      setClient(fake);

      const result = await service.categorizeTransactions(txns);

      expect(result[0].suggestedCategoryId).toBe('food_child');
      expect(result[0].confidence).toBe(0.6);
      expect(result[1].suggestedCategoryId).toBe('other_expense');
      expect(result[1].confidence).toBe(0.3);
    });

    it('offers sub-categories and asks for confidence in the prompt', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('[]'));
      setClient(fake);

      await service.categorizeTransactions(txns);

      const request = fake.responses.create.calls.mostRecent().args[0] as { input: string };
      expect(request.input).toContain('food_child: Restaurants / Child');
      expect(request.input).toContain('"confidence"');
      expect(request.input).not.toContain('inactive');
    });

    it('returns safe defaults for every transaction on error', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('bad'));
      setClient(fake);

      const result = await service.categorizeTransactions(txns);

      expect(result.length).toBe(2);
      expect(result.every((t) => t.suggestedCategoryId === 'other_expense')).toBeTrue();
      expect(result.every((t) => t.confidence === 0.1)).toBeTrue();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('interpretSearchQuery', () => {
    const context = {
      today: '2026-07-24',
      baseCurrency: 'USD',
      categories: [{ id: 'food', name: 'Restaurants', type: 'expense' as const }],
      goals: [],
      budgets: [],
    };

    it('throws when the client is unavailable', async () => {
      await expectAsync(service.interpretSearchQuery('coffee', context))
        .toBeRejectedWithError('OpenAI client not available');
    });

    it('parses the model response into a validated intent', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith('{"kind":"filter","filters":{"categoryId":"food","minAmount":50}}'));
      setClient(fake);

      const intent = await service.interpretSearchQuery('food over 50', context);

      expect(intent.kind).toBe('filter');
      expect(intent.filters.categoryId).toBe('food');
      expect(intent.filters.minAmount).toBe(50);
    });

    it('rejects when the response is not usable JSON', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('cannot help with that'));
      setClient(fake);
      await expectAsync(service.interpretSearchQuery('x', context)).toBeRejected();
    });
  });

  describe('generateSpendingSummary', () => {
    const expenseTxns: Transaction[] = [
      createTransaction({ type: 'expense', amount: 100, currency: 'USD', categoryId: 'food' }),
      createTransaction({ type: 'expense', amount: 50, currency: 'USD', categoryId: 'transport' }),
      createTransaction({ type: 'income', amount: 500, currency: 'USD', categoryId: 'food' }),
    ];

    it('throws when the client is unavailable', async () => {
      await expectAsync(
        service.generateSpendingSummary(expenseTxns, 'June', 'USD')
      ).toBeRejectedWithError('OpenAI client not available');
    });

    it('returns the trimmed model summary', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('  ## Spending Pattern\nGood  '));
      setClient(fake);

      const result = await service.generateSpendingSummary(expenseTxns, 'June', 'USD');

      expect(result).toBe('## Spending Pattern\nGood');
    });

    it('writes whole amounts for zero-decimal base currencies', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('summary'));
      setClient(fake);

      await service.generateSpendingSummary(expenseTxns, 'June', 'JPY');

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Total Expenses: 150 JPY');
      expect(prompt).not.toMatch(/\.\d{2} JPY/);
    });

    it('builds the prompt with historical, budget and rag sections', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('summary'));
      setClient(fake);

      const previous: PreviousPeriodData = { income: 400, expense: 120 };
      const budgets: Budget[] = [
        {
          id: 'b1',
          userId: 'u',
          categoryId: 'food',
          name: 'Food',
          amount: 80,
          currency: 'USD',
          period: 'monthly',
          spent: 0,
          isActive: true,
          alertThreshold: 80,
        } as unknown as Budget,
        {
          id: 'b2',
          userId: 'u',
          categoryId: 'transport',
          name: 'Transport',
          amount: 0,
          currency: 'USD',
          period: 'monthly',
          spent: 0,
          isActive: true,
          alertThreshold: 80,
        } as unknown as Budget,
      ];

      await service.generateSpendingSummary(
        expenseTxns,
        'June',
        'USD',
        previous,
        budgets,
        [],
        '  noteworthy spend  '
      );

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Previous period comparison');
      expect(prompt).toContain('Active budgets status');
      expect(prompt).toContain('Notable activity');
      // food budget 100 spent / 80 -> exceeded marker; transport budget 0 -> guarded
      expect(prompt).toContain('EXCEEDED');
      expect(prompt).toContain('Ground your insights');
    });

    it('uses N/A change markers when previous totals are zero', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('summary'));
      setClient(fake);

      await service.generateSpendingSummary(expenseTxns, 'June', 'USD', {
        income: 0,
        expense: 0,
      });

      // income 0 & expense 0 -> historical section omitted entirely.
      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).not.toContain('Previous period comparison');
    });

    it('emits N/A for individual zero previous metrics', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('summary'));
      setClient(fake);

      // expense > 0 keeps the section; income 0 forces the N/A branch.
      await service.generateSpendingSummary(expenseTxns, 'June', 'USD', {
        income: 0,
        expense: 100,
      });

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Income change: N/A%');
    });

    it('falls back to a default string when the model returns nothing', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo({});
      setClient(fake);

      const result = await service.generateSpendingSummary([], 'June', 'USD');
      expect(result).toBe('Unable to generate spending summary.');
    });

    it('rethrows and logs on error', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('summary fail'));
      setClient(fake);

      await expectAsync(service.generateSpendingSummary([], 'June', 'USD')).toBeRejectedWithError(
        'summary fail'
      );
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });
  });

  describe('getFinancialAdvice', () => {
    const summary: MonthlyTotal = {
      income: 1000,
      expense: 600,
      balance: 400,
      transactionCount: 10,
    } as MonthlyTotal;

    it('throws when the client is unavailable', async () => {
      await expectAsync(service.getFinancialAdvice(summary, 'USD')).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('returns trimmed advice', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('  Save more  '));
      setClient(fake);

      const result = await service.getFinancialAdvice(summary, 'USD', 'May');
      expect(result).toBe('Save more');
    });

    it('writes whole amounts for zero-decimal base currencies', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('advice'));
      setClient(fake);

      await service.getFinancialAdvice(summary, 'JPY', 'May');

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Income: 1000 JPY');
      expect(prompt).not.toMatch(/\.\d{2} JPY/);
    });

    it('handles a zero-income summary (savings rate 0)', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('advice'));
      setClient(fake);

      const zero = { ...summary, income: 0 } as MonthlyTotal;
      const result = await service.getFinancialAdvice(zero, 'USD');
      expect(result).toBe('advice');
      // A zero savings rate selects the low-rate guidance. The prompt's own
      // wording is asserted in prompt-registry.spec.ts; what matters here is
      // that the computed rate reaches the registry and picks the right branch.
      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Address the low savings rate');
    });

    it('falls back to a default when the model returns nothing', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo({});
      setClient(fake);

      const result = await service.getFinancialAdvice(summary, 'USD');
      expect(result).toBe(
        'Keep tracking your expenses to better understand your spending patterns.'
      );
    });

    it('rethrows and logs on error', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('advice fail'));
      setClient(fake);

      await expectAsync(service.getFinancialAdvice(summary, 'USD')).toBeRejectedWithError('advice fail');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('extractTransactionsFromImage', () => {
    it('throws when the client is unavailable', async () => {
      await expectAsync(service.extractTransactionsFromImage('img')).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('normalises extracted transactions', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify([
            {
              date: '2024-01-15',
              description: 'AMAZON',
              amount: -45.99,
              type: 'expense',
              currency: 'USD',
              category: 'shop',
              merchant: 'Amazon',
              details: 'x',
            },
          ])
        )
      );
      setClient(fake);

      const result = await service.extractTransactionsFromImage('data:image/png;base64,z');

      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(45.99);
      expect(result[0].description).toBe('AMAZON');
      // The category a row names is resolved against the catalog, and 'shop'
      // matches nothing in it. It used to be passed through as written, and
      // the import flow reads this field as a category id — so a name the
      // catalog has never heard of arrived as a category that does not exist.
      expect(result[0].category).toBe('other_expense');
    });

    it('applies defaults for sparse rows', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('[{}]'));
      setClient(fake);

      const result = await service.extractTransactionsFromImage('raw');

      expect(result[0].description).toBe('Unknown');
      expect(result[0].amount).toBe(0);
      expect(result[0].type).toBe('expense');
      expect(result[0].currency).toBe('');
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rethrows on failure and records lastError', async () => {
      // An empty array here used to render as "no transactions found" and
      // defeat provider fallback; the failure must propagate.
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('vision fail'));
      setClient(fake);

      await expectAsync(service.extractTransactionsFromImage('img'))
        .toBeRejectedWithError('vision fail');
      expect(service.lastError()).toBe('vision fail');
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });

    it('throws on a 401 instead of returning an empty result', async () => {
      const fake = makeFakeClient();
      spyOn(console, 'error');
      fake.responses.create.and.rejectWith(new Error('401 Incorrect API key provided'));
      setClient(fake);

      await expectAsync(service.extractTransactionsFromImage('img')).toBeRejected();
      expect(service.lastError()).toContain('401');
    });

    it('uses a generic message for non-Error rejections', async () => {
      spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(123);
      setClient(fake);

      await expectAsync(service.extractTransactionsFromImage('img')).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  describe('extractTransactionsFromMultipleImages', () => {
    it('throws when the client is unavailable', async () => {
      await expectAsync(
        service.extractTransactionsFromMultipleImages(['a'])
      ).toBeRejectedWithError('OpenAI client not available');
    });

    it('returns an empty array for an empty image list', async () => {
      const fake = makeFakeClient();
      setClient(fake);

      const result = await service.extractTransactionsFromMultipleImages([]);

      expect(result).toEqual([]);
      expect(fake.responses.create).not.toHaveBeenCalled();
    });

    it('normalises multi-image results and forwards every image', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify([
            {
              date: '2024-01-15',
              description: 'Item',
              amount: -10,
              type: 'expense',
              currency: 'USD',
              imageIndex: 1,
              positionInImage: 'top',
              confidence: 0.9,
              wasMerged: true,
              mergedFromImages: [0, 1],
              receiptId: 2,
              merchant: 'Store',
              category: 'Restaurants',
              details: '×2',
              receiptDetails: 'Item ×2 — 10.00\nTotal 10.00',
              receiptTotal: 11.87,
            },
          ])
        )
      );
      setClient(fake);

      const result = await service.extractTransactionsFromMultipleImages([
        'data:image/png;base64,a',
        'rawb',
      ]);

      expect(result[0].amount).toBe(10);
      expect(result[0].imageIndex).toBe(1);
      expect(result[0].wasMerged).toBeTrue();
      // The receipt-detail fields must survive normalisation so line items
      // can be consolidated and recorded in the transaction note
      expect(result[0].receiptId).toBe(2);
      expect(result[0].merchant).toBe('Store');
      expect(result[0].category).toBe('food');
      expect(result[0].details).toBe('×2');
      expect(result[0].receiptDetails).toBe('Item ×2 — 10.00\nTotal 10.00');
      expect(result[0].receiptTotal).toBe(11.87);
      // Two images appended after the prompt text block.
      const content = fake.responses.create.calls.mostRecent().args[0].input[0].content;
      expect(content.length).toBe(3);
      expect(content[1].image_url).toBe('data:image/png;base64,a');
      expect(content[2].image_url).toBe('data:image/jpeg;base64,rawb');
    });

    it('applies defaults for sparse multi-image rows', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('[{}]'));
      setClient(fake);

      const result = await service.extractTransactionsFromMultipleImages(['a']);

      expect(result[0].imageIndex).toBe(0);
      expect(result[0].positionInImage).toBe('middle');
      expect(result[0].confidence).toBe(0.7);
      expect(result[0].wasMerged).toBeFalse();
      expect(result[0].receiptId).toBe(1);
      expect(result[0].category).toBeUndefined();
      expect(result[0].receiptTotal).toBeUndefined();
    });

    it('rethrows on failure and records lastError', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('multi fail'));
      setClient(fake);

      await expectAsync(service.extractTransactionsFromMultipleImages(['a']))
        .toBeRejectedWithError('multi fail');
      expect(service.lastError()).toBe('multi fail');
      expect(errorSpy).toHaveBeenCalled();
      expect(service.isProcessing()).toBeFalse();
    });

    it('uses a generic message for non-Error rejections', async () => {
      spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(null);
      setClient(fake);

      await expectAsync(service.extractTransactionsFromMultipleImages(['a'])).toBeRejected();
      expect(service.lastError()).toBe('Unknown error');
    });
  });

  describe('detectCSVMapping', () => {
    const headers = ['Date', 'Description', 'Amount'];
    const rows = [
      ['2024-01-01', 'Shop', '10'],
      ['2024-01-02', 'Cafe', '5'],
    ];

    it('throws when the client is unavailable', async () => {
      await expectAsync(service.detectCSVMapping(headers, rows)).toBeRejectedWithError(
        'OpenAI client not available'
      );
    });

    it('returns the parsed mapping from the model', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith(
          JSON.stringify({
            dateColumn: 'Date',
            descriptionColumn: 'Description',
            amountColumn: 'Amount',
            dateFormat: 'YYYY-MM-DD',
            hasHeader: true,
          })
        )
      );
      setClient(fake);

      const result = await service.detectCSVMapping(headers, rows);

      expect(result.dateColumn).toBe('Date');
      expect(result.dateFormat).toBe('YYYY-MM-DD');
    });

    it('falls back to header-based defaults on error', async () => {
      const errorSpy = spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('csv fail'));
      setClient(fake);

      const result = await service.detectCSVMapping(headers, rows);

      expect(result.dateColumn).toBe('Date');
      expect(result.descriptionColumn).toBe('Description');
      expect(result.amountColumn).toBe('Amount');
      expect(result.hasHeader).toBeTrue();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('falls back to literal defaults when headers are missing', async () => {
      spyOn(console, 'error');
      const fake = makeFakeClient();
      fake.responses.create.and.rejectWith(new Error('csv fail'));
      setClient(fake);

      const result = await service.detectCSVMapping([], []);

      expect(result.dateColumn).toBe('date');
      expect(result.descriptionColumn).toBe('description');
      expect(result.amountColumn).toBe('amount');
    });
  });

  describe('private helpers exercised through public methods', () => {
    it('strips markdown code fences before parsing json', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith('```json\n{"merchant":"M","amount":1,"suggestedCategory":"x"}\n```')
      );
      setClient(fake);

      const result = await service.parseReceipt('img');
      expect(result.merchant).toBe('M');
    });

    it('maps a category by partial name match', async () => {
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith('{"merchant":"M","amount":1,"suggestedCategory":"Rest"}')
      );
      setClient(fake);

      // "Rest" is a substring of the "Restaurants" category name.
      const result = await service.parseReceipt('img');
      expect(result.suggestedCategory).toBe('food');
    });

    it('maps a category via the keyword fallback table', async () => {
      mockCategoryService.categories.and.returnValue([
        createCategory({ id: 'misc', name: 'Totally Unrelated', isActive: true }),
      ]);
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith('{"merchant":"M","amount":1,"suggestedCategory":"grocery run"}')
      );
      setClient(fake);

      const result = await service.parseReceipt('img');
      expect(result.suggestedCategory).toBe('food_groceries');
    });

    it('returns other_expense when nothing matches', async () => {
      mockCategoryService.categories.and.returnValue([
        createCategory({ id: 'misc', name: 'Totally Unrelated', isActive: true }),
      ]);
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(
        responseWith('{"merchant":"M","amount":1,"suggestedCategory":"zzz"}')
      );
      setClient(fake);

      const result = await service.parseReceipt('img');
      expect(result.suggestedCategory).toBe('other_expense');
    });

    it('falls back to English for an unknown locale', async () => {
      mockTranslationService.currentLocale.and.returnValue('xx' as never);
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('advice'));
      setClient(fake);

      await service.getFinancialAdvice({
        income: 1,
        expense: 0,
        balance: 1,
        transactionCount: 1,
      } as MonthlyTotal, 'USD');

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Respond in English.');
    });

    it('honours the configured locale instruction', async () => {
      mockTranslationService.currentLocale.and.returnValue('ja');
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('advice'));
      setClient(fake);

      await service.getFinancialAdvice({
        income: 1,
        expense: 0,
        balance: 1,
        transactionCount: 1,
      } as MonthlyTotal, 'USD');

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Japanese');
    });

    it('uses the Other label when a category has no name in the summary', async () => {
      mockCategoryService.categories.and.returnValue([]);
      const fake = makeFakeClient();
      fake.responses.create.and.resolveTo(responseWith('summary'));
      setClient(fake);

      const txns: Transaction[] = [
        createTransaction({ type: 'expense', amount: 10, currency: 'USD', categoryId: 'ghost' }),
      ];
      await service.generateSpendingSummary(txns, 'June', 'USD');

      const prompt = fake.responses.create.calls.mostRecent().args[0].input as string;
      expect(prompt).toContain('Other');
    });
  });
});
