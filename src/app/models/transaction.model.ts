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
  /**
   * First stored receipt image. Kept as a plain string even now that a
   * transaction can hold several images, because the quota query filters on
   * `receiptUrl > ''` — and that only works while the field is a string.
   * Firestore range filters only match values of the operand's type, so an
   * array smuggled into this field would silently drop the row out of the
   * string comparison: every multi-image transaction would vanish from the
   * quota count and the limit would never trigger. (Verified against the
   * emulator in transaction-receipts.smoke.spec.ts.)
   */
  receiptUrl?: string;
  /**
   * Every stored receipt image, positional: the entry at index n lives at
   * storage slot n ({transactionId} for slot 0, {transactionId}_{n} beyond).
   * Removing a middle image leaves an empty-string tombstone so the indices
   * of the others keep matching their storage keys — nothing is ever renamed
   * or re-uploaded. Consequences:
   *
   * - `receiptUrls.length` is NOT the image count and `receiptUrls[0]` is
   *   NOT necessarily the first image. Read through receiptImageUrls() /
   *   receiptImageCount() / firstReceiptSlot(), never the raw field.
   * - Trailing tombstones are truncated on removal, so the array never
   *   grows past the highest live slot.
   *
   * Absent on rows written before this field existed; receiptUrl alone then
   * describes the single image.
   */
  receiptUrls?: string[];
  /**
   * How many receipt images this transaction holds.
   *
   * Denormalized for the same type-matching reason receiptUrl stays a
   * string (see above): the count must be readable without querying an
   * array-bearing field.
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
  /**
   * Goal this transaction counts toward, when linked. Written and cleared
   * only together with `goalAmount`; absent means not linked.
   */
  goalId?: string;
  /**
   * This transaction's contribution to the linked goal, in the GOAL's
   * currency — converted when the link is written and re-snapshotted when
   * the amount or currency changes, never at read time (the
   * amountInBaseCurrency precedent). Unlinking or deleting backs exactly
   * this figure out of the goal's counter, so a rate change between link
   * and unlink cannot strand a remainder in the goal.
   */
  goalAmount?: number;
}

type ReceiptFields = Pick<Transaction, 'receiptUrl' | 'receiptUrls' | 'receiptCount'>;

/**
 * How many receipt images a transaction holds.
 *
 * The array outranks the denormalized count: every reader that has the count
 * also has the whole document in hand, so preferring the array costs nothing
 * and closes the window where a write lands one but not the other. Rows
 * written before either field existed have no count but may well have an
 * image, so the field cannot be read raw — a row with a receipt and no count
 * must not read as empty, or replacing its image would consume a second
 * quota slot for the same picture.
 */
export function receiptImageCount(
  transaction: ReceiptFields | null | undefined
): number {
  if (!transaction) return 0;
  if (transaction.receiptUrls) {
    return transaction.receiptUrls.filter(url => !!url).length;
  }
  if (typeof transaction.receiptCount === 'number') return transaction.receiptCount;
  return transaction.receiptUrl ? 1 : 0;
}

/**
 * Every stored receipt image URL, in slot order, tombstones excluded. The
 * only sanctioned way to enumerate a transaction's images — the raw
 * receiptUrls array carries positional tombstones (see its doc comment).
 */
export function receiptImageUrls(
  transaction: ReceiptFields | null | undefined
): string[] {
  if (!transaction) return [];
  if (transaction.receiptUrls) {
    return transaction.receiptUrls.filter(url => !!url);
  }
  return transaction.receiptUrl ? [transaction.receiptUrl] : [];
}

/**
 * Storage slot of the first live image, or 0 when none exist. Callers that
 * act on "the" image of a transaction (the pointer in receiptUrl) need the
 * slot its object actually lives at, which after a first-image removal is
 * not slot 0.
 */
export function firstReceiptSlot(
  transaction: ReceiptFields | null | undefined
): number {
  const slots = transaction?.receiptUrls;
  if (!slots) return 0;
  const first = slots.findIndex(url => !!url);
  return first === -1 ? 0 : first;
}

export interface TransactionLocation {
  name: string;
  lat?: number;
  lng?: number;
  /**
   * ISO 3166-1 alpha-2 country of the location, from one of two sources.
   * For an attached coordinate it is derived on device from a bundled
   * bounding-box table rather than looked up, so it is coarse near a land
   * border and absent for a coordinate in open water or a country the table
   * does not cover. For a scanned receipt it is the country the reader
   * concluded the receipt was issued in (`readCountryCode`), filed here by
   * `printedLocationSlot(name, country)` only when an address was printed.
   *
   * Recorded because "what did the trip cost" is a question the ledger cannot
   * answer from a place name someone typed.
   */
  country?: string;
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
  /** Rows must carry every listed tag. Applied client-side, like the amount
   * range and search — see applyClientTransactionFilters. */
  tags?: string[];
  /**
   * Only rows linked to this goal. Server-side, like categoryId and currency:
   * the windowed pager applies client-only filters per fetched page, so a
   * sparse client-side match would render near-empty pages and cost the
   * header its exact count.
   */
  goalId?: string;
}

export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  description: string;
  date: Date;
  note?: string;
  /**
   * New receipt images to store. On add they fill slots 0..n-1; on update
   * they append after the existing images — replacing one means removing it
   * first. All-or-nothing: if any upload fails, none are kept.
   */
  receiptFiles?: File[];
  tags?: string[];
  isRecurring?: boolean;
  recurringId?: string;
  location?: TransactionLocation;
  period?: BudgetPeriod;
  /**
   * Goal to link this transaction to. The service converts the amount into
   * the goal's currency and keeps the goal's counter in step; on update,
   * a key present with value undefined unlinks (the location/period
   * convention), while an absent key leaves the link alone.
   */
  goalId?: string;
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
