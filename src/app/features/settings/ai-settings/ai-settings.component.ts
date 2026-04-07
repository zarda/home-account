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

import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { GemmaService, GemmaVariant } from '../../../core/services/gemma.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type GemmaRowState = 'not-downloaded' | 'downloading' | 'ready' | 'active' | 'evicted';

interface GemmaRow {
  variant: GemmaVariant;
  sizeLabel: string;
  state: GemmaRowState;
  progress: number;
}

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
  private gemmaService = inject(GemmaService);
  private snackBar = inject(MatSnackBar);

  // Form state
  autoSync = signal<boolean>(true);
  gemmaThinkingEnabled = signal<boolean>(false);
  activeVariant = signal<GemmaVariant | null>(null);
  storageUsedBytes = signal<number>(0);
  storageQuotaBytes = signal<number>(0);
  storagePersisted = signal<boolean>(false);

  gemmaRows = signal<GemmaRow[]>([
    { variant: 'E2B', sizeLabel: '~1.5 GB', state: 'not-downloaded', progress: 0 },
    { variant: 'E4B', sizeLabel: '~3 GB', state: 'not-downloaded', progress: 0 },
  ]);

  isIos = computed(() => this.strategyService.platform() === 'ios');
  webGpuAvailable = computed(() => this.strategyService.isGemmaAvailable());
  gemmaActive = computed(() => this.activeVariant() !== null);
  storageUsedLabel = computed(() => this.formatBytes(this.storageUsedBytes()));
  storageQuotaLabel = computed(() => this.formatBytes(this.storageQuotaBytes()));
  storagePercent = computed(() => {
    const q = this.storageQuotaBytes();
    return q > 0 ? Math.min(100, (this.storageUsedBytes() / q) * 100) : 0;
  });
  storageWarning = computed(() => {
    const remaining = this.storageQuotaBytes() - this.storageUsedBytes();
    const required = this.activeVariant() === 'E4B' ? 3 * 1024 * 1024 * 1024 : 1.5 * 1024 * 1024 * 1024;
    return remaining > 0 && remaining < required;
  });

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
    void this.refreshStorage();
  }

  async refreshStorage(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      this.storageUsedBytes.set(estimate.usage ?? 0);
      this.storageQuotaBytes.set(estimate.quota ?? 0);
      if (navigator.storage.persisted) {
        this.storagePersisted.set(await navigator.storage.persisted());
      }
    } catch {
      // ignore
    }
  }

  async downloadGemma(variant: GemmaVariant): Promise<void> {
    if (!this.webGpuAvailable()) return;
    if (typeof navigator !== 'undefined' && navigator.storage?.persist && !this.storagePersisted()) {
      try { await navigator.storage.persist(); } catch { /* ignore */ }
    }
    this.gemmaService.setVariant(variant);
    this.updateRowState(variant, 'downloading', 0);
    try {
      await this.gemmaService.download(p => this.updateRowState(variant, 'downloading', Math.round(p)));
      this.activeVariant.set(variant);
      this.updateRowState(variant, 'active', 100);
      void this.refreshStorage();
    } catch (e) {
      this.updateRowState(variant, 'not-downloaded', 0);
      this.snackBar.open('Download failed: ' + (e instanceof Error ? e.message : 'unknown'), 'OK', { duration: 3000 });
    }
  }

  setActiveVariant(variant: GemmaVariant): void {
    this.gemmaService.unload();
    this.gemmaService.setVariant(variant);
    void this.downloadGemma(variant);
  }

  deleteVariant(variant: GemmaVariant): void {
    if (this.activeVariant() === variant) {
      this.gemmaService.unload();
      this.activeVariant.set(null);
    }
    this.updateRowState(variant, 'not-downloaded', 0);
  }

  onThinkingToggle(enabled: boolean): void {
    this.gemmaThinkingEnabled.set(enabled);
  }

  private updateRowState(variant: GemmaVariant, state: GemmaRowState, progress: number): void {
    this.gemmaRows.update(rows => rows.map(r => r.variant === variant ? { ...r, state, progress } : r));
  }

  private formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  onAutoSyncChange(enabled: boolean): void {
    this.autoSync.set(enabled);
    this.strategyService.updatePreferences({ autoSync: enabled });
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
