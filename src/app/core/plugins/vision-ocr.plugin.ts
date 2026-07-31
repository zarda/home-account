import { registerPlugin } from '@capacitor/core';

export interface VisionOCRTextBlock {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface VisionOCRResult {
  text: string;
  blocks: VisionOCRTextBlock[];
  confidence: number;
  blockCount: number;
}

export interface VisionOCRAvailability {
  available: boolean;
  /**
   * True when the iOS build is running on macOS (Apple Silicon "Designed for
   * iPad" or Mac Catalyst).
   */
  isMacEnvironment?: boolean;
  /**
   * Every language this device's Vision build can recognize, as the BCP-47 tags
   * Vision uses. Asked of the device rather than assumed, so routing can tell
   * what it can actually read instead of trusting a list we shipped.
   */
  supportedLanguages?: string[];
}

export interface VisionOCRPlugin {
  /** Check if Vision OCR is available on this device (iOS 13+). */
  isAvailable(): Promise<VisionOCRAvailability>;

  /**
   * Recognize text from a base64-encoded image
   * @param options.image - Base64-encoded image (with or without data URL prefix)
   * @param options.languages - Languages to try first, as BCP-47 tags. A hint at
   * the order Vision works in, never a filter: whatever is left out is still
   * recognized, and leaving it unset lets Vision detect the script itself.
   */
  recognizeText(options: {
    image: string;
    languages?: string[];
  }): Promise<VisionOCRResult>;
}

const VisionOCR = registerPlugin<VisionOCRPlugin>('VisionOCR');

export default VisionOCR;
