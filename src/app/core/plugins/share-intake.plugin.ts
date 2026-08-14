import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** One file the iOS Share Extension saved into the App Group container. */
export interface SharedIntakeFile {
  /** The sidecar's UUID basename; names this entry to completePendingShares. */
  id: string;
  name: string;
  mimeType: string;
  /**
   * Epoch milliseconds as a string — the sidecar is string-typed
   * throughout. Empty for entries written before the field existed.
   */
  receivedAt: string;
  /** File bytes, base64-encoded (no data URL prefix). */
  base64: string;
}

export interface ShareIntakePlugin {
  /** How many shared files are waiting in the App Group container. */
  checkPendingShares(): Promise<{ count: number }>;

  /**
   * Every readable waiting file, WITHOUT deleting anything. The caller
   * decides what a session may claim and names it to completePendingShares.
   */
  consumePendingShares(): Promise<{ files: SharedIntakeFile[] }>;

  /** Delete the named payload+sidecar pairs. */
  completePendingShares(options: { ids: string[] }): Promise<void>;

  /** Delete everything waiting — the account-deletion cascade's door. */
  clearPendingShares(): Promise<void>;

  /**
   * Fires when the count may have changed — the plugin watches the app
   * becoming active, which is when a share made in another app can first
   * be noticed.
   */
  addListener(
    eventName: 'pendingSharesChanged',
    listener: () => void
  ): Promise<PluginListenerHandle>;
}

const ShareIntake = registerPlugin<ShareIntakePlugin>('ShareIntake');

export default ShareIntake;
