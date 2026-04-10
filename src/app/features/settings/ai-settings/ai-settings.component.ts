import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

import { AIStrategyService } from '../../../core/services/ai-strategy.service';
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
    MatProgressBarModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    TranslatePipe,
  ],
  templateUrl: './ai-settings.component.html',
  styleUrl: './ai-settings.component.scss',
})
export class AiSettingsComponent implements OnInit {
  private strategyService = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private geminiService = inject(GeminiService);
  private snackBar = inject(MatSnackBar);

  // Form state
  autoSync = signal<boolean>(true);
  selectedTextModel = signal<string>('gemma-4-26b-a4b-it');
  selectedVisionModel = signal<string>('gemma-4-31b-it');

  // Available models
  textModels = [
    { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B (Text)' },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemma-2-27b-it', name: 'Gemma 2 27B' },
  ];

  visionModels = [
    { id: 'gemma-4-31b-it', name: 'Gemma 4 31B (Vision)' },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemma-2-27b-it', name: 'Gemma 2 27B' },
  ];

  // Computed from services
  isOnline = computed(() => this.pwaService.isOnline());
  isGeminiAvailable = computed(() => this.geminiService.isAvailable());
  canUseCloud = computed(() => this.strategyService.canUseCloud());
  canUseNative = computed(() => this.strategyService.canUseNative());
  pendingQueueCount = computed(() => this.offlineQueue.pendingCount());
  cacheSize = computed(() => this.pwaService.cacheSize());

  // Formatted values
  formattedCacheSize = computed(() => this.pwaService.formatBytes(this.cacheSize().total));

  // Status text
  statusText = computed(() => {
    const status = this.strategyService.getStatusInfo();

    if (!this.isOnline()) {
      return 'Offline - Cannot process receipts';
    }

    if (status.nativeAvailable) {
      return 'Ready - Native Vision OCR';
    }

    if (status.cloudAvailable) {
      return 'Ready - Cloud AI available';
    }

    return 'Setup required - Configure API key';
  });

  ngOnInit(): void {
    const prefs = this.strategyService.preferences();
    this.autoSync.set(prefs.autoSync);
    this.selectedTextModel.set(prefs.textModel || 'gemma-4-26b-a4b-it');
    this.selectedVisionModel.set(prefs.visionModel || 'gemma-4-31b-it');
  }

  onAutoSyncChange(enabled: boolean): void {
    this.autoSync.set(enabled);
    this.strategyService.updatePreferences({ autoSync: enabled });
  }

  onTextModelChange(modelId: string): void {
    this.selectedTextModel.set(modelId);
    this.strategyService.updatePreferences({ textModel: modelId });
    this.snackBar.open(`Text model updated to ${modelId}`, 'OK', { duration: 2000 });
  }

  onVisionModelChange(modelId: string): void {
    this.selectedVisionModel.set(modelId);
    this.strategyService.updatePreferences({ visionModel: modelId });
    this.snackBar.open(`Vision model updated to ${modelId}`, 'OK', { duration: 2000 });
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
}
