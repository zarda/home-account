import { Injectable, inject } from '@angular/core';
import {
  Storage,
  ref,
  uploadBytes,
  getDownloadURL,
  getBlob,
  deleteObject
} from '@angular/fire/storage';
import { prepareReceiptImage } from '../utils/receipt-image.utils';

/** Maximum receipt image size in bytes (2 MB). Mirrors storage.rules. */
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

/**
 * Maximum receipt images one transaction may hold. Mirrored server-side by
 * firestore.rules, which caps the receiptUrls array at the same size.
 */
export const MAX_RECEIPTS_PER_TRANSACTION = 5;

/**
 * Wraps Firebase Storage operations for transaction receipts.
 *
 * Receipts are stored at `users/{userId}/receipts/{objectName}` where the
 * object name is derived from the transaction id and a slot number:
 * slot 0 is the bare transaction id, slot n > 0 appends `_{n}`.
 *
 * Slot 0 stays unsuffixed so every object uploaded before slots existed is
 * still addressable at its original key — no migration, no dual-path
 * lookup. The suffix cannot alias another transaction's slot 0 because no
 * transaction id contains an underscore: Firestore auto-ids draw from
 * [A-Za-z0-9], and the only caller-supplied ids are the recurring engine's
 * `rec-{ruleId}-{timestamp}`, which are hyphen-separated.
 *
 * The name is a single path segment either way, so storage.rules'
 * `users/{userId}/receipts/{fileName}` match covers every slot; a nested
 * scheme would fall through to the deny-all rule.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private storage = inject(Storage);

  private receiptPath(userId: string, transactionId: string, slot: number): string {
    const objectName = slot === 0 ? transactionId : `${transactionId}_${slot}`;
    return `users/${userId}/receipts/${objectName}`;
  }

  /**
   * Upload (or overwrite) one of a transaction's receipt images and return
   * its download URL.
   *
   * The image is compressed to fit `MAX_RECEIPT_BYTES` first. That happens
   * here, and not at each door, because every door ends up in this method —
   * the form's attach, the import wizard's confirm, the camera dialog, the
   * queue drain — and a door added tomorrow cannot forget a step it does not
   * know about. Until this call existed the ceiling was enforced and never
   * met: the camera was safe only because it captures at quality 0.85, while
   * a photo picked from the library arrived at its full 2–5 MB and cost the
   * user the whole transaction (#334).
   *
   * The size guard stays underneath it as the last line of defence, with its
   * specific message, for the case where a prepared file still does not fit.
   */
  async uploadReceipt(
    userId: string,
    transactionId: string,
    file: File,
    slot = 0
  ): Promise<string> {
    const prepared = await prepareReceiptImage(file, MAX_RECEIPT_BYTES);
    if (prepared.size > MAX_RECEIPT_BYTES) {
      throw new Error(`Receipt image exceeds the ${MAX_RECEIPT_BYTES} byte limit`);
    }

    const storageRef = ref(this.storage, this.receiptPath(userId, transactionId, slot));
    await uploadBytes(storageRef, prepared, { contentType: prepared.type || 'image/jpeg' });
    return getDownloadURL(storageRef);
  }

  /**
   * Download one of a transaction's receipt images through the Storage SDK.
   * Unlike fetch()ing the public download URL, this authenticates via
   * headers and uses a token-less URL, so it can't collide with the
   * browser's cached <img> responses (which lack CORS headers and make a
   * plain fetch fail with a CORS error).
   */
  downloadReceipt(userId: string, transactionId: string, slot = 0): Promise<Blob> {
    const storageRef = ref(this.storage, this.receiptPath(userId, transactionId, slot));
    return getBlob(storageRef);
  }

  /**
   * Delete one of a transaction's receipt images. A missing object is
   * treated as success so deleting an empty slot never fails.
   */
  async deleteReceipt(userId: string, transactionId: string, slot = 0): Promise<void> {
    const storageRef = ref(this.storage, this.receiptPath(userId, transactionId, slot));
    try {
      await deleteObject(storageRef);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'storage/object-not-found') {
        throw error;
      }
    }
  }

  /**
   * Delete several of a transaction's receipt slots, tolerating gaps: a
   * slot whose object is already gone (a tombstoned removal, or a rolled
   * back upload) counts as deleted. Never rejects — callers use this for
   * best-effort cleanup where the document delete must win either way.
   */
  async deleteReceiptSlots(userId: string, transactionId: string, slots: number[]): Promise<void> {
    await Promise.allSettled(slots.map(slot => this.deleteReceipt(userId, transactionId, slot)));
  }
}
