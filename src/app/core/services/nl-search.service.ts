import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AIStrategyService } from './ai-strategy.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { SearchHistoryService } from './search-history.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import {
  AggregateAnswer,
  NlSearchFallbackReason,
  NlSearchResult,
  SearchIntent,
  SearchQueryContext,
  Transaction,
  TransactionFilters,
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
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);
  private searchHistory = inject(SearchHistoryService);

  async search(query: string): Promise<NlSearchResult> {
    const trimmed = query.trim();

    if (!this.aiStrategy.canUseCloud()) {
      return this.keywordFallback(trimmed, this.pwaService.isOnline() ? 'noProvider' : 'offline');
    }

    try {
      const intent = await this.cloudLLMProvider.interpretSearchQuery(trimmed, this.buildContext());
      if (intent.kind === 'filter') {
        return { kind: 'filter', filters: intent.filters };
      }
      return { kind: 'answer', answer: await this.computeAggregate(intent) };
    } catch (error) {
      console.warn('Smart search interpretation failed, using keyword search:', error);
      return this.keywordFallback(trimmed, 'error');
    }
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

  private buildContext(): SearchQueryContext {
    const categories = this.categoryService.categories().filter(c => c.isActive);
    const nameOf = (id: string) => {
      const category = categories.find(c => c.id === id);
      return category?.name ? this.translationService.t(category.name) : 'Other';
    };

    return {
      today: this.toIsoDate(new Date()),
      baseCurrency: this.baseCurrency(),
      categories: categories.map(c => ({
        id: c.id,
        // Children carry their parent for context: "Food / Groceries".
        name: c.parentId ? `${nameOf(c.parentId)} / ${this.translationService.t(c.name)}` : this.translationService.t(c.name),
        type: c.type,
      })),
    };
  }

  private async computeAggregate(
    intent: Extract<SearchIntent, { kind: 'aggregate' }>
  ): Promise<AggregateAnswer> {
    const baseCurrency = this.baseCurrency();
    const scope = this.resolveScope(intent.filters);

    const fetched = await firstValueFrom(
      this.transactionService.getTransactionsInRange(scope.startDate!, scope.endDate!)
    );
    const matches = this.applyScope(fetched, scope);

    const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);
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
      scope.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      scope.endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (!scope.endDate) {
      scope.endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (!scope.startDate) {
      scope.startDate = new Date(1970, 0, 1);
    }

    return scope;
  }

  /** Apply the non-date scope fields locally, rolling parents up over children. */
  private applyScope(transactions: Transaction[], scope: TransactionFilters): Transaction[] {
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

    // Amount range and text search reuse the exact list-search semantics.
    return applyClientTransactionFilters(result, {
      minAmount: scope.minAmount,
      maxAmount: scope.maxAmount,
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
    return this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
  }

  private toIsoDate(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }
}
