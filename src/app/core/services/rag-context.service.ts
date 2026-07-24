import { Injectable, inject } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { CategoryTotal, RAG_TIER_CONFIGS, RagTierConfig, Transaction } from '../../models';

/**
 * Retrieval helpers for RAG-grounded AI features. Builds compact, factual
 * context blocks from the user's own data so LLM insights can cite real,
 * notable activity instead of generic patterns.
 *
 * Depth is driven by the `ragInsightsLevel` user preference: the caller
 * resolves the level (via effectiveRagLevel) and passes the matching
 * RagTierConfig; this service stays a pure transformer over the data and
 * caps it is given.
 */
@Injectable({ providedIn: 'root' })
export class RagContextService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  /**
   * Build the grounding block for the dashboard spending summary.
   * Returns an empty string when there is nothing notable to report.
   */
  buildSummaryGrounding(opts: {
    transactions: Transaction[];
    previousByCategory: CategoryTotal[] | null;
    baseCurrency: string;
    /**
     * Trailing-window expenses (including the current period) used as the
     * baseline for anomaly detection. When omitted or empty, the baseline
     * collapses to the current period.
     */
    historicalExpenses?: Transaction[] | null;
    /** Per-tier section caps; omitted = the standard tier. */
    config?: RagTierConfig;
  }): string {
    const { transactions, previousByCategory, baseCurrency } = opts;
    const config = opts.config ?? RAG_TIER_CONFIGS.standard;
    const expenses = transactions.filter(t => t.type === 'expense');
    if (expenses.length === 0) {
      return '';
    }

    // Snapshot-preferring conversion: deterministic even before live
    // exchange rates finish loading.
    const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);
    const amount = (value: number) => this.currencyService.formatAmount(value, baseCurrency);
    const sections: string[] = [];

    const topExpenses = this.buildTopExpenses(expenses, toBase, amount, baseCurrency, config.topExpenses);
    if (topExpenses) {
      sections.push(topExpenses);
    }

    if (config.anomalies > 0) {
      // Prefer a longer historical baseline when supplied; otherwise fall back
      // to the current period's expenses.
      const baselineExpenses = opts.historicalExpenses?.length
        ? opts.historicalExpenses.filter(t => t.type === 'expense')
        : expenses;

      const anomalies = this.buildAmountAnomalies(
        expenses, baselineExpenses, toBase, amount, baseCurrency, config.anomalies);
      if (anomalies) {
        sections.push(anomalies);
      }
    }

    const deltas = this.buildCategoryDeltas(
      expenses, previousByCategory, toBase, amount, baseCurrency, config.categoryDeltas);
    if (deltas) {
      sections.push(deltas);
    }

    return sections.join('\n\n');
  }

  /** Top expenses by amount: `description — amount (category, date)`. */
  private buildTopExpenses(
    expenses: Transaction[],
    toBase: (t: Transaction) => number,
    amount: (value: number) => string,
    baseCurrency: string,
    cap: number,
  ): string {
    const lines = [...expenses]
      .sort((a, b) => toBase(b) - toBase(a))
      .slice(0, cap)
      .map(t => `- ${t.description} — ${amount(toBase(t))} ${baseCurrency} (${this.categoryName(t.categoryId)}, ${this.formatDate(t.date)})`);

    return lines.length > 0 ? `Top expenses:\n${lines.join('\n')}` : '';
  }

  /**
   * Flag current-period transactions far above their category's typical amount
   * (above mean + 2*stddev, in categories with at least 4 baseline samples).
   * The baseline distribution is drawn from `baselineExpenses` — a trailing
   * window that includes the current period — so the detector works early in
   * a period and reflects month-over-month norms. Only `expenses` (the current
   * period) are eligible to be flagged; when no history is supplied
   * `baselineExpenses` equals `expenses` and this reduces to a
   * current-period-only baseline.
   */
  private buildAmountAnomalies(
    expenses: Transaction[],
    baselineExpenses: Transaction[],
    toBase: (t: Transaction) => number,
    amount: (value: number) => string,
    baseCurrency: string,
    cap: number,
  ): string {
    const baselineByCategory = new Map<string, number[]>();
    for (const t of baselineExpenses) {
      const list = baselineByCategory.get(t.categoryId) ?? [];
      list.push(toBase(t));
      baselineByCategory.set(t.categoryId, list);
    }

    const candidatesByCategory = new Map<string, Transaction[]>();
    for (const t of expenses) {
      const list = candidatesByCategory.get(t.categoryId) ?? [];
      list.push(t);
      candidatesByCategory.set(t.categoryId, list);
    }

    const anomalies: { transaction: Transaction; value: number; typical: number }[] = [];
    for (const [categoryId, candidates] of candidatesByCategory) {
      const baseline = baselineByCategory.get(categoryId) ?? [];
      if (baseline.length < 4) {
        continue;
      }
      const mean = baseline.reduce((sum, a) => sum + a, 0) / baseline.length;
      const variance = baseline.reduce((sum, a) => sum + (a - mean) ** 2, 0) / baseline.length;
      const threshold = mean + 2 * Math.sqrt(variance);

      for (const transaction of candidates) {
        const value = toBase(transaction);
        if (value > threshold) {
          anomalies.push({ transaction, value, typical: mean });
        }
      }
    }

    const lines = anomalies
      .sort((a, b) => b.value - a.value)
      .slice(0, cap)
      .map(({ transaction, value, typical }) =>
        `- ${transaction.description} — ${amount(value)} ${baseCurrency} is unusually high for ${this.categoryName(transaction.categoryId)} (typical: ${amount(typical)} ${baseCurrency})`);

    return lines.length > 0 ? `Unusual amounts:\n${lines.join('\n')}` : '';
  }

  /** Largest per-category spending changes vs. the previous period. */
  private buildCategoryDeltas(
    expenses: Transaction[],
    previousByCategory: CategoryTotal[] | null,
    toBase: (t: Transaction) => number,
    amount: (value: number) => string,
    baseCurrency: string,
    cap: number,
  ): string {
    if (!previousByCategory || previousByCategory.length === 0) {
      return '';
    }

    const currentTotals = new Map<string, number>();
    for (const t of expenses) {
      currentTotals.set(t.categoryId, (currentTotals.get(t.categoryId) ?? 0) + toBase(t));
    }
    const previousTotals = new Map(previousByCategory.map(c => [c.categoryId, c.total]));

    const categoryIds = new Set([...currentTotals.keys(), ...previousTotals.keys()]);
    const deltas = [...categoryIds]
      .map(categoryId => {
        const current = currentTotals.get(categoryId) ?? 0;
        const previous = previousTotals.get(categoryId) ?? 0;
        return { categoryId, current, previous, change: current - previous };
      })
      .filter(d => Math.abs(d.change) > 0.005)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, cap);

    const lines = deltas.map(({ categoryId, current, previous, change }) => {
      const direction = change > 0 ? 'up' : 'down';
      const percent = previous > 0 ? ` (${direction} ${(Math.abs(change) / previous * 100).toFixed(0)}%)` : ' (new this period)';
      return `- ${this.categoryName(categoryId)}: ${amount(previous)} → ${amount(current)} ${baseCurrency}${percent}`;
    });

    return lines.length > 0 ? `Category changes vs. previous period:\n${lines.join('\n')}` : '';
  }

  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Other';
  }

  private formatDate(date: Transaction['date'] | Date): string {
    const parsed = date instanceof Date ? date : date?.toDate?.();
    return parsed instanceof Date && !isNaN(parsed.getTime())
      ? parsed.toISOString().split('T')[0]
      : '';
  }
}
