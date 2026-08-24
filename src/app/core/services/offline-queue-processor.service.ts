import { Injectable, inject, OnDestroy } from '@angular/core';
import { OfflineQueueService } from './offline-queue.service';
import { AIStrategyService } from './ai-strategy.service';
import { TransactionService } from './transaction.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { AuthService } from './auth.service';
import { ReceiptAttemptService } from './receipt-attempt.service';
import { ProcessedTransaction } from './ai-types';
import { toCreateTransactionDTO } from '../utils/import-dto.utils';
import { baseCurrencyOf } from '../../models';

/**
 * Coordinates the asynchronous side of the offline queue.
 *
 * OfflineQueueService.syncQueue() marks queued items as `processing` and
 * dispatches a `process-queued-image` event, but it cannot await the actual
 * work. This service listens and does it: a queued image goes through the AI
 * strategy and the rows it yields are written to the ledger. The item's queue
 * status then comes from the real outcome — `completed` only once every row it
 * produced is in the ledger, and `failed` (which increments its retry count)
 * otherwise. Draining is replayable: the same image processed twice writes its
 * rows once, so an item reclaimed after a crash can simply be run again.
 *
 * It is instantiated eagerly at startup (via provideAppInitializer in
 * app.config.ts) so its listener is attached before any sync fires.
 *
 * Rows are written through toCreateTransactionDTO, so what the reader filled
 * is what lands.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueProcessorService implements OnDestroy {
  private queue = inject(OfflineQueueService);
  private aiStrategy = inject(AIStrategyService);
  private transactionService = inject(TransactionService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);
  private authService = inject(AuthService);
  private receiptAttempts = inject(ReceiptAttemptService);

  private imageHandler = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    void this.processQueuedImage(id);
  };

  constructor() {
    window.addEventListener('process-queued-image', this.imageHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('process-queued-image', this.imageHandler);
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
      // Ownership is re-checked here, not just at dispatch. TransactionService
      // resolves the account at call time, so a sync that fires while a
      // different account is signed in would write this receipt into their
      // ledger. Left 'pending' rather than 'failed': it is a perfectly good
      // item waiting for its own account, and failing it would burn one of the
      // three retries for something that is not its fault.
      const queued = await this.queue.peekQueuedImage(id);
      if (queued && queued.userId !== this.authService.userId()) {
        await this.queue.updateImageStatus(id, 'pending');
        return;
      }

      const file = await this.queue.getQueuedImageAsFile(id);
      if (!file) {
        await this.queue.updateImageStatus(id, 'failed', 'Image not found in queue');
        return;
      }

      // Door 'queue': the attempt record is written, no event is sent — the
      // capture already sent queued_offline (docs/analytics.md).
      const attempt = this.receiptAttempts.begin('queue', 'receipt_image', [file]);
      try {
        const result = await this.aiStrategy.processReceipt(file);
        if (result.transactions.length === 0) {
          // Deliberately not 'completed': the photo produced nothing, and
          // completing it would drop the receipt and say so nowhere. Failing
          // keeps the image in the queue for the retries the queue already
          // bounds, and leaves it in the failed count once they run out.
          attempt.failed('nothing_extracted');
          await this.queue.updateImageStatus(id, 'failed', 'No transaction could be read from this receipt');
          return;
        }

        const landed = await this.createTransactions(id, result.transactions);
        attempt.succeeded(result);
        await this.queue.updateImageStatus(id, 'completed');
        this.notifications.success(
          this.translation.t('settings.transactionsImported', { count: landed }),
        );
      } catch (error) {
        attempt.failed(error);
        throw error;
      }
    } catch (error) {
      await this.queue.updateImageStatus(id, 'failed', this.errorMessage(error));
    }
  }

  /**
   * Write the rows read off a queued receipt to the ledger, at most once each.
   *
   * Every row is written at `${queue row id}-${its position}` rather than at a
   * fresh auto-id. Both halves survive a crash — the row id is the key the
   * image is stored under, the position is where the row sat in what the model
   * read — so a receipt that is reclaimed and drained again aims at exactly
   * the documents the first pass wrote. Each id is checked before it is used
   * and an existing document is left alone: overwriting would be idempotent in
   * the ledger's shape but not in its content, since the write is a full
   * replace that would reset `createdAt` and discard any edit the user made to
   * the row in between.
   *
   * A row that could not be written fails the whole image, which sends it back
   * through the queue's bounded retries. That used to be the wrong call — a
   * retry re-ran the image from the top and duplicated whatever had already
   * landed, so a partial batch was reported as done and the missing rows were
   * quietly dropped. With the skip above, the retry writes only the remainder.
   *
   * The count returned includes the rows that were skipped: it is what the
   * receipt produced, which is what the user is told about, not a tally of
   * this particular pass's writes.
   */
  private async createTransactions(
    id: string,
    transactions: ProcessedTransaction[],
  ): Promise<number> {
    let landed = 0;
    let anyFailed = false;
    let firstError: unknown;

    for (const [index, tx] of transactions.entries()) {
      const rowTxId = `${id}-${index}`;
      try {
        if (await this.transactionService.hasTransaction(rowTxId)) {
          // An interrupted earlier drain already posted this one.
          landed++;
          continue;
        }

        // The same mapper every other import door writes through (ADR 0059):
        // the row's renames only, and every optional the reader filled
        // travels without this door naming it. The photo is the one thing
        // that still does not travel from here — a follow-up.
        await this.transactionService.addTransaction(
          toCreateTransactionDTO({
            ...tx,
            categoryId: tx.suggestedCategoryId,
            note: tx.notes,
          }, baseCurrencyOf(this.authService.currentUser())),
          { id: rowTxId },
        );
        landed++;
      } catch (error) {
        anyFailed = true;
        firstError ??= error;
      }
    }

    if (anyFailed) {
      throw firstError instanceof Error ? firstError : new Error(this.errorMessage(firstError));
    }

    return landed;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
