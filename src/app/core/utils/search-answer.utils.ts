import {
  AggregateAnswer,
  AggregateOperation,
  SEARCH_ANSWER_SCHEMA_VERSION,
  SearchAnswerRecord,
  SerializableSearchScope,
  TransactionFilters,
} from '../../models';
import { dayKey, parseDayKey } from './transaction-date.utils';

/** The stored snapshot fields a create writes; identity and stamps land elsewhere. */
export type SearchAnswerSnapshot = Omit<
  SearchAnswerRecord,
  'id' | 'userId' | 'computedAt' | 'lastUsedAt' | 'createdAt' | 'updatedAt'
>;

/**
 * Scope to its stored form: dates become local-part day keys and absent
 * fields are omitted outright — Firestore rejects explicit `undefined`, and
 * the rules validate a closed field set. The end date's clock time truncates
 * by design: getTransactionsInRange re-clamps the range end to end-of-day, so
 * the revived scope fetches the identical window. `tags` never persists; the
 * model does not emit it and the stored scope has no such field.
 */
export function serializeScope(scope: TransactionFilters): SerializableSearchScope {
  const stored: SerializableSearchScope = {};
  if (scope.type !== undefined) stored.type = scope.type;
  if (scope.categoryId !== undefined) stored.categoryId = scope.categoryId;
  if (scope.startDate) stored.startDate = dayKey(scope.startDate);
  if (scope.endDate) stored.endDate = dayKey(scope.endDate);
  if (scope.minAmount !== undefined) stored.minAmount = scope.minAmount;
  if (scope.maxAmount !== undefined) stored.maxAmount = scope.maxAmount;
  if (scope.currency !== undefined) stored.currency = scope.currency;
  if (scope.searchQuery !== undefined) stored.searchQuery = scope.searchQuery;
  if (scope.goalId !== undefined) stored.goalId = scope.goalId;
  return stored;
}

/** The inverse: day keys revive as local midnight via parseDayKey. */
export function deserializeScope(scope: SerializableSearchScope): TransactionFilters {
  const filters: TransactionFilters = {};
  if (scope.type !== undefined) filters.type = scope.type;
  if (scope.categoryId !== undefined) filters.categoryId = scope.categoryId;
  const start = parseDayKey(scope.startDate);
  if (start) filters.startDate = start;
  const end = parseDayKey(scope.endDate);
  if (end) filters.endDate = end;
  if (scope.minAmount !== undefined) filters.minAmount = scope.minAmount;
  if (scope.maxAmount !== undefined) filters.maxAmount = scope.maxAmount;
  if (scope.currency !== undefined) filters.currency = scope.currency;
  if (scope.searchQuery !== undefined) filters.searchQuery = scope.searchQuery;
  if (scope.goalId !== undefined) filters.goalId = scope.goalId;
  return filters;
}

/**
 * The snapshot a create stores. The extreme row is kept as an id only —
 * stored documents never embed transaction copies — and groups are copied so
 * the record cannot alias the live answer.
 */
export function buildAnswerFields(
  query: string,
  intent: { operation: AggregateOperation; limit: number },
  answer: AggregateAnswer,
  baseCurrency: string,
): SearchAnswerSnapshot {
  const fields: SearchAnswerSnapshot = {
    schemaVersion: SEARCH_ANSWER_SCHEMA_VERSION,
    query,
    operation: intent.operation,
    limit: intent.limit,
    scope: serializeScope(answer.scope),
    baseCurrency,
    value: answer.value,
    transactionCount: answer.transactionCount,
  };
  if (answer.currency !== undefined) fields.currency = answer.currency;
  if (answer.extremeTransaction) fields.extremeTransactionId = answer.extremeTransaction.id;
  if (answer.groups) fields.groups = answer.groups.map(group => ({ ...group }));
  return fields;
}

/**
 * A stored record back into a renderable answer. `extremeTransaction` stays
 * absent — the snapshot holds only its id, and the card renders the detail
 * line only for live or freshly refreshed answers.
 */
export function recordToAnswer(record: SearchAnswerRecord): AggregateAnswer {
  const answer: AggregateAnswer = {
    operation: record.operation,
    value: record.value,
    transactionCount: record.transactionCount,
    scope: deserializeScope(record.scope),
  };
  if (record.currency !== undefined) answer.currency = record.currency;
  if (record.groups) answer.groups = record.groups.map(group => ({ ...group }));
  return answer;
}

/** The replay input: the stored operation and limit over the revived scope. */
export function recordToIntent(
  record: SearchAnswerRecord,
): { operation: AggregateOperation; filters: TransactionFilters; limit: number } {
  return {
    operation: record.operation,
    filters: deserializeScope(record.scope),
    limit: record.limit,
  };
}

/**
 * Identity of a stored answer: the normalized question plus what was computed
 * and over what. Scope keys are sorted so two writes of the same scope agree
 * regardless of construction order.
 */
export function answerDedupeKey(
  query: string,
  operation: AggregateOperation,
  limit: number,
  scope: SerializableSearchScope,
): string {
  const entries = Object.entries(scope)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `${query.trim().toLowerCase()}|${operation}|${limit}|${JSON.stringify(Object.fromEntries(entries))}`;
}
