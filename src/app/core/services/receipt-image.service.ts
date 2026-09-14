import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { Transaction, receiptImageUrls } from '../../models';

/**
 * Thrown when the image bytes could not be downloaded at all. The usual
 * cause is a storage bucket without CORS configuration — browsers then
 * block every in-browser download (see docs/storage-cors-setup.md).
 */
export const RECEIPT_IMAGE_DOWNLOAD_FAILED = 'RECEIPT_IMAGE_DOWNLOAD_FAILED';

/**
 * Reads one of a transaction's stored receipt images back as bytes, encoded
 * as a data URL for callers that hand it to a cloud AI provider or an
 * in-app viewer.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptImageService {
  private storageService = inject(StorageService);
  private authService = inject(AuthService);

  /**
   * Download the stored image and encode it as a data URL for the AI.
   *
   * Prefers the Storage SDK (receipts live at a path derivable from the
   * transaction id and slot): a plain fetch() of the public download URL
   * fails with a CORS error whenever the browser has already cached that
   * URL for an <img> thumbnail, because those cached responses carry no
   * CORS headers. Falls back to a cache-bypassing fetch for receipt URLs
   * that don't resolve at the standard path (e.g. restored from a backup).
   */
  async loadAsDataUrl(transaction: Transaction, slot: number): Promise<string> {
    let blob: Blob;
    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');
      blob = await this.storageService.downloadReceipt(userId, transaction.id, slot);
    } catch {
      try {
        // The URL stored at that slot; a legacy row's single image counts
        // as slot 0.
        const url = transaction.receiptUrls?.[slot] ?? receiptImageUrls(transaction)[0];
        if (!url) throw new Error('No stored URL for the requested image');
        blob = await this.fetchImageBlob(url);
      } catch (error) {
        console.error('[ReceiptImage] Image download failed on both paths:', error);
        throw new Error(RECEIPT_IMAGE_DOWNLOAD_FAILED);
      }
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
