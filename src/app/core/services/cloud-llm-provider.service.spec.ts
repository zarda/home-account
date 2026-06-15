import { TestBed } from '@angular/core/testing';
import { CloudLLMProviderService, AIFeatureType } from './cloud-llm-provider.service';
import { GeminiService, ParsedReceipt, RawTransaction, ExtractedTransaction, CategorizedTransaction, MultiImageExtractedTransaction, CSVColumnMapping } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { AuthService } from './auth.service';
import { Category, Transaction, Budget, MonthlyTotal, LLMProvider, LLMProviderPreferences } from '../../models';
import { createMockUser } from './testing/mock-auth.service';

/**
 * Builds a spy provider that mirrors the public surface the
 * CloudLLMProviderService relies on for one of the underlying LLM services.
 */
function makeProviderSpy(name: string): jasmine.SpyObj<GeminiService> {
  const spy = jasmine.createSpyObj<GeminiService>(name, [
    'isAvailableSignal',
    'isAvailable',
    'isProcessing',
    'lastError',
    'reinitialize',
    'parseReceipt',
    'extractTransactionsFromImage',
    'extractTransactionsFromMultipleImages',
    'extractTransactionsFromPDF',
    'suggestCategory',
    'categorizeTransactions',
    'detectCSVMapping',
    'generateSpendingSummary',
    'getFinancialAdvice',
  ]);
  spy.isAvailableSignal.and.returnValue(false);
  spy.isAvailable.and.returnValue(false);
  spy.isProcessing.and.returnValue(false);
  spy.lastError.and.returnValue(null);
  spy.reinitialize.and.resolveTo(undefined);
  return spy;
}

