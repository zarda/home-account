import { InjectionToken, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Capacitor } from '@capacitor/core';

/**
 * The token's own factory: a function that reloads the page, or `null` on a
 * device. Runs in an injection context. The platform check and the location
 * are parameters for the spec, which must hand in a fake: a real reload
 * inside Karma aborts the whole run.
 *
 * Null on a device. The token is the platform gate, as WIDGET_SNAPSHOT_PLUGIN's
 * is, the other way round: that one is null on the web. A native app has one
 * document and no other tabs: the only account change it does not start
 * itself is the SDK ending a session (a revoked or expired token). A reload
 * there would cost what the departing page still had to do: ReminderService
 * cancels a departing account's OS-booked bill reminders only when it sees
 * the account leave in-page, and a reloaded page starts with no account to
 * cancel for.
 */
export function pageReloadFactory(
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
  location: Pick<Location, 'reload'> = inject(DOCUMENT).location
): (() => void) | null {
  if (isNative()) return null;
  return () => location.reload();
}

/**
 * How the app reloads its page. A token rather than a private method a spec
 * spies on, because a missed stub aborts the whole Karma run: a provider is
 * visible and type-checked, it is in place before the service holding it is
 * built, and a rename cannot silently undo it the way it undoes a spy named
 * by a string. Every TestBed that builds the real AuthService provides a double.
 */
export const PAGE_RELOAD = new InjectionToken<(() => void) | null>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => pageReloadFactory()
});
