/**
 * Last-resort receipt parser, used when neither Apple Intelligence nor a cloud
 * model can structure OCR text.
 *
 * It reads structure rather than vocabulary — digits, positions, ISO 4217 codes
 * and Unicode currency signs. The keyword tables it used to carry (English
 * total/amount/due, English month names, a four-currency lexicon) meant a
 * receipt in any other language came back as $0.00 dated today while looking to
 * the caller exactly like a successful parse. What it cannot find now shows up
 * in `confidence` instead, so the caller can send the receipt to an engine that
 * can actually read it.
 */
import { localDateFromParts } from '../utils/transaction-date.utils';

export interface ParsedReceiptText {
  date: Date;
  amount: number;
  currency: string;
  merchant: string;
  /**
   * 0–1: how much of this reading came out of the text rather than out of a
   * default. Zero means every field fell back — today's date, no amount, no
   * currency — not that the receipt itself is worthless.
   */
  confidence: number;
}

/**
 * What each field is worth in the overall score. The amount carries most of it
 * because a transaction with the wrong amount is not worth keeping, and the
 * merchant carries none because it is the same positional guess on every
 * receipt whether the parser understood the text or not.
 */
const AMOUNT_WEIGHT = 0.6;
const DATE_WEIGHT = 0.25;
const CURRENCY_WEIGHT = 0.15;

const DAY_MS = 24 * 60 * 60 * 1000;

// Anything that is neither a digit nor a cased letter separates date parts, so
// 2026-01-15, 2026/01/15, 2026年1月15日 and 2026년 1월 15일 all read on one
// pattern. Cased letters are excluded so that "3 x 4 of 5" is not a date.
const DATE_SEPARATOR = '[^\\d\\p{Lu}\\p{Ll}]{1,3}';
const YEAR_FIRST_DATE = new RegExp(
  `(?:^|\\D)((\\d{4})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{1,2}))(?!\\d)`,
  'gu',
);
const YEAR_LAST_DATE = new RegExp(
  `(?:^|\\D)((\\d{1,2})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{4}|\\d{2}))(?!\\d)`,
  'gu',
);

const CURRENCY_SIGN = /\p{Sc}/u;

// A three-letter code only means a currency where it sits against the money.
// Receipts are full of three-letter words that are not currencies, and the
// platform's code list contains ALL, CUP and TOP — hence the two digits in the
// trailing form, which is what keeps "2 CUP" from being read as Cuban pesos.
const ISO_CODE_BESIDE_AMOUNT = [
  /(?:^|[^\p{L}])(\p{Lu}{3})(?!\p{L})\s*[\d\p{Sc}]/gu,
  /\d{2}\s*(\p{Lu}{3})(?!\p{L})/gu,
];

