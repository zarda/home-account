/**
 * Shared types for the AI receipt-processing pipeline.
 */
import type { FieldConfidence } from '../../models';

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
   * How sure the model was that it read the amount and the date correctly.
   *
   * Distinct from `confidence`, which is a coarse "did this look like a
   * receipt at all" score. Absent when the source cannot report it — the
   * regex parser has no way to know, and neither does a CSV row.
   */
  fieldConfidence?: FieldConfidence;
  /**
   * True when `currency` is the account's fallback rather than something read
   * off the receipt. Distinguishing the two is what lets a caller offer a
   * better guess — from where the user is standing — without ever overriding
   * a currency the model actually read.
   */
  currencyFellBack?: boolean;
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
