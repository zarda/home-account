/**
 * Shared types for the AI receipt-processing pipeline.
 */
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
}

export interface ProcessingResult {
  transactions: ProcessedTransaction[];
  source: 'cloud' | 'native';
  confidence: number;
  processingTimeMs: number;
}
