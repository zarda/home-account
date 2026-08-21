import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import {
  LLMProvider, LLMProviderPreferences, DEFAULT_LLM_PROVIDER_PREFERENCES,
  RagInsightsLevel, RAG_INSIGHTS_LEVELS, effectiveRagLevel,
} from '../../../models';
import { TEXT_MODELS, VISION_MODELS, OPENAI_MODELS, CLAUDE_MODELS, DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_CLAUDE_MODEL } from '../../../core/config/ai-models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { NotificationService } from '../../../core/services/notification.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';

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
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-settings-page.component.html',
  styleUrl: './ai-settings-page.component.scss',
})
export class AiSettingsPageComponent implements OnInit {
  private notifications = inject(NotificationService);
  private strategyService = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private geminiService = inject(GeminiService);
  private translationService = inject(TranslationService);
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private authService = inject(AuthService);
  private providerKeys = inject(ProviderKeyService);
  private location = inject(Location);
  private categoryMemory = inject(CategoryMemoryService);
  private tagMemory = inject(TagMemoryService);

  // Form state
  autoSync = signal<boolean>(true);
  /** Merchants the user has corrected, which imports reuse instead of re-asking the model. */
  readonly rememberedCategoryCount = this.categoryMemory.rememberedCount;
  readonly clearingCategoryMemory = signal<boolean>(false);
  /** Merchants whose tag decisions imports reuse instead of re-suggesting. */
  readonly rememberedTagCount = this.tagMemory.rememberedCount;
  readonly clearingTagMemory = signal<boolean>(false);
  ragInsightsLevel = signal<RagInsightsLevel>('off');
  ragLevels = RAG_INSIGHTS_LEVELS;
  selectedTextModel = signal<string>(DEFAULT_TEXT_MODEL);
  selectedVisionModel = signal<string>(DEFAULT_VISION_MODEL);
  selectedOpenaiModel = signal<string>(DEFAULT_OPENAI_MODEL);
  selectedClaudeModel = signal<string>(DEFAULT_CLAUDE_MODEL);

  // Available models (single source of truth in core/config/ai-models.ts)
  textModels = TEXT_MODELS;
  visionModels = VISION_MODELS;
  openaiModels = OPENAI_MODELS;
  claudeModels = CLAUDE_MODELS;

  // API Keys for all providers
  geminiApiKey = signal('');
  openaiApiKey = signal('');
  claudeApiKey = signal('');

  /**
   * Whether the stored keys were actually read. The fields are blank before
   * that, and saving a blank field deletes the stored key — so no key write is
   * accepted until a real read has happened.
   */
  keysLoaded = signal<boolean>(false);

  // Provider preferences
  llmProviderPreferences: LLMProviderPreferences = DEFAULT_LLM_PROVIDER_PREFERENCES;

  // Testing state for each provider
  isTestingGemini = signal(false);
  isTestingOpenai = signal(false);
  isTestingClaude = signal(false);
  geminiTestResult = signal<'success' | 'error' | null>(null);
  openaiTestResult = signal<'success' | 'error' | null>(null);
  claudeTestResult = signal<'success' | 'error' | null>(null);

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
  canUseAppleIntelligence = computed(() => this.strategyService.canUseAppleIntelligence());
  useNativeOCR = computed(() => this.strategyService.useNativeOCR());
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

