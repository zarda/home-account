import { Injectable, inject } from '@angular/core';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { ProcessedTransaction, ProcessingResult } from './ai-types';
import { parseReceiptOcrText } from './receipt-text-parser';
import { fileToBase64 } from '../utils/file.utils';
import { OCR_LANGUAGES } from '../config/ai-models';
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
      confidence: ocrResult.confidence,
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

    for (const file of imageFiles) {
      const ocrResult = await this.recognize(file);
      transactions.push(await this.structureOcrResult(ocrResult));
      totalConfidence += ocrResult.confidence;
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
    return this.visionOcr.recognizeText({
      image: imageBase64,
      languages: OCR_LANGUAGES,
    });
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
    const extraction = await this.appleIntelligence.parseReceiptText({
      text: ocrResult.text,
      categories: categories.map(c => c.name),
    });

    const parsedDate = extraction.date ? new Date(extraction.date) : new Date();
    const matchedCategory = extraction.category
      ? categories.find(c => c.name.toLowerCase() === extraction.category.toLowerCase())
      : undefined;

    return {
      date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
      description: extraction.merchant || 'Unknown Merchant',
      amount: Math.abs(extraction.amount) || 0,
      type: 'expense',
      currency: extraction.currency || 'USD',
      confidence: ocrResult.confidence,
      source: 'native',
      notes: extraction.details || undefined,
      suggestedCategoryId: matchedCategory?.id,
    };
  }

  private parseWithRegex(ocrResult: VisionOCRResult): ProcessedTransaction {
    const parsed = parseReceiptOcrText(ocrResult.text);
    return {
      date: parsed.date,
      description: parsed.merchant,
      amount: parsed.amount,
      type: 'expense',
      currency: parsed.currency,
      confidence: ocrResult.confidence,
      source: 'native',
    };
  }
}