describe('CloudLLMProviderService', () => {
  let service: CloudLLMProviderService;
  let gemini: jasmine.SpyObj<GeminiService>;
  let openai: jasmine.SpyObj<OpenAIService>;
  let claude: jasmine.SpyObj<ClaudeService>;
  let auth: jasmine.SpyObj<AuthService>;

  const sampleReceipt: ParsedReceipt = {
    merchant: 'Shop', amount: 5, currency: 'USD', date: new Date('2024-01-01'),
    suggestedCategory: 'food_groceries', confidence: 0.85,
  };

  function build(): void {
    TestBed.configureTestingModule({
      providers: [
        CloudLLMProviderService,
        { provide: GeminiService, useValue: gemini },
        { provide: OpenAIService, useValue: openai as unknown as OpenAIService },
        { provide: ClaudeService, useValue: claude as unknown as ClaudeService },
        { provide: AuthService, useValue: auth },
      ],
    });
    service = TestBed.inject(CloudLLMProviderService);
  }

  beforeEach(() => {
    gemini = makeProviderSpy('GeminiService');
    openai = makeProviderSpy('OpenAIService') as unknown as jasmine.SpyObj<OpenAIService>;
    claude = makeProviderSpy('ClaudeService') as unknown as jasmine.SpyObj<ClaudeService>;
    // OpenAI/Claude additionally expose setModel.
    (openai as unknown as { setModel: jasmine.Spy }).setModel = jasmine.createSpy('openaiSetModel');
    (claude as unknown as { setModel: jasmine.Spy }).setModel = jasmine.createSpy('claudeSetModel');

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['currentUser']);
    auth.currentUser.and.returnValue(null);

    build();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ----------------------------------------------------------------
  // Reactive status computeds
  // ----------------------------------------------------------------
  describe('provider status', () => {
    it('reflects the availability signals of each provider', () => {
      gemini.isAvailableSignal.and.returnValue(true);
      expect(service.providerStatus()).toEqual({ gemini: true, openai: false, claude: false });
      expect(service.hasAnyCloudProvider()).toBeTrue();
      expect(service.availableProviders()).toEqual(['gemini']);
    });

    it('reports no provider when all are unavailable', () => {
      expect(service.hasAnyCloudProvider()).toBeFalse();
      expect(service.availableProviders()).toEqual([]);
    });

    it('lists every available provider in order', () => {
      gemini.isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      expect(service.availableProviders()).toEqual(['gemini', 'openai', 'claude']);
    });

    it('isProviderAvailable checks a single provider', () => {
      gemini.isAvailableSignal.and.returnValue(true);
      expect(service.isProviderAvailable('gemini')).toBeTrue();
      expect(service.isProviderAvailable('openai')).toBeFalse();
    });
  });

  // ----------------------------------------------------------------
  // initializeFromUserPreferences
  // ----------------------------------------------------------------
  describe('initializeFromUserPreferences', () => {
    it('initializes each provider that has an API key', () => {
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: {
          ...createMockUser().preferences,
          geminiApiKey: 'g-key',
          openaiApiKey: 'o-key',
          claudeApiKey: 'c-key',
        },
      }));

      service.initializeFromUserPreferences('text-model', 'vision-model');

      expect(gemini.reinitialize).toHaveBeenCalledWith('g-key', 'text-model', 'vision-model');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('o-key');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('c-key');
    });

    it('skips providers without an API key', () => {
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, geminiApiKey: 'g-key' },
      }));

      service.initializeFromUserPreferences();

      expect(gemini.reinitialize).toHaveBeenCalledWith('g-key', undefined, undefined);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize).not.toHaveBeenCalled();
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize).not.toHaveBeenCalled();
    });

    it('warns and does nothing when there is no user', () => {
      auth.currentUser.and.returnValue(null);
      const warn = spyOn(console, 'warn');
      service.initializeFromUserPreferences();
      expect(gemini.reinitialize).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // updateProviderApiKey
  // ----------------------------------------------------------------
  describe('updateProviderApiKey', () => {
    it('reinitializes gemini', async () => {
      await service.updateProviderApiKey('gemini', 'k');
      expect(gemini.reinitialize).toHaveBeenCalledWith('k');
    });

    it('reinitializes openai', async () => {
      await service.updateProviderApiKey('openai', 'k');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('k');
    });

    it('reinitializes claude', async () => {
      await service.updateProviderApiKey('claude', 'k');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('k');
    });

    it('accepts an undefined key (clearing it)', async () => {
      await service.updateProviderApiKey('gemini', undefined);
      expect(gemini.reinitialize).toHaveBeenCalledWith(undefined);
    });
  });

  // ----------------------------------------------------------------
  // model setters and gemini reinitialization
  // ----------------------------------------------------------------
  describe('model configuration', () => {
    it('setOpenAIModel delegates to the OpenAI service', () => {
      service.setOpenAIModel('gpt-x');
      expect((openai as unknown as { setModel: jasmine.Spy }).setModel).toHaveBeenCalledWith('gpt-x');
    });

    it('setClaudeModel delegates to the Claude service', () => {
      service.setClaudeModel('claude-x');
      expect((claude as unknown as { setModel: jasmine.Spy }).setModel).toHaveBeenCalledWith('claude-x');
    });

    it('reinitializeGemini uses the stored gemini API key', () => {
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, geminiApiKey: 'stored-key' },
      }));
      service.reinitializeGemini('t', 'v');
      expect(gemini.reinitialize).toHaveBeenCalledWith('stored-key', 't', 'v');
    });

    it('reinitializeGemini passes undefined when there is no key', () => {
      auth.currentUser.and.returnValue(null);
      service.reinitializeGemini();
      expect(gemini.reinitialize).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  // ----------------------------------------------------------------
  // getPreferredProvider / provider preferences
  // ----------------------------------------------------------------
  describe('getPreferredProvider', () => {
    it('returns defaults when no user preferences exist', () => {
      auth.currentUser.and.returnValue(null);
      expect(service.getPreferredProvider('insights')).toBe('gemini');
    });

    it('returns the user-configured provider per feature', () => {
      const prefs: LLMProviderPreferences = {
        receiptScanning: 'openai', categorization: 'claude', insights: 'gemini',
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: prefs },
      }));
      expect(service.getPreferredProvider('receiptScanning')).toBe('openai');
      expect(service.getPreferredProvider('categorization')).toBe('claude');
      expect(service.getPreferredProvider('insights')).toBe('gemini');
    });
  });

  // ----------------------------------------------------------------
  // testProviderApiKey
  // ----------------------------------------------------------------
  describe('testProviderApiKey', () => {
    it('checks gemini availability', async () => {
      gemini.isAvailable.and.returnValue(true);
      expect(await service.testProviderApiKey('gemini')).toBeTrue();
    });

    it('checks openai availability', async () => {
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailable.and.returnValue(true);
      expect(await service.testProviderApiKey('openai')).toBeTrue();
    });

    it('checks claude availability', async () => {
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailable.and.returnValue(true);
      expect(await service.testProviderApiKey('claude')).toBeTrue();
    });

    it('returns false for an unknown provider', async () => {
      expect(await service.testProviderApiKey('mystery' as LLMProvider)).toBeFalse();
    });
  });

  // ----------------------------------------------------------------
  // Provider selection / fallback behaviour, exercised via public methods
  // ----------------------------------------------------------------
  describe('provider selection and fallback', () => {
    /** Set which providers report as available. */
    function setAvailability(g: boolean, o: boolean, c: boolean): void {
      gemini.isAvailableSignal.and.returnValue(g);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(o);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(c);
    }

    /** Configure user preferences for a feature. */
    function setPreference(feature: AIFeatureType, provider: LLMProvider): void {
      const base = createMockUser().preferences;
      const prefs: LLMProviderPreferences = {
        receiptScanning: 'gemini', categorization: 'gemini', insights: 'gemini',
        [feature]: provider,
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...base, llmProviderPreferences: prefs },
      }));
    }

    it('uses the preferred provider when it is available', async () => {
      setAvailability(false, true, false);
      setPreference('receiptScanning', 'openai');
      (openai as unknown as jasmine.SpyObj<GeminiService>).parseReceipt.and.resolveTo(sampleReceipt);

      await service.parseReceipt('img');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).parseReceipt).toHaveBeenCalled();
      expect(gemini.parseReceipt).not.toHaveBeenCalled();
    });

    it('falls back through gemini -> openai -> claude when preferred is down', async () => {
      // Prefer claude, but only openai is up: fallback order picks openai.
      setAvailability(false, true, false);
      setPreference('receiptScanning', 'claude');
      (openai as unknown as jasmine.SpyObj<GeminiService>).parseReceipt.and.resolveTo(sampleReceipt);

      const result = await service.parseReceipt('img');
      expect(result).toBe(sampleReceipt);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).parseReceipt).toHaveBeenCalled();
    });

    it('falls back to claude when it is the only one available', async () => {
      setAvailability(false, false, true);
      setPreference('receiptScanning', 'gemini');
      (claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt.and.resolveTo(sampleReceipt);

      await service.parseReceipt('img');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt).toHaveBeenCalled();
    });

    it('throws when no provider is available for receipt scanning', async () => {
      setAvailability(false, false, false);
      await expectAsync(service.parseReceipt('img'))
        .toBeRejectedWithError(/No cloud AI provider available for receipt scanning/);
    });
  });

  // ----------------------------------------------------------------
  // Receipt-scanning delegations (each provider branch)
  // ----------------------------------------------------------------
  describe('receipt scanning delegations', () => {
    beforeEach(() => {
      gemini.isAvailableSignal.and.returnValue(true);
      gemini.parseReceipt.and.resolveTo(sampleReceipt);
      gemini.extractTransactionsFromImage.and.resolveTo([]);
      gemini.extractTransactionsFromMultipleImages.and.resolveTo([]);
      gemini.extractTransactionsFromPDF.and.resolveTo([]);
    });

    it('parseReceipt delegates to gemini', async () => {
      const r = await service.parseReceipt('img');
      expect(r).toBe(sampleReceipt);
      expect(gemini.parseReceipt).toHaveBeenCalledWith('img');
    });

    it('parseReceipt delegates to claude when preferred', async () => {
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt.and.resolveTo(sampleReceipt);
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: {
          ...createMockUser().preferences,
          llmProviderPreferences: { receiptScanning: 'claude', categorization: 'gemini', insights: 'gemini' },
        },
      }));
      await service.parseReceipt('img');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt).toHaveBeenCalled();
    });

    it('extractTransactionsFromImage delegates', async () => {
      const extracted: ExtractedTransaction[] = [];
      gemini.extractTransactionsFromImage.and.resolveTo(extracted);
      const r = await service.extractTransactionsFromImage('img');
      expect(r).toBe(extracted);
      expect(gemini.extractTransactionsFromImage).toHaveBeenCalledWith('img');
    });

    it('extractTransactionsFromImage throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.extractTransactionsFromImage('img'))
        .toBeRejectedWithError(/No cloud AI provider available for image extraction/);
    });

    it('extractTransactionsFromMultipleImages delegates', async () => {
      const extracted: MultiImageExtractedTransaction[] = [];
      gemini.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const r = await service.extractTransactionsFromMultipleImages(['a', 'b']);
      expect(r).toBe(extracted);
      expect(gemini.extractTransactionsFromMultipleImages).toHaveBeenCalledWith(['a', 'b']);
    });

    it('extractTransactionsFromMultipleImages throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.extractTransactionsFromMultipleImages(['a']))
        .toBeRejectedWithError(/No cloud AI provider available for multi-image extraction/);
    });

    it('extractTransactionsFromImage delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).extractTransactionsFromImage.and.resolveTo([]);
      await service.extractTransactionsFromImage('img');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).extractTransactionsFromImage).toHaveBeenCalled();
    });

    it('extractTransactionsFromMultipleImages delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).extractTransactionsFromMultipleImages.and.resolveTo([]);
      await service.extractTransactionsFromMultipleImages(['a']);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).extractTransactionsFromMultipleImages).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // PDF extraction (gemini-only with fallbacks)
  // ----------------------------------------------------------------
  describe('extractTransactionsFromPDF', () => {
    const rows: RawTransaction[] = [];

    it('uses gemini directly when gemini is the chosen provider', async () => {
      gemini.isAvailableSignal.and.returnValue(true);
      gemini.extractTransactionsFromPDF.and.resolveTo(rows);
      const r = await service.extractTransactionsFromPDF('pdf');
      expect(r).toBe(rows);
      expect(gemini.extractTransactionsFromPDF).toHaveBeenCalledWith('pdf');
    });

    it('falls back to gemini when another provider is chosen but gemini is available', async () => {
      // openai chosen/available, gemini also available -> PDF still uses gemini.
      gemini.isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: {
          ...createMockUser().preferences,
          llmProviderPreferences: { receiptScanning: 'openai', categorization: 'gemini', insights: 'gemini' },
        },
      }));
      gemini.extractTransactionsFromPDF.and.resolveTo(rows);

      await service.extractTransactionsFromPDF('pdf');
      expect(gemini.extractTransactionsFromPDF).toHaveBeenCalled();
    });

    it('throws when only a non-gemini provider is available', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      await expectAsync(service.extractTransactionsFromPDF('pdf'))
        .toBeRejectedWithError(/PDF extraction is only supported with Gemini/);
    });

    it('throws when no provider is available at all', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.extractTransactionsFromPDF('pdf'))
        .toBeRejectedWithError(/No cloud AI provider available for PDF extraction/);
    });
  });

  // ----------------------------------------------------------------
  // Categorization delegations
  // ----------------------------------------------------------------
  describe('categorization delegations', () => {
    const categories: Category[] = [];

    beforeEach(() => {
      gemini.isAvailableSignal.and.returnValue(true);
      gemini.suggestCategory.and.resolveTo('food_groceries');
      gemini.categorizeTransactions.and.resolveTo([]);
      gemini.detectCSVMapping.and.resolveTo({} as CSVColumnMapping);
    });

    it('suggestCategory delegates to gemini', async () => {
      const r = await service.suggestCategory('milk', categories);
      expect(r).toBe('food_groceries');
      expect(gemini.suggestCategory).toHaveBeenCalledWith('milk', categories);
    });

    it('suggestCategory throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.suggestCategory('milk', categories))
        .toBeRejectedWithError(/No cloud AI provider available for categorization/);
    });

    it('suggestCategory delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).suggestCategory.and.resolveTo('x');
      await service.suggestCategory('milk', categories);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).suggestCategory).toHaveBeenCalled();
    });

    it('categorizeTransactions delegates', async () => {
      const result: CategorizedTransaction[] = [];
      gemini.categorizeTransactions.and.resolveTo(result);
      const r = await service.categorizeTransactions([]);
      expect(r).toBe(result);
    });

    it('categorizeTransactions throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.categorizeTransactions([]))
        .toBeRejectedWithError(/No cloud AI provider available for categorization/);
    });

    it('categorizeTransactions delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).categorizeTransactions.and.resolveTo([]);
      await service.categorizeTransactions([]);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).categorizeTransactions).toHaveBeenCalled();
    });

    it('detectCSVMapping delegates', async () => {
      const mapping = { dateColumn: 'D' } as CSVColumnMapping;
      gemini.detectCSVMapping.and.resolveTo(mapping);
      const r = await service.detectCSVMapping(['D'], [['1']]);
      expect(r).toBe(mapping);
    });

    it('detectCSVMapping throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.detectCSVMapping(['D'], [['1']]))
        .toBeRejectedWithError(/No cloud AI provider available for CSV mapping/);
    });

    it('detectCSVMapping delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).detectCSVMapping.and.resolveTo({} as CSVColumnMapping);
      await service.detectCSVMapping(['D'], [['1']]);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).detectCSVMapping).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Insights delegations
  // ----------------------------------------------------------------
  describe('insights delegations', () => {
    const txns: Transaction[] = [];
    const budgets: Budget[] = [];
    const summary: MonthlyTotal = { income: 1, expense: 1, balance: 0, transactionCount: 0, byCategory: [] };

    beforeEach(() => {
      gemini.isAvailableSignal.and.returnValue(true);
      gemini.generateSpendingSummary.and.resolveTo('summary');
      gemini.getFinancialAdvice.and.resolveTo('advice');
    });

    it('generateSpendingSummary delegates to gemini with all args', async () => {
      const r = await service.generateSpendingSummary(txns, 'June', 'USD', { income: 1, expense: 2 }, budgets, 'ctx');
      expect(r).toBe('summary');
      expect(gemini.generateSpendingSummary).toHaveBeenCalledWith(txns, 'June', 'USD', { income: 1, expense: 2 }, budgets, 'ctx');
    });

    it('generateSpendingSummary throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.generateSpendingSummary(txns, 'June'))
        .toBeRejectedWithError(/No cloud AI provider available for insights/);
    });

    it('generateSpendingSummary delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary.and.resolveTo('o');
      await service.generateSpendingSummary(txns, 'June');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary).toHaveBeenCalled();
    });

    it('generateSpendingSummary delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary.and.resolveTo('c');
      await service.generateSpendingSummary(txns, 'June');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary).toHaveBeenCalled();
    });

    it('getFinancialAdvice delegates to gemini', async () => {
      const r = await service.getFinancialAdvice(summary, 'USD', 'this month');
      expect(r).toBe('advice');
      expect(gemini.getFinancialAdvice).toHaveBeenCalledWith(summary, 'USD', 'this month');
    });

    it('getFinancialAdvice throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.getFinancialAdvice(summary))
        .toBeRejectedWithError(/No cloud AI provider available for insights/);
    });

    it('getFinancialAdvice delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice.and.resolveTo('o');
      await service.getFinancialAdvice(summary);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice).toHaveBeenCalled();
    });

    it('getFinancialAdvice delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice.and.resolveTo('c');
      await service.getFinancialAdvice(summary);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Status and info
  // ----------------------------------------------------------------
  describe('status and info', () => {
    it('isProcessing is true when any provider is processing', () => {
      expect(service.isProcessing()).toBeFalse();
      (claude as unknown as jasmine.SpyObj<GeminiService>).isProcessing.and.returnValue(true);
      expect(service.isProcessing()).toBeTrue();
    });

    it('getLastError returns the first non-null error', () => {
      expect(service.getLastError()).toBeNull();
      (openai as unknown as jasmine.SpyObj<GeminiService>).lastError.and.returnValue('oops');
      expect(service.getLastError()).toBe('oops');
    });

    it('getProviderDisplayName returns a label per provider', () => {
      expect(service.getProviderDisplayName('gemini')).toBe('Google Gemini');
      expect(service.getProviderDisplayName('openai')).toBe('OpenAI (ChatGPT)');
      expect(service.getProviderDisplayName('claude')).toBe('Anthropic Claude');
    });

    it('getProviderApiKeyUrl returns a URL per provider', () => {
      expect(service.getProviderApiKeyUrl('gemini')).toContain('aistudio.google.com');
      expect(service.getProviderApiKeyUrl('openai')).toContain('platform.openai.com');
      expect(service.getProviderApiKeyUrl('claude')).toContain('console.anthropic.com');
    });
  });
});
