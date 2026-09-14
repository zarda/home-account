import { Injectable, inject, signal } from '@angular/core';
import { Capacitor, CapacitorException, ExceptionCode } from '@capacitor/core';

import { BIOMETRIC_AUTH_PLUGIN, Biometry } from '../plugins/biometric-auth.plugin';

export type BiometricOutcome = 'success' | 'cancelled' | 'lockedOut' | 'unavailable' | 'failed';

/** A wedged bridge must not delay the lock past its first guarded navigation. */
const AVAILABILITY_TIMEOUT_MS = 1500;

const OUTCOME_CODES: ReadonlySet<string> = new Set<BiometricOutcome>([
  'cancelled',
  'lockedOut',
  'unavailable',
  'failed',
]);

function asOutcome(value: unknown): BiometricOutcome | null {
  return typeof value === 'string' && OUTCOME_CODES.has(value) ? (value as BiometricOutcome) : null;
}

/**
 * Wraps the native biometric plugin so the rest of the app never touches
 * Capacitor directly. Web has no implementation of this plugin, so every
 * method here treats that as "no biometry" rather than reaching the proxy —
 * calling through on web throws an Unimplemented rejection that has no
 * business reaching a caller that only wants to know whether to offer a PIN.
 */
@Injectable({ providedIn: 'root' })
export class BiometricAuthService {
  private plugin = inject(BIOMETRIC_AUTH_PLUGIN);

  private _available = signal(false);
  private _biometry = signal<Biometry>('none');

  readonly available = this._available.asReadonly();
  readonly biometry = this._biometry.asReadonly();

  /**
   * Probe the device. Resolves immediately on web without calling the
   * plugin. On native, races the probe against a deadline so a broken bridge
   * cannot hang the app's startup; a rejection or a timeout both reset
   * `available` to false.
   */
  async detectAvailability(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.plugin.isAvailable(),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), AVAILABILITY_TIMEOUT_MS);
        }),
      ]);
      if (result === null) {
        // A stale `true` from an earlier probe must not survive a re-probe
        // that times out — the deadline is exactly the "bridge went away" case.
        this._available.set(false);
        this._biometry.set('none');
        return;
      }

      this._available.set(result.available);
      this._biometry.set(result.biometry);
    } catch {
      this._available.set(false);
      this._biometry.set('none');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Present the prompt and reduce whatever comes back to one outcome. */
  async authenticate(reason: string): Promise<BiometricOutcome> {
    try {
      await this.plugin.authenticate({ reason });
      return 'success';
    } catch (error) {
      return this.toOutcome(error);
    }
  }

  private toOutcome(error: unknown): BiometricOutcome {
    const err = error as { code?: unknown; message?: unknown } | undefined;
    const fromCode = asOutcome(err?.code) ?? asOutcome(err?.message);
    if (fromCode) return fromCode;

    // Web rejects every call with this instead of a native outcome code.
    if (error instanceof CapacitorException && error.code === ExceptionCode.Unimplemented) {
      return 'unavailable';
    }

    return 'failed';
  }
}
