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
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { NotificationService } from '../../../core/services/notification.service';

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

    pwaServiceMock = jasmine.createSpyObj('PwaService', ['isOnline', 'cacheSize', 'formatBytes']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    pwaServiceMock.isOnline.and.returnValue(true);
    pwaServiceMock.cacheSize.and.returnValue({ total: 0, models: 0, static: 0, dynamic: 0 });
    pwaServiceMock.formatBytes.and.callFake((bytes: number) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    });

    offlineQueueServiceMock = jasmine.createSpyObj('OfflineQueueService', [
      'pendingCount',
      'syncQueue',
      'clearAll',
    ]);
    offlineQueueServiceMock.pendingCount.and.returnValue(0);
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

  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(component.formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(component.formatBytes(500)).toBe('500 Bytes');
    });

    it('should format KB', () => {
      expect(component.formatBytes(1024)).toBe('1 KB');
    });

    it('should format MB', () => {
      expect(component.formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('should format GB', () => {
      expect(component.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
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

      expect(component.geminiApiKey).toBe('g-key');
      expect(component.claudeApiKey).toBe('c-key');
      expect(component.openaiApiKey).toBe('');
    });

    // Keys go to the secrets document, never back onto the preferences map.
    it('saves a key through the secrets store, not user preferences', async () => {
      component.geminiApiKey = 'new-key';

      await component.onGeminiApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('gemini', 'new-key');
      expect(authServiceMock.updateUserPreferences).not.toHaveBeenCalled();
    });

    it('applies the saved key to the provider straight away', async () => {
      component.openaiApiKey = 'o-key';

      await component.onOpenaiApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('openai', 'o-key');
      expect(cloudLLMProviderMock.updateProviderApiKey).toHaveBeenCalledWith('openai', 'o-key');
    });

    it('clears a key when the field is emptied', async () => {
      component.claudeApiKey = '';

      await component.onClaudeApiKeyChange();

      expect(providerKeysMock.setKey).toHaveBeenCalledWith('claude', undefined);
    });

    // The fields render blank when the keys could not be read, so accepting a
    // save here would write that blankness over the stored keys.
    it('saves nothing until the stored keys have actually been read', async () => {
      component.keysLoaded.set(false);
      component.geminiApiKey = '';

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
});
