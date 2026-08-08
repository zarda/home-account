import { Timestamp } from '@angular/fire/firestore';
import { SerializableFilters } from './insight-snapshot.model';
import { AggregateOperation } from './nl-search.model';

/**
 * Bump when the stored document's shape changes, so a reader can refuse a
 * record written by a newer build (INSIGHT_SNAPSHOT_SCHEMA_VERSION precedent).
 */
export const SEARCH_ANSWER_SCHEMA_VERSION = 2;

/**
 * What a stored record holds.
 *
 * A filter-shaped interpretation costs the same model call as an aggregate
 * one, so it is worth the same slot — but it has no figures to snapshot, and
 * "refresh" means nothing for it. The discriminator is what keeps one
 * collection able to hold both without either pretending to be the other.
 *
 * Records written before version 2 carry no `kind` and are read as
 * `aggregate`, which is the only thing they ever were.
 */
export type SearchRecordKind = 'aggregate' | 'filter';

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
 * What every stored interpretation carries, at
 * `users/{uid}/searchAnswers/{autoId}`.
 *
 * The scope is the *resolved* range, not the model's raw filters: "this
 * month" asked in August stays August forever, so replaying the record
 * reproduces the window it was interpreted over.
 */
interface SearchRecordBase {
  id: string; // Firestore doc id, injected on read — not a stored field
  userId: string;
  schemaVersion: number;
  kind: SearchRecordKind;
  query: string; // the question as typed, trimmed
  scope: SerializableSearchScope;
  /**
   * Kept out of the prune, and sorted above the rest.
   *
   * Optional rather than required because records written before pinning
   * existed do not carry it, and absent has to read as unpinned. Every new
   * record writes it explicitly, the way SavedSearch does.
   */
  pinned?: boolean;
  /**
   * When the model's interpretation was turned into this record. For an
   * aggregate that is when the figures were true and Refresh rewrites it; for
   * a filter it is simply when it was interpreted, and nothing rewrites it.
   */
  computedAt: Timestamp;
  lastUsedAt: Timestamp; // recency for ordering, dedupe touch and prune order
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * One persisted smart-search aggregate answer.
 *
 * Figures are a snapshot — `computedAt` says when they were true. The extreme
 * row is referenced by id, never embedded (stored documents do not carry
 * transaction copies).
 */
export interface SearchAnswerRecord extends SearchRecordBase {
  kind: 'aggregate';
  operation: AggregateOperation;
  limit: number; // 1..10, clamped at interpretation time
  baseCurrency: string; // the currency every stored number was computed in
  value: number;
  currency?: string; // money operations only; count has no currency
  transactionCount: number;
  extremeTransactionId?: string; // max/min only
  groups?: { categoryId: string; total: number }[]; // topCategories, largest first
}

/**
 * One persisted filter-shaped interpretation.
 *
 * It carries no figures at all: reopening it re-applies the scope to the
 * transactions list, which is what the interpretation meant in the first
 * place. There is nothing to refresh, because nothing was snapshotted.
 */
export interface SearchFilterRecord extends SearchRecordBase {
  kind: 'filter';
}

export type SearchRecord = SearchAnswerRecord | SearchFilterRecord;

export function isAnswerRecord(record: SearchRecord): record is SearchAnswerRecord {
  return record.kind === 'aggregate';
}
