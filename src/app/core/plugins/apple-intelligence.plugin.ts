import { registerPlugin } from '@capacitor/core';

export interface AppleReceiptExtraction {
  merchant: string;
  /** Purchase date as YYYY-MM-DD, or '' when not found on the receipt */
  date: string;
  /**
   * 'refund' when the receipt records money the merchant gave back, 'purchase' otherwise. Optional only so
   * a literal or an answer without the key still types: the app ships its web assets inside the native
   * build, so both halves always arrive together. The model's verdict alone: NativeReceiptService weighs it
   * against the mark printed on the same total (ADR 0162), and reads any other value as no verdict at all.
   */
  kind?: 'purchase' | 'refund';
  /** The final total as a positive number: what was paid, or on a refund what was given back */
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Category name chosen from the provided list, or '' when none fits */
  category: string;
  /** Short per-line summary of purchased items */
  details: string;
  /** Branch/address as printed, '' when none, absent from a native build older than this field */
  location?: string;
  /** ISO 3166-1 alpha-2 as the model concluded it, '' when it could not, absent from a native build older than this field */
  country?: string;
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
