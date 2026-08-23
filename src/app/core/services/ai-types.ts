/**
 * Shared types for the AI receipt-processing pipeline.
 */
import type { BudgetPeriod, FieldConfidence, LLMProvider, TransactionLocation } from '../../models';
import type { AIErrorInfo } from '../utils/ai-error.utils';

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
  recurringId?: string;
  /** ISO 3166-1 alpha-2 the model concluded the receipt was issued in; absent when it could not say. A review-step mark, never written. */
  receiptCountry?: string;
  /**
   * Which photo the row came from, and which photos a merged row was built
   * from. The strategy path used to drop both on this hop, so the review step
   * stamped every row `image_0` and the confirm step could not tell whose
   * photo was whose. Absent when the engine has no per-photo mapping.
   */
  imageIndex?: number;
  mergedFromImages?: number[];
}

/**
 * What one run of the receipt pipeline can say about itself.
 *
 * Computed once in AIStrategyService.runProcessing — the chokepoint every
 * door passes through — and carried out on the result or inside the thrown
 * ReceiptProcessingError. `fellBackFrom` names the engine that ran first and
 * lost; absent when the preferred engine answered. `provider` is the cloud
 * provider the attempt routed to, null when no cloud request was made.
 * `errorType`/`retryable` are present only on a throw.
 */
export interface ReceiptAttemptDiagnostics {
  engine: 'cloud' | 'native';
  fellBackFrom?: 'cloud' | 'native';
  provider: LLMProvider | null;
  durationMs: number;
  errorType?: AIErrorInfo['type'];
  retryable?: boolean;
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
  /** How this result was produced. Absent only on results built outside the strategy service. */
  diagnostics?: ReceiptAttemptDiagnostics;
}
