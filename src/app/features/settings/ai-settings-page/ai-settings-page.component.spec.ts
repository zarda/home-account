import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AiSettingsPageComponent } from './ai-settings-page.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  accessibleName,
  catalogTranslator,
  holdsShownWords,
  provideNoMotion,
  runAxe,
  settleAnimations,
  summarizeViolations,
  withTheme,
} from '../../../core/services/testing';
import { DEFAULT_LLM_PROVIDER_PREFERENCES, ProviderSecrets } from '../../../models';

describe('AiSettingsPageComponent', () => {
  let component: AiSettingsPageComponent;
  let fixture: ComponentFixture<AiSettingsPageComponent>;
  let strategyServiceMock: jasmine.SpyObj<AIStrategyService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let pwaServiceMock: jasmine.SpyObj<PwaService>;
  let offlineQueueServiceMock: jasmine.SpyObj<OfflineQueueService>;
  let cloudLLMProviderMock: jasmine.SpyObj<CloudLLMProviderService>;
  let authServiceMock: jasmine.SpyObj<AuthService>;
  let providerKeysMock: jasmine.SpyObj<ProviderKeyService>;
  let categoryMemoryMock: jasmine.SpyObj<CategoryMemoryService>;
  let tagMemoryMock: jasmine.SpyObj<TagMemoryService>;
  // How many merchants each memory holds, which a case can raise.
  let rememberedCategories: WritableSignal<number>;
  let rememberedTags: WritableSignal<number>;
  let providerKeysLoadFailed: ReturnType<typeof signal<boolean>>;
  let providerKeysStored: ReturnType<typeof signal<ProviderSecrets | null>>;
  let announcerMock: jasmine.SpyObj<AnnouncerService>;

  beforeEach(async () => {
    strategyServiceMock = jasmine.createSpyObj('AIStrategyService', [
      'preferences',
      'updatePreferences',
      'canUseCloud',
      'canUseNative',
      'canUseAppleIntelligence',
      'useNativeOCR',
      'platform',
      'applyProviderKey',
    ]);
    strategyServiceMock.applyProviderKey.and.resolveTo(undefined);
    strategyServiceMock.preferences.and.returnValue({
      autoSync: true,
    });
    strategyServiceMock.canUseCloud.and.returnValue(true);
    strategyServiceMock.canUseNative.and.returnValue(false);
    strategyServiceMock.canUseAppleIntelligence.and.returnValue(false);
    strategyServiceMock.useNativeOCR.and.returnValue(false);
    strategyServiceMock.platform.and.returnValue('web');

    pwaServiceMock = jasmine.createSpyObj('PwaService', ['isOnline']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    pwaServiceMock.isOnline.and.returnValue(true);

    offlineQueueServiceMock = jasmine.createSpyObj('OfflineQueueService', [
      'pendingCount',
      'closedForUpgrade',
      'isSyncing',
      'syncQueue',
      'clearAll',
    ]);
    offlineQueueServiceMock.pendingCount.and.returnValue(0);
    offlineQueueServiceMock.closedForUpgrade.and.returnValue(false);
    offlineQueueServiceMock.isSyncing.and.returnValue(false);
    offlineQueueServiceMock.syncQueue.and.returnValue(Promise.resolve({ success: 0, failed: 0 }));
    offlineQueueServiceMock.clearAll.and.returnValue(Promise.resolve());

    cloudLLMProviderMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'isProviderAvailable',
      'updateProviderApiKey',
    ]);
    cloudLLMProviderMock.isProviderAvailable.and.returnValue(false);

    providerKeysLoadFailed = signal(false);
    // The keys the service holds for the account, which a refused save leaves
    // as they were.
    providerKeysStored = signal<ProviderSecrets | null>(null);
    providerKeysMock = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['resolve', 'getKey', 'setKey'],
      { loadFailed: providerKeysLoadFailed, keys: providerKeysStored }
    );
    providerKeysMock.resolve.and.resolveTo({});
    providerKeysMock.getKey.and.resolveTo(undefined);
    providerKeysMock.setKey.and.resolveTo(undefined);

    rememberedCategories = signal(0);
    categoryMemoryMock = jasmine.createSpyObj<CategoryMemoryService>(
      'CategoryMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: rememberedCategories }
    );
    categoryMemoryMock.ensureLoaded.and.resolveTo(undefined);
    categoryMemoryMock.clear.and.resolveTo(undefined);

    rememberedTags = signal(0);
    tagMemoryMock = jasmine.createSpyObj<TagMemoryService>(
      'TagMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: rememberedTags }
    );
    tagMemoryMock.ensureLoaded.and.resolveTo(undefined);
    tagMemoryMock.clear.and.resolveTo(undefined);

    authServiceMock = jasmine.createSpyObj('AuthService', ['currentUser', 'updateUserPreferences']);
    authServiceMock.currentUser.and.returnValue({
      preferences: {
        baseCurrency: 'USD',
        language: 'en',
        dateFormat: 'MM/DD/YYYY',
        theme: 'system',
        defaultCategories: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    authServiceMock.updateUserPreferences.and.returnValue(Promise.resolve());

    announcerMock = jasmine.createSpyObj('AnnouncerService', ['announce']);

    await TestBed.configureTestingModule({
      imports: [
        AiSettingsPageComponent,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIStrategyService, useValue: strategyServiceMock },
        { provide: PwaService, useValue: pwaServiceMock },
        { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: AnnouncerService, useValue: announcerMock },
        { provide: ProviderKeyService, useValue: providerKeysMock },
        { provide: CategoryMemoryService, useValue: categoryMemoryMock },
        { provide: TagMemoryService, useValue: tagMemoryMock },
        provideNoMotion(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AiSettingsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should load preferences on init', () => {
      expect(strategyServiceMock.preferences).toHaveBeenCalled();
    });

    it('should have default autoSync enabled', () => {
      expect(component.autoSync()).toBeTrue();
    });
  });

  describe('auto sync toggle', () => {
    it('should update autoSync when toggled', () => {
      component.onAutoSyncChange(false);

      expect(component.autoSync()).toBeFalse();
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ autoSync: false });
    });
  });

  /**
   * The Auto sync switch is Material's inner `role="switch"` button. Its words
   * are the span beside the toggle, which names it through `aria-labelledby`:
   * Material hands the host's to the button, as the dashboard layout's toggles
   * are named. Each locale renders its catalog's words.
   */
  describe('the Auto sync switch (real template)', () => {
    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`is named by the words beside it, in ${locale}`, async () => {
        const translator = catalogTranslator(locale);
        const translation = TestBed.inject(TranslationService);
        spyOn(translation, 't').and.callFake(translator);
        // The translate pipe memoises on the locale and the catalog version.
        // The bump is what a catalog's arrival does, so en, the locale already
        // set, is read again too.
        translation.currentLocale.set(locale);
        translation.translationsVersion.update(version => version + 1);
        fixture.detectChanges();

        const row = (fixture.nativeElement as HTMLElement).querySelector('.auto-sync-row');
        const toggle = row?.querySelector('button[role="switch"]') ?? null;
        expect(toggle).withContext('the switch').not.toBeNull();
        if (!row || !toggle) return;
        expect(accessibleName(toggle)).toBe(catalogTranslator(locale, { strict: true })('aiPage.autoSync'));
        // Material's empty <label for> stays: the shared pass no longer takes
        // a label it cannot see as the switch's name.
        const violations = summarizeViolations(await runAxe(row));
        expect(violations.filter(line => line.startsWith('button-name'))).withContext(locale).toEqual([]);
      });
    }
  });

  describe('RAG insights level', () => {
    function setPreferences(preferences: Record<string, unknown>): void {
      authServiceMock.currentUser.and.returnValue({
        preferences: {
          baseCurrency: 'USD',
          language: 'en',
          dateFormat: 'MM/DD/YYYY',
          theme: 'system',
          defaultCategories: [],
          ...preferences,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      component.ngOnInit();
    }

    it('loads off when the user has no RAG preferences', () => {
      expect(component.ragInsightsLevel()).toBe('off');
    });

    it('loads standard for the legacy boolean', () => {
      setPreferences({ enableRagInsights: true });
      expect(component.ragInsightsLevel()).toBe('standard');
    });

    it('loads an explicitly stored level', () => {
      setPreferences({ ragInsightsLevel: 'deep' });
      expect(component.ragInsightsLevel()).toBe('deep');
    });

    it('dual-writes the level and the legacy boolean on change', async () => {
      await component.onRagLevelChange('light');

      expect(component.ragInsightsLevel()).toBe('light');
      expect(authServiceMock.updateUserPreferences).toHaveBeenCalledWith(
        jasmine.objectContaining({ ragInsightsLevel: 'light', enableRagInsights: true }));
    });

    it('maps off to a disabled legacy boolean', async () => {
      await component.onRagLevelChange('off');

      expect(authServiceMock.updateUserPreferences).toHaveBeenCalledWith(
        jasmine.objectContaining({ ragInsightsLevel: 'off', enableRagInsights: false }));
    });

    it('ignores unknown levels without saving', async () => {
      await component.onRagLevelChange('bogus' as never);

      expect(authServiceMock.updateUserPreferences).not.toHaveBeenCalled();
      expect(component.ragInsightsLevel()).toBe('off');
    });
  });

  describe('storage card', () => {
    // .storage-icon also decorates the category- and tag-memory cards, so
    // the title text is what actually singles out the Storage Info card.
    function findStorageCard(): HTMLElement {
      const cards = Array.from(
        fixture.nativeElement.querySelectorAll('mat-card')
      ) as HTMLElement[];
      const card = cards.find(
        (c) =>
          c.querySelector('.storage-icon') &&
          c.querySelector('mat-card-title')?.textContent?.trim() === 'aiPage.storageInfo'
      );
      if (!card) throw new Error('Storage Info card not found');
      return card;
    }

    it('shows only the platform row once the cache row is removed', () => {
      const rows = findStorageCard().querySelectorAll('.info-row');

      expect(rows.length).toBe(1);
      expect(rows[0].querySelector('.info-label')!.textContent!.trim()).toBe('aiPage.platform');
      expect(fixture.nativeElement.textContent).not.toContain('aiPage.totalCache');
    });
  });

  describe('navigation', () => {
    it('should have goBack method', () => {
      expect(component.goBack).toBeDefined();
    });
  });

  describe('queue operations', () => {
    it('should sync queue', async () => {
      await component.syncQueue();
      expect(offlineQueueServiceMock.syncQueue).toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledWith('aiPage.queueSynced');
    });

    it('should clear queue', async () => {
      await component.clearQueue();
      expect(offlineQueueServiceMock.clearAll).toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledWith('aiPage.queueCleared');
    });

    it('should announce sync failures assertively with a translated message', async () => {
      offlineQueueServiceMock.syncQueue.and.returnValue(Promise.reject(new Error('offline')));
      await component.syncQueue();
      expect(notifications.error).toHaveBeenCalledWith('aiPage.queueSyncFailed');
    });

    it('should announce clear failures assertively with a translated message', async () => {
      offlineQueueServiceMock.clearAll.and.returnValue(Promise.reject(new Error('offline')));
      await component.clearQueue();
      expect(notifications.error).toHaveBeenCalledWith('aiPage.queueClearFailed');
    });

    // pendingQueueCount() already disables Sync at zero, so both cases below
    // set it above zero first — a fresh component instance, because the
    // mock's pendingCount is a plain spy rather than a signal, and the
    // computed that reads it never recomputes after its first read.
    function renderWithQueue(pendingCount: number, closedForUpgrade: boolean): ComponentFixture<AiSettingsPageComponent> {
      offlineQueueServiceMock.pendingCount.and.returnValue(pendingCount);
      offlineQueueServiceMock.closedForUpgrade.and.returnValue(closedForUpgrade);
      const localFixture = TestBed.createComponent(AiSettingsPageComponent);
      localFixture.detectChanges();
      return localFixture;
    }

    function findSyncButton(localFixture: ComponentFixture<AiSettingsPageComponent>): HTMLButtonElement {
      const buttons: HTMLButtonElement[] = Array.from(localFixture.nativeElement.querySelectorAll('button'));
      const syncButton = buttons.find(b => b.textContent?.includes('aiPage.syncNow'));
      if (!syncButton) throw new Error('sync button not found');
      return syncButton;
    }

    function findClearButton(localFixture: ComponentFixture<AiSettingsPageComponent>): HTMLButtonElement {
      const buttons: HTMLButtonElement[] = Array.from(localFixture.nativeElement.querySelectorAll('button'));
      const clearButton = buttons.find(b => b.textContent?.includes('aiPage.clearQueue'));
      if (!clearButton) throw new Error('clear button not found');
      return clearButton;
    }

    it('asks for a reload and disables Sync when the queue closed for an upgrade', () => {
      const localFixture = renderWithQueue(3, true);
      const note: HTMLElement | null = localFixture.nativeElement.querySelector('.queue-note');
      expect(note?.textContent).toContain('aiPage.queueClosedReload');
      expect(findSyncButton(localFixture).disabled).toBeTrue();
    });

    it('shows no note and leaves Sync enabled while the queue is open', () => {
      const localFixture = renderWithQueue(3, false);
      expect(localFixture.nativeElement.querySelector('.queue-note')).toBeNull();
      expect(findSyncButton(localFixture).disabled).toBeFalse();
    });

    // Pin. A save in flight must not lock the drain's own button: the drain
    // waits for the key's bring-up by itself, so Sync Now stays enabled while a
    // key is being saved.
    it('leaves Sync enabled while a key save is still in flight', async () => {
      const f = renderWithQueue(3, false);
      await f.whenStable();
      let release: () => void = () => undefined;
      strategyServiceMock.applyProviderKey.and.returnValue(new Promise<void>(resolve => { release = resolve; }));
      try {
        const input: HTMLInputElement = f.nativeElement.querySelector('.provider-card input');
        input.dispatchEvent(new Event('blur'));

        expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledWith('gemini', undefined);
        // No auto-detect in a zone-mode fixture: without this the read below
        // sees the template as it was before the save began.
        f.detectChanges();
        expect(findSyncButton(f).disabled).toBeFalse();
      } finally {
        release();
      }
    });

    it('disables Sync while a sync is already running', () => {
      offlineQueueServiceMock.isSyncing.and.returnValue(true);
      const localFixture = renderWithQueue(3, false);
      expect(findSyncButton(localFixture).disabled).toBeTrue();
    });

    it('does not report a sync it did not run while one is already running', async () => {
      // The disabled button is not the guard: a second press landing before
      // the first one's render, or a keyboard activation, still reaches the
      // method, and the service then returns early with nothing synced.
      const syncing = signal(true);
      offlineQueueServiceMock.isSyncing.and.callFake(syncing);
      const page = renderWithQueue(3, false).componentInstance;

      await page.syncQueue();

      expect(offlineQueueServiceMock.syncQueue).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();

      // Positive proof: the same page, once the running sync ends, does sync
      // and says so.
      syncing.set(false);
      await page.syncQueue();

      expect(offlineQueueServiceMock.syncQueue).toHaveBeenCalledTimes(1);
      expect(notifications.success).toHaveBeenCalledOnceWith('aiPage.queueSynced');
    });

    it('disables Clear when the queue closed for an upgrade', () => {
      const localFixture = renderWithQueue(3, true);
      expect(findClearButton(localFixture).disabled).toBeTrue();
    });

    it('leaves Clear enabled while the queue is open', () => {
      const localFixture = renderWithQueue(3, false);
      expect(findClearButton(localFixture).disabled).toBeFalse();
    });

    it('does not report a queue it cannot reach as cleared', async () => {
      // The disabled button is not the guard: a keyboard activation racing
      // the close, or any other caller, still reaches the method.
      const closed = renderWithQueue(3, true).componentInstance;

      await closed.clearQueue();

      expect(offlineQueueServiceMock.clearAll).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    });
  });

  describe('model selection', () => {
    it('should announce a translated confirmation when the text model changes', () => {
      const modelId = component.textModels[0].id;
      component.onTextModelChange(modelId);
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ textModel: modelId });
      expect(notifications.success).toHaveBeenCalledWith('aiPage.textModelUpdated');
    });

    it('should announce a translated confirmation when the vision model changes', () => {
      const modelId = component.visionModels[0].id;
      component.onVisionModelChange(modelId);
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ visionModel: modelId });
      expect(notifications.success).toHaveBeenCalledWith('aiPage.visionModelUpdated');
    });

    it('should announce a translated error for an invalid model selection', () => {
      component.onTextModelChange('not-a-real-model');
      expect(notifications.error).toHaveBeenCalledWith('aiPage.invalidModelSelection');
      expect(strategyServiceMock.updatePreferences).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ textModel: 'not-a-real-model' })
      );
    });
  });

  describe('platform detection', () => {
    it('should detect web platform', () => {
      expect(component.platform()).toBe('web');
    });

    it('should show cloud AI available', () => {
      expect(component.canUseCloud()).toBeTrue();
    });

    it('should not show native AI on web', () => {
      expect(component.canUseNative()).toBeFalse();
    });
  });

  describe('provider API keys', () => {
    // The button's own aria-label names it in both states, so the spinner
    // is hidden rather than named — see check-icon-labels.mjs.
    it('hides the test-button spinner from the accessibility tree', () => {
      component.isTestingGemini.set(true);
      fixture.detectChanges();

      const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
      const button = buttons.find((b) => b.querySelector('mat-spinner')) as HTMLButtonElement;

      expect(button.querySelector('mat-spinner')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('names the test button by its provider while busy and while idle alike', () => {
      const translation = TestBed.inject(TranslationService);
      spyOn(translation, 't').and.callFake(catalogTranslator('en'));
      translation.translationsVersion.update(version => version + 1);
      const providers: {
        flag: 'isTestingGemini' | 'isTestingOpenai' | 'isTestingClaude';
        cardIndex: number;
        name: string;
      }[] = [
        { flag: 'isTestingGemini', cardIndex: 0, name: 'Test Key for Gemini' },
        { flag: 'isTestingOpenai', cardIndex: 1, name: 'Test Key for OpenAI' },
        { flag: 'isTestingClaude', cardIndex: 2, name: 'Test Key for Claude' },
      ];

      for (const { flag, cardIndex, name } of providers) {
        const card = fixture.nativeElement.querySelectorAll('.provider-card')[cardIndex] as HTMLElement;
        const button = card.querySelector('mat-card-actions button') as HTMLButtonElement;

        component[flag].set(true);
        fixture.detectChanges();
        expect(button.getAttribute('aria-busy')).withContext(flag).toBe('true');
        expect(button.getAttribute('aria-label')).withContext(`${flag} busy`).toBe(name);

        component[flag].set(false);
        fixture.detectChanges();
        expect(button.getAttribute('aria-busy')).withContext(flag).not.toBe('true');
        expect(button.getAttribute('aria-label')).withContext(`${flag} idle`).toBe(name);
      }
    });

    /**
     * The three provider cards stand side by side, each with a key field, a
     * remove for its key, a Get API Key link and a Test Key button, so each
     * of the four names its provider and none reads as another card's. The
     * link and the button keep the words they show inside the name, so a
     * voice user can say what they see (WCAG 2.5.3); the field is named by
     * its label, which shows the provider. Every key is set, so every card
     * shows its remove and an enabled Test Key. Once its provider is
     * configured, the OpenAI card and the Claude card each show a model
     * select too, named by its label as the field is; the Gemini card's two
     * say what each picks a model for, and no other card has them.
     */
    describe('each card names its provider (real template)', () => {
      const PROVIDERS = ['Gemini', 'OpenAI', 'Claude'];
      /** The providers whose card holds one model select. */
      const MODEL_PROVIDERS = ['OpenAI', 'Claude'];
      const pinned = {
        en: {
          remove: ['Remove the Gemini API key', 'Remove the OpenAI API key', 'Remove the Claude API key'],
          field: ['Gemini API key', 'OpenAI API key', 'Claude API key'],
          link: ['Get API Key for Gemini', 'Get API Key for OpenAI', 'Get API Key for Claude'],
          test: ['Test Key for Gemini', 'Test Key for OpenAI', 'Test Key for Claude'],
          model: ['OpenAI model', 'Claude model'],
        },
        ja: {
          remove: ['GeminiのAPIキーを削除', 'OpenAIのAPIキーを削除', 'ClaudeのAPIキーを削除'],
          field: ['Gemini APIキー', 'OpenAI APIキー', 'Claude APIキー'],
          link: ['GeminiのAPIキーを取得', 'OpenAIのAPIキーを取得', 'ClaudeのAPIキーを取得'],
          test: ['Geminiのキーをテスト', 'OpenAIのキーをテスト', 'Claudeのキーをテスト'],
          model: ['OpenAI モデル', 'Claude モデル'],
        },
        tc: {
          remove: ['移除 Gemini API 金鑰', '移除 OpenAI API 金鑰', '移除 Claude API 金鑰'],
          field: ['Gemini API 金鑰', 'OpenAI API 金鑰', 'Claude API 金鑰'],
          link: ['前往 Gemini 取得 API 金鑰', '前往 OpenAI 取得 API 金鑰', '前往 Claude 取得 API 金鑰'],
          test: ['測試金鑰：Gemini', '測試金鑰：OpenAI', '測試金鑰：Claude'],
          model: ['OpenAI 模型', 'Claude 模型'],
        },
      } as const;

      /** Renders `locale`'s words, with a key set for every provider. */
      function speak(locale: 'en' | 'ja' | 'tc'): HTMLElement[] {
        const translation = TestBed.inject(TranslationService);
        spyOn(translation, 't').and.callFake(catalogTranslator(locale));
        // The translate pipe memoises on the locale and the catalog version.
        translation.currentLocale.set(locale);
        translation.translationsVersion.update(version => version + 1);
        component.geminiApiKey.set('g-key');
        component.openaiApiKey.set('o-key');
        component.claudeApiKey.set('c-key');
        fixture.detectChanges();
        const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.provider-card'));
        expect(cards.length).withContext('the provider cards').toBe(3);
        return cards;
      }

      /** The words a control shows: its label's text, an icon's ligature left out. */
      const shownBy = (control: Element) =>
        (control.querySelector('.mdc-button__label') ?? control).textContent!.replace(/\s+/g, ' ').trim();

      for (const locale of ['en', 'ja', 'tc'] as const) {
        it(`names each key's remove by its provider, in ${locale}`, () => {
          const cards = speak(locale);
          const removes = cards.map(card => card.querySelector('.api-key-field button'));
          expect(removes.every(remove => remove !== null)).withContext('a remove on every card').toBeTrue();
          const names = removes.map(remove => accessibleName(remove!));
          names.forEach((name, i) => expect(name).withContext(`remove ${i} names ${PROVIDERS[i]}`).toContain(PROVIDERS[i]));
          expect(new Set(names).size).withContext(`three names: ${names.join(' / ')}`).toBe(3);
          expect(names).withContext('pinned').toEqual([...pinned[locale].remove]);
          const t = catalogTranslator(locale, { strict: true });
          expect(names).toEqual(PROVIDERS.map(provider => t('settings.removeApiKey', { provider })));
        });

        it(`names each field, Get API Key link and Test Key button by its provider, holding the words it shows, in ${locale}`, () => {
          const cards = speak(locale);
          const t = catalogTranslator(locale, { strict: true });
          const read = (kind: 'field' | 'link' | 'test', control: (card: HTMLElement) => Element | null, shown: (control: Element) => string) => {
            const controls = cards.map(control);
            expect(controls.every(found => found !== null)).withContext(`a ${kind} on every card`).toBeTrue();
            const names = controls.map(found => accessibleName(found!));
            names.forEach((name, i) => {
              const words = shown(controls[i]!);
              expect(name).withContext(`${kind} ${i} names ${PROVIDERS[i]}`).toContain(PROVIDERS[i]);
              expect(holdsShownWords(name, words, locale)).withContext(`"${name}" holds "${words}" whole`).toBeTrue();
            });
            expect(new Set(names).size).withContext(`three ${kind} names: ${names.join(' / ')}`).toBe(3);
            expect(names).withContext(`${kind}, pinned`).toEqual([...pinned[locale][kind]]);
            return names;
          };

          const fields = read(
            'field',
            card => card.querySelector('.api-key-field input'),
            input => input.closest('mat-form-field')!.querySelector('mat-label')!.textContent!.trim(),
          );
          const links = read('link', card => card.querySelector('mat-card-actions a'), shownBy);
          const tests = read('test', card => card.querySelector('mat-card-actions button'), shownBy);
          expect(cards.map(card => [card.querySelector('mat-card-actions a')!, card.querySelector('mat-card-actions button')!].map(shownBy)))
            .withContext('each link and Test Key shows its words as before')
            .toEqual(PROVIDERS.map(() => [t('settings.getApiKey'), t('settings.testApiKey')]));

          // Busy, a Test Key shows a spinner in place of its words and keeps its name.
          component.isTestingGemini.set(true);
          component.isTestingOpenai.set(true);
          component.isTestingClaude.set(true);
          fixture.detectChanges();
          expect(cards.map(card => accessibleName(card.querySelector('mat-card-actions button')!)))
            .withContext('busy')
            .toEqual([...pinned[locale].test]);

          expect(fields).toEqual(PROVIDERS.map(provider => t('settings.apiKeyFor', { provider })));
          expect(links).toEqual(PROVIDERS.map(provider => t('settings.getApiKeyFor', { provider })));
          expect(tests).toEqual(PROVIDERS.map(provider => t('settings.testApiKeyFor', { provider })));
        });

        it(`names the OpenAI and Claude model selects by their provider, in ${locale}`, () => {
          // A card shows its model select once its provider is configured.
          cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);
          const cards = speak(locale);
          const selects = cards.slice(1).map(card => card.querySelector('.model-field mat-select'));
          expect(selects.every(select => select !== null)).withContext('a model select on the OpenAI and Claude cards').toBeTrue();
          const names = selects.map(select => accessibleName(select!));
          names.forEach((name, i) => {
            const label = selects[i]!.closest('mat-form-field')!.querySelector('mat-label')!.textContent!.trim();
            expect(name).withContext(`model ${i} names ${MODEL_PROVIDERS[i]}`).toContain(MODEL_PROVIDERS[i]);
            expect(name).withContext(`model ${i} is named by the label it shows`).toBe(label);
          });
          expect(new Set(names).size).withContext(`two model names: ${names.join(' / ')}`).toBe(2);
          expect(names).withContext('model, pinned').toEqual([...pinned[locale].model]);
          const t = catalogTranslator(locale, { strict: true });
          expect(names).toEqual(MODEL_PROVIDERS.map(provider => t('settings.modelFor', { provider })));
        });
      }
    });

    it('loads the stored keys into the form', async () => {
      providerKeysMock.resolve.and.resolveTo({ gemini: 'g-key', claude: 'c-key' });

      await component['loadApiKeys']();

      expect(component.geminiApiKey()).toBe('g-key');
      expect(component.claudeApiKey()).toBe('c-key');
      expect(component.openaiApiKey()).toBe('');
    });

    // Keys go to the secrets document, never back onto the preferences map. The
    // page hands the key to the strategy, which does the write itself and chains
    // the bring-up; the page neither writes the document nor re-arms the provider.
    it('saves a key through the strategy, not the secrets store or user preferences', async () => {
      component.geminiApiKey.set('new-key');

      await component.onGeminiApiKeyChange();

      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('gemini', 'new-key');
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
      expect(cloudLLMProviderMock.updateProviderApiKey).not.toHaveBeenCalled();
      expect(authServiceMock.updateUserPreferences).not.toHaveBeenCalled();
    });

    it('saves an OpenAI key through the strategy', async () => {
      component.openaiApiKey.set('o-key');

      await component.onOpenaiApiKeyChange();

      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('openai', 'o-key');
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
      expect(cloudLLMProviderMock.updateProviderApiKey).not.toHaveBeenCalled();
    });

    it('clears a key when the field is emptied', async () => {
      component.claudeApiKey.set('');

      await component.onClaudeApiKeyChange();

      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('claude', undefined);
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
    });

    // The fields render blank when the keys could not be read, so accepting a
    // save here would write that blankness over the stored keys.
    it('saves nothing until the stored keys have actually been read', async () => {
      component.keysLoaded.set(false);
      component.geminiApiKey.set('');

      await component.onGeminiApiKeyChange();

      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
      expect(strategyServiceMock.applyProviderKey).not.toHaveBeenCalled();
    });

    describe('when the save is refused', () => {
      beforeEach(() => component.keysLoaded.set(true));

      it('says so in a translated notice and keeps what was typed', async () => {
        strategyServiceMock.applyProviderKey.and.rejectWith(new Error('permission-denied'));
        const logged = spyOn(console, 'error');
        component.geminiApiKey.set('typed-key');

        await component.onGeminiApiKeyChange();

        expect(notifications.error).toHaveBeenCalledOnceWith('aiPage.keySaveFailed');
        expect(component.geminiApiKey()).toBe('typed-key');
        expect(logged).toHaveBeenCalledWith('[AI Settings] API key not saved:', jasmine.any(Error));
      });

      it('reports the refusal for every provider', async () => {
        strategyServiceMock.applyProviderKey.and.rejectWith(new Error('permission-denied'));
        spyOn(console, 'error');
        component.openaiApiKey.set('o-typed');
        component.claudeApiKey.set('c-typed');

        await component.onOpenaiApiKeyChange();
        await component.onClaudeApiKeyChange();

        expect(notifications.error).toHaveBeenCalledTimes(2);
        expect(notifications.error.calls.allArgs()).toEqual([['aiPage.keySaveFailed'], ['aiPage.keySaveFailed']]);
      });

      it('lets no rejection out of a clear', async () => {
        strategyServiceMock.applyProviderKey.and.rejectWith(new Error('permission-denied'));
        // Zone.js hands a rejection nobody caught to console.error as the bare
        // value (no "Unhandled Promise rejection" prefix); it never reaches
        // window's unhandledrejection. So the spy is the detector, and the
        // page's own line must be the only one.
        const logged = spyOn(console, 'error');
        component.geminiApiKey.set('key');

        component.clearGeminiApiKey();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        // Positive proof that the clear reached the save and the notice, so the
        // single line below is the whole story and not a rejection still in flight.
        expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('gemini', undefined);
        expect(notifications.error).toHaveBeenCalledOnceWith('aiPage.keySaveFailed');
        expect(logged.calls.allArgs()).toEqual([['[AI Settings] API key not saved:', jasmine.any(Error)]]);
      });

      it('shows the stored key again, with its clear button, after a refused clear', async () => {
        // The key is still stored and armed; an empty field would say it was gone.
        strategyServiceMock.applyProviderKey.and.rejectWith(new Error('permission-denied'));
        spyOn(console, 'error');
        providerKeysStored.set({ gemini: 'stored-key' });
        component.geminiApiKey.set('stored-key');
        fixture.detectChanges();
        const clear = () =>
          (fixture.nativeElement as HTMLElement).querySelector('.api-key-field')!.querySelector<HTMLButtonElement>('button');

        clear()!.click();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        fixture.detectChanges();

        expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('gemini', undefined);
        expect(notifications.error).toHaveBeenCalledOnceWith('aiPage.keySaveFailed');
        expect(component.geminiApiKey()).toBe('stored-key');
        expect(clear()).withContext('the clear button').not.toBeNull();
      });

      it('leaves a field typed into during a refused clear as it was typed', async () => {
        let refuse!: (error: Error) => void;
        strategyServiceMock.applyProviderKey.and.returnValue(new Promise<void>((_, reject) => (refuse = reject)));
        spyOn(console, 'error');
        providerKeysStored.set({ gemini: 'stored-key' });
        component.geminiApiKey.set('stored-key');

        component.clearGeminiApiKey();
        component.geminiApiKey.set('new-typing');
        refuse(new Error('permission-denied'));
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(notifications.error).toHaveBeenCalledOnceWith('aiPage.keySaveFailed');
        expect(component.geminiApiKey()).toBe('new-typing');
      });

      it('leaves a field emptied by hand during a refused typed save empty', async () => {
        // Only a refused clear shows the stored key again: the emptied field
        // is the user's own edit, which its next blur saves.
        let refuse!: (error: Error) => void;
        strategyServiceMock.applyProviderKey.and.returnValue(new Promise<void>((_, reject) => (refuse = reject)));
        spyOn(console, 'error');
        providerKeysStored.set({ gemini: 'stored-key' });
        component.geminiApiKey.set('typed-key');

        const saved = component.onGeminiApiKeyChange();
        component.geminiApiKey.set('');
        refuse(new Error('permission-denied'));
        await saved;

        expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('gemini', 'typed-key');
        expect(notifications.error).toHaveBeenCalledOnceWith('aiPage.keySaveFailed');
        expect(component.geminiApiKey()).toBe('');
      });
    });

    it('reports a failed load instead of showing empty fields as truth', async () => {
      providerKeysMock.resolve.and.resolveTo({});
      providerKeysLoadFailed.set(true);

      await component['loadApiKeys']();

      expect(component.keysLoaded()).toBe(false);
      expect(notifications.error).toHaveBeenCalled();
    });
  });

  describe('provider preferences', () => {
    /**
     * The card is gated on more than one configured provider, and the gate is
     * a computed over a plain method call — it settles on the first read, so
     * the count has to be true before the component is ever rendered.
     */
    function withProvidersConfigured(): ComponentFixture<AiSettingsPageComponent> {
      cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);
      const configured = TestBed.createComponent(AiSettingsPageComponent);
      configured.detectChanges();
      return configured;
    }

    it('offers a provider for note translation alongside the other four', () => {
      const configured = withProvidersConfigured();

      const labels = Array.from(
        configured.nativeElement.querySelectorAll('.provider-preferences-grid mat-label'),
        (el: Element) => el.textContent!.trim()
      );

      expect(labels).toContain('settings.translationProvider');
      expect(labels.length).withContext('one select per feature that calls a model').toBe(5);
    });

    it('saves the chosen translation provider', async () => {
      component.llmProviderPreferences.translation = 'claude';

      await component.onProviderPreferenceChange();

      expect(authServiceMock.updateUserPreferences).toHaveBeenCalledWith({
        llmProviderPreferences: jasmine.objectContaining({ translation: 'claude' }),
      });
    });

    it('never hands a select the shared defaults to write into', () => {
      // Until ngOnInit replaces it the field holds whatever the initialiser
      // gave it, and [(ngModel)] writes straight through. Aliasing the
      // constant made every later default assertion in the bundle read
      // whatever a select on this page last chose.
      const fresh = TestBed.createComponent(AiSettingsPageComponent).componentInstance;

      expect(fresh.llmProviderPreferences).not.toBe(DEFAULT_LLM_PROVIDER_PREFERENCES);
      expect(fresh.llmProviderPreferences).toEqual(DEFAULT_LLM_PROVIDER_PREFERENCES);
    });
  });

  describe('remembered tags', () => {
    it('loads what is already remembered when the page opens', () => {
      // The count is display-only, so it is fetched alongside the keys rather
      // than awaited ahead of them.
      expect(tagMemoryMock.ensureLoaded).toHaveBeenCalled();
    });

    it('forgets every remembered merchant and says so', async () => {
      await component.clearTagMemory();

      expect(tagMemoryMock.clear).toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledWith('aiPage.tagMemoryCleared');
      expect(component.clearingTagMemory()).toBeFalse();
    });

    it('reports a failed clear and stops spinning', async () => {
      tagMemoryMock.clear.and.rejectWith(new Error('offline'));

      await component.clearTagMemory();

      expect(notifications.error).toHaveBeenCalled();
      expect(component.clearingTagMemory()).toBeFalse();
    });
  });

  describe('grid tracks (#450)', () => {
    // Both grids switch at 600px; Karma's headless window is what makes the
    // switched rule (not the single-column default) the one under test.
    let configuredHost: HTMLElement | undefined;

    afterEach(() => {
      configuredHost?.remove();
      configuredHost = undefined;
    });

    function columnsOf(host: HTMLElement, selector: string): number {
      const grid = host.querySelector(selector) as HTMLElement;
      return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    }

    it('lays the provider-preferences grid out in three columns', () => {
      expect(window.innerWidth)
        .withContext('Karma window; the >=600px provider-preferences-grid rule is what renders')
        .toBeGreaterThanOrEqual(600);

      cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);
      const configured = TestBed.createComponent(AiSettingsPageComponent);
      configuredHost = configured.nativeElement as HTMLElement;
      document.body.appendChild(configuredHost);
      configured.detectChanges();

      expect(columnsOf(configured.nativeElement, '.provider-preferences-grid'))
        .withContext('.provider-preferences-grid computed column count at >=600px')
        .toBe(3);
    });

    it('lays the info-cards grid out in two columns', () => {
      expect(window.innerWidth)
        .withContext('Karma window; the >=600px info-cards-grid rule is what renders')
        .toBeGreaterThanOrEqual(600);

      expect(columnsOf(fixture.nativeElement, '.info-cards-grid'))
        .withContext('.info-cards-grid computed column count at >=600px')
        .toBe(2);
    });
  });
  describe('the status line', () => {
    /**
     * `aiStatusText` is a computed over plain service *methods*, not signals,
     * so its dependency set is empty and it memoizes on first read — which
     * the suite's own `fixture.detectChanges()` has already done. Changing a
     * spy afterwards can never reach it. A fresh component is the only way
     * to evaluate it against a different platform.
     */
    function statusWith(): string {
      return TestBed.createComponent(AiSettingsPageComponent).componentInstance.aiStatusText();
    }

    it('names Apple Intelligence when native OCR is backed by it', () => {
      strategyServiceMock.useNativeOCR.and.returnValue(true);
      strategyServiceMock.canUseAppleIntelligence.and.returnValue(true);

      expect(statusWith()).toBe('aiPage.appleIntelligenceReady');
    });

    it('falls back to plain native OCR when Apple Intelligence is absent', () => {
      strategyServiceMock.useNativeOCR.and.returnValue(true);
      strategyServiceMock.canUseAppleIntelligence.and.returnValue(false);

      expect(statusWith()).toBe('aiPage.nativeOCRReady');
    });

    it('reports cloud AI when no native engine is preferred', () => {
      strategyServiceMock.useNativeOCR.and.returnValue(false);
      strategyServiceMock.canUseCloud.and.returnValue(true);

      expect(statusWith()).toBe('aiPage.cloudAIReady');
    });

    it('blames the network rather than the configuration when offline', () => {
      // Offline with no cloud key is not the same statement as "you have not
      // configured this": one is fixed by a key, the other by a signal.
      strategyServiceMock.useNativeOCR.and.returnValue(false);
      strategyServiceMock.canUseCloud.and.returnValue(false);
      pwaServiceMock.isOnline.and.returnValue(false);

      expect(statusWith()).toBe('aiPage.offline');
    });

    it('asks for configuration when online with nothing set up', () => {
      strategyServiceMock.useNativeOCR.and.returnValue(false);
      strategyServiceMock.canUseCloud.and.returnValue(false);
      pwaServiceMock.isOnline.and.returnValue(true);

      expect(statusWith()).toBe('aiPage.configureRequired');
    });
  });

  describe('per-provider model choice', () => {
    it('stores an OpenAI model the list knows and says so', () => {
      component.onOpenaiModelChange('gpt-5.4');

      expect(component.selectedOpenaiModel()).toBe('gpt-5.4');
      expect(strategyServiceMock.updatePreferences)
        .toHaveBeenCalledWith({ openaiModel: 'gpt-5.4' });
      expect(notifications.success).toHaveBeenCalledWith('aiPage.openaiModelUpdated');
    });

    it('ignores an OpenAI model id that is not on the list', () => {
      const before = component.selectedOpenaiModel();

      component.onOpenaiModelChange('gpt-nonexistent');

      expect(component.selectedOpenaiModel()).toBe(before);
      expect(strategyServiceMock.updatePreferences).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('stores a Claude model the list knows and says so', () => {
      const known = component.claudeModels[1].id;

      component.onClaudeModelChange(known);

      expect(component.selectedClaudeModel()).toBe(known);
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ claudeModel: known });
      expect(notifications.success).toHaveBeenCalledWith('aiPage.claudeModelUpdated');
    });

    it('ignores a Claude model id that is not on the list', () => {
      const before = component.selectedClaudeModel();

      component.onClaudeModelChange('claude-nonexistent');

      expect(component.selectedClaudeModel()).toBe(before);
      expect(strategyServiceMock.updatePreferences).not.toHaveBeenCalled();
    });

    it('refuses an unknown text model with an error, before touching preferences', () => {
      component.onTextModelChange('not-a-model');

      expect(notifications.error).toHaveBeenCalledWith('aiPage.invalidModelSelection');
      expect(strategyServiceMock.updatePreferences).not.toHaveBeenCalled();
    });

    it('refuses an unknown vision model the same way', () => {
      component.onVisionModelChange('not-a-model');

      expect(notifications.error).toHaveBeenCalledWith('aiPage.invalidModelSelection');
      expect(strategyServiceMock.updatePreferences).not.toHaveBeenCalled();
    });

    it('reverts the shown text model when storing it throws', () => {
      // The select has already moved by the time the write fails, so the
      // handler has to put the displayed value back or the page lies about
      // what is stored.
      strategyServiceMock.preferences.and.returnValue({ autoSync: true, textModel: component.textModels[0].id });
      strategyServiceMock.updatePreferences.and.throwError('denied');
      const other = component.textModels[1].id;

      component.onTextModelChange(other);

      expect(notifications.error).toHaveBeenCalledWith('aiPage.textModelUpdateFailed');
      expect(component.selectedTextModel()).toBe(component.textModels[0].id);
    });

    it('reverts the shown vision model when storing it throws', () => {
      strategyServiceMock.preferences.and.returnValue({ autoSync: true, visionModel: component.visionModels[0].id });
      strategyServiceMock.updatePreferences.and.throwError('denied');
      const other = component.visionModels[1].id;

      component.onVisionModelChange(other);

      expect(notifications.error).toHaveBeenCalledWith('aiPage.visionModelUpdateFailed');
      expect(component.selectedVisionModel()).toBe(component.visionModels[0].id);
    });
  });

  describe('testing a provider key', () => {
    beforeEach(() => component.keysLoaded.set(true));

    it('does nothing at all without a key to test', async () => {
      component.geminiApiKey.set('');

      await component.testGeminiApiKey();

      expect(cloudLLMProviderMock.updateProviderApiKey).not.toHaveBeenCalled();
      expect(component.geminiTestResult()).toBeNull();
    });

    it('reports success when the provider becomes available', async () => {
      component.geminiApiKey.set('key');
      cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);

      await component.testGeminiApiKey();

      expect(component.geminiTestResult()).toBe('success');
      expect(component.isTestingGemini()).toBeFalse();
    });

    it('reports failure when the provider stays unavailable', async () => {
      component.geminiApiKey.set('key');
      cloudLLMProviderMock.isProviderAvailable.and.returnValue(false);

      await component.testGeminiApiKey();

      expect(component.geminiTestResult()).toBe('error');
      expect(component.isTestingGemini()).toBeFalse();
    });

    it('reports failure, and lowers the flag, when the update throws', async () => {
      component.geminiApiKey.set('key');
      cloudLLMProviderMock.updateProviderApiKey.and.rejectWith(new Error('network'));

      await component.testGeminiApiKey();

      expect(component.geminiTestResult()).toBe('error');
      expect(component.isTestingGemini()).toBeFalse();
    });

    it('tests an OpenAI key the same way', async () => {
      component.openaiApiKey.set('key');
      cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);

      await component.testOpenaiApiKey();

      expect(component.openaiTestResult()).toBe('success');
      expect(component.isTestingOpenai()).toBeFalse();
    });

    it('reports an OpenAI failure and lowers the flag', async () => {
      component.openaiApiKey.set('key');
      cloudLLMProviderMock.updateProviderApiKey.and.rejectWith(new Error('network'));

      await component.testOpenaiApiKey();

      expect(component.openaiTestResult()).toBe('error');
      expect(component.isTestingOpenai()).toBeFalse();
    });

    it('tests a Claude key the same way', async () => {
      component.claudeApiKey.set('key');
      cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);

      await component.testClaudeApiKey();

      expect(component.claudeTestResult()).toBe('success');
      expect(component.isTestingClaude()).toBeFalse();
    });

    it('reports a Claude failure and lowers the flag', async () => {
      component.claudeApiKey.set('key');
      cloudLLMProviderMock.updateProviderApiKey.and.rejectWith(new Error('network'));

      await component.testClaudeApiKey();

      expect(component.claudeTestResult()).toBe('error');
      expect(component.isTestingClaude()).toBeFalse();
    });
  });

  describe('clearing a provider key', () => {
    beforeEach(() => component.keysLoaded.set(true));

    it('empties the field, drops the test result and pushes the removal through', async () => {
      component.geminiApiKey.set('key');
      component.geminiTestResult.set('success');

      component.clearGeminiApiKey();
      await Promise.resolve();

      expect(component.geminiApiKey()).toBe('');
      expect(component.geminiTestResult()).toBeNull();
      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('gemini', undefined);
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
    });

    it('clears an OpenAI key the same way', async () => {
      component.openaiApiKey.set('key');
      component.openaiTestResult.set('error');

      component.clearOpenaiApiKey();
      await Promise.resolve();

      expect(component.openaiApiKey()).toBe('');
      expect(component.openaiTestResult()).toBeNull();
      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('openai', undefined);
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
    });

    it('clears a Claude key the same way', async () => {
      component.claudeApiKey.set('key');
      component.claudeTestResult.set('success');

      component.clearClaudeApiKey();
      await Promise.resolve();

      expect(component.claudeApiKey()).toBe('');
      expect(component.claudeTestResult()).toBeNull();
      expect(strategyServiceMock.applyProviderKey).toHaveBeenCalledOnceWith('claude', undefined);
      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
    });
  });

  describe('clearing remembered decisions', () => {
    it('reports success and lowers the flag when the memory clears', async () => {
      await component.clearCategoryMemory();

      expect(categoryMemoryMock.clear).toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledWith('aiPage.categoryMemoryCleared');
      expect(component.clearingCategoryMemory()).toBeFalse();
    });

    it('reports the failure and still lowers the flag', async () => {
      // Raised before the call and lowered in a finally: a rejected clear
      // that left it raised would freeze the button for the session.
      categoryMemoryMock.clear.and.rejectWith(new Error('denied'));

      await component.clearCategoryMemory();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(component.clearingCategoryMemory()).toBeFalse();
    });
  });

  /**
   * The remembered-categories card and the remembered-tags card each end in a
   * clear, and the two show together. Their words are the same in en and tc
   * ("Forget all") and differ in ja only by chance, so each is named for what
   * it forgets: its card's title, with the words it shows whole inside the
   * name (WCAG 2.5.3), whether there is anything to forget or not.
   */
  describe('the two memory clears (real template)', () => {
    const CLEARS = [
      { title: 'aiPage.categoryMemoryTitle', shows: 'aiPage.categoryMemoryClear', label: 'aiPage.categoryMemoryClearLabel' },
      { title: 'aiPage.tagMemoryTitle', shows: 'aiPage.tagMemoryClear', label: 'aiPage.tagMemoryClearLabel' },
    ] as const;
    const pinned = {
      en: ['Forget all remembered categories', 'Forget all remembered tags'],
      ja: ['記憶したカテゴリをすべて削除', '記憶されたタグをすべて忘れる'],
      tc: ['將已記住的分類全部忘記', '將已記住的標籤全部忘記'],
    } as const;

    /** The words a button shows: its label's text, the icon's ligature left out. */
    const shownBy = (button: Element) =>
      button.querySelector('.mdc-button__label')!.textContent!.replace(/\s+/g, ' ').trim();

    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`names each clear for what it forgets, holding the words it shows, in ${locale}`, () => {
        const translation = TestBed.inject(TranslationService);
        spyOn(translation, 't').and.callFake(catalogTranslator(locale));
        // The translate pipe memoises on the locale and the catalog version.
        translation.currentLocale.set(locale);
        translation.translationsVersion.update(version => version + 1);
        const t = catalogTranslator(locale);
        fixture.detectChanges();

        /** The clear on the card whose title reads `titleKey`'s words. */
        const clearOn = (titleKey: string): HTMLButtonElement => {
          const card = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-card')).find(
            found => found.querySelector('mat-card-title')?.textContent?.trim() === t(titleKey)
          );
          const button = card?.querySelector<HTMLButtonElement>('mat-card-actions button') ?? null;
          expect(button).withContext(`the clear on the card titled ${t(titleKey)}`).not.toBeNull();
          return button!;
        };

        const read = (state: string, disabled: boolean) => {
          const clears = CLEARS.map(clear => clearOn(clear.title));
          const names = clears.map(clear => accessibleName(clear));
          clears.forEach((clear, i) => {
            const shown = shownBy(clear);
            const title = t(CLEARS[i].title);
            expect(clear.disabled).withContext(`${state}: clear ${i} disabled`).toBe(disabled);
            expect(shown).withContext(`${state}: clear ${i} shows its words as before`).toBe(t(CLEARS[i].shows));
            expect(holdsShownWords(names[i], shown, locale))
              .withContext(`${state}: "${names[i]}" holds "${shown}" whole`)
              .toBeTrue();
            expect(holdsShownWords(names[i], title, locale))
              .withContext(`${state}: "${names[i]}" says what it forgets, "${title}"`)
              .toBeTrue();
          });
          expect(names[0]).withContext(`${state}: the two names, apart`).not.toBe(names[1]);
          expect(names).withContext(`${state}, pinned`).toEqual([...pinned[locale]]);
          const strict = catalogTranslator(locale, { strict: true });
          expect(names).withContext(state).toEqual(CLEARS.map(clear => strict(clear.label)));
        };

        // Nothing remembered: both clears are disabled and keep their names.
        read('nothing to forget', true);

        rememberedCategories.set(4);
        rememberedTags.set(2);
        fixture.detectChanges();
        read('something to forget', false);
      });
    }
  });

  describe('saving a preference', () => {
    it('surfaces a rejected preference write rather than failing silently', async () => {
      authServiceMock.updateUserPreferences.and.rejectWith(new Error('offline'));

      await component.onProviderPreferenceChange();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });
  });

  describe('colours, as painted', () => {
    /** What `box-shadow: <value>` computes to under the theme on <html> now. */
    function shadowOf(value: string): string {
      const probe = document.createElement('div');
      probe.style.boxShadow = value;
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).boxShadow;
      } finally {
        probe.remove();
      }
    }

    it("rings a configured provider card in --mat-sys-primary, and in dark lifts it with the theme's --shadow-md", () => {
      cloudLLMProviderMock.isProviderAvailable.and.callFake(provider => provider === 'gemini');
      const configured = TestBed.createComponent(AiSettingsPageComponent);
      configured.detectChanges();
      const card = (configured.nativeElement as HTMLElement).querySelector('.provider-card.configured') as HTMLElement;
      expect(card).withContext('the Gemini card is the configured one').toBeTruthy();

      withTheme('light', () => {
        settleAnimations(document);
        expect(getComputedStyle(card).boxShadow)
          .withContext('light')
          .toBe(shadowOf('0 0 0 1px var(--mat-sys-primary)'));
      });
      withTheme('dark', () => {
        settleAnimations(document);
        expect(getComputedStyle(card).boxShadow)
          .withContext('dark')
          .toBe(shadowOf('0 0 0 1px var(--mat-sys-primary), var(--shadow-md)'));
      });
    });
  });
});
