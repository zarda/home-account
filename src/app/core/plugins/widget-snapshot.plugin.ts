import { InjectionToken } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WidgetSnapshotPlugin {
  /**
   * Replace the App Group's `widget-snapshot.json` with `snapshot`, a
   * serialised WidgetSnapshot, and reload the widget's timelines. The string is
   * decoded natively before anything is written: rejects with code 'invalid'
   * when it does not decode, and 'unavailable' when there is no App Group
   * container or the write fails.
   */
  write(options: { snapshot: string }): Promise<void>;
}

const WidgetSnapshot = registerPlugin<WidgetSnapshotPlugin>('WidgetSnapshot');

/**
 * The token is the platform gate: it is `null` on the web, where there is no
 * widget to write for, so callers compose nothing there and a spec provides a
 * fake without spying on `Capacitor`.
 *
 * On a device the factory hands out a one-method adapter rather than the proxy
 * `registerPlugin` returns. On injector teardown DI probes every provided
 * value for `typeof value.ngOnDestroy === 'function'`, and the proxy answers
 * that name — and any other — with a callable plugin-method wrapper, so DI
 * would invoke it as a lifecycle hook and reach the bridge (see
 * BIOMETRIC_AUTH_PLUGIN).
 */
export const WIDGET_SNAPSHOT_PLUGIN = new InjectionToken<WidgetSnapshotPlugin | null>(
  'WIDGET_SNAPSHOT_PLUGIN',
  {
    providedIn: 'root',
    factory: () =>
      Capacitor.isNativePlatform()
        ? { write: (options: { snapshot: string }) => WidgetSnapshot.write(options) }
        : null,
  }
);
