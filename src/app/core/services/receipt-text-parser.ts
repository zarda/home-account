/**
 * Basic regex-based receipt text parser. Used as the last-resort fallback
 * when neither Apple Intelligence nor cloud AI can structure OCR text.
 */
export interface ParsedReceiptText {
  date: Date;
  amount: number;
  currency: string;
  merchant: string;
}

const DATE_PATTERNS = [
  /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,  // MM/DD/YYYY or DD/MM/YYYY
  /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/,     // YYYY/MM/DD
  /(\w{3,})\s+(\d{1,2}),?\s+(\d{4})/i,     // Month DD, YYYY
];

const AMOUNT_PATTERNS = [
  /(?:total|amount|due|pay|sum|charge)[:\s]*[¥$€£]?\s*([\d,]+\.?\d*)/i,
  /[¥$€£]\s*([\d,]+\.?\d*)/,
  /([\d,]+\.?\d*)\s*(?:円|yen|usd|thb)/i,
];

export function parseReceiptOcrText(text: string): ParsedReceiptText {
  const lines = text.split('\n').filter(line => line.trim());

  let date = new Date();
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const parsed = new Date(match[0]);
      if (!isNaN(parsed.getTime())) {
        date = parsed;
        break;
      }
    }
  }

  let amount = 0;
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  let currency = 'USD';
  if (text.includes('¥') || text.includes('円') || /yen/i.test(text)) {
    currency = 'JPY';
  } else if (text.includes('€')) {
    currency = 'EUR';
  } else if (text.includes('£')) {
    currency = 'GBP';
  } else if (/THB|฿|baht/i.test(text)) {
    currency = 'THB';
  }

  // Merchant name is typically the first line of a receipt
  const merchant = lines[0] || 'Unknown Merchant';

  return { date, amount, currency, merchant };
}
