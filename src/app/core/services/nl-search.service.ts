import { Injectable, inject } from '@angular/core';
import { AIStrategyService } from './ai-strategy.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { GoalService } from './goal.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { SearchHistoryService } from './search-history.service';
import { AnalyticsService } from './analytics.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { dayKey, endOfDay, monthWindow } from '../utils/transaction-date.utils';
import { defaultCategories, mergeCategories } from '../utils/category-merge.utils';
import {
  AggregateAnswer,
  AggregateOperation,
  Category,
  NlSearchFallbackReason,
  NlSearchResult,
  SearchIntent,
  SearchQueryContext,
  Transaction,
  TransactionFilters,
  baseCurrencyOf
} from '../../models';
import { applyClientTransactionFilters } from '../utils/transaction-query.utils';
import { compareCategoryTotals, roundMoney } from '../utils/transaction-aggregation.utils';

/**
 * Natural-language transaction search. The model only translates the query
 * into a structured scope (filters) plus an optional aggregate operation;
 * every number in an answer is computed here from real transaction data.
 * Degrades to plain keyword search when offline, when no provider is
 * configured, or when interpretation fails.
 */
@Injectable({ providedIn: 'root' })
export class NlSearchService {
  private aiStrategy = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private goalService = inject(GoalService);
  private budgetService = inject(BudgetService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);
  private searchHistory = inject(SearchHistoryService);
  private answerHistory = inject(SearchAnswerHistoryService);
  private analytics = inject(AnalyticsService);

  async search(query: string): Promise<NlSearchResult> {
    const trimmed = query.trim();

    if (!this.aiStrategy.canUseCloud()) {
      return this.keywordFallback(trimmed, this.pwaService.isOnline() ? 'noProvider' : 'offline');
    }

    try {
      const catalog = await this.categoryCatalog();
      const context = await this.buildContext(catalog);
      // Counted only once the provider request is about to be made: after the
      // availability guard, since offline or without a key this falls back to
      // a purely local keyword search, and after the catalog reads, since one
      // that fails falls back the same way before the model is asked.
      // Counting either as AI usage would overstate exactly the cost this
      // event exists to weigh.
      this.analytics.trackAiAssistUsed({ feature: 'search' });
      const intent = await this.cloudLLMProvider.interpretSearchQuery(trimmed, context);
      if (intent.kind === 'filter') {
        // Recorded for the same reason an aggregate is: the model call has
        // already been paid for, and reopening the record replays the scope
        // without paying it again. Fire-and-forget, as below — but caught:
        // a rejected history write would otherwise reach the global handler
        // and toast over a result that already rendered.
        void this.answerHistory
          .recordFilter(trimmed, intent.filters)
          .catch(error =>
            console.error('[NlSearch] Recording the filter interpretation failed:', error)
          );
        return { kind: 'filter', filters: intent.filters };
      }
      const answer = await this.computeAggregate(intent, catalog);
      // Fire-and-forget, like recordRecent: a history write must never delay
      // or fail the answer the user is waiting on.
      void this.answerHistory.recordAnswer(trimmed, intent, answer);
      return { kind: 'answer', answer };
    } catch (error) {
      console.warn('Smart search interpretation failed, using keyword search:', error);
      return this.keywordFallback(trimmed, 'error');
    }
  }

  /**
   * Recompute a stored aggregate locally from its stored scope. Never calls
   * the model and never counts as AI usage — the ai_assist_used event exists
   * to weigh cloud cost, and a replay costs nothing. Recording is likewise
   * the caller's business: a refresh updates the record it came from.
   */
  async replayAggregate(
    operation: AggregateOperation,
    filters: TransactionFilters,
    limit: number,
  ): Promise<AggregateAnswer> {
    const needsCatalog =
      operation === 'topCategories' || !!filters.categoryId || !!filters.searchQuery;
    const catalog = needsCatalog ? await this.categoryCatalog() : [];
    return this.computeAggregate({ kind: 'aggregate', operation, filters, limit }, catalog);
  }

