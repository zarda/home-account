import { Timestamp } from '@angular/fire/firestore';
import { SerializableFilters } from './insight-snapshot.model';
import { AggregateOperation } from './nl-search.model';

/**
 * Bump when the stored document's shape changes, so a reader can refuse a
 * record written by a newer build (INSIGHT_SNAPSHOT_SCHEMA_VERSION precedent).
 */
export const SEARCH_ANSWER_SCHEMA_VERSION = 1;

/**
 * A stored answer's scope. SerializableFilters already keeps dates as
 * `yyyy-MM-dd` day keys so the record survives a Firestore round trip; an
 * aggregate scope can additionally carry the keyword the model extracted,
 * which SerializableFilters deliberately omits for insight drill-downs.
 */
export interface SerializableSearchScope extends SerializableFilters {
  searchQuery?: string;
  /**
   * The goal the question named, when it named one. Declared here rather
   * than on SerializableFilters because only a search answer can carry a
   * goal scope — an insight drill-down never produces one, and widening the
   * shared type would widen the insight snapshot rules with it.
   */
  goalId?: string;
}

/**
 * One persisted smart-search aggregate answer, at
 * `users/{uid}/searchAnswers/{autoId}`.
 *
 * The scope is the *resolved* range the numbers were computed over, not the
 * model's raw filters: "this month" asked in August stays August forever, and
 * Refresh recomputes that same range. Figures are a snapshot — `computedAt`
 * says when they were true. The extreme row is referenced by id, never
 * embedded (stored documents do not carry transaction copies).
 */
export interface SearchAnswerRecord {
  id: string; // Firestore doc id, injected on read — not a stored field
  userId: string;
  schemaVersion: number;
  query: string; // the question as typed, trimmed
  operation: AggregateOperation;
  limit: number; // 1..10, clamped at interpretation time
  scope: SerializableSearchScope;
  baseCurrency: string; // the currency every stored number was computed in
  value: number;
  currency?: string; // money operations only; count has no currency
  transactionCount: number;
  extremeTransactionId?: string; // max/min only
  groups?: { categoryId: string; total: number }[]; // topCategories, largest first
  computedAt: Timestamp; // when the figures were computed; Refresh rewrites it
  lastUsedAt: Timestamp; // recency for ordering, dedupe touch and prune order
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
