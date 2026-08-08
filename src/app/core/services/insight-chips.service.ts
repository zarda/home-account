import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { CategoryTotal, RAG_TIER_CONFIGS, Transaction, TransactionFilters, baseCurrencyOf} from '../../models';
import {
  computeAmountAnomalies,
  computeCategoryDeltas,
} from '../utils/spending-insight.utils';
import {
  dateOf,
  monthWindow,
} from '../utils/transaction-date.utils';

export type InsightChipKind = 'anomaly' | 'newCategory' | 'topCategory';

export interface InsightChip {
  /** Stable identity for template tracking, e.g. `anomaly:food`. */
  id: string;
  kind: InsightChipKind;
  labelKey: string;
  labelParams: Record<string, string | number>;
  icon: string;
  /** The filter set applied when the chip is tapped. */
  filters: TransactionFilters;
}

/**
 * Turns the spending analysis behind the AI-insights grounding (amount
 * anomalies, category deltas, top category) into tappable quick-filter
 * chips for the current month. Pure local computation — no LLM involved —
 * so the chips are always on, independent of the RAG insights preference.
 *
 * Provided by InsightChipsComponent (page-scoped) so the live Firestore
 * subscriptions tear down when the Transactions page is left.
 */
@Injectable()
export class InsightChipsService {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  private static readonly MAX_CHIPS = 4;
  private static readonly MAX_ANOMALY_CHIPS = 2;
  /** A top-category chip needs at least this many transactions to matter. */
  private static readonly TOP_CATEGORY_MIN_COUNT = 3;

  readonly chips = signal<InsightChip[]>([]);
  readonly isLoading = signal<boolean>(false);

  load(): void {
    const now = new Date();
    const { start: monthStart, end: monthEnd } = monthWindow(now);
    // Same trailing window the standard RAG tier uses for its anomaly baseline.
    const baselineMonths = RAG_TIER_CONFIGS.standard.baselineWindowMonths;
    const baselineStart = monthWindow(
      { year: now.getFullYear(), month: now.getMonth() - baselineMonths }).start;
    const { start: prevStart, end: prevEnd } = monthWindow(
      { year: now.getFullYear(), month: now.getMonth() - 1 });

    this.isLoading.set(true);
    combineLatest([
      this.transactionService.getExpensesInRange(baselineStart, monthEnd),
      this.transactionService.getPeriodCategoryTotals(prevStart, prevEnd),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([baselineExpenses, previousTotals]) => {
          this.isLoading.set(false);
          this.chips.set(
            this.buildChips(baselineExpenses, previousTotals.byCategory, monthStart, monthEnd)
          );
        },
        error: () => {
          this.isLoading.set(false);
          this.chips.set([]);
        },
      });
  }

  private buildChips(
    baselineExpenses: Transaction[],
    previousByCategory: CategoryTotal[],
    monthStart: Date,
    monthEnd: Date,
  ): InsightChip[] {
    const currentExpenses = baselineExpenses.filter(t => dateOf(t) >= monthStart);
    if (currentExpenses.length === 0) {
      return [];
    }

    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);
    const monthFilters: TransactionFilters = {
      type: 'expense',
      startDate: monthStart,
      endDate: monthEnd,
    };

    const chips: InsightChip[] = [];
    const usedCategories = new Set<string>();

    // Unusual amounts: one chip per anomalous category, largest amount first.
    const anomalies = computeAmountAnomalies(
      currentExpenses, baselineExpenses, toBase, RAG_TIER_CONFIGS.standard.anomalies);
    for (const anomaly of anomalies) {
      const categoryId = anomaly.transaction.categoryId;
      if (usedCategories.has(categoryId)) continue;
      usedCategories.add(categoryId);

      const filters: TransactionFilters = { ...monthFilters, categoryId };
      // minAmount filters raw native-currency amounts while the threshold is
      // in base currency; only narrow by amount when they are comparable.
      if (this.categoryAllInCurrency(currentExpenses, categoryId, baseCurrency)) {
        filters.minAmount = Math.floor(anomaly.threshold);
      }

      chips.push({
        id: `anomaly:${categoryId}`,
        kind: 'anomaly',
        labelKey: 'transactions.chipUnusual',
        labelParams: { category: this.categoryName(categoryId) },
        icon: 'trending_up',
        filters,
      });
      if (chips.length >= InsightChipsService.MAX_ANOMALY_CHIPS) break;
    }

    // First category that appeared this month without previous-period spending.
    const deltas = computeCategoryDeltas(
      currentExpenses, previousByCategory, toBase, RAG_TIER_CONFIGS.standard.categoryDeltas);
    const emerged = deltas.find(d => d.isNew && d.current > 0 && !usedCategories.has(d.categoryId));
    if (emerged) {
      usedCategories.add(emerged.categoryId);
      chips.push({
        id: `new:${emerged.categoryId}`,
        kind: 'newCategory',
        labelKey: 'transactions.chipNewCategory',
        labelParams: { category: this.categoryName(emerged.categoryId) },
        icon: 'fiber_new',
        filters: { ...monthFilters, categoryId: emerged.categoryId },
      });
    }

    // Biggest spending category of the month, when it has enough activity.
    const totals = new Map<string, { total: number; count: number }>();
    for (const t of currentExpenses) {
      const entry = totals.get(t.categoryId) ?? { total: 0, count: 0 };
      entry.total += toBase(t);
      entry.count += 1;
      totals.set(t.categoryId, entry);
    }
    const top = [...totals.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    if (
      top &&
      top[1].total > 0 &&
      top[1].count >= InsightChipsService.TOP_CATEGORY_MIN_COUNT &&
      !usedCategories.has(top[0])
    ) {
      chips.push({
        id: `top:${top[0]}`,
        kind: 'topCategory',
        labelKey: 'transactions.chipTopCategory',
        labelParams: { category: this.categoryName(top[0]) },
        icon: 'leaderboard',
        filters: { ...monthFilters, categoryId: top[0] },
      });
    }

    return chips.slice(0, InsightChipsService.MAX_CHIPS);
  }

  private categoryAllInCurrency(
    expenses: Transaction[],
    categoryId: string,
    currency: string,
  ): boolean {
    return expenses
      .filter(t => t.categoryId === categoryId)
      .every(t => t.currency === currency);
  }

  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Other';
  }
}