  /**
   * Plain keyword search. Only this path records the raw text as a recent
   * search — an interpreted sentence would replay as a useless substring
   * match from the search-history panel.
   */
  private keywordFallback(query: string, reason: NlSearchFallbackReason): NlSearchResult {
    if (query) {
      void this.searchHistory.recordRecent(query);
    }
    return {
      kind: 'keywordFallback',
      filters: query ? { searchQuery: query } : {},
      reason,
    };
  }

  private async buildContext(catalog: Category[]): Promise<SearchQueryContext> {
    const categories = catalog.filter(c => c.isActive);
    const nameOf = (id: string) => {
      const category = categories.find(c => c.id === id);
      return category?.name ? this.translationService.t(category.name) : 'Other';
    };

    const [goals, budgets] = await Promise.all([
      this.goalCatalog(),
      this.budgetCatalog(),
    ]);

    return {
      today: dayKey(new Date()),
      baseCurrency: this.baseCurrency(),
      categories: categories.map(c => ({
        id: c.id,
        // Children carry their parent for context: "Food / Groceries".
        name: c.parentId ? `${nameOf(c.parentId)} / ${this.translationService.t(c.name)}` : this.translationService.t(c.name),
        type: c.type,
      })),
      goals,
      budgets,
    };
  }

  /**
   * The categories a search resolves names and parents against. The published
   * signal when a page has warmed it, otherwise the account's stored rows over
   * the built-ins, read once: a signal nothing subscribed to holds neither, so
   * no child would roll up and the model would be told of no category at all.
   * Online, a warm signal is never empty (the built-ins are merged in) and
   * sign-out empties it. Offline, the SDK can publish a first snapshot from a
   * cache that never held the query, so the signal can hold the built-ins
   * alone, and the length test reads that as warm: no stored category is
   * read, and a stored custom child is not rolled up (ADR 0178, Known gaps).
   */
  private async categoryCatalog(): Promise<Category[]> {
    const published = this.categoryService.categories();
    return published.length
      ? published
      : mergeCategories(defaultCategories(), await this.categoryService.exportAll());
  }

  /**
   * Goals the query may name. Read from the published signal when a page has
   * warmed it, otherwise fetched once — search opens from anywhere, including
   * pages that never subscribed to goals (ADR 0009), and a cold signal would
   * silently reduce every goal question to a keyword guess.
   */
  private async goalCatalog(): Promise<SearchQueryContext['goals']> {
    const published = this.goalService.goals();
    const goals = published.length ? published : await this.goalService.exportAll();
    return goals
      .filter(goal => goal.isActive)
      .map(goal => ({ id: goal.id, name: goal.name }));
  }

  /** Budgets the query may name, same cold-signal rule as goals. */
  private async budgetCatalog(): Promise<SearchQueryContext['budgets']> {
    const published = this.budgetService.budgets();
    const budgets = published.length ? published : await this.budgetService.exportAll();
    return budgets
      .filter(budget => budget.isActive)
      .map(budget => ({
        id: budget.id,
        name: budget.name,
        categoryId: budget.categoryId,
        period: budget.period,
        // The date its period counts from, which is what budgetPeriodWindow
        // anchors on when the sanitizer resolves the current window.
        anchor: dayKey(budget.startDate.toDate()),
      }));
  }

  private async computeAggregate(
    intent: Extract<SearchIntent, { kind: 'aggregate' }>,
    catalog: Category[]
  ): Promise<AggregateAnswer> {
    const baseCurrency = this.baseCurrency();
    const scope = this.resolveScope(intent.filters);

    // Enumerated, not taken from the live listener's first emission: this
    // answer is persisted (recordAnswer on a live search, refreshAnswer on a
    // Refresh), and a cache-served emission is whatever windows the session
    // happened to browse. See docs/one-shot-reads.md.
    const fetched = await this.transactionService.getTransactionsInRangeOnce(
      scope.startDate!, scope.endDate!
    );
    const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);
    const matches = this.applyScope(fetched, scope, toBase, catalog);
    const answer: AggregateAnswer = {
      operation: intent.operation,
      value: 0,
      transactionCount: matches.length,
      scope,
    };

