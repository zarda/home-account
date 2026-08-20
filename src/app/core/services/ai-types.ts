/**
 * Shared types for the AI receipt-processing pipeline.
 */
import type { BudgetPeriod, FieldConfidence, TransactionLocation } from '../../models';

export interface ProcessedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  confidence: number;
  source: 'cloud' | 'native';
  notes?: string;
  suggestedCategoryId?: string;
  receiptId?: number;
  /**
   * How sure the reader was that it read the amount and the date correctly.
   *
   * Distinct from `confidence`, which is a coarse "did this look like a
   * receipt at all" score. The regex parser reports this for the amount — the
   * evidence tier the winning figure matched, cut further when it was a
   * tendered-cash figure demoted to the printed total — but not the date,
   * which stays unreported on that path. Absent entirely when the source has
   * no reading to grade at all, as a CSV row does not.
   */
  fieldConfidence?: FieldConfidence;
  /**
   * True when `currency` is the account's fallback rather than something read
   * off the receipt. Distinguishing the two is what lets a caller offer a
   * better guess — from where the user is standing — without ever overriding
   * a currency the model actually read.
   */
  currencyFellBack?: boolean;
  /**
   * False on the paths that never ask anything to categorize the row, so an
   * unset `suggestedCategoryId` there means "nobody looked" rather than "the
   * answer resolved to nothing". The import seams grade those two apart.
   *
   * Absent means a categorizer ran — whether it named a category, named one
   * the catalog could not place, or returned nothing at all. Only the reader
   * that does no categorization work of its own sets this, which is why the
   * flag names the exception rather than the rule.
   */
  categoryAttempted?: boolean;
  // Optional transaction fields an extractor may have read; absent means
  // nobody looked, so no producer defaults any of them.
  tags?: string[];
  location?: TransactionLocation;
  period?: BudgetPeriod;
  isRecurring?: boolean;
  /**
   * Which photo the row came from, and which photos a merged row was built
   * from. The strategy path used to drop both on this hop, so the review step
   * stamped every row `image_0` and the confirm step could not tell whose
   * photo was whose. Absent when the engine has no per-photo mapping.
   */
  imageIndex?: number;
  mergedFromImages?: number[];
}

export interface ProcessingResult {
  transactions: ProcessedTransaction[];
  source: 'cloud' | 'native';
  confidence: number;
  processingTimeMs: number;
  /**
   * Receipts the model reported seeing in the source photo.
   *
   * Describes the photo rather than any one row, which is why it sits here
   * and not on the transaction. Native OCR reads one receipt per photo, so it
   * leaves this unset and callers read it as 1.
   */
  receiptCount?: number;
}
