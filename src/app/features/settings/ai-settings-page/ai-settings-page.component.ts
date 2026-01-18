import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatRadioModule } from '@angular/material/radio';
import { MatSliderModule } from '@angular/material/slider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';

import { AIStrategyService, AIProcessingMode, AIProcessingStrategy } from '../../../core/services/ai-strategy.service';
import { LocalAIService, OCREngine } from '../../../core/services/local-ai.service';
import { TransformersAIService, MLModelType } from '../../../core/services/transformers-ai.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-ai-settings-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatRadioModule,
    MatSliderModule,
    MatProgressBarModule,
    MatChipsModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatDividerModule,
    MatCardModule,
    MatExpansionModule,
    MatTabsModule,
    TranslatePipe,
  ],
  templateUrl: './ai-settings-page.component.html',
  styleUrl: './ai-settings-page.component.scss',
})
export class AiSettingsPageComponent implements OnInit {
  private strategyService = inject(AIStrategyService);
  private localAIService = inject(LocalAIService);
  private transformersAI = inject(TransformersAIService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private geminiService = inject(GeminiService);
  private snackBar = inject(MatSnackBar);
  private location = inject(Location);
  private router = inject(Router);

  // Form state
  processingMode = signal<AIProcessingMode>('auto');
  processingStrategy = signal<AIProcessingStrategy>('accuracy');
  privacyMode = signal<boolean>(false);
  autoSync = signal<boolean>(true);
  confidenceThreshold = signal<number>(0.7);
  enhancedMode = signal<boolean>(false);
  ocrEngine = signal<OCREngine>('auto');

  // Status signals
  isDownloading = signal<boolean>(false);
  downloadProgress = signal<number>(0);
  isDownloadingEnhanced = signal<boolean>(false);

  // Computed from services
  isOnline = computed(() => this.pwaService.isOnline());
  isLocalReady = computed(() => this.localAIService.isReady());
  isGeminiAvailable = computed(() => this.geminiService.isAvailable());
  isSemanticReady = computed(() => this.transformersAI.isReady());
  isSemanticLoading = computed(() => this.transformersAI.isLoading());
  semanticProgress = computed(() => this.transformersAI.progress());
  semanticStatus = computed(() => this.transformersAI.status());
  modelSize = computed(() => this.localAIService.modelSize());
  semanticModelSize = computed(() => this.transformersAI.modelSize());
  totalModelSize = computed(() => this.localAIService.totalModelSize());
  pendingQueueCount = computed(() => this.offlineQueue.pendingCount());
  cacheSize = computed(() => this.pwaService.cacheSize().total);
  localProcessingMode = computed(() => this.localAIService.processingMode());
  
  // ML model status
  isMLModelReady = computed(() => this.transformersAI.mlModelReady());
  isMLModelSupported = computed(() => this.transformersAI.mlModelSupported());
  mlModelSizeFormatted = computed(() => this.transformersAI.getMLModelSizeFormatted());
  currentMLModelType = computed(() => this.transformersAI.currentMLModelType());
  
  // ML model selection - default to saved type or embeddings
  selectedMLModelType = signal<MLModelType>(this.transformersAI.getSavedModelType());
  availableMLModels = this.transformersAI.getMLModels();
  wasMLModelDownloaded = computed(() => this.transformersAI.mlModelWasDownloaded());

  // OCR engine status
  currentOCREngine = computed(() => this.localAIService.ocrEngine());
  isPaddleOCRReady = computed(() => this.localAIService.paddleOCRReady());

  // Available OCR engines for UI
  availableOCREngines: { value: OCREngine; name: string; description: string }[] = [
    {
      value: 'auto',
      name: 'Auto (Recommended)',
      description: 'Automatically selects the best OCR engine based on detected language',
    },
    {
      value: 'tesseract',
      name: 'Tesseract.js',
      description: 'Best for English and Japanese text. Works offline.',
    },
    {
      value: 'paddleocr',
      name: 'PaddleOCR',
      description: 'Best for Chinese text (Simplified & Traditional). Loads from CDN.',
    },
  ];

  ngOnInit(): void {
    this.loadPreferences();
    this.restoreMLModelIfNeeded();
  }

  goBack(): void {
    this.location.back();
  }

  private loadPreferences(): void {
    const prefs = this.strategyService.preferences();
    this.processingMode.set(prefs.mode);
    this.processingStrategy.set(prefs.strategy);
    this.privacyMode.set(prefs.privacyMode);
    this.autoSync.set(prefs.autoSync);
    this.confidenceThreshold.set(prefs.confidenceThreshold);
    this.enhancedMode.set(this.localAIService.processingMode() === 'enhanced');
    this.ocrEngine.set(this.localAIService.ocrEngine());
  }

  /**
   * Auto-restore ML model if it was previously downloaded.
   * The model data is cached in IndexedDB by Transformers.js,
   * so this just re-initializes the worker (no re-download needed).
   */
  private async restoreMLModelIfNeeded(): Promise<void> {
    if (this.wasMLModelDownloaded() && !this.isMLModelReady() && this.isMLModelSupported()) {
      try {
        const savedType = this.transformersAI.getSavedModelType();
        this.selectedMLModelType.set(savedType);
        // Auto-restore in background - model data is cached, so this is fast
        await this.transformersAI.downloadMLModel(savedType);
      } catch (error) {
        console.warn('[AI Settings] Failed to auto-restore ML model:', error);
        // Silent fail - user can manually re-download if needed
      }
    }
  }

  onModeChange(mode: AIProcessingMode): void {
    this.processingMode.set(mode);
    this.strategyService.updatePreferences({ mode });
    this.showToast('aiPage.modeChanged');
  }

  onStrategyChange(strategy: AIProcessingStrategy): void {
    this.processingStrategy.set(strategy);
    this.strategyService.updatePreferences({ strategy });
  }

  onOCREngineChange(engine: OCREngine): void {
    this.ocrEngine.set(engine);
    this.localAIService.setOCREngine(engine);
    this.showToast('aiPage.ocrEngineChanged');
  }

  onPrivacyModeChange(enabled: boolean): void {
    this.privacyMode.set(enabled);
    this.strategyService.updatePreferences({ privacyMode: enabled });
    if (enabled) {
      this.showToast('aiPage.privacyEnabled');
    }
  }

  onAutoSyncChange(enabled: boolean): void {
    this.autoSync.set(enabled);
    this.strategyService.updatePreferences({ autoSync: enabled });
  }

  onConfidenceChange(value: number): void {
    this.confidenceThreshold.set(value);
    this.strategyService.updatePreferences({ confidenceThreshold: value });
  }

  async onEnhancedModeChange(enabled: boolean): Promise<void> {
    this.enhancedMode.set(enabled);
    if (enabled) {
      this.localAIService.setProcessingMode('enhanced');
      this.showToast('aiPage.enhancedEnabled');
    } else {
      this.localAIService.setProcessingMode('basic');
      this.showToast('aiPage.basicEnabled');
    }
  }

  async downloadOCRModels(): Promise<void> {
    this.isDownloading.set(true);
    this.downloadProgress.set(0);

    try {
      this.downloadProgress.set(10);
      await this.strategyService.preloadLocalModels();
      this.downloadProgress.set(100);
      this.showToast('aiPage.ocrDownloaded');
    } catch {
      this.snackBar.open('Failed to download OCR models', 'Retry', {
        duration: 5000,
      }).onAction().subscribe(() => {
        this.downloadOCRModels();
      });
    } finally {
      this.isDownloading.set(false);
    }
  }

  async downloadMLModel(modelType?: MLModelType): Promise<void> {
    const type = modelType || this.selectedMLModelType();
    
    if (!this.isMLModelSupported()) {
      this.snackBar.open('Web Workers not supported in this browser', 'OK', {
        duration: 3000,
      });
      return;
    }

    this.isDownloadingEnhanced.set(true);
    
    try {
      await this.transformersAI.downloadMLModel(type);
      this.showToast('aiPage.mlDownloaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      this.snackBar.open(`Failed: ${message}`, 'Retry', {
        duration: 5000,
      }).onAction().subscribe(() => {
        this.downloadMLModel(type);
      });
    } finally {
      this.isDownloadingEnhanced.set(false);
    }
  }

