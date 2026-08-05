import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { OfflineQueueProcessorService } from './offline-queue-processor.service';
import { OfflineQueueService, QueuedImage } from './offline-queue.service';
import { AuthService } from './auth.service';
import { AIStrategyService } from './ai-strategy.service';
import { TransactionService } from './transaction.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { ProcessedTransaction, ProcessingResult } from './ai-types';

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

function extracted(overrides: Partial<ProcessedTransaction> = {}): ProcessedTransaction {
  return {
    date: new Date('2026-06-15T00:00:00Z'),
    description: 'Konbini',
    amount: 880,
    type: 'expense',
    currency: 'JPY',
    confidence: 0.9,
    source: 'cloud',
    ...overrides,
  };
}

function processingResult(transactions: ProcessedTransaction[]): ProcessingResult {
  return {
    transactions,
    source: 'cloud',
    confidence: 1,
    processingTimeMs: 1,
  };
}

describe('OfflineQueueProcessorService', () => {
  let processor: OfflineQueueProcessorService;
  let queue: jasmine.SpyObj<OfflineQueueService>;
  let ai: jasmine.SpyObj<AIStrategyService>;
  let transactions: jasmine.SpyObj<TransactionService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let userId: WritableSignal<string | null>;

  beforeEach(() => {
    queue = jasmine.createSpyObj<OfflineQueueService>('OfflineQueueService', [
      'getQueuedImageAsFile',
      'peekQueuedImage',
      'updateImageStatus',
    ]);
    queue.updateImageStatus.and.resolveTo();
    queue.peekQueuedImage.and.resolveTo(undefined);

    userId = signal<string | null>('user-a');

    ai = jasmine.createSpyObj<AIStrategyService>('AIStrategyService', ['processReceipt']);
    transactions = jasmine.createSpyObj<TransactionService>('TransactionService', [
      'addTransaction',
      'hasTransaction',
    ]);
    transactions.addTransaction.and.resolveTo('new-id');
    // Nothing has landed yet unless a spec says otherwise.
    transactions.hasTransaction.and.resolveTo(false);
    notifications = jasmine.createSpyObj<NotificationService>('NotificationService', [
      'success',
      'error',
      'info',
    ]);
    translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    TestBed.configureTestingModule({
      providers: [
        OfflineQueueProcessorService,
        { provide: OfflineQueueService, useValue: queue },
        { provide: AIStrategyService, useValue: ai },
        { provide: TransactionService, useValue: transactions },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: translation },
        { provide: AuthService, useValue: { userId } },
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

  describe('process-queued-image', () => {
    it('writes what the AI read to the ledger and marks the image completed', async () => {
      const file = imageFile();
      queue.getQueuedImageAsFile.and.resolveTo(file);
      ai.processReceipt.and.resolveTo(
        processingResult([extracted({ notes: 'Onigiri — JPY 180', suggestedCategoryId: 'food' })]),
      );

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(ai.processReceipt).toHaveBeenCalledWith(file);
      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'expense',
          amount: 880,
          currency: 'JPY',
          categoryId: 'food',
          description: 'Konbini',
          note: 'Onigiri — JPY 180',
        }),
        { id: 'img_1-0' },
      );
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'completed');
    });

    it('writes each row at an id derived from the queue row and its position', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(
        processingResult([extracted(), extracted({ description: 'Kiosk', amount: 320 })]),
      );

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      // The queue row id plus the row's position in what the model read. Both
      // halves are stable across a reclaim, so a replay of this receipt aims
      // at the documents the first pass wrote rather than at fresh ones.
      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.objectContaining({ description: 'Konbini' }),
        { id: 'img_1-0' },
      );
      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.objectContaining({ description: 'Kiosk' }),
        { id: 'img_1-1' },
      );
    });

    it('skips a row that already landed instead of posting it twice', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(
        processingResult([extracted(), extracted({ description: 'Kiosk', amount: 320 })]),
      );
      // The first row was written before the crash; the second was not.
      transactions.hasTransaction.and.callFake((id: string) =>
        Promise.resolve(id === 'img_1-0'),
      );

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction).toHaveBeenCalledTimes(1);
      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.objectContaining({ description: 'Kiosk' }),
        { id: 'img_1-1' },
      );
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'completed');
      // Two rows came off this receipt; one of them simply did not need
      // writing again. The count is what the receipt produced, not what this
      // pass happened to write.
      expect(translation.t).toHaveBeenCalledWith('settings.transactionsImported', { count: 2 });
    });

    it('completes without a second write when every row already landed', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(
        processingResult([extracted(), extracted({ description: 'Kiosk', amount: 320 })]),
      );
      // The crash landed between the last ledger write and the status flip.
      transactions.hasTransaction.and.resolveTo(true);

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction).not.toHaveBeenCalled();
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'completed');
      expect(translation.t).toHaveBeenCalledWith('settings.transactionsImported', { count: 2 });
    });

    it('tells the user how many transactions the queued receipt produced', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(
        processingResult([extracted(), extracted({ description: 'Kiosk', amount: 320 })]),
      );

      dispatchImage('img_1');
      await waitFor(() => notifications.success.calls.any());

      expect(transactions.addTransaction).toHaveBeenCalledTimes(2);
      expect(translation.t).toHaveBeenCalledWith('settings.transactionsImported', { count: 2 });
      expect(notifications.success).toHaveBeenCalledWith('settings.transactionsImported');
    });

    it('falls back to the catch-all category when the model suggested none', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(processingResult([extracted({ suggestedCategoryId: undefined })]));

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction.calls.mostRecent().args[0].categoryId).toBe('other_expense');
    });

    it('marks the image failed when the AI read nothing off it', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(processingResult([]));

      dispatchImage('img_4');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction).not.toHaveBeenCalled();
      expect(queue.updateImageStatus).toHaveBeenCalledWith(
        'img_4',
        'failed',
        'No transaction could be read from this receipt',
      );
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('marks the image failed when none of the extracted rows could be written', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(processingResult([extracted()]));
      transactions.addTransaction.and.rejectWith(new Error('INVALID_TRANSACTION_AMOUNT'));

      dispatchImage('img_5');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(queue.updateImageStatus).toHaveBeenCalledWith(
        'img_5',
        'failed',
        'INVALID_TRANSACTION_AMOUNT',
      );
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('fails a partial batch so the queue can retry the rows that did not land', async () => {
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(
        processingResult([extracted(), extracted({ description: 'Kiosk' })]),
      );
      let call = 0;
      transactions.addTransaction.and.callFake(() =>
        ++call === 1 ? Promise.resolve('new-id') : Promise.reject(new Error('Firestore down')),
      );

      dispatchImage('img_6');
      await waitFor(() => queue.updateImageStatus.calls.any());

      // Completing here used to be the lesser evil: a retry re-ran the whole
      // image and duplicated the row that had landed, so half a receipt was
      // better than a doubled one. Now the retry skips what landed and writes
      // only the remainder, so failing is simply correct — and the user is
      // told nothing succeeded until it actually has.
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_6', 'failed', 'Firestore down');
      expect(notifications.success).not.toHaveBeenCalled();
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


  describe('account ownership', () => {
    function queuedImage(overrides: Partial<QueuedImage> = {}): QueuedImage {
      return {
        id: 'img_1',
        userId: 'user-a',
        fileName: 'r.jpg',
        mimeType: 'image/jpeg',
        size: 3,
        data: new Uint8Array([1, 2, 3]).buffer,
        createdAt: Date.now(),
        status: 'processing',
        retryCount: 0,
        ...overrides,
      };
    }

    // The regression. addTransaction resolves the account at call time, so a
    // sync that fires after a different user signs in wrote account A's
    // receipt straight into account B's ledger.
    it('does not write a queued image belonging to another account', async () => {
      queue.peekQueuedImage.and.resolveTo(queuedImage({ userId: 'user-a' }));
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      userId.set('user-b');

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction).not.toHaveBeenCalled();
      expect(ai.processReceipt).not.toHaveBeenCalled();
      // Pending, not failed — it belongs to A and is still perfectly good.
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'pending');
    });

    it('processes a queued image for the account that captured it', async () => {
      queue.peekQueuedImage.and.resolveTo(queuedImage({ userId: 'user-a' }));
      queue.getQueuedImageAsFile.and.resolveTo(imageFile());
      ai.processReceipt.and.resolveTo(processingResult([extracted()]));
      userId.set('user-a');

      dispatchImage('img_1');
      await waitFor(() => queue.updateImageStatus.calls.any());

      expect(transactions.addTransaction).toHaveBeenCalled();
      expect(queue.updateImageStatus).toHaveBeenCalledWith('img_1', 'completed');
    });


  });
});
