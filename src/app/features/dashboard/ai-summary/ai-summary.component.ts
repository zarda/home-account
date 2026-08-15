import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  PreviousPeriodData,
  isRateLimitMessage,
} from '../../../core/services/llm-provider.interface';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { goalProgressAmount } from '../../../core/utils/goal-progress.utils';
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

  /**
   * Bumped by every load. A generation captures it before its first await and
   * drops everything it produces — the rendered text, the cache write, the
   * spinner — once the counter has moved past it.
   *
   * Two provider round trips separate the request from its result, and the
   * period selector, the locale, the RAG tier and the goal list can all change
   * inside that gap. The house pattern is transaction-window.service.ts.
   */
  private generation = 0;

  /** Beyond this a stored summary describes a window the user has moved on from. */
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;

  // The user's RAG grounding depth (persisted in Firestore; legacy boolean migrated)
  private ragLevel = computed(() =>
    effectiveRagLevel(this.authService.currentUser()?.preferences)
  );

  // Cache key for sessionStorage (includes locale for language-specific
  // caching, and the RAG level so changing tiers regenerates instead of
  // serving a stale cached summary).
  //
  // Read once per request, in the effect below, and then passed down. Never
  // re-read after an await: it tracks live signals, so re-reading it at write
  // time filed a finished summary under whatever the selector had moved to.
  private cacheKey = computed(() => {
    const txIds = this.transactions().map(t => t.id).sort().join(',');
    const locale = this.translationService.currentLocale();
    const grounding = this.ragLevel();
    const provider = this.authService.currentUser()?.preferences?.llmProviderPreferences?.insights ?? 'gemini';
    // Goals feed the prompt, so a contribution, a linked transaction or a
    // target change must invalidate the cached summary rather than
    // surviving inside it.
    const goalsFingerprint = this.goals()
      .map(g => `${g.id}:${goalProgressAmount(g)}/${g.targetAmount}`)
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
    effect(() => {
      const txns = this.transactions();
      const period = this.period();
      // Read here, in the tracked body, deliberately. The key folds in the
      // locale, the RAG tier, the provider preference and the goal fingerprint,
      // and reading it is what makes any of them re-run this effect. It used to
      // be reached only through getCachedInsights' call stack, which made those
      // dependencies real but invisible.
      const key = this.cacheKey();
      const ready = this.isAvailable() && this.categoriesReady();

      untracked(() => {
        if (txns.length >= 3 && ready) {
          void this.loadInsights(txns, period, key);
        }
      });
    });
  }

  private async loadInsights(
    transactions: Transaction[],
    period: string,
    key: string,
  ): Promise<void> {
    // Bumped before the cache read, not after: a hit supersedes whatever is
    // still in flight. Without this, an older generation would still pass its
    // own guard on return and overwrite the text this one just rendered.
    const gen = ++this.generation;

    const cached = this.getCachedInsights(key);
    if (cached) {
      this.summary.set(cached.summary);
      this.advice.set(cached.advice);
      this.hasError.set(false);
      return;
    }

    await this.generateInsights(transactions, period, key, gen);
  }

  async refresh(): Promise<void> {
    const key = this.cacheKey();
    const gen = ++this.generation;
    this.clearCache(key);
    await this.generateInsights(this.transactions(), this.period(), key, gen);
  }

  private async generateInsights(
    transactions: Transaction[],
    period: string,
    key: string,
    gen: number,
  ): Promise<void> {
    if (!this.cloudLLMProvider.hasAnyCloudProvider() || transactions.length < 3 || !this.categoriesReady()) {
      return;
    }

    this.isLoading.set(true);
    this.hasError.set(false);

    try {
      // Rates must be loaded before any live conversion; otherwise foreign
      // amounts fall back 1:1 and wrong numbers get cached for an hour.
      await this.currencyService.ensureRatesLoaded();
      if (gen !== this.generation) {
        return;
      }

      // Counted here rather than at entry: past the cache hit and past the
      // first await, so this is one event per pair of provider calls actually
      // issued, not per effect firing.
      this.analytics.trackAiAssistUsed({ feature: 'summary' });

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

      // Superseded while the providers were answering: this text describes a
      // period, locale or tier the user has already left. Rendering it would
      // put the wrong months on screen, and caching it would serve them back
      // under the new key for the rest of the TTL.
      if (gen !== this.generation) {
        return;
      }

      this.summary.set(summaryResult);
      this.advice.set(adviceResult);

      // Cache only real results — caching a failure message would pin it
      // for an hour even after a temporary rate limit clears
      if (!summaryFailed && !adviceFailed) {
        this.cacheInsights(key, summaryResult, adviceResult);
      }
    } catch (error) {
      console.error('Failed to generate AI insights:', error);
      if (gen === this.generation) {
        this.hasError.set(true);
      }
    } finally {
      // A superseded run must not clear the spinner: the newest generation is
      // still working, and the card would flash its old text in the meantime.
      if (gen === this.generation) {
        this.isLoading.set(false);
      }
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

  private getCachedInsights(key: string): { summary: string; advice: string } | null {
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < AiSummaryComponent.CACHE_TTL_MS) {
          return { summary: parsed.summary, advice: parsed.advice };
        }
      }
    } catch {
      // Ignore cache errors
    }
    return null;
  }

  private cacheInsights(key: string, summary: string, advice: string): void {
    try {
      sessionStorage.setItem(key, JSON.stringify({
        summary,
        advice,
        timestamp: Date.now()
      }));
    } catch {
      // Ignore cache errors (e.g., quota exceeded)
    }
  }

  private clearCache(key: string): void {
    try {
      sessionStorage.removeItem(key);
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
