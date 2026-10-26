import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CloudLLMProviderService, AIFeatureType } from './cloud-llm-provider.service';
import { GeminiService, ParsedReceipt, CategorizedTransaction, MultiImageExtractedTransaction, CSVColumnMapping } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { AuthService } from './auth.service';
import { ProviderKeyService } from './provider-key.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import {
  Category, Transaction, Budget, MonthlyTotal, LLMProvider, LLMProviderPreferences, ProviderSecrets,
  currencyDecimalPlaces,
} from '../../models';
import { ProviderCapabilities } from './llm-provider.interface';
import { createMockUser } from './testing/mock-auth.service';
import { environment } from '../../../environments/environment';

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
    'extractTransactionsFromMultipleImages',
    'suggestCategory',
    'categorizeTransactions',
    'detectCSVMapping',
    'interpretSearchQuery',
    'generateSpendingSummary',
    'getFinancialAdvice',
    'translateText',
    'translateReceiptImage',
  ]);
  spy.isAvailableSignal.and.returnValue(false);
  spy.isAvailable.and.returnValue(false);
  spy.isProcessing.and.returnValue(false);
  spy.lastError.and.returnValue(null);
  spy.reinitialize.and.resolveTo(undefined);
  (spy as unknown as { capabilities: ProviderCapabilities }).capabilities = {
    vision: true,
  };
  return spy;
}

/** A promise the case holds open, then releases when it chooses. */
interface Held<T> {
  promise: Promise<T>;
  release(value: T): void;
}

function hold<T>(): Held<T> {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}

/** One macrotask, so every continuation already due has run. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** The keys the departing account's bring-up read. */
const A_KEYS: ProviderSecrets = { gemini: 'gA', openai: 'oA', claude: 'cA' };

