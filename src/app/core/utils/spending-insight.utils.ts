import { CategoryTotal, Transaction } from '../../models';

/**
 * Pure spending-analysis computations shared by the RAG prompt grounding
 * (RagContextService) and the insight quick-filter chips on the
 * Transactions page. Amount conversion is injected (`toBase`) so callers
 * control currency handling.
 */

export interface TopExpenseEntry {
  transaction: Transaction;
  /** Amount in base currency. */
  value: number;
}

/** Top expenses by base-currency amount, largest first. */
export function computeTopExpenses(
  expenses: Transaction[],
  toBase: (t: Transaction) => number,
  cap: number,
): TopExpenseEntry[] {
  return expenses
    .map(transaction => ({ transaction, value: toBase(transaction) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, cap);
}

export interface AmountAnomaly {
  transaction: Transaction;
  /** Amount in base currency. */
  value: number;
  /** The category's baseline mean. */
  typical: number;
  /** The flagging threshold (mean + 2 * stddev). */
  threshold: number;
}

/**
 * Flag current-period transactions far above their category's typical amount
 * (above mean + 2*stddev, in categories with at least 4 baseline samples).
 * The baseline distribution is drawn from `baselineExpenses` — a trailing
 * window that includes the current period — so the detector works early in
 * a period and reflects month-over-month norms. Only `expenses` (the current
 * period) are eligible to be flagged. Results are sorted by amount, largest
 * first, capped at `cap`.
 */
export function computeAmountAnomalies(
  expenses: Transaction[],
  baselineExpenses: Transaction[],
  toBase: (t: Transaction) => number,
  cap: number,
): AmountAnomaly[] {
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

  const anomalies: AmountAnomaly[] = [];
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
        anomalies.push({ transaction, value, typical: mean, threshold });
      }
    }
  }

  return anomalies.sort((a, b) => b.value - a.value).slice(0, cap);
}

export interface CategoryDelta {
  categoryId: string;
  /** Current-period total in base currency. */
  current: number;
  /** Previous-period total in base currency. */
  previous: number;
  change: number;
  /** True when the category had no spending in the previous period. */
  isNew: boolean;
}

/**
 * Largest per-category spending changes vs. the previous period, sorted by
 * absolute change, capped at `cap`. Empty when no previous-period breakdown
 * is available.
 */
export function computeCategoryDeltas(
  expenses: Transaction[],
  previousByCategory: CategoryTotal[] | null,
  toBase: (t: Transaction) => number,
  cap: number,
): CategoryDelta[] {
  if (!previousByCategory || previousByCategory.length === 0) {
    return [];
  }

  const currentTotals = new Map<string, number>();
  for (const t of expenses) {
    currentTotals.set(t.categoryId, (currentTotals.get(t.categoryId) ?? 0) + toBase(t));
  }
  const previousTotals = new Map(previousByCategory.map(c => [c.categoryId, c.total]));

  const categoryIds = new Set([...currentTotals.keys(), ...previousTotals.keys()]);
  return [...categoryIds]
    .map(categoryId => {
      const current = currentTotals.get(categoryId) ?? 0;
      const previous = previousTotals.get(categoryId) ?? 0;
      return { categoryId, current, previous, change: current - previous, isNew: previous <= 0 };
    })
    .filter(d => Math.abs(d.change) > 0.005)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, cap);
}
