import { InjectionToken } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface WidgetSnapshotPlugin {
  /**
   * Replace the App Group's `widget-snapshot.json` with `snapshot`, a
   * serialised WidgetSnapshot, and reload the widget's timelines. The string is
   * decoded natively before anything is written: rejects with code 'invalid'
   * when it does not decode, and 'unavailable' when there is no App Group
   * container or the write fails.
   */
  write(options: { snapshot: string }): Promise<void>;

  /**
   * Fires when a tap on the widget opened the app. The plugin holds a tap
   * that started the app until a listener attaches. The event carries
   * `{ source: 'widget' }` only so the native console names it; a listener
   * reads nothing from it.
   */
  addListener(eventName: 'tapped', listener: () => void): Promise<PluginListenerHandle>;
}

const WidgetSnapshot = registerPlugin<WidgetSnapshotPlugin>('WidgetSnapshot');

/**
 * The token is the platform gate: it is `null` on the web, where there is no
 * widget to write for, so callers compose nothing there and a spec provides a
 * fake without spying on `Capacitor`.
 *
 * On a device the factory hands out an adapter of the two methods rather than
 * the proxy `registerPlugin` returns. On injector teardown DI probes every
 * provided value for `typeof value.ngOnDestroy === 'function'`, and the proxy
 * answers that name — and any other — with a callable plugin-method wrapper,
 * so DI would invoke it as a lifecycle hook and reach the bridge (see
 * BIOMETRIC_AUTH_PLUGIN).
 */
export const WIDGET_SNAPSHOT_PLUGIN = new InjectionToken<WidgetSnapshotPlugin | null>(
  'WIDGET_SNAPSHOT_PLUGIN',
  {
    providedIn: 'root',
    factory: () =>
      Capacitor.isNativePlatform()
        ? {
            write: (options: { snapshot: string }) => WidgetSnapshot.write(options),
            addListener: (eventName: 'tapped', listener: () => void) =>
              WidgetSnapshot.addListener(eventName, listener),
          }
        : null,
  }
);
