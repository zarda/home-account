// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from the root packages are incompatible with the service layer.
import { signal } from '@angular/core';
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
import { NoteTranslationService } from './note-translation.service';
import { ProviderKeyService } from './provider-key.service';
import { AIStrategyService } from './ai-strategy.service';
import {
  AIModelOption,
  CLAUDE_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  OPENAI_MODELS,
  acceptsSampling,
} from '../config/ai-models';
import { languageInstruction, renderPrompt } from '../prompts';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { stripProviderKeys } from './testing/provider-keys';
silenceFirebaseWarnings();
stripProviderKeys();

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
 * The model catalog sweep below goes one step further and still stops short of
 * a vendor: it arms one provider at a time with a hand-made client and reads
 * the request each catalog id would send.
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

  beforeAll(async () => {
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

  it('offers the note translation on every real adapter', async () => {
    // The lens calls this through the façade on whichever provider is
    // configured. It is implemented once in the shared base, so a provider
    // that stopped extending it — or an interface method left unimplemented
    // behind a cast — would still satisfy every double in the unit specs.
    for (const provider of [gemini, openai, claude]) {
      expect(typeof provider.translateText).toBe('function');
    }

    // Nothing is configured here, so the façade has no provider to resolve
    // and says so rather than answering with an untranslated note.
    await expectAsync(facade.translateText('おにぎり 150')).toBeRejectedWithError(
      /No cloud AI provider available for translation/
    );

    // The lens's own service over the same real graph: it is root-provided and
    // reads the façade, TranslationService and the signed-in user in field
    // initializers, so a construction it cannot survive would take the note
    // panel down at the first render rather than at a request. With no key
    // configured it agrees with the façade — the button is offered disabled
    // and names the fix, instead of failing once per note.
    expect(TestBed.inject(NoteTranslationService).available()).toBeFalse();
  });

  it('keeps the model switches reachable through the façade', () => {
    // setModel is not on the adapter interface — only these two façade
    // methods call it, so nothing else would fail to compile if it went.
    expect(() => facade.setOpenAIModel('gpt-smoke-test')).not.toThrow();
    expect(() => facade.setClaudeModel('claude-smoke-test')).not.toThrow();
  });

  describe('model catalog sweep', () => {
    // Each provider is armed by hand: its fake client is assigned and its
    // availability signal set, through a cast. Not through updateProviderApiKey,
    // which builds the vendor's real SDK client around whatever key it is
    // handed, and a fake key must never be one request away from a vendor host.
    interface Armable {
      client: unknown;
      available: { set(value: boolean): void };
    }
    const internals = (provider: OpenAIService | ClaudeService): Armable =>
      provider as unknown as Armable;

    const NOTE = 'おにぎり 150';
    const ANSWER = JSON.stringify({ translation: 'Rice ball 150', sourceLanguage: 'Japanese' });
    // The request the catalog must not put on the wire: neither transport sends
    // a reasoning, thinking or effort setting, and a vendor that defaults one on
    // is answered by the token budget rather than by a parameter.
    const NEVER_SENT = ['reasoning', 'thinking', 'output_config'];

    /** The temperature the registry declares for the prompt the sweep sends. */
    const declaredTemperature = () =>
      renderPrompt('translateNote', {
        text: NOTE,
        languageInstruction: languageInstruction('en'),
      }).temperature;

    interface Sweep {
      provider: 'openai' | 'claude';
      swept: OpenAIService | ClaudeService;
      other: OpenAIService | ClaudeService;
      models: AIModelOption[];
      select: (modelId: string) => void;
      /** The swept fake's request method, and the client around it. */
      request: jasmine.Spy;
      sweptClient: unknown;
      /** The same for the provider that must stay out of it. */
      tripwire: jasmine.Spy;
      otherClient: unknown;
    }

    async function sweepCatalog(sweep: Sweep): Promise<void> {
      // The other provider is reset the way sign-out leaves it, then handed a
      // fake that would record any request routed to it. Its availability
      // signal stays down, which is what the façade routes on, so a call
      // landing on it would be a routing failure and not a pass.
      await sweep.other.reinitialize();
      internals(sweep.other).client = sweep.otherClient;

      internals(sweep.swept).client = sweep.sweptClient;
      internals(sweep.swept).available.set(true);

      expect(facade.availableProviders()).toEqual([sweep.provider]);
      expect(facade.resolveProvider('translation')).toBe(sweep.provider);

      for (const { id } of sweep.models) {
        sweep.request.calls.reset();
        sweep.select(id);

        const translated = await facade.translateText(NOTE);

        // The positive proof every negative below hangs on: one request left
        // through the swept fake, and its answer made it all the way back.
        expect(translated).withContext(id).toEqual({
          text: 'Rice ball 150',
          sourceLanguage: 'Japanese',
        });
        expect(sweep.request.calls.count()).withContext(id).toBe(1);

        const envelope = sweep.request.calls.mostRecent().args[0] as Record<string, unknown>;
        expect(envelope['model']).withContext(id).toBe(id);
        expect('temperature' in envelope)
          .withContext(`${id}: temperature present`)
          .toBe(acceptsSampling(id));
        if (acceptsSampling(id)) {
          expect(envelope['temperature']).withContext(id).toBe(declaredTemperature());
        }
        for (const key of NEVER_SENT) {
          expect(key in envelope).withContext(`${id}: ${key}`).toBeFalse();
        }
      }

      expect(sweep.tripwire).not.toHaveBeenCalled();
    }

    it('sends every OpenAI id as its own model, with no sampling, reasoning or effort key', async () => {
      const request = jasmine.createSpy('responses.create').and.resolveTo({ output_text: ANSWER });
      const tripwire = jasmine
        .createSpy('messages.create')
        .and.rejectWith(new Error('routed to Claude'));

      await sweepCatalog({
        provider: 'openai',
        swept: openai,
        other: claude,
        models: OPENAI_MODELS,
        select: id => facade.setOpenAIModel(id),
        request,
        sweptClient: { responses: { create: request } },
        tripwire,
        otherClient: { messages: { create: tripwire } },
      });
    });

    it('sends every Claude id as its own model, with temperature only where the catalog accepts it', async () => {
      const request = jasmine.createSpy('messages.create').and.resolveTo({
        content: [{ type: 'text', text: ANSWER }],
      });
      const tripwire = jasmine
        .createSpy('responses.create')
        .and.rejectWith(new Error('routed to OpenAI'));

      await sweepCatalog({
        provider: 'claude',
        swept: claude,
        other: openai,
        models: CLAUDE_MODELS,
        select: id => facade.setClaudeModel(id),
        request,
        sweptClient: { messages: { create: request } },
        tripwire,
        otherClient: { responses: { create: tripwire } },
      });
    });
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
    // updateProviderApiKey, which hands a key straight to reinitialize (and
    // clears Gemini for none) and stores nothing. reinitializeGemini — the
    // method AIStrategyService calls on a model switch — reads the key back
    // from Firestore, so this is the path the app actually takes.
    const keys = TestBed.inject(ProviderKeyService);
    await keys.setKey('gemini', 'fake-key-for-the-smoke');
    try {
      await expectAsync(
        facade.reinitializeGemini(DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL),
      ).toBeResolved();

      expect(gemini.isAvailable()).toBeTrue();
      // Gemini is the only provider with a separate vision handle, so a vision
      // default that failed to build would leave it text-only rather than down.
      expect(gemini.capabilities.vision).toBeTrue();
      expect(gemini.lastError()).toBeNull();
    } finally {
      // Stored under the suite's one account, where every later case would
      // read it, and jasmine runs the cases in a random order.
      await keys.setKey('gemini', undefined);
    }
  });

  it('says the providers are ready only once a stored key has armed Gemini', async () => {
    // What the queue drain waits on before it sends a photo. The key read
    // lands first and the SDK import comes after it, so a wait that ended at
    // the read would find Gemini still down and the photo would be filed as
    // failed. The fake key only builds a local handle, as above.
    const keys = TestBed.inject(ProviderKeyService);
    await keys.setKey('gemini', 'fake-key-for-the-smoke');
    try {
      await facade.resetProviders();
      expect(gemini.isAvailable()).toBeFalse();

      const strategy = TestBed.inject(AIStrategyService);
      const ready = await strategy.cloudProvidersReady();
      const armed = gemini.isAvailable();

      expect(ready).toBeTrue();
      expect(armed).toBeTrue();
      expect(facade.availableProviders()).toEqual(['gemini']);
    } finally {
      await keys.setKey('gemini', undefined);
    }
  });

  it('says the providers are ready, with none up, when the account stores no key', async () => {
    // The control for the case above: with nothing stored the wait still
    // answers once the read has landed, and it arms nothing.
    const strategy = TestBed.inject(AIStrategyService);

    await expectAsync(strategy.cloudProvidersReady()).toBeResolvedTo(true);

    expect(TestBed.inject(ProviderKeyService).keys()).toEqual({});
    expect(facade.hasAnyCloudProvider()).toBeFalse();
  });
});

