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

export interface VisionOCRPlugin {
  /**
   * Check if Vision OCR is available on this device (iOS 13+)
   */
  isAvailable(): Promise<{ available: boolean }>;

  /**
   * Recognize text from a base64-encoded image
   * @param options.image - Base64-encoded image (with or without data URL prefix)
   * @param options.languages - Array of language codes (e.g., ['en-US', 'ja-JP', 'zh-Hant'])
   */
  recognizeText(options: {
    image: string;
    languages?: string[];
  }): Promise<VisionOCRResult>;
}

const VisionOCR = registerPlugin<VisionOCRPlugin>('VisionOCR');

export default VisionOCR;
