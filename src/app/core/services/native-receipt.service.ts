import { Injectable, inject } from '@angular/core';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { ProcessedTransaction, ProcessingResult } from './ai-types';
import { DEMOTION_FACTOR, ParsedReceiptText, parseReceiptOcrText } from './receipt-text-parser';
import { buildCategoryPromptCatalog, categoryFitsType, matchCategoryName } from '../utils/categorization.utils';
import {
  MODEL_INCOME_GRADE,
  printedLocationSlot,
  readCountryCode,
  readCurrencyCode,
  readPrintedLocation,
} from '../utils/receipt-extraction.utils';
import { parseDateInput } from '../utils/transaction-date.utils';
import { fileToBase64 } from '../utils/file.utils';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import { REVIEW_AMOUNT_CONFIDENCE } from '../utils/receipt-consolidation';
import { VERIFY_FIELD_THRESHOLD, roundToMinorUnit } from '../../models';

/**
 * ADR 0045's evidence grade: a reading with nothing else to corroborate or
 * dispute it — an extraction that named something, or a date the constructor
 * accepted, and no second source to weigh against it.
 */
const MODEL_READ_GRADE = 0.8;

/** The model read a refund, and the same total prints as a negative. */
const AGREED_INCOME_GRADE = 0.6;

/**
 * A purchase the print argues with: the same total prints as a negative, or a
 * negative prints on a total the model did not read.
 */
const DISPUTED_TYPE_GRADE = 0.3;

/**
 * Which way the money moved, and the grade the row carries for it (ADR 0162).
 * Two witnesses speak to it: the on-device model's `kind`, read from the
 * receipt's words, and the marks the receipt prints on its total as the text
 * parser reports them — `printed` only when they are the marks on the row's
 * own total. Neither is a measurement, so every grade sits under
 * VERIFY_FIELD_THRESHOLD: every income row a device reads is flagged for a
 * look wherever it is reviewed, and so is an expense the receipt argued with.
 * A refund the print backs grades higher than one it is silent on, and a
 * purchase the model read stays an expense when its total prints as a
 * negative, flagged. A purchase nothing contradicts carries no grade at all.
 *
 * `markedElsewhere` says the receipt prints a negative on some other total
 * than the one the model read. That backs no refund and files no income, but
 * it argues with the purchase the row is, so the row is an expense, flagged.
 *
 * `kind` is compared strictly: anything but the two values the model is
 * offered counts as no verdict, as on the regex lane, where no model answers,
 * and leaves the print to decide alone. The sign of a figure is never a
 * witness (ADR 0147).
 */
function typeVerdict(
  kind: unknown,
  printed?: Pick<ParsedReceiptText, 'direction' | 'directionConfidence'>,
  markedElsewhere = false
): { type: 'income' | 'expense'; grade?: number } {
  const marked = printed?.direction === 'credit';
  if (kind === 'refund') {
    return { type: 'income', grade: marked ? AGREED_INCOME_GRADE : MODEL_INCOME_GRADE };
  }
  if (printed && marked) {
    return kind === 'purchase'
      ? { type: 'expense', grade: DISPUTED_TYPE_GRADE }
      : { type: 'income', grade: printed.directionConfidence };
  }
  // The same figure printed both marked and unmarked: a purchase still, but
  // one the print argued with, at the parser's own grade for it
  // (`TWINNED_MARK_GRADE`, ADR 0162).
  if (printed && printed.directionConfidence > 0) {
    return { type: 'expense', grade: printed.directionConfidence };
  }
  // A negative on a total the model did not read: an expense still, and one
  // the print argued with.
  if (markedElsewhere) {
    return { type: 'expense', grade: DISPUTED_TYPE_GRADE };
  }
  return { type: 'expense' };
}

/**
 * Whether the text parser read its total among the figures it read beside a
 * currency mark, and a rule or the cash-tendered sum then moved or kept it
 * there: the tier's grade under DEMOTION_FACTOR, a reading that would have
 * passed the review bar but for the demotion. A demoted pick from the weaker
 * tiers says no more about the print than an undemoted one there (ADR 0186).
 */
function demotedBesideCurrency(text: ParsedReceiptText): boolean {
  return (
    text.amountDemotion !== undefined &&
    text.amountConfidence >= VERIFY_FIELD_THRESHOLD * DEMOTION_FACTOR
  );
}

/**
 * Whether a rule, rather than the print, picked that total: any demotion but
 * the cash-tendered sum, which is arithmetic on the print.
 */
function pickedByRule(text: ParsedReceiptText): boolean {
  return demotedBesideCurrency(text) && text.amountDemotion !== 'tender';
}

/**
 * The amount grade when the model and the text parser read the same total.
 * Agreement backs what the parser read off the print, the cash-tendered sum
 * included, up to MODEL_READ_GRADE. A total a rule picked is a guess a model
 * reading the same text can share, so the parser's own grade stands, under
 * the bar.
 */
function agreedAmountGrade(text: ParsedReceiptText): number {
  return pickedByRule(text)
    ? text.amountConfidence
    : Math.max(text.amountConfidence, MODEL_READ_GRADE);
}

