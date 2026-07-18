import { Injectable, inject, signal, computed } from '@angular/core';
import { RemoteConfig, fetchAndActivate, getNumber } from '@angular/fire/remote-config';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT } from '../../models';

/**
 * Remote Config parameter keys. Keep this list in sync with
 * docs/remote-config.md when adding parameters.
 */
export const RC_FREE_TIER_RECEIPT_IMAGE_LIMIT = 'free_tier_receipt_image_limit';
export const RC_PREMIUM_RECEIPT_IMAGE_LIMIT = 'premium_receipt_image_limit';

/** Fetched values are cached this long before a new fetch is allowed. */
const MIN_FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Typed facade over Firebase Remote Config.
 *
 * Values are exposed as computed signals that resolve to the in-app
 * defaults until the first fetch activates, and to the remote template
 * values afterwards — so a limit can be tuned from the Firebase console
 * without shipping a release. Deployments that never configure a remote
 * template (e.g. self-hosted Firebase projects), offline starts, and unit
 * tests all silently keep the defaults.
 *
 * Remote Config is for tunable knobs and flags only: values are readable
 * by every client, so never put secrets here, and never derive a user's
 * entitlement (e.g. the premium tier itself) from it — entitlements live
 * on the user's Firestore document.
 */
@Injectable({ providedIn: 'root' })
export class RemoteConfigService {
  private remoteConfig = inject(RemoteConfig, { optional: true });

  // Bumps once remote values are activated so computed readers re-evaluate
  private activated = signal(false);

  /** Resolves when the initial fetch has settled (activated or failed). */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.initialize();
  }

  /** Free-tier stored receipt image limit (console-tunable). */
  freeTierReceiptImageLimit = computed(() => {
    this.activated();
    return this.readPositiveNumber(
      RC_FREE_TIER_RECEIPT_IMAGE_LIMIT,
      FREE_TIER_RECEIPT_IMAGE_LIMIT
    );
  });

  /**
   * Premium-tier stored receipt image limit. A value of 0 (the default)
   * means unlimited.
   */
  premiumReceiptImageLimit = computed(() => {
    this.activated();
    if (!this.remoteConfig) return Number.POSITIVE_INFINITY;
    const value = this.getNumberValue(this.remoteConfig, RC_PREMIUM_RECEIPT_IMAGE_LIMIT);
    return value > 0 ? value : Number.POSITIVE_INFINITY;
  });

  private async initialize(): Promise<void> {
    if (!this.remoteConfig) return;

    try {
      this.remoteConfig.settings.minimumFetchIntervalMillis = MIN_FETCH_INTERVAL_MS;
      // In-app defaults double as documentation of every known parameter
      this.remoteConfig.defaultConfig = {
        [RC_FREE_TIER_RECEIPT_IMAGE_LIMIT]: FREE_TIER_RECEIPT_IMAGE_LIMIT,
        [RC_PREMIUM_RECEIPT_IMAGE_LIMIT]: 0,
      };
      await this.fetchAndActivateConfig(this.remoteConfig);
      this.activated.set(true);
    } catch (error) {
      // Offline start, throttling, or an unreachable backend — the in-app
      // defaults stay in effect and the next app start retries
      console.warn('[RemoteConfig] Fetch failed, keeping in-app defaults:', error);
    }
  }

  /** Read a parameter that must be a positive number, else the fallback. */
  private readPositiveNumber(key: string, fallback: number): number {
    if (!this.remoteConfig) return fallback;
    const value = this.getNumberValue(this.remoteConfig, key);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  // SDK call seams so unit tests can substitute values without a Firebase app
  protected fetchAndActivateConfig(remoteConfig: RemoteConfig): Promise<boolean> {
    return fetchAndActivate(remoteConfig);
  }

  protected getNumberValue(remoteConfig: RemoteConfig, key: string): number {
    return getNumber(remoteConfig, key);
  }
}
