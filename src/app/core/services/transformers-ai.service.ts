import { Injectable, signal, computed, inject } from '@angular/core';
import { MLWorkerService, MLModelType } from './ml-worker.service';

/**
 * Enhanced receipt parsing with three modes:
 * 1. Rule-based: Fast, no download required, good for common receipts
 * 2. ML QA-powered: Uses Transformers.js question-answering (~65MB download, English-optimized)
 * 3. ML Embeddings: Uses multilingual embeddings (~120MB download, best for TC/JP)
 */

export type { MLModelType } from './ml-worker.service';

export interface ExtractedField {
  field: string;
  value: string;
  confidence: number;
}

export interface SemanticParseResult {
  merchant: string;
  merchantConfidence: number;
  date: string;
  dateConfidence: number;
  total: number;
  totalConfidence: number;
  currency: string;
  currencyConfidence: number;
  items: ParsedItem[];
  overallConfidence: number;
  rawAnswers: ExtractedField[];
}

export interface ParsedItem {
  name: string;
  price: number;
  quantity?: number;
  confidence: number;
}

// Receipt structure patterns (reserved for section-based parsing)
const _RECEIPT_SECTIONS = {
  header: /^.{0,200}/,  // First 200 chars typically contain merchant
  footer: /.{0,200}$/,  // Last 200 chars typically contain totals
};
void _RECEIPT_SECTIONS;

