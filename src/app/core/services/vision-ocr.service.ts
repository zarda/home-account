import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import VisionOCR, { VisionOCRResult } from '../plugins/vision-ocr.plugin';

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

  /**
   * Refine Mac detection with the native API (the UA check is a heuristic).
   */
  detectEnvironment(): void {
    VisionOCR.isAvailable()
      .then(({ isMacEnvironment }) => {
        if (typeof isMacEnvironment === 'boolean') {
          this._isMacEnvironment.set(isMacEnvironment);
        }
      })
      .catch(() => console.warn('[VisionOCR] Unable to query Mac environment from native plugin'));
  }

  isAvailable(): Promise<{ available: boolean; isMacEnvironment?: boolean }> {
    return VisionOCR.isAvailable();
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
