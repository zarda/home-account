import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { AuthService } from '../../../core/services/auth.service';
import { LLMProvider, LLMProviderPreferences, DEFAULT_LLM_PROVIDER_PREFERENCES } from '../../../models';
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
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './ai-settings-page.component.html',
  styleUrl: './ai-settings-page.component.scss',
})
export class AiSettingsPageComponent implements OnInit {
  private strategyService = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private geminiService = inject(GeminiService);
  private translationService = inject(TranslationService);
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private location = inject(Location);

  // Form state
  autoSync = signal<boolean>(true);

  // API Keys for all providers
  geminiApiKey = '';
  openaiApiKey = '';
  claudeApiKey = '';

  // Provider preferences
  llmProviderPreferences: LLMProviderPreferences = DEFAULT_LLM_PROVIDER_PREFERENCES;

  // Testing state for each provider
  isTestingGemini = false;
  isTestingOpenai = false;
  isTestingClaude = false;
  geminiTestResult: 'success' | 'error' | null = null;
  openaiTestResult: 'success' | 'error' | null = null;
  claudeTestResult: 'success' | 'error' | null = null;

  // Available providers for selection
  allProviders: { value: LLMProvider; label: string }[] = [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'openai', label: 'OpenAI (ChatGPT)' },
    { value: 'claude', label: 'Anthropic Claude' },
  ];

  // Computed from services
  isOnline = computed(() => this.pwaService.isOnline());
  isGeminiAvailable = computed(() => this.geminiService.isAvailable());
  canUseCloud = computed(() => this.strategyService.canUseCloud());
  canUseNative = computed(() => this.strategyService.canUseNative());
  platform = computed(() => this.strategyService.platform());
  pendingQueueCount = computed(() => this.offlineQueue.pendingCount());
  cacheSize = computed(() => this.pwaService.cacheSize().total);
  configuredProviderCount = computed(() => {
    let count = 0;
    if (this.cloudLLMProvider.isProviderAvailable('gemini')) count++;
    if (this.cloudLLMProvider.isProviderAvailable('openai')) count++;
    if (this.cloudLLMProvider.isProviderAvailable('claude')) count++;
    return count;
  });

  // AI status text
  aiStatusText = computed(() => {
    if (this.canUseNative()) {
      return this.translationService.t('aiPage.nativeOCRReady');
    }
    if (this.canUseCloud()) {
      return this.translationService.t('aiPage.cloudAIReady');
    }
    if (!this.isOnline()) {
      return this.translationService.t('aiPage.offline');
    }
    return this.translationService.t('aiPage.configureRequired');
  });

  ngOnInit(): void {
    this.loadPreferences();
    this.loadApiKeys();
  }

  goBack(): void {
    this.location.back();
  }

  private loadPreferences(): void {
    const prefs = this.strategyService.preferences();
    this.autoSync.set(prefs.autoSync);
  }

  private loadApiKeys(): void {
    const user = this.authService.currentUser();
    this.geminiApiKey = user?.preferences?.geminiApiKey || '';
    this.openaiApiKey = user?.preferences?.openaiApiKey || '';
    this.claudeApiKey = user?.preferences?.claudeApiKey || '';
    this.llmProviderPreferences = user?.preferences?.llmProviderPreferences || DEFAULT_LLM_PROVIDER_PREFERENCES;
  }

  // Check if provider is available
  isProviderAvailable(provider: LLMProvider): boolean {
    return this.cloudLLMProvider.isProviderAvailable(provider);
  }

  // Gemini API Key handling
  async onGeminiApiKeyChange(): Promise<void> {
    this.geminiTestResult = null;
    await this.savePreference({ geminiApiKey: this.geminiApiKey || undefined });
    this.cloudLLMProvider.updateProviderApiKey('gemini', this.geminiApiKey || undefined);
  }

  async testGeminiApiKey(): Promise<void> {
    if (!this.geminiApiKey) return;

    this.isTestingGemini = true;
    this.geminiTestResult = null;

    try {
      this.cloudLLMProvider.updateProviderApiKey('gemini', this.geminiApiKey);
      if (this.cloudLLMProvider.isProviderAvailable('gemini')) {
        this.geminiTestResult = 'success';
      } else {
        this.geminiTestResult = 'error';
      }
    } catch {
      this.geminiTestResult = 'error';
    } finally {
      this.isTestingGemini = false;
    }
  }

  clearGeminiApiKey(): void {
    this.geminiApiKey = '';
    this.geminiTestResult = null;
    this.onGeminiApiKeyChange();
  }

  // OpenAI API Key handling
  async onOpenaiApiKeyChange(): Promise<void> {
    this.openaiTestResult = null;
    await this.savePreference({ openaiApiKey: this.openaiApiKey || undefined });
    this.cloudLLMProvider.updateProviderApiKey('openai', this.openaiApiKey || undefined);
  }

  async testOpenaiApiKey(): Promise<void> {
    if (!this.openaiApiKey) return;

    this.isTestingOpenai = true;
    this.openaiTestResult = null;

    try {
      this.cloudLLMProvider.updateProviderApiKey('openai', this.openaiApiKey);
      if (this.cloudLLMProvider.isProviderAvailable('openai')) {
        this.openaiTestResult = 'success';
      } else {
        this.openaiTestResult = 'error';
      }
    } catch {
      this.openaiTestResult = 'error';
    } finally {
      this.isTestingOpenai = false;
    }
  }

  clearOpenaiApiKey(): void {
    this.openaiApiKey = '';
    this.openaiTestResult = null;
    this.onOpenaiApiKeyChange();
  }

  // Claude API Key handling
  async onClaudeApiKeyChange(): Promise<void> {
    this.claudeTestResult = null;
    await this.savePreference({ claudeApiKey: this.claudeApiKey || undefined });
    this.cloudLLMProvider.updateProviderApiKey('claude', this.claudeApiKey || undefined);
  }

  async testClaudeApiKey(): Promise<void> {
    if (!this.claudeApiKey) return;

    this.isTestingClaude = true;
    this.claudeTestResult = null;

    try {
      this.cloudLLMProvider.updateProviderApiKey('claude', this.claudeApiKey);
      if (this.cloudLLMProvider.isProviderAvailable('claude')) {
        this.claudeTestResult = 'success';
      } else {
        this.claudeTestResult = 'error';
      }
    } catch {
      this.claudeTestResult = 'error';
    } finally {
      this.isTestingClaude = false;
    }
  }

  clearClaudeApiKey(): void {
    this.claudeApiKey = '';
    this.claudeTestResult = null;
    this.onClaudeApiKeyChange();
  }

  // Provider preferences
  async onProviderPreferenceChange(): Promise<void> {
    await this.savePreference({ llmProviderPreferences: this.llmProviderPreferences });
  }

  private async savePreference(pref: Record<string, unknown>): Promise<void> {
    try {
      await this.authService.updateUserPreferences({
        ...this.authService.currentUser()?.preferences,
        ...pref,
      });
    } catch {
      this.snackBar.open(this.translationService.t('common.error'), this.translationService.t('common.close'), {
        duration: 3000,
        horizontalPosition: 'center',
      });
    }
  }

  onAutoSyncChange(enabled: boolean): void {
    this.autoSync.set(enabled);
    this.strategyService.updatePreferences({ autoSync: enabled });
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
    const message = this.translationService.t(key);
    const okText = this.translationService.t('common.close') || 'OK';
    this.snackBar.open(message, okText, { duration: 3000 });
  }
}
