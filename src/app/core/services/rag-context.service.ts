import { Injectable, inject } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { CategoryTotal, RAG_TIER_CONFIGS, RagTierConfig, Transaction } from '../../models';
import { normalizeMerchantKey } from '../utils/merchant-key.utils';
import { dayKey, toDate } from '../utils/transaction-date.utils';
import {
  computeAmountAnomalies,
  computeCategoryDeltas,
  computeTopExpenses,
} from '../utils/spending-insight.utils';

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

  /**
   * Build the grounding block for import categorization: how this user has
   * actually filed things, so the model's suggestions match their habits
   * instead of a generic notion of what a merchant sells.
   *
   * Only merchants and category names — no amounts, dates or notes. A
   * categorizer does not need them, and the smallest context that answers the
   * question is the one to send.
   *
   * Returns an empty string when there is no history to ground in, which keeps
   * the prompt byte-identical to its ungrounded form.
   */
  buildCategorizationGrounding(opts: {
    transactions: Transaction[];
    /** Distinct merchants to describe. */
    merchantLimit?: number;
    /** Recently used categories to list. */
    recentLimit?: number;
  }): string {
    const { transactions } = opts;
    const merchantLimit = opts.merchantLimit ?? 15;
    const recentLimit = opts.recentLimit ?? 8;
    if (transactions.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // Most-repeated merchant → the category this user files it under. Ties go
    // to the most recent decision, since a re-categorization is a correction.
    const byMerchant = new Map<string, { description: string; categoryId: string; count: number }>();
    for (const t of transactions) {
      const key = normalizeMerchantKey(t.description);
      if (!key) continue;
      const existing = byMerchant.get(key);
      byMerchant.set(key, {
        description: t.description,
        categoryId: existing?.categoryId ?? t.categoryId,
        count: (existing?.count ?? 0) + 1,
      });
    }

    const merchantLines = [...byMerchant.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, merchantLimit)
      .map(m => `- ${m.description} → ${this.categoryName(m.categoryId)} (${m.categoryId})`);

    if (merchantLines.length > 0) {
      sections.push(`How this user usually categorizes these merchants:\n${merchantLines.join('\n')}`);
    }

    const recentCategories: string[] = [];
    for (const t of transactions) {
      const label = `${this.categoryName(t.categoryId)} (${t.categoryId})`;
      if (!recentCategories.includes(label)) {
        recentCategories.push(label);
      }
      if (recentCategories.length >= recentLimit) break;
    }

    if (recentCategories.length > 0) {
      sections.push(`Categories this user has used recently:\n${recentCategories.map(c => `- ${c}`).join('\n')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * How this user tags the merchants they tag. Empty when nothing in the
   * window carries a tag, which keeps the prompt byte-identical to its
   * ungrounded form.
   */
  buildTagGrounding(opts: { transactions: Transaction[]; merchantLimit?: number }): string {
    const merchantLimit = opts.merchantLimit ?? 15;
    const byMerchant = new Map<string, { description: string; tags: Set<string>; count: number }>();
    for (const t of opts.transactions) {
      if (!t.tags?.length) continue;
      const key = normalizeMerchantKey(t.description);
      if (!key) continue;
      const existing = byMerchant.get(key) ?? { description: t.description, tags: new Set<string>(), count: 0 };
      t.tags.forEach(tag => existing.tags.add(tag));
      existing.count += 1;
      byMerchant.set(key, existing);
    }
    const lines = [...byMerchant.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, merchantLimit)
      .map(m => `- ${m.description} → ${[...m.tags].join(', ')}`);
    return lines.length ? `How this user usually tags these merchants:\n${lines.join('\n')}` : '';
  }

  /** Top expenses by amount: `description — amount (category, date)`. */
  private buildTopExpenses(
    expenses: Transaction[],
    toBase: (t: Transaction) => number,
    amount: (value: number) => string,
    baseCurrency: string,
    cap: number,
  ): string {
    const lines = computeTopExpenses(expenses, toBase, cap)
      .map(({ transaction: t, value }) => `- ${t.description} — ${amount(value)} ${baseCurrency} (${this.categoryName(t.categoryId)}, ${this.formatDate(t.date)})`);

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
    const lines = computeAmountAnomalies(expenses, baselineExpenses, toBase, cap)
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
    const deltas = computeCategoryDeltas(expenses, previousByCategory, toBase, cap);

    const lines = deltas.map(({ categoryId, current, previous, change, isNew }) => {
      const direction = change > 0 ? 'up' : 'down';
      const percent = isNew ? ' (new this period)' : ` (${direction} ${(Math.abs(change) / previous * 100).toFixed(0)}%)`;
      return `- ${this.categoryName(categoryId)}: ${amount(previous)} → ${amount(current)} ${baseCurrency}${percent}`;
    });

    return lines.length > 0 ? `Category changes vs. previous period:\n${lines.join('\n')}` : '';
  }

  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Other';
  }

  /**
   * The local calendar day, matching what the app displays. toISOString would
   * hand the model a UTC day — the day before for an evening row west of UTC,
   * the day after for a midnight row east of it — and the prompt asks the
   * model to cite these dates back to the user.
   */
  private formatDate(date: Transaction['date'] | Date): string {
    const parsed = toDate(date);
    return parsed ? dayKey(parsed) : '';
  }
}
