import { TestBed } from '@angular/core/testing';
import { GeminiService } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { CloudLLMProviderBase } from './cloud-llm-provider.base';
import { Category, MonthlyTotal } from '../../models';
import { createCategory } from './testing/test-data';
import { environment } from '../../../environments/environment';

/**
 * The three providers must fail the *same* way for the same kind of failure.
 *
 * This is #200's acceptance criterion. Each provider used to carry its own
 * copy of every catch block, so what a failure did depended on which provider
 * happened to be configured: whether the message was recorded, whether it was
 * logged, and — until #183 — whether it was rethrown at all or answered with
 * an empty result the import flow then rendered as "no transactions found".
 *
 * The prompt-parity suite next door asserts that the three send the same text.
 * This one asserts that the three come back the same way when nothing works,
 * which is the half a user only meets on a bad day.
 *
 * Failures are injected at the SDK boundary, so the assertions are about the
 * shared code above it rather than about any transport.
 */
describe('provider error parity', () => {
  let gemini: GeminiService;
  let openai: OpenAIService;
  let claude: ClaudeService;

  let geminiModel: { generateContent: jasmine.Spy };
  let openaiClient: { responses: { create: jasmine.Spy } };
  let claudeClient: { messages: { create: jasmine.Spy } };

  /** Every provider, with the spy that decides what its SDK does. */
  let providers: { name: string; service: CloudLLMProviderBase; sdk: jasmine.Spy }[];

  const categories: Category[] = [
    createCategory({ id: 'food', name: 'Food', type: 'expense', isActive: true }),
  ];

  const summary: MonthlyTotal = {
    income: 5000,
    expense: 4600,
    balance: 400,
    transactionCount: 12,
    byCategory: [],
  } as MonthlyTotal;

  // The gitignored local environment may carry a real key, which the Gemini
  // constructor would otherwise pick up.
  const env = environment as { geminiApiKey?: string };
  let savedKey: string | undefined;
  let hadKey = false;

  beforeAll(() => {
    hadKey = 'geminiApiKey' in env;
    savedKey = env.geminiApiKey;
    delete env.geminiApiKey;
  });

  afterAll(() => {
    if (hadKey) {
      env.geminiApiKey = savedKey;
    }
  });

  beforeEach(() => {
    // Every failure below is logged once by the shared runner; the console is
    // silenced rather than asserted, because which sentence reaches it is a
    // diagnostic and not a contract.
    spyOn(console, 'error');
    spyOn(console, 'warn');

    const categoryService = jasmine.createSpyObj<CategoryService>('CategoryService', [
      'categories',
    ]);
    categoryService.categories.and.returnValue(categories);

    const currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', [
      'formatAmount',
      'convert',
    ]);
    currencyService.formatAmount.and.callFake((value: number) => value.toFixed(2));
    currencyService.convert.and.callFake((amount: number) => amount);

    const translationService = jasmine.createSpyObj<TranslationService>('TranslationService', [
      't',
      'currentLocale',
    ]);
    translationService.t.and.callFake((key: string) => key);
    translationService.currentLocale.and.returnValue('en');

    TestBed.configureTestingModule({
      providers: [
        GeminiService,
        OpenAIService,
        ClaudeService,
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
      ],
    });

    gemini = TestBed.inject(GeminiService);
    openai = TestBed.inject(OpenAIService);
    claude = TestBed.inject(ClaudeService);

    // Both Gemini handles are the same spy: it has two, and the receipt paths
    // try them in turn, so a failure has to be injected into both to be the
    // provider's answer rather than the first handle's.
    geminiModel = { generateContent: jasmine.createSpy('generateContent') };
    const internals = gemini as unknown as {
      genAI: unknown;
      textModel: unknown;
      visionModel: unknown;
    };
    internals.genAI = {};
    internals.textModel = geminiModel;
    internals.visionModel = geminiModel;

    openaiClient = { responses: { create: jasmine.createSpy('create') } };
    (openai as unknown as { client: unknown }).client = openaiClient;

    claudeClient = { messages: { create: jasmine.createSpy('create') } };
    (claude as unknown as { client: unknown }).client = claudeClient;

    providers = [
      { name: 'Gemini', service: gemini, sdk: geminiModel.generateContent },
      { name: 'OpenAI', service: openai, sdk: openaiClient.responses.create },
      { name: 'Claude', service: claude, sdk: claudeClient.messages.create },
    ];
  });

  /** Make every SDK reject with the same error. */
  function rejectAll(message: string): void {
    for (const { sdk } of providers) {
      sdk.and.rejectWith(new Error(message));
    }
  }

  /** Make every SDK answer with the same text, in its own response shape. */
  function answerAll(text: string): void {
    geminiModel.generateContent.and.resolveTo({
      response: { text: () => text, candidates: [{ finishReason: 'STOP' }] },
    });
    openaiClient.responses.create.and.resolveTo({ output_text: text });
    claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text }] });
  }

  describe('an authentication failure', () => {
    const message = '401 invalid API key';

    it('reaches the caller from every provider, with the message recorded', async () => {
      rejectAll(message);

      for (const { name, service } of providers) {
        await expectAsync(service.generateSpendingSummary([], 'June', 'USD'))
          .withContext(name)
          .toBeRejectedWithError(message);

        // Rethrown rather than answered with an empty summary: only a throw
        // reaches parseAIError, and only a throw lets the strategy layer try
        // another provider.
        expect(service.lastError()).withContext(name).toBe(message);
        expect(service.isProcessing()).withContext(name).toBeFalse();
      }
    });

    it('reaches the caller from every provider on the image paths too', async () => {
      rejectAll(message);

      for (const { name, service } of providers) {
        await expectAsync(service.parseReceipt('img')).withContext(name).toBeRejectedWithError(
          message
        );

        expect(service.lastError()).withContext(name).toBe(message);
        expect(service.isProcessing()).withContext(name).toBeFalse();
      }
    });
  });

  describe('a rate limit', () => {
    const message = '429 Too Many Requests';

    it('reaches the caller from every provider, with the message recorded', async () => {
      rejectAll(message);

      for (const { name, service } of providers) {
        await expectAsync(service.parseReceipt('img')).withContext(name).toBeRejectedWithError(
          message
        );

        // Gemini retries its second model handle before giving up, which is
        // why only the state it settles on is asserted and not the call count.
        expect(service.lastError()).withContext(name).toBe(message);
        expect(service.isProcessing()).withContext(name).toBeFalse();
      }
    });

    it('is not mistaken for an empty statement on any provider', async () => {
      rejectAll(message);

      for (const { name, service } of providers) {
        await expectAsync(service.extractStatementTransactions('img'))
          .withContext(name)
          .toBeRejectedWithError(message);
        expect(service.lastError()).withContext(name).toBe(message);
      }
    });
  });

  describe('a malformed response', () => {
    // The model answered, in words, with something that is not JSON.
    const prose = 'I am not able to help with that request.';
    const rows = [{ description: 'STARBUCKS', amount: 4.5, date: new Date('2026-07-01') }];

    it('lands every provider on the same low-confidence fallback', async () => {
      answerAll(prose);

      for (const { name, service } of providers) {
        const categorized = await service.categorizeTransactions(rows);

        // Deliberately a fallback rather than a rejection, and the same one on
        // all three: the import flow carries on and the review step flags
        // every row, which is a better answer than an error dialog over a
        // batch that has already been read off the page.
        expect(categorized.length).withContext(name).toBe(1);
        expect(categorized[0].suggestedCategoryId).withContext(name).toBe('other_expense');
        expect(categorized[0].confidence).withContext(name).toBe(0.1);
        expect(service.isProcessing()).withContext(name).toBeFalse();
        // Nothing was shown to the user, so nothing is left to be reported
        // later against an unrelated request.
        expect(service.lastError()).withContext(name).toBeNull();
      }
    });

    it('reaches the caller on the paths that have no fallback', async () => {
      answerAll(prose);

      for (const { name, service } of providers) {
        // Search degrades to keyword matching by catching this, so it must
        // arrive as a rejection on every provider.
        await expectAsync(
          service.interpretSearchQuery('coffee', {
            today: '2026-07-24',
            baseCurrency: 'USD',
            categories: [{ id: 'food', name: 'Food', type: 'expense' as const }],
            goals: [],
            budgets: [],
          })
        )
          .withContext(name)
          .toBeRejected();

        expect(service.isProcessing()).withContext(name).toBeFalse();
      }
    });
  });

  describe('an unavailable provider', () => {
    it('refuses before any request is issued, naming the provider', async () => {
      (gemini as unknown as { textModel: unknown; visionModel: unknown }).textModel = null;
      (gemini as unknown as { visionModel: unknown }).visionModel = null;
      (openai as unknown as { client: unknown }).client = null;
      (claude as unknown as { client: unknown }).client = null;

      for (const { name, service, sdk } of providers) {
        await expectAsync(service.getFinancialAdvice(summary, 'USD'))
          .withContext(name)
          .toBeRejectedWithError(/not available$/);
        expect(sdk).withContext(name).not.toHaveBeenCalled();
        expect(service.isProcessing()).withContext(name).toBeFalse();
      }
    });
  });
});
