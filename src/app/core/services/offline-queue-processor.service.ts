import { Injectable, inject, OnDestroy } from '@angular/core';
import { OfflineQueueService, QueuedTransaction } from './offline-queue.service';
import { AIStrategyService } from './ai-strategy.service';
import { TransactionService } from './transaction.service';
import { CreateTransactionDTO } from '../../models/transaction.model';

/**
 * Coordinates the asynchronous side of the offline queue.
 *
 * OfflineQueueService.syncQueue() marks queued items as `processing` and
 * dispatches `process-queued-image` / `sync-queued-transaction` events, but it
 * cannot await the actual work. This service listens for those events, performs
 * the real processing (AI for images, Firestore persistence for transactions),
 * and updates each item's queue status from the real outcome — only marking an
 * item `completed` after success, and `failed` (which increments its retry
 * count) on error.
 *
 * It is instantiated eagerly at startup (via provideAppInitializer in
 * app.config.ts) so its listeners are attached before any sync fires.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueProcessorService implements OnDestroy {
  private queue = inject(OfflineQueueService);
  private aiStrategy = inject(AIStrategyService);
  private transactionService = inject(TransactionService);

  private imageHandler = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    void this.processQueuedImage(id);
  };

  private transactionHandler = (event: Event): void => {
    const { transaction } = (event as CustomEvent<{ transaction: QueuedTransaction }>).detail;
    void this.syncQueuedTransaction(transaction);
  };

  constructor() {
    window.addEventListener('process-queued-image', this.imageHandler);
    window.addEventListener('sync-queued-transaction', this.transactionHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('process-queued-image', this.imageHandler);
    window.removeEventListener('sync-queued-transaction', this.transactionHandler);
  }

  /**
   * Run a queued receipt image through the AI strategy and record the outcome.
   */
  private async processQueuedImage(id: string): Promise<void> {
    try {
      const file = await this.queue.getQueuedImageAsFile(id);
      if (!file) {
        await this.queue.updateImageStatus(id, 'failed', 'Image not found in queue');
        return;
      }

      await this.aiStrategy.processReceipt(file);
      await this.queue.updateImageStatus(id, 'completed');
    } catch (error) {
      await this.queue.updateImageStatus(id, 'failed', this.errorMessage(error));
    }
  }

  /**
   * Persist a queued transaction to Firestore and record the outcome.
   */
  private async syncQueuedTransaction(tx: QueuedTransaction): Promise<void> {
    try {
      const dto: CreateTransactionDTO = {
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        categoryId: tx.categoryId,
        description: tx.description,
        date: new Date(tx.date),
      };

      await this.transactionService.addTransaction(dto);
      await this.queue.updateTransactionStatus(tx.id, 'completed');
    } catch (error) {
      await this.queue.updateTransactionStatus(tx.id, 'failed', this.errorMessage(error));
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