// Digits held together by the marks used for grouping and decimals. Plain
// spaces are deliberately left out: "2 12 25" is three numbers, not one.
const NUMBER_TOKEN = /\d+(?:[.,'’\u00A0\u202F\u2009]\d+)*/gu;
const GROUPING_MARKS = /['’\u00A0\u202F\u2009]/g;

/** Longer runs of digits are phone numbers, receipt numbers and card fragments. */
const MAX_PLAIN_DIGITS = 6;

interface AmountCandidate {
  value: number;
  token: string;
  besideCurrency: boolean;
}

export function parseReceiptOcrText(text: string): ParsedReceiptText {
  const { date, confidence: dateConfidence, matched } = readDate(text);

  // The date comes out of the text before the amounts are read: 15/01/2026 is
  // three numbers, and 2026 is larger than any total the receipt carries.
  const withoutDate = matched ? text.split(matched).join(' ') : text;
  const lines = withoutDate.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  const { currency, confidence: currencyConfidence, marker } = readCurrency(text);
  const { amount, confidence: amountConfidence } = readAmount(lines, marker);

  // Merchant names sit at the top of receipts everywhere; read it from the
  // original text so a date on the first line cannot take the name with it.
  const merchant =
    text.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? 'Unknown Merchant';

  const confidence =
    amountConfidence * AMOUNT_WEIGHT +
    dateConfidence * DATE_WEIGHT +
    currencyConfidence * CURRENCY_WEIGHT;

  return {
    date,
    amount,
    currency,
    merchant,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * The purchase date, plus the text it was read from so the caller can keep its
 * digits out of the amount hunt.
 */
function readDate(text: string): { date: Date; confidence: number; matched: string } {
  for (const match of text.matchAll(YEAR_FIRST_DATE)) {
    const date = toDate(Number(match[2]), Number(match[3]), Number(match[4]));
    if (date) {
      return { date, confidence: 0.9, matched: match[1] };
    }
  }

  const dayFirst = devicePrefersDayFirst();
  for (const match of text.matchAll(YEAR_LAST_DATE)) {
    const first = Number(match[2]);
    const second = Number(match[3]);

    // Only the receipt's own numbers can settle 03/04: where one of them cannot
    // be a month, the other one is. Where both can, this falls back to how the
    // device writes dates and marks the reading down for it.
    const ambiguous = first <= 12 && second <= 12;
    const readDayFirst = first > 12 || (ambiguous && dayFirst);
    const year = fullYear(match[4]);
    const date = readDayFirst ? toDate(year, second, first) : toDate(year, first, second);
    if (!date) {
      continue;
    }

    const confidence = match[4].length === 4 ? 0.9 : 0.5;
    return { date, confidence: ambiguous ? confidence * 0.6 : confidence, matched: match[1] };
  }

  return { date: new Date(), confidence: 0, matched: '' };
}

/** `month` is 1-12 here, as it is written on a receipt. */
function toDate(year: number, month: number, day: number): Date | undefined {
  const date = localDateFromParts(year, month - 1, day);
  if (!date) {
    return undefined;
  }
  // Nothing has been bought tomorrow yet. This is what keeps an item code or a
  // phone number shaped like 03-12-34 from becoming the receipt's date.
  if (date.getTime() > Date.now() + DAY_MS) {
    return undefined;
  }
  return date;
}

/** A two-digit year on a receipt is this century: 26 is 2026, not 1926. */
function fullYear(digits: string): number {
  return digits.length === 4 ? Number(digits) : 2000 + Number(digits);
}

/**
 * Whether this device writes the day before the month, asked of Intl rather
 * than assumed: 03/04 is the 3rd of April to most of the world and the 4th of
 * March in the US, and the receipt does not say which it meant.
 */
function devicePrefersDayFirst(): boolean {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(new Date());
    const day = parts.findIndex(part => part.type === 'day');
    const month = parts.findIndex(part => part.type === 'month');
    return day !== -1 && month !== -1 && day < month;
  } catch {
    return false;
  }
}

/**
 * The currency, plus the marker it was recognized by so the amount hunt can see
 * which lines the receipt itself treats as money.
 */
function readCurrency(text: string): { currency: string; confidence: number; marker: string } {
  const codes = new Set(currencyCodes());
  for (const pattern of ISO_CODE_BESIDE_AMOUNT) {
    for (const match of text.matchAll(pattern)) {
      if (codes.has(match[1])) {
        return { currency: match[1], confidence: 1, marker: match[1] };
      }
    }
  }

  // The earliest sign in the text wins, which is also what settles CN¥ against
  // the ¥ inside it.
  let found: { sign: string; code: string; at: number } | undefined;
  for (const [sign, code] of currencySigns()) {
    const at = text.indexOf(sign);
    if (at === -1 || (found && at >= found.at)) {
      continue;
    }
    found = { sign, code, at };
  }

  return found
    ? { currency: found.code, confidence: 0.7, marker: found.sign }
    : { currency: '', confidence: 0, marker: '' };
}

let cachedCurrencyCodes: string[] | undefined;

/**
 * Every currency this platform knows about. Without it there is no way to tell
 * a currency code from any other three-letter word, so the parser reports no
 * currency rather than guessing one.
 */
function currencyCodes(): string[] {
  if (!cachedCurrencyCodes) {
    cachedCurrencyCodes =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];
  }
  return cachedCurrencyCodes;
}

let cachedCurrencySigns: Map<string, string> | undefined;

/**
 * Currency signs the platform can name, ₩ → KRW and so on, derived from its own
 * ICU data instead of typed out — a hand-written table only ever covers the
 * currencies someone remembered.
 *
 * Only signs that name exactly one currency are kept, and the fuller `symbol`
 * spelling is preferred over `narrowSymbol` so that $ stays USD instead of
 * being claimed by every other peso. Signs made only of letters are dropped
 * (ICU offers "L" for HNL and "R" for ZAR): single letters match half the words
 * on a receipt.
 */
function currencySigns(): Map<string, string> {
  if (!cachedCurrencySigns) {
    const signs = uniqueSignsFor('symbol');
    for (const [sign, code] of uniqueSignsFor('narrowSymbol')) {
      if (!signs.has(sign)) {
        signs.set(sign, code);
      }
    }
    cachedCurrencySigns = signs;
  }
  return cachedCurrencySigns;
}

function uniqueSignsFor(display: 'symbol' | 'narrowSymbol'): Map<string, string> {
  const claims = new Map<string, Set<string>>();
  for (const code of currencyCodes()) {
    const sign = signFor(code, display);
    if (!sign || sign === code || !CURRENCY_SIGN.test(sign)) {
      continue;
    }
    const claimed = claims.get(sign) ?? new Set<string>();
    claimed.add(code);
    claims.set(sign, claimed);
  }

  const unique = new Map<string, string>();
  for (const [sign, claimed] of claims) {
    if (claimed.size === 1) {
      unique.set(sign, [...claimed][0]);
    }
  }
  return unique;
}

function signFor(code: string, display: 'symbol' | 'narrowSymbol'): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: display })
      .formatToParts(0)
      .filter(part => part.type === 'currency')
      .map(part => part.value)
      .join('');
  } catch {
    return '';
  }
}

