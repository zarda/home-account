import { Timestamp } from '@angular/fire/firestore';
import { Transaction, TransactionFilters } from '../../models';
import { QueryOptions } from '../services/firestore.service';
import { fuzzyQueryMatches } from './fuzzy-match.utils';
import { endOfDay } from './transaction-date.utils';

// Below this length the fuzzy pass adds nothing over the exact substring
// test (short tokens get no edit budget), so skip it entirely.
const MIN_FUZZY_QUERY_LENGTH = 3;

// Server-side filter conditions shared by the live list query and the
// windowed page queries. Keep both paths building identical constraints so
// they hit the same composite indexes.
export function buildTransactionWhere(
  filters?: TransactionFilters
): NonNullable<QueryOptions['where']> | undefined {
  if (!filters) return undefined;

  const whereConditions: NonNullable<QueryOptions['where']> = [];

  if (filters.type) {
    whereConditions.push({ field: 'type', op: '==', value: filters.type });
  }

  if (filters.categoryId) {
    whereConditions.push({ field: 'categoryId', op: '==', value: filters.categoryId });
  }

  if (filters.startDate) {
    whereConditions.push({
      field: 'date',
      op: '>=',
      value: Timestamp.fromDate(filters.startDate)
    });
  }

  if (filters.endDate) {
    // Widened to the last millisecond of the day so the bound is inclusive of
    // a row posted that evening, whatever time of day the filter carries.
    whereConditions.push({
      field: 'date',
      op: '<=',
      value: Timestamp.fromDate(endOfDay(filters.endDate))
    });
  }

  if (filters.currency) {
    whereConditions.push({ field: 'currency', op: '==', value: filters.currency });
  }

  if (filters.goalId) {
    whereConditions.push({ field: 'goalId', op: '==', value: filters.goalId });
  }

  // Dot notation reads inside the location map. Server-side deliberately —
  // see the field's own comment on TransactionFilters — and note that this
  // fifth equality field doubles the index set indexes:check demands.
  if (filters.country) {
    whereConditions.push({ field: 'location.country', op: '==', value: filters.country });
  }

  return whereConditions.length > 0 ? whereConditions : undefined;
}

// Cross-field data the search needs but a Transaction row doesn't carry.
export interface ClientFilterContext {
  // categoryId -> display name as the user currently sees it (translated).
  categoryNames?: Map<string, string>;
}

// Every text the search query is tested against for one transaction.
function searchableFields(t: Transaction, context?: ClientFilterContext): string[] {
  const fields = [t.description];
  if (t.note) fields.push(t.note);
  if (t.tags) fields.push(...t.tags);
  if (t.location?.name) fields.push(t.location.name);
  const categoryName = context?.categoryNames?.get(t.categoryId);
  if (categoryName) fields.push(categoryName);
  return fields;
}

// Filters Firestore cannot express on this query (amount range would need a
// second inequality field; search is substring matching). Applied after fetch.
export function applyClientTransactionFilters(
  transactions: Transaction[],
  filters?: TransactionFilters,
  context?: ClientFilterContext
): Transaction[] {
  let result = transactions;

  // typeof guards rather than !== undefined: a cleared number input arrives
  // as literal null, and `t.amount <= null` coerces to `<= 0`, which matches
  // nothing and sends the auto-fetch paging through the whole collection.
  // Insight chips and smart search feed this the same filter shape.
  if (typeof filters?.minAmount === 'number') {
    result = result.filter(t => t.amount >= filters.minAmount!);
  }

  if (typeof filters?.maxAmount === 'number') {
    result = result.filter(t => t.amount <= filters.maxAmount!);
  }

  // Client-side by design. Server-side would need array-contains — which
  // cannot express AND across several tags at all, and would demand a
  // composite index for every combination with the equality filters above.
  // Every selected tag must be present: filter chips narrow.
  if (filters?.tags?.length) {
    result = result.filter(t => filters.tags!.every(tag => t.tags?.includes(tag)));
  }

  if (filters?.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    const beforeSearch = result;
    result = beforeSearch.filter(t =>
      searchableFields(t, context).some(f => f.toLowerCase().includes(query))
    );

    // Typo fallback: only when the exact pass found nothing, so exact matches
    // are never diluted or demoted and rows keep their server date order.
    // Evaluated per loaded window — as more rows stream in, a late exact match
    // supersedes fuzzy-only rows; the brief swap is accepted.
    if (result.length === 0 && query.trim().length >= MIN_FUZZY_QUERY_LENGTH) {
      result = beforeSearch.filter(t =>
        fuzzyQueryMatches(query, searchableFields(t, context).join(' '))
      );
    }
  }

  return result;
}
