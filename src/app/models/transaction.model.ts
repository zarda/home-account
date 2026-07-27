import { Timestamp } from '@angular/fire/firestore';
import { BudgetPeriod } from './budget.model';

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;                // Always positive
  currency: string;              // ISO 4217 code
  amountInBaseCurrency: number;  // Converted amount for reporting
  exchangeRate: number;          // Rate at time of transaction
  baseCurrency?: string;         // Base the snapshot was computed against
                                 // (absent on rows written before stamping)
  categoryId: string;
  description: string;
  note?: string;
  date: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  receiptUrl?: string;           // Firebase Storage URL
  /**
   * How many receipt images this transaction holds.
   *
   * Denormalized because the alternative is querying on the image field
   * itself, and that only works while the field is a string. Firestore orders
   * arrays after strings, so `receiptUrls > ''` would match every document
   * including ones with no images at all — and the quota that counts them
   * would lock every user out at the free-tier limit.
   *
   * Absent on rows written before this field existed; treat as derived from
   * receiptUrl.
   */
  receiptCount?: number;
  tags?: string[];
  isRecurring: boolean;
  recurringId?: string;          // Link to RecurringTransaction
  location?: TransactionLocation;
  period?: BudgetPeriod;         // Budget period association
}

/**
 * How many receipt images a transaction holds.
 *
 * Rows written before `receiptCount` existed have no count but may well have
 * an image, so the field cannot be read raw — a row with a receipt and no
 * count must not read as empty, or replacing its image would consume a second
 * quota slot for the same picture.
 */
export function receiptImageCount(
  transaction: Pick<Transaction, 'receiptUrl' | 'receiptCount'> | null | undefined
): number {
  if (!transaction) return 0;
  if (typeof transaction.receiptCount === 'number') return transaction.receiptCount;
  return transaction.receiptUrl ? 1 : 0;
}

export interface TransactionLocation {
  name: string;
  lat?: number;
  lng?: number;
}

export interface TransactionFilters {
  type?: TransactionType;
  categoryId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  searchQuery?: string;
}

export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  description: string;
  date: Date;
  note?: string;
  receiptFile?: File;
  tags?: string[];
  isRecurring?: boolean;
  recurringId?: string;
  location?: TransactionLocation;
  period?: BudgetPeriod;
}

export interface MonthlyTotal {
  income: number;
  expense: number;
  balance: number;
  transactionCount: number;
  byCategory: CategoryTotal[];
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
}
