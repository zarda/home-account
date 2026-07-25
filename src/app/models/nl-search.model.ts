import { CategoryType } from './category.model';
import { Transaction, TransactionFilters } from './transaction.model';

/** Aggregate operations the natural-language search can compute locally. */
export type AggregateOperation = 'sum' | 'count' | 'average' | 'max' | 'min' | 'topCategories';

export const AGGREGATE_OPERATIONS: readonly AggregateOperation[] =
  ['sum', 'count', 'average', 'max', 'min', 'topCategories'];

/**
 * Compact context sent to the model alongside the query. Deliberately
 * excludes transaction data — only the catalog, today's date (to anchor
 * relative ranges like "last month"), and the base currency go out.
 */
export interface SearchQueryContext {
  /** ISO date (YYYY-MM-DD) the model resolves relative ranges against. */
  today: string;
  baseCurrency: string;
  categories: { id: string; name: string; type: CategoryType }[];
}

/**
 * The model's structured interpretation of a query. It only ever describes
 * a scope and an operation — every number shown to the user is computed
 * locally from real transaction data.
 */
export type SearchIntent =
  | { kind: 'filter'; filters: TransactionFilters }
  | { kind: 'aggregate'; operation: AggregateOperation; filters: TransactionFilters; limit: number };

export interface AggregateAnswer {
  operation: AggregateOperation;
  /** The computed number: a base-currency amount, or a count for `count`. */
  value: number;
  /** Present for money operations; absent for `count`. */
  currency?: string;
  /** How many transactions matched the scope. */
  transactionCount: number;
  /** The resolved scope — echoed to the user and reusable as a filter. */
  scope: TransactionFilters;
  /** The actual row behind a max/min answer. */
  extremeTransaction?: Transaction;
  /** Per-category totals for `topCategories`, largest first. */
  groups?: { categoryId: string; total: number }[];
}

export type NlSearchFallbackReason = 'offline' | 'noProvider' | 'error';

export type NlSearchResult =
  | { kind: 'filter'; filters: TransactionFilters }
  | { kind: 'answer'; answer: AggregateAnswer }
  | { kind: 'keywordFallback'; filters: TransactionFilters; reason: NlSearchFallbackReason };
