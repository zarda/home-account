import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
import {
  AggregateAnswer,
  AggregateOperation,
  NlSearchFallbackReason,
  NlSearchResult,
  SearchIntent,
  SearchQueryContext,
  Transaction,
  TransactionFilters,
  baseCurrencyOf
} from '../../models';
import { applyClientTransactionFilters } from '../utils/transaction-query.utils';

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

    // After the availability guard: offline or without a key this falls back
    // to a purely local keyword search, and counting that as AI usage would
    // overstate exactly the cost this event exists to weigh.
    this.analytics.trackAiAssistUsed({ feature: 'search' });

    try {
      const intent = await this.cloudLLMProvider.interpretSearchQuery(
        trimmed,
        await this.buildContext()
      );
      if (intent.kind === 'filter') {
        // Recorded for the same reason an aggregate is: the model call has
        // already been paid for, and reopening the record replays the scope
        // without paying it again. Fire-and-forget, as below.
        void this.answerHistory.recordFilter(trimmed, intent.filters);
        return { kind: 'filter', filters: intent.filters };
      }
      const answer = await this.computeAggregate(intent);
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
    return this.computeAggregate({ kind: 'aggregate', operation, filters, limit });
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

  private async buildContext(): Promise<SearchQueryContext> {
    const categories = this.categoryService.categories().filter(c => c.isActive);
    const nameOf = (id: string) => {
      const category = categories.find(c => c.id === id);
      return category?.name ? this.translationService.t(category.name) : 'Other';
    };

    const [goals, budgets] = await Promise.all([
      this.goalCatalog(),
      this.budgetCatalog(),
    ]);

    return {
      today: this.toIsoDate(new Date()),
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
    intent: Extract<SearchIntent, { kind: 'aggregate' }>
  ): Promise<AggregateAnswer> {
    const baseCurrency = this.baseCurrency();
    const scope = this.resolveScope(intent.filters);

    const fetched = await firstValueFrom(
      this.transactionService.getTransactionsInRange(scope.startDate!, scope.endDate!)
    );
    const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);
    const matches = this.applyScope(fetched, scope, toBase);
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
          const groupId = this.rollUpToParent(t.categoryId);
          totals.set(groupId, (totals.get(groupId) ?? 0) + toBase(t));
        }
        answer.groups = [...totals.entries()]
          .map(([categoryId, total]) => ({ categoryId, total }))
          .sort((a, b) => b.total - a.total)
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
    toBase: (t: Transaction) => number
  ): Transaction[] {
    let result = transactions;

    if (scope.type) {
      result = result.filter(t => t.type === scope.type);
    }
    if (scope.categoryId) {
      const target = scope.categoryId;
      result = result.filter(
        t => t.categoryId === target || this.parentOf(t.categoryId) === target
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
    }, { categoryNames: this.categoryNamesMap() });
  }

  private categoryNamesMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const c of this.categoryService.categories()) {
      map.set(c.id, this.translationService.t(c.name));
    }
    return map;
  }

  private parentOf(categoryId: string): string | undefined {
    return this.categoryService.categories().find(c => c.id === categoryId)?.parentId;
  }

  private rollUpToParent(categoryId: string): string {
    return this.parentOf(categoryId) ?? categoryId;
  }

  private baseCurrency(): string {
    return baseCurrencyOf(this.authService.currentUser());
  }

  private toIsoDate(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }
}
