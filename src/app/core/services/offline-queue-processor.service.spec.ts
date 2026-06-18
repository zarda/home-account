import { TestBed } from '@angular/core/testing';
import { OfflineQueueProcessorService } from './offline-queue-processor.service';
import { OfflineQueueService, QueuedTransaction } from './offline-queue.service';
import { AIStrategyService } from './ai-strategy.service';
import { TransactionService } from './transaction.service';
import { ProcessingResult } from './ai-types';

async function waitFor(pred: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function imageFile(name = 'r.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

function queuedTransaction(overrides: Partial<QueuedTransaction> = {}): QueuedTransaction {
  return {
    id: 'tx_1',
    date: '2026-06-15',
    description: 'Coffee',
    amount: 4,
    type: 'expense',
    currency: 'USD',
    categoryId: 'food',
    source: 'local',
    createdAt: Date.now(),
    status: 'processing',
    retryCount: 0,
    ...overrides,
  };
}

const processingResult: ProcessingResult = {
  transactions: [],
  source: 'cloud',
  confidence: 1,
  processingTimeMs: 1,
};

describe('OfflineQueueProcessorService', () => {
  let processor: OfflineQueueProcessorService;
  let queue: jasmine.SpyObj<OfflineQueueService>;
  let ai: jasmine.SpyObj<AIStrategyService>;
  let transactions: jasmine.SpyObj<TransactionService>;

  beforeEach(() => {
    queue = jasmine.createSpyObj<OfflineQueueService>('OfflineQueueService', [
      'getQueuedImageAsFile',
      'updateImageStatus',
      'updateTransactionStatus',
    ]);
    queue.updateImageStatus.and.resolveTo();
    queue.updateTransactionStatus.and.resolveTo();

    ai = jasmine.createSpyObj<AIStrategyService>('AIStrategyService', ['processReceipt']);
    transactions = jasmine.createSpyObj<TransactionService>('TransactionService', ['addTransaction']);

    TestBed.configureTestingModule({
      providers: [
        OfflineQueueProcessorService,
        { provide: OfflineQueueService, useValue: queue },
        { provide: AIStrategyService, useValue: ai },
        { provide: TransactionService, useValue: transactions },
      ],
    });
    processor = TestBed.inject(OfflineQueueProcessorService);
  });

  afterEach(() => {
    // Detach the window listeners so they don't leak into other specs.
    processor.ngOnDestroy();
  });

  function dispatchImage(id: string): void {
    window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id } }));
  }

  function dispatchTransaction(tx: QueuedTransaction): void {
    window.dispatchEvent(new CustomEvent('sync-queued-transaction', { detail: { transaction: tx } }));
  }

  describe('process-queued-image', () => {
    it('runs the image through the AI strategy and marks it completed on success', async () => {
      const file = imageFile();
      queue.getQueuedImageAsFile.and.resolveTo(file);
      ai.processReceipt.and.resolveTo(processingResult);

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(ai.processReceipt).toHaveBeenCalledWith(file);
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'completed');
    });

    it('marks the image failed (with the error) when AI processing throws', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.rejectWith(new Error('AI unavailable'));

      dispatchImage('img_2');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_2', 'failed', 'AI unavailable');
    });

    it('marks the image failed and skips AI when the file is missing', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(null);

      dispatchImage('img_3');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(ai.processReceipt).not.toHaveBeenCalled();
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_3', 'failed', 'Image not found in queue');
    });
  });

  describe('sync-queued-transaction', () => {
    it('persists the transaction and marks it completed on success', async () => {
      transactions.addTransaction.and.resolveTo('new-id');

      dispatchTransaction(queuedTransaction({ id: 'tx_1' }));
      await waitFor(() => queue.updateTransactionStatus.calls.any());

      const dto = transactions.addTransaction.calls.mostRecent().args[0];
      expect(dto).toEqual(
        jasmine.objectContaining({
          type: 'expense',
          amount: 4,
          currency: 'USD',
          categoryId: 'food',
          description: 'Coffee',
        }),
      );
      expect(dto.date instanceof Date).toBeTrue();
      expect(queue.updateTransactionStatus).toHaveBeenCalledWith('tx_1', 'completed');
    });

    it('marks the transaction failed (with the error) when the write throws', async () => {
      transactions.addTransaction.and.rejectWith(new Error('Firestore down'));

      dispatchTransaction(queuedTransaction({ id: 'tx_2' }));
      await waitFor(() => queue.updateTransactionStatus.calls.any());

      expect(queue.updateTransactionStatus).toHaveBeenCalledWith('tx_2', 'failed', 'Firestore down');
    });
  });
});
