import { Timestamp } from '@angular/fire/firestore';
import { Transaction, TransactionFilters } from '../../models';
import { QueryOptions } from '../services/firestore.service';

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

// Filters Firestore cannot express on this query (amount range would need a
// second inequality field; search is substring matching). Applied after fetch.
export function applyClientTransactionFilters(
  transactions: Transaction[],
  filters?: TransactionFilters
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
    result = result.filter(t =>
      t.description.toLowerCase().includes(query) ||
      t.note?.toLowerCase().includes(query) ||
      t.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  }

  return result;
}
