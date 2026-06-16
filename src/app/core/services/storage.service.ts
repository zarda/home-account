import { Injectable, inject } from '@angular/core';
import {
  Storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from '@angular/fire/storage';

/** Maximum receipt image size in bytes (2 MB). Mirrors storage.rules. */
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

/**
 * Wraps Firebase Storage operations for transaction receipts.
 *
 * Receipts are stored at `users/{userId}/receipts/{transactionId}` — one
 * object per transaction — so re-uploading overwrites the previous image and
 * the storage path can be derived from the transaction id alone.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private storage = inject(Storage);

  private receiptPath(userId: string, transactionId: string): string {
    return `users/${userId}/receipts/${transactionId}`;
  }

  /**
   * Upload (or overwrite) a transaction's receipt image and return its
   * download URL. Rejects oversized files before hitting the network so the
   * caller gets a clear error instead of an opaque storage-rules rejection.
   */
  async uploadReceipt(userId: string, transactionId: string, file: File): Promise<string> {
    if (file.size > MAX_RECEIPT_BYTES) {
      throw new Error(`Receipt image exceeds the ${MAX_RECEIPT_BYTES} byte limit`);
    }

    const storageRef = ref(this.storage, this.receiptPath(userId, transactionId));
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
    return getDownloadURL(storageRef);
  }

  /**
   * Delete a transaction's receipt image. A missing object is treated as
   * success so deleting a receiptless transaction never fails.
   */
  async deleteReceipt(userId: string, transactionId: string): Promise<void> {
    const storageRef = ref(this.storage, this.receiptPath(userId, transactionId));
    try {
      await deleteObject(storageRef);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'storage/object-not-found') {
        throw error;
      }
    }
  }
}
