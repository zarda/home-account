import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { TransactionService } from './transaction.service';
import { createTransaction } from './testing/test-data';
import {
  CategorizedImportTransaction,
  DuplicateCheck,
  Transaction
} from '../../models';

describe('DuplicateDetectionService', () => {
  let service: DuplicateDetectionService;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;

  const importTxn = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
    id: 'import-1',
    description: 'Coffee Shop',
    amount: 5,
    currency: 'USD',
    date: new Date(2024, 5, 15),
    type: 'expense',
    suggestedCategoryId: 'food',
    categoryConfidence: 0.9,
    isDuplicate: false,
    selected: true,
    ...overrides
  });

  const existing = (overrides: Partial<Transaction> = {}): Transaction =>
    createTransaction({
      type: 'expense',
      amount: 5,
      description: 'Coffee Shop',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
      ...overrides
    });

  beforeEach(() => {
    mockTransactionService = jasmine.createSpyObj('TransactionService', ['getTransactions']);
    mockTransactionService.getTransactions.and.returnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        DuplicateDetectionService,
        { provide: TransactionService, useValue: mockTransactionService }
      ]
    });

    service = TestBed.inject(DuplicateDetectionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('checkDuplicates', () => {
    it('should return an empty array for empty input', async () => {
      const result = await service.checkDuplicates([]);
      expect(result).toEqual([]);
      expect(mockTransactionService.getTransactions).not.toHaveBeenCalled();
    });

    it('should query existing transactions within a padded date range', async () => {
      await service.checkDuplicates([importTxn({ date: new Date(2024, 5, 15) })]);

      const filters = mockTransactionService.getTransactions.calls.mostRecent().args[0] as {
        startDate: Date;
        endDate: Date;
      };
      // Range is min-2 days .. max+2 days
      expect(filters.startDate.getTime()).toBeLessThan(new Date(2024, 5, 15).getTime());
      expect(filters.endDate.getTime()).toBeGreaterThan(new Date(2024, 5, 15).getTime());
    });

    it('should mark everything as not-duplicate when there are no existing transactions', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([]));

      const result = await service.checkDuplicates([
        importTxn({ id: 'a' }),
        importTxn({ id: 'b', amount: 99 })
      ]);

      expect(result.length).toBe(2);
      expect(result.every(r => !r.isDuplicate)).toBeTrue();
      expect(result.every(r => r.matchType === 'none')).toBeTrue();
      expect(result.map(r => r.transactionId)).toEqual(['a', 'b']);
    });

    it('should detect an exact duplicate (same day, amount and similar description)', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-1' })
      ]));

      const [result] = await service.checkDuplicates([importTxn({ id: 'imp' })]);

      expect(result.isDuplicate).toBeTrue();
      expect(result.matchType).toBe('exact');
      expect(result.existingTransactionId).toBe('existing-1');
      expect(result.confidence).toBe(1.0);
    });

    it('should treat an existing transaction with a Date (not Timestamp) date field', async () => {
      const withDate = existing({ id: 'existing-date' });
      (withDate as unknown as { date: Date }).date = new Date(2024, 5, 15);
      mockTransactionService.getTransactions.and.returnValue(of([withDate]));

      const [result] = await service.checkDuplicates([importTxn()]);

      expect(result.isDuplicate).toBeTrue();
      expect(result.matchType).toBe('exact');
    });

    it('should detect a likely duplicate (same day + amount + type, different description)', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-2', description: 'Completely Unrelated Vendor' })
      ]));

      const [result] = await service.checkDuplicates([
        importTxn({ id: 'imp', description: 'Zzz Different Name' })
      ]);

      expect(result.isDuplicate).toBeTrue();
      expect(result.matchType).toBe('likely');
      expect(result.existingTransactionId).toBe('existing-2');
      expect(result.confidence).toBe(0.8);
    });

    it('should detect a possible duplicate (adjacent day + amount + type)', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({
          id: 'existing-3',
          description: 'Another Vendor Entirely',
          date: Timestamp.fromDate(new Date(2024, 5, 16))
        })
      ]));

      const [result] = await service.checkDuplicates([
        importTxn({ id: 'imp', description: 'Mismatch Name Xyz', date: new Date(2024, 5, 15) })
      ]);

      expect(result.isDuplicate).toBeTrue();
      expect(result.matchType).toBe('possible');
      expect(result.existingTransactionId).toBe('existing-3');
      expect(result.confidence).toBe(0.5);
    });

    it('should not flag a duplicate when amounts differ', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-4', amount: 999 })
      ]));

      const [result] = await service.checkDuplicates([importTxn({ id: 'imp', amount: 5 })]);

      expect(result.isDuplicate).toBeFalse();
      expect(result.matchType).toBe('none');
    });

    it('should not flag a likely/possible duplicate when the type differs', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-5', type: 'income', description: 'Unrelated Vendor Name' })
      ]));

      const [result] = await service.checkDuplicates([
        importTxn({ id: 'imp', type: 'expense', description: 'Different Vendor Name Q' })
      ]);

      expect(result.isDuplicate).toBeFalse();
      expect(result.matchType).toBe('none');
    });

    it('should match descriptions that are substrings of each other', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-6', description: 'Starbucks Coffee Downtown Location' })
      ]));

      const [result] = await service.checkDuplicates([
        importTxn({ id: 'imp', description: 'Starbucks' })
      ]);

      expect(result.isDuplicate).toBeTrue();
      expect(result.matchType).toBe('exact');
    });

    it('should process multiple import transactions and return one result each', async () => {
      mockTransactionService.getTransactions.and.returnValue(of([
        existing({ id: 'existing-7' })
      ]));

      const results = await service.checkDuplicates([
        importTxn({ id: 'dup', description: 'Coffee Shop' }),
        importTxn({ id: 'unique', amount: 12345, description: 'No Match Here' })
      ]);

      expect(results.length).toBe(2);
      const dup = results.find(r => r.transactionId === 'dup');
      const unique = results.find(r => r.transactionId === 'unique');
      expect(dup?.isDuplicate).toBeTrue();
      expect(unique?.isDuplicate).toBeFalse();
    });
  });

  describe('markDuplicates', () => {
    it('should flag and deselect transactions marked as duplicates', () => {
      const txns = [
        importTxn({ id: 'a' }),
        importTxn({ id: 'b' })
      ];
      const checks: DuplicateCheck[] = [
        { transactionId: 'a', isDuplicate: true, matchType: 'exact', existingTransactionId: 'ex-a', confidence: 1 },
        { transactionId: 'b', isDuplicate: false, matchType: 'none', confidence: 0 }
      ];

      const result = service.markDuplicates(txns, checks);

      const a = result.find(t => t.id === 'a')!;
      const b = result.find(t => t.id === 'b')!;
      expect(a.isDuplicate).toBeTrue();
      expect(a.duplicateOf).toBe('ex-a');
      expect(a.selected).toBeFalse();
      expect(b.isDuplicate).toBeFalse();
      expect(b.selected).toBeTrue();
    });

    it('should leave transactions untouched when no matching check exists', () => {
      const txns = [importTxn({ id: 'a', selected: true })];

      const result = service.markDuplicates(txns, []);

      expect(result[0].selected).toBeTrue();
      expect(result[0].isDuplicate).toBeFalse();
    });

    it('should return an empty array for empty input', () => {
      expect(service.markDuplicates([], [])).toEqual([]);
    });
  });

  describe('checkMultiImageDuplicates', () => {
    const withMeta = (
      id: string,
      imageIndex: number,
      positionInImage: 'top' | 'middle' | 'bottom',
      confidenceScore: number,
      overrides: Partial<CategorizedImportTransaction> = {}
    ): CategorizedImportTransaction =>
      importTxn({
        id,
        imageMetadata: {
          imageIndex,
          imageId: `image_${imageIndex}`,
          positionInImage,
          confidenceScore
        },
        ...overrides
      });

    it('should return empty results when no transactions carry image metadata', () => {
      const result = service.checkMultiImageDuplicates([importTxn({ id: 'a' })]);
      expect(result).toEqual([]);
    });

    it('should detect an overlap-zone duplicate across consecutive images', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'bottom', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.6, { description: 'Sandwich', amount: 8 })
      ]);

      expect(result.length).toBe(1);
      expect(result[0].isDuplicate).toBeTrue();
      expect(result[0].reason).toBe('position_overlap');
      // Higher-confidence item (first) is kept, lower one removed.
      expect(result[0].keepTransactionId).toBe('first');
      expect(result[0].transactionId).toBe('second');
      expect(result[0].imageIndices).toEqual([0, 1]);
      expect(result[0].confidence).toBe(0.6);
    });

    it('should keep the later item when it has higher confidence', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'bottom', 0.4, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.95, { description: 'Sandwich', amount: 8 })
      ]);

      expect(result.length).toBe(1);
      expect(result[0].keepTransactionId).toBe('second');
      expect(result[0].transactionId).toBe('first');
    });

    it('should ignore items from non-consecutive images', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'bottom', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('third', 2, 'top', 0.6, { description: 'Sandwich', amount: 8 })
      ]);

      expect(result).toEqual([]);
    });

    it('should ignore items that are not in the overlap zone', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'top', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.6, { description: 'Sandwich', amount: 8 })
      ]);

      expect(result).toEqual([]);
    });

    it('should not flag overlap items whose descriptions differ', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'bottom', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.6, { description: 'Coffee Mug Large', amount: 8 })
      ]);

      expect(result).toEqual([]);
    });

    it('should not flag overlap items whose amounts differ', () => {
      const result = service.checkMultiImageDuplicates([
        withMeta('first', 0, 'bottom', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.6, { description: 'Sandwich', amount: 50 })
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('applyMultiImageDeduplication', () => {
    const withMeta = (
      id: string,
      imageIndex: number,
      positionInImage: 'top' | 'middle' | 'bottom',
      confidenceScore: number,
      overrides: Partial<CategorizedImportTransaction> = {}
    ): CategorizedImportTransaction =>
      importTxn({
        id,
        imageMetadata: {
          imageIndex,
          imageId: `image_${imageIndex}`,
          positionInImage,
          confidenceScore
        },
        ...overrides
      });

    it('should return all transactions unchanged when there are no duplicates', () => {
      const txns = [
        importTxn({ id: 'a' }),
        importTxn({ id: 'b', amount: 20, description: 'Other' })
      ];

      const result = service.applyMultiImageDeduplication(txns);

      expect(result.length).toBe(2);
      expect(result.map(t => t.id)).toEqual(['a', 'b']);
    });

    it('should drop the duplicate and annotate the kept transaction with merged images', () => {
      const txns = [
        withMeta('first', 0, 'bottom', 0.9, { description: 'Sandwich', amount: 8 }),
        withMeta('second', 1, 'top', 0.6, { description: 'Sandwich', amount: 8 })
      ];

      const result = service.applyMultiImageDeduplication(txns);

      expect(result.length).toBe(1);
      const kept = result[0];
      expect(kept.id).toBe('first');
      expect(kept.imageMetadata?.wasMerged).toBeTrue();
      const merged = (kept.imageMetadata as { mergedFromImages?: number[] }).mergedFromImages;
      expect(merged).toEqual([0, 1]);
    });

    it('should return an empty array for empty input', () => {
      expect(service.applyMultiImageDeduplication([])).toEqual([]);
    });
  });
});
