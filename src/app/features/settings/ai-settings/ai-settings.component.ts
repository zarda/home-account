import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

import { AIStrategyService, AIProcessingMode, AIProcessingStrategy } from '../../../core/services/ai-strategy.service';
import { LocalAIService } from '../../../core/services/local-ai.service';
import { TransformersAIService } from '../../../core/services/transformers-ai.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-ai-settings',
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
    TranslatePipe,
  ],
  templateUrl: './ai-settings.component.html',
  styleUrl: './ai-settings.component.scss',
})
export class AiSettingsComponent implements OnInit {
  private strategyService = inject(AIStrategyService);
  private localAIService = inject(LocalAIService);
  private transformersAI = inject(TransformersAIService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private geminiService = inject(GeminiService);
  private snackBar = inject(MatSnackBar);

  // Form state
  processingMode = signal<AIProcessingMode>('auto');
  processingStrategy = signal<AIProcessingStrategy>('accuracy');
  privacyMode = signal<boolean>(false);
  autoSync = signal<boolean>(true);
  confidenceThreshold = signal<number>(0.7);
  enhancedMode = signal<boolean>(false);

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
  cacheSize = computed(() => this.pwaService.cacheSize());
  localProcessingMode = computed(() => this.localAIService.processingMode());
  
  // ML model status
  isMLModelReady = computed(() => this.transformersAI.mlModelReady());
  isMLModelSupported = computed(() => this.transformersAI.mlModelSupported());
  mlModelSizeFormatted = computed(() => this.transformersAI.getMLModelSizeFormatted());

  // Formatted values
  formattedModelSize = computed(() => this.pwaService.formatBytes(this.modelSize()));
  formattedSemanticSize = computed(() => this.pwaService.formatBytes(this.semanticModelSize()));
  formattedTotalSize = computed(() => this.pwaService.formatBytes(this.totalModelSize()));
  formattedCacheSize = computed(() => this.pwaService.formatBytes(this.cacheSize().total));

  // Status text
  statusText = computed(() => {
    const status = this.strategyService.getStatusInfo();
    
    if (!this.isOnline()) {
      return 'Offline - Using local processing';
    }
    
    if (this.privacyMode()) {
      return 'Privacy Mode - All processing on device';
    }
    
    if (status.localReady && status.cloudAvailable) {
      return 'Ready - Hybrid mode available';
    }
    
    if (status.cloudAvailable) {
      return 'Ready - Cloud AI available';
    }
    
    if (status.localReady) {
      return 'Ready - Local AI only';
    }
    
    return 'Setup required';
  });

  ngOnInit(): void {
    // Load current preferences
    const prefs = this.strategyService.preferences();
    this.processingMode.set(prefs.mode);
    this.processingStrategy.set(prefs.strategy);
    this.privacyMode.set(prefs.privacyMode);
    this.autoSync.set(prefs.autoSync);
    this.confidenceThreshold.set(prefs.confidenceThreshold);
    
    // Check if enhanced mode is active
    this.enhancedMode.set(this.localAIService.processingMode() === 'enhanced');
  }

  onModeChange(mode: AIProcessingMode): void {
    this.processingMode.set(mode);
    this.savePreferences();
  }

  onStrategyChange(strategy: AIProcessingStrategy): void {
    this.processingStrategy.set(strategy);
    this.savePreferences();
  }

  onPrivacyModeChange(enabled: boolean): void {
    this.privacyMode.set(enabled);
    this.savePreferences();
    
    if (enabled) {
      this.snackBar.open('Privacy Mode enabled - All processing stays on your device', 'OK', {
        duration: 3000,
      });
    }
  }

  onAutoSyncChange(enabled: boolean): void {
    this.autoSync.set(enabled);
    this.savePreferences();
  }

  onConfidenceChange(value: number): void {
    this.confidenceThreshold.set(value);
    this.savePreferences();
  }

  private savePreferences(): void {
    this.strategyService.updatePreferences({
      mode: this.processingMode(),
      strategy: this.processingStrategy(),
      privacyMode: this.privacyMode(),
      autoSync: this.autoSync(),
      confidenceThreshold: this.confidenceThreshold(),
    });
  }

  async downloadModels(): Promise<void> {
    this.isDownloading.set(true);
    this.downloadProgress.set(0);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        const current = this.downloadProgress();
        if (current < 90) {
          this.downloadProgress.set(current + 10);
        }
      }, 500);

