import { Injectable, signal, computed } from '@angular/core';
import AppleIntelligence, { AppleReceiptExtraction } from '../plugins/apple-intelligence.plugin';

/**
 * Injectable wrapper around the Apple Intelligence plugin (Apple's on-device
 * foundation model, iOS 26 / macOS 26). Keeps the availability state so the
 * strategy layer can route synchronously.
 */
@Injectable({ providedIn: 'root' })
export class AppleIntelligenceService {
  private _available = signal<boolean>(false);
  isModelAvailable = computed(() => this._available());

  /**
   * Probe the native plugin for on-device model availability.
   */
  detectAvailability(): void {
    AppleIntelligence.isAvailable()
      .then(({ available }) => this._available.set(available === true))
      // The plugin is absent from every web build, so a rejection here is the
      // ordinary path rather than a failure: report no model and say nothing.
      .catch(() => this._available.set(false));
  }

  parseReceiptText(options: { text: string; categories?: string[] }): Promise<AppleReceiptExtraction> {
    return AppleIntelligence.parseReceiptText(options);
  }
}
