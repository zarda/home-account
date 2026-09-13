import { InjectionToken } from '@angular/core';
import { registerPlugin } from '@capacitor/core';

/** What the device offers, or 'none' when it offers nothing this app can use. */
export type Biometry = 'faceId' | 'touchId' | 'none';

export interface BiometricAuthPlugin {
  /**
   * Whether biometry can be evaluated right now, and which kind the device
   * offers. `biometry` is reported even when `available` is false (for
   * example a device enrolled for Face ID but currently locked out from too
   * many failed attempts) — callers branch on `available`, never on
   * `biometry !== 'none'`.
   */
  isAvailable(): Promise<{ available: boolean; biometry: Biometry; reason: string }>;

  /**
   * Present the platform's biometric prompt. Rejects with a
   * CapacitorException-shaped error whose `message` and `code` both carry one
   * of 'cancelled' | 'lockedOut' | 'unavailable' | 'failed'.
   */
  authenticate(options: { reason: string }): Promise<{ success: true }>;
}

const BiometricAuth = registerPlugin<BiometricAuthPlugin>('BiometricAuth');

/**
 * The proxy `registerPlugin` returns cannot be spied — its `get` trap never
 * consults its target, so `spyOn` has nothing to intercept. Injecting it
 * through a token instead lets a spec provide a plain fake object in its
 * place.
 *
 * The factory hands out a two-method adapter rather than the proxy itself:
 * on TestBed teardown the injector probes every provided value for
 * `typeof value.ngOnDestroy === 'function'`, and the proxy's `get` trap
 * answers that name — and any other — with a callable plugin-method wrapper,
 * so DI would register and invoke it as a lifecycle hook, reaching the
 * bridge and rejecting with "not implemented on web".
 */
export const BIOMETRIC_AUTH_PLUGIN = new InjectionToken<BiometricAuthPlugin>('BIOMETRIC_AUTH_PLUGIN', {
  providedIn: 'root',
  factory: () => ({
    isAvailable: () => BiometricAuth.isAvailable(),
    authenticate: (options: { reason: string }) => BiometricAuth.authenticate(options),
  }),
});
