import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { AIStrategyService, AI_CLOUD_UNAVAILABLE } from './ai-strategy.service';
import { ReceiptProcessingError } from '../utils/ai-error.utils';
import { BringUpOutcome, CloudLLMProviderService } from './cloud-llm-provider.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { NativeReceiptService } from './native-receipt.service';
import { ProviderKeyService } from './provider-key.service';
import { ProcessingResult } from './ai-types';
import { ParsedReceipt, MultiImageExtractedTransaction } from './gemini.service';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
} from '../config/ai-models';
import { AI_PREFERENCES_SCHEMA_VERSION } from '../config/ai-model-migrations';
import { REVIEW_AMOUNT_CONFIDENCE } from '../utils/receipt-consolidation';
import { MODEL_INCOME_GRADE } from '../utils/receipt-extraction.utils';

const PREFERENCES_STORAGE_KEY = 'homeaccount_ai_preferences';

describe('AIStrategyService', () => {
  let cloudMock: jasmine.SpyObj<CloudLLMProviderService>;
  let pwaMock: jasmine.SpyObj<PwaService>;
  let authMock: jasmine.SpyObj<AuthService>;
  let authUserId: WritableSignal<string | null>;
  let visionMock: jasmine.SpyObj<VisionOcrService>;
  let appleMock: jasmine.SpyObj<AppleIntelligenceService>;
  let nativeMock: jasmine.SpyObj<NativeReceiptService>;
  let providerKeysMock: jasmine.SpyObj<ProviderKeyService>;
  let keysLoadFailed: WritableSignal<boolean>;

  const imageFile = () => new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

  const parsedReceipt: ParsedReceipt = {
    merchant: 'Coffee Corner',
    amount: 12.5,
    currency: 'USD',
    type: 'expense',
    date: new Date('2026-01-15'),
    receiptDetails: 'Latte — USD 12.50',
    suggestedCategory: 'food_coffee_&_drinks',
    confidence: 0.85,
  };

  const nativeResult: ProcessingResult = {
    transactions: [{
      date: new Date('2026-01-15'),
      description: 'Coffee Corner',
      amount: 12.5,
      type: 'expense',
      currency: 'USD',
      confidence: 0.9,
      source: 'native',
    }],
    source: 'native',
    confidence: 0.9,
    processingTimeMs: 0,
  };

  beforeEach(() => {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);

    // initializeProviders and resetProviders are what the constructor's effect
    // actually calls. The list used to name initializeFromUserPreferences,
    // which no longer exists, and omit initializeProviders — so every run of
    // this suite threw into an unobserved promise.
    cloudMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'initializeProviders',
      'resetProviders',
      'hasAnyCloudProvider',
      'availableProviders',
      'providerStatus',
      'resolveProvider',
      'parseReceipt',
      'extractTransactionsFromMultipleImages',
      'reinitializeGemini',
      'updateProviderApiKey',
      'setOpenAIModel',
      'setClaudeModel',
    ]);
    cloudMock.initializeProviders.and.resolveTo({ keyReadFailed: false });
    cloudMock.resetProviders.and.resolveTo();
    cloudMock.hasAnyCloudProvider.and.returnValue(true);
    cloudMock.availableProviders.and.returnValue(['gemini']);
    cloudMock.providerStatus.and.returnValue({ gemini: true, openai: false, claude: false });
    cloudMock.resolveProvider.and.returnValue('gemini');
    cloudMock.parseReceipt.and.resolveTo(parsedReceipt);

    pwaMock = jasmine.createSpyObj('PwaService', ['isOnline']);
    pwaMock.isOnline.and.returnValue(true);

    authUserId = signal<string | null>(null);
    authMock = jasmine.createSpyObj('AuthService', ['currentUser'], {
      userId: authUserId,
    });
    authMock.currentUser.and.returnValue(null);

    visionMock = jasmine.createSpyObj('VisionOcrService', [
      'detectEnvironment',
      'isAvailable',
      'recognizeText',
      'isMacEnvironment',
    ]);
    visionMock.isMacEnvironment.and.returnValue(false);

    appleMock = jasmine.createSpyObj('AppleIntelligenceService', [
      'detectAvailability',
      'isModelAvailable',
      'parseReceiptText',
    ]);
    appleMock.isModelAvailable.and.returnValue(false);

    nativeMock = jasmine.createSpyObj('NativeReceiptService', ['processImage', 'processImages']);
    nativeMock.processImage.and.resolveTo(nativeResult);
    nativeMock.processImages.and.resolveTo(nativeResult);

    // The key write a save from settings makes. The bring-up's own key read
    // goes through the façade, which is a double here.
    keysLoadFailed = signal(false);
    providerKeysMock = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['setKey'],
      { loadFailed: keysLoadFailed }
    );
    providerKeysMock.setKey.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        AIStrategyService,
        { provide: CloudLLMProviderService, useValue: cloudMock },
        { provide: PwaService, useValue: pwaMock },
        { provide: AuthService, useValue: authMock },
        { provide: VisionOcrService, useValue: visionMock },
        { provide: AppleIntelligenceService, useValue: appleMock },
        { provide: NativeReceiptService, useValue: nativeMock },
        { provide: ProviderKeyService, useValue: providerKeysMock },
      ],
    });
  });

  afterEach(() => {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  });

  function createService(platform: 'web' | 'ios'): AIStrategyService {
    spyOn(Capacitor, 'getPlatform').and.returnValue(platform);
    return TestBed.inject(AIStrategyService);
  }

  it('constructs without narrating', () => {
    // Before createService(): the line under test runs from the constructor.
    const logSpy = spyOn(console, 'log');
    createService('web');
    expect(logSpy).not.toHaveBeenCalledWith(jasmine.stringContaining('[AIStrategy]'));
  });

  describe('provider lifecycle across accounts', () => {
    // Sign-out is a router navigation, so every root singleton survives it. On
    // a shared device that meant account B's receipts were sent to account A's
    // provider on A's key — billed to A, and logged in A's provider account.
    it('tears the providers down when the account signs out', () => {
      authUserId.set('user-a');
      const service = createService('web');
      TestBed.flushEffects();
      expect(cloudMock.initializeProviders).toHaveBeenCalled();

      authUserId.set(null);
      TestBed.flushEffects();

      expect(cloudMock.resetProviders).toHaveBeenCalledTimes(1);
      expect(service).toBeTruthy();
    });

    // The effect also runs once before auth resolves, when nothing has been
    // brought up for an account and there is nothing to tear down.
    it('does not reset on the first run before auth has resolved', () => {
      createService('web');
      TestBed.flushEffects();

      expect(cloudMock.resetProviders).not.toHaveBeenCalled();
    });

    it('re-initializes for the next account rather than reusing the last one', () => {
      authUserId.set('user-a');
      createService('web');
      TestBed.flushEffects();

      authUserId.set(null);
      TestBed.flushEffects();
      cloudMock.initializeProviders.calls.reset();

      authUserId.set('user-b');
      TestBed.flushEffects();

      expect(cloudMock.resetProviders).toHaveBeenCalledTimes(1);
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
    });
  });

  describe('cloud provider readiness', () => {
    // The queue drain asks this before it sends a photo. A drain that ran
    // ahead of the bring-up found no provider and filed the photo as failed,
    // so the answer has to cover the whole bring-up for the current account
    // and connectivity: the key read and the SDK import after it.
    function deferred(outcome: BringUpOutcome = { keyReadFailed: false }) {
      let resolve!: (o?: BringUpOutcome) => void;
      const promise = new Promise<BringUpOutcome>(res => (resolve = (o = outcome) => res(o)));
      return { promise, resolve };
    }

    const settle = () => new Promise<void>(resolve => setTimeout(resolve));

    function track(ready: Promise<boolean>) {
      const state: { settled: boolean; value?: boolean } = { settled: false };
      void ready.then(value => {
        state.settled = true;
        state.value = value;
      });
      return state;
    }

    it('settles only once the providers are up, not when the keys are read', async () => {
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      const sdkLoaded = deferred();
      cloudMock.initializeProviders.and.callFake(async () => {
        await Promise.resolve({}); // the key read, already answered
        await sdkLoaded.promise; // the provider SDK's import, still loading
        return { keyReadFailed: false };
      });

      const ready = track(service.cloudProvidersReady());
      await settle();

      expect(ready.settled).toBeFalse();

      sdkLoaded.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeTrue();
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
    });

    it('starts the bring-up itself when it is asked before the effect has run', async () => {
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();

      const ready = service.cloudProvidersReady();

      // Started before its first await, so the effect finds it in flight.
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);

      TestBed.flushEffects();

      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      await expectAsync(ready).toBeResolvedTo(true);
      // A bring-up whose keys were read answers with no second read.
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
    });

    it("joins the reconnect's bring-up rather than starting another", async () => {
      const online = signal(true);
      pwaMock.isOnline.and.callFake(online);
      authUserId.set('user-a');
      const service = createService('web');
      TestBed.flushEffects();

      online.set(false);
      TestBed.flushEffects();

      const reconnect = deferred();
      cloudMock.initializeProviders.and.returnValue(reconnect.promise);
      const before = cloudMock.initializeProviders.calls.count();
      online.set(true);
      TestBed.flushEffects();
      // The reconnect started one, and that is the one still loading.
      expect(cloudMock.initializeProviders.calls.count()).toBe(before + 1);

      cloudMock.initializeProviders.calls.reset();
      const ready = track(service.cloudProvidersReady());
      await settle();

      expect(ready.settled).toBeFalse();
      expect(cloudMock.initializeProviders).not.toHaveBeenCalled();

      reconnect.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeTrue();
      expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
    });

    it('answers false once the account has signed out', async () => {
      authUserId.set('user-a');
      const service = createService('web');
      TestBed.flushEffects();
      authUserId.set(null);
      TestBed.flushEffects();
      cloudMock.initializeProviders.calls.reset();

      await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(false);
      expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
    });

    it('answers false when the account signs out during the wait, and starts nothing for no one (pin)', async () => {
      // Each pass reads the account afresh: one read before the wait would
      // carry the departed account past it, start a bring-up for no one and
      // answer true.
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      const held = deferred();
      cloudMock.initializeProviders.and.returnValue(held.promise);

      const ready = track(service.cloudProvidersReady());
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);

      cloudMock.initializeProviders.calls.reset();
      cloudMock.initializeProviders.and.resolveTo({ keyReadFailed: false });
      authUserId.set(null);
      TestBed.flushEffects();
      // The sign-out reached the strategy: it reset the providers it had up.
      expect(cloudMock.resetProviders).toHaveBeenCalledTimes(1);

      held.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeFalse();
      expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
    });

    it('answers false when the device went offline during the wait', async () => {
      const online = signal(true);
      pwaMock.isOnline.and.callFake(online);
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      const onlineBringUp = deferred();
      cloudMock.initializeProviders.and.returnValue(onlineBringUp.promise);

      const ready = track(service.cloudProvidersReady());
      online.set(false);
      cloudMock.initializeProviders.and.resolveTo({ keyReadFailed: false });
      onlineBringUp.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeFalse();
      // The answer comes after a bring-up for the offline state, not off the
      // one that was started while online.
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
    });

    it('waits for the newer bring-up when connectivity changes during the wait', async () => {
      const online = signal(false);
      pwaMock.isOnline.and.callFake(online);
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      const offlineBringUp = deferred();
      const reconnect = deferred();
      cloudMock.initializeProviders.and.returnValues(offlineBringUp.promise, reconnect.promise);

      const ready = track(service.cloudProvidersReady());
      online.set(true);
      TestBed.flushEffects();

      // The reconnect started the newer one on top of the drain's own.
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);

      offlineBringUp.resolve();
      await settle();

      expect(ready.settled).toBeFalse();

      reconnect.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeTrue();
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
    });

    it('waits for the newest bring-up when connectivity drops and returns during the wait', async () => {
      const online = signal(true);
      pwaMock.isOnline.and.callFake(online);
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      const first = deferred();
      const newest = deferred();
      cloudMock.initializeProviders.and.returnValues(first.promise, Promise.resolve({ keyReadFailed: false }), newest.promise);

      const ready = track(service.cloudProvidersReady());
      online.set(false);
      TestBed.flushEffects();
      online.set(true);
      TestBed.flushEffects();

      // Back on the state the wait began in, but on a newer bring-up than
      // the one it is waiting for.
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(3);

      first.resolve();
      await settle();

      expect(ready.settled).toBeFalse();

      newest.resolve();
      await settle();

      expect(ready.settled).toBeTrue();
      expect(ready.value).toBeTrue();
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(3);
    });

    it('still answers when the bring-up fails', async () => {
      authUserId.set('user-a');
      const service = createService('web');
      cloudMock.initializeProviders.calls.reset();
      cloudMock.initializeProviders.and.rejectWith(new Error('x'));

      await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(true);
      expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
    });

    describe('a bring-up whose key read failed', () => {
      // A key read that fails while online leaves the bring-up keyless, and
      // nothing starts another until the account or connectivity changes: the
      // drain's wait answered on it and sent the photo to no provider. The
      // wait reads the keys once more, going by the bring-up's own outcome.
      const FAILED: BringUpOutcome = { keyReadFailed: true };
      const READ: BringUpOutcome = { keyReadFailed: false };

      it('reads the keys once more, and answers once that read is up', async () => {
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        const first = deferred(FAILED);
        const again = deferred(READ);
        cloudMock.initializeProviders.and.returnValues(first.promise, again.promise);

        const ready = track(service.cloudProvidersReady());
        try {
          first.resolve();
          await settle();
          // The second read is under way, and the wait is on it.
          expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
          expect(ready.settled).toBeFalse();
        } finally {
          first.resolve();
          again.resolve();
        }
        await settle();

        expect(ready).toEqual({ settled: true, value: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
      });

      it("reads the keys once more after the settings page's own read has cleared the flag", async () => {
        // The issue's flow. The bring-up's read fails; opening Settings → AI
        // then reads the keys for the page, which clears the key service's
        // flag and arms nothing. Only the bring-up's outcome still says that
        // its read failed.
        keysLoadFailed.set(true);
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        const first = deferred(FAILED);
        cloudMock.initializeProviders.and.returnValues(first.promise, Promise.resolve(READ));

        const ready = track(service.cloudProvidersReady());
        try {
          expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
          keysLoadFailed.set(false); // the page's own read
        } finally {
          first.resolve();
        }
        await settle();

        expect(ready).toEqual({ settled: true, value: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
      });

      it('reads them only once more when every read fails', async () => {
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.resolveTo(FAILED);

        await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(true);
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
      });

      it('shares the one more read between waits on the same bring-up when every read fails', async () => {
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.resolveTo(FAILED);

        const answers = await Promise.all([
          service.cloudProvidersReady(),
          service.cloudProvidersReady(),
          service.cloudProvidersReady(),
        ]);

        expect(answers).toEqual([true, true, true]);
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
      });

      it('shares the one more read between waits on the same bring-up when it succeeds', async () => {
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.returnValues(
          Promise.resolve(FAILED),
          Promise.resolve(READ),
          Promise.resolve(READ),
          Promise.resolve(READ),
        );

        const answers = await Promise.all([
          service.cloudProvidersReady(),
          service.cloudProvidersReady(),
          service.cloudProvidersReady(),
        ]);

        expect(answers).toEqual([true, true, true]);
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);
      });

      it('gives a later wait a read of its own after the one more read failed too', async () => {
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.resolveTo(FAILED);

        await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(true);
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(2);

        await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(true);
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(3);
      });

      it('reads nothing more when the wait ends offline', async () => {
        // Offline a read cannot land; the reconnect's bring-up reads again.
        pwaMock.isOnline.and.returnValue(false);
        authUserId.set('user-a');
        const service = createService('web');
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.resolveTo(FAILED);

        await expectAsync(service.cloudProvidersReady()).toBeResolvedTo(false);
        // The wait's own bring-up, and nothing after it.
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });
    });

    describe('a key saved in settings', () => {
      // Settings → AI saves a key when its field blurs, and pressing Sync Now
      // is what blurs it. The save is a Firestore write and then a bring-up;
      // a drain that started during the write used to find the previous
      // bring-up finished, send the photo to a provider the key had not
      // reached, and spend one of the receipt's retries on it.
      //
      // Effects coalesce, so every signal write below is flushed on its own:
      // two changes flushed together reach the effect as one.

      /** A held key write: setKey answers when the case says. */
      function heldWrite() {
        let land!: () => void;
        const promise = new Promise<void>(resolve => (land = resolve));
        return { promise, land };
      }

      /** Settles without ever rejecting, so a refused save is read, not thrown. */
      function watch(promise: Promise<unknown>) {
        const state: { settled: boolean; error?: unknown } = { settled: false };
        void promise.then(
          () => {
            state.settled = true;
          },
          (error: unknown) => {
            state.settled = true;
            state.error = error;
          },
        );
        return state;
      }

      /** The account signed in at each bring-up, in call order. */
      function bringUpAccounts(): (string | null)[] {
        const accounts: (string | null)[] = [];
        cloudMock.initializeProviders.and.callFake(async () => {
          accounts.push(authUserId());
          return { keyReadFailed: false };
        });
        return accounts;
      }

      /** Signed in as A, with the effect's bring-up for A already up. */
      async function signedInAndUp(): Promise<AIStrategyService> {
        authUserId.set('user-a');
        const service = createService('web');
        TestBed.tick();
        await settle();
        cloudMock.initializeProviders.calls.reset();
        return service;
      }

      /** Signed in as A, with the effect's bring-up for A (B0) still loading. */
      function signedInWithBringUpHeld() {
        authUserId.set('user-a');
        const service = createService('web');
        const b0 = deferred();
        cloudMock.initializeProviders.and.returnValue(b0.promise);
        cloudMock.initializeProviders.calls.reset();
        TestBed.tick();
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
        cloudMock.initializeProviders.calls.reset();
        cloudMock.initializeProviders.and.resolveTo({ keyReadFailed: false });
        return { service, b0 };
      }

      /**
       * A façade that supersedes as the real one does (ADR 0179): a bring-up
       * arms only when no newer bring-up or reset started while its read was
       * out. Each read is held until the case lets it land.
       */
      function supersedingFacade() {
        let generation = 0;
        const facade = { armed: false, reads: [] as ReturnType<typeof deferred>[] };
        cloudMock.resetProviders.and.callFake(async () => {
          generation++;
          facade.armed = false;
        });
        cloudMock.initializeProviders.and.callFake(async () => {
          const mine = ++generation;
          const read = deferred();
          facade.reads.push(read);
          const outcome = await read.promise;
          if (mine === generation) facade.armed = true;
          return outcome;
        });
        return facade;
      }

      it('writes the key before its first await, and brings the providers up once the write lands', async () => {
        const service = await signedInAndUp();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        // Under way at once: a wait that starts in the same task sees it.
        expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        try {
          await settle();
          expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
          expect(save.settled).toBeFalse();
        } finally {
          write.land();
        }
        await settle();

        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
        expect(save).toEqual({ settled: true });
        // The page used to arm the key itself, outside any bring-up.
        expect(cloudMock.updateProviderApiKey).not.toHaveBeenCalled();
      });

      it('holds a wait that starts during the save until the bring-up after the write', async () => {
        const service = await signedInAndUp();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);
        const saveBringUp = deferred();
        cloudMock.initializeProviders.and.returnValue(saveBringUp.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const ready = track(service.cloudProvidersReady());
        try {
          await settle();
          // The account's providers were up, but not with the key being saved.
          expect(ready.settled).toBeFalse();

          write.land();
          await settle();
          expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
          expect(ready.settled).toBeFalse();
        } finally {
          write.land();
          saveBringUp.resolve();
        }
        await settle();

        expect(ready.settled).toBeTrue();
        expect(ready.value).toBeTrue();
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it('moves a wait already joined to the bring-up in flight on to the save', async () => {
        const { service, b0 } = signedInWithBringUpHeld();
        const ready = track(service.cloudProvidersReady());
        const saveBringUp = deferred();
        cloudMock.initializeProviders.and.returnValue(saveBringUp.promise);

        // The write lands at once; B0 is what it waits for.
        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          b0.resolve();
          await settle();
          // B0 is up, and the save's own bring-up is the one still loading.
          expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
          expect(ready.settled).toBeFalse();
        } finally {
          b0.resolve();
          saveBringUp.resolve();
        }
        await settle();

        expect(ready.settled).toBeTrue();
        expect(ready.value).toBeTrue();
        expect(save).toEqual({ settled: true });
      });

      it('brings the saved key up only after the bring-up already in flight', async () => {
        const { service, b0 } = signedInWithBringUpHeld();

        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          await settle();
          // The write is in, and the save still waits its turn behind B0.
          expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
          expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
          expect(save.settled).toBeFalse();
        } finally {
          b0.resolve();
        }
        await settle();

        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
        expect(save).toEqual({ settled: true });
      });

      it('rejects a refused write, and still holds a wait it took over until the bring-up in flight', async () => {
        const { service, b0 } = signedInWithBringUpHeld();
        const refusal = new Error('permission-denied');
        providerKeysMock.setKey.and.rejectWith(refusal);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const ready = track(service.cloudProvidersReady());
        try {
          await settle();
          // Refused, but B0 has not come up: neither answers before it.
          expect(ready.settled).toBeFalse();
          expect(save.settled).toBeFalse();
        } finally {
          b0.resolve();
        }
        await settle();

        expect(ready.settled).toBeTrue();
        expect(ready.value).toBeTrue();
        expect(save).toEqual({ settled: true, error: refusal });
        // A write that did not land has nothing to bring up.
        expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
      });

      it('reads the keys once more for a wait on a refused save behind a bring-up whose read failed', async () => {
        // Sync Now's own blur starts the save, so the drain's wait joins it.
        // The save read nothing, and the read it sat behind failed.
        const { service, b0 } = signedInWithBringUpHeld();
        const refusal = new Error('permission-denied');
        providerKeysMock.setKey.and.rejectWith(refusal);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const ready = track(service.cloudProvidersReady());
        try {
          await settle();
          expect(ready.settled).toBeFalse();
        } finally {
          b0.resolve({ keyReadFailed: true });
        }
        await settle();

        expect(save).toEqual({ settled: true, error: refusal });
        expect(ready).toEqual({ settled: true, value: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it('brings nothing up for an account that signed out before its write landed', async () => {
        const service = await signedInAndUp();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        try {
          authUserId.set(null);
          TestBed.tick();
          expect(cloudMock.resetProviders).toHaveBeenCalledTimes(1);
        } finally {
          write.land();
        }
        await settle();

        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
      });

      it('brings up the next account once it signs in, and nothing for the departed save', async () => {
        const service = await signedInAndUp();
        const accounts = bringUpAccounts();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-b');
          TestBed.tick();
        } finally {
          write.land();
        }
        await settle();

        expect(save).toEqual({ settled: true });
        expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        expect(accounts).toEqual(['user-b']);
      });

      it('brings a reconnect during the save up behind it', async () => {
        const online = signal(true);
        pwaMock.isOnline.and.callFake(online);
        const service = await signedInAndUp();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);
        const saveBringUp = deferred();
        cloudMock.initializeProviders.and.returnValues(
          saveBringUp.promise,
          Promise.resolve({ keyReadFailed: false }),
          Promise.resolve({ keyReadFailed: false }),
        );

        const save = watch(service.applyProviderKey('gemini', 'k'));
        let ready: ReturnType<typeof track> | undefined;
        try {
          online.set(false);
          TestBed.tick();
          online.set(true);
          TestBed.tick();
          ready = track(service.cloudProvidersReady());
          await settle();
          // Two new attempts, and neither came up ahead of the write.
          expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
          expect(ready.settled).toBeFalse();

          write.land();
          await settle();
          // The save's bring-up first, and the reconnect's behind it.
          expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
          expect(ready.settled).toBeFalse();
        } finally {
          write.land();
          saveBringUp.resolve();
        }
        await settle();

        // Then one for each attempt the reconnect started.
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(3);
        expect(ready).toEqual({ settled: true, value: true });
        expect(save).toEqual({ settled: true });
      });

      it("brings the next account up at once, not behind the departed account's save", async () => {
        const service = await signedInAndUp();
        const accounts = bringUpAccounts();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-b');
          TestBed.tick();
          // B's own bring-up, started while A's write is still out.
          expect(accounts).toEqual(['user-b']);
          const ready = track(service.cloudProvidersReady());
          await settle();
          expect(ready).toEqual({ settled: true, value: true });
          expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        } finally {
          write.land();
        }
        await settle();

        expect(save).toEqual({ settled: true });
        expect(accounts).toEqual(['user-b']);
      });

      it('brings the next account up at once when the switch reaches the effect as one change', async () => {
        const service = await signedInAndUp();
        const accounts = bringUpAccounts();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          // One flush for both writes: the effect never sees the sign-out, so
          // nothing unlinks the save. Its account tag is what keeps B out.
          authUserId.set(null);
          authUserId.set('user-b');
          TestBed.tick();
          expect(cloudMock.resetProviders).not.toHaveBeenCalled();
          expect(accounts).toEqual(['user-b']);
          const ready = track(service.cloudProvidersReady());
          await settle();
          expect(ready).toEqual({ settled: true, value: true });
          expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        } finally {
          write.land();
        }
        await settle();

        expect(save).toEqual({ settled: true });
        expect(accounts).toEqual(['user-b']);
      });

      it('brings the account up at once when it signs back in during the save it left behind', async () => {
        // The account tag cannot tell the two sessions apart; the sign-out's
        // unlink is what keeps the new one from queueing behind the old write.
        const service = await signedInAndUp();
        const accounts = bringUpAccounts();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        try {
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-a');
          TestBed.tick();
          expect(accounts).toEqual(['user-a']);
          expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', 'k');
        } finally {
          write.land();
        }
        await settle();

        // The save belongs to the session that ended, so it brings nothing up
        // in the new one: that session's own read sees the write, which
        // Firestore lays over the stored key while it is out.
        expect(save).toEqual({ settled: true });
        expect(accounts).toEqual(['user-a']);
      });

      it('answers a wait on the sign-back-in bring-up only once it is up, when the save left behind lands', async () => {
        const service = await signedInAndUp();
        const facade = supersedingFacade();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        let answer: Promise<{ ready: boolean; armed: boolean }> | undefined;
        try {
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-a');
          TestBed.tick();
          // The new session's own bring-up, with its read still out.
          expect(facade.reads.length).toBe(1);
          answer = service.cloudProvidersReady().then(ready => ({ ready, armed: facade.armed }));
          write.land();
          await settle();
          facade.reads[0].resolve();
          await settle();
        } finally {
          write.land();
          facade.reads.forEach(read => read.resolve());
        }
        await settle();

        expect(await answer).toEqual({ ready: true, armed: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it('brings nothing up behind the save left behind for a reconnect from the session that ended', async () => {
        const online = signal(true);
        pwaMock.isOnline.and.callFake(online);
        const service = await signedInAndUp();
        const facade = supersedingFacade();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        let answer: Promise<{ ready: boolean; armed: boolean }> | undefined;
        try {
          // A reconnect during the save: both attempts queue behind its write.
          online.set(false);
          TestBed.tick();
          online.set(true);
          TestBed.tick();
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-a');
          TestBed.tick();
          expect(facade.reads.length).toBe(1);
          answer = service.cloudProvidersReady().then(ready => ({ ready, armed: facade.armed }));
          write.land();
          await settle();
          facade.reads[0].resolve();
          await settle();
        } finally {
          write.land();
          facade.reads.forEach(read => read.resolve());
        }
        await settle();

        expect(await answer).toEqual({ ready: true, armed: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      // The Firestore SDK keeps a departed account's write until that account
      // is current again, so these hold the write past the account's change:
      // the save's hold on a wait ends with the change, not with the write.

      it('answers false for a wait on the save once the account signs out, its write still out', async () => {
        const service = await signedInAndUp();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const ready = track(service.cloudProvidersReady());
        try {
          await settle();
          expect(ready.settled).toBeFalse();
          authUserId.set(null);
          TestBed.tick();
          await settle();
          expect(ready).toEqual({ settled: true, value: false });
          // The page's own promise still waits for the write.
          expect(save.settled).toBeFalse();
        } finally {
          write.land();
        }
        await settle();

        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).not.toHaveBeenCalled();
      });

      it("follows the next account's bring-up for a wait on the save when it signs in, the write still out", async () => {
        const service = await signedInAndUp();
        const facade = supersedingFacade();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const answer = service.cloudProvidersReady().then(ready => ({ ready, armed: facade.armed }));
        const answered = watch(answer);
        try {
          await settle();
          authUserId.set(null);
          TestBed.tick();
          authUserId.set('user-b');
          TestBed.tick();
          // B's own bring-up, with its read still out.
          expect(facade.reads.length).toBe(1);
          await settle();
          expect(answered.settled).toBeFalse();
          facade.reads[0].resolve();
          await settle();
          expect(answered.settled).withContext('answered before the write landed').toBeTrue();
        } finally {
          write.land();
          facade.reads.forEach(read => read.resolve());
        }
        await settle();

        expect(await answer).toEqual({ ready: true, armed: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it("follows the next account's bring-up for a wait on the save when the switch reaches the effect as one change", async () => {
        const service = await signedInAndUp();
        const facade = supersedingFacade();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const answer = service.cloudProvidersReady().then(ready => ({ ready, armed: facade.armed }));
        const answered = watch(answer);
        try {
          await settle();
          authUserId.set(null);
          authUserId.set('user-b');
          TestBed.tick();
          expect(facade.reads.length).toBe(1);
          await settle();
          expect(answered.settled).toBeFalse();
          facade.reads[0].resolve();
          await settle();
          expect(answered.settled).withContext('answered before the write landed').toBeTrue();
        } finally {
          write.land();
          facade.reads.forEach(read => read.resolve());
        }
        await settle();

        expect(await answer).toEqual({ ready: true, armed: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it("brings nothing up for the next account behind the departed account's reconnect when the switch reaches the effect as one change", async () => {
        const online = signal(true);
        pwaMock.isOnline.and.callFake(online);
        const service = await signedInAndUp();
        const facade = supersedingFacade();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        let answer: Promise<{ ready: boolean; armed: boolean }> | undefined;
        try {
          // A reconnect during the save: both attempts queue behind its write.
          online.set(false);
          TestBed.tick();
          online.set(true);
          TestBed.tick();
          authUserId.set(null);
          authUserId.set('user-b');
          TestBed.tick();
          expect(facade.reads.length).toBe(1);
          answer = service.cloudProvidersReady().then(ready => ({ ready, armed: facade.armed }));
          write.land();
          await settle();
          facade.reads[0].resolve();
          await settle();
        } finally {
          write.land();
          facade.reads.forEach(read => read.resolve());
        }
        await settle();

        // A's attempts queued behind the save read whoever is signed in, so
        // each would supersede B's own bring-up and the wait would answer on
        // one that armed nothing.
        expect(await answer).toEqual({ ready: true, armed: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it('holds a wait on a save made after the start-up run before auth resolved (pin)', async () => {
        // That run is signed out, so it ends the saves' hold; a save made after
        // it has to take a new one, or it would hold no wait at all.
        const service = createService('web');
        TestBed.tick();
        authUserId.set('user-a');
        TestBed.tick();
        await settle();
        cloudMock.initializeProviders.calls.reset();
        const write = heldWrite();
        providerKeysMock.setKey.and.returnValue(write.promise);

        const save = watch(service.applyProviderKey('gemini', 'k'));
        const ready = track(service.cloudProvidersReady());
        try {
          await settle();
          expect(ready.settled).toBeFalse();
        } finally {
          write.land();
        }
        await settle();

        expect(ready).toEqual({ settled: true, value: true });
        expect(save).toEqual({ settled: true });
        expect(cloudMock.initializeProviders).toHaveBeenCalledTimes(1);
      });

      it('clears a key through the same write and a full bring-up', async () => {
        const service = await signedInAndUp();
        cloudMock.setOpenAIModel.calls.reset();
        cloudMock.setClaudeModel.calls.reset();

        await service.applyProviderKey('gemini', undefined);

        expect(providerKeysMock.setKey).toHaveBeenCalledOnceWith('gemini', undefined);
        // The whole bring-up on the stored model choices, as at sign-in.
        expect(cloudMock.setOpenAIModel).toHaveBeenCalledOnceWith(DEFAULT_OPENAI_MODEL);
        expect(cloudMock.setClaudeModel).toHaveBeenCalledOnceWith(DEFAULT_CLAUDE_MODEL);
        expect(cloudMock.initializeProviders).toHaveBeenCalledOnceWith(DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL);
        expect(cloudMock.updateProviderApiKey).not.toHaveBeenCalled();
        expect(cloudMock.reinitializeGemini).not.toHaveBeenCalled();
      });
    });
  });

  describe('routing', () => {
    it('should not use native OCR on the web', () => {
      const service = createService('web');
      expect(service.useNativeOCR()).toBeFalse();
    });

    it('should use native OCR on iPhone/iPad', () => {
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should prefer cloud on a Mac without Apple Intelligence', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeFalse();
    });

    it('should prefer the native pipeline on a Mac with Apple Intelligence', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      appleMock.isModelAvailable.and.returnValue(true);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should use native OCR on a Mac when no cloud provider is configured', () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');
      expect(service.useNativeOCR()).toBeTrue();
    });

    it('should probe native capabilities on iOS at startup', () => {
      createService('ios');
      expect(visionMock.detectEnvironment).toHaveBeenCalled();
      expect(appleMock.detectAvailability).toHaveBeenCalled();
    });

    it('should not probe native capabilities on the web', () => {
      createService('web');
      expect(visionMock.detectEnvironment).not.toHaveBeenCalled();
      expect(appleMock.detectAvailability).not.toHaveBeenCalled();
    });
  });

  describe('processReceipt', () => {
    it('should process with cloud AI on the web', async () => {
      const service = createService('web');
      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(nativeMock.processImage).not.toHaveBeenCalled();
      expect(result.source).toBe('cloud');
      expect(result.transactions[0].description).toBe('Coffee Corner');
      expect(result.transactions[0].suggestedCategoryId).toBe('food_coffee_&_drinks');
      expect(result.transactions[0].notes).toBe('Latte — USD 12.50');
    });

    it('should reject on the web when cloud AI is unavailable', async () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('web');

      await expectAsync(service.processReceipt(imageFile()))
        .toBeRejectedWithError(AI_CLOUD_UNAVAILABLE);
    });

    it('should process with the native pipeline on iOS', async () => {
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(nativeMock.processImage).toHaveBeenCalled();
      expect(cloudMock.parseReceipt).not.toHaveBeenCalled();
      expect(result.source).toBe('native');
    });

    it('should fall back to cloud when native processing fails', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.source).toBe('cloud');
    });

    it('should rethrow native errors when cloud is unavailable', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');

      await expectAsync(service.processReceipt(imageFile()))
        .toBeRejectedWithError('OCR failed');
    });

    it('should fall back to native OCR when cloud fails on a Mac', async () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      cloudMock.parseReceipt.and.rejectWith(new Error('rate limited'));
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(nativeMock.processImage).toHaveBeenCalled();
      expect(result.source).toBe('native');
    });

    it('should record processing time and reset the processing flag', async () => {
      const service = createService('web');
      const result = await service.processReceipt(imageFile());

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(service.isProcessing()).toBeFalse();
      expect(service.lastProcessingTime()).toBe(result.processingTimeMs);
    });

    it('propagates a cloud auth failure on the web instead of an empty result', async () => {
      // OpenAI and Claude used to swallow a 401 into an empty array, which
      // this layer accepted as a valid answer — the wizard then reported
      // "no transactions found" for an expired key. The throw has to reach
      // the caller so parseAIError can classify it.
      cloudMock.parseReceipt.and.rejectWith(new Error('401 Incorrect API key provided'));
      const service = createService('web');

      await expectAsync(service.processReceipt(imageFile()))
        .toBeRejectedWithError('401 Incorrect API key provided');
    });

    it('carries the receipt count out, so the form can offer the multi-receipt review', async () => {
      // Every provider parses this field; nothing used to carry it past here,
      // so the chooser could not fire for anyone but Gemini.
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, receiptCount: 3 });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).receiptCount).toBe(3);
    });

    it('reports one receipt when the model did not say', async () => {
      const service = createService('web');
      expect((await service.processReceipt(imageFile())).receiptCount).toBe(1);
    });

    it('carries the printed location out as the row slot, and nothing when none was read', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, location: 'Shibuya' });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).transactions[0].location)
        .toEqual({ name: 'Shibuya' });

      cloudMock.parseReceipt.and.resolveTo(parsedReceipt);
      const plain = await service.processReceipt(imageFile());
      expect('location' in plain.transactions[0]).toBeFalse();
    });

    it('carries the receipt country out as a mark, and into the printed address', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, location: 'Shibuya', receiptCountry: 'JP' });
      const service = createService('web');

      const row = (await service.processReceipt(imageFile())).transactions[0];
      expect(row.receiptCountry).toBe('JP');
      expect(row.location).toEqual({ name: 'Shibuya', country: 'JP' });

      cloudMock.parseReceipt.and.resolveTo(parsedReceipt);
      expect('receiptCountry' in (await service.processReceipt(imageFile())).transactions[0]).toBeFalse();
    });

    it('files a refund the cloud read off one photo as income, its type grade carried out', async () => {
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        type: 'income',
        fieldConfidence: { type: MODEL_INCOME_GRADE },
      });
      const service = createService('web');

      const row = (await service.processReceipt(imageFile())).transactions[0];

      expect(row.type).toBe('income');
      expect(row.fieldConfidence).toEqual({ type: MODEL_INCOME_GRADE });
    });

    it('keeps a purchase the cloud read an expense with no type grade', async () => {
      const service = createService('web');

      const row = (await service.processReceipt(imageFile())).transactions[0];

      expect(row.type).toBe('expense');
      expect(row.fieldConfidence).toBeUndefined();
    });

    it('carries the per-field confidences out', async () => {
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        fieldConfidence: { amount: 0.42, date: 0.99 },
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].fieldConfidence).toEqual({ amount: 0.42, date: 0.99 });
    });

    it('falls back to the account base currency when the model read none', async () => {
      // The provider services used to invent one, and disagreed about which:
      // the same unreadable currency became CNY, JPY or USD depending only on
      // which extraction path had run.
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'KRW' } } as never
      );
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, currency: '' });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).transactions[0].currency).toBe('KRW');
    });

    it('falls back to USD only when the account has no base currency either', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, currency: '' });
      const service = createService('web');

      expect((await service.processReceipt(imageFile())).transactions[0].currency).toBe('USD');
    });

    it('builds the note from the item lines when the model reproduced no receipt body', async () => {
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        receiptDetails: undefined,
        items: [{ name: 'Latte', amount: 5 }, { name: 'Bagel', amount: 7 }],
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].notes).toBe('Latte — USD 5.00\nBagel — USD 7.00');
    });

    it('renders the itemized note in the fallback currency, not a blank one', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'KRW' } } as never
      );
      cloudMock.parseReceipt.and.resolveTo({
        ...parsedReceipt,
        currency: '',
        receiptDetails: undefined,
        items: [{ name: 'Latte', amount: 5 }],
      });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.transactions[0].notes).toContain('KRW');
    });

    // The native pipeline reports what OCR read and nothing more — it has no
    // access to the account. Substituting here is what keeps the on-device and
    // cloud paths agreeing about an unreadable currency.
    it('substitutes the base currency into a native row that read none', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImage.and.resolveTo({
        ...nativeResult,
        transactions: [{ ...nativeResult.transactions[0], currency: '' }],
      });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(result.transactions[0].currency).toBe('THB');
      expect(result.transactions[0].currencyFellBack).toBeTrue();
    });

    it('leaves a native row alone when OCR did read a currency', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImage.and.resolveTo({
        ...nativeResult,
        transactions: [{ ...nativeResult.transactions[0], currency: 'JPY' }],
      });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(result.transactions[0].currency).toBe('JPY');
      expect(result.transactions[0].currencyFellBack).toBeUndefined();
    });

    it('substitutes into a multi-image native result too', async () => {
      authMock.currentUser.and.returnValue(
        { preferences: { baseCurrency: 'THB' } } as never
      );
      nativeMock.processImages.and.resolveTo({
        ...nativeResult,
        transactions: [
          { ...nativeResult.transactions[0], currency: '' },
          { ...nativeResult.transactions[0], currency: 'JPY' },
        ],
      });
      const service = createService('ios');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.map(t => t.currency)).toEqual(['THB', 'JPY']);
      expect(result.transactions.map(t => t.currencyFellBack)).toEqual([true, undefined]);
    });
  });

  describe('engine availability', () => {
    it('offers the receipt UI with a provider configured but no connection', () => {
      // Attaching and previewing images has to survive losing signal; only
      // issuing the scan needs a reachable engine.
      pwaMock.isOnline.and.returnValue(false);
      const service = createService('web');

      expect(service.hasAnyEngine()).toBeTrue();
      expect(service.canProcessNow()).toBeFalse();
    });

    it('offers the receipt UI on iOS with no cloud provider at all', () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('ios');

      expect(service.hasAnyEngine()).toBeTrue();
    });

    it('offers nothing on the web with no provider configured', () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      const service = createService('web');

      expect(service.hasAnyEngine()).toBeFalse();
      expect(service.canProcessNow()).toBeFalse();
    });
  });

  describe('falling back on an unusable result', () => {
    /** What an engine handed a script it cannot read comes back with. */
    const unreadable: ProcessingResult = {
      ...nativeResult,
      transactions: [{ ...nativeResult.transactions[0], amount: 0, confidence: 0.1 }],
      confidence: 0.1,
    };

    it('tries the cloud when native OCR read too little to trust', async () => {
      // The case the old exception-only fallback could never catch: Vision
      // does not throw on an unfamiliar script, it just reads almost nothing.
      nativeMock.processImage.and.resolveTo(unreadable);
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());

      expect(cloudMock.parseReceipt).toHaveBeenCalled();
      expect(result.source).toBe('cloud');
      expect(result.transactions[0].description).toBe('Coffee Corner');
    });

    it('keeps the native result when the cloud reads it no better', async () => {
      nativeMock.processImage.and.resolveTo(unreadable);
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, amount: 0, confidence: 0.1 });
      const service = createService('ios');

      const result = await service.processReceipt(imageFile());
      expect(result.source).toBe('native');
    });

    it('keeps the native result when the cloud attempt throws', async () => {
      // A second engine failing must not turn a poor result into no result.
      nativeMock.processImage.and.resolveTo(unreadable);
      cloudMock.parseReceipt.and.rejectWith(new Error('offline'));
      const service = createService('ios');

      await expectAsync(service.processReceipt(imageFile())).toBeResolved();
      expect((await service.processReceipt(imageFile())).source).toBe('native');
    });

    it('does not spend a second engine on a result that read the receipt', async () => {
      const service = createService('ios');

      await service.processReceipt(imageFile());
      expect(cloudMock.parseReceipt).not.toHaveBeenCalled();
    });

    it('has nothing to fall back to on the web and returns what it got', async () => {
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, amount: 0, confidence: 0.1 });
      const service = createService('web');

      const result = await service.processReceipt(imageFile());
      expect(result.source).toBe('cloud');
      expect(nativeMock.processImage).not.toHaveBeenCalled();
    });
  });

  describe('processMultipleImages', () => {
    it('should map cloud extractions to transactions, one per receipt', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', details: 'set menu', imageIndex: 0, confidence: 0.8,
          receiptId: 1,
        },
        {
          date: '2026-01-16', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 2,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(2);
      expect(result.transactions[0].notes).toBe('set menu');
      expect(result.confidence).toBeCloseTo(0.7);
      expect(result.source).toBe('cloud');
    });

    it('should merge line items of one receipt and record them in the notes', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 1,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].description).toBe('Diner');
      expect(result.transactions[0].amount).toBe(15);
      expect(result.transactions[0].notes).toBe('Lunch — USD 10.00\nSnack — USD 5.00');
      expect(result.transactions[0].fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE });
    });

    it('a consolidated row whose date cannot parse carries date confidence 0 next to its amount grade', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: 'not a date', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 1,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      // The merge has no reported receipt total, so the amount grade is the
      // review-flag confidence the same as the plain merge test above; the
      // unparseable date must carry its own 0 right alongside it.
      expect(result.transactions[0].fieldConfidence).toEqual({ amount: REVIEW_AMOUNT_CONFIDENCE, date: 0 });
    });

    it('honors an incoming zero date grade on a consolidated row', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', dateConfidence: 0, description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1, receiptTotal: 10,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile()]);

      // The date string itself parses fine, so only honoring the producer's
      // own grade — not the unparseable-string check above — can carry this
      // 0 through. The reported receipt total keeps deriveAmount from adding
      // its own review-flag noise to the amount slot.
      expect(result.transactions[0].fieldConfidence).toEqual({ date: 0 });
    });

    it("carries a cloud-read refund's type grade onto its transaction", async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Returned jacket', amount: 40, type: 'income',
          currency: 'USD', merchant: 'Outfitter', imageIndex: 0,
          confidence: 0.8, receiptId: 1, receiptTotal: 40,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile()]);

      expect(result.transactions[0].type).toBe('income');
      // The printed total corroborates the amount, so the type is the only
      // thing graded: the review row is asked about the direction alone.
      expect(result.transactions[0].fieldConfidence).toEqual({ type: MODEL_INCOME_GRADE });
    });

    it('carries which photos each transaction came from', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 1,
        },
        {
          date: '2026-01-16', description: 'Solo', amount: 7, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.9,
          receiptId: 2,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      // The hop to ProcessedTransaction used to drop both fields, so the
      // review step stamped every strategy row "image_0" and the confirm
      // step could not tell whose photo was whose.
      expect(result.transactions[0].mergedFromImages).toEqual([0, 1]);
      expect(result.transactions[1].imageIndex).toBe(1);
      expect('mergedFromImages' in result.transactions[1]).toBeFalse();
    });

    it('should use the reported receipt total as the transaction amount', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 1, receiptTotal: 16.2,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions[0].amount).toBe(16.2);
      expect(result.transactions[0].fieldConfidence).toBeUndefined();
    });

    it('carries a printed location through consolidation onto the row', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', merchant: 'Diner', imageIndex: 0,
          confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6,
          receiptId: 1, location: { name: 'Shibuya 1-2-3' },
        },
        {
          date: '2026-01-16', description: 'Solo', amount: 7, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.9,
          receiptId: 2,
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions[0].location).toEqual({ name: 'Shibuya 1-2-3' });
      expect('location' in result.transactions[1]).toBeFalse();
    });

    it('carries the receipt country through consolidation onto the row', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        { date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense', currency: 'KRW',
          merchant: 'Diner', imageIndex: 0, confidence: 0.8, receiptId: 1 },
        { date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense', currency: 'KRW',
          imageIndex: 1, confidence: 0.6, receiptId: 1, receiptCountry: 'KR' },
        { date: '2026-01-16', description: 'Solo', amount: 7, type: 'expense', currency: 'KRW',
          imageIndex: 1, confidence: 0.9, receiptId: 2 },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions[0].receiptCountry).toBe('KR');
      expect('receiptCountry' in result.transactions[1]).toBeFalse();
    });

    it('should prefer the full receipt details from the AI for merged notes', async () => {
      const extracted: MultiImageExtractedTransaction[] = [
        {
          date: '2026-01-15', description: 'Lunch', amount: 10, type: 'expense',
          currency: 'USD', imageIndex: 0, confidence: 0.8, receiptId: 1,
        },
        {
          date: '2026-01-15', description: 'Snack', amount: 5, type: 'expense',
          currency: 'USD', imageIndex: 1, confidence: 0.6, receiptId: 1,
          receiptDetails: 'Lunch — 10.00\nSnack — 5.00\nTax 1.20\nTotal 16.20',
        },
      ];
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo(extracted);
      const service = createService('web');

      const result = await service.processMultipleImages([imageFile(), imageFile()]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].notes).toBe('Lunch — 10.00\nSnack — 5.00\nTax 1.20\nTotal 16.20');
    });

    it('should process with the native pipeline on iOS', async () => {
      const service = createService('ios');
      const result = await service.processMultipleImages([imageFile()]);

      expect(nativeMock.processImages).toHaveBeenCalled();
      expect(result.source).toBe('native');
    });
  });

  describe('attempt diagnostics', () => {
    // The engine, the fallback, the provider, the duration and the error
    // class are all known here and used to be thrown away — four
    // console.warns and a signal nobody read. This is the one place every
    // door passes through, so it is the one place to record them.
    const unreadable: ProcessingResult = {
      ...nativeResult,
      transactions: [{ ...nativeResult.transactions[0], amount: 0, confidence: 0.1 }],
      confidence: 0.1,
    };

    it('reports a plain cloud run with its provider and a measured duration', async () => {
      const service = createService('web');
      const result = await service.processReceipt(imageFile());

      expect(result.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'cloud', provider: 'gemini',
      }));
      expect('fellBackFrom' in result.diagnostics!).toBeFalse();
      expect(result.diagnostics!.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.diagnostics!.durationMs).toBe(result.processingTimeMs);
      expect(service.lastProcessingTime()).toBe(result.diagnostics!.durationMs);
    });

    it('reports a plain native run with no provider', async () => {
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.diagnostics).toEqual(jasmine.objectContaining({ engine: 'native', provider: null }));
      expect('fellBackFrom' in result.diagnostics!).toBeFalse();
    });

    it('names the engine that fell back when native throws and the cloud answers', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'cloud', fellBackFrom: 'native', provider: 'gemini',
      }));
    });

    it('names the fallback when native read too little and the cloud read it better', async () => {
      nativeMock.processImage.and.resolveTo(unreadable);
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.source).toBe('cloud');
      expect(result.diagnostics).toEqual(jasmine.objectContaining({ engine: 'cloud', fellBackFrom: 'native' }));
    });

    it('records no fallback when the second engine lost and the first result stood', async () => {
      nativeMock.processImage.and.resolveTo(unreadable);
      cloudMock.parseReceipt.and.resolveTo({ ...parsedReceipt, amount: 0, confidence: 0.1 });
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.source).toBe('native');
      expect(result.diagnostics!.engine).toBe('native');
      expect('fellBackFrom' in result.diagnostics!).toBeFalse();
    });

    it('names the fallback when cloud fails on a Mac and native answers', async () => {
      visionMock.isMacEnvironment.and.returnValue(true);
      cloudMock.parseReceipt.and.rejectWith(new Error('rate limited'));
      const service = createService('ios');
      const result = await service.processReceipt(imageFile());

      expect(result.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'native', fellBackFrom: 'cloud', provider: 'gemini',
      }));
    });

    it('throws a ReceiptProcessingError carrying the classified failure when nothing answered', async () => {
      cloudMock.parseReceipt.and.rejectWith(new Error('401 Incorrect API key provided'));
      const service = createService('web');

      const failure = await service.processReceipt(imageFile()).catch(e => e);

      expect(failure).toBeInstanceOf(ReceiptProcessingError);
      // The message is the cause's, so callers comparing sentinels or
      // asserting the provider's wording see exactly what they saw before.
      expect(failure.message).toBe('401 Incorrect API key provided');
      expect(failure.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'cloud', provider: 'gemini', errorType: 'auth', retryable: false,
      }));
      expect(failure.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
      expect(service.lastProcessingTime()).toBe(failure.diagnostics.durationMs);
    });

    it('throws with the fallback recorded when both engines failed', async () => {
      nativeMock.processImage.and.rejectWith(new Error('OCR failed'));
      cloudMock.parseReceipt.and.rejectWith(new Error('503 service unavailable'));
      const service = createService('ios');

      const failure = await service.processReceipt(imageFile()).catch(e => e);

      expect(failure).toBeInstanceOf(ReceiptProcessingError);
      expect(failure.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'cloud', fellBackFrom: 'native', errorType: 'server', retryable: true,
      }));
    });

    it('throws the cloud-unavailable code with no provider when the web has no engine', async () => {
      cloudMock.hasAnyCloudProvider.and.returnValue(false);
      cloudMock.resolveProvider.and.returnValue(null);
      const service = createService('web');

      const failure = await service.processReceipt(imageFile()).catch(e => e);

      expect(failure.message).toBe(AI_CLOUD_UNAVAILABLE);
      expect(failure.diagnostics).toEqual(jasmine.objectContaining({
        engine: 'cloud', provider: null, errorType: 'network',
      }));
    });

    it('reports no provider when the device was offline and nothing was sent', async () => {
      // canUseCloud() is isOnline && hasAnyCloudProvider, but receiptProvider()
      // reads availability alone — so a configured key on an offline phone used
      // to be reported as the provider that answered, for a request
      // ensureCloudAvailable refused to send.
      cloudMock.hasAnyCloudProvider.and.returnValue(true);
      cloudMock.resolveProvider.and.returnValue('gemini');
      pwaMock.isOnline.and.returnValue(false);
      const service = createService('web');

      const failure = await service.processReceipt(imageFile()).catch(e => e);

      expect(failure.message).toBe(AI_CLOUD_UNAVAILABLE);
      expect(failure.diagnostics.provider).toBeNull();
      expect(failure.diagnostics.errorType).toBe('network');
    });

    it('attaches diagnostics to a multi-image result too', async () => {
      cloudMock.extractTransactionsFromMultipleImages.and.resolveTo([]);
      const service = createService('web');
      const result = await service.processMultipleImages([imageFile()]);

      expect(result.diagnostics!.engine).toBe('cloud');
    });
  });

  describe('preferences', () => {
    it('should start with default models', () => {
      const service = createService('web');
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
      expect(service.preferences().visionModel).toBe(DEFAULT_VISION_MODEL);
    });

    it('should persist updated preferences and reinitialize Gemini', () => {
      const service = createService('web');
      service.updatePreferences({ textModel: 'gemma-4-26b-a4b-it' });

      expect(service.preferences().textModel).toBe('gemma-4-26b-a4b-it');
      expect(cloudMock.reinitializeGemini).toHaveBeenCalledWith('gemma-4-26b-a4b-it', DEFAULT_VISION_MODEL);

      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!);
      expect(stored.textModel).toBe('gemma-4-26b-a4b-it');
    });

    // A pin: it passes on arrival, because the first save writes the merged
    // object and not the patch. Nothing is stored until one of the five
    // settings the blob holds changes, auto sync or a model choice, and that
    // change writes every model id and the schema stamp. A later move of the
    // catalog's defaults never reaches this user: the stored ids outrank the
    // defaults, and the migration skips a blob that carries the current stamp.
    it('stores the whole blob, every model id included, on the first change of any one setting', () => {
      const service = createService('web');
      expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();

      service.updatePreferences({ autoSync: false });

      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!);
      expect(stored.autoSync).toBeFalse();
      expect(stored.textModel).toBe(DEFAULT_TEXT_MODEL);
      expect(stored.visionModel).toBe(DEFAULT_VISION_MODEL);
      expect(stored.openaiModel).toBe(DEFAULT_OPENAI_MODEL);
      expect(stored.claudeModel).toBe(DEFAULT_CLAUDE_MODEL);
      expect(stored.schemaVersion).toBe(AI_PREFERENCES_SCHEMA_VERSION);
    });

    // The success arm used to print `[AIStrategy] Models updated
    // successfully:` with both model ids. ADR 0123's rule took it out and
    // no-console keeps it out; the failure arm still errors, and the
    // reinitializeGemini spy above is what says the switch happened.
    it('switches models without narrating the switch', () => {
      const logSpy = spyOn(console, 'log');
      const service = createService('web');

      service.updatePreferences({ textModel: 'gemma-4-26b-a4b-it' });

      expect(cloudMock.reinitializeGemini).toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should revert preferences when Gemini reinitialization fails', () => {
      cloudMock.reinitializeGemini.and.throwError('bad model');
      const service = createService('web');

      expect(() => service.updatePreferences({ visionModel: 'broken-model' }))
        .toThrowError(/Failed to switch AI models/);
      expect(service.preferences().visionModel).toBe(DEFAULT_VISION_MODEL);
    });

    it('should reset preferences to defaults', () => {
      const service = createService('web');
      service.updatePreferences({ autoSync: false });
      service.resetPreferences();

      expect(service.preferences().autoSync).toBeTrue();
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
    });

    it('should load stored preferences over defaults', () => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ autoSync: false }));
      const service = createService('web');

      expect(service.preferences().autoSync).toBeFalse();
      expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
    });

    /**
     * A stored blob outranks the catalog by design, so moving the defaults on
     * does nothing for anyone who has ever changed auto sync or a model
     * choice: that first change stored every model id. These two are the load
     * path either side of the schema stamp.
     */
    describe('a stored blob naming a superseded model', () => {
      /** Default for both text and vision until it was shut down upstream. */
      const RETIRED_DEFAULT = 'gemini-3.1-flash-lite-preview';

      it('should move it onto the current default and rewrite storage', () => {
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
          autoSync: true,
          textModel: RETIRED_DEFAULT,
          visionModel: RETIRED_DEFAULT,
        }));

        const service = createService('web');

        expect(service.preferences().textModel).toBe(DEFAULT_TEXT_MODEL);
        expect(service.preferences().visionModel).toBe(DEFAULT_VISION_MODEL);

        // The rewrite is what makes this a one-time pass. Without the stamp
        // reaching storage, the migration below could never decline to run.
        const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!);
        expect(stored.textModel).toBe(DEFAULT_TEXT_MODEL);
        expect(stored.schemaVersion).toBe(AI_PREFERENCES_SCHEMA_VERSION);
      });

      it('should leave it alone once the blob carries the current stamp', () => {
        // The catalog still offers 3.1 Flash-Lite, so a stamped blob naming it
        // is a deliberate choice. This is the assertion that fails if the
        // merge with DEFAULT_PREFERENCES happens before the migration: the
        // defaults carry the stamp, so a legacy blob would look migrated and
        // the case above would silently stop rewriting anything.
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
          autoSync: true,
          textModel: RETIRED_DEFAULT,
          visionModel: DEFAULT_VISION_MODEL,
          schemaVersion: AI_PREFERENCES_SCHEMA_VERSION,
        }));

        const service = createService('web');

        expect(service.preferences().textModel).toBe(RETIRED_DEFAULT);
        expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!).textModel)
          .toBe(RETIRED_DEFAULT);
      });
    });
  });

  describe('getStatusInfo', () => {
    it('should report the full status snapshot', () => {
      appleMock.isModelAvailable.and.returnValue(true);
      visionMock.isMacEnvironment.and.returnValue(true);
      const service = createService('ios');

      const status = service.getStatusInfo();

      expect(status.cloudAvailable).toBeTrue();
      expect(status.nativeAvailable).toBeTrue();
      expect(status.appleIntelligenceAvailable).toBeTrue();
      expect(status.isMacEnvironment).toBeTrue();
      expect(status.isOnline).toBeTrue();
      expect(status.platform).toBe('ios');
      expect(status.availableProviders).toEqual(['gemini']);
    });
  });
});
