/// <reference lib="webworker" />

/**
 * Web Worker for Transformers.js ML processing.
 * Runs in a separate thread to keep the UI responsive.
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

// Pipeline and model state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: any = null;
let isInitializing = false;
let isReady = false;

// Model configuration
const MODEL_ID = 'Xenova/distilbert-base-cased-distilled-squad';

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
async function initializePipeline(id: string): Promise<void> {
  if (isReady && pipeline) {
    sendMessage({ type: 'ready', id, payload: { cached: true } });
    return;
  }

  if (isInitializing) {
    sendMessage({ type: 'error', id, payload: { error: 'Already initializing' } });
    return;
  }

  isInitializing = true;
  sendProgress(id, 0, 'Loading Transformers.js...');

  try {
    // Dynamic import of transformers
    const { pipeline: createPipeline, env } = await import('@huggingface/transformers');
    
    // Configure for browser/worker usage
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    
    sendProgress(id, 10, 'Downloading model...');

    // Create the question-answering pipeline
    // Use WASM backend (WebGPU may not be available in workers on all browsers)
    const qa = await createPipeline('question-answering', MODEL_ID, {
      progress_callback: (progressInfo: { status?: string; progress?: number; file?: string }) => {
        if (progressInfo.progress !== undefined) {
          const progress = Math.round(10 + progressInfo.progress * 0.85);
          sendProgress(id, progress, progressInfo.status || 'Downloading...');
        }
      },
    });

    pipeline = qa;
    isReady = true;
    isInitializing = false;

    sendProgress(id, 100, 'Model ready');
    sendMessage({ type: 'ready', id, payload: { cached: false } });

    console.log('[ML Worker] Pipeline initialized successfully');
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
 * Parse receipt text using QA model.
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
    sendProgress(id, 0, 'Analyzing receipt...');

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
    };

    sendMessage({
      type: 'result',
      id,
      payload: parsed,
    });

    console.log('[ML Worker] Parsing complete:', parsed);
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
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];

  // Try various patterns
  const patterns = [
    { regex: /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, order: [1, 2, 3] },
    { regex: /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/, order: [3, 1, 2] },
    { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/, order: [1, 2, 3] },
    { regex: /民國\s*(\d{1,3})年(\d{1,2})月(\d{1,2})日/, order: [1, 2, 3], roc: true },
  ];

  for (const { regex, order, roc } of patterns) {
    const match = dateStr.match(regex);
    if (match) {
      let year = parseInt(match[order[0]], 10);
      const month = parseInt(match[order[1]], 10);
      const day = parseInt(match[order[2]], 10);

      if (roc) year = 1911 + year;

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
    case 'init':
      await initializePipeline(id);
      break;

    case 'parse': {
      const { text } = payload as { text: string };
      await parseReceipt(id, text);
      break;
    }

    case 'status':
      sendMessage({
        type: 'result',
        id,
        payload: { isReady, isInitializing },
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
