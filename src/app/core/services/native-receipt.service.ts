import { Injectable, inject } from '@angular/core';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { ProcessedTransaction, ProcessingResult } from './ai-types';
import { parseReceiptOcrText } from './receipt-text-parser';
import { buildCategoryPromptCatalog, matchCategoryName } from '../utils/categorization.utils';
import {
  printedLocationSlot,
  readCurrencyCode,
  readPrintedLocation,
} from '../utils/receipt-extraction.utils';
import { parseDateInput } from '../utils/transaction-date.utils';
import { fileToBase64 } from '../utils/file.utils';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';

/**
 * On-device receipt pipeline: Vision OCR recognizes the text, then Apple's
 * foundation model (Apple Intelligence) structures it into transaction data.
 * Falls back to the regex parser when the model is unavailable or fails.
 * Knows nothing about cloud providers — fallback routing lives in
 * AIStrategyService.
 */
@Injectable({ providedIn: 'root' })
export class NativeReceiptService {
  private visionOcr = inject(VisionOcrService);
  private appleIntelligence = inject(AppleIntelligenceService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);

  /**
   * Process a single receipt image on device.
   * Throws when Vision OCR is unavailable so callers can fall back.
   */
  async processImage(imageFile: File): Promise<ProcessingResult> {
    await this.ensureAvailable();

    const ocrResult = await this.recognize(imageFile);
    const transaction = await this.structureOcrResult(ocrResult);

    return {
      transactions: [transaction],
      source: 'native',
      confidence: transaction.confidence,
      processingTimeMs: 0,
    };
  }

  /**
   * Process multiple receipt images on device, one transaction per image.
   */
  async processImages(imageFiles: File[]): Promise<ProcessingResult> {
    await this.ensureAvailable();

    const transactions: ProcessedTransaction[] = [];
    let totalConfidence = 0;

    for (let i = 0; i < imageFiles.length; i++) {
      const ocrResult = await this.recognize(imageFiles[i]);
      const transaction = await this.structureOcrResult(ocrResult);
      // One receipt per photo, so the photo mapping is the loop index —
      // it is what lets the confirm step attach the right photo later.
      transactions.push({ ...transaction, imageIndex: i });
      totalConfidence += transaction.confidence;
    }

    return {
      transactions,
      source: 'native',
      confidence: transactions.length > 0 ? totalConfidence / transactions.length : 0,
      processingTimeMs: 0,
    };
  }

  private async ensureAvailable(): Promise<void> {
    const { available } = await this.visionOcr.isAvailable();
    if (!available) {
      throw new Error('Vision OCR is not available on this device.');
    }
  }

  private async recognize(imageFile: File): Promise<VisionOCRResult> {
    const imageBase64 = await fileToBase64(imageFile);
    // No languages: Vision detects the script itself, and naming any would only
    // move the ones we did not name further down its list.
    return this.visionOcr.recognizeText({ image: imageBase64 });
  }

  /**
   * Structure an OCR result into a transaction. Uses Apple's on-device
   * foundation model when available; falls back to the regex-based parser.
   */
  private async structureOcrResult(ocrResult: VisionOCRResult): Promise<ProcessedTransaction> {
    if (this.appleIntelligence.isModelAvailable()) {
      try {
        return await this.parseWithAppleIntelligence(ocrResult);
      } catch (error) {
        console.warn('[NativeReceipt] Apple Intelligence parsing failed, using basic parser:', error);
      }
    }
    return this.parseWithRegex(ocrResult);
  }

  /**
   * Structure OCR text with Apple's on-device foundation model.
   */
  private async parseWithAppleIntelligence(ocrResult: VisionOCRResult): Promise<ProcessedTransaction> {
    const categories = this.categoryService.categories();
    const translate = (name: string) => this.translationService.t(name);
    // The same two chokepoints as the cloud providers (ADR 0046): the stored
    // name of every default category is an i18n key, so the model's vocabulary
    // is the shared catalog rendering — active entries only, translated
    // `id: Name` lines — and never the keys themselves.
    const catalog = buildCategoryPromptCatalog(categories, translate);
    const extraction = await this.appleIntelligence.parseReceiptText({
      text: ocrResult.text,
      // An empty catalog splits to [''], which the plugin would render as a
      // one-empty-entry list instead of omitting the instruction.
      categories: catalog ? catalog.split('\n') : [],
    });

    // Ids resolve first, then display names in every shipped locale, then
    // keywords; `matched` keeps an answer we failed to understand
    // distinguishable from a deliberate "Other".
    const match = extraction.category
      ? matchCategoryName(extraction.category, categories, translate)
      : undefined;

    return {
      // The model answers `YYYY-MM-DD`, which the Date constructor reads as UTC
      // midnight — the day before, west of UTC. parseDateInput anchors on the
      // day-key shape and returns null rather than an Invalid Date, so the
      // fallback covers an unreadable string too.
      date: parseDateInput(extraction.date) ?? new Date(),
      description: extraction.merchant || 'Unknown Merchant',
      amount: Math.abs(extraction.amount) || 0,
      type: 'expense',
      // Report what was read, empty when nothing was. The consumer knows the
      // account's base currency; this service does not.
      currency: readCurrencyCode(extraction.currency),
      confidence: ocrResult.confidence,
      source: 'native',
      notes: extraction.details || undefined,
      suggestedCategoryId: match?.matched ? match.id : undefined,
      ...printedLocationSlot(readPrintedLocation(extraction.location, extraction.merchant)),
    };
  }

  private parseWithRegex(ocrResult: VisionOCRResult): ProcessedTransaction {
    const parsed = parseReceiptOcrText(ocrResult.text);
    return {
      date: parsed.date,
      description: parsed.merchant,
      amount: parsed.amount,
      type: 'expense',
      // The parser reports no currency rather than inventing one, and neither
      // does this service — AIStrategyService substitutes the account's base
      // currency and flags the row for review.
      currency: readCurrencyCode(parsed.currency),
      // Vision says how clearly it read the characters, the parser says how
      // much of a transaction it found in them. Both have to count: a receipt
      // in a script the parser has no hold on scans perfectly and parses to
      // nothing, and a caller looking only at Vision's number would take that
      // for a good result.
      confidence: ocrResult.confidence * parsed.confidence,
      source: 'native',
      // The regex parser cannot itemize, but the recognized text IS the
      // receipt's line-by-line content — record it so item details reach
      // the transaction note
      notes: ocrResult.text?.trim() || undefined,
      fieldConfidence: { amount: parsed.amountConfidence },
      // This parser reads figures and evidence tiers; it never looks at what
      // was bought. Saying so keeps the import from grading a row nobody
      // categorized as one whose category answer we failed to understand.
      categoryAttempted: false,
    };
  }
}
