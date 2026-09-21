import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AiSettingsPageComponent } from './ai-settings-page.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DEFAULT_LLM_PROVIDER_PREFERENCES } from '../../../models';

describe('AiSettingsPageComponent', () => {
  let component: AiSettingsPageComponent;
  let fixture: ComponentFixture<AiSettingsPageComponent>;
  let strategyServiceMock: jasmine.SpyObj<AIStrategyService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let pwaServiceMock: jasmine.SpyObj<PwaService>;
  let offlineQueueServiceMock: jasmine.SpyObj<OfflineQueueService>;
  let geminiServiceMock: jasmine.SpyObj<GeminiService>;
  let cloudLLMProviderMock: jasmine.SpyObj<CloudLLMProviderService>;
  let authServiceMock: jasmine.SpyObj<AuthService>;
  let providerKeysMock: jasmine.SpyObj<ProviderKeyService>;
  let categoryMemoryMock: jasmine.SpyObj<CategoryMemoryService>;
  let tagMemoryMock: jasmine.SpyObj<TagMemoryService>;
  let providerKeysLoadFailed: ReturnType<typeof signal<boolean>>;
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
    ]);
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
      'syncQueue',
      'clearAll',
    ]);
    offlineQueueServiceMock.pendingCount.and.returnValue(0);
    offlineQueueServiceMock.closedForUpgrade.and.returnValue(false);
    offlineQueueServiceMock.syncQueue.and.returnValue(Promise.resolve({ success: 0, failed: 0 }));
    offlineQueueServiceMock.clearAll.and.returnValue(Promise.resolve());

    geminiServiceMock = jasmine.createSpyObj('GeminiService', ['isAvailable']);
    geminiServiceMock.isAvailable.and.returnValue(true);

    cloudLLMProviderMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'isProviderAvailable',
      'updateProviderApiKey',
    ]);
    cloudLLMProviderMock.isProviderAvailable.and.returnValue(false);

    providerKeysLoadFailed = signal(false);
    providerKeysMock = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['resolve', 'getKey', 'setKey'],
      { loadFailed: providerKeysLoadFailed }
    );
    providerKeysMock.resolve.and.resolveTo({});
    providerKeysMock.getKey.and.resolveTo(undefined);
    providerKeysMock.setKey.and.resolveTo(undefined);

    categoryMemoryMock = jasmine.createSpyObj<CategoryMemoryService>(
      'CategoryMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: signal(0) }
    );
    categoryMemoryMock.ensureLoaded.and.resolveTo(undefined);
    categoryMemoryMock.clear.and.resolveTo(undefined);

    tagMemoryMock = jasmine.createSpyObj<TagMemoryService>(
      'TagMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: signal(0) }
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
        NoopAnimationsModule,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIStrategyService, useValue: strategyServiceMock },
        { provide: PwaService, useValue: pwaServiceMock },
        { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
        { provide: GeminiService, useValue: geminiServiceMock },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: AnnouncerService, useValue: announcerMock },
        { provide: ProviderKeyService, useValue: providerKeysMock },
        { provide: CategoryMemoryService, useValue: categoryMemoryMock },
        { provide: TagMemoryService, useValue: tagMemoryMock },
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
    it('loads the stored keys into the form', async () => {
      providerKeysMock.resolve.and.resolveTo({ gemini: 'g-key', claude: 'c-key' });

      await component['loadApiKeys']();

      expect(component.geminiApiKey()).toBe('g-key');
      expect(component.claudeApiKey()).toBe('c-key');
      expect(component.openaiApiKey()).toBe('');
    });

    // Keys go to the secrets document, never back onto the preferences map.
    it('saves a key through the secrets store, not user preferences', async () => {
      component.geminiApiKey.set('new-key');

      await component.onGeminiApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('gemini', 'new-key');
      expect(authServiceMock.updateUserPreferences).not.toHaveBeenCalled();
    });

    it('applies the saved key to the provider straight away', async () => {
      component.openaiApiKey.set('o-key');

      await component.onOpenaiApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('openai', 'o-key');
      expect(cloudLLMProviderMock.updateProviderApiKey).toHaveBeenCalledWith('openai', 'o-key');
    });

    it('clears a key when the field is emptied', async () => {
      component.claudeApiKey.set('');

      await component.onClaudeApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('claude', undefined);
    });

    // The fields render blank when the keys could not be read, so accepting a
    // save here would write that blankness over the stored keys.
    it('saves nothing until the stored keys have actually been read', async () => {
      component.keysLoaded.set(false);
      component.geminiApiKey.set('');

      await component.onGeminiApiKeyChange();

      expect(providerKeysMock.setKey).not.toHaveBeenCalled();
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
      expect(providerKeysMock.setKey).toHaveBeenCalledWith('gemini', undefined);
    });

    it('clears an OpenAI key the same way', async () => {
      component.openaiApiKey.set('key');
      component.openaiTestResult.set('error');

      component.clearOpenaiApiKey();
      await Promise.resolve();

      expect(component.openaiApiKey()).toBe('');
      expect(component.openaiTestResult()).toBeNull();
      expect(providerKeysMock.setKey).toHaveBeenCalledWith('openai', undefined);
    });

    it('clears a Claude key the same way', async () => {
      component.claudeApiKey.set('key');
      component.claudeTestResult.set('success');

      component.clearClaudeApiKey();
      await Promise.resolve();

      expect(component.claudeApiKey()).toBe('');
      expect(component.claudeTestResult()).toBeNull();
      expect(providerKeysMock.setKey).toHaveBeenCalledWith('claude', undefined);
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

  describe('saving a preference', () => {
    it('surfaces a rejected preference write rather than failing silently', async () => {
      authServiceMock.updateUserPreferences.and.rejectWith(new Error('offline'));

      await component.onProviderPreferenceChange();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });
  });
});
