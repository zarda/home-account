import { registerPlugin } from '@capacitor/core';

export interface AppleReceiptExtraction {
  merchant: string;
  /** Purchase date as YYYY-MM-DD, or '' when not found on the receipt */
  date: string;
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Category name chosen from the provided list, or '' when none fits */
  category: string;
  /** Short per-line summary of purchased items */
  details: string;
}

export interface AppleIntelligencePlugin {
  /**
   * Check whether Apple's on-device foundation model (Apple Intelligence)
   * can be used. Requires iOS 26 / macOS 26 with Apple Intelligence enabled.
   * `reason` explains unavailability: osNotSupported, deviceNotEligible,
   * appleIntelligenceNotEnabled, or modelNotReady.
   */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;

  /**
   * Structure OCR receipt text into transaction data using the on-device model.
   * @param options.text - Receipt text recognized by Vision OCR
   * @param options.categories - Category names the model may choose from
   */
  parseReceiptText(options: {
    text: string;
    categories?: string[];
  }): Promise<AppleReceiptExtraction>;
}

const AppleIntelligence = registerPlugin<AppleIntelligencePlugin>('AppleIntelligence');

export default AppleIntelligence;
