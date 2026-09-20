import { Injectable, inject, OnDestroy } from '@angular/core';
import { OfflineQueueService } from './offline-queue.service';
import { AIStrategyService } from './ai-strategy.service';
import {
  INVALID_AMOUNT_ERROR,
  RECEIPT_ATTACH_FAILED,
  RECEIPT_IMAGE_LIMIT_ERROR,
  TransactionService,
} from './transaction.service';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';
import { AuthService } from './auth.service';
import { ReceiptAttemptService } from './receipt-attempt.service';
import { ProcessedTransaction } from './ai-types';
import { imageMetadataOf, resolveImportDate, toCreateTransactionDTO } from '../utils/import-dto.utils';
import { planReceiptAttachments } from '../utils/receipt-attachment.utils';
import { baseCurrencyOf, ImagePositionMetadata } from '../../models';

/**
 * Coordinates the asynchronous side of the offline queue.
 *
 * OfflineQueueService.syncQueue() marks queued items as `processing` and
 * dispatches a `process-queued-image` event, but it cannot await the actual
 * work. This service listens and does it: a queued image goes through the AI
 * strategy and the rows it yields are written to the ledger. The item's queue
 * status then comes from the real outcome — `completed` once every row that
 * can ever land is in the ledger, and `failed` (which increments its retry
 * count) while anything is still worth another attempt. Draining is
 * replayable: the same image processed twice writes its rows once, so an item
 * reclaimed after a crash can simply be run again.
 *
 * It is instantiated eagerly at startup (via provideAppInitializer in
 * app.config.ts) so its listener is attached before any sync fires.
 *
 * Rows are written through toCreateTransactionDTO, so what the reader filled
 * is what lands. A date the reader doubted is resolved to drain time the same
 * way the review lanes resolve theirs, but the confidence mark that decision
 * leaves behind is dropped here — there is no review surface on this door to
 * show it to.
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
        this.warnIfDropped(id, await this.queue.updateImageStatus(id, 'failed', 'Image not found in queue'));
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
          this.warnIfDropped(id, await this.queue.updateImageStatus(id, 'failed', 'No transaction could be read from this receipt'));
          return;
        }

        const { landed, refused, receiptsSkipped } = await this.createTransactions(
          id,
          result.transactions,
          file,
        );
        attempt.succeeded(result);
        this.warnIfDropped(id, await this.queue.updateImageStatus(id, 'completed'));
        // One snackbar either way: this fires unattended, and a second toast
        // for the losses would arrive with nothing to click and no idea which
        // receipt it belonged to. A row the ledger refused and a photo it
        // refused are both "did not land", which is all the count can say.
        const skipped = refused + receiptsSkipped;
        if (skipped > 0) {
          this.notifications.info(
            this.translation.t('settings.transactionsImportedPartial', { count: landed, skipped }),
          );
        } else {
          this.notifications.success(
            this.translation.t('settings.transactionsImported', { count: landed }),
          );
        }
      } catch (error) {
        attempt.failed(error);
        throw error;
      }
    } catch (error) {
      this.warnIfDropped(id, await this.queue.updateImageStatus(id, 'failed', this.errorMessage(error)));
    }
  }

  /** A `completed`/`failed` write the closed queue dropped still needs saying. */
  private warnIfDropped(id: string, recorded: boolean): void {
    if (!recorded) {
      console.warn('[OfflineQueueProcessor] Outcome not recorded; the queue is closed', id);
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
   * A row that could not be written is sorted by whether another pass could
   * ever change the answer. A transient failure — the network, a contended
   * write — fails the whole image, which sends it back through the queue's
   * bounded retries; the skip above means that retry writes only the
   * remainder rather than duplicating what landed. A refusal the ledger will
   * repeat forever (an amount that rounds to nothing in its currency) is
   * counted and stepped over instead, because failing the image for it only
   * keeps the rows beside it out of the ledger too, receipt after receipt,
   * until the retries run out. Nothing records the refusal: the row has no
   * document, so a later pass attempts it, is refused again, and counts it
   * again — which is the same answer, not a new loss. When nothing at all
   * landed the refusal is thrown after all, so an image that produced no
   * transaction is never reported as done.
   *
   * The photo travels with the rows rather than being appended afterwards:
   * the upload is keyed on the row's own id, so it precedes the document
   * write and a replay lands on the same slot instead of orphaning bytes.
   * `planReceiptAttachments` decides which rows carry it — two rows off one
   * receipt would otherwise each upload the same picture — and a plan whose
   * row is refused is handed on to the next row of the same receipt rather
   * than lost with it. A photo the upload refuses costs the photo and not
   * the transaction: the row is rewritten bare and the loss is counted
   * (#334's ruling, on this door).
   *
   * `landed` includes the rows that were skipped: it is what the receipt
   * produced, which is what the user is told about, not a tally of this
   * particular pass's writes. `receiptsSkipped` is the exception: it counts
   * only this pass's losses, because a replay that skips an already-landed
   * row via `hasTransaction` has no way to see a photo an earlier pass
   * already dropped for it.
   */
  private async createTransactions(
    id: string,
    transactions: ProcessedTransaction[],
    file: File,
  ): Promise<{ landed: number; refused: number; receiptsSkipped: number }> {
    // A reader that placed no row on a photo — the single-image cloud read
    // reports neither an index nor a receipt id, because there was only ever
    // one photo to place a row on — still read every one of these rows off
    // the single file this drain is holding. So the source is named here
    // rather than guessed: the wizard may not do this, since a batch of
    // several files leaves nobody able to say which of them an unplaced row
    // came off, and `imageMetadataOf` keeps that rule for the doors that
    // need it. A row that was placed keeps what it says, since the fallback
    // only fills a gap — but placement is the numbering the multi-image
    // readers the wizard opens do, and no reader behind this door does it,
    // so in practice every drained row is attached on the assumption above.
    const metas = transactions.map((tx): ImagePositionMetadata => imageMetadataOf(tx) ?? {
      imageIndex: 0,
      imageId: 'image_0',
      positionInImage: 'middle',
      confidenceScore: tx.confidence,
    });
    const plans = planReceiptAttachments(
      transactions.map((tx, index) => ({
        id: `${id}-${index}`,
        imageMetadata: metas[index],
      })),
      1,
    );
    // The group each row's plan belongs to, keyed the way the planner keyed
    // it. Nothing here is a reviewer's split and the drain runs over exactly
    // one file, so the planner's image-set key can only ever be one group,
    // and every row above carries metadata, so every row is in one.
    const groupKeys = transactions.map((_, index) => {
      const receiptId = metas[index]?.receiptId;
      return receiptId !== undefined ? `receipt:${receiptId}` : 'images';
    });
    /** Plans whose row was refused, waiting for another row of the same receipt. */
    const orphanedPlans = new Map<string, number[]>();

    let landed = 0;
    let refused = 0;
    let receiptsSkipped = 0;
    let anyFailed = false;
    let firstError: unknown;
    let firstRefusal: unknown;

    for (const [index, tx] of transactions.entries()) {
      const rowTxId = `${id}-${index}`;
      const groupKey = groupKeys[index];
      // A plan is decided by metadata, before anything is written; a refusal
      // is decided by the amount, which only the write finds out. The planner
      // gives the photo to the first row of its group, so a refused first row
      // would take the receipt's only copy of the picture down with it — the
      // plan is re-routed here, at the write, to the next row of the same
      // group that was given none. A row already in the ledger consumes the
      // plan without writing: the pass that put it there consumed it too.
      let plan = plans[index];
      if (plan.length === 0) {
        const waiting = orphanedPlans.get(groupKey);
        if (waiting) {
          plan = waiting;
          orphanedPlans.delete(groupKey);
        }
      }
      try {
        if (await this.transactionService.hasTransaction(rowTxId)) {
          // An interrupted earlier drain already posted this one.
          landed++;
          continue;
        }

        // The same mapper every other import door writes through (ADR 0059):
        // the row's renames only, and every optional the reader filled
        // travels without this door naming it.
        const resolved = resolveImportDate(tx.date, tx.fieldConfidence?.date);
        const bareDto = toCreateTransactionDTO({
          ...tx,
          categoryId: tx.suggestedCategoryId,
          note: tx.notes,
          date: resolved.date,
        }, baseCurrencyOf(this.authService.currentUser()));
        const withPhoto = plan.length > 0;

        try {
          await this.transactionService.addTransaction(
            withPhoto ? { ...bareDto, receiptFiles: [file] } : bareDto,
            { id: rowTxId },
          );
        } catch (error) {
          // Both sentinels are about the image alone, and both leave the
          // write rolled back with nothing behind them, so the row is still
          // worth saving bare.
          const message = this.errorMessage(error);
          const imagesOnly =
            message === RECEIPT_IMAGE_LIMIT_ERROR || message === RECEIPT_ATTACH_FAILED;
          if (!withPhoto || !imagesOnly) throw error;
          await this.transactionService.addTransaction(bareDto, { id: rowTxId });
          receiptsSkipped++;
        }
        landed++;
      } catch (error) {
        if (this.errorMessage(error) === INVALID_AMOUNT_ERROR) {
          refused++;
          firstRefusal ??= error;
          if (plan.length > 0) orphanedPlans.set(groupKey, plan);
          continue;
        }
        anyFailed = true;
        firstError ??= error;
      }
    }

    if (anyFailed) {
      throw firstError instanceof Error ? firstError : new Error(this.errorMessage(firstError));
    }
    if (landed === 0 && refused > 0) {
      throw firstRefusal instanceof Error ? firstRefusal : new Error(this.errorMessage(firstRefusal));
    }

    // Both throws above cover the case where nothing landed, so anything
    // still waiting here is a receipt whose every remaining row already had
    // a photo of its own or was refused too: the picture is lost the same
    // way an upload refusal loses one, and counts the same.
    receiptsSkipped += orphanedPlans.size;

    return { landed, refused, receiptsSkipped };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
