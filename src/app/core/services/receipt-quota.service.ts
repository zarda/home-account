import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT, SubscriptionTier, Transaction } from '../../models';

/**
 * Tracks how many receipt images a user has stored and enforces the
 * per-tier limit. General (free) users may keep up to
 * FREE_TIER_RECEIPT_IMAGE_LIMIT images; the premium tier (a paid upgrade
 * offered in a future release) lifts the limit.
 *
 * The count is a server-side aggregation over transactions with a
 * receiptUrl, loaded lazily and kept in sync locally as images are added
 * and removed so quota checks don't re-query on every upload.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptQuotaService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  private _imageCount = signal<number | null>(null);
  private countedForUserId: string | null = null;

  /** Stored receipt image count, or null before the first load. */
  imageCount = computed(() => this._imageCount());

  tier = computed<SubscriptionTier>(() =>
    this.authService.currentUser()?.subscription?.tier ?? 'free'
  );

  /** Image limit for the current tier; premium is unlimited. */
  imageLimit = computed(() =>
    this.tier() === 'premium' ? Number.POSITIVE_INFINITY : FREE_TIER_RECEIPT_IMAGE_LIMIT
  );

  hasUnlimitedImages = computed(() => !Number.isFinite(this.imageLimit()));

  /** Remaining uploads, or null before the first count load. */
  remaining = computed(() => {
    const count = this._imageCount();
    if (count === null) return null;
    return Math.max(0, this.imageLimit() - count);
  });

  isAtLimit = computed(() => {
    const count = this._imageCount();
    return count !== null && count >= this.imageLimit();
  });

  /**
   * Load (or reuse) the stored-image count and report whether another
   * image may be added. Fails open when the count cannot be loaded so a
   * transient error never blocks saving a transaction.
   */
  async canAddImage(): Promise<boolean> {
    try {
      const count = await this.ensureCountLoaded();
      return count < this.imageLimit();
    } catch (error) {
      console.warn('[ReceiptQuota] Count unavailable, allowing upload:', error);
      return true;
    }
  }

  /** Refresh the count from the server. */
  async refreshCount(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const count = await this.firestoreService.countDocuments(
      `users/${userId}/transactions`,
      // Matches every document whose receiptUrl is a non-empty string
      { where: [{ field: 'receiptUrl', op: '>', value: '' }] }
    );
    this._imageCount.set(count);
    this.countedForUserId = userId;
    return count;
  }

  /** Record a newly stored image without re-querying. */
  noteImageAdded(): void {
    const count = this._imageCount();
    if (count !== null) this._imageCount.set(count + 1);
  }

  /** Record a removed image without re-querying. */
  noteImageRemoved(): void {
    const count = this._imageCount();
    if (count !== null) this._imageCount.set(Math.max(0, count - 1));
  }

  /** Drop the cached count (e.g. after bulk deletes). */
  invalidateCount(): void {
    this._imageCount.set(null);
    this.countedForUserId = null;
  }

  /** True when this transaction change would store a NEW image. */
  isNewImage(existing: Pick<Transaction, 'receiptUrl'> | null | undefined): boolean {
    return !existing?.receiptUrl;
  }

  private async ensureCountLoaded(): Promise<number> {
    const userId = this.authService.userId();
    const cached = this._imageCount();
    if (cached !== null && userId === this.countedForUserId) return cached;
    return this.refreshCount();
  }
}