/**
 * The amount grade when the two read different totals. A parser that read its
 * figure beside a currency mark disputes the model's, and the row is flagged,
 * a figure a rule or the cash-tendered sum moved there included: a model that
 * reads the cash handed over or the change is wrong as surely as one that
 * reads a count. A disagreement with a parser that did not trust its own
 * reading is no evidence against the model.
 */
function disputedAmountGrade(text: ParsedReceiptText): number {
  return text.amountConfidence >= VERIFY_FIELD_THRESHOLD || demotedBesideCurrency(text)
    ? REVIEW_AMOUNT_CONFIDENCE
    : MODEL_READ_GRADE;
}

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
    // `id: Name` lines — and never the keys themselves. The catalog and the
    // resolver both stay on the expense side even for a refund: its slip
    // lists the goods going back, which only expense entries name. The row's
    // type is decided below, and the import doors move an expense category
    // off an income row onto the income side's catch-all.
    const catalog = buildCategoryPromptCatalog(categories, translate, 'expense');
    const expenseCategories = categories.filter(c => categoryFitsType(c, 'expense'));
    const extraction = await this.appleIntelligence.parseReceiptText({
      text: ocrResult.text,
      // An empty catalog splits to [''], which the plugin would render as a
      // one-empty-entry list instead of omitting the instruction.
      categories: catalog ? catalog.split('\n') : [],
    });

    // Ids resolve first, then display names in every shipped locale, then
    // keywords; `matched` keeps an answer we failed to understand
    // distinguishable from a deliberate "Other". Resolving against the same
    // expense-only list the model was offered keeps an income category it
    // knows from elsewhere from resolving here at all.
    const match = extraction.category
      ? matchCategoryName(extraction.category, expenseCategories, translate)
      : undefined;
    const country = readCountryCode(extraction.country);
    // The model answers `YYYY-MM-DD`, which the Date constructor reads as UTC
    // midnight — the day before, west of UTC. parseDateInput anchors on the
    // day-key shape and returns null rather than an Invalid Date, so the
    // fallback covers an unreadable string too.
    const parsedDate = parseDateInput(extraction.date);
    // A magnitude whichever way the money moved. The schema bounds the model's
    // total at zero, so this should change nothing, but that bound is
    // compile-checked only (ADR 0040), and a minus is not a verdict on the type
    // (ADR 0147) — the model's `kind` is — so one is dropped here.
    const amount = Math.abs(extraction.amount) || 0;
    // Report what was read, empty when nothing was. The consumer knows the
    // account's base currency; this service does not.
    const currency = readCurrencyCode(extraction.currency);

    // The plugin reports no confidence of its own, so the only corroboration
    // for its total is running the same OCR text through the regex reader and
    // comparing the two — in whichever currency either side actually read, or
    // at two decimal places when neither did (roundToMinorUnit's own fallback
    // for an unrecognized code).
    const text = parseReceiptOcrText(ocrResult.text);
    const amountCurrency = currency || text.currency;
    const sameTotal = amount > 0 &&
      roundToMinorUnit(amount, amountCurrency) === roundToMinorUnit(text.amount, amountCurrency);
    // The model says which way the money moved, and the print is the second
    // witness. Its marks speak for this row only when they are the marks on
    // the total the model read. A negative on some other total backs no refund
    // and files no income, but it flags a purchase, and only where the model
    // read a total at all.
    const verdict = typeVerdict(
      extraction.kind,
      sameTotal ? text : undefined,
      amount > 0 && !sameTotal && text.direction === 'credit'
    );

    return {
      date: parsedDate ?? new Date(),
      description: extraction.merchant || 'Unknown Merchant',
      amount,
      type: verdict.type,
      currency,
      confidence: ocrResult.confidence,
      source: 'native',
      notes: extraction.details || undefined,
      suggestedCategoryId: match?.matched ? match.id : undefined,
      ...printedLocationSlot(readPrintedLocation(extraction.location, extraction.merchant), country),
      ...(country ? { receiptCountry: country } : {}),
      // An unreadable field has to say so itself rather than silently landing
      // on a fallback (today's date, a zero amount) with no mark at all.
      fieldConfidence: {
        amount: !(amount > 0)
          ? 0
          : sameTotal
            ? agreedAmountGrade(text)
            : disputedAmountGrade(text),
        date: parsedDate === null ? 0 : MODEL_READ_GRADE,
        ...(verdict.grade !== undefined ? { type: verdict.grade } : {}),
      },
    };
  }

  private parseWithRegex(ocrResult: VisionOCRResult): ProcessedTransaction {
    const parsed = parseReceiptOcrText(ocrResult.text);
    // No model here, so the marks on the total are the only witness to which
    // way the money moved.
    const verdict = typeVerdict(undefined, parsed);
    return {
      date: parsed.date,
      description: parsed.merchant,
      amount: parsed.amount,
      type: verdict.type,
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
      fieldConfidence: {
        amount: parsed.amountConfidence,
        date: parsed.dateConfidence,
        ...(verdict.grade !== undefined ? { type: verdict.grade } : {}),
      },
      // This parser reads figures and evidence tiers; it never looks at what
      // was bought. Saying so keeps the import from grading a row nobody
      // categorized as one whose category answer we failed to understand.
      categoryAttempted: false,
    };
  }
}