    switch (intent.operation) {
      case 'count':
        answer.value = matches.length;
        break;
      case 'sum':
        answer.value = matches.reduce((sum, t) => sum + toBase(t), 0);
        answer.currency = baseCurrency;
        break;
      case 'average':
        answer.value = matches.length
          ? matches.reduce((sum, t) => sum + toBase(t), 0) / matches.length
          : 0;
        answer.currency = baseCurrency;
        break;
      case 'max':
      case 'min': {
        answer.currency = baseCurrency;
        if (matches.length) {
          const extreme = matches.reduce((best, t) =>
            intent.operation === 'max'
              ? (toBase(t) > toBase(best) ? t : best)
              : (toBase(t) < toBase(best) ? t : best));
          answer.value = toBase(extreme);
          answer.extremeTransaction = extreme;
        }
        break;
      }
      case 'topCategories': {
        answer.currency = baseCurrency;
        const totals = new Map<string, number>();
        for (const t of matches) {
          const groupId = this.rollUpToParent(t.categoryId, catalog);
          totals.set(groupId, (totals.get(groupId) ?? 0) + toBase(t));
        }
        // Rounded to cents before the sort, and ordered as the shared category
        // folds are: a tie, including one split only by float noise, falls to
        // the id rather than to row arrival.
        answer.groups = [...totals.entries()]
          .map(([categoryId, total]) => ({ categoryId, total: roundMoney(total) }))
          .sort(compareCategoryTotals)
          .slice(0, intent.limit);
        answer.value = answer.groups[0]?.total ?? 0;
        break;
      }
    }

    return answer;
  }

  /**
   * Fill in the date range the fetch needs. No dates at all means the
   * current month — the answer UI always displays the resolved range, so
   * the default is visible to the user.
   */
  private resolveScope(filters: TransactionFilters): TransactionFilters {
    const scope: TransactionFilters = { ...filters };
    const now = new Date();

    if (!scope.startDate && !scope.endDate) {
      const thisMonth = monthWindow(now);
      scope.startDate = thisMonth.start;
      scope.endDate = thisMonth.end;
    } else if (!scope.endDate) {
      scope.endDate = endOfDay(now);
    } else if (!scope.startDate) {
      scope.startDate = new Date(1970, 0, 1);
    }

    return scope;
  }

  /** Apply the non-date scope fields locally, rolling parents up over children. */
  private applyScope(
    transactions: Transaction[],
    scope: TransactionFilters,
    toBase: (t: Transaction) => number,
    catalog: Category[]
  ): Transaction[] {
    let result = transactions;

    if (scope.type) {
      result = result.filter(t => t.type === scope.type);
    }
    if (scope.categoryId) {
      const target = scope.categoryId;
      result = result.filter(
        t => t.categoryId === target || this.parentOf(t.categoryId, catalog) === target
      );
    }
    if (scope.currency) {
      result = result.filter(t => t.currency === scope.currency);
    }
    if (scope.goalId) {
      result = result.filter(t => t.goalId === scope.goalId);
    }

    // Amount bounds compare in base currency: the model was told the base
    // currency, and every figure computed from the matches uses toBase, so
    // a raw-native comparison would count a ¥5,000 lunch as "over $100"
    // while dropping a €95 dinner. Only text search keeps the list-search
    // semantics.
    const min = scope.minAmount;
    if (min !== undefined) {
      result = result.filter(t => toBase(t) >= min);
    }
    const max = scope.maxAmount;
    if (max !== undefined) {
      result = result.filter(t => toBase(t) <= max);
    }

    return applyClientTransactionFilters(result, {
      searchQuery: scope.searchQuery,
    }, { categoryNames: this.categoryNamesMap(catalog) });
  }

  private categoryNamesMap(catalog: Category[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const c of catalog) {
      map.set(c.id, this.translationService.t(c.name));
    }
    return map;
  }

  private parentOf(categoryId: string, catalog: Category[]): string | undefined {
    return catalog.find(c => c.id === categoryId)?.parentId;
  }

  private rollUpToParent(categoryId: string, catalog: Category[]): string {
    return this.parentOf(categoryId, catalog) ?? categoryId;
  }

  private baseCurrency(): string {
    return baseCurrencyOf(this.authService.currentUser());
  }
}