/**
 * A provider bring-up that sign-out did not cancel, over the real graph.
 *
 * Signing out resets the providers, but a bring-up that already read the
 * departing account's key can still be waiting on its SDK import when the next
 * account signs in. Whatever it arms then is armed for the next account: its
 * requests go out on the previous account's key.
 *
 * This describe signs accounts in and out, so it owns its Firebase app and its
 * rates-cache seed; jasmine runs describes in a random order. The account is a
 * signal behind the AuthService double, so the strategy's effect sees each
 * switch the way it sees one in the app. Both accounts are real anonymous
 * users, because the key document is readable by its owner only. The fake key
 * builds a local client at most; nothing here sends a request.
 */
describe('cloud LLM providers across an account switch', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  const signedInAs = signal<string | null>(null);

  beforeAll(() => {
    // The same reason as the suite above: a cold cache sends the currency
    // service to a public API as soon as a provider is constructed.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, EUR: 0.9, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `cloud-llm-switch-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
  });

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    await auth.signOut().catch(() => undefined);
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    signedInAs.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: AuthService, useValue: { userId: signedInAs.asReadonly(), currentUser: () => null } },
      ],
    });
  });

  // A new anonymous account; signInAnonymously reuses a signed-in anonymous
  // user, hence the sign-out first.
  async function freshUser(): Promise<string> {
    await auth.signOut().catch(() => undefined);
    const credential = await signInAnonymously(auth);
    return credential.user.uid;
  }

  async function waitFor(predicate: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  it("arms nothing on the departing account's key once the next account is signed in", async () => {
    const a = await freshUser();
    signedInAs.set(a);
    const keys = TestBed.inject(ProviderKeyService);
    await keys.setKey('openai', 'fake-key-for-the-smoke');
    let keysDeleted = false;

    const facade = TestBed.inject(CloudLLMProviderService);
    const openai = TestBed.inject(OpenAIService);

    // The real import, held: A's bring-up reaches it with A's key and waits.
    const svc = openai as unknown as { loadSdk(): Promise<unknown> };
    const real = svc.loadSdk.bind(svc);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const loadSdk = spyOn(svc, 'loadSdk').and.callFake(() => gate.then(real));
    // Before the strategy exists: its constructor starts the first bring-up.
    const bringUps = spyOn(facade, 'initializeProviders').and.callThrough();

    try {
      const strategy = TestBed.inject(AIStrategyService);
      TestBed.tick();
      await waitFor(() => loadSdk.calls.count() > 0, "OpenAI's import for A's key");

      // Still as A. The bring-up already holds the key, so the race is the
      // same, and once the switch is made nothing can reach A's document.
      await keys.deleteAll();
      keysDeleted = true;

      await auth.signOut();
      signedInAs.set(null);
      TestBed.tick();

      const b = await freshUser();
      signedInAs.set(b);
      TestBed.tick();

      expect(await strategy.cloudProvidersReady()).toBeTrue();
      expect(facade.hasAnyCloudProvider()).toBeFalse();
    } finally {
      release();
      if (!keysDeleted && auth.currentUser?.uid === a && signedInAs() === a) {
        await keys.deleteAll().catch(() => undefined);
      }
    }

    // The positive proof the negatives below hang on: every held import
    // resolved to the real SDK, so a client could have been built from it.
    await Promise.all(loadSdk.calls.all().map(call => call.returnValue));
    await Promise.all(bringUps.calls.all().map(call => call.returnValue));

    expect(openai.isAvailable()).toBeFalse();
    expect(facade.availableProviders()).toEqual([]);
    expect(keys.keys()).toEqual({});
  });

  // This time the bring-up waits on Gemini's import, with OpenAI's key still to
  // arm after it. OpenAI's own check cannot stop that arm, which would start
  // after the switch; only the bring-up knows it was superseded.
  it("starts no further arm on the departing account's keys once its Gemini import lands", async () => {
    const a = await freshUser();
    signedInAs.set(a);
    const keys = TestBed.inject(ProviderKeyService);
    await keys.setKey('gemini', 'fake-key-for-the-smoke');
    await keys.setKey('openai', 'fake-key-for-the-smoke');
    let keysDeleted = false;

    const facade = TestBed.inject(CloudLLMProviderService);
    const gemini = TestBed.inject(GeminiService);
    const openai = TestBed.inject(OpenAIService);
    const claude = TestBed.inject(ClaudeService);

    // Gemini's real import, held; OpenAI's runs free and is only counted.
    const svc = gemini as unknown as { loadSdk(): Promise<unknown> };
    const real = svc.loadSdk.bind(svc);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const geminiLoadSdk = spyOn(svc, 'loadSdk').and.callFake(() => gate.then(real));
    const openaiLoadSdk = spyOn(
      openai as unknown as { loadSdk(): Promise<unknown> },
      'loadSdk'
    ).and.callThrough();
    // Before the strategy exists: its constructor starts the first bring-up.
    const bringUps = spyOn(facade, 'initializeProviders').and.callThrough();

    try {
      const strategy = TestBed.inject(AIStrategyService);
      TestBed.tick();
      await waitFor(() => geminiLoadSdk.calls.count() > 0, "Gemini's import for A's key");

      // Still as A, as above.
      await keys.deleteAll();
      keysDeleted = true;

      await auth.signOut();
      signedInAs.set(null);
      TestBed.tick();

      const b = await freshUser();
      signedInAs.set(b);
      TestBed.tick();

      expect(await strategy.cloudProvidersReady()).toBeTrue();
      expect(facade.hasAnyCloudProvider()).toBeFalse();
    } finally {
      release();
      if (!keysDeleted && auth.currentUser?.uid === a && signedInAs() === a) {
        await keys.deleteAll().catch(() => undefined);
      }
    }

    // The positive proof: every held import resolved to the real SDK.
    await Promise.all(geminiLoadSdk.calls.all().map(call => call.returnValue));
    await Promise.all(bringUps.calls.all().map(call => call.returnValue));

    expect(gemini.isAvailable()).withContext('Gemini').toBeFalse();
    expect(openai.isAvailable()).withContext('OpenAI').toBeFalse();
    expect(claude.isAvailable()).withContext('Claude').toBeFalse();
    expect(facade.availableProviders()).toEqual([]);
    expect(openaiLoadSdk.calls.count()).withContext("OpenAI's imports").toBe(0);
    expect(keys.keys()).toEqual({});
  });
});
