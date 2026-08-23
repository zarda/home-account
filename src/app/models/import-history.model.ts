import { Timestamp } from '@angular/fire/firestore';
import type { BudgetPeriod } from './budget.model';
import type { TransactionLocation } from './transaction.model';
import type { LLMProvider } from './user.model';
import type { ReceiptAttemptDiagnostics } from '../core/services/ai-types';

export type ImportSource = 'csv' | 'pdf' | 'image' | 'json';
export type ImportFileType = 'bank_csv' | 'bank_pdf' | 'receipt_image' | 'screenshot' | 'credit_card' | 'spreadsheet' | 'generic_csv' | 'backup_json';
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed';

/** Which surface ran the receipt. Absent on imports that were not a receipt attempt. */
export type ReceiptDoor = 'camera' | 'wizard' | 'form' | 'queue';
export type ReceiptEngine = 'cloud' | 'native';
/**
 * The closed set a failed attempt is filed under: parseAIError's classes plus
 * the three the pipeline itself decides — no engine configured, an engine
 * that answered with nothing, and an offline queue write that failed.
 */
export type ReceiptFailureClass =
  | 'rate_limit' | 'auth' | 'network' | 'quota' | 'server' | 'timeout'
  | 'no_provider' | 'nothing_extracted' | 'queue_write' | 'unknown';

export interface ImportHistory {
  id: string;
  userId: string;
  importedAt: Timestamp;
  source: ImportSource;
  fileType: ImportFileType;
  fileName: string;
  fileSize: number;
  transactionCount: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  totalIncome: number;
  totalExpenses: number;
  status: ImportStatus;
  errors?: ImportError[];
  duplicatesSkipped: number;
  /**
   * Rows saved without their photo because the image quota refused the
   * upload. Distinct from `errorCount` on purpose: the transaction landed,
   * so routing this through the error list would re-offer a saved row for a
   * second import. Absent when no photo was skipped.
   */
  receiptsSkipped?: number;
  /**
   * How the attempt ran, recorded for receipts only. Written at extraction
   * time for a failed attempt and at confirm time for a successful one.
   * Every slot is optional because a CSV import has none of them.
   */
  door?: ReceiptDoor;
  engine?: ReceiptEngine;
  /** The engine that ran first and lost. Absent when the preferred engine answered. */
  fellBackFrom?: ReceiptEngine;
  provider?: LLMProvider;
  errorType?: ReceiptFailureClass;
  durationMs?: number;
}

/** The receipt-attempt slots of a record, as a caller hands them to the writer. */
export type ImportProvenance = Pick<
  ImportHistory,
  'door' | 'engine' | 'fellBackFrom' | 'provider' | 'errorType' | 'durationMs'
>;

export interface ImportError {
  row?: number;
  field?: string;
  message: string;
  originalValue?: string;
}

export interface ImagePositionMetadata {
  imageIndex: number;              // Which image this item came from (0-based)
  imageId: string;                 // Unique identifier for the source image
  positionInImage: 'top' | 'middle' | 'bottom';  // Vertical position within image
  confidenceScore: number;         // OCR/extraction confidence (0-1)
  wasMerged?: boolean;             // True if this item was deduplicated from multiple images
  mergedFromImages?: number[];     // Source image indices this item was merged from
  receiptId?: number;              // AI-assigned receipt group across the processed photos
}

/**
 * Per-field extraction confidence, 0–1.
 *
 * Only the two fields a misread actually costs something: an amount that is
 * wrong is money recorded wrong, and a date that is wrong lands the
 * transaction in the wrong period. A misread description is visible at a
 * glance and harmless.
 */
export interface FieldConfidence {
  amount?: number;
  date?: number;
}

/** Below this, a field is worth the reviewer's attention before importing. */
export const VERIFY_FIELD_THRESHOLD = 0.7;

/** The rule a row looks like, as offered on the review card. Never written. */
export interface RecurringMatchSuggestion {
  id: string;
  name: string;
  /** What the source said about isRecurring before the link, restored when it is declined. */
  sourceIsRecurring?: boolean;
}

/** Which rung of the currency ladder spoke; the ladder itself is #156's slot to build. */
export type CurrencySuggestionReason = 'receipt' | 'position' | 'session' | 'locale';

/** A currency offered for a row whose currency fell back. Offered, never applied in bulk (ADR 0062); never written. */
export interface CurrencySuggestion {
  code: string;
  /** Alpha-2 of the country the rung answered from; absent on the session rung, which remembers a code and not a place. */
  country?: string;
  reason: CurrencySuggestionReason;
}

