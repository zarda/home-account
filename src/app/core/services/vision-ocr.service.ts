import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import VisionOCR, { VisionOCRAvailability, VisionOCRResult } from '../plugins/vision-ocr.plugin';

/**
 * Injectable wrapper around the native Vision OCR plugin so consumers can be
 * unit-tested without touching the Capacitor bridge. Also owns detection of
 * the Mac environment (the iOS build running on Apple Silicon / Catalyst).
 */
@Injectable({ providedIn: 'root' })
export class VisionOcrService {
  // Seeded from a user-agent heuristic, refined by the native plugin
  // once detectEnvironment() has run.
  private _isMacEnvironment = signal<boolean>(this.detectMacEnvironmentFromUserAgent());
  isMacEnvironment = computed(() => this._isMacEnvironment());

  private _supportedLanguages = signal<string[]>([]);
  /**
   * What this device's Vision build can read, empty until the plugin has
   * answered (and on the web, where there is no Vision at all). Callers route
   * on this instead of on the three languages we used to name.
   */
  supportedLanguages = computed(() => this._supportedLanguages());

  /**
   * Refine what we know about the device with the native API (the UA check is
   * a heuristic, and only the device can say which languages it reads).
   */
  detectEnvironment(): void {
    this.isAvailable().catch(() =>
      console.warn('[VisionOCR] Unable to query device capabilities from native plugin'),
    );
  }

  /**
   * Every answer is kept, so the signals are current from whichever call
   * happened to come first — the pipeline asks this before each scan anyway.
   */
  async isAvailable(): Promise<VisionOCRAvailability> {
    const availability = await VisionOCR.isAvailable();

    if (typeof availability.isMacEnvironment === 'boolean') {
      this._isMacEnvironment.set(availability.isMacEnvironment);
    }
    if (availability.supportedLanguages) {
      this._supportedLanguages.set(availability.supportedLanguages);
    }

    return availability;
  }

  recognizeText(options: { image: string; languages?: string[] }): Promise<VisionOCRResult> {
    return VisionOCR.recognizeText(options);
  }

  /**
   * Detect "iOS app running on macOS" from the user agent.
   * On a Mac the WKWebView reports a Macintosh UA without touch support,
   * while iPhones/iPads report touch points even with a desktop UA.
   */
  private detectMacEnvironmentFromUserAgent(): boolean {
    if (Capacitor.getPlatform() !== 'ios') {
      return false;
    }
    return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints === 0;
  }
}
