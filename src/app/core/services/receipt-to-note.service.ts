import { Injectable, inject } from '@angular/core';
import { TransactionService } from './transaction.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
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
  private storageService = inject(StorageService);
  private authService = inject(AuthService);

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

    const imageBase64 = await this.loadImageAsDataUrl(transaction);
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

  /**
   * Download the stored image and encode it as a data URL for the AI.
   *
   * Prefers the Storage SDK (receipts live at a path derivable from the
   * transaction id): a plain fetch() of the public download URL fails
   * with a CORS error whenever the browser has already cached that URL
   * for an <img> thumbnail, because those cached responses carry no CORS
   * headers. Falls back to a cache-bypassing fetch for receipt URLs that
   * don't resolve at the standard path (e.g. restored from a backup).
   */
  private async loadImageAsDataUrl(transaction: Transaction): Promise<string> {
    let blob: Blob;
    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');
      blob = await this.storageService.downloadReceipt(userId, transaction.id);
    } catch {
      blob = await this.fetchImageBlob(transaction.receiptUrl!);
    }

    // The AI providers strip/parse a data:image/... prefix; a blob served
    // without an image content type would produce an unusable data URL
    const imageBlob = blob.type.startsWith('image/')
      ? blob
      : new Blob([blob], { type: 'image/jpeg' });

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read receipt image'));
      reader.readAsDataURL(imageBlob);
    });
  }

  private async fetchImageBlob(url: string): Promise<Blob> {
    // no-store keeps this request out of the HTTP cache, so it cannot be
    // answered with a cached CORS-header-less <img> response
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to download receipt image (${response.status})`);
    }
    return response.blob();
  }
}
