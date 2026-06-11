import { Injectable, inject } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { CategoryTotal, Transaction } from '../../models';

/**
 * Retrieval helpers for RAG-grounded AI features. Builds compact, factual
 * context blocks from the user's own data so LLM insights can cite real,
 * notable activity instead of generic patterns.
 *
 * Gated by the `enableRagInsights` user preference (the caller checks it).
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
  }): string {
    const { transactions, previousByCategory, baseCurrency } = opts;
    const expenses = transactions.filter(t => t.type === 'expense');
    if (expenses.length === 0) {
      return '';
    }

    const toBase = (t: Transaction) => this.currencyService.convert(t.amount, t.currency, baseCurrency);
    const sections: string[] = [];

    const topExpenses = this.buildTopExpenses(expenses, toBase, baseCurrency);
    if (topExpenses) {
      sections.push(topExpenses);
    }

    const anomalies = this.buildAmountAnomalies(expenses, toBase, baseCurrency);
    if (anomalies) {
      sections.push(anomalies);
    }

    const deltas = this.buildCategoryDeltas(expenses, previousByCategory, toBase, baseCurrency);
    if (deltas) {
      sections.push(deltas);
    }

    return sections.join('\n\n');
  }

  /** Top ~10 expenses by amount: `description — amount (category, date)`. */
  private buildTopExpenses(
    expenses: Transaction[],
    toBase: (t: Transaction) => number,
    baseCurrency: string,
  ): string {
    const lines = [...expenses]
      .sort((a, b) => toBase(b) - toBase(a))
      .slice(0, 10)
      .map(t => `- ${t.description} — ${toBase(t).toFixed(2)} ${baseCurrency} (${this.categoryName(t.categoryId)}, ${this.formatDate(t.date)})`);

    return lines.length > 0 ? `Top expenses:\n${lines.join('\n')}` : '';
  }

  /**
   * Flag transactions far above their category's typical amount this period
   * (above mean + 2*stddev, in categories with at least 4 transactions).
   * Baseline is intentionally the current period's intra-category
   * distribution; a longer historical baseline is a future enhancement.
   */
  private buildAmountAnomalies(
    expenses: Transaction[],
    toBase: (t: Transaction) => number,
    baseCurrency: string,
  ): string {
    const byCategory = new Map<string, Transaction[]>();
    for (const t of expenses) {
      const list = byCategory.get(t.categoryId) ?? [];
      list.push(t);
      byCategory.set(t.categoryId, list);
    }

    const anomalies: { transaction: Transaction; amount: number; typical: number }[] = [];
    for (const transactions of byCategory.values()) {
      if (transactions.length < 4) {
        continue;
      }
      const amounts = transactions.map(toBase);
      const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
      const variance = amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / amounts.length;
      const threshold = mean + 2 * Math.sqrt(variance);

      for (let i = 0; i < transactions.length; i++) {
        if (amounts[i] > threshold) {
          anomalies.push({ transaction: transactions[i], amount: amounts[i], typical: mean });
        }
      }
    }

    const lines = anomalies
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map(({ transaction, amount, typical }) =>
        `- ${transaction.description} — ${amount.toFixed(2)} ${baseCurrency} is unusually high for ${this.categoryName(transaction.categoryId)} (typical: ${typical.toFixed(2)} ${baseCurrency})`);

    return lines.length > 0 ? `Unusual amounts:\n${lines.join('\n')}` : '';
  }

  /** Largest per-category spending changes vs. the previous period. */
  private buildCategoryDeltas(
    expenses: Transaction[],
    previousByCategory: CategoryTotal[] | null,
    toBase: (t: Transaction) => number,
    baseCurrency: string,
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
      .slice(0, 5);

    const lines = deltas.map(({ categoryId, current, previous, change }) => {
      const direction = change > 0 ? 'up' : 'down';
      const percent = previous > 0 ? ` (${direction} ${(Math.abs(change) / previous * 100).toFixed(0)}%)` : ' (new this period)';
      return `- ${this.categoryName(categoryId)}: ${previous.toFixed(2)} → ${current.toFixed(2)} ${baseCurrency}${percent}`;
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
