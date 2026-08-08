import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PreviousPeriodData, isRateLimitMessage } from '../../../core/services/gemini.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { stripAdviceArtifacts } from '../../../core/utils/llm-text.utils';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryService } from '../../../core/services/category.service';
import { RagContextService } from '../../../core/services/rag-context.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import {
  Budget, CategoryTotal, Goal, Transaction, MonthlyTotal,
  RAG_TIER_CONFIGS, effectiveRagLevel,
} from '../../../models';
import {
  containsPotentialXSS,
  markdownToHtml,
} from '../../../core/utils/markdown.utils';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-ai-summary',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    EmptyStateComponent,
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-summary.component.html',
  styleUrl: './ai-summary.component.scss'
})
export class AiSummaryComponent {
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);
  private ragContextService = inject(RagContextService);
  private analytics = inject(AnalyticsService);
  private sanitizer = inject(DomSanitizer);

  // Inputs
  transactions = input<Transaction[]>([]);
  period = input<string>('this month');
  baseCurrency = input<string>('USD');
  previousPeriodData = input<PreviousPeriodData | null>(null);
  previousPeriodByCategory = input<CategoryTotal[] | null>(null);
  // Trailing-window expenses (~6 months, including the current period) used as
  // the baseline for RAG anomaly detection. Null falls back to current period.
  historicalExpenses = input<Transaction[] | null>(null);
  budgets = input<Budget[]>([]);
  goals = input<Goal[]>([]);

  // State
  summary = signal<string>('');
  advice = signal<string>('');
  isLoading = signal(false);
  hasError = signal(false);

  // The user's RAG grounding depth (persisted in Firestore; legacy boolean migrated)
  private ragLevel = computed(() =>
    effectiveRagLevel(this.authService.currentUser()?.preferences)
  );

  // Cache key for sessionStorage (includes locale for language-specific
  // caching, and the RAG level so changing tiers regenerates instead of
  // serving a stale cached summary). This computed is read synchronously
  // inside the constructor effect's call stack, which is what makes the
  // effect re-run when the level or provider preference changes.
  private cacheKey = computed(() => {
    const txIds = this.transactions().map(t => t.id).sort().join(',');
    const locale = this.translationService.currentLocale();
    const grounding = this.ragLevel();
    const provider = this.authService.currentUser()?.preferences?.llmProviderPreferences?.insights ?? 'gemini';
    // Goals feed the prompt, so a contribution or target change must
    // invalidate the cached summary rather than surviving inside it.
    const goalsFingerprint = this.goals()
      .map(g => `${g.id}:${g.contributedAmount}/${g.targetAmount}`)
      .sort()
      .join(',');
    return `ai-summary-${this.period()}-${locale}-${grounding}-${provider}-${goalsFingerprint}-${txIds.slice(0, 100)}`;
  });

  // Check if any cloud AI provider is available
  isAvailable = computed(() => this.cloudLLMProvider.hasAnyCloudProvider());

  // Minimum transactions required for insights
  hasEnoughData = computed(() => this.transactions().length >= 3);

  // Prompt category names resolve through the categories signal (in the
  // providers and RagContextService). Generating before it loads would label
  // every category "Other" and cache that summary for an hour, so generation
  // waits until the merged defaults+user list has arrived.
  private categoriesReady = computed(() => this.categoryService.categories().length > 0);

  constructor() {
    // React to transaction, period, and locale changes
    effect(() => {
      const txns = this.transactions();
      const period = this.period();
      // Track locale changes - when locale changes, cache key changes, triggering regeneration
      this.translationService.currentLocale();

      console.log('[AiSummary] Effect triggered:', {
        transactionCount: txns.length,
        period,
        isAvailable: this.isAvailable(),
        hasEnoughData: txns.length >= 3,
        categoriesReady: this.categoriesReady()
      });

      if (txns.length >= 3 && this.isAvailable() && this.categoriesReady()) {
        console.log('[AiSummary] Loading insights...');
        this.loadInsights(txns, period);
      } else {
        console.log('[AiSummary] Skipping - not enough data, AI unavailable, or categories not loaded');
      }
    });
  }

  private async loadInsights(transactions: Transaction[], period: string): Promise<void> {
    // Check cache first
    const cached = this.getCachedInsights();
    if (cached) {
      this.summary.set(cached.summary);
      this.advice.set(cached.advice);
      return;
    }

    await this.generateInsights(transactions, period);
  }

  async refresh(): Promise<void> {
    // Clear cache and regenerate
    this.clearCache();
    await this.generateInsights(this.transactions(), this.period());
  }

  private async generateInsights(transactions: Transaction[], period: string): Promise<void> {
    if (!this.cloudLLMProvider.hasAnyCloudProvider() || transactions.length < 3 || !this.categoriesReady()) {
      return;
    }

    // The caller has already returned on a cache hit, so this is a real
    // request rather than a render of a stored summary.
    this.analytics.trackAiAssistUsed({ feature: 'summary' });

    this.isLoading.set(true);
    this.hasError.set(false);

    try {
      // Rates must be loaded before any live conversion; otherwise foreign
      // amounts fall back 1:1 and wrong numbers get cached for an hour.
      await this.currencyService.ensureRatesLoaded();

      const currency = this.baseCurrency();
      const periodTotal = this.calculatePeriodTotal(transactions);
      const readablePeriod = this.formatPeriod(period);

      // Generate sequentially — firing both at once trips free-tier
      // per-minute rate limits. Each call fails independently so a
      // rate-limited summary still leaves usable advice (and vice versa).
      let summaryFailed = false;
      let adviceFailed = false;

      // At any level above off, retrieve notable activity (top expenses,
      // anomalies, category deltas) for the prompt, sized by the tier.
      const level = this.ragLevel();
      const ragContext = level !== 'off'
        ? this.ragContextService.buildSummaryGrounding({
            transactions,
            previousByCategory: this.previousPeriodByCategory(),
            baseCurrency: currency,
            historicalExpenses: this.historicalExpenses(),
            config: RAG_TIER_CONFIGS[level],
          })
        : undefined;

      let summaryResult: string;
      try {
        summaryResult = await this.cloudLLMProvider.generateSpendingSummary(
          transactions,
          readablePeriod,
          currency,
          this.previousPeriodData(),
          this.budgets(),
          this.goals(),
          ragContext
        );
      } catch (error) {
        summaryFailed = true;
        summaryResult = this.describeFailure(error);
      }

      let adviceResult: string;
      try {
        adviceResult = stripAdviceArtifacts(
          await this.cloudLLMProvider.getFinancialAdvice(periodTotal, currency, readablePeriod)
        );
      } catch (error) {
        adviceFailed = true;
        adviceResult = this.describeFailure(error, 'ai.adviceFallback');
      }

      this.summary.set(summaryResult);
      this.advice.set(adviceResult);

      // Cache only real results — caching a failure message would pin it
      // for an hour even after a temporary rate limit clears
      if (!summaryFailed && !adviceFailed) {
        this.cacheInsights(summaryResult, adviceResult);
      }
    } catch (error) {
      console.error('Failed to generate AI insights:', error);
      this.hasError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Translate a generation failure into a localized, actionable message.
   * The default explains the failure; advice uses a generic tip fallback
   * unless the cause is something the user can act on.
   */
  private describeFailure(error: unknown, fallbackKey = 'ai.summaryUnavailable'): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('API key not valid') || message.includes('API_KEY_INVALID')) {
      return this.translationService.t('ai.invalidApiKey');
    }
    if (isRateLimitMessage(message)) {
      return this.translationService.t('ai.rateLimited');
    }
    return this.translationService.t(fallbackKey);
  }

  private calculatePeriodTotal(transactions: Transaction[]): MonthlyTotal {
    const baseCurrency = this.baseCurrency();
    const toBase = (t: Transaction) => this.currencyService.convert(t.amount, t.currency, baseCurrency);

    const income = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + toBase(t), 0);

    const expense = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + toBase(t), 0);

    // Group by category
    const categoryTotals = new Map<string, number>();
    for (const t of transactions.filter(t => t.type === 'expense')) {
      categoryTotals.set(t.categoryId, (categoryTotals.get(t.categoryId) || 0) + toBase(t));
    }

    return {
      income,
      expense,
      balance: income - expense,
      transactionCount: transactions.length,
      byCategory: Array.from(categoryTotals.entries()).map(([categoryId, total]) => ({
        categoryId,
        total
      }))
    };
  }

  private getCachedInsights(): { summary: string; advice: string } | null {
    try {
      const cached = sessionStorage.getItem(this.cacheKey());
      if (cached) {
        const parsed = JSON.parse(cached);
        // Check if cache is less than 1 hour old
        if (Date.now() - parsed.timestamp < 60 * 60 * 1000) {
          return { summary: parsed.summary, advice: parsed.advice };
        }
      }
    } catch {
      // Ignore cache errors
    }
    return null;
  }

  private cacheInsights(summary: string, advice: string): void {
    try {
      sessionStorage.setItem(this.cacheKey(), JSON.stringify({
        summary,
        advice,
        timestamp: Date.now()
      }));
    } catch {
      // Ignore cache errors (e.g., quota exceeded)
    }
  }

  private clearCache(): void {
    try {
      sessionStorage.removeItem(this.cacheKey());
    } catch {
      // Ignore errors
    }
  }

  // Convert period key to human-readable string for AI prompts
  private formatPeriod(period: string): string {
    const periodMap: Record<string, string> = {
      'thisMonth': 'this month',
      'lastMonth': 'last month',
      'last3Months': 'the last 3 months',
      'thisYear': 'this year'
    };

    // Check if it's a known period key
    if (periodMap[period]) {
      return periodMap[period];
    }

    // If it's a custom period (already formatted like "Jan 2024" or "2024"), return as-is
    return period;
  }

  /**
   * Format markdown to HTML for display.
   *
   * The string work lives in core/utils/markdown.utils so the insights narrative
   * shares it rather than carrying a second copy of the XSS pre-check. The
   * sanitizer call stays here, because trusting HTML belongs where it is
   * rendered.
   */
  formatMarkdown(markdown: string): SafeHtml {
    if (containsPotentialXSS(markdown)) {
      console.warn('[AI Summary] Potential XSS detected in markdown content');
      return this.sanitizer.sanitize(1, markdown) || ''; // 1 = SecurityContext.HTML
    }
    return this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(markdown));
  }
}
