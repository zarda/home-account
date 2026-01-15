import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionService } from './transaction.service';
import { Transaction, CategorizedImportTransaction, DuplicateCheck, ImagePositionMetadata } from '../../models';

@Injectable({ providedIn: 'root' })
export class DuplicateDetectionService {
  private transactionService = inject(TransactionService);

  /**
   * Check a batch of import transactions for duplicates against existing transactions
   */
  async checkDuplicates(transactions: CategorizedImportTransaction[]): Promise<DuplicateCheck[]> {
    const existingTxns = this.transactionService.transactions();
    const results: DuplicateCheck[] = [];

    for (const txn of transactions) {
      const result = this.checkSingleTransaction(txn, existingTxns);
      results.push(result);
    }

    return results;
  }

  /**
   * Check a single transaction for duplicates
   */
  checkSingleTransaction(
    txn: CategorizedImportTransaction,
    existingTxns: Transaction[]
  ): DuplicateCheck {
    // Check for exact match first
    const exactMatch = existingTxns.find(existing =>
      this.isExactMatch(txn, existing)
    );

    if (exactMatch) {
      return {
        transactionId: txn.id,
        isDuplicate: true,
        matchType: 'exact',
        existingTransactionId: exactMatch.id,
        confidence: 1.0
      };
    }

    // Check for likely match (same date + amount, different description)
    const likelyMatch = existingTxns.find(existing =>
      this.isLikelyMatch(txn, existing)
    );

    if (likelyMatch) {
      return {
        transactionId: txn.id,
        isDuplicate: true,
        matchType: 'likely',
        existingTransactionId: likelyMatch.id,
        confidence: 0.8
      };
    }

    // Check for possible match (date within 1 day + same amount)
    const possibleMatch = existingTxns.find(existing =>
      this.isPossibleMatch(txn, existing)
    );

    if (possibleMatch) {
      return {
        transactionId: txn.id,
        isDuplicate: true,
        matchType: 'possible',
        existingTransactionId: possibleMatch.id,
        confidence: 0.5
      };
    }

    return {
      transactionId: txn.id,
      isDuplicate: false,
      matchType: 'none',
      confidence: 0
    };
  }

  /**
   * Exact match: same date + same amount + similar description
   */
  isExactMatch(txn: CategorizedImportTransaction, existing: Transaction): boolean {
    const sameDate = this.isSameDay(existing.date, txn.date);
    const sameAmount = this.isSameAmount(txn.amount, existing.amount);
    const similarDesc = this.isSimilarDescription(txn.description, existing.description);

    return sameDate && sameAmount && similarDesc;
  }

  /**
   * Likely match: same date + same amount, possibly different description
   */
  isLikelyMatch(txn: CategorizedImportTransaction, existing: Transaction): boolean {
    const sameDate = this.isSameDay(existing.date, txn.date);
    const sameAmount = this.isSameAmount(txn.amount, existing.amount);
    const sameType = txn.type === existing.type;

    return sameDate && sameAmount && sameType;
  }

  /**
   * Possible match: date within 1 day + same amount
   */
  isPossibleMatch(txn: CategorizedImportTransaction, existing: Transaction): boolean {
    const withinOneDay = this.isWithinDays(existing.date, txn.date, 1);
    const sameAmount = this.isSameAmount(txn.amount, existing.amount);
    const sameType = txn.type === existing.type;

    return withinOneDay && sameAmount && sameType;
  }

  /**
   * Check if two dates are on the same day
   */
  private isSameDay(date1: Date | Timestamp, date2: Date): boolean {
    const d1 = date1 instanceof Date ? date1 : date1.toDate();
    return (
      d1.getFullYear() === date2.getFullYear() &&
      d1.getMonth() === date2.getMonth() &&
      d1.getDate() === date2.getDate()
    );
  }

  /**
   * Check if two dates are within N days of each other
   */
  private isWithinDays(date1: Date | Timestamp, date2: Date, days: number): boolean {
    const d1 = date1 instanceof Date ? date1 : date1.toDate();
    const diffTime = Math.abs(d1.getTime() - date2.getTime());
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays <= days;
  }

  /**
   * Check if two amounts are the same (within floating point tolerance)
   */
  private isSameAmount(amount1: number, amount2: number): boolean {
    return Math.abs(amount1 - amount2) < 0.01;
  }

  /**
   * Check if two descriptions are similar
   */
  private isSimilarDescription(desc1: string, desc2: string): boolean {
    const normalized1 = this.normalizeDescription(desc1);
    const normalized2 = this.normalizeDescription(desc2);

    // Exact match after normalization
    if (normalized1 === normalized2) return true;

    // Check if one contains the other
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return true;
    }