  // AI status text (on Macs cloud AI is preferred over native OCR when configured)
  aiStatusText = computed(() => {
    if (this.useNativeOCR()) {
      return this.canUseAppleIntelligence()
        ? this.translationService.t('aiPage.appleIntelligenceReady')
        : this.translationService.t('aiPage.nativeOCRReady');
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
    void this.loadApiKeys();
    this.loadModelSelection();
  }

  goBack(): void {
    this.location.back();
  }

  private loadPreferences(): void {
    const prefs = this.strategyService.preferences();
    this.autoSync.set(prefs.autoSync);
  }

  private loadModelSelection(): void {
    const prefs = this.strategyService.preferences();
    this.selectedTextModel.set(prefs.textModel || DEFAULT_TEXT_MODEL);
    this.selectedVisionModel.set(prefs.visionModel || DEFAULT_VISION_MODEL);
    this.selectedOpenaiModel.set(prefs.openaiModel || DEFAULT_OPENAI_MODEL);
    this.selectedClaudeModel.set(prefs.claudeModel || DEFAULT_CLAUDE_MODEL);
  }

  onOpenaiModelChange(modelId: string): void {
    if (!this.openaiModels.some(m => m.id === modelId)) {
      return;
    }
    this.selectedOpenaiModel.set(modelId);
    this.strategyService.updatePreferences({ openaiModel: modelId });
    const modelName = this.openaiModels.find(m => m.id === modelId)?.name || modelId;
    const message = this.translationService.t('aiPage.openaiModelUpdated', { model: modelName });
    this.notifications.success(message);
  }

  onClaudeModelChange(modelId: string): void {
    if (!this.claudeModels.some(m => m.id === modelId)) {
      return;
    }
    this.selectedClaudeModel.set(modelId);
    this.strategyService.updatePreferences({ claudeModel: modelId });
    const modelName = this.claudeModels.find(m => m.id === modelId)?.name || modelId;
    const message = this.translationService.t('aiPage.claudeModelUpdated', { model: modelName });
    this.notifications.success(message);
  }

  /** Forget every remembered merchant→category correction. */
  async clearCategoryMemory(): Promise<void> {
    this.clearingCategoryMemory.set(true);
    try {
      await this.categoryMemory.clear();
      this.notifications.success(this.translationService.t('aiPage.categoryMemoryCleared'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.clearingCategoryMemory.set(false);
    }
  }

  /** Forget every remembered merchant→tags decision. */
  async clearTagMemory(): Promise<void> {
    this.clearingTagMemory.set(true);
    try {
      await this.tagMemory.clear();
      this.notifications.success(this.translationService.t('aiPage.tagMemoryCleared'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.clearingTagMemory.set(false);
    }
  }

  private async loadApiKeys(): Promise<void> {
    const user = this.authService.currentUser();
    // Merge defaults: stored objects from before a feature existed lack its key.
    this.llmProviderPreferences = {
      ...DEFAULT_LLM_PROVIDER_PREFERENCES,
      ...user?.preferences?.llmProviderPreferences,
    };
    this.ragInsightsLevel.set(effectiveRagLevel(user?.preferences));

    // The remembered counts are display-only, so they must not delay the key
    // fields — an await here would push every following line a microtask
    // later for no benefit.
    void this.categoryMemory.ensureLoaded();
    void this.tagMemory.ensureLoaded();

    // Keys live outside the user document now, so this is the one place that
    // reads them for display.
    const secrets = await this.providerKeys.resolve();
    if (this.providerKeys.loadFailed()) {
      // The fields would render empty even though keys are stored, and a stray
      // blur would then save that emptiness over them.
      this.keysLoaded.set(false);
      this.notifications.error(this.translationService.t('aiPage.keysUnavailable'));
      return;
    }

    this.geminiApiKey.set(secrets.gemini ?? '');
    this.openaiApiKey.set(secrets.openai ?? '');
    this.claudeApiKey.set(secrets.claude ?? '');
    this.keysLoaded.set(true);
  }

  async onRagLevelChange(level: RagInsightsLevel): Promise<void> {
    if (!RAG_INSIGHTS_LEVELS.includes(level)) {
      return;
    }
    this.ragInsightsLevel.set(level);
    // Dual-write: keep the legacy boolean in sync so older installed
    // clients (which only read enableRagInsights) behave sensibly.
    await this.savePreference({ ragInsightsLevel: level, enableRagInsights: level !== 'off' });
  }

  // Check if provider is available
  isProviderAvailable(provider: LLMProvider): boolean {
    return this.cloudLLMProvider.isProviderAvailable(provider);
  }

  // Model selection handlers
  onTextModelChange(modelId: string): void {
    // Validate model ID
    if (!this.textModels.some(m => m.id === modelId)) {
      const message = this.translationService.t('aiPage.invalidModelSelection');
      this.notifications.error(message);
      return;
    }

    try {
      this.selectedTextModel.set(modelId);
      this.strategyService.updatePreferences({ textModel: modelId });
      const modelName = this.textModels.find(m => m.id === modelId)?.name || modelId;
      const message = this.translationService.t('aiPage.textModelUpdated', { model: modelName });
      this.notifications.success(message);
    } catch (error) {
      console.error('[AI Settings] Failed to change text model:', error);
      const message = this.translationService.t('aiPage.textModelUpdateFailed');
      this.notifications.error(message);
      // Reload from preferences
      this.loadModelSelection();
    }
  }

  onVisionModelChange(modelId: string): void {
    // Validate model ID
    if (!this.visionModels.some(m => m.id === modelId)) {
      const message = this.translationService.t('aiPage.invalidModelSelection');
      this.notifications.error(message);
      return;
    }

    try {
      this.selectedVisionModel.set(modelId);
      this.strategyService.updatePreferences({ visionModel: modelId });
      const modelName = this.visionModels.find(m => m.id === modelId)?.name || modelId;
      const message = this.translationService.t('aiPage.visionModelUpdated', { model: modelName });
      this.notifications.success(message);
    } catch (error) {
      console.error('[AI Settings] Failed to change vision model:', error);
      const message = this.translationService.t('aiPage.visionModelUpdateFailed');
      this.notifications.error(message);
      // Reload from preferences
      this.loadModelSelection();
    }
  }

  // Gemini API Key handling
  async onGeminiApiKeyChange(): Promise<void> {
    this.geminiTestResult.set(null);
    if (!this.keysLoaded()) return;
    await this.providerKeys.setKey('gemini', this.geminiApiKey() || undefined);
    await this.cloudLLMProvider.updateProviderApiKey('gemini', this.geminiApiKey() || undefined);
  }

  async testGeminiApiKey(): Promise<void> {
    if (!this.geminiApiKey()) return;

    this.isTestingGemini.set(true);
    this.geminiTestResult.set(null);

    try {
      await this.cloudLLMProvider.updateProviderApiKey('gemini', this.geminiApiKey());
      if (this.cloudLLMProvider.isProviderAvailable('gemini')) {
        this.geminiTestResult.set('success');
      } else {
        this.geminiTestResult.set('error');
      }
    } catch {
      this.geminiTestResult.set('error');
    } finally {
      this.isTestingGemini.set(false);
    }
  }

  clearGeminiApiKey(): void {
    this.geminiApiKey.set('');
    this.geminiTestResult.set(null);
    this.onGeminiApiKeyChange();
  }

  // OpenAI API Key handling
  async onOpenaiApiKeyChange(): Promise<void> {
    this.openaiTestResult.set(null);
    if (!this.keysLoaded()) return;
    await this.providerKeys.setKey('openai', this.openaiApiKey() || undefined);
    await this.cloudLLMProvider.updateProviderApiKey('openai', this.openaiApiKey() || undefined);
  }

  async testOpenaiApiKey(): Promise<void> {
    if (!this.openaiApiKey()) return;

    this.isTestingOpenai.set(true);
    this.openaiTestResult.set(null);

    try {
      await this.cloudLLMProvider.updateProviderApiKey('openai', this.openaiApiKey());
      if (this.cloudLLMProvider.isProviderAvailable('openai')) {
        this.openaiTestResult.set('success');
      } else {
        this.openaiTestResult.set('error');
      }
    } catch {
      this.openaiTestResult.set('error');
    } finally {
      this.isTestingOpenai.set(false);
    }
  }

  clearOpenaiApiKey(): void {
    this.openaiApiKey.set('');
    this.openaiTestResult.set(null);
    this.onOpenaiApiKeyChange();
  }

  // Claude API Key handling
  async onClaudeApiKeyChange(): Promise<void> {
    this.claudeTestResult.set(null);
    if (!this.keysLoaded()) return;
    await this.providerKeys.setKey('claude', this.claudeApiKey() || undefined);
    await this.cloudLLMProvider.updateProviderApiKey('claude', this.claudeApiKey() || undefined);
  }

  async testClaudeApiKey(): Promise<void> {
    if (!this.claudeApiKey()) return;

    this.isTestingClaude.set(true);
    this.claudeTestResult.set(null);

    try {
      await this.cloudLLMProvider.updateProviderApiKey('claude', this.claudeApiKey());
      if (this.cloudLLMProvider.isProviderAvailable('claude')) {
        this.claudeTestResult.set('success');
      } else {
        this.claudeTestResult.set('error');
      }
    } catch {
      this.claudeTestResult.set('error');
    } finally {
      this.isTestingClaude.set(false);
    }
  }

  clearClaudeApiKey(): void {
    this.claudeApiKey.set('');
    this.claudeTestResult.set(null);
    this.onClaudeApiKeyChange();
  }

  // Provider preferences
  async onProviderPreferenceChange(): Promise<void> {
    await this.savePreference({ llmProviderPreferences: this.llmProviderPreferences });
  }

  private async savePreference(pref: Record<string, unknown>): Promise<void> {
    try {
      // Only the touched keys: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences(pref);
    } catch {
      const message = this.translationService.t('common.error');
      this.notifications.error(message);
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
      const message = this.translationService.t('aiPage.queueSyncFailed');
      this.notifications.error(message);
    }
  }

  async clearQueue(): Promise<void> {
    try {
      await this.offlineQueue.clearAll();
      this.showToast('aiPage.queueCleared');
    } catch {
      const message = this.translationService.t('aiPage.queueClearFailed');
      this.notifications.error(message);
    }
  }

  formatBytes(bytes: number): string {
    return this.pwaService.formatBytes(bytes);
  }

  private showToast(key: string): void {
    this.notifications.success(this.translationService.t(key));
  }
}
