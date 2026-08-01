import {
  AGGREGATE_OPERATIONS,
  AggregateOperation,
  SearchIntent,
  SearchQueryContext,
  TransactionFilters,
} from '../../models';
import { parseDayKey } from './transaction-date.utils';

/** Longest free-text remainder carried into the keyword filter. */
const MAX_SEARCH_QUERY_LENGTH = 100;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

interface RawIntent {
  kind?: unknown;
  operation?: unknown;
  filters?: unknown;
  limit?: unknown;
}

interface RawFilters {
  type?: unknown;
  categoryId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  minAmount?: unknown;
  maxAmount?: unknown;
  currency?: unknown;
  searchQuery?: unknown;
}

/**
 * Validate and normalize a parsed model response into a SearchIntent.
 * Unusable shapes throw (the caller falls back to keyword search);
 * individually invalid fields are dropped, never guessed.
 */
export function parseSearchIntent(parsed: unknown, context: SearchQueryContext): SearchIntent {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Search response is not an object');
  }
  const raw = parsed as RawIntent;

  if (raw.kind !== 'filter' && raw.kind !== 'aggregate') {
    throw new Error(`Unknown search intent kind: ${String(raw.kind)}`);
  }

  const filters = sanitizeFilters(raw.filters, context);

  if (raw.kind === 'filter') {
    return { kind: 'filter', filters };
  }

  if (!AGGREGATE_OPERATIONS.includes(raw.operation as AggregateOperation)) {
    throw new Error(`Unknown aggregate operation: ${String(raw.operation)}`);
  }
  return {
    kind: 'aggregate',
    operation: raw.operation as AggregateOperation,
    filters,
    limit: clampLimit(raw.limit),
  };
}

function sanitizeFilters(rawFilters: unknown, context: SearchQueryContext): TransactionFilters {
  const raw: RawFilters =
    rawFilters && typeof rawFilters === 'object' ? (rawFilters as RawFilters) : {};
  const filters: TransactionFilters = {};

  if (raw.type === 'expense' || raw.type === 'income') {
    filters.type = raw.type;
  }

  let droppedCategory: string | null = null;
  if (typeof raw.categoryId === 'string' && raw.categoryId) {
    if (context.categories.some(c => c.id === raw.categoryId)) {
      filters.categoryId = raw.categoryId;
    } else {
      droppedCategory = raw.categoryId;
    }
  }

  let startDate = parseIsoDate(raw.startDate);
  let endDate = parseIsoDate(raw.endDate);
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  let minAmount = parseAmount(raw.minAmount);
  let maxAmount = parseAmount(raw.maxAmount);
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
    [minAmount, maxAmount] = [maxAmount, minAmount];
  }
  if (minAmount !== undefined) filters.minAmount = minAmount;
  if (maxAmount !== undefined) filters.maxAmount = maxAmount;

  if (typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency)) {
    filters.currency = raw.currency;
  }

  let searchQuery = typeof raw.searchQuery === 'string' ? raw.searchQuery.trim() : '';
  if (!searchQuery && droppedCategory) {
    // Keep the term the model tried to categorize so it isn't lost.
    searchQuery = droppedCategory.trim();
  }
  if (searchQuery) {
    filters.searchQuery = searchQuery.slice(0, MAX_SEARCH_QUERY_LENGTH);
  }

  return filters;
}

/**
 * Strict YYYY-MM-DD -> local-midnight Date; anything else is dropped.
 *
 * The year bound stays here rather than in `parseDayKey`: it is a sanity check
 * on what a model may hand back for a search scope, not a property of a date
 * string, and folding it into the shared parser would silently apply it to
 * receipt and CSV import too.
 */
function parseIsoDate(value: unknown): Date | undefined {
  const date = parseDayKey(value);
  if (!date || date.getFullYear() < MIN_YEAR || date.getFullYear() > MAX_YEAR) {
    return undefined;
  }
  return date;
}

function parseAmount(value: unknown): number | undefined {
  const num =
    typeof value === 'number' ? value :
    typeof value === 'string' && value.trim() !== '' ? Number(value) :
    NaN;
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

function clampLimit(value: unknown): number {
  const num = typeof value === 'number' ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(num)) return 3;
  return Math.min(10, Math.max(1, num));
}
