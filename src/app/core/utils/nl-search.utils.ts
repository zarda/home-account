import {
  AGGREGATE_OPERATIONS,
  AggregateOperation,
  SearchIntent,
  SearchQueryContext,
  TransactionFilters,
} from '../../models';

/** Longest free-text remainder carried into the keyword filter. */
const MAX_SEARCH_QUERY_LENGTH = 100;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

/**
 * Prompt for turning a natural-language question about the user's
 * transactions into a structured command. The model only ever returns a
 * scope and an operation; it is never asked for (and must never produce)
 * a numeric answer.
 */
export function buildSearchPrompt(query: string, context: SearchQueryContext): string {
  const catalog = context.categories
    .map(c => `${c.id}: ${c.name}`)
    .join('\n');

  return `You convert a user's natural-language question about their personal finance transactions into a JSON command. Today is ${context.today}. The base currency is ${context.baseCurrency}. The question may be in English, Japanese, or Traditional Chinese.

Valid categoryId values (id: name):
${catalog}

Decide the kind:
- "filter" when the user wants to FIND or LIST transactions.
- "aggregate" when the user asks for a computed value: total spent -> "sum", how many -> "count", average -> "average", biggest/most expensive -> "max", smallest/cheapest -> "min", top/biggest categories -> "topCategories".

Rules:
- Resolve relative ranges ("last month", "this year") against today; dates are YYYY-MM-DD.
- Only use categoryId values from the list above. If no listed category clearly matches, omit categoryId and put the term in searchQuery instead.
- "type" is "expense" or "income". Amounts are plain numbers. Omit every field the question does not imply. Never invent amounts or dates.
- "limit" (topCategories only) is how many categories to return.

Return ONLY one JSON object, no other text, in one of these shapes:
{"kind":"filter","filters":{"type":"expense","categoryId":"food","startDate":"2026-06-01","endDate":"2026-06-30","minAmount":50,"maxAmount":200,"currency":"USD","searchQuery":"starbucks"}}
{"kind":"aggregate","operation":"sum","filters":{"categoryId":"food","startDate":"2026-06-01","endDate":"2026-06-30"},"limit":3}

The question: "${query}"`;
}

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

/** Strict YYYY-MM-DD -> local-midnight Date; anything else is dropped. */
function parseIsoDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;

  const date = new Date(year, month - 1, day);
  // Reject rollovers like 2026-02-31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
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
