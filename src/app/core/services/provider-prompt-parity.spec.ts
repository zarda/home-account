import { TestBed } from '@angular/core/testing';
import { GeminiService } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Category, MonthlyTotal } from '../../models';
import { createCategory } from './testing/test-data';
import { JSON_ONLY_PREAMBLE, renderPrompt } from '../prompts';
import { environment } from '../../../environments/environment';

/**
 * The three providers must send the *same* prompt for the same task.
 *
 * Each service used to carry its own copy of every prompt, and they had already
 * drifted: only Gemini asked receipts for `receiptCount`, only Gemini gave the
 * narrative a language instruction, and the spending summary opened with
 * different sentences depending on which provider was configured. Nothing
 * failed, because nothing compared them.
 *
 * This suite is that comparison. It captures the text each SDK actually
 * receives and asserts it equals the registry's rendering — allowing only for
 * Gemini's JSON-only preamble, which is a documented adapter concern.
 */
describe('provider prompt parity', () => {
  let gemini: GeminiService;
  let openai: OpenAIService;
  let claude: ClaudeService;

  let geminiTextModel: { generateContent: jasmine.Spy };
  let openaiClient: { responses: { create: jasmine.Spy } };
  let claudeClient: { messages: { create: jasmine.Spy } };

  const categories: Category[] = [
    createCategory({ id: 'food', name: 'Food', type: 'expense', isActive: true }),
    createCategory({ id: 'transport', name: 'Transport', type: 'expense', isActive: true }),
  ];

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

    geminiTextModel = { generateContent: jasmine.createSpy('generateContent') };
    (gemini as unknown as { genAI: unknown; textModel: unknown; visionModel: unknown }).genAI = {};
    (gemini as unknown as { textModel: unknown }).textModel = geminiTextModel;
    (gemini as unknown as { visionModel: unknown }).visionModel = geminiTextModel;

    openaiClient = { responses: { create: jasmine.createSpy('create') } };
    (openai as unknown as { client: unknown }).client = openaiClient;

    claudeClient = { messages: { create: jasmine.createSpy('create') } };
    (claude as unknown as { client: unknown }).client = claudeClient;
  });

  /** Text Gemini received, with the adapter's JSON preamble stripped. */
  function geminiPrompt(): string {
    const request = geminiTextModel.generateContent.calls.mostRecent().args[0];
    const text = request.contents[0].parts.find((p: { text?: string }) => p.text)!.text as string;
    return text.startsWith(JSON_ONLY_PREAMBLE)
      ? text.slice(JSON_ONLY_PREAMBLE.length).replace(/^\n+/, '')
      : text;
  }

  function openaiPrompt(): string {
    const input = openaiClient.responses.create.calls.mostRecent().args[0].input;
    if (typeof input === 'string') {
      return input;
    }
    const part = input[0].content.find((c: { type: string }) => c.type === 'input_text');
    return part.text as string;
  }

  function claudePrompt(): string {
    const content = claudeClient.messages.create.calls.mostRecent().args[0].messages[0].content;
    if (typeof content === 'string') {
      return content;
    }
    return content.find((c: { type: string }) => c.type === 'text').text as string;
  }

  describe('categorizeTransactions', () => {
    const rows = [{ description: 'STARBUCKS', amount: 4.5, date: new Date('2026-07-01') }];

    beforeEach(async () => {
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => '[]', candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: '[]' });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: '[]' }] });

      await gemini.categorizeTransactions(rows);
      await openai.categorizeTransactions(rows);
      await claude.categorizeTransactions(rows);
    });

    it('sends byte-identical text from all three providers', () => {
      expect(openaiPrompt()).toBe(geminiPrompt());
      expect(claudePrompt()).toBe(geminiPrompt());
    });

    it('sends exactly what the registry rendered', () => {
      const expected = renderPrompt('categorizeTransactions', {
        categoryCatalog: 'food: Food\ntransport: Transport',
        rows: [{ index: 0, description: 'STARBUCKS', amount: 4.5 }],
      }).user;
      expect(geminiPrompt()).toBe(expected);
    });
  });

  describe('getFinancialAdvice', () => {
    const summary = {
      income: 5000,
      expense: 4600,
      balance: 400,
      transactionCount: 12,
      byCategory: [],
    } as MonthlyTotal;

    beforeEach(async () => {
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => 'advice.', candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: 'advice.' });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: 'advice.' }] });

      await gemini.getFinancialAdvice(summary, 'USD', 'this month');
      await openai.getFinancialAdvice(summary, 'USD', 'this month');
      await claude.getFinancialAdvice(summary, 'USD', 'this month');
    });

    it('sends byte-identical text from all three providers', () => {
      expect(openaiPrompt()).toBe(geminiPrompt());
      expect(claudePrompt()).toBe(geminiPrompt());
    });

    it('gives every provider the closing instruction that suppresses preamble', () => {
      // Claude's copy was missing this line entirely.
      for (const prompt of [geminiPrompt(), openaiPrompt(), claudePrompt()]) {
        expect(prompt).toContain('OUTPUT: Only the advice sentences themselves');
      }
    });
  });

  describe('generatePatternNarrative', () => {
    beforeEach(async () => {
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => 'A sentence.', candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: 'A sentence.' });
      claudeClient.messages.create.and.resolveTo({
        content: [{ type: 'text', text: 'A sentence.' }],
      });

      await gemini.generatePatternNarrative('Groceries rose 12%.', 'en');
      await openai.generatePatternNarrative('Groceries rose 12%.', 'en');
      await claude.generatePatternNarrative('Groceries rose 12%.', 'en');
    });

    it('sends byte-identical text from all three providers', () => {
      expect(openaiPrompt()).toBe(geminiPrompt());
      expect(claudePrompt()).toBe(geminiPrompt());
    });

    it('gives every provider the language instruction', () => {
      // Only Gemini's copy had it, so OpenAI and Claude answered in English
      // whatever locale the app was in.
      for (const prompt of [geminiPrompt(), openaiPrompt(), claudePrompt()]) {
        expect(prompt).toContain('Respond in English.');
      }
    });
  });

  describe('interpretSearchQuery', () => {
    const context = {
      today: '2026-07-24',
      baseCurrency: 'USD',
      categories: [{ id: 'food', name: 'Food', type: 'expense' as const }],
    };

    it('sends byte-identical text from all three providers', async () => {
      const intent = JSON.stringify({ kind: 'filter', filters: {} });
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => intent, candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: intent });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: intent }] });

      await gemini.interpretSearchQuery('coffee', context);
      await openai.interpretSearchQuery('coffee', context);
      await claude.interpretSearchQuery('coffee', context);

      expect(openaiPrompt()).toBe(geminiPrompt());
      expect(claudePrompt()).toBe(geminiPrompt());
    });

    it('lets the failure through so callers fall back to keyword search', async () => {
      // Search degrades to keyword matching by catching this. An adapter that
      // swallowed it would leave the user with no results and no error.
      const boom = new Error('model unavailable');
      geminiTextModel.generateContent.and.rejectWith(boom);
      openaiClient.responses.create.and.rejectWith(boom);
      claudeClient.messages.create.and.rejectWith(boom);

      await expectAsync(gemini.interpretSearchQuery('coffee', context)).toBeRejected();
      await expectAsync(openai.interpretSearchQuery('coffee', context)).toBeRejected();
      await expectAsync(claude.interpretSearchQuery('coffee', context)).toBeRejected();
    });
  });

  describe('extractStatementTransactions', () => {
    const twoRows = JSON.stringify([
      { date: '2024-01-15', description: 'AMAZON', amount: 45.99, type: 'expense', currency: 'USD' },
      { date: '2024-01-16', description: 'WALMART', amount: 12.5, type: 'expense', currency: 'USD' },
    ]);

    beforeEach(() => {
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => twoRows, candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: twoRows });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: twoRows }] });
    });

    it('sends byte-identical text from all three providers', async () => {
      // Gemini had no statement extractor at all before this — a statement
      // went through the single-receipt summary and came back as one row.
      await gemini.extractStatementTransactions('img');
      await openai.extractStatementTransactions('img');
      await claude.extractStatementTransactions('img');

      expect(openaiPrompt()).toBe(geminiPrompt());
      expect(claudePrompt()).toBe(geminiPrompt());
    });

    it('returns one row per line item on every provider', async () => {
      for (const rows of [
        await gemini.extractStatementTransactions('img'),
        await openai.extractStatementTransactions('img'),
        await claude.extractStatementTransactions('img'),
      ]) {
        expect(rows.length).toBe(2);
        expect(rows.map(r => r.description)).toEqual(['AMAZON', 'WALMART']);
      }
    });

    it('returns a single row for a single-transaction image on every provider', async () => {
      // Providers disagree about how they treat one image elsewhere, so the
      // ordinary-receipt case is asserted per provider rather than assumed.
      const oneRow = JSON.stringify([
        { date: '2024-01-15', description: 'CAFE', amount: 4.5, type: 'expense', currency: 'USD' },
      ]);
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => oneRow, candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: oneRow });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: oneRow }] });

      expect((await gemini.extractStatementTransactions('img')).length).toBe(1);
      expect((await openai.extractStatementTransactions('img')).length).toBe(1);
      expect((await claude.extractStatementTransactions('img')).length).toBe(1);
    });
  });

  describe('capabilities', () => {
    it('reports OpenAI and Claude as vision-capable without native PDF', () => {
      // Every model in both catalogs is multimodal, but neither accepts a PDF
      // directly — the pages have to be rasterized first.
      expect(openai.capabilities).toEqual({ vision: true, nativePdf: false });
      expect(claude.capabilities).toEqual({ vision: true, nativePdf: false });
    });

    it('reports Gemini as vision-capable when it has a vision model', () => {
      expect(gemini.capabilities).toEqual({ vision: true, nativePdf: true });
    });

    it('reports Gemini as text-only when the vision model is absent', () => {
      // Gemini is the only provider that can be available for text while unable
      // to see an image; every vision method used to fail at the point of use.
      (gemini as unknown as { visionModel: unknown }).visionModel = null;
      expect(gemini.capabilities).toEqual({ vision: false, nativePdf: false });
    });
  });

  describe('the Gemini JSON preamble', () => {
    it('is prepended for Gemini only', async () => {
      const rows = [{ description: 'X', amount: 1, date: new Date('2026-07-01') }];
      geminiTextModel.generateContent.and.resolveTo({
        response: { text: () => '[]', candidates: [{ finishReason: 'STOP' }] },
      });
      openaiClient.responses.create.and.resolveTo({ output_text: '[]' });
      claudeClient.messages.create.and.resolveTo({ content: [{ type: 'text', text: '[]' }] });

      await gemini.categorizeTransactions(rows);
      await openai.categorizeTransactions(rows);
      await claude.categorizeTransactions(rows);

      const geminiRaw = geminiTextModel.generateContent.calls.mostRecent().args[0].contents[0]
        .parts[0].text as string;
      expect(geminiRaw.startsWith(JSON_ONLY_PREAMBLE)).toBeTrue();
      expect(openaiPrompt()).not.toContain(JSON_ONLY_PREAMBLE);
      expect(claudePrompt()).not.toContain(JSON_ONLY_PREAMBLE);
    });
  });
});
