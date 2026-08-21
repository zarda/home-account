import { BudgetPeriod, CreateTransactionDTO, TransactionLocation } from '../../models';
import { FALLBACK_CATEGORY_ID } from './categorization.utils';

/**
 * The one row shape an import door hands over to become a transaction.
 *
 * Every field is optional except amount and date because absence is meaning:
 * a bank CSV carries none of the optionals, a receipt may carry two, and a
 * missing slot must keep meaning "nobody looked" all the way to the write.
 */
export interface ImportRowFields {
  type?: 'income' | 'expense';
  amount: number;
  currency?: string;
  categoryId?: string;
  description?: string;
  date: Date;
  note?: string;
  tags?: string[];
  location?: TransactionLocation;
  isRecurring?: boolean;
  recurringId?: string;
  period?: BudgetPeriod;
}

/**
 * The currency an import row is shown in, and whether anyone read it.
 *
 * Every door used to write `row.currency || baseCurrency` and lose the
 * difference. The flag is what lets the review step mark a currency nobody
 * read — the same distinction `ProcessedTransaction.currencyFellBack` draws
 * for the form's scan — and it never reaches the mapper below, which names
 * its fields.
 */
export function resolveImportCurrency(
  read: string | undefined,
  baseCurrency: string
): { currency: string; currencyFellBack?: true } {
  return read ? { currency: read } : { currency: baseCurrency, currencyFellBack: true };
}

/**
 * Build the create DTO every import door writes through.
 *
 * This is the chokepoint the CSV escaper already proved out: when each door
 * kept its own field list, a field added to one door reached exactly that
 * door, and the AI wizard shipped six fields while the data hub shipped
 * eleven. The guards live here once; callers only rename their row's fields
 * into this shape.
 *
 * The conditional spreads are load-bearing: an optional key must be absent,
 * not undefined, because Firestore rejects undefined values and an empty
 * tags array or `{ name: '' }` location would pass the rules while meaning
 * nothing. `isRecurring` alone guards on presence rather than truth — false
 * is an answer, and the truthy guard would erase it. `recurringId` takes the
 * truthy guard instead, the same one `addTransaction` uses: an id has no
 * "false" to preserve, and a link the review step declined arrives here as a
 * key holding undefined.
 */
export function toCreateTransactionDTO(row: ImportRowFields, baseCurrency: string): CreateTransactionDTO {
  return {
    type: row.type ?? (row.amount >= 0 ? 'income' : 'expense'),
    amount: Math.abs(row.amount),
    currency: row.currency || baseCurrency,
    categoryId: row.categoryId || FALLBACK_CATEGORY_ID,
    description: row.description || 'Imported transaction',
    date: row.date,
    ...(row.note ? { note: row.note } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...(row.location ? { location: row.location } : {}),
    ...(row.isRecurring !== undefined ? { isRecurring: row.isRecurring } : {}),
    ...(row.recurringId ? { recurringId: row.recurringId } : {}),
    ...(row.period ? { period: row.period } : {})
  };
}