  async onMLModelTypeChange(type: MLModelType): Promise<void> {
    this.selectedMLModelType.set(type);
    
    // If a model is already ready and user selected a different type, switch immediately
    if (this.isMLModelReady() && this.currentMLModelType() !== type) {
      await this.downloadMLModel(type);
    }
  }

  getMLModelSize(type: MLModelType): string {
    return this.transformersAI.getMLModelSizeFormatted(type);
  }

  async downloadAllModels(): Promise<void> {
    await this.downloadOCRModels();
    if (this.isMLModelSupported() && !this.isMLModelReady()) {
      await this.downloadMLModel();
    }
  }

  async clearModels(): Promise<void> {
    try {
      await this.localAIService.terminate();
      await this.transformersAI.terminate();
      this.showToast('aiPage.modelsCleared');
    } catch {
      this.snackBar.open('Failed to clear models', 'OK', { duration: 3000 });
    }
  }

  async syncQueue(): Promise<void> {
    try {
      await this.offlineQueue.syncQueue();
      this.showToast('aiPage.queueSynced');
    } catch {
      this.snackBar.open('Failed to sync queue', 'OK', { duration: 3000 });
    }
  }

  async clearQueue(): Promise<void> {
    try {
      // Actually clear all pending items from the queue
      await this.offlineQueue.clearAll();
      this.showToast('aiPage.queueCleared');
    } catch {
      this.snackBar.open('Failed to clear queue', 'OK', { duration: 3000 });
    }
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private showToast(key: string): void {
    // Simple toast without translation for now
    const messages: Record<string, string> = {
      'aiPage.modeChanged': 'Processing mode updated',
      'aiPage.privacyEnabled': 'Privacy mode enabled - all processing stays on device',
      'aiPage.enhancedEnabled': 'Enhanced AI mode enabled',
      'aiPage.basicEnabled': 'Basic mode enabled',
      'aiPage.ocrDownloaded': 'OCR models downloaded successfully',
      'aiPage.mlDownloaded': 'ML model downloaded (~65MB) - Enhanced accuracy ready!',
      'aiPage.modelsCleared': 'All AI models cleared',
      'aiPage.queueSynced': 'Queue synced successfully',
      'aiPage.queueCleared': 'Queue cleared',
    };
    this.snackBar.open(messages[key] || key, 'OK', { duration: 3000 });
  }
}
