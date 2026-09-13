import { Injectable, inject } from '@angular/core';
import { TransactionService } from './transaction.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ReceiptImageService, RECEIPT_IMAGE_DOWNLOAD_FAILED } from './receipt-image.service';
import { formatReceiptItemLines } from '../utils/receipt-consolidation';
import { Transaction, firstReceiptSlot, receiptImageCount } from '../../models';

/** Thrown when no cloud AI provider is configured for the conversion. */
export const RECEIPT_TO_NOTE_AI_UNAVAILABLE = 'RECEIPT_TO_NOTE_AI_UNAVAILABLE';
/** Thrown when the AI could not extract any detail from the image. */
export const RECEIPT_TO_NOTE_NO_DETAILS = 'RECEIPT_TO_NOTE_NO_DETAILS';
/**
 * Re-thrown under this name when receiptImage.loadAsDataUrl fails with
 * RECEIPT_IMAGE_DOWNLOAD_FAILED — see that constant in receipt-image.service.ts
 * for why the download itself can fail.
 */
export const RECEIPT_TO_NOTE_DOWNLOAD_FAILED = 'RECEIPT_TO_NOTE_DOWNLOAD_FAILED';

/**
 * Converts one of a transaction's stored receipt images into detailed note
 * text: the image is re-read by the configured cloud AI, its line-by-line
 * content is appended to the transaction note, and the image is removed —
 * freeing one slot of the receipt-image quota. The image is only deleted
 * after the note has been written, so a failed conversion never loses it.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptToNoteService {
  private transactionService = inject(TransactionService);
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private receiptImage = inject(ReceiptImageService);

  /**
   * Extract one receipt image's detailed content into the transaction
   * note, then remove that image. Defaults to the transaction's first live
   * image. Returns the updated note text.
   */
  async convertReceiptToNote(
    transaction: Transaction,
    slot = firstReceiptSlot(transaction)
  ): Promise<string> {
    if (receiptImageCount(transaction) === 0) {
      throw new Error(RECEIPT_TO_NOTE_NO_DETAILS);
    }
    if (!this.cloudLLMProvider.hasAnyCloudProvider()) {
      throw new Error(RECEIPT_TO_NOTE_AI_UNAVAILABLE);
    }

    let imageBase64: string;
    try {
      imageBase64 = await this.receiptImage.loadAsDataUrl(transaction, slot);
    } catch (error) {
      if (error instanceof Error && error.message === RECEIPT_IMAGE_DOWNLOAD_FAILED) {
        throw new Error(RECEIPT_TO_NOTE_DOWNLOAD_FAILED);
      }
      throw error;
    }
    const receipt = await this.cloudLLMProvider.parseReceipt(imageBase64);

    const details = receipt.receiptDetails
      || (receipt.items?.length
        ? formatReceiptItemLines(receipt.items, receipt.currency || transaction.currency)
        : '');
    if (!details.trim()) {
      throw new Error(RECEIPT_TO_NOTE_NO_DETAILS);
    }

    const note = transaction.note?.trim()
      ? `${transaction.note.trim()}\n\n${details}`
      : details;

    await this.transactionService.updateTransaction(transaction.id, { note });
    await this.transactionService.removeReceiptAt(transaction.id, slot);
    return note;
  }
}
