/// <reference lib="webworker" />

/**
 * Web Worker for Transformers.js ML processing.
 * Runs in a separate thread to keep the UI responsive.
 * 
 * Supports two model types:
 * - 'qa': Question-answering model (English only, ~65MB)
 * - 'embeddings': Multilingual embeddings model (~120MB)
 */

// Types for messages
interface WorkerMessage {
  type: 'init' | 'parse' | 'status' | 'terminate';
  id: string;
  payload?: unknown;
}

interface WorkerResponse {
  type: 'ready' | 'progress' | 'result' | 'error';
  id: string;
  payload?: unknown;
}

type ModelType = 'qa' | 'embeddings';

// Pipeline and model state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: any = null;
let isInitializing = false;
let isReady = false;
let currentModelType: ModelType = 'qa';

// Model configurations
const MODELS = {
  qa: {
    id: 'Xenova/distilbert-base-cased-distilled-squad',
    task: 'question-answering' as const,
    sizeMB: 65,
  },
  embeddings: {
    id: 'Xenova/multilingual-e5-small',
    task: 'feature-extraction' as const,
    sizeMB: 120,
  },
};

/**
 * Send a message back to the main thread.
 */
function sendMessage(response: WorkerResponse): void {
  self.postMessage(response);
}

/**
 * Send progress update.
 */
function sendProgress(id: string, progress: number, status: string): void {
  sendMessage({
    type: 'progress',
    id,
    payload: { progress, status },
  });
}

/**
 * Initialize the Transformers.js pipeline.
 */
async function initializePipeline(id: string, modelType: ModelType = 'qa'): Promise<void> {
  // If already ready with the same model type, return cached
  if (isReady && pipeline && currentModelType === modelType) {
    sendMessage({ type: 'ready', id, payload: { cached: true, modelType } });
    return;
  }

  if (isInitializing) {
    sendMessage({ type: 'error', id, payload: { error: 'Already initializing' } });
    return;
  }

  isInitializing = true;
  currentModelType = modelType;
  const modelConfig = MODELS[modelType];
  
  sendProgress(id, 0, 'Loading Transformers.js...');

  try {
    // Dynamic import of transformers
    const { pipeline: createPipeline, env } = await import('@huggingface/transformers');
    
    // Configure for browser/worker usage
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    
    sendProgress(id, 10, `Downloading ${modelType} model (~${modelConfig.sizeMB}MB)...`);

    // Create the pipeline based on model type
    const createdPipeline = await createPipeline(modelConfig.task, modelConfig.id, {
      progress_callback: (progressInfo: { status?: string; progress?: number; file?: string }) => {
        if (progressInfo.progress !== undefined) {
          const progress = Math.round(10 + progressInfo.progress * 0.85);
          sendProgress(id, progress, progressInfo.status || 'Downloading...');
        }
      },
    });

    pipeline = createdPipeline;
    isReady = true;
    isInitializing = false;

    sendProgress(id, 100, 'Model ready');
    sendMessage({ type: 'ready', id, payload: { cached: false, modelType } });

    console.log(`[ML Worker] ${modelType} pipeline initialized successfully`);
  } catch (error) {
    isInitializing = false;
    console.error('[ML Worker] Failed to initialize:', error);
    sendMessage({
      type: 'error',
      id,
      payload: { error: error instanceof Error ? error.message : 'Failed to initialize model' },
    });
  }
}

/**
 * Parse receipt text using the current model.
 */
async function parseReceipt(
  id: string,
  text: string
): Promise<void> {
  if (!pipeline || !isReady) {
    sendMessage({
      type: 'error',
      id,
      payload: { error: 'Model not initialized. Call init first.' },
    });
    return;
  }

  try {
    if (currentModelType === 'qa') {
      await parseWithQA(id, text);
    } else {
      await parseWithEmbeddings(id, text);
    }
  } catch (error) {
    console.error('[ML Worker] Parse error:', error);
    sendMessage({
      type: 'error',
      id,
      payload: { error: error instanceof Error ? error.message : 'Failed to parse receipt' },
    });
  }
}

/**
 * Parse receipt using QA model (English-optimized).
 */
