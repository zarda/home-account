import { Timestamp } from '@angular/fire/firestore';
import { Transaction, TransactionFilters } from '../../models';
import { QueryOptions } from '../services/firestore.service';
import { fuzzyQueryMatches } from './fuzzy-match.utils';

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
    // Set end date to end of day (23:59:59.999) to make it inclusive
    const endOfDay = new Date(filters.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    whereConditions.push({
      field: 'date',
      op: '<=',
      value: Timestamp.fromDate(endOfDay)
    });
  }

  if (filters.currency) {
    whereConditions.push({ field: 'currency', op: '==', value: filters.currency });
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

  if (filters?.minAmount !== undefined) {
    result = result.filter(t => t.amount >= filters.minAmount!);
  }

  if (filters?.maxAmount !== undefined) {
    result = result.filter(t => t.amount <= filters.maxAmount!);
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
