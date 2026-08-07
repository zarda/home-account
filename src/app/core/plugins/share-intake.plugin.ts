import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** One file the iOS Share Extension saved into the App Group container. */
export interface SharedIntakeFile {
  name: string;
  mimeType: string;
  /** File bytes, base64-encoded (no data URL prefix). */
  base64: string;
}

export interface ShareIntakePlugin {
  /** How many shared files are waiting in the App Group container. */
  checkPendingShares(): Promise<{ count: number }>;

  /** Return every waiting file and clear the container. */
  consumePendingShares(): Promise<{ files: SharedIntakeFile[] }>;

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
