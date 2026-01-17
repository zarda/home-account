import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AiSettingsPageComponent } from './ai-settings-page.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { LocalAIService } from '../../../core/services/local-ai.service';
import { TransformersAIService } from '../../../core/services/transformers-ai.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';

describe('AiSettingsPageComponent', () => {
  let component: AiSettingsPageComponent;
  let fixture: ComponentFixture<AiSettingsPageComponent>;
  let strategyServiceMock: jasmine.SpyObj<AIStrategyService>;
  let localAIServiceMock: jasmine.SpyObj<LocalAIService>;
  let transformersAIServiceMock: jasmine.SpyObj<TransformersAIService>;
  let pwaServiceMock: jasmine.SpyObj<PwaService>;
  let offlineQueueServiceMock: jasmine.SpyObj<OfflineQueueService>;
  let geminiServiceMock: jasmine.SpyObj<GeminiService>;

  beforeEach(async () => {
    // Create mock services
    strategyServiceMock = jasmine.createSpyObj('AIStrategyService', [
      'preferences',
      'updatePreferences',
      'preloadLocalModels',
    ]);
    strategyServiceMock.preferences.and.returnValue({
      mode: 'auto',
      strategy: 'accuracy',
      privacyMode: false,
      autoSync: true,
      preferredLanguages: ['en'],
      confidenceThreshold: 0.7,
    });

    localAIServiceMock = jasmine.createSpyObj('LocalAIService', [
      'isReady',
      'modelSize',
      'totalModelSize',
      'processingMode',
      'setProcessingMode',
      'terminate',
    ]);
    localAIServiceMock.isReady.and.returnValue(false);
    localAIServiceMock.modelSize.and.returnValue(0);
    localAIServiceMock.totalModelSize.and.returnValue(0);
    localAIServiceMock.processingMode.and.returnValue('basic' as const);

    transformersAIServiceMock = jasmine.createSpyObj('TransformersAIService', [
      'isReady',
      'isLoading',
      'progress',
      'status',
      'mlModelReady',
      'mlModelSupported',
      'modelSize',
      'getMLModelSizeFormatted',
      'downloadMLModel',
      'terminate',
    ]);
    transformersAIServiceMock.isReady.and.returnValue(true);
    transformersAIServiceMock.isLoading.and.returnValue(false);
    transformersAIServiceMock.progress.and.returnValue(0);
    transformersAIServiceMock.status.and.returnValue('');
    transformersAIServiceMock.mlModelReady.and.returnValue(false);
    transformersAIServiceMock.mlModelSupported.and.returnValue(true);
    transformersAIServiceMock.modelSize.and.returnValue(0);
    transformersAIServiceMock.getMLModelSizeFormatted.and.returnValue('65 MB');

    pwaServiceMock = jasmine.createSpyObj('PwaService', ['isOnline', 'cacheSize']);
    pwaServiceMock.isOnline.and.returnValue(true);
    pwaServiceMock.cacheSize.and.returnValue({ total: 0, models: 0, static: 0, dynamic: 0 });

    offlineQueueServiceMock = jasmine.createSpyObj('OfflineQueueService', [
      'pendingCount',
      'syncQueue',
    ]);
    offlineQueueServiceMock.pendingCount.and.returnValue(0);
    offlineQueueServiceMock.syncQueue.and.returnValue(Promise.resolve({ success: 0, failed: 0 }));

    geminiServiceMock = jasmine.createSpyObj('GeminiService', ['isAvailable']);
    geminiServiceMock.isAvailable.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [
        AiSettingsPageComponent,
        NoopAnimationsModule,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: AIStrategyService, useValue: strategyServiceMock },
        { provide: LocalAIService, useValue: localAIServiceMock },
        { provide: TransformersAIService, useValue: transformersAIServiceMock },
        { provide: PwaService, useValue: pwaServiceMock },
        { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
        { provide: GeminiService, useValue: geminiServiceMock },
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

    it('should have default processing mode', () => {
      expect(component.processingMode()).toBe('auto');
    });

    it('should have default confidence threshold', () => {
      expect(component.confidenceThreshold()).toBe(0.7);
    });
  });

  describe('mode changes', () => {
    it('should update mode when changed', () => {
      component.onModeChange('local_only');

      expect(component.processingMode()).toBe('local_only');
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ mode: 'local_only' });
    });

    it('should update strategy when changed', () => {
      component.onStrategyChange('privacy');

      expect(component.processingStrategy()).toBe('privacy');
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ strategy: 'privacy' });
    });

    it('should update privacy mode when toggled', () => {
      component.onPrivacyModeChange(true);

      expect(component.privacyMode()).toBeTrue();
      expect(strategyServiceMock.updatePreferences).toHaveBeenCalledWith({ privacyMode: true });
    });
  });

  describe('enhanced mode', () => {
    it('should toggle enhanced mode', async () => {
      await component.onEnhancedModeChange(true);

      expect(component.enhancedMode()).toBeTrue();
      expect(localAIServiceMock.setProcessingMode).toHaveBeenCalledWith('enhanced');
    });

    it('should set basic mode when disabled', async () => {
      await component.onEnhancedModeChange(false);

      expect(component.enhancedMode()).toBeFalse();
      expect(localAIServiceMock.setProcessingMode).toHaveBeenCalledWith('basic');
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
});