export interface CategorizedImportTransaction {
  id: string;                      // Temporary ID for UI selection
  description: string;
  amount: number;
  currency: string;
  date: Date;
  type: 'income' | 'expense';
  suggestedCategoryId: string;
  categoryConfidence: number;
  /**
   * How sure the model was that it read the amount and the date correctly.
   *
   * Separate from categoryConfidence, which is about where the transaction
   * belongs rather than whether it was read right. The extraction confidence
   * used to be collapsed into categoryConfidence and lost, so a blurry total
   * looked exactly like a clear one in the preview — and the amount is the
   * field a misread costs the most.
   *
   * Absent means the source could not report it (CSV, JSON, a manual row).
   */
  fieldConfidence?: FieldConfidence;
  /**
   * True when `currency` is the account's base currency because the source
   * reported none — a fallback, not a reading. The review step marks it the
   * way it marks a low-confidence amount; the confirm step never writes it.
   */
  currencyFellBack?: boolean;
  originalText?: string;           // Raw text from source
  merchant?: string;
  notes?: string;                  // Optional notes/details (e.g., items list from receipt)
  isDuplicate: boolean;
  duplicateOf?: string;            // Existing transaction ID
  selected: boolean;               // For UI checkbox
  imageMetadata?: ImagePositionMetadata;  // Multi-image position data
  // Optional transaction fields the source answered; absent means nobody
  // looked. The confirm step forwards whatever is present and invents nothing.
  tags?: string[];
  /** What the suggester offered, so the confirm step can record what was removed. Never written. */
  suggestedTags?: string[];
  location?: TransactionLocation;
  /** A review-step mark, never written: the country the reader concluded the receipt was issued in. */
  receiptCountry?: string;
  /** A review-step mark, never written: the currency the ladder offers while `currencyFellBack` stands. The slot is declared; #156 builds the ladder that fills it. */
  currencySuggestion?: CurrencySuggestion;
  period?: BudgetPeriod;
  isRecurring?: boolean;
  /** The active rule this row looks like, offered unchecked. Never written. */
  recurringMatch?: RecurringMatchSuggestion;
  /** Set only when the user accepted the offered link. */
  recurringId?: string;
}

export interface DuplicateCheck {
  transactionId: string;
  isDuplicate: boolean;
  /**
   * `within_batch` means the row duplicates another row in the same import,
   * rather than something already stored. Overlapping exports are the usual
   * cause — the same charge appearing in two files, or twice on one statement.
   *
   * `recurring_occurrence` means the stored row is an occurrence the scheduler
   * posted for the rule this row was *offered*. Detection runs before the card
   * can accept or decline, so the flag keys on the match, not on the link, and
   * `markDuplicates` deselects the row like any other duplicate; declining the
   * link afterwards does not re-run detection.
   */
  matchType: 'exact' | 'likely' | 'possible' | 'within_batch' | 'recurring_occurrence' | 'none';
  existingTransactionId?: string;
  confidence: number;
}

export interface CSVColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  debitColumn?: string;
  creditColumn?: string;
  typeColumn?: string;
  categoryColumn?: string;
  dateFormat: string;
  hasHeader: boolean;
}

export interface MultiImageMetadata {
  totalImages: number;             // Total number of images processed
  itemsMerged: number;             // Count of items that were deduplicated
  deduplicationMethod: 'ai' | 'position' | 'manual';  // How deduplication was performed
  imageIds: string[];              // Ordered list of image identifiers
}

export interface ImportResult {
  source: ImportSource;
  fileType: ImportFileType;
  fileName: string;
  fileSize: number;
  rawData?: string;
  transactions: CategorizedImportTransaction[];
  confidence: number;
  warnings: ImportWarning[];
  duplicates: DuplicateCheck[];
  sourceFiles?: File[];            // Support multiple source files
  multiImageMetadata?: MultiImageMetadata;  // Multi-image processing info
  /** How the receipt engine ran, when one did. Absent for CSV, PDF and JSON. */
  diagnostics?: ReceiptAttemptDiagnostics;
}

export interface ImportWarning {
  type: 'duplicate' | 'low_confidence' | 'missing_data' | 'currency_mismatch' | 'parse_error' | 'info';
  message: string;
  transactionId?: string;
  row?: number;
}

export interface ImportPreview {
  transactions: CategorizedImportTransaction[];
  totalIncome: number;
  totalExpenses: number;
  duplicateCount: number;
  selectedCount: number;
}
