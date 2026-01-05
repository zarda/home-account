import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GeminiService, PreviousPeriodData } from '../../../core/services/gemini.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Budget, Transaction, MonthlyTotal } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-ai-summary',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    TranslatePipe
  ],
  templateUrl: './ai-summary.component.html',
  styleUrl: './ai-summary.component.scss'
})
export class AiSummaryComponent {
  private geminiService = inject(GeminiService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  // Inputs
  transactions = input<Transaction[]>([]);
  period = input<string>('this month');
  baseCurrency = input<string>('USD');
  previousPeriodData = input<PreviousPeriodData | null>(null);
  budgets = input<Budget[]>([]);

  // State
  summary = signal<string>('');
  advice = signal<string>('');
  isLoading = signal(false);
  hasError = signal(false);

  // Cache key for sessionStorage (includes locale for language-specific caching)
  private cacheKey = computed(() => {
    const txIds = this.transactions().map(t => t.id).sort().join(',');
    const locale = this.translationService.currentLocale();
    return `ai-summary-${this.period()}-${locale}-${txIds.slice(0, 100)}`;
  });

  // Check if AI is available
  isAvailable = computed(() => this.geminiService.isAvailable());

  // Minimum transactions required for insights
  hasEnoughData = computed(() => this.transactions().length >= 3);

  constructor() {
    // React to transaction, period, and locale changes
    effect(() => {
      const txns = this.transactions();
      const period = this.period();
      // Track locale changes - when locale changes, cache key changes, triggering regeneration
      this.translationService.currentLocale();

      if (txns.length >= 3 && this.isAvailable()) {
        this.loadInsights(txns, period);
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
    if (!this.geminiService.isAvailable() || transactions.length < 3) {
      return;
    }

    this.isLoading.set(true);
    this.hasError.set(false);

    try {
      const currency = this.baseCurrency();
      const periodTotal = this.calculatePeriodTotal(transactions);
      const readablePeriod = this.formatPeriod(period);

      // Generate both summary and advice in parallel
      const [summaryResult, adviceResult] = await Promise.all([
        this.geminiService.generateSpendingSummary(
          transactions,
          readablePeriod,
          currency,
          this.previousPeriodData(),
          this.budgets()
        ),
        this.geminiService.getFinancialAdvice(periodTotal, currency, readablePeriod)
      ]);

      this.summary.set(summaryResult);
      this.advice.set(adviceResult);

      // Cache the results
      this.cacheInsights(summaryResult, adviceResult);
    } catch (error) {
      console.error('Failed to generate AI insights:', error);
      this.hasError.set(true);
    } finally {
      this.isLoading.set(false);
    }
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
}