async function parseWithQA(id: string, text: string): Promise<void> {
  sendProgress(id, 0, 'Analyzing receipt with QA...');

  // Questions to extract receipt information
  const questions = {
    merchant: [
      'What is the store name?',
      'What is the merchant name?',
      'What is the business name?',
    ],
    date: [
      'What is the date on this receipt?',
      'What is the transaction date?',
    ],
    total: [
      'What is the total amount?',
      'What is the grand total?',
      'How much was paid?',
    ],
    currency: [
      'What currency is used?',
    ],
  };

  const results: Record<string, { answer: string; score: number }> = {};
  let questionCount = 0;
  const totalQuestions = Object.values(questions).flat().length;

  // Process each field
  for (const [field, fieldQuestions] of Object.entries(questions)) {
    let bestAnswer = '';
    let bestScore = 0;

    for (const question of fieldQuestions) {
      try {
        const result = await pipeline({ question, context: text });
        questionCount++;
        sendProgress(id, Math.round((questionCount / totalQuestions) * 100), `Extracting ${field}...`);

        if (result.score > bestScore) {
          bestScore = result.score;
          bestAnswer = result.answer;
        }
      } catch (e) {
        console.warn('[ML Worker] Question failed:', question, e);
        questionCount++;
      }
    }

    results[field] = { answer: bestAnswer.trim(), score: bestScore };
  }

  // Parse and structure the results
  const parsed = {
    merchant: cleanMerchantName(results['merchant']?.answer || ''),
    merchantConfidence: results['merchant']?.score || 0,
    date: normalizeDate(results['date']?.answer || ''),
    dateConfidence: results['date']?.score || 0,
    total: parseAmount(results['total']?.answer || ''),
    totalConfidence: results['total']?.score || 0,
    currency: detectCurrency(results['currency']?.answer || '', results['total']?.answer || ''),
    rawAnswers: results,
    modelType: 'qa' as const,
  };

  sendMessage({ type: 'result', id, payload: parsed });
  console.log('[ML Worker] QA parsing complete:', parsed);
}

/**
 * Parse receipt using multilingual embeddings model.
 * Uses semantic similarity to identify receipt fields.
 */
