import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../../core/services/auth.service';
import { CategoryService } from '../../../../core/services/category.service';
import { CloudLLMProviderService } from '../../../../core/services/cloud-llm-provider.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { isRateLimitMessage } from '../../../../core/services/gemini.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import {
  InsightFacts,
  RAG_TIER_CONFIGS,
  RagInsightsLevel,
  effectiveRagLevel,
} from '../../../../models';
import {
  diffInsightFacts,
  hasMaterialChange,
  insightFactsFingerprint,
} from '../../../../core/utils/insight-facts.utils';
import { containsPotentialXSS, markdownToHtml } from '../../../../core/utils/markdown.utils';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * An optional written description of the detected patterns.
 *
 * Sits on top of the rule-based cards and is never required by them — the cards
 * stand alone with no provider configured, which is what #116 asks for.
 *
 * Gated on two conditions, both required. A configured provider is the obvious
 * one. The second is the user's existing RAG-insights level: detector output is
 * grounding data, and `ragInsightsLevel` is the control they already have over
 * how much of their financial data reaches a provider. Sending facts while that
 * setting is 'off' would violate what the setting means.
 *
 * What is sent is an explicit allowlist of aggregates and locally-resolved
 * category names. Never a transaction id, description, note, receipt URL,
 * location or individual date.
 */
@Component({
  selector: 'app-insight-narrative',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    LoadingSpinnerComponent,
    TranslatePipe,
  ],
  templateUrl: './insight-narrative.component.html',
  styleUrl: './insight-narrative.component.scss',
})
export class InsightNarrativeComponent {
  private cloudLLM = inject(CloudLLMProviderService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);
  private translation = inject(TranslationService);
  private sanitizer = inject(DomSanitizer);
  private analytics = inject(AnalyticsService);

  facts = input<InsightFacts | null>(null);
  /** The previous month's facts, when one is stored — enables the diff. */
  previousFacts = input<InsightFacts | null>(null);

  readonly narrative = signal<string>('');
  readonly isLoading = signal(false);
  readonly errorKey = signal<string | null>(null);
  /** True when nothing moved enough to be worth re-describing. */
  readonly isUnchanged = signal(false);

  private readonly ragLevel = computed<RagInsightsLevel>(
    () => effectiveRagLevel(this.authService.currentUser()?.preferences));

  readonly isAvailable = computed(
    () => this.cloudLLM.hasAnyCloudProvider() && this.ragLevel() !== 'off');

