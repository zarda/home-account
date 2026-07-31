import { Injectable, inject, OnDestroy } from '@angular/core';
import { OfflineQueueService, QueuedTransaction } from './offline-queue.service';
import { AIStrategyService } from './ai-strategy.service';
import { TransactionService } from './transaction.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { ProcessedTransaction } from './ai-types';
import { FALLBACK_CATEGORY_ID } from '../utils/categorization.utils';
import { CreateTransactionDTO } from '../../models/transaction.model';

/**
 * Coordinates the asynchronous side of the offline queue.
 *
 * OfflineQueueService.syncQueue() marks queued items as `processing` and
 * dispatches `process-queued-image` / `sync-queued-transaction` events, but it
 * cannot await the actual work. This service listens for those events and does
 * it: a queued image goes through the AI strategy and the rows it yields are
 * written to the ledger, a queued transaction is persisted straight to
 * Firestore. Each item's queue status then comes from the real outcome — only
 * `completed` after something was actually saved, and `failed` (which
 * increments its retry count) otherwise.
 *
 * It is instantiated eagerly at startup (via provideAppInitializer in
 * app.config.ts) so its listeners are attached before any sync fires.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueProcessorService implements OnDestroy {
  private queue = inject(OfflineQueueService);
  private aiStrategy = inject(AIStrategyService);
  private transactionService = inject(TransactionService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

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
   *
   * What the model read is written straight to the ledger instead of being
   * parked for review: this runs unattended — a reconnect or a background-sync
   * wake-up, with no camera dialog open and possibly no one looking — so there
   * is nothing to route a review through, and a receipt held back for one would
   * sit unread until the user happened to go looking. The snackbar is how they
   * find out, and the rows are editable like any other.
   */
  private async processQueuedImage(id: string): Promise<void> {
    try {
      const file = await this.queue.getQueuedImageAsFile(id);
      if (!file) {
        await this.queue.updateImageStatus(id, 'failed', 'Image not found in queue');
        return;
      }

      const result = await this.aiStrategy.processReceipt(file);
      if (result.transactions.length === 0) {
        // Deliberately not 'completed': the photo produced nothing, and
        // completing it would drop the receipt and say so nowhere. Failing
        // keeps the image in the queue for the retries the queue already
        // bounds, and leaves it in the failed count once they run out.
        await this.queue.updateImageStatus(id, 'failed', 'No transaction could be read from this receipt');
        return;
      }

      const created = await this.createTransactions(result.transactions);
      await this.queue.updateImageStatus(id, 'completed');
      this.notifications.success(
        this.translation.t('settings.transactionsImported', { count: created }),
      );
    } catch (error) {
      await this.queue.updateImageStatus(id, 'failed', this.errorMessage(error));
    }
  }

  /**
   * Write the rows read off a queued receipt to the ledger.
   *
   * Rejects rather than returning zero when none of them could be written, so
   * the caller marks the image `failed` and the queue retries it instead of
   * losing the receipt. A partial batch still counts as done — a retry would
   * re-run the whole image and duplicate the rows that did land.
   */
  private async createTransactions(transactions: ProcessedTransaction[]): Promise<number> {
    let created = 0;
    let firstError: unknown;

    for (const tx of transactions) {
      try {
        await this.transactionService.addTransaction({
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          // Same fallback the review table applies to an unlabelled row.
          categoryId: tx.suggestedCategoryId || FALLBACK_CATEGORY_ID,
          description: tx.description,
          date: tx.date,
          note: tx.notes,
        });
        created++;
      } catch (error) {
        firstError ??= error;
      }
    }

    if (created === 0) {
      throw firstError instanceof Error ? firstError : new Error(this.errorMessage(firstError));
    }

    return created;
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