async function parseWithEmbeddings(id: string, text: string): Promise<void> {
  sendProgress(id, 0, 'Analyzing receipt with embeddings...');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Reference phrases for semantic matching (multilingual)
  const referencePatterns = {
    merchant: [
      'store name', 'shop name', 'merchant', 'company',
      // Traditional Chinese
      '店名', '商店', '店舗', '會社', '公司', '商家', '商號', '企業',
      // Japanese - company types
      '株式会社', '有限会社', 'コンビニ', 'スーパー', 'ストア',
      // Japanese - common store types
      'ファミリーマート', 'セブンイレブン', 'ローソン', 'マクドナルド',
    ],
    date: [
      'date', 'transaction date', 'purchase date',
      // Traditional Chinese
      '日期', '購買日期', '發票日期',
      // Japanese
      '日付', '取引日', '年月日', 'ご利用日', '発行日',
      // Japanese era references
      '令和', '平成', '西暦',
    ],
    total: [
      'total', 'grand total', 'amount due', 'total amount',
      // Traditional Chinese
      '合計', '總計', '總額', '金額', '小計', '應付金額',
      // Simplified Chinese
      '合计', '总计',
      // Japanese - various total expressions
      'お会計', 'お支払い', 'ご請求額', '税込合計', '税込', 
      '合計金額', 'お預り', 'お釣り', '領収金額',
      // Japanese tax-related
      '税抜', '本体価格', '内税', '外税',
    ],
    currency: [
      'currency', 'payment', 'cash', 'card',
      // Traditional Chinese
      '幣別', '貨幣', '付款', '現金', '信用卡',
      // Japanese payment methods
      '円', '¥', 'クレジット', '電子マネー', 'PayPay', 'Suica', 'PASMO',
      'iD', 'QUICPay', '楽天ペイ', 'LINE Pay', 'd払い',
    ],
  };

  sendProgress(id, 20, 'Computing embeddings...');

  // Get embeddings for all lines
  const lineEmbeddings = await getEmbeddings(lines);
  
  sendProgress(id, 50, 'Matching patterns...');

  // Get embeddings for reference patterns
  const results: Record<string, { value: string; confidence: number; lineIndex: number }> = {};

  for (const [field, patterns] of Object.entries(referencePatterns)) {
    const patternEmbeddings = await getEmbeddings(patterns);
    
    let bestMatch = { lineIndex: -1, similarity: 0, value: '' };
    
    // Find the line most similar to any of the patterns
    for (let i = 0; i < lines.length; i++) {
      for (const patternEmbedding of patternEmbeddings) {
        const similarity = cosineSimilarity(lineEmbeddings[i], patternEmbedding);
        if (similarity > bestMatch.similarity) {
          bestMatch = { lineIndex: i, similarity, value: lines[i] };
        }
      }
    }

    // For merchant, look at early lines (header)
    if (field === 'merchant') {
      // Check first 7 lines for merchant candidates (Japanese receipts often have more header lines)
      const headerLines = lines.slice(0, 7);
      const merchantCandidates = headerLines.filter(l => {
        // Skip patterns for non-merchant lines
        const skipPatterns = [
          /^\d{2}[/-]\d{2}/, // Date patterns
          /^\d+[.,]\d{2}$/, // Just a number
          /^(tel|phone|fax|電話|傳真|℡)/i,
          /^〒?\d{3}-?\d{4}/, // Japanese postal code
          /^(東京都|大阪府|京都府|北海道|.{2,3}県)/, // Japanese prefecture (likely address)
          /^(http|www\.|@)/i, // URLs/emails
          /^レシート$|^領収書$|^領収証$/i, // Just "receipt"
          /^(no|番号|#)\s*:?\s*\d+/i, // Receipt/transaction numbers
          /^登録番号|^インボイス|^適格請求書/i, // Invoice registration
          /^(営業時間|open|close)/i, // Business hours
          /^\d{10,}$/, // Long numbers (barcodes, phone numbers)
          /^(店舗|店番|レジ|担当)/i, // Store/register info
        ];
        
        return l.length > 2 && 
          l.length < 50 &&
          !skipPatterns.some(p => p.test(l));
      });
      
      // Prefer lines with company indicators
      const companyIndicators = /株式会社|有限会社|合同会社|㈱|㈲|Co\.|Inc\.|Ltd\.|店$|屋$/i;
      const companyLine = merchantCandidates.find(l => companyIndicators.test(l));
      
      if (companyLine) {
        bestMatch.value = companyLine;
        bestMatch.similarity = Math.max(bestMatch.similarity, 0.7);
      } else if (merchantCandidates.length > 0) {
        bestMatch.value = merchantCandidates[0];
        bestMatch.similarity = Math.max(bestMatch.similarity, 0.5);
      }
    }

    // For total, use smart extraction for Japanese receipts
    if (field === 'total') {
      // Japanese total keywords (prioritized - tax-inclusive first)
      const totalKeywords = [
        /税込合計[:\s]*[¥￥]?\s*([\d,]+)/,
        /合計[（(]税込[)）][:\s]*[¥￥]?\s*([\d,]+)/,
        /お会計[:\s]*[¥￥]?\s*([\d,]+)/,
        /お支払い[:\s]*[¥￥]?\s*([\d,]+)/,
        /ご請求額[:\s]*[¥￥]?\s*([\d,]+)/,
        /領収金額[:\s]*[¥￥]?\s*([\d,]+)/,
        /合計[:\s]*[¥￥]?\s*([\d,]+)/,
        /計[:\s]*[¥￥]?\s*([\d,]+)/,
        // Traditional Chinese
        /總計[:\s]*(?:NT\$|HK\$)?[¥￥$]?\s*([\d,]+)/,
        /應付[:\s]*[¥￥$]?\s*([\d,]+)/,
      ];

      // First, try to find a line with a total keyword
      for (const pattern of totalKeywords) {
        for (const line of lines) {
          const match = line.match(pattern);
          if (match) {
            const amount = parseFloat(match[1].replace(/,/g, ''));
            if (amount > 0 && amount < 10000000) {
              bestMatch.value = line;
              bestMatch.similarity = 0.85;
              break;
            }
          }
        }
        if (bestMatch.similarity >= 0.85) break;
      }

      // Fallback: look for the largest amount (but avoid subtotals/item prices)
      if (bestMatch.similarity < 0.85) {
        const amountPattern = /[¥￥$€£]?\s*([\d,]+)(?:円)?(?:\s|$)/;
        let maxAmount = 0;
        let maxLine = '';
        
        // Skip lines that are likely individual items or subtotals
        const skipPatterns = [
          /^[\s\d]*[x×]\s*\d/, // Item with quantity
          /税抜|本体|内税|外税/, // Tax-related subtotals
          /小計/, // Subtotal
          /値引|割引|クーポン/, // Discounts
          /お預り|お釣り/, // Cash tendered / change
        ];

        for (const line of lines) {
          if (skipPatterns.some(p => p.test(line))) continue;
          
          const match = line.match(amountPattern);
          if (match) {
            const amount = parseFloat(match[1].replace(/,/g, ''));
            if (amount > maxAmount && amount < 10000000) {
              maxAmount = amount;
              maxLine = line;
            }
          }
        }
        if (maxAmount > 0) {
          bestMatch.value = maxLine;
          bestMatch.similarity = Math.max(bestMatch.similarity, 0.6);
        }
      }
    }

    results[field] = { 
      value: bestMatch.value, 
      confidence: bestMatch.similarity,
      lineIndex: bestMatch.lineIndex,
    };
  }

  sendProgress(id, 80, 'Extracting values...');

  // Parse and structure the results
  const parsed = {
    merchant: cleanMerchantName(results['merchant']?.value || ''),
    merchantConfidence: results['merchant']?.confidence || 0,
    date: normalizeDate(results['date']?.value || ''),
    dateConfidence: results['date']?.confidence || 0,
    total: parseAmount(results['total']?.value || ''),
    totalConfidence: results['total']?.confidence || 0,
    currency: detectCurrency(results['currency']?.value || '', results['total']?.value || ''),
    rawAnswers: results,
    modelType: 'embeddings' as const,
  };

  sendMessage({ type: 'result', id, payload: parsed });
  console.log('[ML Worker] Embeddings parsing complete:', parsed);
}

/**
 * Get embeddings for a list of texts.
 */
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (const text of texts) {
    // For multilingual-e5, prefix with "query: " for better results
    const result = await pipeline(`query: ${text}`, { pooling: 'mean', normalize: true });
    // Extract the embedding array
    const embedding = Array.from(result.data as Float32Array);
    embeddings.push(embedding);
  }
  
  return embeddings;
}

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Clean merchant name.
 */