  readonly formatted = computed<SafeHtml>(() => {
    const text = this.narrative();
    if (!text) {
      return '';
    }
    if (containsPotentialXSS(text)) {
      console.warn('[Insights] Potential XSS detected in narrative content');
      return this.sanitizer.sanitize(1, text) || '';
    }
    return this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(text));
  });

  constructor() {
    effect(() => {
      const facts = this.facts();
      const available = this.isAvailable();
      untracked(() => {
        if (facts && available) {
          void this.generate(facts);
        } else {
          this.narrative.set('');
          this.errorKey.set(null);
        }
      });
    });
  }

  private cacheKey(facts: InsightFacts): string {
    // An exact fact fingerprint, unlike the dashboard summary's cache key, which
    // truncates its transaction-id list to 100 characters and can therefore
    // collide across genuinely different inputs.
    return [
      'insights-narrative',
      facts.window.start,
      facts.window.end,
      facts.detectorVersion,
      insightFactsFingerprint(facts),
      this.translation.currentLocale(),
      this.ragLevel(),
      this.cloudLLM.getPreferredProvider('insights'),
    ].join(':');
  }

  private async generate(facts: InsightFacts): Promise<void> {
    const key = this.cacheKey(facts);
    const cached = this.readCache(key);
    if (cached !== null) {
      this.narrative.set(cached);
      this.errorKey.set(null);
      return;
    }

    // Nothing moved materially since the stored month, so there is nothing new
    // to say and no reason to spend a request saying it.
    const previous = this.previousFacts();
    if (previous && !hasMaterialChange(diffInsightFacts(previous, facts))) {
      this.isUnchanged.set(true);
      this.narrative.set('');
      return;
    }
    this.isUnchanged.set(false);

    // Past the cache hit and the nothing-changed short circuit, so this counts
    // requests actually issued rather than times the card was rendered.
    this.analytics.trackAiAssistUsed({ feature: 'narrative' });

    this.isLoading.set(true);
    this.errorKey.set(null);
    try {
      const text = await this.cloudLLM.generatePatternNarrative(
        this.buildContext(facts), this.translation.currentLocale());
      this.narrative.set(text);
      this.writeCache(key, text);
    } catch (error) {
      // Failures are never cached, so a retry is not stuck with the error.
      this.narrative.set('');
      this.errorKey.set(this.describeFailure(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * The allowlist that goes to the provider.
   *
   * Volume scales with the RAG tier, which is the user's stated preference for
   * how much reaches a provider. Only aggregates and locally-resolved category
   * names — nothing a person typed.
   */
  private buildContext(facts: InsightFacts): string {
    const level = this.ragLevel();
    const config = level === 'off' ? null : RAG_TIER_CONFIGS[level];
    const trendCap = config?.categoryDeltas ?? 3;
    const lines: string[] = [
      `Period: ${facts.window.months.join(', ')}`,
      `Currency: ${facts.baseCurrency}`,
      `Total spending: ${facts.totals.expense}`,
      `Total income: ${facts.totals.income}`,
      `Recurring payments: ${facts.recurring.groupCount}`
        + ` totalling ${facts.recurring.totalMonthlyEquivalent} per month`,
    ];

    for (const trend of facts.trends.slice(0, trendCap)) {
      const percent = trend.changeRatio !== null
        ? `${Math.round(trend.changeRatio * 100)}%`
        : 'n/a';
      lines.push(
        `Category "${this.categoryName(trend.categoryId)}" is ${trend.direction}`
        + ` (${percent} vs. the first half of the window,`
        + ` ${Math.round(trend.windowShare * 100)}% of spending)`);
    }

    if (facts.drip.isNotable) {
      lines.push(
        `${facts.drip.count} purchases at or under ${facts.drip.threshold} came to`
        + ` ${facts.drip.total}, ${Math.round(facts.drip.shareOfSpending * 100)}% of spending`);
    }

    const rhythms = facts.rhythms;
    if (rhythms.hasEnoughData) {
      if (rhythms.weekdayWeekend.lean !== 'even') {
        lines.push(`Spends more per ${rhythms.weekdayWeekend.lean} day`
          + ` (ratio ${rhythms.weekdayWeekend.ratio})`);
      }
      if (rhythms.monthEnd.isSpike) {
        lines.push(`Spending rises in the last ${rhythms.monthEnd.tailDays} days of the month`);
      }
      if (rhythms.payday.isPresent) {
        lines.push('Spending rises in the days just after payday');
      }
    }

    if (level === 'deep') {
      for (const trend of facts.trends.slice(0, trendCap)) {
        lines.push(`Monthly series for "${this.categoryName(trend.categoryId)}":`
          + ` ${trend.series.join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(item => item.id === categoryId);
    return category?.name ? this.translation.t(category.name) : categoryId;
  }

  private describeFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/api[_ ]?key/i.test(message) || /invalid/i.test(message)) {
      return 'ai.invalidApiKey';
    }
    if (isRateLimitMessage(message)) {
      return 'ai.rateLimited';
    }
    return 'ai.summaryUnavailable';
  }

  private readCache(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeCache(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Quota or a disabled store: not fatal, it just regenerates next time.
    }
  }

  regenerate(): void {
    const facts = this.facts();
    if (!facts) {
      return;
    }
    try {
      sessionStorage.removeItem(this.cacheKey(facts));
    } catch {
      // Nothing to clear.
    }
    this.isUnchanged.set(false);
    void this.generate(facts);
  }
}