      await this.strategyService.preloadLocalModels();
      
      clearInterval(progressInterval);
      this.downloadProgress.set(100);

      this.snackBar.open('Local AI models downloaded - Offline processing ready!', 'OK', {
        duration: 3000,
      });
    } catch {
      this.snackBar.open('Failed to download models. Please try again.', 'Retry', {
        duration: 5000,
      }).onAction().subscribe(() => {
        this.downloadModels();
      });
    } finally {
      this.isDownloading.set(false);
      this.downloadProgress.set(0);
    }
  }

  async clearModels(): Promise<void> {
    try {
      await this.strategyService.clearLocalModels();
      this.snackBar.open('Local AI models cleared', 'OK', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to clear models', 'OK', { duration: 2000 });
    }
  }

  async syncQueue(): Promise<void> {
    if (!this.isOnline()) {
      this.snackBar.open('Cannot sync while offline', 'OK', { duration: 2000 });
      return;
    }

    try {
      const result = await this.offlineQueue.syncQueue();
      this.snackBar.open(
        `Synced ${result.success} items${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        'OK',
        { duration: 3000 }
      );
    } catch {
      this.snackBar.open('Sync failed. Please try again.', 'OK', { duration: 2000 });
    }
  }

  async clearQueue(): Promise<void> {
    try {
      await this.offlineQueue.clearAll();
      this.snackBar.open('Offline queue cleared', 'OK', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to clear queue', 'OK', { duration: 2000 });
    }
  }

  getConfidenceLabel(value: number): string {
    if (value >= 0.8) return 'High';
    if (value >= 0.6) return 'Medium';
    return 'Low';
  }

  async onEnhancedModeChange(enabled: boolean): Promise<void> {
    this.enhancedMode.set(enabled);
    
    if (enabled) {
      this.localAIService.setProcessingMode('enhanced');
      this.snackBar.open('Enhanced AI mode enabled - Smart region-specific parsing active', 'OK', {
        duration: 3000,
      });
    } else {
      this.localAIService.setProcessingMode('basic');
      this.snackBar.open('Basic mode enabled - Standard OCR parsing', 'OK', {
        duration: 2000,
      });
    }
  }

  async downloadSemanticModel(): Promise<void> {
    if (!this.isMLModelSupported()) {
      this.snackBar.open('Web Workers not supported in this browser', 'OK', {
        duration: 3000,
      });
      return;
    }

    this.isDownloadingEnhanced.set(true);
    
    try {
      await this.transformersAI.downloadMLModel();
      this.snackBar.open('ML model downloaded (~65MB) - Enhanced accuracy ready!', 'OK', {
        duration: 3000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      this.snackBar.open(`Failed: ${message}`, 'Retry', {
        duration: 5000,
      }).onAction().subscribe(() => {
        this.downloadSemanticModel();
      });
    } finally {
      this.isDownloadingEnhanced.set(false);
    }
  }

  async downloadAllModels(): Promise<void> {
    this.isDownloading.set(true);
    this.downloadProgress.set(0);

    try {
      // Download OCR models
      this.downloadProgress.set(10);
      await this.strategyService.preloadLocalModels();
      this.downloadProgress.set(50);
      
      // Download semantic model if enhanced mode
      if (this.enhancedMode()) {
        await this.transformersAI.preloadModel();
      }
      
      this.downloadProgress.set(100);
      this.snackBar.open('All AI models downloaded - Full offline capability ready!', 'OK', {
        duration: 3000,
      });
    } catch {
      this.snackBar.open('Failed to download models. Please try again.', 'OK', {
        duration: 3000,
      });
    } finally {
      this.isDownloading.set(false);
      this.downloadProgress.set(0);
    }
  }
}