function cleanMerchantName(name: string): string {
  if (!name) return 'Unknown Merchant';
  return name
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown Merchant';
}

/**
 * Normalize date to YYYY-MM-DD.
 * Supports: ISO, Japanese (Reiwa/Heisei), ROC (民國), and common formats.
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];

  // Try Japanese era patterns first (Reiwa: 2019+, Heisei: 1989-2019)
  const reiwaMatch = dateStr.match(/令和\s*(\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (reiwaMatch) {
    const year = 2018 + parseInt(reiwaMatch[1], 10); // Reiwa 1 = 2019
    const month = parseInt(reiwaMatch[2], 10);
    const day = parseInt(reiwaMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }

  const heiseiMatch = dateStr.match(/平成\s*(\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (heiseiMatch) {
    const year = 1988 + parseInt(heiseiMatch[1], 10); // Heisei 1 = 1989
    const month = parseInt(heiseiMatch[2], 10);
    const day = parseInt(heiseiMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }

  // Try R (令和) shorthand: R6.01.15 or R6/01/15
  const reiwaShortMatch = dateStr.match(/R\s*(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})/i);
  if (reiwaShortMatch) {
    const year = 2018 + parseInt(reiwaShortMatch[1], 10);
    const month = parseInt(reiwaShortMatch[2], 10);
    const day = parseInt(reiwaShortMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }

  // Try various standard patterns
  const patterns = [
    { regex: /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, order: [1, 2, 3] },
    { regex: /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/, order: [3, 1, 2] },
    { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/, order: [1, 2, 3] },
    { regex: /民國\s*(\d{1,3})年(\d{1,2})月(\d{1,2})日/, order: [1, 2, 3], roc: true },
    // Japanese short format without era: 24/01/15 or 24.01.15 (year 2024)
    { regex: /(\d{2})[./-](\d{1,2})[./-](\d{1,2})/, order: [1, 2, 3], shortYear: true },
  ];

  for (const { regex, order, roc, shortYear } of patterns) {
    const match = dateStr.match(regex);
    if (match) {
      let year = parseInt(match[order[0]], 10);
      const month = parseInt(match[order[1]], 10);
      const day = parseInt(match[order[2]], 10);

      if (roc) year = 1911 + year;
      if (shortYear && year < 100) year = 2000 + year;

      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      }
    }
  }

  return new Date().toISOString().split('T')[0];
}

/**
 * Parse amount from string.
 */
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const match = amountStr.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(/,/g, '')) || 0;
  }
  return 0;
}

/**
 * Detect currency.
 */
function detectCurrency(currencyHint: string, amountStr: string): string {
  const combined = `${currencyHint} ${amountStr}`.toLowerCase();
  
  if (combined.includes('nt$') || combined.includes('twd') || combined.includes('台幣')) return 'TWD';
  if (combined.includes('hk$') || combined.includes('hkd') || combined.includes('港幣')) return 'HKD';
  if (combined.includes('¥') || combined.includes('円') || combined.includes('jpy')) return 'JPY';
  if (combined.includes('€') || combined.includes('eur')) return 'EUR';
  if (combined.includes('£') || combined.includes('gbp')) return 'GBP';
  if (combined.includes('$') || combined.includes('usd')) return 'USD';
  
  return 'USD';
}

/**
 * Handle incoming messages from main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = event.data;

  switch (type) {
    case 'init': {
      const initPayload = payload as { modelType?: ModelType } | undefined;
      const modelType = initPayload?.modelType || 'qa';
      await initializePipeline(id, modelType);
      break;
    }

    case 'parse': {
      const { text } = payload as { text: string };
      await parseReceipt(id, text);
      break;
    }

    case 'status':
      sendMessage({
        type: 'result',
        id,
        payload: { isReady, isInitializing, modelType: currentModelType },
      });
      break;

    case 'terminate':
      pipeline = null;
      isReady = false;
      sendMessage({ type: 'result', id, payload: { terminated: true } });
      break;

    default:
      sendMessage({
        type: 'error',
        id,
        payload: { error: `Unknown message type: ${type}` },
      });
  }
};

// Signal that worker is loaded
console.log('[ML Worker] Worker loaded and ready to receive messages');
