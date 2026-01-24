import { ComponentFixture, TestBed } from '@angular/core/testing';
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

describe('AiSettingsPageComponent', () => {
  let component: AiSettingsPageComponent;
  let fixture: ComponentFixture<AiSettingsPageComponent>;
  let strategyServiceMock: jasmine.SpyObj<AIStrategyService>;
  let pwaServiceMock: jasmine.SpyObj<PwaService>;
  let offlineQueueServiceMock: jasmine.SpyObj<OfflineQueueService>;
  let geminiServiceMock: jasmine.SpyObj<GeminiService>;
  let cloudLLMProviderMock: jasmine.SpyObj<CloudLLMProviderService>;
  let authServiceMock: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    strategyServiceMock = jasmine.createSpyObj('AIStrategyService', [
      'preferences',
      'updatePreferences',
      'canUseCloud',
      'canUseNative',
      'platform',
    ]);
    strategyServiceMock.preferences.and.returnValue({
      autoSync: true,
    });
    strategyServiceMock.canUseCloud.and.returnValue(true);
    strategyServiceMock.canUseNative.and.returnValue(false);
    strategyServiceMock.platform.and.returnValue('web');

    pwaServiceMock = jasmine.createSpyObj('PwaService', ['isOnline', 'cacheSize']);
    pwaServiceMock.isOnline.and.returnValue(true);
    pwaServiceMock.cacheSize.and.returnValue({ total: 0, models: 0, static: 0, dynamic: 0 });

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

    await TestBed.configureTestingModule({
      imports: [
        AiSettingsPageComponent,
        NoopAnimationsModule,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: AIStrategyService, useValue: strategyServiceMock },
        { provide: PwaService, useValue: pwaServiceMock },
        { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
        { provide: GeminiService, useValue: geminiServiceMock },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
        { provide: AuthService, useValue: authServiceMock },
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
    });

    it('should clear queue', async () => {
      await component.clearQueue();
      expect(offlineQueueServiceMock.clearAll).toHaveBeenCalled();
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
});
