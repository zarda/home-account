import { Timestamp } from '@angular/fire/firestore';

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
  originalText?: string;           // Raw text from source
  merchant?: string;
  notes?: string;                  // Optional notes/details (e.g., items list from receipt)
  isDuplicate: boolean;
  duplicateOf?: string;            // Existing transaction ID
  selected: boolean;               // For UI checkbox
  imageMetadata?: ImagePositionMetadata;  // Multi-image position data
}

export interface DuplicateCheck {
  transactionId: string;
  isDuplicate: boolean;
  matchType: 'exact' | 'likely' | 'possible' | 'none';
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