    // Calculate similarity score
    const similarity = this.calculateSimilarity(normalized1, normalized2);
    return similarity >= 0.7;
  }

  /**
   * Normalize a description for comparison
   */
  private normalizeDescription(desc: string): string {
    return desc
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')  // Remove non-alphanumeric
      .trim();
  }

  /**
   * Calculate similarity score between two strings (Dice coefficient)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1.length < 2 || str2.length < 2) {
      return str1 === str2 ? 1 : 0;
    }

    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    let intersection = 0;
    for (const bigram of bigrams1) {
      if (bigrams2.has(bigram)) {
        intersection++;
      }
    }

    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

  /**
   * Get bigrams (pairs of adjacent characters) from a string
   */
  private getBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Mark import transactions with duplicate info
   */
  markDuplicates(
    transactions: CategorizedImportTransaction[],
    duplicateChecks: DuplicateCheck[]
  ): CategorizedImportTransaction[] {
    const checkMap = new Map(duplicateChecks.map(c => [c.transactionId, c]));

    return transactions.map(txn => {
      const check = checkMap.get(txn.id);
      if (check && check.isDuplicate) {
        return {
          ...txn,
          isDuplicate: true,
          duplicateOf: check.existingTransactionId,
          selected: false  // Deselect duplicates by default
        };
      }
      return txn;
    });
  }

  /**
   * Check for duplicates within a multi-image import batch using position awareness.
   * This is a secondary check after AI-based deduplication to catch any remaining duplicates.
   */
  checkMultiImageDuplicates(
    transactions: CategorizedImportTransaction[]
  ): MultiImageDuplicateCheck[] {
    const results: MultiImageDuplicateCheck[] = [];
    const transactionsWithMetadata = transactions.filter(t => t.imageMetadata);

    // Group transactions by consecutive image pairs
    for (let i = 0; i < transactionsWithMetadata.length; i++) {
      const txn = transactionsWithMetadata[i];
      const metadata = txn.imageMetadata!;

      // Check against other transactions for potential duplicates
      for (let j = i + 1; j < transactionsWithMetadata.length; j++) {
        const other = transactionsWithMetadata[j];
        const otherMetadata = other.imageMetadata!;

        // Only check items from consecutive images
        if (Math.abs(metadata.imageIndex - otherMetadata.imageIndex) !== 1) {
          continue;
        }

        // Check for overlap zone duplicates
        const isInOverlapZone = this.isInOverlapZone(metadata, otherMetadata);
        if (!isInOverlapZone) continue;

        // Check if descriptions and amounts match
        const isSimilar = this.isSimilarDescription(txn.description, other.description);
        const sameAmount = this.isSameAmountWithTolerance(txn.amount, other.amount, 0.01);

        if (isSimilar && sameAmount) {
          // Found a duplicate - prefer the one with higher confidence
          const keepId = metadata.confidenceScore >= otherMetadata.confidenceScore ? txn.id : other.id;
          const removeId = keepId === txn.id ? other.id : txn.id;

          results.push({
            transactionId: removeId,
            isDuplicate: true,
            keepTransactionId: keepId,
            confidence: Math.min(metadata.confidenceScore, otherMetadata.confidenceScore),
            reason: 'position_overlap',
            imageIndices: [metadata.imageIndex, otherMetadata.imageIndex]
          });
        }
      }
    }

    return results;
  }

  /**
   * Check if two items are in the overlap zone between consecutive images.
   * The bottom 30% of image N overlaps with the top 30% of image N+1.
   */
  private isInOverlapZone(
    metadata1: ImagePositionMetadata,
    metadata2: ImagePositionMetadata
  ): boolean {
    // Determine which is the earlier image
    const [earlier, later] = metadata1.imageIndex < metadata2.imageIndex
      ? [metadata1, metadata2]
      : [metadata2, metadata1];

    // Earlier image item should be at the bottom
    const earlierInOverlapZone = earlier.positionInImage === 'bottom';

    // Later image item should be at the top
    const laterInOverlapZone = later.positionInImage === 'top';

    return earlierInOverlapZone && laterInOverlapZone;
  }

  /**
   * Check if two amounts are the same within a percentage tolerance.
   */
  private isSameAmountWithTolerance(amount1: number, amount2: number, tolerancePercent: number): boolean {
    if (amount1 === 0 && amount2 === 0) return true;
    if (amount1 === 0 || amount2 === 0) return false;

    const percentDiff = Math.abs(amount1 - amount2) / Math.max(amount1, amount2);
    return percentDiff <= tolerancePercent;
  }

  /**
   * Apply multi-image duplicate detection and merge results.
   * Returns transactions with duplicates removed and merge info updated.
   */
  applyMultiImageDeduplication(
    transactions: CategorizedImportTransaction[]
  ): CategorizedImportTransaction[] {
    const duplicateChecks = this.checkMultiImageDuplicates(transactions);
    const duplicateIds = new Set(duplicateChecks.map(c => c.transactionId));

    // Build a map of kept transaction IDs to their merged source images
    const mergeMap = new Map<string, number[]>();
    for (const check of duplicateChecks) {
      if (check.keepTransactionId) {
        const existing = mergeMap.get(check.keepTransactionId) || [];
        mergeMap.set(check.keepTransactionId, [...existing, ...check.imageIndices]);
      }
    }

    return transactions
      .filter(t => !duplicateIds.has(t.id))
      .map(t => {
        const mergedImages = mergeMap.get(t.id);
        if (mergedImages && t.imageMetadata) {
          return {
            ...t,
            imageMetadata: {
              ...t.imageMetadata,
              wasMerged: true,
              mergedFromImages: [...new Set(mergedImages)]
            }
          };
        }
        return t;
      });
  }
}

/**
 * Extended duplicate check result for multi-image deduplication
 */
export interface MultiImageDuplicateCheck {
  transactionId: string;
  isDuplicate: boolean;
  keepTransactionId?: string;
  confidence: number;
  reason: 'position_overlap' | 'exact_match' | 'amount_match';
  imageIndices: number[];
}