// Enhanced patterns for different regions
const REGIONAL_PATTERNS = {
  // Taiwan patterns
  taiwan: {
    total: [/總計[:\s]*(?:NT\$|＄)?[\s]*([\d,]+)/i, /合計[:\s]*(?:NT\$)?[\s]*([\d,]+)/i, /應付[:\s]*([\d,]+)/i],
    merchant: [/統一發票/, /發票號碼/, /電子發票/],
    date: [/民國\s*(\d{2,3})年(\d{1,2})月(\d{1,2})日/, /(\d{2,3})\/(\d{1,2})\/(\d{1,2})/],
    currency: 'TWD',
  },
  // Hong Kong patterns  
  hongkong: {
    total: [/總數[:\s]*(?:HK\$)?[\s]*([\d,]+\.?\d*)/i, /TOTAL[:\s]*(?:HK\$)?[\s]*([\d,]+\.?\d*)/i],
    merchant: [/收據/, /RECEIPT/i],
    date: [/(\d{1,2})\/(\d{1,2})\/(\d{4})/],
    currency: 'HKD',
  },
  // Japan patterns
  japan: {
    total: [
      // Tax-inclusive totals (prioritized)
      /税込合計[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /合計[（(]税込[)）][:\s]*[¥￥]?[\s]*([\d,]+)/,
      /お会計[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /お支払い[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /ご請求額[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /領収金額[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /合計[:\s]*[¥￥]?[\s]*([\d,]+)/,
      /計[:\s]*[¥￥]?[\s]*([\d,]+)/,
    ],
    merchant: [/株式会社/, /有限会社/, /合同会社/, /レシート/, /領収書/],
    date: [
      /(\d{4})年(\d{1,2})月(\d{1,2})日/,
      /令和\s*(\d{1,2})年(\d{1,2})月(\d{1,2})日/,
      /平成\s*(\d{1,2})年(\d{1,2})月(\d{1,2})日/,
      /R\s*(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})/i, // R6.01.15 format
    ],
    currency: 'JPY',
  },
  // US/International patterns
  international: {
    total: [/TOTAL[:\s]*\$?[\s]*([\d,]+\.?\d*)/i, /GRAND TOTAL[:\s]*\$?[\s]*([\d,]+\.?\d*)/i, /AMOUNT DUE[:\s]*\$?[\s]*([\d,]+\.?\d*)/i],
    merchant: [/RECEIPT/i, /INVOICE/i],
    date: [/(\d{1,2})\/(\d{1,2})\/(\d{4})/, /(\d{4})-(\d{2})-(\d{2})/],
    currency: 'USD',
  },
};

@Injectable({ providedIn: 'root' })
export class TransformersAIService {
  // ML Worker for Transformers.js processing
  private mlWorker = inject(MLWorkerService);

  // State signals for rule-based (always ready)
  private _isReady = signal<boolean>(true);
  private _isLoading = signal<boolean>(false);
  private _progress = signal<number>(0);
  private _status = signal<string>('');
  private _error = signal<string | null>(null);
  
  // Public computed signals
  isReady = computed(() => this._isReady());
  isLoading = computed(() => this._isLoading() || this.mlWorker.isLoading());
  progress = computed(() => this.mlWorker.isLoading() ? this.mlWorker.progress() : this._progress());
  status = computed(() => this.mlWorker.isLoading() ? this.mlWorker.status() : this._status());
  error = computed(() => this.mlWorker.error() || this._error());
  
  // ML model status (from worker)
  mlModelReady = computed(() => this.mlWorker.isReady());
  mlModelSupported = computed(() => this.mlWorker.isSupported());
  modelSize = computed(() => this.mlWorker.modelSize());
  currentMLModelType = computed(() => this.mlWorker.currentModelType());
  mlModelWasDownloaded = computed(() => this.mlWorker.wasDownloaded());

  /**
   * Get the saved model type preference.
   */
  getSavedModelType(): MLModelType {
    return this.mlWorker.getSavedModelType();
  }

  constructor() {
    // Rule-based processing is always ready
    // ML model needs to be downloaded separately
  }

  /**
   * Initialize rule-based processing (always available).
   */
  async initialize(): Promise<void> {
    this._isReady.set(true);
    this._status.set('Enhanced parsing ready');
  }

  /**
   * Download and initialize the ML model.
   * @param modelType - 'qa' for English QA (~65MB), 'embeddings' for multilingual (~120MB)
   */
  async downloadMLModel(modelType: MLModelType = 'qa'): Promise<void> {
    if (!this.mlWorker.isSupported()) {
      throw new Error('Web Workers not supported in this browser');
    }

    const modelInfo = this.mlWorker.getModelInfo(modelType);
    this._status.set(`Downloading ${modelInfo.name}...`);
    await this.mlWorker.initialize(modelType);
    this._status.set(`${modelInfo.name} ready`);
  }

  /**
   * Get info about available ML models.
   */
  getMLModels(): { type: MLModelType; name: string; sizeMB: number; description: string }[] {
    return [
      { 
        type: 'qa', 
        name: 'Question-Answering', 
        sizeMB: 65,
        description: 'English-optimized QA model for extracting receipt fields',
      },
      { 
        type: 'embeddings', 
        name: 'Multilingual Embeddings', 
        sizeMB: 120,
        description: 'Best for Traditional Chinese, Japanese, and multilingual receipts',
      },
    ];
  }

  /**
   * Check if ML model is downloaded and ready.
   */
  isMLReady(): boolean {
    return this.mlWorker.isReady();
  }

  /**
   * Parse OCR text to extract structured receipt data using advanced rules.
   */
  async parseReceiptText(ocrText: string): Promise<SemanticParseResult> {
    // Try ML-powered parsing first if model is ready
    if (this.mlWorker.isReady()) {
      try {
        this._status.set('Using ML model for parsing...');
        const mlResult = await this.mlWorker.parseReceipt(ocrText);
        
        // Detect region for items extraction (ML doesn't extract items)
        const region = this.detectRegion(ocrText);
        const items = this.extractItems(ocrText, region);
        
        // Convert ML result to SemanticParseResult
        const result: SemanticParseResult = {
          merchant: mlResult.merchant || 'Unknown Merchant',
          merchantConfidence: mlResult.merchantConfidence,
          date: mlResult.date,
          dateConfidence: mlResult.dateConfidence,
          total: mlResult.total,
          totalConfidence: mlResult.totalConfidence,
          currency: mlResult.currency,
          currencyConfidence: 0.8,
          items,
          overallConfidence: (mlResult.merchantConfidence + mlResult.dateConfidence + mlResult.totalConfidence) / 3,
          rawAnswers: Object.entries(mlResult.rawAnswers || {}).map(([field, data]) => ({
            field,
            value: (data as { answer?: string; value?: string }).answer || (data as { value?: string }).value || '',
            confidence: (data as { score?: number; confidence?: number }).score || (data as { confidence?: number }).confidence || 0,
          })),
        };
        
        this._status.set('');
        console.log('[TransformersAI] ML parsing result:', result);
        return result;
      } catch (error) {
        console.warn('[TransformersAI] ML parsing failed, falling back to rule-based:', error);
        // Fall through to rule-based parsing
      }
    }

    // Rule-based parsing (fallback or when ML not available)
    this._status.set('Analyzing receipt structure...');
    const rawAnswers: ExtractedField[] = [];
    
    // Detect region/locale based on text patterns
    const region = this.detectRegion(ocrText);
    const patterns = REGIONAL_PATTERNS[region];
    
    // Extract structured data using region-specific patterns
    const merchantResult = this.extractMerchant(ocrText, region);
    rawAnswers.push({ field: 'merchant', value: merchantResult.value, confidence: merchantResult.confidence });
    
    const dateResult = this.extractDate(ocrText, region);
    rawAnswers.push({ field: 'date', value: dateResult.value, confidence: dateResult.confidence });
    
    const totalResult = this.extractTotal(ocrText, patterns);
    rawAnswers.push({ field: 'total', value: String(totalResult.value), confidence: totalResult.confidence });
    
    const currency = patterns.currency;
    
    // Extract line items with enhanced parsing
    const items = this.extractItems(ocrText, region);
    
    // Calculate overall confidence
    const confidences = [
      merchantResult.confidence,
      dateResult.confidence,
      totalResult.confidence,
    ].filter(c => c > 0);
    
    const overallConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0.5;

    this._status.set('');

    return {
      merchant: merchantResult.value,
      merchantConfidence: merchantResult.confidence,
      date: dateResult.value,
      dateConfidence: dateResult.confidence,
      total: totalResult.value,
      totalConfidence: totalResult.confidence,
      currency,
      currencyConfidence: 0.8,
      items,
      overallConfidence,
      rawAnswers,
    };
  }

  /**
   * Detect the region/locale based on text patterns.
   */
  private detectRegion(text: string): keyof typeof REGIONAL_PATTERNS {
    // Check for Traditional Chinese (Taiwan) indicators
    if (/民國|統一發票|新台幣|NT\$/i.test(text)) {
      return 'taiwan';
    }
    
    // Check for Hong Kong indicators
    if (/HK\$|港幣|八達通/i.test(text)) {
      return 'hongkong';
    }
    
    // Check for Japanese indicators
    // Check for Japanese indicators
    if (/[¥￥]|円|レシート|領収書|令和|平成|税込|税抜|お会計|お支払い|株式会社|有限会社/.test(text)) {
      return 'japan';
    }
    
    // Check for Japanese text patterns (hiragana/katakana)
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      return 'japan';
    }
    
    // Default to international
    return 'international';
  }

  /**
   * Extract merchant name using multiple strategies.
   */
  private extractMerchant(text: string, _region: keyof typeof REGIONAL_PATTERNS): { value: string; confidence: number } {
    void _region; // Reserved for region-specific merchant patterns
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    
    // Skip patterns
    const skipPatterns = [
      /^tel/i, /^phone/i, /^fax/i, /^電話/, /^傳真/, /^地址/, /^℡/,
      /^\d{2}[/-]\d{2}/, /^\d{2}:\d{2}/, // Date/time
      /^http/i, /^www\./i, /^@/,
      /統一編號/, /發票號碼/, /載具/, /期數/,
      /^receipt/i, /^invoice/i, /^order/i,
      // Japanese-specific skip patterns
      /^〒?\d{3}-?\d{4}/, // Japanese postal code
      /^レシート$|^領収書$|^領収証$/i, // Just "receipt"
      /^登録番号|^インボイス|^適格請求書/i, // Invoice registration
      /^(営業時間|open|close)/i, // Business hours
      /^(店舗|店番|レジ|担当)/i, // Store/register info
      /^(東京都|大阪府|京都府|北海道|.{2,3}県)/, // Japanese prefecture (address)
    ];
    
    // Score candidates
    const candidates: { line: string; score: number }[] = [];
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      if (skipPatterns.some(p => p.test(line))) continue;
      if ((line.match(/\d/g) || []).length / line.length > 0.5) continue; // Too many digits
      
      let score = 10 - i; // Earlier lines score higher
      
      // Bonus for typical store name patterns
      if (/店|行|公司|超市|便利|餐廳|商場|百貨/i.test(line)) score += 5;
      if (/store|shop|mart|market|cafe|restaurant/i.test(line)) score += 5;
      if (line === line.toUpperCase() && /[A-Z]/.test(line)) score += 3; // All caps
      if (line.length >= 4 && line.length <= 30) score += 2; // Reasonable length
      
      // Japanese-specific patterns
      if (/株式会社|有限会社|合同会社|㈱|㈲/.test(line)) score += 7; // Company types
      if (/コンビニ|ストア|マート|スーパー|モール/.test(line)) score += 5; // Store types
      if (/ファミリーマート|セブン|ローソン|マクドナルド|スターバックス/.test(line)) score += 8; // Known chains
      if (/店$|屋$|堂$|亭$/.test(line)) score += 4; // Common store name endings
      
      candidates.push({ line, score });
    }
    
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0) {
      const best = candidates[0];
      return {
        value: this.titleCase(best.line),
        confidence: Math.min(0.9, 0.5 + best.score * 0.05),
      };
    }
    
    return { value: 'Unknown Merchant', confidence: 0.2 };
  }

  /**
   * Extract date using region-specific patterns.
   */
  private extractDate(text: string, region: keyof typeof REGIONAL_PATTERNS): { value: string; confidence: number } {
    const patterns = REGIONAL_PATTERNS[region].date;
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          let year: number, month: number, day: number;
          
          if (region === 'taiwan' && match[0].includes('民國')) {
            // ROC calendar
            year = 1911 + parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else if (region === 'japan' && match[0].includes('令和')) {
            // Reiwa era (令和 started 2019)
            year = 2018 + parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else if (region === 'japan' && match[0].includes('平成')) {
            // Heisei era (平成 1989-2019)
            year = 1988 + parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else if (region === 'japan' && /^R\s*\d/i.test(match[0])) {
            // Reiwa shorthand (R6.01.15)
            year = 2018 + parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else if (match[1].length === 4) {
            // YYYY-MM-DD format
            year = parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else if (match[3].length === 4) {
            // DD/MM/YYYY or MM/DD/YYYY
            const first = parseInt(match[1], 10);
            const second = parseInt(match[2], 10);
            year = parseInt(match[3], 10);
            // Heuristic: if first > 12, it's day
            if (first > 12) {
              day = first;
              month = second;
            } else {
              month = first;
              day = second;
            }
          } else {
            // ROC short format (e.g., 113/01/15)
            const rocYear = parseInt(match[1], 10);
            year = rocYear > 100 ? 1911 + rocYear : 2000 + rocYear;
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          }
          
          if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return {
              value: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
              confidence: 0.85,
            };
          }
        } catch {
          continue;
        }
      }
    }
    
    // Fallback: look for any date-like pattern
    const genericMatch = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (genericMatch) {
      return {
        value: `${genericMatch[1]}-${genericMatch[2].padStart(2, '0')}-${genericMatch[3].padStart(2, '0')}`,
        confidence: 0.7,
      };
    }
    
    return { value: new Date().toISOString().split('T')[0], confidence: 0.3 };
  }

  /**
   * Extract total amount using region-specific patterns.
   */
  private extractTotal(text: string, patterns: typeof REGIONAL_PATTERNS.taiwan): { value: number; confidence: number } {
    let bestTotal = 0;
    let bestConfidence = 0;
    
    for (const pattern of patterns.total) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > bestTotal && amount < 1000000) {
          bestTotal = amount;
          bestConfidence = 0.85;
        }
      }
    }
    
    // If no specific pattern matched, look for the largest amount near "total" keyword
    if (bestTotal === 0) {
      const totalLineMatch = text.match(/(?:total|合計|總計|金額)[:\s]*[^\d]*?([\d,]+\.?\d*)/i);
      if (totalLineMatch) {
        const amount = parseFloat(totalLineMatch[1].replace(/,/g, ''));
        if (!isNaN(amount)) {
          bestTotal = amount;
          bestConfidence = 0.7;
        }
      }
    }
    
    return { value: bestTotal, confidence: bestConfidence };
  }

  /**
   * Extract line items with enhanced parsing.
   */
  private extractItems(text: string, _region: keyof typeof REGIONAL_PATTERNS): ParsedItem[] {
    void _region; // Reserved for region-specific item patterns
    const items: ParsedItem[] = [];
    const lines = text.split('\n');
    
    // Skip patterns for non-item lines
    const skipPatterns = [
      /^total/i, /^subtotal/i, /^sub-total/i,
      /^合計/, /^小計/, /^總計/, /^稅/, /^營業稅/, /^服務費/,
      /^tax/i, /^vat/i, /^gst/i, /^service/i,
      /^cash/i, /^change/i, /^card/i, /^payment/i,
      /^找零/, /^現金/, /^信用卡/, /^發票/, /^統編/,
      /^date/i, /^time/i, /^日期/, /^時間/,
      /^\d{2}[/-]\d{2}/, /^\d{2}:\d{2}/,
      /^thank/i, /^謝謝/, /^歡迎/,
    ];
    
    // Item pattern: text followed by price
    const itemPatterns = [
      /^(.{3,40})\s+(?:NT\$|HK\$|\$|¥)?[\s]*([\d,]+\.?\d{0,2})\s*$/,
      /^(\d+)\s*[x×@]\s*(.{3,30})\s+([\d,]+\.?\d{0,2})\s*$/, // Qty x Item Price
    ];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 5 || trimmed.length > 80) continue;
      if (skipPatterns.some(p => p.test(trimmed))) continue;
      
      // Try quantity pattern first
      const qtyMatch = trimmed.match(itemPatterns[1]);
      if (qtyMatch) {
        const qty = parseInt(qtyMatch[1], 10);
        const name = qtyMatch[2].trim();
        const price = parseFloat(qtyMatch[3].replace(/,/g, ''));
        
        if (!isNaN(price) && price > 0 && price < 10000 && name.length > 1) {
          items.push({
            name: this.titleCase(name),
            price,
            quantity: qty,
            confidence: 0.8,
          });
          continue;
        }
      }
      
      // Try standard item pattern
      const itemMatch = trimmed.match(itemPatterns[0]);
      if (itemMatch) {
        let name = itemMatch[1].trim();
        const price = parseFloat(itemMatch[2].replace(/,/g, ''));
        
        if (!isNaN(price) && price > 0 && price < 10000 && name.length > 1) {
          // Check for embedded quantity
          let quantity: number | undefined;
          const embeddedQty = name.match(/^(\d+)\s*[x×@]\s*/i);
          if (embeddedQty) {
            quantity = parseInt(embeddedQty[1], 10);
            name = name.slice(embeddedQty[0].length).trim();
          }
          
          items.push({
            name: this.titleCase(name),
            price,
            quantity,
            confidence: 0.75,
          });
        }
      }
    }
    
    // Deduplicate
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.name.toLowerCase().substring(0, 15)}_${item.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Convert to title case.
   */
  private titleCase(text: string): string {
    // Don't modify CJK text
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) {
      return text;
    }
    return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Check if the service can process offline.
   */
  canProcessOffline(): boolean {
    return true; // Always available - no model download needed
  }

  /**
   * Get the model size for display.
   */
  getModelSizeMB(): number {
    return 0; // No external model
  }

  /**
   * Preload the ML model for offline use.
   * Downloads ~65MB model on first call.
   */
  async preloadModel(): Promise<void> {
    // Rule-based is always ready
    this._isReady.set(true);
    
    // Also download ML model if supported
    if (this.mlWorker.isSupported() && !this.mlWorker.isReady()) {
      await this.downloadMLModel();
    }
    
    this._status.set('All models ready');
  }

  /**
   * Download only the ML model (without rule-based, which is always ready).
   * @param modelType - 'qa' for English QA, 'embeddings' for multilingual
   */
  async downloadMLModelOnly(modelType: MLModelType = 'qa'): Promise<void> {
    if (!this.mlWorker.isSupported()) {
      throw new Error('Web Workers not supported');
    }
    await this.mlWorker.initialize(modelType);
  }

  /**
   * Terminate ML worker and free resources.
   */
  async terminate(): Promise<void> {
    this.mlWorker.terminate();
    this._status.set('');
  }

  /**
   * Get the ML model download size in bytes for a specific model type.
   */
  getMLModelSize(modelType?: MLModelType): number {
    const type = modelType || this.mlWorker.currentModelType();
    return this.mlWorker.getModelInfo(type).sizeMB * 1024 * 1024;
  }

  /**
   * Get formatted ML model size.
   */
  getMLModelSizeFormatted(modelType?: MLModelType): string {
    const type = modelType || this.mlWorker.currentModelType();
    return `${this.mlWorker.getModelInfo(type).sizeMB} MB`;
  }

  /**
   * Get the current ML model type name.
   */
  getCurrentMLModelName(): string {
    return this.mlWorker.getModelInfo(this.mlWorker.currentModelType()).name;
  }
}
