import { Timestamp } from '@angular/fire/firestore';
import type { BudgetPeriod } from './budget.model';
import type { TransactionLocation } from './transaction.model';

export type ImportSource = 'csv' | 'pdf' | 'image' | 'json';
export type ImportFileType = 'bank_csv' | 'bank_pdf' | 'receipt_image' | 'screenshot' | 'credit_card' | 'spreadsheet' | 'generic_csv' | 'backup_json';
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed';

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
}

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
  location?: TransactionLocation;
  period?: BudgetPeriod;
  isRecurring?: boolean;
}

export interface DuplicateCheck {
  transactionId: string;
  isDuplicate: boolean;
  /**
   * `within_batch` means the row duplicates another row in the same import,
   * rather than something already stored. Overlapping exports are the usual
   * cause — the same charge appearing in two files, or twice on one statement.
   */
  matchType: 'exact' | 'likely' | 'possible' | 'within_batch' | 'none';
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
  processingSource?: 'cloud' | 'native';  // Which AI processed the import
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