describe('CloudLLMProviderService', () => {
  let service: CloudLLMProviderService;
  let gemini: jasmine.SpyObj<GeminiService>;
  let openai: jasmine.SpyObj<OpenAIService>;
  let claude: jasmine.SpyObj<ClaudeService>;
  let auth: jasmine.SpyObj<AuthService>;
  let providerKeys: jasmine.SpyObj<ProviderKeyService>;
  let keyReadFailed: WritableSignal<boolean>;

  const sampleReceipt: ParsedReceipt = {
    merchant: 'Shop', amount: 5, type: 'expense', currency: 'USD', date: new Date('2024-01-01'),
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
        { provide: ProviderKeyService, useValue: providerKeys },
      ],
    });
    service = TestBed.inject(CloudLLMProviderService);
  }

  beforeEach(() => {
    gemini = makeProviderSpy('GeminiService');
    openai = makeProviderSpy('OpenAIService') as unknown as jasmine.SpyObj<OpenAIService>;
    claude = makeProviderSpy('ClaudeService') as unknown as jasmine.SpyObj<ClaudeService>;
    // Only Gemini has a clear() distinct from reinitialize(): it is the one
    // provider whose reinitialize falls back to the environment key.
    (gemini as unknown as { clear: jasmine.Spy }).clear = jasmine.createSpy('geminiClear');
    // OpenAI/Claude additionally expose setModel.
    (openai as unknown as { setModel: jasmine.Spy }).setModel = jasmine.createSpy('openaiSetModel');
    (claude as unknown as { setModel: jasmine.Spy }).setModel = jasmine.createSpy('claudeSetModel');

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['currentUser']);
    auth.currentUser.and.returnValue(null);

    keyReadFailed = signal(false);
    providerKeys = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['resolve', 'getKey', 'setKey', 'clearCache'],
      { loadFailed: keyReadFailed }
    );
    providerKeys.resolve.and.resolveTo({});
    providerKeys.getKey.and.resolveTo(undefined);
    providerKeys.setKey.and.resolveTo(undefined);

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

    it('hasVisionProvider is false when the only configured provider cannot see', () => {
      // Gemini can be configured for text with no vision model, which is not
      // the same state as no provider being configured at all.
      gemini.isAvailableSignal.and.returnValue(true);
      (gemini as unknown as { capabilities: ProviderCapabilities }).capabilities = {
        vision: false,
      };
      expect(service.hasAnyCloudProvider()).toBeTrue();
      expect(service.hasVisionProvider()).toBeFalse();
    });
  });

  // ----------------------------------------------------------------
  // initializeProviders
  // ----------------------------------------------------------------
  describe('initializeProviders', () => {
    it('initializes each provider that has an API key', async () => {
      providerKeys.resolve.and.resolveTo({ gemini: 'g-key', openai: 'o-key', claude: 'c-key' });

      await service.initializeProviders('text-model', 'vision-model');

      expect(gemini.reinitialize).toHaveBeenCalledWith('g-key', 'text-model', 'vision-model');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('o-key');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize).toHaveBeenCalledWith('c-key');
    });

    // These two used to assert that a provider without a key was skipped,
    // which is the defect: signing in as an account with no key of its own
    // left the previous account's clients standing and its keys in use.
    it('clears providers the account has no key for', async () => {
      providerKeys.resolve.and.resolveTo({ gemini: 'g-key' });

      await service.initializeProviders();

      expect(gemini.reinitialize).toHaveBeenCalledWith('g-key', undefined, undefined);
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith(undefined);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith(undefined);
    });

    it('clears every provider when the account has no keys at all', async () => {
      providerKeys.resolve.and.resolveTo({});

      await service.initializeProviders();

      // clear(), not reinitialize(undefined) — the latter re-arms Gemini from
      // the environment key the build ships.
      expect((gemini as unknown as { clear: jasmine.Spy }).clear).toHaveBeenCalled();
      expect(gemini.reinitialize).not.toHaveBeenCalled();
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith(undefined);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith(undefined);
    });

    // The keys never travel through the user document any more.
    it('reads keys from the secrets store, not from preferences', async () => {
      providerKeys.resolve.and.resolveTo({ gemini: 'g-key' });

      await service.initializeProviders();

      expect(providerKeys.resolve).toHaveBeenCalled();
      expect(auth.currentUser).not.toHaveBeenCalled();
    });

    // Three `[CloudLLMProvider]` lines used to announce each provider as it
    // came up — and the two `if (openai)` / `if (claude)` blocks existed only
    // to hold them, since the reinitialize call beneath ran either way. ADR
    // 0123's rule took the lines out and no-console keeps them out; the
    // spies above are what says a provider was initialized.
    it('brings every provider up without narrating it', async () => {
      const logSpy = spyOn(console, 'log');
      providerKeys.resolve.and.resolveTo({ gemini: 'g-key', openai: 'o-key', claude: 'c-key' });

      await service.initializeProviders('text-model', 'vision-model');

      expect(logSpy).not.toHaveBeenCalled();
    });

    // The strategy's readiness wait reads the keys once more when the bring-up
    // it waited on could not read them. The key service never rejects a read
    // that failed: it answers {} and sets its flag, so the flag read as this
    // bring-up's read lands is that read's own outcome.
    it('reports a key read that failed', async () => {
      providerKeys.resolve.and.callFake(async () => {
        keyReadFailed.set(true);
        return {};
      });

      expect(await service.initializeProviders()).toEqual({ keyReadFailed: true });
    });

    it('reports a key read that landed, after an earlier one had failed', async () => {
      keyReadFailed.set(true);
      providerKeys.resolve.and.callFake(async () => {
        keyReadFailed.set(false);
        return { gemini: 'g-key' };
      });

      expect(await service.initializeProviders()).toEqual({ keyReadFailed: false });
      expect(gemini.reinitialize).toHaveBeenCalledOnceWith('g-key', undefined, undefined);
    });
  });

  describe('resetProviders', () => {
    it('tears down every client and forgets the cached keys', async () => {
      await service.resetProviders();

      expect((gemini as unknown as { clear: jasmine.Spy }).clear).toHaveBeenCalled();
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith();
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize)
        .toHaveBeenCalledWith();
      expect(providerKeys.clearCache).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // A bring-up superseded by a reset or a newer bring-up
  // ----------------------------------------------------------------
  // A sign-out's reset, or a newer bring-up, can arrive while a bring-up is
  // still waiting on the key read or on a provider. What it read belongs to the
  // account it started for, so it makes no further arm call. Only keyed calls
  // are held: the reset awaits OpenAI's and Claude's keyless reinitialize().
  describe('a bring-up superseded by a reset or a newer bring-up', () => {
    const geminiClear = () => (gemini as unknown as { clear: jasmine.Spy }).clear;
    const openaiArm = () => (openai as unknown as jasmine.SpyObj<GeminiService>).reinitialize;
    const claudeArm = () => (claude as unknown as jasmine.SpyObj<GeminiService>).reinitialize;

    /** Every key a provider was asked to arm, the keyless calls left out. */
    function armedKeys(): unknown[] {
      return [gemini.reinitialize, openaiArm(), claudeArm()]
        .flatMap(spy => spy.calls.allArgs().map(args => args[0]))
        .filter(key => key !== undefined);
    }

    /** Forget the reset's own calls, so what follows is what came after it. */
    function forgetCalls(): void {
      gemini.reinitialize.calls.reset();
      openaiArm().calls.reset();
      claudeArm().calls.reset();
      geminiClear().calls.reset();
    }

    it('arms nothing when the key read lands after a reset', async () => {
      const read = hold<ProviderSecrets>();
      providerKeys.resolve.and.returnValue(read.promise);

      const bringUp = service.initializeProviders();
      try {
        await service.resetProviders();
        forgetCalls();
      } finally {
        read.release(A_KEYS);
      }
      await expectAsync(bringUp).toBeResolved();

      expect(armedKeys()).withContext('keys armed after the reset').toEqual([]);
      // Nor cleared: by now a provider may hold the next account's own arm,
      // and a keyless call would take it down (armedKeys() leaves those out).
      expect(geminiClear()).not.toHaveBeenCalled();
      expect(gemini.reinitialize).not.toHaveBeenCalled();
      expect(openaiArm()).not.toHaveBeenCalled();
      expect(claudeArm()).not.toHaveBeenCalled();

      // The positive proof: a bring-up nothing supersedes arms every key read.
      providerKeys.resolve.and.resolveTo(A_KEYS);
      await service.initializeProviders();
      expect(armedKeys()).toEqual(['gA', 'oA', 'cA']);
    });

    it('stops after Gemini when a reset lands while Gemini arms', async () => {
      providerKeys.resolve.and.resolveTo(A_KEYS);
      const geminiArming = hold<void>();
      gemini.reinitialize.and.callFake((key?: string) => key ? geminiArming.promise : Promise.resolve());

      const bringUp = service.initializeProviders();
      try {
        await settle();
        expect(gemini.reinitialize).withContext('the bring-up reached Gemini')
          .toHaveBeenCalledWith('gA', undefined, undefined);
        await service.resetProviders();
        forgetCalls();
      } finally {
        geminiArming.release(undefined);
      }
      await expectAsync(bringUp).toBeResolved();

      // No call at all, keyed or keyless: a keyless one would clear the
      // next account's arm.
      expect(openaiArm()).not.toHaveBeenCalled();
      expect(claudeArm()).not.toHaveBeenCalled();
      expect(gemini.reinitialize).not.toHaveBeenCalled();
      expect(geminiClear()).not.toHaveBeenCalled();
    });

    it('stops after OpenAI when a reset lands while OpenAI arms', async () => {
      providerKeys.resolve.and.resolveTo(A_KEYS);
      const openaiArming = hold<void>();
      openaiArm().and.callFake((key?: string) => key ? openaiArming.promise : Promise.resolve());

      const bringUp = service.initializeProviders();
      try {
        await settle();
        expect(openaiArm()).withContext('the bring-up reached OpenAI').toHaveBeenCalledWith('oA');
        await service.resetProviders();
        forgetCalls();
      } finally {
        openaiArming.release(undefined);
      }
      await expectAsync(bringUp).toBeResolved();

      // No call at all, keyed or keyless: a keyless one would clear the
      // next account's arm, Gemini's included, which this bring-up armed.
      expect(claudeArm()).not.toHaveBeenCalled();
      expect(openaiArm()).not.toHaveBeenCalled();
      expect(gemini.reinitialize).not.toHaveBeenCalled();
      expect(geminiClear()).not.toHaveBeenCalled();
    });

    it("arms only the next account's key when the previous read lands after it", async () => {
      const readA = hold<ProviderSecrets>();
      providerKeys.resolve.and.returnValues(readA.promise, Promise.resolve({ openai: 'oB' }));

      const bringUpA = service.initializeProviders();
      try {
        await service.resetProviders();
        forgetCalls();
        await service.initializeProviders();
        expect(openaiArm()).withContext("the next account's bring-up").toHaveBeenCalledWith('oB');
      } finally {
        readA.release(A_KEYS);
      }
      await expectAsync(bringUpA).toBeResolved();

      expect(openaiArm().calls.mostRecent().args).toEqual(['oB']);
      expect(armedKeys()).withContext('every key armed').toEqual(['oB']);
    });

    it('lets only the newer of two bring-ups over one key read arm', async () => {
      const read = hold<ProviderSecrets>();
      providerKeys.resolve.and.returnValue(read.promise);

      const first = service.initializeProviders();
      const second = service.initializeProviders();
      try {
        await settle();
        expect(providerKeys.resolve).toHaveBeenCalledTimes(2);
      } finally {
        read.release(A_KEYS);
      }
      await Promise.all([first, second]);

      expect(gemini.reinitialize).toHaveBeenCalledOnceWith('gA', undefined, undefined);
      expect(openaiArm()).toHaveBeenCalledOnceWith('oA');
      expect(claudeArm()).toHaveBeenCalledOnceWith('cA');
      expect(geminiClear()).not.toHaveBeenCalled();
    });

    it('reports its own failed read when a newer bring-up over the same read supersedes it', async () => {
      const read = hold<ProviderSecrets>();
      providerKeys.resolve.and.callFake(async () => {
        const keys = await read.promise;
        keyReadFailed.set(true);
        return keys;
      });

      const first = service.initializeProviders();
      const second = service.initializeProviders();
      try {
        await settle();
        expect(providerKeys.resolve).toHaveBeenCalledTimes(2);
      } finally {
        read.release({});
      }

      // The first returns where it finds the generation moved.
      expect(await first).toEqual({ keyReadFailed: true });
      expect(await second).toEqual({ keyReadFailed: true });
      expect(geminiClear()).toHaveBeenCalledTimes(1);
    });

    it('arms no Gemini model switch whose key read lands after a reset', async () => {
      const read = hold<string | undefined>();
      providerKeys.getKey.and.returnValue(read.promise);

      const switching = service.reinitializeGemini('t', 'v');
      try {
        await service.resetProviders();
        forgetCalls();
      } finally {
        read.release('gA');
      }
      await expectAsync(switching).toBeResolved();

      expect(providerKeys.getKey).toHaveBeenCalledOnceWith('gemini');
      expect(gemini.reinitialize).not.toHaveBeenCalled();

      // The positive proof: the same switch, with nothing after it, arms.
      providerKeys.getKey.and.resolveTo('gA');
      await service.reinitializeGemini('t', 'v');
      expect(gemini.reinitialize).toHaveBeenCalledOnceWith('gA', 't', 'v');
    });

    // A model switch and a typed key are not bring-ups: neither may stop the
    // one in flight, or OpenAI and Claude would never come up.
    it('a Gemini model switch during a bring-up does not stop it', async () => {
      const read = hold<ProviderSecrets>();
      providerKeys.resolve.and.returnValue(read.promise);
      providerKeys.getKey.and.resolveTo('gA');

      const bringUp = service.initializeProviders();
      try {
        await service.reinitializeGemini();
        expect(gemini.reinitialize).withContext('the switch').toHaveBeenCalledWith('gA', undefined, undefined);
      } finally {
        read.release(A_KEYS);
      }
      await bringUp;

      expect(claudeArm()).toHaveBeenCalledWith('cA');
    });

    it('a typed key during a bring-up does not stop it', async () => {
      const read = hold<ProviderSecrets>();
      providerKeys.resolve.and.returnValue(read.promise);

      const bringUp = service.initializeProviders();
      try {
        await service.updateProviderApiKey('openai', 'typed');
        expect(openaiArm()).withContext('the typed key').toHaveBeenCalledWith('typed');
      } finally {
        read.release(A_KEYS);
      }
      await bringUp;

      expect(claudeArm()).toHaveBeenCalledWith('cA');
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

    // clear(), not reinitialize(undefined) — the latter re-arms Gemini from the
    // environment key the build ships, so a cleared key would leave it up.
    it('clears gemini for an undefined key rather than re-arming it', async () => {
      await service.updateProviderApiKey('gemini', undefined);
      expect((gemini as unknown as { clear: jasmine.Spy }).clear).toHaveBeenCalledTimes(1);
      expect(gemini.reinitialize).not.toHaveBeenCalled();
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

    it('reinitializeGemini uses the stored gemini API key', async () => {
      providerKeys.getKey.and.resolveTo('stored-key');
      await service.reinitializeGemini('t', 'v');
      expect(gemini.reinitialize).toHaveBeenCalledWith('stored-key', 't', 'v');
    });

    it('reinitializeGemini clears Gemini when there is no stored key', async () => {
      providerKeys.getKey.and.resolveTo(undefined);
      await service.reinitializeGemini('t', 'v');
      expect((gemini as unknown as { clear: jasmine.Spy }).clear).toHaveBeenCalledTimes(1);
      expect(gemini.reinitialize).not.toHaveBeenCalled();
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
        receiptScanning: 'openai', categorization: 'claude', insights: 'gemini', search: 'claude',
        translation: 'openai',
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: prefs },
      }));
      expect(service.getPreferredProvider('receiptScanning')).toBe('openai');
      expect(service.getPreferredProvider('categorization')).toBe('claude');
      expect(service.getPreferredProvider('insights')).toBe('gemini');
      expect(service.getPreferredProvider('search')).toBe('claude');
    });

    it('merges defaults for stored preference objects that predate a feature', () => {
      // A user object saved before the search feature existed has no
      // `search` key; the default must fill it in.
      const legacyPrefs = {
        receiptScanning: 'openai', categorization: 'openai', insights: 'openai',
      } as LLMProviderPreferences;
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: legacyPrefs },
      }));
      expect(service.getPreferredProvider('search')).toBe('gemini');
      expect(service.getPreferredProvider('translation')).toBe('gemini');
      expect(service.getPreferredProvider('insights')).toBe('openai');
    });
  });

  // ----------------------------------------------------------------
  // resolveVisionProvider
  // ----------------------------------------------------------------
  describe('resolveVisionProvider', () => {
    it('skips a preferred text-only provider for a vision-capable fallback', () => {
      const prefs: LLMProviderPreferences = {
        receiptScanning: 'gemini', categorization: 'gemini', insights: 'gemini', search: 'gemini',
        translation: 'gemini',
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: prefs },
      }));
      gemini.isAvailableSignal.and.returnValue(true);
      (gemini as unknown as { capabilities: ProviderCapabilities }).capabilities = {
        vision: false,
      };
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);

      expect(service.resolveVisionProvider('translation')).toBe('openai');
    });
  });

  // ----------------------------------------------------------------
  // Search delegation
  // ----------------------------------------------------------------
  describe('interpretSearchQuery', () => {
    const context = { today: '2026-07-24', baseCurrency: 'USD', categories: [], goals: [], budgets: [] };

    it('routes to the preferred provider', async () => {
      gemini.isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      const prefs: LLMProviderPreferences = {
        receiptScanning: 'gemini', categorization: 'gemini', insights: 'gemini', search: 'claude',
        translation: 'gemini',
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: prefs },
      }));
      const intent = { kind: 'filter' as const, filters: {} };
      (claude as unknown as jasmine.SpyObj<GeminiService>).interpretSearchQuery.and.resolveTo(intent);

      const result = await service.interpretSearchQuery('coffee', context);

      expect(result).toBe(intent);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).interpretSearchQuery)
        .toHaveBeenCalledWith('coffee', context);
      expect(gemini.interpretSearchQuery).not.toHaveBeenCalled();
    });

    it('falls back through the provider order when the preferred one is down', async () => {
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      const intent = { kind: 'filter' as const, filters: {} };
      (openai as unknown as jasmine.SpyObj<GeminiService>).interpretSearchQuery.and.resolveTo(intent);

      const result = await service.interpretSearchQuery('coffee', context);
      expect(result).toBe(intent);
    });

    it('throws when no provider is available', async () => {
      await expectAsync(service.interpretSearchQuery('coffee', context))
        .toBeRejectedWithError(/No cloud AI provider available for search/);
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
        receiptScanning: 'gemini', categorization: 'gemini', insights: 'gemini', search: 'gemini',
        translation: 'gemini',
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
        .toBeRejectedWithError(/No cloud AI provider available for receiptScanning/);
    });
  });

  // ----------------------------------------------------------------
  // Receipt-scanning delegations (each provider branch)
  // ----------------------------------------------------------------
  describe('receipt scanning delegations', () => {
    beforeEach(() => {
      gemini.isAvailableSignal.and.returnValue(true);
      gemini.parseReceipt.and.resolveTo(sampleReceipt);
      gemini.extractTransactionsFromMultipleImages.and.resolveTo([]);
    });

    it('parseReceipt delegates to gemini', async () => {
      const r = await service.parseReceipt('img');
      expect(r).toBe(sampleReceipt);
      expect(gemini.parseReceipt).toHaveBeenCalledWith('img', undefined);
    });

    it('hands the caller\'s cancellation to the provider', async () => {
      // Without this the import timeout has nothing to abort, and a request
      // the user has stopped waiting for keeps uploading on their data plan.
      const { signal } = new AbortController();

      await service.parseReceipt('img', { signal });

      expect(gemini.parseReceipt).toHaveBeenCalledWith('img', { signal });
    });

    it('parseReceipt delegates to claude when preferred', async () => {
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt.and.resolveTo(sampleReceipt);
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: {
          ...createMockUser().preferences,
          llmProviderPreferences: { receiptScanning: 'claude', categorization: 'gemini', insights: 'gemini', search: 'gemini', translation: 'gemini' },
        },
      }));
      await service.parseReceipt('img');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).parseReceipt).toHaveBeenCalled();
    });

    it('extractTransactionsFromMultipleImages delegates', async () => {
      const extracted: MultiImageExtractedTransaction[] = [];
      gemini.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const r = await service.extractTransactionsFromMultipleImages(['a', 'b']);
      expect(r).toBe(extracted);
      expect(gemini.extractTransactionsFromMultipleImages).toHaveBeenCalledWith(
        ['a', 'b'],
        undefined
      );
    });

    it('extractTransactionsFromMultipleImages carries the cancellation through', async () => {
      const { signal } = new AbortController();

      await service.extractTransactionsFromMultipleImages(['a', 'b'], { signal });

      expect(gemini.extractTransactionsFromMultipleImages).toHaveBeenCalledWith(['a', 'b'], {
        signal,
      });
    });

    it('extractTransactionsFromMultipleImages throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.extractTransactionsFromMultipleImages(['a']))
        .toBeRejectedWithError(/No cloud AI provider available for receiptScanning/);
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
        .toBeRejectedWithError(/No cloud AI provider available for categorization/);
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
      const r = await service.generateSpendingSummary(txns, 'June', 'USD', { income: 1, expense: 2 }, budgets, [], 'ctx');
      expect(r).toBe('summary');
      expect(gemini.generateSpendingSummary).toHaveBeenCalledWith(txns, 'June', 'USD', { income: 1, expense: 2 }, budgets, [], 'ctx');
    });

    it('generateSpendingSummary throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.generateSpendingSummary(txns, 'June', 'USD'))
        .toBeRejectedWithError(/No cloud AI provider available for insights/);
    });

    it('generateSpendingSummary delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary.and.resolveTo('o');
      await service.generateSpendingSummary(txns, 'June', 'USD');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary).toHaveBeenCalled();
    });

    it('generateSpendingSummary delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary.and.resolveTo('c');
      await service.generateSpendingSummary(txns, 'June', 'USD');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).generateSpendingSummary).toHaveBeenCalled();
    });

    it('getFinancialAdvice delegates to gemini', async () => {
      const r = await service.getFinancialAdvice(summary, 'USD', 'this month');
      expect(r).toBe('advice');
      expect(gemini.getFinancialAdvice).toHaveBeenCalledWith(summary, 'USD', 'this month');
    });

    it('getFinancialAdvice throws when no provider', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      await expectAsync(service.getFinancialAdvice(summary, 'USD'))
        .toBeRejectedWithError(/No cloud AI provider available for insights/);
    });

    it('getFinancialAdvice delegates to openai when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice.and.resolveTo('o');
      await service.getFinancialAdvice(summary, 'USD');
      expect((openai as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice).toHaveBeenCalled();
    });

    it('getFinancialAdvice delegates to claude when preferred', async () => {
      gemini.isAvailableSignal.and.returnValue(false);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice.and.resolveTo('c');
      await service.getFinancialAdvice(summary, 'USD');
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).getFinancialAdvice).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Translation delegation
  // ----------------------------------------------------------------
  describe('translateText', () => {
    const translated = { text: 'Rice ball 150', sourceLanguage: 'Japanese' };

    it('routes to the provider preferred for translation', async () => {
      gemini.isAvailableSignal.and.returnValue(true);
      (claude as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      const prefs: LLMProviderPreferences = {
        receiptScanning: 'gemini', categorization: 'gemini', insights: 'gemini', search: 'gemini',
        translation: 'claude',
      };
      auth.currentUser.and.returnValue(createMockUser('u', {
        preferences: { ...createMockUser().preferences, llmProviderPreferences: prefs },
      }));
      (claude as unknown as jasmine.SpyObj<GeminiService>).translateText.and.resolveTo(translated);

      const result = await service.translateText('おにぎり 150');

      expect(result).toBe(translated);
      expect((claude as unknown as jasmine.SpyObj<GeminiService>).translateText)
        .toHaveBeenCalledWith('おにぎり 150');
      expect(gemini.translateText).not.toHaveBeenCalled();
    });

    it('falls back through the provider order when the preferred one is down', async () => {
      (openai as unknown as jasmine.SpyObj<GeminiService>).isAvailableSignal.and.returnValue(true);
      (openai as unknown as jasmine.SpyObj<GeminiService>).translateText.and.resolveTo(translated);

      expect(await service.translateText('おにぎり 150')).toBe(translated);
    });

    it('throws when no provider is available', async () => {
      await expectAsync(service.translateText('おにぎり 150'))
        .toBeRejectedWithError(/No cloud AI provider available for translation/);
    });
  });

  describe('translateReceiptImage', () => {
    it('throws the vision-gate sentence when nothing can see', async () => {
      // Available but text-only: proves the vision gate itself, not the
      // separate "no provider configured" path resolve() already covers.
      gemini.isAvailableSignal.and.returnValue(true);
      (gemini as unknown as { capabilities: ProviderCapabilities }).capabilities = {
        vision: false,
      };

      await expectAsync(service.translateReceiptImage('img')).toBeRejectedWithError(
        'Translating a receipt image needs a vision-capable provider'
      );
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

/**
 * The same supersession over the real provider services, so the façade's
 * checks are proved together with each provider's own. Only the SDK modules
 * are fakes, handed in through each provider's loadSdk seam; none of them has
 * a transport, so a client built here can send nothing.
 */
describe('CloudLLMProviderService over the real providers', () => {
  let facade: CloudLLMProviderService;
  let gemini: GeminiService;
  let openai: OpenAIService;
  let claude: ClaudeService;
  let providerKeys: jasmine.SpyObj<ProviderKeyService>;

  // A real GeminiService arms from the build's environment key when it has no
  // other, and the local (gitignored) environment may carry a real one. Blank
  // it for the whole describe, as gemini.service.spec.ts does.
  const env = environment as { geminiApiKey?: string };
  let savedGeminiApiKey: string | undefined;
  let hadGeminiApiKey = false;

  beforeAll(() => {
    hadGeminiApiKey = 'geminiApiKey' in env;
    savedGeminiApiKey = env.geminiApiKey;
    delete env.geminiApiKey;
  });

  afterAll(() => {
    if (hadGeminiApiKey) {
      env.geminiApiKey = savedGeminiApiKey;
    }
  });

  /** Every key a fake client was built with, in order. */
  let built: string[];
  let loads: { gemini: jasmine.Spy; openai: jasmine.Spy; claude: jasmine.Spy };
  // One gate over every provider's import. A case that needs later imports to
  // land straight away swaps in an open one.
  let gate: Promise<void>;
  let openGate: () => void;

  beforeEach(() => {
    const categoryService = jasmine.createSpyObj<CategoryService>('CategoryService', ['categories']);
    const currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', [
      'convert',
      'formatAmount',
      'amountInBase',
    ]);
    currencyService.formatAmount.and.callFake(
      (amount: number, code: string) => amount.toFixed(currencyDecimalPlaces(code)));
    const translationService = jasmine.createSpyObj<TranslationService>('TranslationService', [
      't',
      'currentLocale',
    ]);
    categoryService.categories.and.returnValue([]);
    currencyService.convert.and.callFake((amount: number) => amount);
    currencyService.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    translationService.t.and.callFake((key: string) => key);
    translationService.currentLocale.and.returnValue('en');

    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['currentUser']);
    auth.currentUser.and.returnValue(null);

    providerKeys = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['resolve', 'getKey', 'setKey', 'clearCache'],
      { loadFailed: signal(false) }
    );
    providerKeys.resolve.and.resolveTo({});
    providerKeys.getKey.and.resolveTo(undefined);
    providerKeys.setKey.and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        CloudLLMProviderService,
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: AuthService, useValue: auth },
        { provide: ProviderKeyService, useValue: providerKeys },
      ],
    });

    facade = TestBed.inject(CloudLLMProviderService);
    gemini = TestBed.inject(GeminiService);
    openai = TestBed.inject(OpenAIService);
    claude = TestBed.inject(ClaudeService);

    built = [];
    const model = { generateContent: jasmine.createSpy('generateContent') };
    class FakeGoogleGenerativeAI {
      readonly apiKey: string;
      constructor(key: string) {
        this.apiKey = key;
        built.push(key);
      }
      getGenerativeModel(): typeof model { return model; }
    }
    // OpenAI and Anthropic are both built from an options object.
    class FakeClient {
      readonly apiKey: string;
      constructor(opts: { apiKey: string }) {
        this.apiKey = opts.apiKey;
        built.push(opts.apiKey);
      }
    }

    gate = new Promise<void>(resolve => { openGate = resolve; });
    // Reads `gate` at call time, so a swapped-in gate serves later imports.
    const through = (module: unknown) => () => gate.then(() => module);
    const seam = (s: object) => s as unknown as { loadSdk(): Promise<unknown> };
    loads = {
      gemini: spyOn(seam(gemini), 'loadSdk').and.callFake(through({ GoogleGenerativeAI: FakeGoogleGenerativeAI })),
      openai: spyOn(seam(openai), 'loadSdk').and.callFake(through({ default: FakeClient })),
      claude: spyOn(seam(claude), 'loadSdk').and.callFake(through({ default: FakeClient })),
    };
  });

  afterEach(() => openGate());

  const keyOf = (s: object) => (s as unknown as { currentApiKey: string | null }).currentApiKey;

  it('leaves every provider down when a reset lands while Gemini imports', async () => {
    providerKeys.resolve.and.resolveTo(A_KEYS);

    const bringUp = facade.initializeProviders();
    try {
      await settle();
      expect(loads.gemini).withContext("the bring-up parked in Gemini's import").toHaveBeenCalledTimes(1);
      await facade.resetProviders();
    } finally {
      openGate();
    }
    await expectAsync(bringUp).toBeResolved();
    await expectAsync(loads.gemini.calls.mostRecent().returnValue).toBeResolved();

    expect(gemini.isAvailable()).withContext('Gemini').toBeFalse();
    expect(openai.isAvailable()).withContext('OpenAI').toBeFalse();
    expect(claude.isAvailable()).withContext('Claude').toBeFalse();
    expect(facade.availableProviders()).toEqual([]);
    expect(built).withContext('clients built').toEqual([]);

    // The positive proof: the same imports, asked for by a bring-up nothing
    // supersedes, arm all three.
    await facade.initializeProviders();
    expect(facade.availableProviders()).toEqual(['gemini', 'openai', 'claude']);
    expect(built).toEqual(['gA', 'oA', 'cA']);
  });

  it("arms only the next account's key when it comes up while the previous one is parked", async () => {
    providerKeys.resolve.and.returnValues(Promise.resolve(A_KEYS), Promise.resolve({ openai: 'oB' }));

    const bringUpA = facade.initializeProviders();
    try {
      await settle();
      expect(loads.gemini).withContext("the bring-up parked in Gemini's import").toHaveBeenCalledTimes(1);
      await facade.resetProviders();
      // The next account's imports go through a gate of their own, already open.
      gate = Promise.resolve();
      await facade.initializeProviders();
      expect(openai.isAvailable()).withContext("the next account's OpenAI").toBeTrue();
    } finally {
      openGate();
    }
    await expectAsync(bringUpA).toBeResolved();

    expect((openai as unknown as { client: { apiKey: string } | null }).client?.apiKey).toBe('oB');
    expect(keyOf(openai)).toBe('oB');
    expect(gemini.isAvailable()).withContext('Gemini').toBeFalse();
    expect(claude.isAvailable()).withContext('Claude').toBeFalse();
    expect(facade.availableProviders()).toEqual(['openai']);
    expect(built).withContext('clients built').toEqual(['oB']);
  });

  // With no Gemini key the bring-up parks in OpenAI's import instead, and
  // OpenAI's own check keeps OpenAI down. Claude is the façade's to stop.
  it("leaves Claude down when a reset lands while OpenAI imports", async () => {
    providerKeys.resolve.and.resolveTo({ openai: 'oA', claude: 'cA' });

    const bringUp = facade.initializeProviders();
    try {
      await settle();
      expect(loads.openai).withContext("the bring-up parked in OpenAI's import").toHaveBeenCalledTimes(1);
      await facade.resetProviders();
    } finally {
      openGate();
    }
    await expectAsync(bringUp).toBeResolved();
    await expectAsync(loads.openai.calls.mostRecent().returnValue).toBeResolved();

    expect(claude.isAvailable()).withContext('Claude').toBeFalse();
    expect(loads.claude).withContext("Claude's import").not.toHaveBeenCalled();
    expect(keyOf(claude)).withContext("Claude's key").toBeNull();
    expect(openai.isAvailable()).withContext('OpenAI').toBeFalse();
    expect(facade.availableProviders()).toEqual([]);
    expect(built).withContext('clients built').toEqual([]);
  });

  // Without a key of its own, Gemini must stay down, not come up on the key the
  // build ships: initializeProviders, a model switch and a cleared key all
  // answer "no key" the same way. The literal is set inside each case and
  // deleted after it; the describe's own blanking stays in force around it.
  describe('with a build that ships its own Gemini key', () => {
    const ENV_KEY = 'env-key-from-build';

    afterEach(() => {
      delete env.geminiApiKey;
    });

    /** Down everywhere a caller can read it, and never built on the environment key. */
    function expectGeminiDown(): void {
      expect(gemini.isAvailable()).withContext('isAvailable').toBeFalse();
      expect(gemini.isAvailableSignal()).withContext('the signal').toBeFalse();
      expect(facade.providerStatus().gemini).withContext('the façade status').toBeFalse();
      expect(gemini.capabilities.vision).withContext('vision').toBeFalse();
      expect(built).withContext('clients built').not.toContain(ENV_KEY);
    }

    it('a cleared key leaves Gemini down', async () => {
      env.geminiApiKey = ENV_KEY;
      openGate();

      await facade.updateProviderApiKey('gemini', 'gA');
      // The positive proof: a typed key arms, so the clear below has a client to take down.
      expect(gemini.isAvailable()).withContext('armed on the typed key').toBeTrue();
      expect(built).toEqual(['gA']);
      built.length = 0;

      await facade.updateProviderApiKey('gemini', undefined);

      expectGeminiDown();
      expect(built).withContext('clients built').toEqual([]);
    });

    // A pin: no caller passes '' today. The guard is truthiness because an
    // empty key falls back to the build's key just as a missing one does.
    it('an empty key leaves Gemini down', async () => {
      env.geminiApiKey = ENV_KEY;
      openGate();

      await facade.updateProviderApiKey('gemini', 'gA');
      expect(gemini.isAvailable()).withContext('armed on the typed key').toBeTrue();
      expect(built).toEqual(['gA']);
      built.length = 0;

      await facade.updateProviderApiKey('gemini', '');

      expectGeminiDown();
      expect(built).withContext('clients built').toEqual([]);
    });

    it('a model switch with no stored key leaves Gemini down', async () => {
      env.geminiApiKey = ENV_KEY;
      openGate();

      providerKeys.getKey.and.resolveTo('gA');
      await facade.reinitializeGemini('t', 'v');
      // The positive proof: with a stored key the same switch arms.
      expect(gemini.isAvailable()).withContext('armed on the stored key').toBeTrue();
      expect(gemini.capabilities.vision).withContext('vision on the stored key').toBeTrue();
      expect(built).toEqual(['gA']);
      built.length = 0;

      providerKeys.getKey.and.resolveTo(undefined);
      await facade.reinitializeGemini('t', 'v');

      expectGeminiDown();
      expect(built).withContext('clients built').toEqual([]);
    });

    // A pin: initializeProviders already clears rather than re-arming.
    it('a keyless bring-up leaves Gemini down', async () => {
      env.geminiApiKey = ENV_KEY;
      openGate();
      providerKeys.resolve.and.resolveTo({});

      await facade.initializeProviders();

      expectGeminiDown();
      expect(facade.availableProviders()).toEqual([]);
      expect(built).withContext('clients built').toEqual([]);
    });
  });
});
