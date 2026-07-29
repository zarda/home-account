import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { RemoteConfigService } from './remote-config.service';
import { SubscriptionTier, Transaction, receiptImageCount, subscriptionTier } from '../../models';

/**
 * Tracks how many receipt images a user has stored and enforces the
 * per-tier limit. General (free) users may keep up to the free-tier limit
 * (200 by default, tunable via Remote Config); the premium tier (a paid
 * upgrade offered in a future release) lifts the limit.
 *
 * The count is a server-side aggregation over transactions with a
 * receiptUrl, loaded lazily and kept in sync locally as images are added
 * and removed so quota checks don't re-query on every upload.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptQuotaService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private remoteConfigService = inject(RemoteConfigService);

  private _imageCount = signal<number | null>(null);
  private countedForUserId: string | null = null;

  /** Stored receipt image count, or null before the first load. */
  imageCount = computed(() => this._imageCount());

  tier = computed<SubscriptionTier>(() => subscriptionTier(this.authService.currentUser()));

  /** Image limit for the current tier, tunable via Remote Config. */
  imageLimit = computed(() =>
    this.tier() === 'premium'
      ? this.remoteConfigService.premiumReceiptImageLimit()
      : this.remoteConfigService.freeTierReceiptImageLimit()
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
   * Load (or reuse) the stored-image count and report whether `count` more
   * images may be added. Fails open when the count cannot be loaded so a
   * transient error never blocks saving a transaction.
   */
  async canAddImages(count: number): Promise<boolean> {
    try {
      const used = await this.ensureCountLoaded();
      return used + count <= this.imageLimit();
    } catch (error) {
      console.warn('[ReceiptQuota] Count unavailable, allowing upload:', error);
      return true;
    }
  }

  /** Refresh the count from the server. */
  async refreshCount(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    // Sums images rather than counting documents, for two reasons. The quota
    // is a limit on images, and a transaction can hold more than one — the
    // sum reads the receiptUrls array where present. And the filter stays on
    // receiptUrl, which is always a string — Firestore range filters only
    // match values of the operand's type, so an inequality against a field
    // that can hold arrays would silently skip every array-valued row, count
    // zero images for multi-image users, and never trip the limit.
    //
    // Reading the rows rather than counting them is affordable precisely
    // because the quota bounds them: a user at the limit has at most a few
    // hundred, and a user past it cannot add more.
    const withImages = await this.firestoreService.getCollection<Transaction>(
      `users/${userId}/transactions`,
      { where: [{ field: 'receiptUrl', op: '>', value: '' }] }
    );
    const count = withImages.reduce((total, t) => total + receiptImageCount(t), 0);
    this._imageCount.set(count);
    this.countedForUserId = userId;
    return count;
  }

  /** Record newly stored images without re-querying. */
  noteImagesAdded(count: number): void {
    const current = this._imageCount();
    if (current !== null) this._imageCount.set(current + count);
  }

  /** Record removed images without re-querying. */
  noteImagesRemoved(count: number): void {
    const current = this._imageCount();
    if (current !== null) this._imageCount.set(Math.max(0, current - count));
  }

  /** Drop the cached count (e.g. after bulk deletes). */
  invalidateCount(): void {
    this._imageCount.set(null);
    this.countedForUserId = null;
  }

  private async ensureCountLoaded(): Promise<number> {
    const userId = this.authService.userId();
    const cached = this._imageCount();
    if (cached !== null && userId === this.countedForUserId) return cached;
    return this.refreshCount();
  }
}
