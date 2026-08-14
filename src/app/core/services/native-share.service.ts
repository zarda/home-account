import { Injectable } from '@angular/core';
import type { PluginListenerHandle } from '@capacitor/core';

import ShareIntake, { SharedIntakeFile } from '../plugins/share-intake.plugin';

/**
 * Injectable wrapper around the native ShareIntake plugin so consumers can
 * be unit-tested without touching the Capacitor bridge — the registered
 * plugin is a Proxy whose methods cannot be spied on.
 */
@Injectable({ providedIn: 'root' })
export class NativeShareService {
  checkPendingShares(): Promise<{ count: number }> {
    return ShareIntake.checkPendingShares();
  }

  consumePendingShares(): Promise<{ files: SharedIntakeFile[] }> {
    return ShareIntake.consumePendingShares();
  }

  completePendingShares(options: { ids: string[] }): Promise<void> {
    return ShareIntake.completePendingShares(options);
  }

  clearPendingShares(): Promise<void> {
    return ShareIntake.clearPendingShares();
  }

  addListener(
    eventName: 'pendingSharesChanged',
    listener: () => void
  ): Promise<PluginListenerHandle> {
    return ShareIntake.addListener(eventName, listener);
  }
}
