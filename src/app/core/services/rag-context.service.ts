import { Injectable, inject } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { Transaction, CategoryTotal } from '../../models';

export interface SummaryGroundingOptions {
  transactions: Transaction[];
  previousByCategory: CategoryTotal[] | null;
  baseCurrency: string;
}

// Builds retrieval-augmented grounding context for AI insights.
// Stateless: pure transformations over the data it is given. This is the
// shared home for RAG retrieval as more AI features adopt grounding.
@Injectable({ providedIn: 'root' })
export class RagContextService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);

  private readonly TOP_EXPENSES = 10;
  private readonly MAX_ANOMALIES = 5;
  private readonly MAX_DELTAS = 5;
  private readonly MIN_CATEGORY_SIZE_FOR_ANOMALY = 4;
  private readonly ANOMALY_STDDEV_FACTOR = 2;

  // Returns a markdown block of notable activity, or '' when nothing notable is found.
  buildSummaryGrounding(opts: SummaryGroundingOptions): string {
    const { transactions, previousByCategory, baseCurrency } = opts;
    const expenses = transactions.filter(t => t.type === 'expense');
    if (expenses.length === 0) return '';

    const sections: string[] = [];

    const topExpenses = this.formatTopExpenses(expenses, baseCurrency);
    if (topExpenses) sections.push(`Largest expenses:\n${topExpenses}`);

    const anomalies = this.formatAnomalies(expenses, baseCurrency);
    if (anomalies) sections.push(`Unusual amounts (well above the category's typical size):\n${anomalies}`);

    const deltas = this.formatCategoryDeltas(expenses, previousByCategory, baseCurrency);
    if (deltas) sections.push(`Biggest category changes vs. previous period:\n${deltas}`);

    return sections.join('\n\n');
  }

  private toBase(t: Transaction, baseCurrency: string): number {
    return this.currencyService.convert(t.amount, t.currency, baseCurrency);
  }

  private categoryName(categoryId: string): string {
    return this.categoryService.categories().find(c => c.id === categoryId)?.name ?? 'Other';
  }

  private formatAmount(value: number, baseCurrency: string): string {
    return `${value.toFixed(2)} ${baseCurrency}`;
  }

  private formatDate(t: Transaction): string {
    try {
      return t.date.toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  private formatTopExpenses(expenses: Transaction[], baseCurrency: string): string {
    return [...expenses]
      .sort((a, b) => this.toBase(b, baseCurrency) - this.toBase(a, baseCurrency))
      .slice(0, this.TOP_EXPENSES)
      .map(t => {
        const date = this.formatDate(t);
        const datePart = date ? `, ${date}` : '';
        return `- ${t.description}: ${this.formatAmount(this.toBase(t, baseCurrency), baseCurrency)} (${this.categoryName(t.categoryId)}${datePart})`;
      })
      .join('\n');
  }

  private formatAnomalies(expenses: Transaction[], baseCurrency: string): string {
    const byCategory = new Map<string, Transaction[]>();
    for (const t of expenses) {
      const list = byCategory.get(t.categoryId) ?? [];
      list.push(t);
      byCategory.set(t.categoryId, list);
    }

    const anomalies: { transaction: Transaction; amount: number; mean: number }[] = [];
    for (const [, list] of byCategory) {
      if (list.length < this.MIN_CATEGORY_SIZE_FOR_ANOMALY) continue;
      const amounts = list.map(t => this.toBase(t, baseCurrency));
      const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
      const stddev = Math.sqrt(variance);
      if (stddev === 0) continue;
      const threshold = mean + this.ANOMALY_STDDEV_FACTOR * stddev;
      for (const t of list) {
        const amount = this.toBase(t, baseCurrency);
        if (amount > threshold) anomalies.push({ transaction: t, amount, mean });
      }
    }

    if (anomalies.length === 0) return '';

    return anomalies
      .sort((a, b) => b.amount - a.amount)
      .slice(0, this.MAX_ANOMALIES)
      .map(({ transaction, amount, mean }) =>
        `- ${transaction.description}: ${this.formatAmount(amount, baseCurrency)} in ${this.categoryName(transaction.categoryId)} (category average ${this.formatAmount(mean, baseCurrency)})`)
      .join('\n');
  }

  private formatCategoryDeltas(
    expenses: Transaction[],
    previousByCategory: CategoryTotal[] | null,
    baseCurrency: string
  ): string {
    if (!previousByCategory || previousByCategory.length === 0) return '';

    const currentTotals = new Map<string, number>();
    for (const t of expenses) {
      currentTotals.set(t.categoryId, (currentTotals.get(t.categoryId) ?? 0) + this.toBase(t, baseCurrency));
    }
    const previousTotals = new Map<string, number>(previousByCategory.map(c => [c.categoryId, c.total]));

    const categoryIds = new Set<string>([...currentTotals.keys(), ...previousTotals.keys()]);
    const deltas = Array.from(categoryIds).map(categoryId => {
      const current = currentTotals.get(categoryId) ?? 0;
      const previous = previousTotals.get(categoryId) ?? 0;
      return { categoryId, current, previous, change: current - previous };
    });

    const significant = deltas
      .filter(d => Math.abs(d.change) > 0.01)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, this.MAX_DELTAS);

    if (significant.length === 0) return '';

    return significant
      .map(d => {
        const direction = d.change > 0 ? 'up' : 'down';
        const pct = d.previous > 0 ? ` (${(d.change / d.previous * 100).toFixed(0)}%)` : '';
        return `- ${this.categoryName(d.categoryId)}: ${direction} ${this.formatAmount(Math.abs(d.change), baseCurrency)}${pct} — now ${this.formatAmount(d.current, baseCurrency)}, was ${this.formatAmount(d.previous, baseCurrency)}`;
      })
      .join('\n');
  }
}
