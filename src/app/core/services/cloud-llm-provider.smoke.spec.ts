// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from the root packages are incompatible with the service layer.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from '@angular/fire/firestore';

import { AuthService } from './auth.service';
import { CloudLLMProviderBase } from './cloud-llm-provider.base';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { GeminiService } from './gemini.service';
import { OpenAIService } from './openai.service';
import { ClaudeService } from './claude.service';
import { ProviderKeyService } from './provider-key.service';
import { environment } from '../../../environments/environment';
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config/ai-models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * The three provider services, built by a real injector over the real graph.
 *
 * `CloudLLMProviderBase` reads CategoryService, CurrencyService and
 * TranslationService in field initializers, which is only legal inside an
 * injection context. Every unit spec hands those in as jasmine doubles, so all
 * of them would keep passing if the real chain behind them could not be
 * constructed at all — and that chain is not short: the category catalog needs
 * Firestore and the signed-in user, the currency service needs the
 * translations, and each provider service is a root singleton the façade
 * resolves eagerly at start-up. A provider that throws while being constructed
 * takes the whole AI surface down with it, silently, at the first request.
 *
 * Nothing here reaches a model. What is asserted is construction, the
 * availability signals the façade's status is computed from, and the two
 * members the façade calls that are not on the adapter interface — Gemini's
 * clear() and the OpenAI/Claude model switches — which a refactor can drop
 * without any compile error, because nothing in the interface mentions them.
 *
 * Runs only under the emulators:
 *   npm run smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('cloud LLM providers (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;

  let facade: CloudLLMProviderService;
  let gemini: GeminiService;
  let openai: OpenAIService;
  let claude: ClaudeService;

  // A build can ship a Gemini key, and the gitignored local environment often
  // carries a real one. Either would make Gemini available before this suite
  // supplied a key, which is half of what it asserts.
  const env = environment as { geminiApiKey?: string };
  let savedKey: string | undefined;
  let hadKey = false;

  beforeAll(async () => {
    hadKey = 'geminiApiKey' in env;
    savedKey = env.geminiApiKey;
    delete env.geminiApiKey;

    // The currency service refreshes its rates from a public API when its
    // cache is cold, and it is constructed as soon as a provider is. A fresh
    // cache keeps this suite off the network entirely.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, EUR: 0.9, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `cloud-llm-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    if (hadKey) {
      env.geminiApiKey = savedKey;
    }
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        {
          // The only double in the graph: the real AuthService owns the
          // sign-in flow, and this suite has already signed in.
          provide: AuthService,
          useValue: { userId: () => uid, currentUser: () => null },
        },
      ],
    });

    facade = TestBed.inject(CloudLLMProviderService);
    gemini = TestBed.inject(GeminiService);
    openai = TestBed.inject(OpenAIService);
    claude = TestBed.inject(ClaudeService);

    // Gemini's constructor kicks off initialization without awaiting it.
    await facade.resetProviders();
  });

  it('constructs every provider on the shared base', () => {
    expect(facade).toBeTruthy();

    for (const provider of [gemini, openai, claude]) {
      expect(provider instanceof CloudLLMProviderBase).toBeTrue();
      // The state the base declares, live on an instance the injector built.
      expect(provider.isProcessing()).toBeFalse();
      expect(provider.lastError()).toBeNull();
    }
  });

  it('reports every provider unconfigured until a key is supplied', () => {
    for (const provider of [gemini, openai, claude]) {
      expect(provider.isAvailable()).toBeFalse();
      expect(provider.isAvailableSignal()).toBeFalse();
    }

    expect(facade.hasAnyCloudProvider()).toBeFalse();
    expect(facade.availableProviders()).toEqual([]);
  });

  it('flips availability when a key arrives, and records no error doing it', async () => {
    for (const name of ['gemini', 'openai', 'claude'] as const) {
      await facade.updateProviderApiKey(name, 'fake-key-for-the-smoke');
    }

    for (const provider of [gemini, openai, claude]) {
      // Each of these loaded its SDK on demand to get here; none of them sent
      // anything, because becoming available is a constructor call.
      expect(provider.isAvailable()).toBeTrue();
      expect(provider.isAvailableSignal()).toBeTrue();
      expect(provider.lastError()).toBeNull();
    }

    expect(facade.availableProviders()).toEqual(['gemini', 'openai', 'claude']);
    expect(facade.hasAnyCloudProvider()).toBeTrue();
  });

  it('tears every provider down on reset, through the paths the façade uses', async () => {
    for (const name of ['gemini', 'openai', 'claude'] as const) {
      await facade.updateProviderApiKey(name, 'fake-key-for-the-smoke');
    }
    expect(facade.availableProviders().length).toBe(3);

    // resetProviders is sign-out: it reaches Gemini through clear() rather
    // than reinitialize(), because reinitialize with no key falls back to the
    // build's environment key and would re-arm under the departing account.
    await facade.resetProviders();

    for (const provider of [gemini, openai, claude]) {
      expect(provider.isAvailable()).toBeFalse();
      expect(provider.isAvailableSignal()).toBeFalse();
    }
    expect(facade.hasAnyCloudProvider()).toBeFalse();
  });

  it('keeps the model switches reachable through the façade', () => {
    // setModel is not on the adapter interface — only these two façade
    // methods call it, so nothing else would fail to compile if it went.
    expect(() => facade.setOpenAIModel('gpt-smoke-test')).not.toThrow();
    expect(() => facade.setClaudeModel('claude-smoke-test')).not.toThrow();
  });

  it('arms Gemini on the catalog defaults the app actually boots with', async () => {
    // Every unit spec passes model ids in as fixtures, so all of them would
    // keep passing if the shipped defaults were a pair the real construction
    // path rejects. This is the one place the catalog's own values go through
    // getGenerativeModel() on the real SDK.
    //
    // Still no request to a model: building a handle is local, and the ids are
    // only resolved server-side at the first generateContent call.
    //
    // The key goes through ProviderKeyService rather than
    // updateProviderApiKey, which hands its argument straight to reinitialize
    // and stores nothing. reinitializeGemini — the method AIStrategyService
    // calls on a model switch — reads the key back from Firestore, so this is
    // the path the app actually takes.
    await TestBed.inject(ProviderKeyService).setKey('gemini', 'fake-key-for-the-smoke');

    await expectAsync(
      facade.reinitializeGemini(DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL),
    ).toBeResolved();

    expect(gemini.isAvailable()).toBeTrue();
    // Gemini is the only provider with a separate vision handle, so a vision
    // default that failed to build would leave it text-only rather than down.
    expect(gemini.capabilities.vision).toBeTrue();
    expect(gemini.lastError()).toBeNull();
  });
});