function readAmount(lines: string[], marker: string): { amount: number; confidence: number } {
  const candidates: AmountCandidate[] = [];
  for (const line of lines) {
    const besideCurrency = CURRENCY_SIGN.test(line) || (marker !== '' && line.includes(marker));
    for (const match of line.matchAll(NUMBER_TOKEN)) {
      const value = toAmount(match[0]);
      if (value === undefined || value <= 0) {
        continue;
      }
      candidates.push({ value, token: match[0], besideCurrency });
    }
  }

  // Strongest evidence first: a number the receipt itself marked as money, then
  // one written like money, then any plain number. Within a tier the largest
  // wins — the total is the biggest figure on all but the odd receipt, and
  // seeing that takes no vocabulary.
  const tiers = [
    { of: candidates.filter(c => c.besideCurrency), confidence: 0.8 },
    { of: candidates.filter(c => !c.besideCurrency && isMoneyShaped(c.token)), confidence: 0.5 },
    { of: candidates.filter(c => !c.besideCurrency && isPlainNumber(c.token)), confidence: 0.3 },
  ];

  for (const tier of tiers) {
    const best = tier.of.reduce<AmountCandidate | undefined>(
      (winner, candidate) => (!winner || candidate.value > winner.value ? candidate : winner),
      undefined,
    );
    if (best) {
      return { amount: best.value, confidence: tier.confidence };
    }
  }

  return { amount: 0, confidence: 0 };
}

/**
 * Read a number the way the receipt printed it. Whether the last mark is a
 * decimal point or a thousands separator is settled by what follows it: three
 * digits are a group, so 1,200 and 1.200 are both twelve hundred.
 */
function toAmount(token: string): number | undefined {
  const cleaned = token.replace(GROUPING_MARKS, '');
  const lastMark = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  const fraction = lastMark === -1 ? '' : cleaned.slice(lastMark + 1);

  const digits =
    fraction.length >= 1 && fraction.length <= 2
      ? `${cleaned.slice(0, lastMark).replace(/[.,]/g, '')}.${fraction}`
      : cleaned.replace(/[.,]/g, '');

  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}

function isMoneyShaped(token: string): boolean {
  return /[.,]\d{1,2}$/.test(token) || /[.,'’\u00A0\u202F\u2009]\d{3}\b/.test(token);
}

/**
 * A number with no money marks on it at all. A leading zero means it was padded
 * rather than counted, which no total ever is.
 */
function isPlainNumber(token: string): boolean {
  return !isMoneyShaped(token) && token.length <= MAX_PLAIN_DIGITS && !/^0\d/.test(token);
}
