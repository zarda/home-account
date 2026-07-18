import { Injectable, inject } from '@angular/core';
import { TransactionService } from './transaction.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { formatReceiptItemLines } from '../utils/receipt-consolidation';
import { Transaction } from '../../models';

/** Thrown when no cloud AI provider is configured for the conversion. */
export const RECEIPT_TO_NOTE_AI_UNAVAILABLE = 'RECEIPT_TO_NOTE_AI_UNAVAILABLE';
/** Thrown when the AI could not extract any detail from the image. */
export const RECEIPT_TO_NOTE_NO_DETAILS = 'RECEIPT_TO_NOTE_NO_DETAILS';

/**
 * Converts a transaction's stored receipt image into detailed note text:
 * the image is re-read by the configured cloud AI, its line-by-line
 * content is appended to the transaction note, and the image is removed —
 * freeing one slot of the receipt-image quota. The image is only deleted
 * after the note has been written, so a failed conversion never loses it.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptToNoteService {
  private transactionService = inject(TransactionService);
  private cloudLLMProvider = inject(CloudLLMProviderService);

  /**
   * Extract the receipt image's detailed content into the transaction
   * note, then remove the image. Returns the updated note text.
   */
  async convertReceiptToNote(transaction: Transaction): Promise<string> {
    if (!transaction.receiptUrl) {
      throw new Error(RECEIPT_TO_NOTE_NO_DETAILS);
    }
    if (!this.cloudLLMProvider.hasAnyCloudProvider()) {
      throw new Error(RECEIPT_TO_NOTE_AI_UNAVAILABLE);
    }

    const imageBase64 = await this.fetchImageAsDataUrl(transaction.receiptUrl);
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
    await this.transactionService.removeReceipt(transaction.id);
    return note;
  }

  private async fetchImageAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download receipt image (${response.status})`);
    }
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read receipt image'));
      reader.readAsDataURL(blob);
    });
  }
}
